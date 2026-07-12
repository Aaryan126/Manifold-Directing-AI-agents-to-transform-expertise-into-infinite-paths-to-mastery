from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.audit.models import AuditEvent
from app.audit.service import AuditService
from app.dependencies import get_audit_service

router = APIRouter(tags=["audit"])
AuditServiceDependency = Annotated[AuditService, Depends(get_audit_service)]


class AuditEventResponse(BaseModel):
    id: UUID
    course_id: UUID
    actor_type: str
    actor_id: UUID | None
    artifact_type: str
    artifact_id: UUID
    action: str
    source: str
    previous_state: dict[str, object] | None
    new_state: dict[str, object] | None
    ai_rationale: str | None
    instructor_note: str | None
    dashboard_signal_id: UUID | None
    scope: str
    created_at: str


@router.get(
    "/audit/{artifact_type}/{artifact_id}",
    response_model=list[AuditEventResponse],
)
async def artifact_audit_events(
    artifact_type: str,
    artifact_id: UUID,
    service: AuditServiceDependency,
) -> list[AuditEventResponse]:
    return [
        _event_response(event)
        for event in await service.list_for_artifact(artifact_type, artifact_id)
    ]


@router.get(
    "/courses/{course_id}/audit",
    response_model=list[AuditEventResponse],
)
async def course_audit_events(
    course_id: UUID,
    service: AuditServiceDependency,
) -> list[AuditEventResponse]:
    return [_event_response(event) for event in await service.list_for_course(course_id)]


def _event_response(event: AuditEvent) -> AuditEventResponse:
    return AuditEventResponse(
        id=event.id,
        course_id=event.course_id,
        actor_type=event.actor_type,
        actor_id=event.actor_id,
        artifact_type=event.artifact_type,
        artifact_id=event.artifact_id,
        action=event.action,
        source=event.source,
        previous_state=event.previous_state,
        new_state=event.new_state,
        ai_rationale=event.ai_rationale,
        instructor_note=event.instructor_note,
        dashboard_signal_id=event.dashboard_signal_id,
        scope=event.scope,
        created_at=event.created_at,
    )
