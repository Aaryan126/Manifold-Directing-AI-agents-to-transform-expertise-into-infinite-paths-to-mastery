from uuid import UUID, uuid4

import pytest

from app.dashboard.models import (
    ActivityPoint,
    ClipSignalStats,
    ConceptSignalStats,
    DashboardAction,
    DashboardSignal,
    DashboardSignalProposal,
    DashboardSignalStatus,
    DashboardSignalType,
    LearnerOverride,
    MasteryDistribution,
    QuestionSignalStats,
)
from app.dashboard.repository import DashboardRepository
from app.dashboard.service import DashboardService, not_enough_data


@pytest.mark.anyio
async def test_refresh_surfaces_existing_stuck_loop_signal_without_attempt_data() -> None:
    repository = MemoryDashboardRepository(learner_count=0, attempt_count=0)
    repository.signals.append(repository.make_signal())

    summary = await DashboardService(repository).refresh_dashboard(repository.course_id)

    assert summary.signals[0].type.value == "stuck_cohort"
    assert not not_enough_data(summary)


@pytest.mark.anyio
async def test_refresh_returns_underlying_performance_evidence() -> None:
    repository = MemoryDashboardRepository()
    repository.question_stats_value = (
        QuestionSignalStats(
            question_id=uuid4(),
            topic_id=uuid4(),
            prompt="What is elimination?",
            attempts=5,
            incorrect_attempts=2,
            low_confidence_correct_attempts=1,
        ),
    )
    repository.clip_stats_value = (
        ClipSignalStats(
            clip_id=uuid4(),
            concept_id=repository.concept_id,
            topic_id=uuid4(),
            remediation_attempts=2,
            struggling_learners=1,
        ),
    )

    summary = await DashboardService(repository).refresh_dashboard(repository.course_id)

    assert summary.concept_stats == repository.concept_stats_value
    assert summary.question_stats == repository.question_stats_value
    assert summary.clip_stats == repository.clip_stats_value
    assert summary.activity_history == repository.activity_history_value
    assert summary.mastery_distribution == repository.mastery_distribution_value


@pytest.mark.anyio
async def test_accept_signal_mutates_underlying_entity_and_records_scope() -> None:
    repository = MemoryDashboardRepository()
    service = DashboardService(repository)
    summary = await service.refresh_dashboard(repository.course_id)

    signal = await service.accept_signal(
        summary.signals[0].id,
        DashboardAction(
            action="accept_ai_suggestion",
            note="Raise remediation cap.",
            retroactive=False,
        ),
    )

    assert signal is not None
    assert signal.status is DashboardSignalStatus.ACCEPTED
    assert signal.instructor_action
    assert signal.instructor_action["applied_scope"] == "going_forward"
    assert repository.mutations == [("accepted", summary.signals[0].related_entity_id)]


@pytest.mark.anyio
async def test_dismiss_signal_does_not_mutate_underlying_entity() -> None:
    repository = MemoryDashboardRepository()
    service = DashboardService(repository)
    summary = await service.refresh_dashboard(repository.course_id)

    signal = await service.dismiss_signal(
        summary.signals[0].id,
        DashboardAction(action="dismiss", note="Not useful."),
    )

    assert signal is not None
    assert signal.status is DashboardSignalStatus.DISMISSED
    assert repository.mutations == []


@pytest.mark.anyio
async def test_dismissal_is_scoped_not_a_permanent_mute() -> None:
    repository = MemoryDashboardRepository()
    service = DashboardService(repository)
    first = await service.refresh_dashboard(repository.course_id)
    await service.dismiss_signal(first.signals[0].id, DashboardAction(action="dismiss"))

    repository.concept_stats_value = (
        ConceptSignalStats(
            concept_id=repository.concept_id,
            concept_name="Elimination",
            touched_learners=8,
            struggling_learners=4,
        ),
    )
    second = await service.refresh_dashboard(repository.course_id)

    assert len(second.signals) == 1
    assert second.signals[0].status is DashboardSignalStatus.OPEN
    assert second.signals[0].id != first.signals[0].id


@pytest.mark.anyio
async def test_manual_override_updates_single_learner_mastery() -> None:
    repository = MemoryDashboardRepository()
    learner_id = uuid4()

    await DashboardService(repository).apply_learner_override(
        LearnerOverride(
            learner_id=learner_id,
            concept_id=repository.concept_id,
            action="skip_ahead",
            note="Instructor override from dashboard.",
        ),
    )

    assert repository.mastery[(learner_id, repository.concept_id)] == "mastered"


class MemoryDashboardRepository(DashboardRepository):
    def __init__(self, learner_count: int = 3, attempt_count: int = 5) -> None:
        self.course_id = uuid4()
        self.concept_id = uuid4()
        self.learner_count_value = learner_count
        self.attempt_count_value = attempt_count
        self.concept_stats_value = (
            ConceptSignalStats(
                concept_id=self.concept_id,
                concept_name="Elimination",
                touched_learners=5,
                struggling_learners=3,
            ),
        )
        self.question_stats_value: tuple[QuestionSignalStats, ...] = ()
        self.clip_stats_value: tuple[ClipSignalStats, ...] = ()
        self.activity_history_value = (
            ActivityPoint(date="2026-07-20", attempts=attempt_count, active_learners=learner_count),
        )
        self.mastery_distribution_value = MasteryDistribution(
            mastered=1,
            practiced=1,
            struggling=1,
            not_started=2,
        )
        self.signals: list[DashboardSignal] = []
        self.mutations: list[tuple[str, UUID]] = []
        self.mastery: dict[tuple[UUID, UUID], str] = {}

    async def learner_count(self, course_id: UUID) -> int:
        assert course_id == self.course_id
        return self.learner_count_value

    async def attempt_count(self, course_id: UUID) -> int:
        assert course_id == self.course_id
        return self.attempt_count_value

    async def concept_stats(self, course_id: UUID) -> tuple[ConceptSignalStats, ...]:
        assert course_id == self.course_id
        return self.concept_stats_value

    async def question_stats(self, course_id: UUID) -> tuple[QuestionSignalStats, ...]:
        assert course_id == self.course_id
        return self.question_stats_value

    async def clip_stats(self, course_id: UUID) -> tuple[ClipSignalStats, ...]:
        assert course_id == self.course_id
        return self.clip_stats_value

    async def activity_history(self, course_id: UUID) -> tuple[ActivityPoint, ...]:
        assert course_id == self.course_id
        return self.activity_history_value

    async def mastery_distribution(self, course_id: UUID) -> MasteryDistribution:
        assert course_id == self.course_id
        return self.mastery_distribution_value

    async def open_signals(self, course_id: UUID) -> tuple[DashboardSignal, ...]:
        assert course_id == self.course_id
        return tuple(
            signal for signal in self.signals if signal.status is DashboardSignalStatus.OPEN
        )

    async def upsert_signal(
        self,
        course_id: UUID,
        proposal: DashboardSignalProposal,
    ) -> DashboardSignal:
        assert course_id == self.course_id
        existing = next(
            (
                signal
                for signal in self.signals
                if signal.status is DashboardSignalStatus.OPEN
                and signal.ai_diagnosis.get("fingerprint") == proposal.fingerprint
            ),
            None,
        )
        if existing:
            return existing
        signal = self.make_signal(
            related_entity_id=proposal.related_entity_id,
            fingerprint=proposal.fingerprint,
            title=proposal.title,
        )
        self.signals.append(signal)
        return signal

    async def accept_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        return self._resolve(signal_id, DashboardSignalStatus.ACCEPTED, action, mutate=True)

    async def edit_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        return self._resolve(signal_id, DashboardSignalStatus.EDITED, action, mutate=True)

    async def dismiss_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        return self._resolve(signal_id, DashboardSignalStatus.DISMISSED, action, mutate=False)

    async def apply_learner_override(self, override: LearnerOverride) -> None:
        self.mastery[(override.learner_id, override.concept_id)] = (
            "mastered" if override.action == "skip_ahead" else "struggling"
        )

    async def course_id_for_concept(self, concept_id: UUID) -> UUID | None:
        return self.course_id if concept_id == self.concept_id else None

    def make_signal(
        self,
        related_entity_id: UUID | None = None,
        fingerprint: str = "stuck:seed:3",
        title: str = "Learners are stuck",
    ) -> DashboardSignal:
        return DashboardSignal(
            id=uuid4(),
            course_id=self.course_id,
            type=DashboardSignalType.STUCK_COHORT,
            related_entity_type="concept",
            related_entity_id=related_entity_id or self.concept_id,
            status=DashboardSignalStatus.OPEN,
            ai_diagnosis={"fingerprint": fingerprint, "title": title},
            instructor_action=None,
        )

    def _resolve(
        self,
        signal_id: UUID,
        status: DashboardSignalStatus,
        action: DashboardAction,
        *,
        mutate: bool,
    ) -> DashboardSignal | None:
        for index, signal in enumerate(self.signals):
            if signal.id == signal_id:
                if mutate:
                    self.mutations.append((status.value, signal.related_entity_id))
                resolved = DashboardSignal(
                    id=signal.id,
                    course_id=signal.course_id,
                    type=signal.type,
                    related_entity_type=signal.related_entity_type,
                    related_entity_id=signal.related_entity_id,
                    status=status,
                    ai_diagnosis=signal.ai_diagnosis,
                    instructor_action={
                        "action": action.action,
                        "note": action.note,
                        "retroactive": action.retroactive,
                        "applied_scope": (
                            "retroactive_reprocess" if action.retroactive else "going_forward"
                        ),
                    },
                )
                self.signals[index] = resolved
                return resolved
        return None
