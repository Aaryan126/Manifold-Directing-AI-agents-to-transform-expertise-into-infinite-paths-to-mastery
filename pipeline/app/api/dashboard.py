from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.dashboard.models import DashboardAction, DashboardSignal, LearnerOverride
from app.dashboard.service import DashboardService, DashboardValidationError, not_enough_data
from app.dependencies import get_dashboard_service

router = APIRouter(tags=["dashboard"])
DashboardServiceDependency = Annotated[DashboardService, Depends(get_dashboard_service)]


class DashboardActionRequest(BaseModel):
    action: str = "accept_ai_suggestion"
    note: str | None = None
    retroactive: bool = False


class LearnerOverrideRequest(BaseModel):
    learner_id: UUID
    concept_id: UUID
    action: str
    note: str | None = None


class DashboardSignalResponse(BaseModel):
    id: UUID
    course_id: UUID
    type: str
    related_entity_type: str
    related_entity_id: UUID
    status: str
    ai_diagnosis: dict[str, object]
    instructor_action: dict[str, object] | None


class ConceptPerformanceResponse(BaseModel):
    concept_id: UUID
    concept_name: str
    touched_learners: int
    struggling_learners: int
    mastered_prerequisite_struggling_learners: int


class QuestionPerformanceResponse(BaseModel):
    question_id: UUID
    topic_id: UUID
    prompt: str
    attempts: int
    incorrect_attempts: int
    low_confidence_correct_attempts: int


class ClipPerformanceResponse(BaseModel):
    clip_id: UUID
    concept_id: UUID
    topic_id: UUID
    remediation_attempts: int
    struggling_learners: int


class DashboardSummaryResponse(BaseModel):
    course_id: UUID
    learner_count: int
    attempt_count: int
    not_enough_data: bool
    signals: list[DashboardSignalResponse]
    concept_performance: list[ConceptPerformanceResponse]
    question_performance: list[QuestionPerformanceResponse]
    clip_performance: list[ClipPerformanceResponse]


class LearnerOverrideResponse(BaseModel):
    ok: bool


@router.get(
    "/courses/{course_id}/dashboard",
    response_model=DashboardSummaryResponse,
)
async def get_dashboard(
    course_id: UUID,
    service: DashboardServiceDependency,
) -> DashboardSummaryResponse:
    summary = await service.refresh_dashboard(course_id)
    return DashboardSummaryResponse(
        course_id=summary.course_id,
        learner_count=summary.learner_count,
        attempt_count=summary.attempt_count,
        not_enough_data=not_enough_data(summary),
        signals=[_signal_response(signal) for signal in summary.signals],
        concept_performance=[
            ConceptPerformanceResponse(
                concept_id=stats.concept_id,
                concept_name=stats.concept_name,
                touched_learners=stats.touched_learners,
                struggling_learners=stats.struggling_learners,
                mastered_prerequisite_struggling_learners=(
                    stats.mastered_prerequisite_struggling_learners
                ),
            )
            for stats in summary.concept_stats
        ],
        question_performance=[
            QuestionPerformanceResponse(
                question_id=stats.question_id,
                topic_id=stats.topic_id,
                prompt=stats.prompt,
                attempts=stats.attempts,
                incorrect_attempts=stats.incorrect_attempts,
                low_confidence_correct_attempts=stats.low_confidence_correct_attempts,
            )
            for stats in summary.question_stats
        ],
        clip_performance=[
            ClipPerformanceResponse(
                clip_id=stats.clip_id,
                concept_id=stats.concept_id,
                topic_id=stats.topic_id,
                remediation_attempts=stats.remediation_attempts,
                struggling_learners=stats.struggling_learners,
            )
            for stats in summary.clip_stats
        ],
    )


@router.post(
    "/dashboard/signals/{signal_id}/accept",
    response_model=DashboardSignalResponse,
)
async def accept_signal(
    signal_id: UUID,
    request: DashboardActionRequest,
    service: DashboardServiceDependency,
) -> DashboardSignalResponse:
    signal = await service.accept_signal(signal_id, _action(request))
    if signal is None:
        raise HTTPException(status_code=404, detail="Dashboard signal not found.")
    return _signal_response(signal)


@router.patch(
    "/dashboard/signals/{signal_id}",
    response_model=DashboardSignalResponse,
)
async def edit_signal(
    signal_id: UUID,
    request: DashboardActionRequest,
    service: DashboardServiceDependency,
) -> DashboardSignalResponse:
    signal = await service.edit_signal(signal_id, _action(request))
    if signal is None:
        raise HTTPException(status_code=404, detail="Dashboard signal not found.")
    return _signal_response(signal)


@router.post(
    "/dashboard/signals/{signal_id}/dismiss",
    response_model=DashboardSignalResponse,
)
async def dismiss_signal(
    signal_id: UUID,
    request: DashboardActionRequest,
    service: DashboardServiceDependency,
) -> DashboardSignalResponse:
    signal = await service.dismiss_signal(signal_id, _action(request))
    if signal is None:
        raise HTTPException(status_code=404, detail="Dashboard signal not found.")
    return _signal_response(signal)


@router.post(
    "/courses/{course_id}/dashboard/learner-override",
    response_model=LearnerOverrideResponse,
)
async def learner_override(
    course_id: UUID,
    request: LearnerOverrideRequest,
    service: DashboardServiceDependency,
) -> LearnerOverrideResponse:
    del course_id
    try:
        await service.apply_learner_override(
            LearnerOverride(
                learner_id=request.learner_id,
                concept_id=request.concept_id,
                action=request.action,
                note=request.note,
            ),
        )
    except DashboardValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return LearnerOverrideResponse(ok=True)


def _action(request: DashboardActionRequest) -> DashboardAction:
    return DashboardAction(
        action=request.action,
        note=request.note,
        retroactive=request.retroactive,
    )


def _signal_response(signal: DashboardSignal) -> DashboardSignalResponse:
    return DashboardSignalResponse(
        id=signal.id,
        course_id=signal.course_id,
        type=signal.type.value,
        related_entity_type=signal.related_entity_type,
        related_entity_id=signal.related_entity_id,
        status=signal.status.value,
        ai_diagnosis=signal.ai_diagnosis,
        instructor_action=signal.instructor_action,
    )
