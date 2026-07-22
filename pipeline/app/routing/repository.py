from abc import ABC, abstractmethod
from uuid import UUID

from app.routing.models import (
    AttemptContext,
    AttemptSubmission,
    LearnerConceptProgress,
    LearnerMastery,
    LearnerPath,
    RouteableClip,
    RouteableConcept,
    RouteDecision,
    RoutingPolicy,
)


class RoutingRepository(ABC):
    @abstractmethod
    async def get_attempt_context(
        self,
        learner_id: UUID,
        question_id: UUID,
    ) -> AttemptContext | None:
        raise NotImplementedError

    @abstractmethod
    async def record_attempt(self, submission: AttemptSubmission) -> UUID:
        raise NotImplementedError

    @abstractmethod
    async def update_mastery(self, learner_id: UUID, mastery: LearnerMastery) -> None:
        raise NotImplementedError

    async def record_attempt_and_update_mastery(
        self,
        submission: AttemptSubmission,
        mastery: LearnerMastery,
    ) -> UUID:
        attempt_id = await self.record_attempt(submission)
        await self.update_mastery(submission.learner_id, mastery)
        return attempt_id

    async def record_attempt_mastery_and_route(
        self,
        context: AttemptContext,
        submission: AttemptSubmission,
        mastery: LearnerMastery,
        decision: RouteDecision,
    ) -> tuple[UUID, UUID | None]:
        del context, decision
        return await self.record_attempt_and_update_mastery(submission, mastery), None

    @abstractmethod
    async def eligible_next_concepts(
        self,
        course_id: UUID,
        mastered_concept_ids: frozenset[UUID],
    ) -> tuple[RouteableConcept, ...]:
        raise NotImplementedError

    @abstractmethod
    async def resolve_active_clip(
        self,
        concept_id: UUID,
        topic_id: UUID,
        preferred_clip_id: UUID | None = None,
    ) -> RouteableClip | None:
        raise NotImplementedError

    @abstractmethod
    async def create_stuck_signal(
        self,
        context: AttemptContext,
        decision: RouteDecision,
    ) -> UUID:
        raise NotImplementedError

    @abstractmethod
    async def list_policies(self, course_id: UUID) -> dict[UUID | None, RoutingPolicy]:
        raise NotImplementedError

    @abstractmethod
    async def upsert_policy(
        self,
        course_id: UUID,
        concept_id: UUID | None,
        policy: RoutingPolicy,
    ) -> RoutingPolicy:
        raise NotImplementedError

    @abstractmethod
    async def create_demo_learner(self, course_id: UUID) -> UUID:
        raise NotImplementedError

    @abstractmethod
    async def learner_progress(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> tuple[LearnerConceptProgress, ...]:
        raise NotImplementedError

    async def learner_path(self, learner_id: UUID, course_id: UUID) -> LearnerPath | None:
        del learner_id, course_id
        return None
