from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class UserRole(StrEnum):
    INSTRUCTOR = "instructor"
    LEARNER = "learner"


class CourseStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"


@dataclass(frozen=True)
class DevelopmentIdentity:
    id: UUID
    email: str
    display_name: str
    role: UserRole


@dataclass(frozen=True)
class CourseAccess:
    id: UUID
    instructor_id: UUID
    title: str
    description: str | None
    status: CourseStatus
    published_at: str | None


@dataclass(frozen=True)
class PublishReadiness:
    course_id: UUID
    blockers: tuple[str, ...]

    @property
    def ready(self) -> bool:
        return not self.blockers


@dataclass(frozen=True)
class WatchEventCreate:
    learner_id: UUID
    course_id: UUID
    video_id: UUID
    clip_id: UUID | None
    path_mode: str
    watched_seconds: float
