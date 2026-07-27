from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.assessments.models import AnswerGrade
from app.learning.models import (
    LearnerRevision,
    LearningGuideMessage,
    MasteryReview,
    PlacementCheck,
    ReviewConcept,
    StudySession,
)
from app.learning.service import LearningService, LearningValidationError
from app.routing.models import (
    LearnerPath,
    LearnerPathItem,
    MasteryState,
    RouteAction,
    RouteDecision,
    RoutingPolicy,
)


@pytest.mark.anyio
async def test_session_plan_uses_only_exact_concept_reviewed_artifacts() -> None:
    fixture = LearningFixture()

    session = await fixture.service.create_session(
        fixture.learner_id,
        fixture.course_id,
        mode="continue_path",
        idempotency_key="session-1",
    )

    assert [step["clip_id"] for step in fixture.repository.created_steps[:1]] == [fixture.clip_id]
    assert fixture.repository.created_steps[1]["question_id"] == fixture.question_id
    assert session.mode == "continue_path"
    assert all("estimated_minutes" not in step for step in fixture.repository.created_steps)


@pytest.mark.anyio
async def test_review_mode_starts_with_retrieval_instead_of_passive_rewatch() -> None:
    fixture = LearningFixture(state=MasteryState.PRACTICED)

    await fixture.service.create_session(
        fixture.learner_id,
        fixture.course_id,
        mode="review_learned",
        idempotency_key="review-session",
    )

    assert [step["kind"] for step in fixture.repository.created_steps] == [
        "question",
        "reflect",
    ]
    assert fixture.repository.created_steps[0]["reason_code"] == "review_retrieval"


@pytest.mark.anyio
async def test_learn_new_prefers_an_eligible_alternative_to_the_current_path() -> None:
    fixture = LearningFixture(two_concepts=True)
    alternative = fixture.path.items[1]

    await fixture.service.create_session(
        fixture.learner_id,
        fixture.course_id,
        mode="learn_new",
        idempotency_key="new-concept-session",
    )

    assert fixture.repository.created_steps[0]["concept_id"] == alternative.concept_id
    assert fixture.repository.created_steps[0]["clip_id"] == alternative.clip_ids[0]


@pytest.mark.anyio
async def test_strengthen_mode_requires_real_difficulty_evidence() -> None:
    fixture = LearningFixture()
    with pytest.raises(LearningValidationError, match="learning mode is unavailable"):
        await fixture.service.create_session(
            fixture.learner_id,
            fixture.course_id,
            mode="strengthen_weak_areas",
            idempotency_key="no-weak-evidence",
        )

    struggling = LearningFixture(state=MasteryState.STRUGGLING)
    session = await struggling.service.create_session(
        struggling.learner_id,
        struggling.course_id,
        mode="strengthen_weak_areas",
        idempotency_key="weak-evidence",
    )

    assert session.mode == "strengthen_weak_areas"
    assert struggling.repository.created_steps[0]["reason_code"] == "strengthen_weak_area"


@pytest.mark.anyio
async def test_mode_recommendation_prioritizes_struggling_evidence() -> None:
    fixture = LearningFixture(state=MasteryState.STRUGGLING)
    mastery = await fixture.repository.mastery_review(
        LearnerRevision(fixture.learner_id, fixture.course_id, fixture.revision_id),
        (
            {
                "concept_id": fixture.concept_id,
                "name": "Vector direction",
                "state": "struggling",
                "coverage_state": "complete",
            },
        ),
    )

    modes = fixture.service._mode_options(fixture.path, mastery, None)

    recommended = next(mode for mode in modes if mode.recommended)
    assert recommended.key == "strengthen_weak_areas"
    assert next(mode for mode in modes if mode.key == "review_learned").available


@pytest.mark.anyio
async def test_content_incomplete_or_blocked_concept_is_not_actionable() -> None:
    fixture = LearningFixture(actionable=False)

    with pytest.raises(LearningValidationError, match="no eligible concept"):
        await fixture.service.create_session(
            fixture.learner_id,
            fixture.course_id,
            mode="continue_path",
            idempotency_key="session-incomplete",
        )

    fixture = LearningFixture(eligible=False)
    with pytest.raises(LearningValidationError, match="blocked"):
        await fixture.service.create_session(
            fixture.learner_id,
            fixture.course_id,
            mode="continue_path",
            idempotency_key="session-blocked",
            concept_id=fixture.concept_id,
        )


@pytest.mark.anyio
async def test_placement_refuses_to_fabricate_confidence_when_coverage_is_sparse() -> None:
    fixture = LearningFixture()

    placement = await fixture.service.create_placement(
        fixture.learner_id,
        fixture.course_id,
        idempotency_key="placement-1",
    )

    assert placement.status == "unavailable"
    assert "not enough instructor-reviewed" in (placement.unavailable_reason or "")
    assert fixture.repository.placement_candidates == ()


@pytest.mark.anyio
async def test_placement_uses_distinct_reviewed_primary_questions_and_course_policy() -> None:
    fixture = LearningFixture(two_concepts=True)

    placement = await fixture.service.create_placement(
        fixture.learner_id,
        fixture.course_id,
        idempotency_key="placement-2",
    )

    assert placement.status == "in_progress"
    assert len(fixture.repository.placement_candidates) == 2
    assert fixture.repository.placement_policy["concepts"][str(fixture.concept_id)] == {
        "confidence_threshold": 4,
        "required_correct": 2,
    }


@pytest.mark.anyio
async def test_answer_is_server_graded_and_records_session_purpose() -> None:
    fixture = LearningFixture()
    fixture.repository.step = {
        "kind": "question",
        "question_id": fixture.question_id,
        "concept_id": fixture.concept_id,
        "purpose": "practice",
    }

    session, decision, correct, feedback = await fixture.service.answer_step(
        fixture.learner_id,
        fixture.course_id,
        fixture.session_id,
        fixture.step_id,
        answer="reviewed answer",
        confidence=4,
    )

    assert correct is True
    assert feedback == "Reviewed feedback."
    assert fixture.routing.submission is not None
    assert fixture.routing.submission.correctness is True
    assert fixture.routing.submission.study_session_id == fixture.session_id
    assert fixture.repository.review_schedule["purpose"] == "lesson"
    assert decision.action == RouteAction.COMPLETE
    assert session.status == "active"


@pytest.mark.anyio
async def test_learning_guide_reports_status_without_persisting_transcript() -> None:
    fixture = LearningFixture(state=MasteryState.PRACTICED)

    learner_message, guide_message = await fixture.service.message_guide(
        fixture.learner_id,
        fixture.course_id,
        "How am I doing?",
    )

    assert learner_message.role == "learner"
    assert guide_message.role == "guide"
    assert guide_message.intent == "status"
    assert "mastered 0 of 1 concepts" in guide_message.content
    assert "currently working on" in guide_message.content
    assert fixture.repository.guide_messages_saved == ()
    assert (
        await fixture.service.guide_messages(
            fixture.learner_id,
            fixture.course_id,
        )
        == ()
    )


@pytest.mark.anyio
async def test_learning_guide_routes_content_questions_to_reviewed_material() -> None:
    fixture = LearningFixture()

    _, guide_message = await fixture.service.message_guide(
        fixture.learner_id,
        fixture.course_id,
        "Explain vector direction to me.",
    )

    assert guide_message.intent == "content_question"
    assert guide_message.action == "replay"
    assert "won’t invent a new teaching explanation" in guide_message.content


@pytest.mark.anyio
async def test_learning_guide_stuck_message_offers_real_help_handoff() -> None:
    fixture = LearningFixture()

    _, guide_message = await fixture.service.message_guide(
        fixture.learner_id,
        fixture.course_id,
        "I am confused and stuck.",
    )

    assert guide_message.intent == "stuck"
    assert guide_message.action == "stuck"
    assert "review exactly what is shared" in guide_message.content


class LearningFixture:
    def __init__(
        self,
        *,
        actionable: bool = True,
        eligible: bool = True,
        two_concepts: bool = False,
        state: MasteryState = MasteryState.NOT_STARTED,
    ) -> None:
        self.learner_id = uuid4()
        self.course_id = uuid4()
        self.revision_id = uuid4()
        self.concept_id = uuid4()
        self.clip_id = uuid4()
        self.question_id = uuid4()
        self.session_id = uuid4()
        self.step_id = uuid4()
        items = [
            _path_item(
                self.concept_id,
                self.clip_id,
                self.question_id,
                actionable=actionable,
                eligible=eligible,
                current=actionable and eligible,
                state=state,
            )
        ]
        if two_concepts:
            items.append(_path_item(uuid4(), uuid4(), uuid4()))
        self.path = LearnerPath(
            course_id=self.course_id,
            revision_id=self.revision_id,
            current_concept_id=(self.concept_id if actionable and eligible else None),
            items=tuple(items),
            last_route_action=None,
            last_route_why=None,
        )
        self.repository = MemoryLearningRepository(self)
        self.routing = MemoryRoutingService(self)
        self.assessments = MemoryAssessmentService()
        self.service = LearningService(
            repository=self.repository,
            routing=self.routing,
            assessments=self.assessments,
        )


class MemoryLearningRepository:
    def __init__(self, fixture: LearningFixture) -> None:
        self.fixture = fixture
        self.created_steps: list[dict[str, object]] = []
        self.placement_candidates: tuple[tuple[UUID, UUID], ...] = ()
        self.placement_policy: dict[str, object] = {}
        self.step: dict[str, object] | None = None
        self.review_schedule: dict[str, object] = {}
        self.guide_messages_saved: tuple[LearningGuideMessage, ...] = ()

    async def learner_revision(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> LearnerRevision | None:
        if learner_id != self.fixture.learner_id or course_id != self.fixture.course_id:
            return None
        return LearnerRevision(learner_id, course_id, self.fixture.revision_id)

    async def concept_artifacts(
        self,
        context: LearnerRevision,
        concept_ids: tuple[UUID, ...],
    ) -> dict[UUID, dict[str, object]]:
        del context
        return {
            item.concept_id: {
                "clip_id": item.clip_ids[0] if item.clip_ids else None,
                "question_id": item.question_ids[0] if item.question_ids else None,
                "clip_duration_seconds": 181,
            }
            for item in self.fixture.path.items
            if item.concept_id in concept_ids
        }

    async def active_session(self, context: LearnerRevision) -> None:
        del context
        return None

    async def has_approved_hint(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
    ) -> bool:
        del context, session_id, step_id
        return False

    async def guide_messages(
        self,
        context: LearnerRevision,
    ) -> tuple[LearningGuideMessage, ...]:
        del context
        return self.guide_messages_saved

    async def append_guide_exchange(
        self,
        context: LearnerRevision,
        *,
        learner_content: str,
        guide_content: str,
        intent: str,
        action: str | None,
        evidence: dict[str, object],
    ) -> tuple[LearningGuideMessage, LearningGuideMessage]:
        del context, evidence
        created_at = datetime.now(UTC)
        result = (
            LearningGuideMessage(
                id=uuid4(),
                role="learner",
                content=learner_content,
                intent=None,
                action=None,
                created_at=created_at,
            ),
            LearningGuideMessage(
                id=uuid4(),
                role="guide",
                content=guide_content,
                intent=intent,
                action=action,
                created_at=created_at,
            ),
        )
        self.guide_messages_saved = result
        return result

    async def create_session(
        self,
        context: LearnerRevision,
        *,
        mode: str,
        idempotency_key: str,
        steps: tuple[dict[str, object], ...],
    ) -> StudySession:
        del context, idempotency_key
        self.created_steps = list(steps)
        return StudySession(
            id=self.fixture.session_id,
            course_id=self.fixture.course_id,
            revision_id=self.fixture.revision_id,
            status="planned",
            mode=mode,
            finish_requested=False,
            plan_version=1,
            steps=(),
        )

    async def create_placement(
        self,
        context: LearnerRevision,
        *,
        idempotency_key: str,
        policy_snapshot: dict[str, object],
        candidates: tuple[tuple[UUID, UUID], ...],
        unavailable_reason: str | None,
    ) -> PlacementCheck:
        del context, idempotency_key
        self.placement_candidates = candidates
        self.placement_policy = policy_snapshot
        return PlacementCheck(
            id=uuid4(),
            status="unavailable" if unavailable_reason else "in_progress",
            unavailable_reason=unavailable_reason,
            items=(),
        )

    async def session_step(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
    ) -> dict[str, object] | None:
        del context
        if session_id == self.fixture.session_id and step_id == self.fixture.step_id:
            return self.step
        return None

    async def schedule_review(
        self,
        context: LearnerRevision,
        concept_id: UUID,
        **values: object,
    ) -> None:
        del context, concept_id
        self.review_schedule = values

    async def complete_step(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
        **values: object,
    ) -> StudySession:
        del context, session_id, step_id, values
        return StudySession(
            id=self.fixture.session_id,
            course_id=self.fixture.course_id,
            revision_id=self.fixture.revision_id,
            status="active",
            mode="continue_path",
            finish_requested=False,
            plan_version=1,
            steps=(),
        )

    async def replace_pending_steps(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        return None

    async def mastery_review(
        self,
        context: LearnerRevision,
        path_rows: tuple[dict[str, object], ...],
    ) -> MasteryReview:
        del context
        return MasteryReview(
            concepts=tuple(
                ReviewConcept(
                    concept_id=row["concept_id"],
                    name=str(row["name"]),
                    state=str(row["state"]),
                    access_state="ready",
                    coverage_state=str(row["coverage_state"]),
                    due_at=None,
                    mismatch=None,
                )
                for row in path_rows
            ),
            recent_routes=(),
        )


class MemoryRoutingService:
    def __init__(self, fixture: LearningFixture) -> None:
        self.fixture = fixture
        self.submission = None

    async def learner_path(self, learner_id: UUID, course_id: UUID) -> LearnerPath:
        assert learner_id == self.fixture.learner_id
        assert course_id == self.fixture.course_id
        return self.fixture.path

    async def list_policies(
        self,
        course_id: UUID,
    ) -> dict[UUID | None, RoutingPolicy]:
        assert course_id == self.fixture.course_id
        return {
            None: RoutingPolicy(
                confidence_threshold=4,
                correct_attempts_for_mastery=2,
            )
        }

    async def submit_attempt(self, submission: object) -> RouteDecision:
        self.submission = submission
        return RouteDecision(
            action=RouteAction.COMPLETE,
            mastery_state=MasteryState.MASTERED,
            why="Reviewed evidence completed this path.",
            route_event_id=uuid4(),
        )


class MemoryAssessmentService:
    async def grade_answer(
        self,
        question_id: UUID,
        learner_answer: str,
    ) -> AnswerGrade:
        del question_id, learner_answer
        return AnswerGrade(
            is_correct=True,
            feedback="Reviewed feedback.",
            wrong_answer_pattern=None,
        )


def _path_item(
    concept_id: UUID,
    clip_id: UUID,
    question_id: UUID,
    *,
    actionable: bool = True,
    eligible: bool = True,
    current: bool = False,
    state: MasteryState = MasteryState.NOT_STARTED,
) -> LearnerPathItem:
    return LearnerPathItem(
        concept_id=concept_id,
        name=f"Concept {str(concept_id)[:4]}",
        description="Reviewed concept",
        sequence_rank=1,
        state=state,
        topic_id=uuid4(),
        topic_title="Reviewed topic",
        prerequisite_ids=(),
        clip_ids=(clip_id,) if actionable else (),
        question_ids=(question_id,) if actionable else (),
        aids=(),
        eligible=eligible,
        actionable=actionable,
        coverage_state="complete" if actionable else "missing_both",
        current=current,
    )
