from typing import Any
from uuid import UUID

from app.course_os.dashboard_assistant import DashboardAssistant, LocalDashboardAssistant
from app.course_os.models import (
    AssessmentDraft,
    AssessmentWorkspace,
    ConversationMessage,
    CourseAssessment,
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
    ) -> None:
        self._repository = repository
        self._dashboard_assistant = dashboard_assistant or LocalDashboardAssistant()

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
        proposal = await self._repository.create_proposal(
            course_id,
            revision_id,
            instructor_message.id,
            instruction,
        )
        response = await self._repository.add_message(
            course_id,
            revision_id,
            "manifold",
            "I’ve translated that into a course directive. "
            "Review it before I use it to change the draft.",
            (
                {
                    "type": "proposal",
                    "proposal_id": str(proposal.id),
                    "status": proposal.status,
                    "proposed_state": proposal.proposed_state,
                    "rationale": proposal.rationale,
                },
            ),
        )
        return response, proposal

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
