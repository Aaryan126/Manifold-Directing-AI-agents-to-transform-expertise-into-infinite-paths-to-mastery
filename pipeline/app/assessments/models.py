from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class QuestionReviewStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    EDITED = "edited"
    DISMISSED = "dismissed"


class QuestionType(StrEnum):
    MCQ = "mcq"
    SHORT_ANSWER = "short_answer"
    WORKED_PROBLEM = "worked_problem"


@dataclass(frozen=True)
class AssessmentConcept:
    id: UUID
    name: str
    description: str | None


@dataclass(frozen=True)
class AssessmentClip:
    id: UUID
    concept_ids: tuple[UUID, ...]
    type: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class AssessmentTopic:
    id: UUID
    course_id: UUID
    title: str
    summary: str | None


@dataclass(frozen=True)
class AssessmentContext:
    topic: AssessmentTopic
    concepts: tuple[AssessmentConcept, ...]
    clips: tuple[AssessmentClip, ...]


@dataclass(frozen=True)
class RemediationProposal:
    wrong_answer_pattern: str
    target_clip_id: UUID | None
    target_concept_id: UUID | None
    rationale: str


@dataclass(frozen=True)
class QuestionProposal:
    body: str
    type: QuestionType
    correct_answer: dict[str, object]
    confidence_prompt: str
    remediation_rules: tuple[RemediationProposal, ...]
    rationale: str
    confidence: float


@dataclass(frozen=True)
class RemediationRule:
    id: UUID
    question_id: UUID
    wrong_answer_pattern: str
    target_clip_id: UUID | None
    target_concept_id: UUID | None
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None


@dataclass(frozen=True)
class Question:
    id: UUID
    topic_id: UUID
    body: str
    type: QuestionType
    correct_answer: dict[str, object]
    confidence_prompt: str
    review_status: QuestionReviewStatus
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None
    remediation_rules: tuple[RemediationRule, ...]


@dataclass(frozen=True)
class AnswerGrade:
    is_correct: bool
    feedback: str
    wrong_answer_pattern: str | None


@dataclass(frozen=True)
class QuestionEdit:
    body: str
    type: QuestionType
    correct_answer: dict[str, object]
    confidence_prompt: str
    remediation_rules: tuple[RemediationProposal, ...]
    action: str
