from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_routing_service
from app.routing.models import AdvancementMode, AttemptSubmission, RouteDecision, RoutingPolicy
from app.routing.service import RoutingService, RoutingValidationError

router = APIRouter(tags=["routing"])
RoutingServiceDependency = Annotated[RoutingService, Depends(get_routing_service)]


class AttemptRequest(BaseModel):
    answer: dict[str, object]
    correctness: bool
    confidence: int = Field(ge=1, le=4)
    wrong_answer_pattern: str | None = None


class RouteDecisionResponse(BaseModel):
    action: str
    mastery_state: str
    why: str
    target_concept_id: UUID | None
    target_clip_id: UUID | None
    dashboard_signal_id: UUID | None


class RoutingPolicyRequest(BaseModel):
    confidence_threshold: int = Field(ge=1, le=4)
    correct_attempts_for_mastery: int = Field(ge=1)
    advancement_mode: AdvancementMode
    max_remediation_attempts: int = Field(ge=0)


class RoutingPolicyResponse(BaseModel):
    concept_id: UUID | None
    confidence_threshold: int
    correct_attempts_for_mastery: int
    advancement_mode: str
    max_remediation_attempts: int


class DemoLearnerResponse(BaseModel):
    learner_id: UUID


class LearnerConceptProgressResponse(BaseModel):
    concept_id: UUID
    name: str
    state: str
    topic_id: UUID | None


@router.post(
    "/learners/{learner_id}/questions/{question_id}/attempt",
    response_model=RouteDecisionResponse,
)
async def submit_attempt(
    learner_id: UUID,
    question_id: UUID,
    request: AttemptRequest,
    service: RoutingServiceDependency,
) -> RouteDecisionResponse:
    try:
        decision = await service.submit_attempt(
            AttemptSubmission(
                learner_id=learner_id,
                question_id=question_id,
                answer=request.answer,
                correctness=request.correctness,
                confidence=request.confidence,
                wrong_answer_pattern=request.wrong_answer_pattern,
            ),
        )
    except RoutingValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _decision_response(decision)


@router.get(
    "/courses/{course_id}/routing/policies",
    response_model=list[RoutingPolicyResponse],
)
async def list_policies(
    course_id: UUID,
    service: RoutingServiceDependency,
) -> list[RoutingPolicyResponse]:
    policies = await service.list_policies(course_id)
    return [_policy_response(concept_id, policy) for concept_id, policy in policies.items()]


@router.post(
    "/courses/{course_id}/routing/demo-learner",
    response_model=DemoLearnerResponse,
)
async def create_demo_learner(
    course_id: UUID,
    service: RoutingServiceDependency,
) -> DemoLearnerResponse:
    return DemoLearnerResponse(learner_id=await service.create_demo_learner(course_id))


@router.get(
    "/learners/{learner_id}/courses/{course_id}/progress",
    response_model=list[LearnerConceptProgressResponse],
)
async def learner_progress(
    learner_id: UUID,
    course_id: UUID,
    service: RoutingServiceDependency,
) -> list[LearnerConceptProgressResponse]:
    try:
        progress = await service.learner_progress(learner_id, course_id)
    except RoutingValidationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return [
        LearnerConceptProgressResponse(
            concept_id=item.concept_id,
            name=item.name,
            state=item.state.value,
            topic_id=item.topic_id,
        )
        for item in progress
    ]


@router.put(
    "/courses/{course_id}/routing/policies/default",
    response_model=RoutingPolicyResponse,
)
async def upsert_default_policy(
    course_id: UUID,
    request: RoutingPolicyRequest,
    service: RoutingServiceDependency,
) -> RoutingPolicyResponse:
    return await _upsert_policy(course_id, None, request, service)


@router.put(
    "/courses/{course_id}/routing/policies/{concept_id}",
    response_model=RoutingPolicyResponse,
)
async def upsert_concept_policy(
    course_id: UUID,
    concept_id: UUID,
    request: RoutingPolicyRequest,
    service: RoutingServiceDependency,
) -> RoutingPolicyResponse:
    return await _upsert_policy(course_id, concept_id, request, service)


async def _upsert_policy(
    course_id: UUID,
    concept_id: UUID | None,
    request: RoutingPolicyRequest,
    service: RoutingService,
) -> RoutingPolicyResponse:
    try:
        policy = await service.upsert_policy(course_id, concept_id, _policy_from_request(request))
    except RoutingValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _policy_response(concept_id, policy)


def _policy_from_request(request: RoutingPolicyRequest) -> RoutingPolicy:
    return RoutingPolicy(
        confidence_threshold=request.confidence_threshold,
        correct_attempts_for_mastery=request.correct_attempts_for_mastery,
        advancement_mode=request.advancement_mode,
        max_remediation_attempts=request.max_remediation_attempts,
    )


def _policy_response(concept_id: UUID | None, policy: RoutingPolicy) -> RoutingPolicyResponse:
    return RoutingPolicyResponse(
        concept_id=concept_id,
        confidence_threshold=policy.confidence_threshold,
        correct_attempts_for_mastery=policy.correct_attempts_for_mastery,
        advancement_mode=policy.advancement_mode.value,
        max_remediation_attempts=policy.max_remediation_attempts,
    )


def _decision_response(decision: RouteDecision) -> RouteDecisionResponse:
    return RouteDecisionResponse(
        action=decision.action.value,
        mastery_state=decision.mastery_state.value,
        why=decision.why,
        target_concept_id=decision.target_concept_id,
        target_clip_id=decision.target_clip_id,
        dashboard_signal_id=decision.dashboard_signal_id,
    )
