from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class LearnerRevision:
    learner_id: UUID
    course_id: UUID
    revision_id: UUID


@dataclass(frozen=True)
class Orientation:
    completed: bool
    entry_choice: str | None


@dataclass(frozen=True)
class LearningMode:
    key: str
    title: str
    description: str
    available: bool
    recommended: bool
    reason: str | None
    disabled_reason: str | None


@dataclass(frozen=True)
class SessionStep:
    id: UUID
    ordinal: int
    kind: str
    purpose: str
    concept_id: UUID | None
    concept_name: str | None
    clip_id: UUID | None
    question_id: UUID | None
    source_id: UUID | None
    title: str
    reason_code: str
    reason: str
    status: str


@dataclass(frozen=True)
class StudySession:
    id: UUID
    course_id: UUID
    revision_id: UUID
    status: str
    mode: str
    finish_requested: bool
    plan_version: int
    steps: tuple[SessionStep, ...]


@dataclass(frozen=True)
class PlacementItem:
    id: UUID
    ordinal: int
    concept_id: UUID
    concept_name: str
    question_id: UUID
    question_body: str
    choices: tuple[str, ...]
    confidence_prompt: str
    status: str
    outcome: str | None


@dataclass(frozen=True)
class PlacementCheck:
    id: UUID
    status: str
    unavailable_reason: str | None
    items: tuple[PlacementItem, ...]


@dataclass(frozen=True)
class ReviewConcept:
    concept_id: UUID
    name: str
    state: str
    access_state: str
    coverage_state: str
    due_at: datetime | None
    mismatch: str | None


@dataclass(frozen=True)
class RouteHistoryItem:
    action: str
    explanation: str
    created_at: datetime


@dataclass(frozen=True)
class MasteryReview:
    concepts: tuple[ReviewConcept, ...]
    recent_routes: tuple[RouteHistoryItem, ...]


@dataclass(frozen=True)
class ClipTranscriptWord:
    text: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class ClipTranscript:
    clip_id: UUID
    duration_seconds: float
    timing_basis: str
    words: tuple[ClipTranscriptWord, ...]


@dataclass(frozen=True)
class HelpRequest:
    id: UUID
    status: str
    learner_note: str | None
    evidence: dict[str, object]
    created_at: datetime


@dataclass(frozen=True)
class LearningGuideMessage:
    id: UUID
    role: str
    content: str
    intent: str | None
    action: str | None
    created_at: datetime
