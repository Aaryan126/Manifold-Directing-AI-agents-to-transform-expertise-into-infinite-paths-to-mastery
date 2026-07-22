from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class SourcePurpose(StrEnum):
    AI_CONTEXT = "ai_context"
    LEARNER_RESOURCE = "learner_resource"
    BOTH = "both"


class SourceReviewStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    EDITED = "edited"
    DISMISSED = "dismissed"


class SourceExtractionStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class AgentTaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_REVIEW = "waiting_review"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SpecialistRole(StrEnum):
    LEARNING_ANALYST = "learning_analyst"
    CURRICULUM_ARCHITECT = "curriculum_architect"
    CLIP_EDITOR = "clip_editor"
    ASSESSMENT_DESIGNER = "assessment_designer"


@dataclass(frozen=True)
class ExtractedSection:
    section_index: int
    page_number: int
    title: str | None
    native_text: str
    speaker_notes: str = ""
    visual_summary: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CourseSource:
    id: UUID
    logical_id: UUID
    course_id: UUID
    revision_id: UUID
    filename: str
    source_type: str
    mime_type: str
    size_bytes: int
    extraction_status: SourceExtractionStatus
    extraction_error: str | None
    purpose: SourcePurpose
    review_status: SourceReviewStatus
    learner_visible: bool
    section_count: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SourceCitation:
    source_id: UUID
    source_title: str
    section_id: UUID
    page_number: int
    excerpt: str


@dataclass(frozen=True)
class AgentTask:
    id: UUID
    course_id: UUID
    revision_id: UUID
    specialist_role: SpecialistRole
    task_type: str
    target_artifact_type: str | None
    target_logical_artifact_id: UUID | None
    request_context: dict[str, Any]
    evidence_snapshot: dict[str, Any]
    status: AgentTaskStatus
    result: dict[str, Any] | None
    proposal_ids: tuple[UUID, ...]
    attempts: int
    max_attempts: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ImprovementDraft:
    proposal_type: str
    artifact_type: str
    logical_artifact_id: UUID
    before_state: dict[str, Any]
    proposed_state: dict[str, Any]
    rationale: str


@dataclass(frozen=True)
class AgentTaskProposal:
    id: UUID
    proposal_type: str
    artifact_type: str | None
    logical_artifact_id: UUID | None
    before_state: dict[str, Any] | None
    proposed_state: dict[str, Any]
    rationale: str
    status: str
    citations: tuple[SourceCitation, ...] = ()
