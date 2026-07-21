from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class DashboardSignalType(StrEnum):
    STUCK_COHORT = "stuck_cohort"
    UNDERPERFORMING_CONTENT = "underperforming_content"
    GRAPH_DRIFT = "graph_drift"


class DashboardSignalStatus(StrEnum):
    OPEN = "open"
    ACCEPTED = "accepted"
    EDITED = "edited"
    DISMISSED = "dismissed"


@dataclass(frozen=True)
class ConceptSignalStats:
    concept_id: UUID
    concept_name: str
    touched_learners: int
    struggling_learners: int
    mastered_prerequisite_struggling_learners: int = 0
    attempts: int = 0
    correct_attempts: int = 0
    confidence_1: int = 0
    confidence_2: int = 0
    confidence_3: int = 0
    confidence_4: int = 0
    mastered_learners: int = 0
    practiced_learners: int = 0


@dataclass(frozen=True)
class QuestionSignalStats:
    question_id: UUID
    topic_id: UUID
    prompt: str
    attempts: int
    incorrect_attempts: int
    low_confidence_correct_attempts: int


@dataclass(frozen=True)
class ClipSignalStats:
    clip_id: UUID
    concept_id: UUID
    topic_id: UUID
    remediation_attempts: int
    struggling_learners: int


@dataclass(frozen=True)
class ActivityPoint:
    date: str
    attempts: int
    active_learners: int


@dataclass(frozen=True)
class MasteryDistribution:
    mastered: int = 0
    practiced: int = 0
    struggling: int = 0
    not_started: int = 0


@dataclass(frozen=True)
class TopicHealth:
    topic_id: UUID
    logical_id: UUID
    title: str
    learner_reach: int
    attempts: int
    correct_attempts: int
    confidence_1: int
    confidence_2: int
    confidence_3: int
    confidence_4: int
    mastered_learners: int
    practiced_learners: int
    struggling_learners: int
    remediation_attempts: int
    active_clips: int
    clip_duration_seconds: float
    assessment_count: int
    concept_count: int


@dataclass(frozen=True)
class DashboardPriority:
    id: str
    title: str
    summary: str
    severity: str
    score: int
    specialist_role: str
    target_artifact_type: str | None
    target_artifact_id: UUID | None
    target_logical_artifact_id: UUID | None
    affected_learners: int
    evidence_count: int
    evidence: dict[str, object]
    recommended_action: str


@dataclass(frozen=True)
class DashboardSignalProposal:
    type: DashboardSignalType
    related_entity_type: str
    related_entity_id: UUID
    title: str
    summary: str
    recommended_action: str
    fingerprint: str
    metrics: dict[str, object]


@dataclass(frozen=True)
class DashboardSignal:
    id: UUID
    course_id: UUID
    type: DashboardSignalType
    related_entity_type: str
    related_entity_id: UUID
    status: DashboardSignalStatus
    ai_diagnosis: dict[str, object]
    instructor_action: dict[str, object] | None


@dataclass(frozen=True)
class DashboardSummary:
    course_id: UUID
    learner_count: int
    attempt_count: int
    signals: tuple[DashboardSignal, ...]
    concept_stats: tuple[ConceptSignalStats, ...] = ()
    question_stats: tuple[QuestionSignalStats, ...] = ()
    clip_stats: tuple[ClipSignalStats, ...] = ()
    activity_history: tuple[ActivityPoint, ...] = ()
    mastery_distribution: MasteryDistribution = MasteryDistribution()
    topic_health: tuple[TopicHealth, ...] = ()
    priorities: tuple[DashboardPriority, ...] = ()


@dataclass(frozen=True)
class DashboardAction:
    action: str
    note: str | None = None
    retroactive: bool = False


@dataclass(frozen=True)
class LearnerOverride:
    learner_id: UUID
    concept_id: UUID
    action: str
    note: str | None = None
