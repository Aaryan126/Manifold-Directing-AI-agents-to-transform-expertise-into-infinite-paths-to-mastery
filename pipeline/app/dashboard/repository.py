from abc import ABC, abstractmethod
from uuid import UUID

from app.dashboard.models import (
    ActivityPoint,
    ClipSignalStats,
    ConceptSignalStats,
    DashboardAction,
    DashboardSignal,
    DashboardSignalProposal,
    LearnerOverride,
    MasteryDistribution,
    QuestionSignalStats,
)


class DashboardRepository(ABC):
    @abstractmethod
    async def learner_count(self, course_id: UUID) -> int:
        raise NotImplementedError

    @abstractmethod
    async def attempt_count(self, course_id: UUID) -> int:
        raise NotImplementedError

    @abstractmethod
    async def concept_stats(self, course_id: UUID) -> tuple[ConceptSignalStats, ...]:
        raise NotImplementedError

    @abstractmethod
    async def question_stats(self, course_id: UUID) -> tuple[QuestionSignalStats, ...]:
        raise NotImplementedError

    @abstractmethod
    async def clip_stats(self, course_id: UUID) -> tuple[ClipSignalStats, ...]:
        raise NotImplementedError

    @abstractmethod
    async def activity_history(self, course_id: UUID) -> tuple[ActivityPoint, ...]:
        raise NotImplementedError

    @abstractmethod
    async def mastery_distribution(self, course_id: UUID) -> MasteryDistribution:
        raise NotImplementedError

    @abstractmethod
    async def open_signals(self, course_id: UUID) -> tuple[DashboardSignal, ...]:
        raise NotImplementedError

    @abstractmethod
    async def upsert_signal(
        self,
        course_id: UUID,
        proposal: DashboardSignalProposal,
    ) -> DashboardSignal:
        raise NotImplementedError

    async def upsert_signals(
        self,
        course_id: UUID,
        proposals: tuple[DashboardSignalProposal, ...],
    ) -> None:
        for proposal in proposals:
            await self.upsert_signal(course_id, proposal)

    @abstractmethod
    async def accept_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        raise NotImplementedError

    @abstractmethod
    async def edit_signal(self, signal_id: UUID, action: DashboardAction) -> DashboardSignal | None:
        raise NotImplementedError

    @abstractmethod
    async def dismiss_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        raise NotImplementedError

    @abstractmethod
    async def apply_learner_override(self, override: LearnerOverride) -> None:
        raise NotImplementedError

    @abstractmethod
    async def course_id_for_concept(self, concept_id: UUID) -> UUID | None:
        raise NotImplementedError
