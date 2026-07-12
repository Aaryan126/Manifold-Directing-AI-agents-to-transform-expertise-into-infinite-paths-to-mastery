from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class AuditEventCreate:
    course_id: UUID
    artifact_type: str
    artifact_id: UUID
    action: str
    source: str
    previous_state: dict[str, object] | None = None
    new_state: dict[str, object] | None = None
    ai_rationale: str | None = None
    instructor_note: str | None = None
    dashboard_signal_id: UUID | None = None
    scope: str = "artifact"
    actor_type: str = "system"
    actor_id: UUID | None = None


@dataclass(frozen=True)
class AuditEvent:
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
