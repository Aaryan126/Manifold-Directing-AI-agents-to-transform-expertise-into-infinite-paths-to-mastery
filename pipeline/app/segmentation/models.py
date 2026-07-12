from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class TopicReviewStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    EDITED = "edited"
    DISMISSED = "dismissed"


@dataclass(frozen=True)
class TranscriptWord:
    text: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class TopicProposal:
    title: str
    summary: str
    start_seconds: float
    end_seconds: float
    evidence: str
    confidence: float


@dataclass(frozen=True)
class Topic:
    id: UUID
    course_id: UUID
    video_id: UUID
    title: str
    summary: str | None
    start_seconds: float
    end_seconds: float
    review_status: TopicReviewStatus
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None


@dataclass(frozen=True)
class VideoTranscript:
    video_id: UUID
    course_id: UUID
    text: str
    words: tuple[TranscriptWord, ...]


@dataclass(frozen=True)
class TopicEdit:
    title: str
    summary: str
    start_seconds: float
    end_seconds: float
    action: str
