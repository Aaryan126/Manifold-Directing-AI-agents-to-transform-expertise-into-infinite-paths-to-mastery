from typing import Any
from uuid import UUID, uuid4

from app.course_os.course_director import (
    CourseDirector,
    CourseDirectorAction,
    LocalCourseDirector,
)
from app.course_os.dashboard_assistant import DashboardAssistant, LocalDashboardAssistant
from app.course_os.models import (
    AssessmentDraft,
    AssessmentWorkspace,
    BlueprintConceptEvidence,
    BlueprintMutationImpact,
    ConversationMessage,
    CourseAssessment,
    CourseBlueprint,
    CourseCreate,
    CourseMap,
    CourseProposal,
    CourseRoutingPolicy,
    CourseSummary,
    DashboardCommandResult,
    DashboardSnapshot,
    GenerationRun,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionDiff,
    RoutingPolicyDraft,
    RoutingWorkspace,
)
from app.course_os.repository import CourseOSRepository


class CourseOSValidationError(ValueError):
    pass


class CourseOSService:
    def __init__(
        self,
        repository: CourseOSRepository,
        dashboard_assistant: DashboardAssistant | None = None,
        course_director: CourseDirector | None = None,
    ) -> None:
        self._repository = repository
        self._dashboard_assistant = dashboard_assistant or LocalDashboardAssistant()
        self._course_director = course_director or LocalCourseDirector()

    async def dashboard(self, instructor_id: UUID) -> DashboardSnapshot:
        await self._require_instructor(instructor_id)
        return await self._repository.dashboard(instructor_id)

    async def dashboard_command(
        self,
        instructor_id: UUID,
        content: str,
    ) -> DashboardCommandResult:
        await self._require_instructor(instructor_id)
        instruction = content.strip()
        if not instruction:
            raise CourseOSValidationError("Command cannot be empty.")
        snapshot = await self._repository.dashboard(instructor_id)
        analysis = await self._dashboard_assistant.analyze(instruction, snapshot)
        if analysis.intent == "change_request":
            if analysis.course_id is None:
                return DashboardCommandResult(
                    kind="empty",
                    message=(
                        "There is not enough published-course evidence to choose a safe target. "
                        "Open a course and tell the Course Director what you want changed."
                    ),
                )
            await self.send_message(analysis.course_id, instructor_id, instruction)
            return DashboardCommandResult(
                kind="proposal",
                message=(
                    f"{analysis.answer} I prepared it as a private directive for "
                    f"{analysis.course_title}. "
                    "Nothing learner-facing changed; review, edit, or dismiss it "
                    "in Course Director."
                ),
                course_id=analysis.course_id,
                course_title=analysis.course_title,
                action_label="Review private proposal",
                evidence=analysis.evidence,
                searched_course_count=analysis.searched_course_count,
            )
        return DashboardCommandResult(
            kind="evidence" if analysis.evidence else "empty",
            message=analysis.answer,
            course_id=analysis.course_id,
            course_title=analysis.course_title,
            action_label=analysis.action_label,
            evidence=analysis.evidence,
            searched_course_count=analysis.searched_course_count,
        )

    async def list_courses(self, instructor_id: UUID) -> tuple[CourseSummary, ...]:
        await self._require_instructor(instructor_id)
        return await self._repository.list_courses(instructor_id)

    async def create_course(self, instructor_id: UUID, create: CourseCreate) -> CourseSummary:
        await self._require_instructor(instructor_id)
        title = create.title.strip()
        if not title:
            raise CourseOSValidationError("Course title is required.")
        return await self._repository.create_course(
            instructor_id,
            CourseCreate(
                title=title,
                description=create.description.strip() if create.description else None,
                brief=create.brief,
            ),
        )

    async def course(self, course_id: UUID, instructor_id: UUID) -> CourseSummary:
        return await self._require_owned_course(course_id, instructor_id)

    async def delete_course(self, course_id: UUID, instructor_id: UUID) -> None:
        await self._require_owned_course(course_id, instructor_id)
        if not await self._repository.delete_course(course_id, instructor_id):
            raise CourseOSValidationError("Course not found.")

    async def assessment_workspace(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> AssessmentWorkspace:
        course = await self._require_owned_course(course_id, instructor_id)
        return await self._repository.assessment_workspace(
            course_id,
            _current_revision(course),
            course.working_revision_id is not None,
        )

    async def create_assessment(
        self,
        course_id: UUID,
        instructor_id: UUID,
        draft: AssessmentDraft,
    ) -> CourseAssessment:
        course = await self._require_editable_course(course_id, instructor_id)
        _validate_assessment_draft(draft)
        try:
            return await self._repository.create_assessment(
                course_id,
                _current_revision(course),
                instructor_id,
                draft,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc

    async def update_assessment(
        self,
        course_id: UUID,
        question_id: UUID,
        instructor_id: UUID,
        draft: AssessmentDraft,
    ) -> CourseAssessment:
        course = await self._require_editable_course(course_id, instructor_id)
        _validate_assessment_draft(draft)
        try:
            question = await self._repository.update_assessment(
                course_id,
                _current_revision(course),
                instructor_id,
                question_id,
                draft,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        if question is None:
            raise CourseOSValidationError("Assessment not found in the working revision.")
        return question

    async def dismiss_assessment(
        self,
        course_id: UUID,
        question_id: UUID,
        instructor_id: UUID,
    ) -> CourseAssessment:
        course = await self._require_editable_course(course_id, instructor_id)
        question = await self._repository.dismiss_assessment(
            course_id,
            _current_revision(course),
            instructor_id,
            question_id,
        )
        if question is None:
            raise CourseOSValidationError("Assessment not found in the working revision.")
        return question

    async def routing_workspace(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> RoutingWorkspace:
        course = await self._require_owned_course(course_id, instructor_id)
        return await self._repository.routing_workspace(
            course_id,
            _current_revision(course),
            course.working_revision_id is not None,
        )

    async def upsert_routing_policy(
        self,
        course_id: UUID,
        concept_id: UUID | None,
        instructor_id: UUID,
        policy: RoutingPolicyDraft,
    ) -> CourseRoutingPolicy:
        course = await self._require_editable_course(course_id, instructor_id)
        _validate_routing_policy(policy)
        try:
            return await self._repository.upsert_routing_policy(
                course_id,
                _current_revision(course),
                instructor_id,
                concept_id,
                policy,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc

    async def delete_routing_policy(
        self,
        course_id: UUID,
        concept_id: UUID,
        instructor_id: UUID,
    ) -> None:
        course = await self._require_editable_course(course_id, instructor_id)
        if not await self._repository.delete_routing_policy(
            course_id,
            _current_revision(course),
            instructor_id,
            concept_id,
        ):
            raise CourseOSValidationError("Concept policy not found in the working revision.")

    async def open_working_revision(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary:
        course = await self._require_owned_course(course_id, instructor_id)
        if course.working_revision_id is not None:
            raise CourseOSValidationError("This course already has a working revision.")
        if course.status != "published":
            raise CourseOSValidationError("Only a published course can open an update revision.")
        try:
            return await self._repository.create_working_revision(course_id, instructor_id)
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc

    async def publish_working_revision(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary:
        await self._require_owned_course(course_id, instructor_id)
        try:
            return await self._repository.publish_working_revision(course_id, instructor_id)
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc

    async def start_generation(
        self,
        course_id: UUID,
        instructor_id: UUID,
        video_id: UUID,
        ingestion_job_id: UUID,
    ) -> GenerationRun:
        course = await self._require_owned_course(course_id, instructor_id)
        if course.working_revision_id is None:
            raise CourseOSValidationError(
                "Open a working revision before generating course content."
            )
        try:
            return await self._repository.create_generation_run(
                course_id,
                course.working_revision_id,
                instructor_id,
                video_id,
                ingestion_job_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc

    async def generation_run(
        self,
        course_id: UUID,
        run_id: UUID,
        instructor_id: UUID,
    ) -> GenerationRun:
        await self._require_owned_course(course_id, instructor_id)
        run = await self._repository.get_generation_run(run_id)
        if run is None or run.course_id != course_id:
            raise CourseOSValidationError("Generation run not found.")
        return run

    async def cancel_generation(
        self,
        course_id: UUID,
        run_id: UUID,
        instructor_id: UUID,
    ) -> GenerationRun:
        await self.generation_run(course_id, run_id, instructor_id)
        run = await self._repository.cancel_generation_run(run_id)
        if run is None:
            raise CourseOSValidationError("Generation run not found.")
        return run

    async def retry_generation(
        self,
        course_id: UUID,
        run_id: UUID,
        instructor_id: UUID,
    ) -> GenerationRun:
        current = await self.generation_run(course_id, run_id, instructor_id)
        if current.status.value != "failed":
            raise CourseOSValidationError("Only a failed generation run can be retried.")
        run = await self._repository.retry_generation_run(run_id)
        if run is None:
            raise CourseOSValidationError("Generation run not found.")
        return run

    async def messages(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> tuple[ConversationMessage, ...]:
        course = await self._require_owned_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        return await self._repository.list_messages(course_id, revision_id)

    async def send_message(
        self,
        course_id: UUID,
        instructor_id: UUID,
        content: str,
    ) -> tuple[ConversationMessage, CourseProposal | None]:
        course = await self._require_owned_course(course_id, instructor_id)
        instruction = content.strip()
        if not instruction:
            raise CourseOSValidationError("Message cannot be empty.")
        evidence_question = _is_evidence_question(instruction)
        if (
            course.status == "published"
            and course.working_revision_id is None
            and not evidence_question
        ):
            try:
                course = await self._repository.create_working_revision(
                    course_id,
                    instructor_id,
                )
            except ValueError as exc:
                raise CourseOSValidationError(str(exc)) from exc
        revision_id = _current_revision(course)
        instructor_message = await self._repository.add_message(
            course_id,
            revision_id,
            "instructor",
            instruction,
        )
        if evidence_question:
            evidence = await self._repository.course_evidence(course_id, revision_id)
            answer = _evidence_answer(evidence)
            response = await self._repository.add_message(
                course_id,
                revision_id,
                "manifold",
                answer,
                ({"type": "evidence", **evidence},),
            )
            return response, None
        blueprint = await self._repository.blueprint(course_id, revision_id, "working")
        plan = await self._course_director.plan(instruction, blueprint)
        if not plan.actions:
            response = await self._repository.add_message(
                course_id,
                revision_id,
                "manifold",
                plan.clarification or plan.summary,
                (
                    {
                        "type": "clarification",
                        "summary": plan.summary,
                    },
                ),
            )
            return response, None
        proposals: list[CourseProposal] = []
        for action in plan.actions:
            proposal = await self._create_director_proposal(
                course_id,
                revision_id,
                instructor_message.id,
                action,
                blueprint,
            )
            proposals.append(proposal)
        response = await self._repository.add_message(
            course_id,
            revision_id,
            "manifold",
            (
                f"{plan.summary} I prepared {len(proposals)} independent private "
                f"{'change' if len(proposals) == 1 else 'changes'}. "
                "Review, edit, or dismiss each one."
            ),
            tuple(
                {
                    "type": "proposal",
                    "proposal_id": str(proposal.id),
                    "status": proposal.status,
                    "proposal_type": proposal.proposal_type,
                    "artifact_type": proposal.artifact_type,
                    "logical_artifact_id": (
                        str(proposal.logical_artifact_id) if proposal.logical_artifact_id else None
                    ),
                    "before_state": proposal.before_state,
                    "proposed_state": proposal.proposed_state,
                    "rationale": proposal.rationale,
                }
                for proposal in proposals
            ),
        )
        return response, proposals[0]

    async def _create_director_proposal(
        self,
        course_id: UUID,
        revision_id: UUID,
        message_id: UUID,
        action: CourseDirectorAction,
        blueprint: CourseBlueprint,
    ) -> CourseProposal:
        node = next(
            (item for item in blueprint.nodes if item.logical_id == action.logical_artifact_id),
            None,
        )
        before_state = (
            {
                "title": node.title,
                "status": node.status,
                **node.metadata,
            }
            if node
            else None
        )
        artifact_type: str
        logical_artifact_id = action.logical_artifact_id or uuid4()
        proposed_state = dict(action.proposed_state or {})
        if action.operation == "update_artifact":
            if node is None:
                raise CourseOSValidationError("Course Director targeted a missing artifact.")
            artifact_type = node.kind
        elif action.operation == "remove_artifact":
            if node is None or node.kind == "source":
                raise CourseOSValidationError("That artifact cannot be removed from Blueprint.")
            artifact_type = f"{node.kind}_remove"
            proposed_state = {"action": "remove", "summary": action.summary}
        elif action.operation == "create_topic":
            artifact_type = "topic_create"
        elif action.operation == "create_concept":
            artifact_type = "concept_create"
        elif action.operation == "create_question":
            artifact_type = "question_create"
        elif action.operation in {
            "create_relationship",
            "reconnect_relationship",
            "remove_relationship",
        }:
            if (
                action.relationship_type is None
                or action.source_logical_id is None
                or action.target_logical_id is None
            ):
                raise CourseOSValidationError(
                    "Course Director returned an incomplete relationship."
                )
            relationship_action = action.operation.removesuffix("_relationship")
            artifact_type = f"blueprint_relationship_{relationship_action}"
            proposed_state = {
                "relationship_type": action.relationship_type,
                "source_logical_id": str(action.source_logical_id),
                "target_logical_id": str(action.target_logical_id),
                "summary": action.summary,
            }
            if action.operation == "reconnect_relationship":
                if (
                    action.previous_relationship_type is None
                    or action.previous_source_logical_id is None
                    or action.previous_target_logical_id is None
                ):
                    raise CourseOSValidationError(
                        "Course Director returned an incomplete previous relationship."
                    )
                before_state = {
                    "relationship_type": action.previous_relationship_type,
                    "source_logical_id": str(action.previous_source_logical_id),
                    "target_logical_id": str(action.previous_target_logical_id),
                }
                proposed_state.update(
                    {
                        "previous_relationship_type": action.previous_relationship_type,
                        "previous_source_logical_id": str(
                            action.previous_source_logical_id
                        ),
                        "previous_target_logical_id": str(
                            action.previous_target_logical_id
                        ),
                    }
                )
        else:
            raise CourseOSValidationError("Course Director returned an unsupported action.")
        proposed_state.setdefault("summary", action.summary)
        return await self._repository.create_typed_proposal(
            course_id,
            revision_id,
            message_id,
            proposal_type=action.operation,
            artifact_type=artifact_type,
            logical_artifact_id=logical_artifact_id,
            before_state=before_state,
            proposed_state=proposed_state,
            rationale=action.rationale,
        )

    async def resolve_proposal(
        self,
        course_id: UUID,
        proposal_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
        instructor_revision: dict[str, Any] | None,
    ) -> CourseProposal:
        await self._require_owned_course(course_id, instructor_id)
        if decision == ReviewDecision.EDITED and not instructor_revision:
            raise CourseOSValidationError("An edited proposal must include your revision.")
        try:
            proposal = await self._repository.resolve_proposal(
                course_id,
                proposal_id,
                instructor_id,
                decision,
                instructor_revision,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        if proposal is None:
            raise CourseOSValidationError("Proposal not found.")
        return proposal

    async def course_map(self, course_id: UUID, instructor_id: UUID) -> CourseMap:
        course = await self._require_owned_course(course_id, instructor_id)
        return await self._repository.course_map(course_id, _current_revision(course))

    async def blueprint(
        self,
        course_id: UUID,
        instructor_id: UUID,
        revision_kind: str,
    ) -> CourseBlueprint:
        course = await self._require_owned_course(course_id, instructor_id)
        revision_id = _selected_revision(course, revision_kind)
        return await self._repository.blueprint(
            course_id,
            revision_id,
            revision_kind,
        )

    async def blueprint_evidence(
        self,
        course_id: UUID,
        instructor_id: UUID,
        revision_kind: str,
        days: int,
        learner_id: UUID | None,
    ) -> tuple[BlueprintConceptEvidence, ...]:
        if days < 1 or days > 365:
            raise CourseOSValidationError("Evidence range must be between 1 and 365 days.")
        course = await self._require_owned_course(course_id, instructor_id)
        revision_id = _selected_revision(course, revision_kind)
        return await self._repository.blueprint_evidence(
            course_id,
            revision_id,
            days,
            learner_id,
        )

    async def update_concept_sequence(
        self,
        course_id: UUID,
        instructor_id: UUID,
        concept_ids: tuple[UUID, ...],
    ) -> CourseBlueprint:
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.update_concept_sequence(
                course_id,
                revision_id,
                instructor_id,
                concept_ids,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def add_blueprint_prerequisite(
        self,
        course_id: UUID,
        instructor_id: UUID,
        from_concept_id: UUID,
        to_concept_id: UUID,
    ) -> CourseBlueprint:
        if from_concept_id == to_concept_id:
            raise CourseOSValidationError("A concept cannot require itself.")
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.add_blueprint_prerequisite(
                course_id,
                revision_id,
                instructor_id,
                from_concept_id,
                to_concept_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def remove_blueprint_prerequisite(
        self,
        course_id: UUID,
        instructor_id: UUID,
        edge_id: UUID,
    ) -> CourseBlueprint:
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.remove_blueprint_prerequisite(
                course_id,
                revision_id,
                instructor_id,
                edge_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def create_blueprint_relationship(
        self,
        course_id: UUID,
        instructor_id: UUID,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> CourseBlueprint:
        _validate_blueprint_relationship_request(
            relationship,
            source_logical_id,
            target_logical_id,
        )
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.create_blueprint_relationship(
                course_id,
                revision_id,
                instructor_id,
                relationship,
                source_logical_id,
                target_logical_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def remove_blueprint_relationship(
        self,
        course_id: UUID,
        instructor_id: UUID,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> CourseBlueprint:
        _validate_blueprint_relationship_request(
            relationship,
            source_logical_id,
            target_logical_id,
        )
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.remove_blueprint_relationship(
                course_id,
                revision_id,
                instructor_id,
                relationship,
                source_logical_id,
                target_logical_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def reconnect_blueprint_relationship(
        self,
        course_id: UUID,
        instructor_id: UUID,
        previous_relationship: str,
        previous_source_logical_id: UUID,
        previous_target_logical_id: UUID,
        relationship: str,
        source_logical_id: UUID,
        target_logical_id: UUID,
    ) -> CourseBlueprint:
        _validate_blueprint_relationship_request(
            previous_relationship,
            previous_source_logical_id,
            previous_target_logical_id,
        )
        _validate_blueprint_relationship_request(
            relationship,
            source_logical_id,
            target_logical_id,
        )
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.reconnect_blueprint_relationship(
                course_id,
                revision_id,
                instructor_id,
                previous_relationship,
                previous_source_logical_id,
                previous_target_logical_id,
                relationship,
                source_logical_id,
                target_logical_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def create_blueprint_topic(
        self,
        course_id: UUID,
        instructor_id: UUID,
        title: str,
        summary: str,
        start_seconds: float,
        end_seconds: float,
    ) -> CourseBlueprint:
        cleaned_title = title.strip()
        if not cleaned_title:
            raise CourseOSValidationError("Topic title is required.")
        if start_seconds < 0 or end_seconds <= start_seconds:
            raise CourseOSValidationError("Topic end time must be later than its start time.")
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.create_blueprint_topic(
                course_id,
                revision_id,
                instructor_id,
                cleaned_title[:240],
                summary.strip()[:4000],
                start_seconds,
                end_seconds,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def update_blueprint_topic(
        self,
        course_id: UUID,
        instructor_id: UUID,
        topic_id: UUID,
        title: str,
        summary: str,
        start_seconds: float,
        end_seconds: float,
    ) -> CourseBlueprint:
        cleaned_title = title.strip()
        if not cleaned_title:
            raise CourseOSValidationError("Topic title is required.")
        if start_seconds < 0 or end_seconds <= start_seconds:
            raise CourseOSValidationError("Topic end time must be later than its start time.")
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.update_blueprint_topic(
                course_id,
                revision_id,
                instructor_id,
                topic_id,
                cleaned_title[:240],
                summary.strip()[:4000],
                start_seconds,
                end_seconds,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def create_blueprint_concept(
        self,
        course_id: UUID,
        instructor_id: UUID,
        name: str,
        description: str,
        topic_ids: tuple[UUID, ...],
        sequence_after_id: UUID | None,
    ) -> CourseBlueprint:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise CourseOSValidationError("Concept name is required.")
        if not topic_ids:
            raise CourseOSValidationError("A concept must belong to at least one topic.")
        if len(topic_ids) != len(set(topic_ids)):
            raise CourseOSValidationError("Concept topic assignments cannot contain duplicates.")
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.create_blueprint_concept(
                course_id,
                revision_id,
                instructor_id,
                cleaned_name[:240],
                description.strip()[:4000],
                topic_ids,
                sequence_after_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def update_blueprint_concept(
        self,
        course_id: UUID,
        instructor_id: UUID,
        concept_id: UUID,
        name: str,
        description: str,
    ) -> CourseBlueprint:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise CourseOSValidationError("Concept name is required.")
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.update_blueprint_concept(
                course_id,
                revision_id,
                instructor_id,
                concept_id,
                cleaned_name[:240],
                description.strip()[:4000],
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def update_blueprint_concept_topics(
        self,
        course_id: UUID,
        instructor_id: UUID,
        concept_id: UUID,
        topic_ids: tuple[UUID, ...],
    ) -> CourseBlueprint:
        if not topic_ids:
            raise CourseOSValidationError("A concept must belong to at least one topic.")
        if len(topic_ids) != len(set(topic_ids)):
            raise CourseOSValidationError("Concept topic assignments cannot contain duplicates.")
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.update_blueprint_concept_topics(
                course_id,
                revision_id,
                instructor_id,
                concept_id,
                topic_ids,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def blueprint_mutation_impact(
        self,
        course_id: UUID,
        instructor_id: UUID,
        artifact_kind: str,
        artifact_id: UUID,
    ) -> BlueprintMutationImpact:
        if artifact_kind not in {"topic", "concept", "clip", "question"}:
            raise CourseOSValidationError(
                "Only topic, concept, clip, or question artifacts can be removed."
            )
        course = await self._require_owned_course(course_id, instructor_id)
        return await self._repository.blueprint_mutation_impact(
            course_id,
            _current_revision(course),
            artifact_kind,
            artifact_id,
        )

    async def remove_blueprint_artifact(
        self,
        course_id: UUID,
        instructor_id: UUID,
        artifact_kind: str,
        artifact_id: UUID,
    ) -> CourseBlueprint:
        if artifact_kind not in {"topic", "concept", "clip", "question"}:
            raise CourseOSValidationError(
                "Only topic, concept, clip, or question artifacts can be removed."
            )
        course = await self._require_editable_course(course_id, instructor_id)
        revision_id = _current_revision(course)
        try:
            await self._repository.remove_blueprint_artifact(
                course_id,
                revision_id,
                instructor_id,
                artifact_kind,
                artifact_id,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        return await self._repository.blueprint(course_id, revision_id, "working")

    async def revision_diff(self, course_id: UUID, instructor_id: UUID) -> RevisionDiff:
        course = await self._require_owned_course(course_id, instructor_id)
        if course.working_revision_id is None:
            raise CourseOSValidationError("Open an update revision to inspect changes.")
        return await self._repository.revision_diff(
            course.active_revision_id,
            course.working_revision_id,
        )

    async def review_bundles(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> tuple[ReviewBundle, ...]:
        course = await self._require_owned_course(course_id, instructor_id)
        return await self._repository.review_bundles(_current_revision(course))

    async def resolve_review_item(
        self,
        course_id: UUID,
        item_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
        instructor_revision: dict[str, Any] | None,
    ) -> ReviewItem:
        await self._require_owned_course(course_id, instructor_id)
        if decision == ReviewDecision.EDITED and not instructor_revision:
            raise CourseOSValidationError("An edited artifact must include your revision.")
        try:
            item = await self._repository.resolve_review_item(
                course_id,
                item_id,
                instructor_id,
                decision,
                instructor_revision,
            )
        except ValueError as exc:
            raise CourseOSValidationError(str(exc)) from exc
        if item is None:
            raise CourseOSValidationError("Review item not found.")
        return item

    async def resolve_review_bundle_remaining(
        self,
        course_id: UUID,
        bundle_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
    ) -> ReviewBundle:
        await self._require_owned_course(course_id, instructor_id)
        bundle = await self._repository.resolve_review_bundle_remaining(
            course_id,
            bundle_id,
            instructor_id,
            decision,
        )
        if bundle is None:
            raise CourseOSValidationError("Review bundle not found.")
        return bundle

    async def _require_instructor(self, user_id: UUID) -> None:
        if await self._repository.user_role(user_id) != "instructor":
            raise CourseOSValidationError("Only an instructor can use the teacher workspace.")

    async def _require_owned_course(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary:
        await self._require_instructor(instructor_id)
        course = await self._repository.get_course(course_id)
        if course is None or course.instructor_id != instructor_id:
            raise CourseOSValidationError("Instructor does not own this course.")
        return course

    async def _require_editable_course(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary:
        course = await self._require_owned_course(course_id, instructor_id)
        if course.working_revision_id is None and course.status == "published":
            try:
                course = await self._repository.create_working_revision(
                    course_id,
                    instructor_id,
                )
            except ValueError as exc:
                raise CourseOSValidationError(str(exc)) from exc
        if course.working_revision_id is None:
            raise CourseOSValidationError("Course has no editable working revision.")
        return course


def _current_revision(course: CourseSummary) -> UUID:
    revision_id = course.working_revision_id or course.active_revision_id
    if revision_id is None:
        raise CourseOSValidationError("Course has no active or working revision.")
    return revision_id


def _selected_revision(course: CourseSummary, revision_kind: str) -> UUID:
    if revision_kind == "active":
        if course.active_revision_id is None:
            raise CourseOSValidationError("Course has no active published revision.")
        return course.active_revision_id
    if revision_kind == "working":
        if course.working_revision_id is None:
            raise CourseOSValidationError("Course has no private working revision.")
        return course.working_revision_id
    raise CourseOSValidationError("Revision must be active or working.")


def _validate_assessment_draft(draft: AssessmentDraft) -> None:
    if not draft.body.strip():
        raise CourseOSValidationError("Assessment prompt is required.")
    if draft.type not in {"mcq", "short_answer", "worked_problem"}:
        raise CourseOSValidationError("Assessment type is not supported.")
    if not draft.correct_answer:
        raise CourseOSValidationError("A correct answer is required.")
    if not draft.confidence_prompt.strip():
        raise CourseOSValidationError("A confidence prompt is required.")
    if not draft.remediation_rules:
        raise CourseOSValidationError("At least one remediation route is required.")
    for rule in draft.remediation_rules:
        if not rule.wrong_answer_pattern.strip():
            raise CourseOSValidationError("Every remediation route needs a trigger pattern.")
        if rule.target_clip_id is None and rule.target_concept_id is None:
            raise CourseOSValidationError("Every remediation route needs a target.")


def _validate_routing_policy(policy: RoutingPolicyDraft) -> None:
    if policy.confidence_threshold < 1 or policy.confidence_threshold > 4:
        raise CourseOSValidationError("Confidence threshold must be between 1 and 4.")
    if policy.correct_attempts_for_mastery < 1:
        raise CourseOSValidationError("Correct attempts for mastery must be at least 1.")
    if policy.max_remediation_attempts < 0:
        raise CourseOSValidationError("Remediation attempts cannot be negative.")
    if policy.advancement_mode not in {
        "require_mastery",
        "allow_partial_understanding",
    }:
        raise CourseOSValidationError("Advancement mode is not supported.")


def _validate_blueprint_relationship_request(
    relationship: str,
    source_logical_id: UUID,
    target_logical_id: UUID,
) -> None:
    if relationship not in {
        "contains",
        "requires",
        "teaches",
        "assesses",
        "remediates_to",
        "cites",
    }:
        raise CourseOSValidationError(
            "Relationship must be Structure, Prerequisite, Teaching, Assessment, "
            "Remediation, or Citation."
        )
    if source_logical_id == target_logical_id:
        raise CourseOSValidationError("A relationship cannot connect an artifact to itself.")


def _is_evidence_question(content: str) -> bool:
    normalized = content.strip().lower()
    return normalized.startswith(
        (
            "how many learners",
            "how are learners",
            "how did learners",
            "what are learners",
            "what is learner",
            "what is the learner",
            "which learners",
            "which concepts",
            "which questions",
            "where are learners",
            "where do learners",
            "show me learner",
            "show learner",
        )
    )


def _evidence_answer(evidence: dict[str, Any]) -> str:
    learners = int(evidence.get("enrolled_learners", 0))
    attempts = int(evidence.get("attempts", 0))
    incorrect = int(evidence.get("incorrect_attempts", 0))
    low_confidence = int(evidence.get("low_confidence_attempts", 0))
    open_signals = int(evidence.get("open_signals", 0))
    if attempts == 0:
        return (
            f"The saved course evidence currently shows {learners} enrolled learner"
            f"{'s' if learners != 1 else ''}, but no assessment attempts yet. "
            "I won’t infer struggle or mastery until learners generate evidence."
        )
    return (
        f"Based on {attempts} saved assessment attempt{'s' if attempts != 1 else ''} "
        f"from {learners} enrolled learner{'s' if learners != 1 else ''}, "
        f"{incorrect} were incorrect and {low_confidence} were low-confidence. "
        f"There {'are' if open_signals != 1 else 'is'} {open_signals} open "
        f"evidence-backed insight{'s' if open_signals != 1 else ''}."
    )
