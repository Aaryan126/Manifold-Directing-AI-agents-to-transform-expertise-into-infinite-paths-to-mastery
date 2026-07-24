from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.dependencies import get_course_intelligence_service
from app.intelligence.models import (
    AgentTask,
    AgentTaskProposal,
    CourseSource,
    SourceCitation,
    SourcePurpose,
    SourceReviewStatus,
    SpecialistRole,
)
from app.intelligence.service import CourseIntelligenceService, IntelligenceValidationError

router = APIRouter(tags=["course-intelligence"])
IntelligenceDependency = Annotated[
    CourseIntelligenceService,
    Depends(get_course_intelligence_service),
]
UserContext = Annotated[UUID, Header(alias="X-User-ID")]


class SourceResponse(BaseModel):
    id: UUID
    logical_id: UUID
    course_id: UUID
    revision_id: UUID
    filename: str
    source_type: str
    mime_type: str
    size_bytes: int
    extraction_status: str
    extraction_error: str | None
    purpose: str
    review_status: str
    learner_visible: bool
    section_count: int
    created_at: datetime
    updated_at: datetime


class SourceUpdateRequest(BaseModel):
    purpose: Literal["ai_context", "learner_resource", "both"]
    review_status: Literal["proposed", "accepted", "edited", "dismissed"] = "edited"
    learner_visible: bool = False


class AgentTaskRequest(BaseModel):
    specialist_role: Literal[
        "learning_analyst",
        "curriculum_architect",
        "clip_editor",
        "assessment_designer",
    ]
    task_type: Literal["investigate", "prepare_improvement", "cleanup_blueprint"]
    target_artifact_type: str | None = None
    target_logical_artifact_id: UUID | None = None
    instruction: str = Field(default="", max_length=8000)
    evidence: dict[str, Any] = Field(default_factory=dict)


class AgentTaskResponse(BaseModel):
    id: UUID
    course_id: UUID
    revision_id: UUID
    specialist_role: str
    task_type: str
    target_artifact_type: str | None
    target_logical_artifact_id: UUID | None
    request_context: dict[str, Any]
    evidence_snapshot: dict[str, Any]
    status: str
    result: dict[str, Any] | None
    proposal_ids: list[UUID]
    attempts: int
    max_attempts: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class AgentTaskProposalResponse(BaseModel):
    id: UUID
    proposal_type: str
    artifact_type: str | None
    logical_artifact_id: UUID | None
    before_state: dict[str, Any] | None
    proposed_state: dict[str, Any]
    rationale: str
    status: str
    citations: list[SourceCitationResponse]


class AgentTaskPackResponse(BaseModel):
    task: AgentTaskResponse
    proposals: list[AgentTaskProposalResponse]


class SourceCitationResponse(BaseModel):
    source_id: UUID
    source_title: str
    section_id: UUID
    page_number: int
    excerpt: str


class MapPositionRequest(BaseModel):
    logical_artifact_id: UUID
    x: float
    y: float


class MapLayoutRequest(BaseModel):
    positions: list[MapPositionRequest] = Field(max_length=500)


@router.get("/courses/{course_id}/sources", response_model=list[SourceResponse])
async def list_sources(
    course_id: UUID,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> list[SourceResponse]:
    return [_source(source) for source in await _call(service.sources(course_id, user_id))]


@router.post("/courses/{course_id}/sources", response_model=SourceResponse, status_code=202)
async def upload_source(
    course_id: UUID,
    user_id: UserContext,
    service: IntelligenceDependency,
    file: Annotated[UploadFile, File()],
    purpose: Annotated[str, Form()] = "ai_context",
) -> SourceResponse:
    try:
        parsed_purpose = SourcePurpose(purpose)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unsupported source purpose.") from exc
    source = await _call(service.upload_source(course_id, user_id, file, parsed_purpose))
    return _source(source)


@router.patch("/courses/{course_id}/sources/{source_id}", response_model=SourceResponse)
async def update_source(
    course_id: UUID,
    source_id: UUID,
    request: SourceUpdateRequest,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> SourceResponse:
    source = await _call(
        service.update_source(
            course_id,
            source_id,
            user_id,
            purpose=SourcePurpose(request.purpose),
            review_status=SourceReviewStatus(request.review_status),
            learner_visible=request.learner_visible,
        )
    )
    return _source(source)


@router.post("/courses/{course_id}/sources/{source_id}/retry", status_code=204)
async def retry_source(
    course_id: UUID,
    source_id: UUID,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> None:
    await _call(service.retry_source(course_id, source_id, user_id))


@router.get("/courses/{course_id}/sources/search", response_model=list[SourceCitationResponse])
async def search_sources(
    course_id: UUID,
    q: str,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> list[SourceCitationResponse]:
    return [_citation(item) for item in await _call(service.search(course_id, user_id, q))]


@router.get("/courses/{course_id}/agent-tasks", response_model=list[AgentTaskResponse])
async def list_agent_tasks(
    course_id: UUID,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> list[AgentTaskResponse]:
    return [_task(task) for task in await _call(service.tasks(course_id, user_id))]


@router.get(
    "/courses/{course_id}/agent-tasks/{task_id}",
    response_model=AgentTaskPackResponse,
)
async def get_agent_task(
    course_id: UUID,
    task_id: UUID,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> AgentTaskPackResponse:
    task, proposals = await _call(service.task(course_id, task_id, user_id))
    return AgentTaskPackResponse(
        task=_task(task),
        proposals=[_task_proposal(proposal) for proposal in proposals],
    )


@router.post(
    "/courses/{course_id}/agent-tasks",
    response_model=AgentTaskResponse,
    status_code=202,
)
async def create_agent_task(
    course_id: UUID,
    request: AgentTaskRequest,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> AgentTaskResponse:
    task = await _call(
        service.request_task(
            course_id,
            user_id,
            specialist_role=SpecialistRole(request.specialist_role),
            task_type=request.task_type,
            target_artifact_type=request.target_artifact_type,
            target_logical_artifact_id=request.target_logical_artifact_id,
            instruction=request.instruction,
            evidence=request.evidence,
        )
    )
    return _task(task)


@router.put("/courses/{course_id}/map/layout", status_code=204)
async def save_map_layout(
    course_id: UUID,
    request: MapLayoutRequest,
    user_id: UserContext,
    service: IntelligenceDependency,
) -> None:
    await _call(
        service.save_map_layout(
            course_id,
            user_id,
            {
                position.logical_artifact_id: (position.x, position.y)
                for position in request.positions
            },
        )
    )


async def _call(awaitable: Any) -> Any:
    try:
        return await awaitable
    except IntelligenceValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _source(source: CourseSource) -> SourceResponse:
    return SourceResponse(
        id=source.id,
        logical_id=source.logical_id,
        course_id=source.course_id,
        revision_id=source.revision_id,
        filename=source.filename,
        source_type=source.source_type,
        mime_type=source.mime_type,
        size_bytes=source.size_bytes,
        extraction_status=source.extraction_status.value,
        extraction_error=source.extraction_error,
        purpose=source.purpose.value,
        review_status=source.review_status.value,
        learner_visible=source.learner_visible,
        section_count=source.section_count,
        created_at=source.created_at,
        updated_at=source.updated_at,
    )


def _task(task: AgentTask) -> AgentTaskResponse:
    return AgentTaskResponse(
        id=task.id,
        course_id=task.course_id,
        revision_id=task.revision_id,
        specialist_role=task.specialist_role.value,
        task_type=task.task_type,
        target_artifact_type=task.target_artifact_type,
        target_logical_artifact_id=task.target_logical_artifact_id,
        request_context=task.request_context,
        evidence_snapshot=task.evidence_snapshot,
        status=task.status.value,
        result=task.result,
        proposal_ids=list(task.proposal_ids),
        attempts=task.attempts,
        max_attempts=task.max_attempts,
        error_message=task.error_message,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _task_proposal(proposal: AgentTaskProposal) -> AgentTaskProposalResponse:
    return AgentTaskProposalResponse(
        id=proposal.id,
        proposal_type=proposal.proposal_type,
        artifact_type=proposal.artifact_type,
        logical_artifact_id=proposal.logical_artifact_id,
        before_state=proposal.before_state,
        proposed_state=proposal.proposed_state,
        rationale=proposal.rationale,
        status=proposal.status,
        citations=[_citation(value) for value in proposal.citations],
    )


def _citation(citation: SourceCitation) -> SourceCitationResponse:
    return SourceCitationResponse(
        source_id=citation.source_id,
        source_title=citation.source_title,
        section_id=citation.section_id,
        page_number=citation.page_number,
        excerpt=citation.excerpt,
    )
