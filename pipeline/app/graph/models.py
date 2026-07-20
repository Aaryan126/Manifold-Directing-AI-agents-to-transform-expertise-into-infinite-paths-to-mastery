from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class GraphReviewStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    EDITED = "edited"
    DISMISSED = "dismissed"


@dataclass(frozen=True)
class ConceptProposal:
    key: str
    name: str
    description: str
    topic_ids: tuple[UUID, ...]
    evidence: str
    confidence: float


@dataclass(frozen=True)
class EdgeProposal:
    from_key: str
    to_key: str
    rationale: str
    evidence: str
    confidence: float


@dataclass(frozen=True)
class ConceptGraphProposal:
    concepts: tuple[ConceptProposal, ...]
    edges: tuple[EdgeProposal, ...]


@dataclass(frozen=True)
class Concept:
    id: UUID
    course_id: UUID
    name: str
    description: str | None
    review_status: GraphReviewStatus
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None
    merged_into_concept_id: UUID | None


@dataclass(frozen=True)
class ConceptGraphEdge:
    id: UUID
    from_concept_id: UUID
    to_concept_id: UUID
    relationship: str
    review_status: GraphReviewStatus
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None


@dataclass(frozen=True)
class TopicContext:
    id: UUID
    title: str
    summary: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class CourseGraphContext:
    course_id: UUID
    topics: tuple[TopicContext, ...]


@dataclass(frozen=True)
class ConceptEdit:
    name: str
    description: str
    action: str


@dataclass(frozen=True)
class ConceptCreate:
    name: str
    description: str
    topic_ids: tuple[UUID, ...]
    action: str


@dataclass(frozen=True)
class EdgeEdit:
    from_concept_id: UUID
    to_concept_id: UUID
    rationale: str
    action: str


@dataclass(frozen=True)
class ConceptGraph:
    course_id: UUID
    concepts: tuple[Concept, ...]
    edges: tuple[ConceptGraphEdge, ...]
