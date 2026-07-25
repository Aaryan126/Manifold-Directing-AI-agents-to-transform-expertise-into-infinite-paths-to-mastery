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
class LearnerCourseSummary:
    id: UUID
    title: str
    description: str | None
    enrolled: bool
    topic_count: int
    concept_count: int
    mastered_concept_count: int
    lecture_count: int = 0
    quiz_count: int = 0
    assignment_count: int = 0


@dataclass(frozen=True)
class LearnerTopic:
    id: UUID
    video_id: UUID
    title: str
    summary: str | None


@dataclass(frozen=True)
class LearnerCourseUnit:
    id: UUID
    logical_id: UUID
    kind: str
    title: str
    summary: str
    instructions: str
    video_id: UUID | None
    sequence_rank: int
    status: str
    topic_ids: tuple[UUID, ...]
    question_count: int


@dataclass(frozen=True)
class LearnerClip:
    id: UUID
    topic_id: UUID
    video_id: UUID
    title: str
    start_seconds: float
    end_seconds: float
    type: str
    difficulty: str | None
    playback_provider: str
    playback_id: str | None
    playback_url: str
    delivery_asset_id: str | None
    materialization_status: str


@dataclass(frozen=True)
class LearnerQuestion:
    id: UUID
    topic_id: UUID
    body: str
    type: str
    choices: tuple[str, ...]
    confidence_prompt: str


@dataclass(frozen=True)
class LearnerResource:
    id: UUID
    filename: str
    source_type: str
    size_bytes: int


@dataclass(frozen=True)
class LearnerCourseExperience:
    id: UUID
    title: str
    description: str | None
    units: tuple[LearnerCourseUnit, ...]
    topics: tuple[LearnerTopic, ...]
    clips: tuple[LearnerClip, ...]
    questions: tuple[LearnerQuestion, ...]
    resources: tuple[LearnerResource, ...] = ()


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
