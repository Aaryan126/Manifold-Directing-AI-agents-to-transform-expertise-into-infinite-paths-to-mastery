from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from app.course_os.models import (
    AssessmentDraft,
    AssessmentWorkspace,
    BlueprintConceptEvidence,
    BlueprintMutationImpact,
    ConversationMessage,
    CourseAssessment,
    CourseBlueprint,
    CourseCreate,
    CourseFlow,
    CourseFlowModuleDraft,
    CourseFlowUnitDraft,
    CourseMap,
    CourseProposal,
    CourseRoutingPolicy,
    CourseSummary,
    DashboardSnapshot,
    GenerationRun,
    GenerationTask,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionDiff,
    RoutingPolicyDraft,
    RoutingWorkspace,
)


class CourseOSRepository(ABC):
    @abstractmethod
    async def user_role(self, user_id: UUID) -> str | None: ...

    @abstractmethod
    async def create_course(self, instructor_id: UUID, create: CourseCreate) -> CourseSummary: ...

    @abstractmethod
    async def list_courses(self, instructor_id: UUID) -> tuple[CourseSummary, ...]: ...

    @abstractmethod
    async def get_course(self, course_id: UUID) -> CourseSummary | None: ...

    @abstractmethod
    async def delete_course(self, course_id: UUID, instructor_id: UUID) -> bool: ...

    @abstractmethod
    async def create_working_revision(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary: ...

    @abstractmethod
    async def publish_working_revision(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary: ...

    @abstractmethod
    async def dashboard(self, instructor_id: UUID) -> DashboardSnapshot: ...

    @abstractmethod
    async def create_generation_run(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        video_id: UUID,
        ingestion_job_id: UUID,
    ) -> GenerationRun: ...

    @abstractmethod
    async def get_generation_run(self, run_id: UUID) -> GenerationRun | None: ...

    @abstractmethod
    async def cancel_generation_run(self, run_id: UUID) -> GenerationRun | None: ...

    @abstractmethod
    async def retry_generation_run(self, run_id: UUID) -> GenerationRun | None: ...

    @abstractmethod
    async def claim_generation_task(
        self,
        worker_id: str,
        lease_seconds: int,
    ) -> GenerationTask | None: ...

    @abstractmethod
    async def complete_generation_task(
        self,
        task_id: UUID,
        output: dict[str, Any],
    ) -> None: ...

    @abstractmethod
    async def fail_generation_task(
        self,
        task_id: UUID,
        error_message: str,
        retry: bool,
    ) -> None: ...

    @abstractmethod
    async def generation_topic_ids(
        self,
        revision_id: UUID,
        video_id: UUID | None = None,
    ) -> tuple[UUID, ...]: ...

    @abstractmethod
    async def apply_course_title_proposal(
        self,
        course_id: UUID,
        revision_id: UUID,
        video_id: UUID | None = None,
    ) -> str | None: ...

    @abstractmethod
    async def assemble_review_bundles(
        self,
        course_id: UUID,
        revision_id: UUID,
    ) -> tuple[ReviewBundle, ...]: ...

    @abstractmethod
    async def list_messages(
        self,
        course_id: UUID,
        revision_id: UUID,
    ) -> tuple[ConversationMessage, ...]: ...

    @abstractmethod
    async def add_message(
        self,
        course_id: UUID,
        revision_id: UUID,
        role: str,
        content: str,
        blocks: tuple[dict[str, Any], ...] = (),
    ) -> ConversationMessage: ...

    @abstractmethod
    async def create_proposal(
        self,
        course_id: UUID,
        revision_id: UUID,
        message_id: UUID,
        instruction: str,
    ) -> CourseProposal: ...

    @abstractmethod
    async def create_typed_proposal(
        self,
        course_id: UUID,
        revision_id: UUID,
        message_id: UUID,
        *,
        proposal_type: str,
        artifact_type: str,
        logical_artifact_id: UUID,
        before_state: dict[str, Any] | None,
        proposed_state: dict[str, Any],
        rationale: str,
    ) -> CourseProposal: ...

    @abstractmethod
    async def course_evidence(
        self,
        course_id: UUID,
        revision_id: UUID,
    ) -> dict[str, Any]: ...

    @abstractmethod
    async def resolve_proposal(
        self,
        course_id: UUID,
        proposal_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
        instructor_revision: dict[str, Any] | None,
    ) -> CourseProposal | None: ...

    @abstractmethod
    async def course_map(self, course_id: UUID, revision_id: UUID) -> CourseMap: ...

    @abstractmethod
    async def blueprint(
        self,
        course_id: UUID,
        revision_id: UUID,
        revision_kind: str,
    ) -> CourseBlueprint: ...

    @abstractmethod
    async def course_flow(
        self,
        course_id: UUID,
        revision_id: UUID,
        revision_kind: str,
    ) -> CourseFlow: ...

    @abstractmethod
    async def save_course_flow_layout(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        logical_artifact_id: UUID,
        x: float,
        y: float,
    ) -> None: ...

    @abstractmethod
    async def create_course_flow_module(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        draft: CourseFlowModuleDraft,
    ) -> UUID: ...

    @abstractmethod
    async def create_course_flow_unit(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        draft: CourseFlowUnitDraft,
    ) -> UUID: ...

    @abstractmethod
    async def update_course_flow_unit(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        unit_logical_id: UUID,
        draft: CourseFlowUnitDraft,
    ) -> None: ...

    @abstractmethod
    async def remove_course_flow_unit(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        unit_logical_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def mutate_course_flow_edge(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        action: str,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def review_course_flow_artifact(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        artifact_kind: str,
        logical_artifact_id: UUID,
        decision: ReviewDecision,
    ) -> None: ...

    @abstractmethod
    async def blueprint_evidence(
        self,
        course_id: UUID,
        revision_id: UUID,
        days: int,
        learner_id: UUID | None,
    ) -> tuple[BlueprintConceptEvidence, ...]: ...

    @abstractmethod
    async def update_concept_sequence(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        concept_ids: tuple[UUID, ...],
    ) -> None: ...

    @abstractmethod
    async def add_blueprint_prerequisite(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        from_concept_id: UUID,
        to_concept_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def remove_blueprint_prerequisite(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        edge_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def create_blueprint_relationship(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def remove_blueprint_relationship(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def reconnect_blueprint_relationship(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        previous_relationship: str,
        previous_source_logical_id: UUID,
        previous_target_logical_id: UUID,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def create_blueprint_topic(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        title: str,
        summary: str,
        start_seconds: float,
        end_seconds: float,
    ) -> UUID: ...

    @abstractmethod
    async def update_blueprint_topic(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        topic_id: UUID,
        title: str,
        summary: str,
        start_seconds: float,
        end_seconds: float,
    ) -> None: ...

    @abstractmethod
    async def create_blueprint_concept(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        name: str,
        description: str,
        topic_ids: tuple[UUID, ...],
        sequence_after_id: UUID | None,
    ) -> UUID: ...

    @abstractmethod
    async def update_blueprint_concept(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        concept_id: UUID,
        name: str,
        description: str,
    ) -> None: ...

    @abstractmethod
    async def update_blueprint_concept_topics(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        concept_id: UUID,
        topic_ids: tuple[UUID, ...],
    ) -> None: ...

    @abstractmethod
    async def blueprint_mutation_impact(
        self,
        course_id: UUID,
        revision_id: UUID,
        artifact_kind: str,
        artifact_id: UUID,
    ) -> BlueprintMutationImpact: ...

    @abstractmethod
    async def remove_blueprint_artifact(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        artifact_kind: str,
        artifact_id: UUID,
    ) -> None: ...

    @abstractmethod
    async def revision_diff(
        self,
        active_revision_id: UUID | None,
        working_revision_id: UUID,
    ) -> RevisionDiff: ...

    @abstractmethod
    async def review_bundles(self, revision_id: UUID) -> tuple[ReviewBundle, ...]: ...

    @abstractmethod
    async def resolve_review_item(
        self,
        course_id: UUID,
        item_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
        instructor_revision: dict[str, Any] | None,
    ) -> ReviewItem | None: ...

    @abstractmethod
    async def resolve_review_bundle_remaining(
        self,
        course_id: UUID,
        bundle_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
    ) -> ReviewBundle | None: ...

    @abstractmethod
    async def assessment_workspace(
        self,
        course_id: UUID,
        revision_id: UUID,
        is_working_revision: bool,
    ) -> AssessmentWorkspace: ...

    @abstractmethod
    async def create_assessment(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        draft: AssessmentDraft,
    ) -> CourseAssessment: ...

    @abstractmethod
    async def update_assessment(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        question_id: UUID,
        draft: AssessmentDraft,
    ) -> CourseAssessment | None: ...

    @abstractmethod
    async def dismiss_assessment(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        question_id: UUID,
    ) -> CourseAssessment | None: ...

    @abstractmethod
    async def routing_workspace(
        self,
        course_id: UUID,
        revision_id: UUID,
        is_working_revision: bool,
    ) -> RoutingWorkspace: ...

    @abstractmethod
    async def upsert_routing_policy(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        concept_id: UUID | None,
        policy: RoutingPolicyDraft,
    ) -> CourseRoutingPolicy: ...

    @abstractmethod
    async def delete_routing_policy(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        concept_id: UUID,
    ) -> bool: ...
