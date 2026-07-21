from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from app.course_os.models import (
    ConversationMessage,
    CourseCreate,
    CourseMap,
    CourseProposal,
    CourseSummary,
    DashboardSnapshot,
    GenerationRun,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionDiff,
)
from app.course_os.service import CourseOSService, CourseOSValidationError
from app.dependencies import get_course_os_service

router = APIRouter(tags=["course-os"])
CourseOSDependency = Annotated[CourseOSService, Depends(get_course_os_service)]
UserContext = Annotated[UUID, Header(alias="X-User-ID")]


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


class DashboardResponse(BaseModel):
    courses: list[CourseSummaryResponse]
    attention: list[AttentionItemResponse]
    total_courses: int
    published_courses: int
    courses_in_review: int
    active_learners: int
    new_learners: int
    activity_history: list[DashboardActivityPointResponse]


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


@router.get("/instructors/me/dashboard", response_model=DashboardResponse)
async def dashboard(user_id: UserContext, service: CourseOSDependency) -> DashboardResponse:
    return _dashboard_response(await _call(service.dashboard(user_id)))


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
) -> CourseSummaryResponse:
    course = await _call(
        service.create_course(
            user_id,
            CourseCreate(
                title=request.title,
                description=request.description,
                brief=request.brief,
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


@router.get("/courses/{course_id}/map", response_model=CourseMapResponse)
async def course_map(
    course_id: UUID,
    user_id: UserContext,
    service: CourseOSDependency,
) -> CourseMapResponse:
    return _map_response(await _call(service.course_map(course_id, user_id)))


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


def _revision_diff_response(diff: RevisionDiff) -> RevisionDiffResponse:
    return RevisionDiffResponse(
        active_revision_id=diff.active_revision_id,
        working_revision_id=diff.working_revision_id,
        changes=[RevisionChangeResponse(**change.__dict__) for change in diff.changes],
    )
