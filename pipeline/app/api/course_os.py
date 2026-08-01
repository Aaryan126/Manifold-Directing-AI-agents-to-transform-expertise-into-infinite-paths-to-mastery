import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.course_os.models import (
    AssessmentDraft,
    AssessmentRuleDraft,
    AssessmentWorkspace,
    ConversationMessage,
    CourseAssessment,
    CourseBlueprint,
    CourseCreate,
    CourseDecisionTrace,
    CourseFlow,
    CourseFlowModuleDraft,
    CourseFlowUnitDraft,
    CourseMap,
    CourseProposal,
    CourseRoutingPolicy,
    CourseSummary,
    DashboardCommandResult,
    DashboardSnapshot,
    GenerationRun,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionDiff,
    RoutingPolicyDraft,
    RoutingWorkspace,
)
from app.course_os.service import CourseOSService, CourseOSValidationError
from app.dependencies import get_course_os_service

router = APIRouter(tags=["course-os"])
CourseOSDependency = Annotated[CourseOSService, Depends(get_course_os_service)]
UserContext = Annotated[UUID, Header(alias="X-User-ID")]


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"
    )


class CourseCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    brief: dict[str, Any] = Field(default_factory=dict)


class CourseSummaryResponse(BaseModel):
    id: UUID
    instructor_id: UUID
    title: str
    description: str | None
    status: str
    active_revision_id: UUID | None
    working_revision_id: UUID | None
    revision_status: str | None
    generation_run_id: UUID | None
    generation_status: str | None
    generation_phase: str | None
    generation_progress: float
    source_count: int
    topic_count: int
    concept_count: int
    pending_review_count: int
    open_signal_count: int
    updated_at: datetime
    competition_demo: bool = False


class AttentionItemResponse(BaseModel):
    id: str
    course_id: UUID
    kind: str
    title: str
    detail: str
    urgency: str


class DashboardActivityPointResponse(BaseModel):
    date: str
    active_learners: int


class CourseRadarItemResponse(BaseModel):
    course_id: UUID
    title: str
    activity_trend: list[int]
    active_learners: int
    accuracy_percent: float | None
    confidence_percent: float | None
    confident_incorrect_attempts: int
    clip_completion_percent: float | None
    mastery_percent: float | None
    mastery_movement: int
    open_issues: int
    agent_status: str
    agent_role: str | None


class DashboardResponse(BaseModel):
    courses: list[CourseSummaryResponse]
    attention: list[AttentionItemResponse]
    total_courses: int
    published_courses: int
    courses_in_review: int
    active_learners: int
    new_learners: int
    activity_history: list[DashboardActivityPointResponse]
    activity_is_simulated: bool
    course_radar: list[CourseRadarItemResponse]


class DashboardCommandRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class DashboardEvidenceReferenceResponse(BaseModel):
    id: str
    label: str
    value: str
    metric: str
    course_id: UUID | None
    course_title: str | None


class DashboardCommandResponse(BaseModel):
    kind: Literal["evidence", "proposal", "empty"]
    message: str
    course_id: UUID | None
    course_title: str | None
    action_label: str | None
    evidence: list[DashboardEvidenceReferenceResponse]
    searched_course_count: int


class GenerationStartRequest(BaseModel):
    video_id: UUID
    ingestion_job_id: UUID


class GenerationTaskResponse(BaseModel):
    id: UUID
    task_type: str
    scope_key: str
    status: str
    attempts: int
    max_attempts: int
    output: dict[str, Any] | None
    error_message: str | None


class GenerationRunResponse(BaseModel):
    id: UUID
    course_id: UUID
    revision_id: UUID
    status: str
    phase: str
    progress: float
    error_summary: str | None
    created_at: datetime
    updated_at: datetime
    tasks: list[GenerationTaskResponse]


class MessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class BlueprintRelationshipRequest(BaseModel):
    relationship: Literal[
        "contains",
        "requires",
        "teaches",
        "assesses",
        "remediates_to",
        "cites",
    ]
    source_logical_id: UUID
    target_logical_id: UUID


class BlueprintRelationshipReconnectRequest(BaseModel):
    previous: BlueprintRelationshipRequest
    replacement: BlueprintRelationshipRequest


class MessageResponse(BaseModel):
    id: UUID
    role: str
    content: str
    blocks: list[dict[str, Any]]
    created_at: datetime


class ProposalResponse(BaseModel):
    id: UUID
    proposal_type: str
    artifact_type: str | None
    logical_artifact_id: UUID | None
    before_state: dict[str, Any] | None
    proposed_state: dict[str, Any]
    rationale: str
    status: str
    created_at: datetime


class MessageCreatedResponse(BaseModel):
    message: MessageResponse
    proposal: ProposalResponse | None


class ReviewDecisionRequest(BaseModel):
    decision: Literal["accepted", "edited", "dismissed"]
    instructor_revision: dict[str, Any] | None = None


class ReviewBundleDecisionRequest(BaseModel):
    decision: Literal["accepted", "dismissed"] = "accepted"


class ReviewItemResponse(BaseModel):
    id: UUID
    artifact_type: str
    artifact_id: UUID
    logical_artifact_id: UUID
    status: str
    risk_level: str
    evidence: dict[str, Any]


class ReviewBundleResponse(BaseModel):
    id: UUID
    kind: str
    title: str
    summary: str
    status: str
    items: list[ReviewItemResponse]


class MapNodeResponse(BaseModel):
    id: UUID
    logical_id: UUID
    kind: str
    title: str
    status: str
    topic_id: UUID | None
    metadata: dict[str, Any]


class MapEdgeResponse(BaseModel):
    id: UUID
    logical_id: UUID
    source_id: UUID
    target_id: UUID
    kind: str
    status: str


class RevisionChangeResponse(BaseModel):
    artifact_type: str
    logical_artifact_id: UUID
    change_type: Literal["added", "changed", "removed"]
    before_state: dict[str, Any] | None
    after_state: dict[str, Any] | None


class RevisionDiffResponse(BaseModel):
    active_revision_id: UUID | None
    working_revision_id: UUID
    changes: list[RevisionChangeResponse]


class CourseMapResponse(BaseModel):
    course_id: UUID
    revision_id: UUID
    nodes: list[MapNodeResponse]
    edges: list[MapEdgeResponse]


class BlueprintNodeResponse(BaseModel):
    id: UUID
    logical_id: UUID
    kind: str
    title: str
    status: str
    parent_id: UUID | None
    metadata: dict[str, Any]


class BlueprintEdgeResponse(BaseModel):
    id: str
    source_id: UUID
    target_id: UUID
    kind: str
    status: str


class CourseBlueprintResponse(BaseModel):
    course_id: UUID
    revision_id: UUID
    revision_kind: str
    nodes: list[BlueprintNodeResponse]
    edges: list[BlueprintEdgeResponse]
    uncovered_concept_ids: list[UUID]


class DecisionTraceStageResponse(BaseModel):
    key: str
    title: str
    summary: str
    status: Literal["available", "missing"]
    artifact_type: str | None
    artifact_id: UUID | None
    logical_artifact_id: UUID | None
    metadata: dict[str, Any]


class CourseDecisionTraceResponse(BaseModel):
    course_id: UUID
    revision_id: UUID
    revision_kind: Literal["active", "working"]
    concept_id: UUID
    concept_logical_id: UUID
    concept_title: str
    complete: bool
    stages: list[DecisionTraceStageResponse]


class CourseFlowModuleResponse(BaseModel):
    id: UUID
    logical_id: UUID
    title: str
    summary: str
    sequence_rank: int
    status: str
    x: float | None
    y: float | None


class CourseFlowUnitResponse(BaseModel):
    id: UUID
    logical_id: UUID
    module_logical_id: UUID | None
    kind: Literal["lecture", "quiz", "assignment"]
    title: str
    summary: str
    instructions: str
    video_id: UUID | None
    sequence_rank: int
    status: str
    topic_count: int
    concept_count: int
    question_count: int
    source_count: int
    concept_logical_ids: list[UUID]
    x: float | None
    y: float | None


class CourseFlowEdgeResponse(BaseModel):
    id: UUID
    logical_id: UUID
    source_unit_logical_id: UUID
    target_unit_logical_id: UUID
    relationship: Literal["next", "requires", "assesses"]
    status: str


class CourseFlowResponse(BaseModel):
    course_id: UUID
    revision_id: UUID
    revision_kind: Literal["active", "working"]
    modules: list[CourseFlowModuleResponse]
    units: list[CourseFlowUnitResponse]
    edges: list[CourseFlowEdgeResponse]


class CourseFlowUnitRequest(BaseModel):
    kind: Literal["lecture", "quiz", "assignment"]
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(default="", max_length=4000)
    instructions: str = Field(default="", max_length=12000)
    module_logical_id: UUID | None = None
    concept_logical_ids: list[UUID] = Field(default_factory=list)


class CourseFlowModuleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(default="", max_length=4000)


class CourseFlowLayoutRequest(BaseModel):
    x: float
    y: float


class CourseFlowEdgeRequest(BaseModel):
    relationship: Literal["next", "requires", "assesses"]
    source_unit_logical_id: UUID
    target_unit_logical_id: UUID


class CourseFlowReviewRequest(BaseModel):
    artifact_kind: Literal["unit", "relationship"]
    logical_artifact_id: UUID
    decision: Literal["accepted", "edited", "dismissed"]


class BlueprintConceptEvidenceResponse(BaseModel):
    concept_id: UUID
    attempts: int
    touched_learners: int
    correct_percent: float | None
    confident_percent: float | None
    confident_incorrect: int
    mastery: dict[str, int]
    route_actions: dict[str, int]


class ConceptSequenceRequest(BaseModel):
    concept_ids: list[UUID] = Field(min_length=1)


class BlueprintPrerequisiteRequest(BaseModel):
    from_concept_id: UUID
    to_concept_id: UUID


class BlueprintTopicDraftRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(default="", max_length=4000)
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)


class BlueprintConceptDraftRequest(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)
    topic_logical_ids: list[UUID] = Field(min_length=1)
    sequence_after_id: UUID | None = None


class BlueprintConceptUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)


class BlueprintConceptTopicsRequest(BaseModel):
    topic_logical_ids: list[UUID] = Field(min_length=1)


class BlueprintMutationImpactResponse(BaseModel):
    artifact_kind: str
    logical_artifact_id: UUID
    title: str
    affected_topics: list[str]
    affected_concepts: list[str]
    affected_clips: list[str]
    affected_questions: list[str]
    affected_relationships: int
    learner_records_preserved: bool
    warnings: list[str]


class AssessmentRuleRequest(BaseModel):
    wrong_answer_pattern: str = Field(min_length=1, max_length=500)
    target_clip_id: UUID | None = None
    target_concept_id: UUID | None = None


class AssessmentDraftRequest(BaseModel):
    topic_id: UUID
    primary_concept_id: UUID | None = None
    concept_ids: list[UUID] = Field(default_factory=list)
    body: str = Field(min_length=1, max_length=4000)
    type: Literal["mcq", "short_answer", "worked_problem"]
    correct_answer: dict[str, Any]
    confidence_prompt: str = Field(min_length=1, max_length=1000)
    remediation_rules: list[AssessmentRuleRequest] = Field(min_length=1)


class CourseAssessmentResponse(BaseModel):
    id: UUID
    logical_id: UUID
    topic_id: UUID
    topic_title: str
    body: str
    type: str
    correct_answer: dict[str, Any]
    confidence_prompt: str
    review_status: str
    remediation_rules: list[dict[str, Any]]
    primary_concept_id: UUID | None
    concept_ids: list[UUID]


class AssessmentTopicOptionResponse(BaseModel):
    id: UUID
    title: str


class AssessmentConceptOptionResponse(BaseModel):
    id: UUID
    name: str
    topic_ids: list[UUID]


class AssessmentClipOptionResponse(BaseModel):
    id: UUID
    topic_id: UUID
    topic_title: str
    video_id: UUID
    label: str
    start_seconds: float
    end_seconds: float
    type: str
    difficulty: str | None
    status: str
    playback_provider: str
    playback_id: str | None
    playback_url: str
    delivery_asset_id: str | None
    materialization_status: str


class AssessmentWorkspaceResponse(BaseModel):
    revision_id: UUID
    is_working_revision: bool
    topics: list[AssessmentTopicOptionResponse]
    concepts: list[AssessmentConceptOptionResponse]
    clips: list[AssessmentClipOptionResponse]
    questions: list[CourseAssessmentResponse]


class RoutingPolicyRequest(BaseModel):
    confidence_threshold: int = Field(ge=1, le=4)
    correct_attempts_for_mastery: int = Field(ge=1, le=20)
    advancement_mode: Literal["require_mastery", "allow_partial_understanding"]
    max_remediation_attempts: int = Field(ge=0, le=20)


class CourseRoutingPolicyResponse(BaseModel):
    id: UUID | None
    concept_id: UUID | None
    concept_name: str | None
    policy: RoutingPolicyRequest


class RoutingWorkspaceResponse(BaseModel):
    revision_id: UUID
    is_working_revision: bool
    concepts: list[AssessmentConceptOptionResponse]
    policies: list[CourseRoutingPolicyResponse]


@router.get("/instructors/me/dashboard", response_model=DashboardResponse)
async def dashboard(user_id: UserContext, service: CourseOSDependency) -> DashboardResponse:
    return _dashboard_response(await _call(service.dashboard(user_id)))


@router.post(
    "/instructors/me/dashboard/command",
    response_model=DashboardCommandResponse,
)
async def dashboard_command(
    request: DashboardCommandRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> DashboardCommandResponse:
    result = await _call(service.dashboard_command(user_id, request.content))
    return _dashboard_command_response(result)


@router.get("/instructors/me/courses", response_model=list[CourseSummaryResponse])
async def list_courses(
    user_id: UserContext,
    service: CourseOSDependency,
) -> list[CourseSummaryResponse]:
    courses = await _call(service.list_courses(user_id))
    return [_course_response(course) for course in courses]


@router.post("/courses", response_model=CourseSummaryResponse, status_code=201)
async def create_course(
    request: CourseCreateRequest,
    user_id: UserContext,
    service: CourseOSDependency,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CourseSummaryResponse:
    brief = dict(request.brief)
    brief.pop("creation_request_id", None)
    if idempotency_key is not None:
        normalized_key = idempotency_key.strip()
        if not normalized_key or len(normalized_key) > 200:
            raise HTTPException(status_code=400, detail="Invalid Idempotency-Key header.")
        brief["creation_request_id"] = normalized_key
    course = await _call(
        service.create_course(
            user_id,
            CourseCreate(
                title=request.title,
                description=request.description,
                brief=brief,
            ),
        )
    )
    return _course_response(course)


@router.get("/courses/{course_id}/studio", response_model=CourseSummaryResponse)
async def course_studio(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseSummaryResponse:
    return _course_response(await _call(service.course(course_id, user_id)))


@router.delete("/courses/{course_id}", status_code=204)
async def delete_course(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> Response:
    await _call(service.delete_course(course_id, user_id))
    return Response(status_code=204)


@router.post(
    "/courses/{course_id}/working-revision",
    response_model=CourseSummaryResponse,
    status_code=201,
)
async def open_working_revision(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseSummaryResponse:
    course = await _call(service.open_working_revision(course_id, user_id))
    return _course_response(course)


@router.post(
    "/courses/{course_id}/publish-revision",
    response_model=CourseSummaryResponse,
)
async def publish_working_revision(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseSummaryResponse:
    course = await _call(service.publish_working_revision(course_id, user_id))
    return _course_response(course)


@router.post(
    "/courses/{course_id}/generation-runs",
    response_model=GenerationRunResponse,
    status_code=202,
)
async def start_generation(
    course_id: UUID,
    request: GenerationStartRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> GenerationRunResponse:
    run = await _call(
        service.start_generation(
            course_id,
            user_id,
            request.video_id,
            request.ingestion_job_id,
        )
    )
    return _run_response(run)


@router.get(
    "/courses/{course_id}/generation-runs/{run_id}",
    response_model=GenerationRunResponse,
)
async def generation_run(
    course_id: UUID,
    run_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> GenerationRunResponse:
    return _run_response(await _call(service.generation_run(course_id, run_id, user_id)))


@router.post(
    "/courses/{course_id}/generation-runs/{run_id}/retry",
    response_model=GenerationRunResponse,
)
async def retry_generation(
    course_id: UUID,
    run_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> GenerationRunResponse:
    return _run_response(await _call(service.retry_generation(course_id, run_id, user_id)))


@router.post(
    "/courses/{course_id}/generation-runs/{run_id}/cancel",
    response_model=GenerationRunResponse,
)
async def cancel_generation(
    course_id: UUID,
    run_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> GenerationRunResponse:
    return _run_response(await _call(service.cancel_generation(course_id, run_id, user_id)))


@router.get("/courses/{course_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> list[MessageResponse]:
    messages = await _call(service.messages(course_id, user_id))
    return [_message_response(message) for message in messages]


@router.post(
    "/courses/{course_id}/messages",
    response_model=MessageCreatedResponse,
    status_code=201,
)
async def send_message(
    course_id: UUID,
    request: MessageRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> MessageCreatedResponse:
    message, proposal = await _call(service.send_message(course_id, user_id, request.content))
    return MessageCreatedResponse(
        message=_message_response(message),
        proposal=_proposal_response(proposal) if proposal else None,
    )


@router.post("/courses/{course_id}/messages/stream")
async def stream_message(
    course_id: UUID,
    request: MessageRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        task = asyncio.create_task(
            _call(service.send_message(course_id, user_id, request.content))
        )
        statuses = (
            "Reading the course structure…",
            "Tracing the relevant evidence…",
            "Preparing a private response…",
        )
        status_index = 0
        yield _sse_event("status", {"message": statuses[status_index]})
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=0.8)
            if done:
                break
            status_index = min(status_index + 1, len(statuses) - 1)
            yield _sse_event("status", {"message": statuses[status_index]})
        try:
            message, proposal = await task
        except HTTPException as exc:
            yield _sse_event("error", {"message": str(exc.detail)})
            return
        except Exception:
            yield _sse_event(
                "error",
                {"message": "Course Director could not complete that request."},
            )
            return
        response = MessageCreatedResponse(
            message=_message_response(message),
            proposal=_proposal_response(proposal) if proposal else None,
        )
        words = response.message.content.split(" ")
        for index, word in enumerate(words):
            yield _sse_event(
                "delta",
                {"content": f"{'' if index == 0 else ' '}{word}"},
            )
            await asyncio.sleep(0.012)
        yield _sse_event("done", response.model_dump(mode="json"))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/courses/{course_id}/proposals/{proposal_id}/resolve",
    response_model=ProposalResponse,
)
async def resolve_proposal(
    course_id: UUID,
    proposal_id: UUID,
    request: ReviewDecisionRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> ProposalResponse:
    proposal = await _call(
        service.resolve_proposal(
            course_id,
            proposal_id,
            user_id,
            ReviewDecision(request.decision),
            request.instructor_revision,
        )
    )
    return _proposal_response(proposal)

@router.post(
    "/courses/{course_id}/proposals/{proposal_id}/undo",
    response_model=ProposalResponse,
)
async def undo_proposal(
    course_id: UUID,
    proposal_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> ProposalResponse:
    proposal = await _call(
        service.undo_proposal(course_id, proposal_id, user_id)
    )
    return _proposal_response(proposal)


@router.get("/courses/{course_id}/map", response_model=CourseMapResponse)
async def course_map(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseMapResponse:
    return _map_response(await _call(service.course_map(course_id, user_id)))


@router.get("/courses/{course_id}/blueprint", response_model=CourseBlueprintResponse)
async def course_blueprint(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
    revision: Literal["active", "working"] = "active",
) -> CourseBlueprintResponse:
    return _blueprint_response(await _call(service.blueprint(course_id, user_id, revision)))


@router.get(
    "/courses/{course_id}/decision-trace",
    response_model=CourseDecisionTraceResponse,
)
async def course_decision_trace(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
    revision: Literal["active", "working"] = "active",
    concept_id: UUID | None = None,
) -> CourseDecisionTraceResponse:
    return _decision_trace_response(
        await _call(
            service.decision_trace(course_id, user_id, revision, concept_id)
        )
    )


@router.get("/courses/{course_id}/course-flow", response_model=CourseFlowResponse)
async def course_flow(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
    revision: Literal["active", "working"] = "active",
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(service.course_flow(course_id, user_id, revision))
    )


@router.post(
    "/courses/{course_id}/course-flow/modules",
    response_model=CourseFlowResponse,
    status_code=201,
)
async def create_course_flow_module(
    course_id: UUID,
    request: CourseFlowModuleRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.create_course_flow_module(
                course_id,
                user_id,
                CourseFlowModuleDraft(title=request.title, summary=request.summary),
            )
        )
    )


@router.put(
    "/courses/{course_id}/course-flow/layout/{logical_artifact_id}",
    response_model=CourseFlowResponse,
)
async def save_course_flow_layout(
    course_id: UUID,
    logical_artifact_id: UUID,
    request: CourseFlowLayoutRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.save_course_flow_layout(
                course_id,
                user_id,
                logical_artifact_id,
                request.x,
                request.y,
            )
        )
    )


@router.post(
    "/courses/{course_id}/course-flow/units",
    response_model=CourseFlowResponse,
    status_code=201,
)
async def create_course_flow_unit(
    course_id: UUID,
    request: CourseFlowUnitRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.create_course_flow_unit(
                course_id,
                user_id,
                _course_flow_unit_draft(request),
            )
        )
    )


@router.patch(
    "/courses/{course_id}/course-flow/units/{unit_logical_id}",
    response_model=CourseFlowResponse,
)
async def update_course_flow_unit(
    course_id: UUID,
    unit_logical_id: UUID,
    request: CourseFlowUnitRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.update_course_flow_unit(
                course_id,
                user_id,
                unit_logical_id,
                _course_flow_unit_draft(request),
            )
        )
    )


@router.delete(
    "/courses/{course_id}/course-flow/units/{unit_logical_id}",
    response_model=CourseFlowResponse,
)
async def remove_course_flow_unit(
    course_id: UUID,
    unit_logical_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.remove_course_flow_unit(course_id, user_id, unit_logical_id)
        )
    )


@router.post(
    "/courses/{course_id}/course-flow/relationships",
    response_model=CourseFlowResponse,
    status_code=201,
)
async def create_course_flow_relationship(
    course_id: UUID,
    request: CourseFlowEdgeRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.mutate_course_flow_edge(
                course_id,
                user_id,
                "create",
                request.relationship,
                request.source_unit_logical_id,
                request.target_unit_logical_id,
            )
        )
    )


@router.delete(
    "/courses/{course_id}/course-flow/relationships",
    response_model=CourseFlowResponse,
)
async def remove_course_flow_relationship(
    course_id: UUID,
    request: CourseFlowEdgeRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.mutate_course_flow_edge(
                course_id,
                user_id,
                "delete",
                request.relationship,
                request.source_unit_logical_id,
                request.target_unit_logical_id,
            )
        )
    )


@router.post(
    "/courses/{course_id}/course-flow/review",
    response_model=CourseFlowResponse,
)
async def review_course_flow_artifact(
    course_id: UUID,
    request: CourseFlowReviewRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseFlowResponse:
    return _course_flow_response(
        await _call(
            service.review_course_flow_artifact(
                course_id,
                user_id,
                request.artifact_kind,
                request.logical_artifact_id,
                ReviewDecision(request.decision),
            )
        )
    )


@router.get(
    "/courses/{course_id}/blueprint/evidence",
    response_model=list[BlueprintConceptEvidenceResponse],
)
async def course_blueprint_evidence(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
    revision: Literal["active", "working"] = "active",
    days: int = 14,
    learner_id: UUID | None = None,
) -> list[BlueprintConceptEvidenceResponse]:
    evidence = await _call(
        service.blueprint_evidence(
            course_id,
            user_id,
            revision,
            days,
            learner_id,
        )
    )
    return [BlueprintConceptEvidenceResponse(**item.__dict__) for item in evidence]


@router.put(
    "/courses/{course_id}/blueprint/sequence",
    response_model=CourseBlueprintResponse,
)
async def update_blueprint_sequence(
    course_id: UUID,
    request: ConceptSequenceRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.update_concept_sequence(
                course_id,
                user_id,
                tuple(request.concept_ids),
            )
        )
    )


@router.post(
    "/courses/{course_id}/blueprint/prerequisites",
    response_model=CourseBlueprintResponse,
    status_code=201,
)
async def add_blueprint_prerequisite(
    course_id: UUID,
    request: BlueprintPrerequisiteRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.add_blueprint_prerequisite(
                course_id,
                user_id,
                request.from_concept_id,
                request.to_concept_id,
            )
        )
    )


@router.delete(
    "/courses/{course_id}/blueprint/prerequisites/{edge_id}",
    response_model=CourseBlueprintResponse,
)
async def remove_blueprint_prerequisite(
    course_id: UUID,
    edge_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(service.remove_blueprint_prerequisite(course_id, user_id, edge_id))
    )


@router.post(
    "/courses/{course_id}/blueprint/relationships",
    response_model=CourseBlueprintResponse,
    status_code=201,
)
async def create_blueprint_relationship(
    course_id: UUID,
    request: BlueprintRelationshipRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.create_blueprint_relationship(
                course_id,
                user_id,
                request.relationship,
                request.source_logical_id,
                request.target_logical_id,
            )
        )
    )


@router.delete(
    "/courses/{course_id}/blueprint/relationships",
    response_model=CourseBlueprintResponse,
)
async def remove_blueprint_relationship(
    course_id: UUID,
    request: BlueprintRelationshipRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.remove_blueprint_relationship(
                course_id,
                user_id,
                request.relationship,
                request.source_logical_id,
                request.target_logical_id,
            )
        )
    )


@router.patch(
    "/courses/{course_id}/blueprint/relationships",
    response_model=CourseBlueprintResponse,
)
async def reconnect_blueprint_relationship(
    course_id: UUID,
    request: BlueprintRelationshipReconnectRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.reconnect_blueprint_relationship(
                course_id,
                user_id,
                request.previous.relationship,
                request.previous.source_logical_id,
                request.previous.target_logical_id,
                request.replacement.relationship,
                request.replacement.source_logical_id,
                request.replacement.target_logical_id,
            )
        )
    )


@router.post(
    "/courses/{course_id}/blueprint/topics",
    response_model=CourseBlueprintResponse,
    status_code=201,
)
async def create_blueprint_topic(
    course_id: UUID,
    request: BlueprintTopicDraftRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.create_blueprint_topic(
                course_id,
                user_id,
                request.title,
                request.summary,
                request.start_seconds,
                request.end_seconds,
            )
        )
    )


@router.patch(
    "/courses/{course_id}/blueprint/topics/{topic_id}",
    response_model=CourseBlueprintResponse,
)
async def update_blueprint_topic(
    course_id: UUID,
    topic_id: UUID,
    request: BlueprintTopicDraftRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.update_blueprint_topic(
                course_id,
                user_id,
                topic_id,
                request.title,
                request.summary,
                request.start_seconds,
                request.end_seconds,
            )
        )
    )


@router.post(
    "/courses/{course_id}/blueprint/concepts",
    response_model=CourseBlueprintResponse,
    status_code=201,
)
async def create_blueprint_concept(
    course_id: UUID,
    request: BlueprintConceptDraftRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.create_blueprint_concept(
                course_id,
                user_id,
                request.name,
                request.description,
                tuple(request.topic_logical_ids),
                request.sequence_after_id,
            )
        )
    )


@router.patch(
    "/courses/{course_id}/blueprint/concepts/{concept_id}",
    response_model=CourseBlueprintResponse,
)
async def update_blueprint_concept(
    course_id: UUID,
    concept_id: UUID,
    request: BlueprintConceptUpdateRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.update_blueprint_concept(
                course_id,
                user_id,
                concept_id,
                request.name,
                request.description,
            )
        )
    )


@router.put(
    "/courses/{course_id}/blueprint/concepts/{concept_id}/topics",
    response_model=CourseBlueprintResponse,
)
async def update_blueprint_concept_topics(
    course_id: UUID,
    concept_id: UUID,
    request: BlueprintConceptTopicsRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.update_blueprint_concept_topics(
                course_id,
                user_id,
                concept_id,
                tuple(request.topic_logical_ids),
            )
        )
    )


@router.get(
    "/courses/{course_id}/blueprint/artifacts/{artifact_kind}/{artifact_id}/impact",
    response_model=BlueprintMutationImpactResponse,
)
async def blueprint_mutation_impact(
    course_id: UUID,
    artifact_kind: str,
    artifact_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> BlueprintMutationImpactResponse:
    impact = await _call(
        service.blueprint_mutation_impact(
            course_id,
            user_id,
            artifact_kind,
            artifact_id,
        )
    )
    return BlueprintMutationImpactResponse(
        artifact_kind=impact.artifact_kind,
        logical_artifact_id=impact.logical_artifact_id,
        title=impact.title,
        affected_topics=list(impact.affected_topics),
        affected_concepts=list(impact.affected_concepts),
        affected_clips=list(impact.affected_clips),
        affected_questions=list(impact.affected_questions),
        affected_relationships=impact.affected_relationships,
        learner_records_preserved=impact.learner_records_preserved,
        warnings=list(impact.warnings),
    )


@router.delete(
    "/courses/{course_id}/blueprint/artifacts/{artifact_kind}/{artifact_id}",
    response_model=CourseBlueprintResponse,
)
async def remove_blueprint_artifact(
    course_id: UUID,
    artifact_kind: str,
    artifact_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseBlueprintResponse:
    return _blueprint_response(
        await _call(
            service.remove_blueprint_artifact(
                course_id,
                user_id,
                artifact_kind,
                artifact_id,
            )
        )
    )


@router.get(
    "/courses/{course_id}/assessment-workspace",
    response_model=AssessmentWorkspaceResponse,
)
async def assessment_workspace(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> AssessmentWorkspaceResponse:
    return _assessment_workspace_response(
        await _call(service.assessment_workspace(course_id, user_id))
    )


@router.post(
    "/courses/{course_id}/assessments",
    response_model=CourseAssessmentResponse,
    status_code=201,
)
async def create_assessment(
    course_id: UUID,
    request: AssessmentDraftRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseAssessmentResponse:
    return _assessment_response(
        await _call(service.create_assessment(course_id, user_id, _assessment_draft(request)))
    )


@router.put(
    "/courses/{course_id}/assessments/{question_id}",
    response_model=CourseAssessmentResponse,
)
async def update_assessment(
    course_id: UUID,
    question_id: UUID,
    request: AssessmentDraftRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseAssessmentResponse:
    return _assessment_response(
        await _call(
            service.update_assessment(
                course_id,
                question_id,
                user_id,
                _assessment_draft(request),
            )
        )
    )


@router.delete(
    "/courses/{course_id}/assessments/{question_id}",
    response_model=CourseAssessmentResponse,
)
async def dismiss_assessment(
    course_id: UUID,
    question_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseAssessmentResponse:
    return _assessment_response(
        await _call(service.dismiss_assessment(course_id, question_id, user_id))
    )


@router.get(
    "/courses/{course_id}/routing-workspace",
    response_model=RoutingWorkspaceResponse,
)
async def routing_workspace(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> RoutingWorkspaceResponse:
    return _routing_workspace_response(await _call(service.routing_workspace(course_id, user_id)))


@router.put(
    "/courses/{course_id}/routing-workspace/default",
    response_model=CourseRoutingPolicyResponse,
)
async def update_default_routing_policy(
    course_id: UUID,
    request: RoutingPolicyRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseRoutingPolicyResponse:
    return _routing_policy_response(
        await _call(
            service.upsert_routing_policy(
                course_id,
                None,
                user_id,
                _routing_policy_draft(request),
            )
        )
    )


@router.put(
    "/courses/{course_id}/routing-workspace/{concept_id}",
    response_model=CourseRoutingPolicyResponse,
)
async def update_concept_routing_policy(
    course_id: UUID,
    concept_id: UUID,
    request: RoutingPolicyRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseRoutingPolicyResponse:
    return _routing_policy_response(
        await _call(
            service.upsert_routing_policy(
                course_id,
                concept_id,
                user_id,
                _routing_policy_draft(request),
            )
        )
    )


@router.delete(
    "/courses/{course_id}/routing-workspace/{concept_id}",
    status_code=204,
)
async def delete_concept_routing_policy(
    course_id: UUID,
    concept_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> Response:
    await _call(service.delete_routing_policy(course_id, concept_id, user_id))
    return Response(status_code=204)


@router.get("/courses/{course_id}/revision-diff", response_model=RevisionDiffResponse)
async def revision_diff(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> RevisionDiffResponse:
    return _revision_diff_response(await _call(service.revision_diff(course_id, user_id)))


@router.get("/courses/{course_id}/review-bundles", response_model=list[ReviewBundleResponse])
async def review_bundles(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> list[ReviewBundleResponse]:
    bundles = await _call(service.review_bundles(course_id, user_id))
    return [_bundle_response(bundle) for bundle in bundles]


@router.post(
    "/courses/{course_id}/review-items/{item_id}/resolve",
    response_model=ReviewItemResponse,
)
async def resolve_review_item(
    course_id: UUID,
    item_id: UUID,
    request: ReviewDecisionRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> ReviewItemResponse:
    item = await _call(
        service.resolve_review_item(
            course_id,
            item_id,
            user_id,
            ReviewDecision(request.decision),
            request.instructor_revision,
        )
    )
    return _review_item_response(item)


@router.post(
    "/courses/{course_id}/review-bundles/{bundle_id}/resolve-remaining",
    response_model=ReviewBundleResponse,
)
async def resolve_review_bundle_remaining(
    course_id: UUID,
    bundle_id: UUID,
    request: ReviewBundleDecisionRequest,
    user_id: UserContext,
    service: CourseOSDependency,
) -> ReviewBundleResponse:
    bundle = await _call(
        service.resolve_review_bundle_remaining(
            course_id,
            bundle_id,
            user_id,
            ReviewDecision(request.decision),
        )
    )
    return _bundle_response(bundle)


async def _call(awaitable: Any) -> Any:
    try:
        return await awaitable
    except CourseOSValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _course_response(course: CourseSummary) -> CourseSummaryResponse:
    return CourseSummaryResponse(**course.__dict__)


def _dashboard_response(snapshot: DashboardSnapshot) -> DashboardResponse:
    return DashboardResponse(
        courses=[_course_response(course) for course in snapshot.courses],
        attention=[AttentionItemResponse(**item.__dict__) for item in snapshot.attention],
        total_courses=snapshot.total_courses,
        published_courses=snapshot.published_courses,
        courses_in_review=snapshot.courses_in_review,
        active_learners=snapshot.active_learners,
        new_learners=snapshot.new_learners,
        activity_history=[
            DashboardActivityPointResponse(
                date=point.date,
                active_learners=point.active_learners,
            )
            for point in snapshot.activity_history
        ],
        activity_is_simulated=snapshot.activity_is_simulated,
        course_radar=[
            CourseRadarItemResponse(
                **{
                    **item.__dict__,
                    "activity_trend": list(item.activity_trend),
                }
            )
            for item in snapshot.course_radar
        ],
    )


def _dashboard_command_response(result: DashboardCommandResult) -> DashboardCommandResponse:
    return DashboardCommandResponse(
        kind=result.kind,
        message=result.message,
        course_id=result.course_id,
        course_title=result.course_title,
        action_label=result.action_label,
        evidence=[DashboardEvidenceReferenceResponse(**item.__dict__) for item in result.evidence],
        searched_course_count=result.searched_course_count,
    )


def _run_response(run: GenerationRun) -> GenerationRunResponse:
    return GenerationRunResponse(
        id=run.id,
        course_id=run.course_id,
        revision_id=run.revision_id,
        status=run.status.value,
        phase=run.phase,
        progress=run.progress,
        error_summary=run.error_summary,
        created_at=run.created_at,
        updated_at=run.updated_at,
        tasks=[
            GenerationTaskResponse(
                id=task.id,
                task_type=task.task_type,
                scope_key=task.scope_key,
                status=task.status.value,
                attempts=task.attempts,
                max_attempts=task.max_attempts,
                output=task.output,
                error_message=task.error_message,
            )
            for task in run.tasks
        ],
    )


def _message_response(message: ConversationMessage) -> MessageResponse:
    return MessageResponse(
        id=message.id,
        role=message.role,
        content=message.content,
        blocks=list(message.blocks),
        created_at=message.created_at,
    )


def _proposal_response(proposal: CourseProposal) -> ProposalResponse:
    return ProposalResponse(**proposal.__dict__)


def _review_item_response(item: ReviewItem) -> ReviewItemResponse:
    return ReviewItemResponse(**item.__dict__)


def _bundle_response(bundle: ReviewBundle) -> ReviewBundleResponse:
    return ReviewBundleResponse(
        id=bundle.id,
        kind=bundle.kind,
        title=bundle.title,
        summary=bundle.summary,
        status=bundle.status,
        items=[_review_item_response(item) for item in bundle.items],
    )


def _map_response(course_map: CourseMap) -> CourseMapResponse:
    return CourseMapResponse(
        course_id=course_map.course_id,
        revision_id=course_map.revision_id,
        nodes=[MapNodeResponse(**node.__dict__) for node in course_map.nodes],
        edges=[MapEdgeResponse(**edge.__dict__) for edge in course_map.edges],
    )


def _blueprint_response(blueprint: CourseBlueprint) -> CourseBlueprintResponse:
    return CourseBlueprintResponse(
        course_id=blueprint.course_id,
        revision_id=blueprint.revision_id,
        revision_kind=blueprint.revision_kind,
        nodes=[BlueprintNodeResponse(**node.__dict__) for node in blueprint.nodes],
        edges=[BlueprintEdgeResponse(**edge.__dict__) for edge in blueprint.edges],
        uncovered_concept_ids=list(blueprint.uncovered_concept_ids),
    )


def _decision_trace_response(trace: CourseDecisionTrace) -> CourseDecisionTraceResponse:
    return CourseDecisionTraceResponse(
        course_id=trace.course_id,
        revision_id=trace.revision_id,
        revision_kind=trace.revision_kind,
        concept_id=trace.concept_id,
        concept_logical_id=trace.concept_logical_id,
        concept_title=trace.concept_title,
        complete=trace.complete,
        stages=[DecisionTraceStageResponse(**stage.__dict__) for stage in trace.stages],
    )


def _course_flow_response(course_flow: CourseFlow) -> CourseFlowResponse:
    return CourseFlowResponse(
        course_id=course_flow.course_id,
        revision_id=course_flow.revision_id,
        revision_kind=course_flow.revision_kind,
        modules=[CourseFlowModuleResponse(**module.__dict__) for module in course_flow.modules],
        units=[CourseFlowUnitResponse(**unit.__dict__) for unit in course_flow.units],
        edges=[CourseFlowEdgeResponse(**edge.__dict__) for edge in course_flow.edges],
    )


def _course_flow_unit_draft(request: CourseFlowUnitRequest) -> CourseFlowUnitDraft:
    return CourseFlowUnitDraft(
        kind=request.kind,
        title=request.title,
        summary=request.summary,
        instructions=request.instructions,
        module_logical_id=request.module_logical_id,
        concept_logical_ids=tuple(request.concept_logical_ids),
    )


def _assessment_draft(request: AssessmentDraftRequest) -> AssessmentDraft:
    return AssessmentDraft(
        topic_id=request.topic_id,
        body=request.body,
        type=request.type,
        correct_answer=request.correct_answer,
        confidence_prompt=request.confidence_prompt,
        primary_concept_id=request.primary_concept_id,
        concept_ids=tuple(request.concept_ids),
        remediation_rules=tuple(
            AssessmentRuleDraft(
                wrong_answer_pattern=rule.wrong_answer_pattern,
                target_clip_id=rule.target_clip_id,
                target_concept_id=rule.target_concept_id,
            )
            for rule in request.remediation_rules
        ),
    )


def _assessment_response(question: CourseAssessment) -> CourseAssessmentResponse:
    return CourseAssessmentResponse(
        **{
            **question.__dict__,
            "remediation_rules": list(question.remediation_rules),
            "concept_ids": list(question.concept_ids),
        }
    )


def _assessment_workspace_response(
    workspace: AssessmentWorkspace,
) -> AssessmentWorkspaceResponse:
    return AssessmentWorkspaceResponse(
        revision_id=workspace.revision_id,
        is_working_revision=workspace.is_working_revision,
        topics=[AssessmentTopicOptionResponse(**topic.__dict__) for topic in workspace.topics],
        concepts=[
            AssessmentConceptOptionResponse(
                id=concept.id,
                name=concept.name,
                topic_ids=list(concept.topic_ids),
            )
            for concept in workspace.concepts
        ],
        clips=[AssessmentClipOptionResponse(**clip.__dict__) for clip in workspace.clips],
        questions=[_assessment_response(question) for question in workspace.questions],
    )


def _routing_policy_draft(request: RoutingPolicyRequest) -> RoutingPolicyDraft:
    return RoutingPolicyDraft(**request.model_dump())


def _routing_policy_response(
    policy: CourseRoutingPolicy,
) -> CourseRoutingPolicyResponse:
    return CourseRoutingPolicyResponse(
        id=policy.id,
        concept_id=policy.concept_id,
        concept_name=policy.concept_name,
        policy=RoutingPolicyRequest(**policy.policy.__dict__),
    )


def _routing_workspace_response(workspace: RoutingWorkspace) -> RoutingWorkspaceResponse:
    return RoutingWorkspaceResponse(
        revision_id=workspace.revision_id,
        is_working_revision=workspace.is_working_revision,
        concepts=[
            AssessmentConceptOptionResponse(
                id=concept.id,
                name=concept.name,
                topic_ids=list(concept.topic_ids),
            )
            for concept in workspace.concepts
        ],
        policies=[_routing_policy_response(policy) for policy in workspace.policies],
    )


def _revision_diff_response(diff: RevisionDiff) -> RevisionDiffResponse:
    return RevisionDiffResponse(
        active_revision_id=diff.active_revision_id,
        working_revision_id=diff.working_revision_id,
        changes=[RevisionChangeResponse(**change.__dict__) for change in diff.changes],
    )
