from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID


class RevisionStatus(StrEnum):
    BUILDING = "building"
    REVIEW = "review"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"


class GenerationRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_REVIEW = "waiting_review"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


class GenerationTaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ReviewDecision(StrEnum):
    ACCEPTED = "accepted"
    EDITED = "edited"
    DISMISSED = "dismissed"


@dataclass(frozen=True)
class CourseCreate:
    title: str
    description: str | None = None
    brief: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CourseSummary:
    id: UUID
    instructor_id: UUID
    title: str
    description: str | None
    status: str
    active_revision_id: UUID | None
    working_revision_id: UUID | None
    revision_status: str | None
    generation_run_id: UUID | None
    generation_status: str | None
    generation_phase: str | None
    generation_progress: float
    source_count: int
    topic_count: int
    concept_count: int
    pending_review_count: int
    open_signal_count: int
    updated_at: datetime


@dataclass(frozen=True)
class AttentionItem:
    id: str
    course_id: UUID
    kind: str
    title: str
    detail: str
    urgency: str


@dataclass(frozen=True)
class DashboardActivityPoint:
    date: str
    active_learners: int


@dataclass(frozen=True)
class CourseRadarItem:
    course_id: UUID
    title: str
    activity_trend: tuple[int, ...]
    active_learners: int
    accuracy_percent: float | None
    confidence_percent: float | None
    confident_incorrect_attempts: int
    clip_completion_percent: float | None
    mastery_percent: float | None
    mastery_movement: int
    open_issues: int
    agent_status: str
    agent_role: str | None


@dataclass(frozen=True)
class DashboardSnapshot:
    courses: tuple[CourseSummary, ...]
    attention: tuple[AttentionItem, ...]
    total_courses: int
    published_courses: int
    courses_in_review: int
    active_learners: int
    new_learners: int
    activity_history: tuple[DashboardActivityPoint, ...]
    activity_is_simulated: bool = False
    course_radar: tuple[CourseRadarItem, ...] = ()


@dataclass(frozen=True)
class DashboardEvidenceReference:
    id: str
    label: str
    value: str
    metric: str
    course_id: UUID | None = None
    course_title: str | None = None


@dataclass(frozen=True)
class DashboardCommandResult:
    kind: Literal["evidence", "proposal", "empty"]
    message: str
    course_id: UUID | None = None
    course_title: str | None = None
    action_label: str | None = None
    evidence: tuple[DashboardEvidenceReference, ...] = ()
    searched_course_count: int = 0


@dataclass(frozen=True)
class GenerationTask:
    id: UUID
    run_id: UUID
    task_type: str
    scope_key: str
    status: GenerationTaskStatus
    depends_on: tuple[UUID, ...]
    attempts: int
    max_attempts: int
    input: dict[str, Any]
    output: dict[str, Any] | None
    error_message: str | None


@dataclass(frozen=True)
class GenerationRun:
    id: UUID
    course_id: UUID
    revision_id: UUID
    status: GenerationRunStatus
    phase: str
    progress: float
    error_summary: str | None
    created_at: datetime
    updated_at: datetime
    tasks: tuple[GenerationTask, ...] = ()


@dataclass(frozen=True)
class ConversationMessage:
    id: UUID
    role: str
    content: str
    blocks: tuple[dict[str, Any], ...]
    created_at: datetime


@dataclass(frozen=True)
class CourseProposal:
    id: UUID
    proposal_type: str
    artifact_type: str | None
    logical_artifact_id: UUID | None
    before_state: dict[str, Any] | None
    proposed_state: dict[str, Any]
    rationale: str
    status: str
    created_at: datetime


@dataclass(frozen=True)
class ReviewItem:
    id: UUID
    artifact_type: str
    artifact_id: UUID
    logical_artifact_id: UUID
    status: str
    risk_level: str
    evidence: dict[str, Any]


@dataclass(frozen=True)
class ReviewBundle:
    id: UUID
    kind: str
    title: str
    summary: str
    status: str
    items: tuple[ReviewItem, ...]


@dataclass(frozen=True)
class CourseMapNode:
    id: UUID
    logical_id: UUID
    kind: str
    title: str
    status: str
    topic_id: UUID | None
    metadata: dict[str, Any]


@dataclass(frozen=True)
class CourseMapEdge:
    id: UUID
    logical_id: UUID
    source_id: UUID
    target_id: UUID
    kind: str
    status: str


@dataclass(frozen=True)
class CourseMap:
    course_id: UUID
    revision_id: UUID
    nodes: tuple[CourseMapNode, ...]
    edges: tuple[CourseMapEdge, ...]


@dataclass(frozen=True)
class BlueprintNode:
    id: UUID
    logical_id: UUID
    kind: str
    title: str
    status: str
    parent_id: UUID | None
    metadata: dict[str, Any]


@dataclass(frozen=True)
class BlueprintEdge:
    id: str
    source_id: UUID
    target_id: UUID
    kind: str
    status: str


@dataclass(frozen=True)
class CourseBlueprint:
    course_id: UUID
    revision_id: UUID
    revision_kind: str
    nodes: tuple[BlueprintNode, ...]
    edges: tuple[BlueprintEdge, ...]
    uncovered_concept_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class DecisionTraceStage:
    key: str
    title: str
    summary: str
    status: Literal["available", "missing"]
    artifact_type: str | None = None
    artifact_id: UUID | None = None
    logical_artifact_id: UUID | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CourseDecisionTrace:
    course_id: UUID
    revision_id: UUID
    revision_kind: Literal["active", "working"]
    concept_id: UUID
    concept_logical_id: UUID
    concept_title: str
    complete: bool
    stages: tuple[DecisionTraceStage, ...]


@dataclass(frozen=True)
class CourseFlowModule:
    id: UUID
    logical_id: UUID
    title: str
    summary: str
    sequence_rank: int
    status: str
    x: float | None = None
    y: float | None = None


@dataclass(frozen=True)
class CourseFlowUnit:
    id: UUID
    logical_id: UUID
    module_logical_id: UUID | None
    kind: Literal["lecture", "quiz", "assignment"]
    title: str
    summary: str
    instructions: str
    video_id: UUID | None
    sequence_rank: int
    status: str
    topic_count: int = 0
    concept_count: int = 0
    question_count: int = 0
    source_count: int = 0
    concept_logical_ids: tuple[UUID, ...] = ()
    x: float | None = None
    y: float | None = None


@dataclass(frozen=True)
class CourseFlowEdge:
    id: UUID
    logical_id: UUID
    source_unit_logical_id: UUID
    target_unit_logical_id: UUID
    relationship: Literal["next", "requires", "assesses"]
    status: str


@dataclass(frozen=True)
class CourseFlow:
    course_id: UUID
    revision_id: UUID
    revision_kind: Literal["active", "working"]
    modules: tuple[CourseFlowModule, ...]
    units: tuple[CourseFlowUnit, ...]
    edges: tuple[CourseFlowEdge, ...]


@dataclass(frozen=True)
class CourseFlowUnitDraft:
    kind: Literal["lecture", "quiz", "assignment"]
    title: str
    summary: str = ""
    instructions: str = ""
    module_logical_id: UUID | None = None
    concept_logical_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True)
class CourseFlowModuleDraft:
    title: str
    summary: str = ""


@dataclass(frozen=True)
class BlueprintMutationImpact:
    artifact_kind: str
    logical_artifact_id: UUID
    title: str
    affected_topics: tuple[str, ...] = ()
    affected_concepts: tuple[str, ...] = ()
    affected_clips: tuple[str, ...] = ()
    affected_questions: tuple[str, ...] = ()
    affected_relationships: int = 0
    learner_records_preserved: bool = True
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class BlueprintConceptEvidence:
    concept_id: UUID
    attempts: int
    touched_learners: int
    correct_percent: float | None
    confident_percent: float | None
    confident_incorrect: int
    mastery: dict[str, int]
    route_actions: dict[str, int]


@dataclass(frozen=True)
class RevisionChange:
    artifact_type: str
    logical_artifact_id: UUID
    change_type: str
    before_state: dict[str, Any] | None
    after_state: dict[str, Any] | None


@dataclass(frozen=True)
class RevisionDiff:
    active_revision_id: UUID | None
    working_revision_id: UUID
    changes: tuple[RevisionChange, ...]


@dataclass(frozen=True)
class AssessmentTopicOption:
    id: UUID
    title: str


@dataclass(frozen=True)
class AssessmentConceptOption:
    id: UUID
    name: str
    topic_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class AssessmentClipOption:
    id: UUID
    topic_id: UUID
    topic_title: str
    video_id: UUID
    label: str
    start_seconds: float
    end_seconds: float
    type: str
    difficulty: str | None
    status: str
    playback_provider: str
    playback_id: str | None
    playback_url: str
    delivery_asset_id: str | None
    materialization_status: str


@dataclass(frozen=True)
class AssessmentRuleDraft:
    wrong_answer_pattern: str
    target_clip_id: UUID | None = None
    target_concept_id: UUID | None = None


@dataclass(frozen=True)
class AssessmentDraft:
    topic_id: UUID
    body: str
    type: str
    correct_answer: dict[str, Any]
    confidence_prompt: str
    remediation_rules: tuple[AssessmentRuleDraft, ...]
    primary_concept_id: UUID | None = None
    concept_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True)
class CourseAssessment:
    id: UUID
    logical_id: UUID
    topic_id: UUID
    topic_title: str
    body: str
    type: str
    correct_answer: dict[str, Any]
    confidence_prompt: str
    review_status: str
    remediation_rules: tuple[dict[str, Any], ...]
    primary_concept_id: UUID | None = None
    concept_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True)
class AssessmentWorkspace:
    revision_id: UUID
    is_working_revision: bool
    topics: tuple[AssessmentTopicOption, ...]
    concepts: tuple[AssessmentConceptOption, ...]
    clips: tuple[AssessmentClipOption, ...]
    questions: tuple[CourseAssessment, ...]


@dataclass(frozen=True)
class RoutingPolicyDraft:
    confidence_threshold: int
    correct_attempts_for_mastery: int
    advancement_mode: str
    max_remediation_attempts: int


@dataclass(frozen=True)
class CourseRoutingPolicy:
    id: UUID | None
    concept_id: UUID | None
    concept_name: str | None
    policy: RoutingPolicyDraft


@dataclass(frozen=True)
class RoutingWorkspace:
    revision_id: UUID
    is_working_revision: bool
    concepts: tuple[AssessmentConceptOption, ...]
    policies: tuple[CourseRoutingPolicy, ...]
