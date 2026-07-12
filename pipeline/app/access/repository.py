from abc import ABC, abstractmethod
from uuid import UUID

from app.access.models import (
    CourseAccess,
    DevelopmentIdentity,
    PublishReadiness,
    WatchEventCreate,
)


class AccessRepository(ABC):
    @abstractmethod
    async def development_identities(self) -> tuple[DevelopmentIdentity, ...]:
        raise NotImplementedError

    @abstractmethod
    async def get_course(self, course_id: UUID) -> CourseAccess | None:
        raise NotImplementedError

    @abstractmethod
    async def publish_readiness(self, course_id: UUID) -> PublishReadiness | None:
        raise NotImplementedError

    @abstractmethod
    async def publish_course(self, course_id: UUID) -> CourseAccess:
        raise NotImplementedError

    @abstractmethod
    async def user_role(self, user_id: UUID) -> str | None:
        raise NotImplementedError

    @abstractmethod
    async def enroll(self, learner_id: UUID, course_id: UUID) -> None:
        raise NotImplementedError

    @abstractmethod
    async def is_enrolled(self, learner_id: UUID, course_id: UUID) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def record_watch_event(self, event: WatchEventCreate) -> UUID:
        raise NotImplementedError
