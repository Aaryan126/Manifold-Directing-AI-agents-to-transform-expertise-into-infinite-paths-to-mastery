from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from app.segmentation.models import TranscriptWord


class ClipType(StrEnum):
    DEFINITION = "definition"
    WORKED_EXAMPLE = "worked_example"
    EXPLANATION = "explanation"
    MISCONCEPTION_CORRECTION = "misconception_correction"
    PREREQUISITE_RECAP = "prerequisite_recap"


class ClipStatus(StrEnum):
    ACTIVE = "active"
    FLAGGED = "flagged"
    SUPERSEDED = "superseded"


@dataclass(frozen=True)
class ClipConcept:
    id: UUID
    name: str
    description: str | None


@dataclass(frozen=True)
class ClipTopicContext:
    id: UUID
    course_id: UUID
    video_id: UUID
    title: str
    summary: str | None
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class ClipContext:
    topic: ClipTopicContext
    transcript_text: str
    words: tuple[TranscriptWord, ...]
    concepts: tuple[ClipConcept, ...]


@dataclass(frozen=True)
class ClipProposal:
    title: str
    start_seconds: float
    end_seconds: float
    type: ClipType
    difficulty: str
    concept_ids: tuple[UUID, ...]
    rationale: str
    confidence: float


@dataclass(frozen=True)
class Clip:
    id: UUID
    topic_id: UUID
    start_seconds: float
    end_seconds: float
    type: ClipType
    difficulty: str | None
    status: ClipStatus
    concept_ids: tuple[UUID, ...]
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    flagged_at: str | None
    flag_note: str | None
    superseded_by_clip_id: UUID | None
    source_clip_id: UUID | None
    created_at: str | None


@dataclass(frozen=True)
class ClipFlag:
    note: str

