from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID


class MasteryState(StrEnum):
    NOT_STARTED = "not_started"
    STRUGGLING = "struggling"
    PRACTICED = "practiced"
    MASTERED = "mastered"


class AdvancementMode(StrEnum):
    REQUIRE_MASTERY = "require_mastery"
    ALLOW_PARTIAL = "allow_partial_understanding"


class RouteAction(StrEnum):
    ADVANCE = "advance"
    REINFORCE = "reinforce"
    REMEDIATE = "remediate"
    FLAG_INSTRUCTOR = "flag_instructor"
    COMPLETE = "complete"


@dataclass(frozen=True)
class RoutingPolicy:
    confidence_threshold: int = 3
    correct_attempts_for_mastery: int = 1
    advancement_mode: AdvancementMode = AdvancementMode.REQUIRE_MASTERY
    max_remediation_attempts: int = 2


@dataclass(frozen=True)
class LearnerMastery:
    concept_id: UUID
    state: MasteryState
    correct_confident_attempts: int = 0
    remediation_attempts: int = 0


@dataclass(frozen=True)
class RouteableConcept:
    id: UUID
    name: str
    topic_id: UUID | None


@dataclass(frozen=True)
class LearnerConceptProgress:
    concept_id: UUID
    name: str
    state: MasteryState
    topic_id: UUID | None


@dataclass(frozen=True)
class RouteableClip:
    id: UUID
    topic_id: UUID
    concept_id: UUID
    type: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class RouteableRemediationRule:
    id: UUID
    wrong_answer_pattern: str
    target_clip_id: UUID | None
    target_concept_id: UUID | None


@dataclass(frozen=True)
class AttemptContext:
    course_id: UUID
    learner_id: UUID
    question_id: UUID
    topic_id: UUID
    current_concept_id: UUID
    policy: RoutingPolicy
    mastery: LearnerMastery
    mastered_concept_ids: frozenset[UUID]
    remediation_rules: tuple[RouteableRemediationRule, ...]


@dataclass(frozen=True)
class AttemptSubmission:
    learner_id: UUID
    question_id: UUID
    answer: dict[str, object]
    correctness: bool
    confidence: int
    wrong_answer_pattern: str | None = None


@dataclass(frozen=True)
class RouteDecision:
    action: RouteAction
    mastery_state: MasteryState
    why: str
    target_concept_id: UUID | None = None
    target_clip_id: UUID | None = None
    dashboard_signal_id: UUID | None = None


@dataclass(frozen=True)
class RoutingEvaluation:
    decision: RouteDecision
    mastery: LearnerMastery
    selected_rule: RouteableRemediationRule | None = None
    needs_instructor_signal: bool = False
