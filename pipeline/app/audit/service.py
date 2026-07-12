from dataclasses import asdict, is_dataclass
from enum import Enum
from uuid import UUID

from app.audit.models import AuditEvent, AuditEventCreate
from app.audit.repository import AuditRepository


class AuditService:
    def __init__(self, repository: AuditRepository) -> None:
        self._repository = repository

    async def record(self, event: AuditEventCreate) -> AuditEvent:
        return await self._repository.record_event(event)

    async def list_for_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID,
    ) -> tuple[AuditEvent, ...]:
        return await self._repository.list_for_artifact(artifact_type, artifact_id)

    async def list_for_course(self, course_id: UUID) -> tuple[AuditEvent, ...]:
        return await self._repository.list_for_course(course_id)


def snapshot(value: object) -> dict[str, object] | None:
    if value is None:
        return None
    if is_dataclass(value) and not isinstance(value, type):
        value = asdict(value)
    if isinstance(value, dict):
        return _jsonable(value)
    return {"value": _json_scalar(value)}


def rationale_from_state(state: dict[str, object] | None) -> str | None:
    if not state:
        return None
    for source in (state.get("ai_proposal"), state.get("instructor_revision"), state):
        if isinstance(source, dict):
            for key in ("evidence", "rationale", "reason", "summary"):
                value = source.get(key)
                if isinstance(value, str) and value.strip():
                    return value
    return None


def instructor_note_from_state(state: dict[str, object] | None) -> str | None:
    if not state:
        return None
    revision = state.get("instructor_revision")
    if isinstance(revision, dict):
        for key in ("note", "instructor_note", "rationale", "action"):
            value = revision.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return None


def _jsonable(value: dict[object, object]) -> dict[str, object]:
    return {str(key): _json_scalar(item) for key, item in value.items()}


def _json_scalar(value: object) -> object:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return _jsonable(value)
    if isinstance(value, (tuple, list)):
        return [_json_scalar(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)
