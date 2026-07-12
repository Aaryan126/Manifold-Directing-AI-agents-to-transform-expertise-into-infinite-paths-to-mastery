from abc import ABC, abstractmethod
from uuid import UUID

from app.audit.models import AuditEvent, AuditEventCreate


class AuditRepository(ABC):
    @abstractmethod
    async def record_event(self, event: AuditEventCreate) -> AuditEvent:
        raise NotImplementedError

    async def record_events(
        self,
        events: tuple[AuditEventCreate, ...],
    ) -> tuple[AuditEvent, ...]:
        return tuple([await self.record_event(event) for event in events])

    @abstractmethod
    async def list_for_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID,
    ) -> tuple[AuditEvent, ...]:
        raise NotImplementedError

    @abstractmethod
    async def list_for_course(self, course_id: UUID) -> tuple[AuditEvent, ...]:
        raise NotImplementedError
