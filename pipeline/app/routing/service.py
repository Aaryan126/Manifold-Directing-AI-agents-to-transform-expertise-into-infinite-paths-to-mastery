from uuid import UUID

from app.access.service import AccessService
from app.routing.models import (
    AttemptSubmission,
    LearnerConceptProgress,
    RouteAction,
    RouteDecision,
    RoutingPolicy,
)
from app.routing.policy import apply_next_target, evaluate_attempt
from app.routing.repository import RoutingRepository


class RoutingValidationError(ValueError):
    pass


class RoutingService:
    def __init__(
        self,
        repository: RoutingRepository,
        access_service: AccessService | None = None,
    ) -> None:
        self._repository = repository
        self._access_service = access_service

    async def submit_attempt(self, submission: AttemptSubmission) -> RouteDecision:
        context = await self._repository.get_attempt_context(
            submission.learner_id,
            submission.question_id,
        )
        if context is None:
            raise RoutingValidationError("Approved question routing context not found.")
        if self._access_service is not None and not await self._access_service.is_enrolled(
            context.course_id,
            submission.learner_id,
        ):
            raise RoutingValidationError("Learner is not enrolled in this published course.")

        evaluation = evaluate_attempt(submission, context)
        await self._repository.record_attempt_and_update_mastery(
            submission,
            evaluation.mastery,
        )

        decision = evaluation.decision
        if evaluation.needs_instructor_signal:
            signal_id = await self._repository.create_stuck_signal(context, decision)
            return RouteDecision(
                action=decision.action,
                mastery_state=decision.mastery_state,
                why=decision.why,
                target_concept_id=decision.target_concept_id,
                target_clip_id=decision.target_clip_id,
                dashboard_signal_id=signal_id,
            )

        next_concept_id = None
        if decision.action == RouteAction.ADVANCE:
            mastered = context.mastered_concept_ids | {evaluation.mastery.concept_id}
            next_concepts = await self._repository.eligible_next_concepts(
                context.course_id,
                mastered,
            )
            next_concept_id = next_concepts[0].id if next_concepts else None

        resolved_clip_id = None
        if decision.action in {RouteAction.REINFORCE, RouteAction.REMEDIATE}:
            target_concept_id = decision.target_concept_id or context.current_concept_id
            clip = await self._repository.resolve_active_clip(
                target_concept_id,
                context.topic_id,
                decision.target_clip_id,
            )
            resolved_clip_id = clip.id if clip else None

        return apply_next_target(
            decision,
            next_concept_id=next_concept_id,
            resolved_clip_id=resolved_clip_id,
        )

    async def list_policies(self, course_id: UUID) -> dict[UUID | None, RoutingPolicy]:
        return await self._repository.list_policies(course_id)

    async def upsert_policy(
        self,
        course_id: UUID,
        concept_id: UUID | None,
        policy: RoutingPolicy,
    ) -> RoutingPolicy:
        validate_policy(policy)
        return await self._repository.upsert_policy(course_id, concept_id, policy)

    async def create_demo_learner(self, course_id: UUID) -> UUID:
        return await self._repository.create_demo_learner(course_id)

    async def learner_progress(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> tuple[LearnerConceptProgress, ...]:
        if self._access_service is not None and not await self._access_service.is_enrolled(
            course_id,
            learner_id,
        ):
            raise RoutingValidationError("Learner is not enrolled in this published course.")
        return await self._repository.learner_progress(learner_id, course_id)


def validate_policy(policy: RoutingPolicy) -> None:
    if policy.confidence_threshold < 1 or policy.confidence_threshold > 4:
        raise RoutingValidationError("Confidence threshold must be between 1 and 4.")
    if policy.correct_attempts_for_mastery < 1:
        raise RoutingValidationError("Correct attempts for mastery must be at least 1.")
    if policy.max_remediation_attempts < 0:
        raise RoutingValidationError("Max remediation attempts must be non-negative.")
