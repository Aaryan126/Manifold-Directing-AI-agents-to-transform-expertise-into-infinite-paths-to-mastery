from uuid import UUID, uuid4

import pytest

from app.routing.models import (
    AttemptContext,
    AttemptSubmission,
    LearnerConceptProgress,
    LearnerMastery,
    MasteryState,
    RouteableClip,
    RouteableConcept,
    RouteableRemediationRule,
    RouteAction,
    RouteDecision,
    RoutingPolicy,
)
from app.routing.repository import RoutingRepository
from app.routing.service import RoutingService


@pytest.mark.anyio
async def test_scripted_learner_session_updates_mastery_and_advances() -> None:
    repo = MemoryRoutingRepository()
    service = RoutingService(repo)

    first = await service.submit_attempt(
        _submission(
            learner_id=repo.learner_id,
            question_id=repo.question_id,
            correctness=True,
            confidence=2,
        ),
    )
    assert first.action == RouteAction.REINFORCE
    assert first.mastery_state == MasteryState.PRACTICED
    assert repo.mastery[repo.current_concept_id].state == MasteryState.PRACTICED

    second = await service.submit_attempt(
        _submission(
            learner_id=repo.learner_id,
            question_id=repo.question_id,
            correctness=True,
            confidence=4,
        ),
    )
    assert second.action == RouteAction.ADVANCE
    assert second.target_concept_id == repo.next_concept_id
    assert repo.mastery[repo.current_concept_id].state == MasteryState.MASTERED


@pytest.mark.anyio
async def test_incorrect_answer_routes_to_active_clip_from_remediation_map() -> None:
    repo = MemoryRoutingRepository()
    service = RoutingService(repo)

    decision = await service.submit_attempt(
        _submission(
            learner_id=repo.learner_id,
            question_id=repo.question_id,
            correctness=False,
            confidence=3,
            wrong_answer_pattern="misconception",
        ),
    )

    assert decision.action == RouteAction.REMEDIATE
    assert decision.target_clip_id == repo.active_clip.id
    assert repo.flagged_clip.id not in repo.resolved_clip_ids


@pytest.mark.anyio
async def test_stuck_loop_creates_instructor_visible_signal() -> None:
    repo = MemoryRoutingRepository(policy=RoutingPolicy(max_remediation_attempts=1))
    repo.mastery[repo.current_concept_id] = LearnerMastery(
        concept_id=repo.current_concept_id,
        state=MasteryState.STRUGGLING,
        remediation_attempts=1,
    )
    service = RoutingService(repo)

    decision = await service.submit_attempt(
        _submission(
            learner_id=repo.learner_id,
            question_id=repo.question_id,
            correctness=False,
            confidence=1,
        ),
    )

    assert decision.action == RouteAction.FLAG_INSTRUCTOR
    assert decision.dashboard_signal_id in repo.signals
    assert repo.mastery[repo.current_concept_id].state == MasteryState.STRUGGLING


@pytest.mark.anyio
async def test_learner_progress_returns_persisted_mastery_map() -> None:
    repo = MemoryRoutingRepository()
    service = RoutingService(repo)
    await service.submit_attempt(
        _submission(
            learner_id=repo.learner_id,
            question_id=repo.question_id,
            correctness=True,
            confidence=4,
        ),
    )

    progress = await service.learner_progress(repo.learner_id, repo.course_id)

    assert progress[0].concept_id == repo.current_concept_id
    assert progress[0].state == MasteryState.MASTERED


class MemoryRoutingRepository(RoutingRepository):
    def __init__(self, policy: RoutingPolicy | None = None) -> None:
        self.course_id = uuid4()
        self.learner_id = uuid4()
        self.question_id = uuid4()
        self.topic_id = uuid4()
        self.current_concept_id = uuid4()
        self.next_concept_id = uuid4()
        self.policy = policy or RoutingPolicy()
        self.active_clip = RouteableClip(
            id=uuid4(),
            topic_id=self.topic_id,
            concept_id=self.current_concept_id,
            type="explanation",
            start_seconds=0,
            end_seconds=60,
        )
        self.flagged_clip = RouteableClip(
            id=uuid4(),
            topic_id=self.topic_id,
            concept_id=self.current_concept_id,
            type="misconception_correction",
            start_seconds=60,
            end_seconds=90,
        )
        self.mastery: dict[UUID, LearnerMastery] = {
            self.current_concept_id: LearnerMastery(
                concept_id=self.current_concept_id,
                state=MasteryState.NOT_STARTED,
            ),
        }
        self.attempts: list[AttemptSubmission] = []
        self.signals: set[UUID] = set()
        self.resolved_clip_ids: list[UUID] = []

    async def get_attempt_context(
        self,
        learner_id: UUID,
        question_id: UUID,
    ) -> AttemptContext | None:
        if learner_id != self.learner_id or question_id != self.question_id:
            return None
        mastered = frozenset(
            concept_id
            for concept_id, mastery in self.mastery.items()
            if mastery.state == MasteryState.MASTERED
        )
        return AttemptContext(
            course_id=self.course_id,
            learner_id=learner_id,
            question_id=question_id,
            topic_id=self.topic_id,
            current_concept_id=self.current_concept_id,
            policy=self.policy,
            mastery=self.mastery[self.current_concept_id],
            mastered_concept_ids=mastered,
            remediation_rules=(
                RouteableRemediationRule(
                    id=uuid4(),
                    wrong_answer_pattern="misconception",
                    target_clip_id=self.active_clip.id,
                    target_concept_id=self.current_concept_id,
                ),
            ),
        )

    async def record_attempt(self, submission: AttemptSubmission) -> UUID:
        self.attempts.append(submission)
        return uuid4()

    async def update_mastery(self, learner_id: UUID, mastery: LearnerMastery) -> None:
        del learner_id
        self.mastery[mastery.concept_id] = mastery

    async def eligible_next_concepts(
        self,
        course_id: UUID,
        mastered_concept_ids: frozenset[UUID],
    ) -> tuple[RouteableConcept, ...]:
        assert course_id == self.course_id
        assert self.current_concept_id in mastered_concept_ids
        return (
            RouteableConcept(
                id=self.next_concept_id,
                name="Next",
                topic_id=uuid4(),
            ),
        )

    async def resolve_active_clip(
        self,
        concept_id: UUID,
        topic_id: UUID,
        preferred_clip_id: UUID | None = None,
    ) -> RouteableClip | None:
        assert concept_id == self.current_concept_id
        assert topic_id == self.topic_id
        self.resolved_clip_ids.append(self.active_clip.id)
        if preferred_clip_id == self.active_clip.id or preferred_clip_id is None:
            return self.active_clip
        return None

    async def create_stuck_signal(
        self,
        context: AttemptContext,
        decision: RouteDecision,
    ) -> UUID:
        del context, decision
        signal_id = uuid4()
        self.signals.add(signal_id)
        return signal_id

    async def list_policies(self, course_id: UUID) -> dict[UUID | None, RoutingPolicy]:
        assert course_id == self.course_id
        return {self.current_concept_id: self.policy}

    async def upsert_policy(
        self,
        course_id: UUID,
        concept_id: UUID | None,
        policy: RoutingPolicy,
    ) -> RoutingPolicy:
        assert course_id == self.course_id
        assert concept_id in {None, self.current_concept_id}
        self.policy = policy
        return policy

    async def create_demo_learner(self, course_id: UUID) -> UUID:
        assert course_id == self.course_id
        self.learner_id = uuid4()
        return self.learner_id

    async def learner_progress(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> tuple[LearnerConceptProgress, ...]:
        assert learner_id == self.learner_id
        assert course_id == self.course_id
        return tuple(
            LearnerConceptProgress(
                concept_id=concept_id,
                name="Current" if concept_id == self.current_concept_id else "Next",
                state=mastery.state,
                topic_id=self.topic_id,
            )
            for concept_id, mastery in self.mastery.items()
        )


def _submission(
    *,
    learner_id: UUID,
    question_id: UUID,
    correctness: bool,
    confidence: int,
    wrong_answer_pattern: str | None = None,
) -> AttemptSubmission:
    return AttemptSubmission(
        learner_id=learner_id,
        question_id=question_id,
        answer={"answer": "x"},
        correctness=correctness,
        confidence=confidence,
        wrong_answer_pattern=wrong_answer_pattern,
    )
