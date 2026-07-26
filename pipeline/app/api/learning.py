from datetime import datetime
from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.dependencies import get_learning_service
from app.learning.models import (
    ClipTranscript,
    HelpRequest,
    MasteryReview,
    Orientation,
    PlacementCheck,
    StudySession,
)
from app.learning.service import LearningService, LearningValidationError

router = APIRouter(tags=["learning"])
LearningServiceDependency = Annotated[LearningService, Depends(get_learning_service)]
UserContext = Annotated[UUID, Header(alias="X-User-ID")]


class OrientationRequest(BaseModel):
    entry_choice: str


class SessionRequest(BaseModel):
    mode: str = "continue_path"
    idempotency_key: str = Field(min_length=1, max_length=200)
    concept_id: UUID | None = None


class PlanUpdateRequest(BaseModel):
    mode: str | None = None
    concept_id: UUID | None = None


class AnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=10000)
    confidence: int = Field(ge=1, le=4)


class ReflectionRequest(BaseModel):
    self_report: str
    note: str | None = Field(default=None, max_length=1000)
    concept_id: UUID | None = None


class PlacementRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=200)


class HelpRequestBody(BaseModel):
    session_id: UUID | None = None
    concept_id: UUID | None = None
    learner_note: str | None = Field(default=None, max_length=1000)


class HelpStatusRequest(BaseModel):
    status: str


class HintLadderEditRequest(BaseModel):
    hints: list[str] = Field(min_length=1, max_length=8)


class HintLadderResponse(BaseModel):
    id: UUID
    question_id: UUID
    hints: list[str]
    review_status: str
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None


class OrientationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    completed: bool
    entry_choice: str | None


class LearningModeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    title: str
    description: str
    available: bool
    recommended: bool
    reason: str | None
    disabled_reason: str | None


class SessionStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    ordinal: int
    kind: str
    purpose: str
    concept_id: UUID | None
    concept_name: str | None
    clip_id: UUID | None
    question_id: UUID | None
    source_id: UUID | None
    title: str
    reason_code: str
    reason: str
    status: str


class StudySessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course_id: UUID
    revision_id: UUID
    status: str
    mode: str
    finish_requested: bool
    plan_version: int
    steps: list[SessionStepResponse]


class PlacementItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    ordinal: int
    concept_id: UUID
    concept_name: str
    question_id: UUID
    question_body: str
    choices: list[str]
    confidence_prompt: str
    status: str
    outcome: str | None


class PlacementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: str
    unavailable_reason: str | None
    items: list[PlacementItemResponse]


class ReviewConceptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    concept_id: UUID
    name: str
    state: str
    access_state: str
    coverage_state: str
    due_at: datetime | None
    mismatch: str | None


class RouteHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    action: str
    explanation: str
    created_at: datetime


class MasteryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    concepts: list[ReviewConceptResponse]
    recent_routes: list[RouteHistoryResponse]


class TranscriptWordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    text: str
    start_seconds: float
    end_seconds: float


class TranscriptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    clip_id: UUID
    duration_seconds: float
    timing_basis: str
    words: list[TranscriptWordResponse]


class HelpResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: str
    learner_note: str | None
    evidence: dict[str, object]
    created_at: datetime


class WorkspaceResponse(BaseModel):
    revision_id: UUID
    orientation: OrientationResponse
    modes: list[LearningModeResponse]
    session: StudySessionResponse | None
    placement: PlacementResponse | None
    mastery: MasteryResponse
    guide_actions: list[str]
    content_message: str | None


class AnswerResponse(BaseModel):
    session: StudySessionResponse
    correct: bool
    feedback: str
    route: dict[str, object]


class HintResponse(BaseModel):
    hint: str


def _raise(exc: LearningValidationError) -> NoReturn:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/learn/courses/{course_id}/workspace", response_model=WorkspaceResponse)
async def workspace(
    course_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> WorkspaceResponse:
    try:
        value = await service.workspace(user_id, course_id)
    except LearningValidationError as exc:
        _raise(exc)
    return WorkspaceResponse.model_validate(value)


@router.put("/learn/courses/{course_id}/orientation", response_model=OrientationResponse)
async def complete_orientation(
    course_id: UUID,
    request: OrientationRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> Orientation:
    try:
        return await service.complete_orientation(
            user_id,
            course_id,
            entry_choice=request.entry_choice,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post("/learn/courses/{course_id}/sessions", response_model=StudySessionResponse)
async def create_session(
    course_id: UUID,
    request: SessionRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> StudySession:
    try:
        return await service.create_session(
            user_id,
            course_id,
            mode=request.mode,
            idempotency_key=request.idempotency_key,
            concept_id=request.concept_id,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/learn/courses/{course_id}/sessions/{session_id}/start",
    response_model=StudySessionResponse,
)
async def start_session(
    course_id: UUID,
    session_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> StudySession:
    try:
        return await service.start_session(user_id, course_id, session_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.put(
    "/learn/courses/{course_id}/sessions/{session_id}/plan",
    response_model=StudySessionResponse,
)
async def adjust_session(
    course_id: UUID,
    session_id: UUID,
    request: PlanUpdateRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> StudySession:
    try:
        return await service.adjust_session(
            user_id,
            course_id,
            session_id,
            mode=request.mode,
            concept_id=request.concept_id,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/learn/courses/{course_id}/sessions/{session_id}/finish",
    response_model=StudySessionResponse,
)
async def finish_session(
    course_id: UUID,
    session_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> StudySession:
    try:
        return await service.finish_session(user_id, course_id, session_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/learn/courses/{course_id}/sessions/{session_id}/steps/{step_id}/watch",
    response_model=StudySessionResponse,
)
async def complete_watch(
    course_id: UUID,
    session_id: UUID,
    step_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> StudySession:
    try:
        return await service.complete_watch(user_id, course_id, session_id, step_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/learn/courses/{course_id}/sessions/{session_id}/steps/{step_id}/answer",
    response_model=AnswerResponse,
)
async def answer_step(
    course_id: UUID,
    session_id: UUID,
    step_id: UUID,
    request: AnswerRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> AnswerResponse:
    try:
        session, decision, correct, feedback = await service.answer_step(
            user_id,
            course_id,
            session_id,
            step_id,
            answer=request.answer,
            confidence=request.confidence,
        )
    except LearningValidationError as exc:
        _raise(exc)
    return AnswerResponse(
        session=StudySessionResponse.model_validate(session),
        correct=correct,
        feedback=feedback,
        route={
            "action": decision.action.value,
            "mastery_state": decision.mastery_state.value,
            "why": decision.why,
            "target_concept_id": decision.target_concept_id,
            "target_clip_id": decision.target_clip_id,
        },
    )


@router.post(
    "/learn/courses/{course_id}/sessions/{session_id}/reflection",
    response_model=StudySessionResponse,
)
async def reflect(
    course_id: UUID,
    session_id: UUID,
    request: ReflectionRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> StudySession:
    try:
        return await service.reflect(
            user_id,
            course_id,
            session_id,
            self_report=request.self_report,
            note=request.note,
            concept_id=request.concept_id,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post("/learn/courses/{course_id}/placement", response_model=PlacementResponse)
async def create_placement(
    course_id: UUID,
    request: PlacementRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> PlacementCheck:
    try:
        return await service.create_placement(
            user_id,
            course_id,
            idempotency_key=request.idempotency_key,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/learn/courses/{course_id}/placement/{check_id}/items/{item_id}/answer",
    response_model=PlacementResponse,
)
async def answer_placement(
    course_id: UUID,
    check_id: UUID,
    item_id: UUID,
    request: AnswerRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> PlacementCheck:
    try:
        return await service.answer_placement(
            user_id,
            course_id,
            check_id,
            item_id,
            answer=request.answer,
            confidence=request.confidence,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.get(
    "/learn/courses/{course_id}/clips/{clip_id}/transcript",
    response_model=TranscriptResponse,
)
async def transcript(
    course_id: UUID,
    clip_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> ClipTranscript:
    try:
        return await service.transcript(user_id, course_id, clip_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/learn/courses/{course_id}/sessions/{session_id}/steps/{step_id}/hint",
    response_model=HintResponse,
)
async def next_hint(
    course_id: UUID,
    session_id: UUID,
    step_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> HintResponse:
    try:
        return HintResponse(
            hint=await service.next_hint(user_id, course_id, session_id, step_id),
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.get("/learn/courses/{course_id}/mastery", response_model=MasteryResponse)
async def mastery(
    course_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> MasteryReview:
    try:
        return await service.mastery(user_id, course_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.post("/learn/courses/{course_id}/help/preview")
async def help_preview(
    course_id: UUID,
    request: HelpRequestBody,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> dict[str, object]:
    try:
        return await service.help_preview(
            user_id,
            course_id,
            session_id=request.session_id,
            concept_id=request.concept_id,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post("/learn/courses/{course_id}/help", response_model=HelpResponse)
async def create_help(
    course_id: UUID,
    request: HelpRequestBody,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> HelpRequest:
    try:
        return await service.create_help_request(
            user_id,
            course_id,
            session_id=request.session_id,
            concept_id=request.concept_id,
            learner_note=request.learner_note,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post("/learn/courses/{course_id}/guide/{action}")
async def guide_action(
    course_id: UUID,
    action: str,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> dict[str, object]:
    try:
        return await service.guide_action(user_id, course_id, action)
    except LearningValidationError as exc:
        _raise(exc)


@router.get(
    "/courses/{course_id}/learner-help",
    response_model=list[HelpResponse],
)
async def instructor_help(
    course_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> tuple[HelpRequest, ...]:
    try:
        return await service.instructor_help_requests(user_id, course_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.patch(
    "/courses/{course_id}/learner-help/{request_id}",
    response_model=HelpResponse,
)
async def update_instructor_help(
    course_id: UUID,
    request_id: UUID,
    request: HelpStatusRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> HelpRequest:
    try:
        return await service.update_help_request(
            user_id,
            course_id,
            request_id,
            request.status,
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.get(
    "/questions/{question_id}/hint-ladder",
    response_model=HintLadderResponse,
)
async def instructor_hint_ladder(
    question_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> dict[str, object]:
    try:
        return await service.instructor_hint_ladder(user_id, question_id)
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/questions/{question_id}/hint-ladder/accept",
    response_model=HintLadderResponse,
)
async def accept_hint_ladder(
    question_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> dict[str, object]:
    try:
        return await service.review_hint_ladder(
            user_id,
            question_id,
            action="accept",
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.patch(
    "/questions/{question_id}/hint-ladder",
    response_model=HintLadderResponse,
)
async def edit_hint_ladder(
    question_id: UUID,
    request: HintLadderEditRequest,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> dict[str, object]:
    try:
        return await service.review_hint_ladder(
            user_id,
            question_id,
            action="edit",
            hints=tuple(request.hints),
        )
    except LearningValidationError as exc:
        _raise(exc)


@router.post(
    "/questions/{question_id}/hint-ladder/dismiss",
    response_model=HintLadderResponse,
)
async def dismiss_hint_ladder(
    question_id: UUID,
    user_id: UserContext,
    service: LearningServiceDependency,
) -> dict[str, object]:
    try:
        return await service.review_hint_ladder(
            user_id,
            question_id,
            action="dismiss",
        )
    except LearningValidationError as exc:
        _raise(exc)
