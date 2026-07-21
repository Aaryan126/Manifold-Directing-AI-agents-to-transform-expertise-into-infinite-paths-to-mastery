from typing import Any
from uuid import UUID

from app.course_os.models import (
    ConversationMessage,
    CourseCreate,
    CourseMap,
    CourseProposal,
    CourseSummary,
    DashboardSnapshot,
    GenerationRun,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionDiff,
)
from app.course_os.repository import CourseOSRepository


class CourseOSValidationError(ValueError):
    pass


class CourseOSService:
    def __init__(self, repository: CourseOSRepository) -> None:
        self._repository = repository

    async def dashboard(self, instructor_id: UUID) -> DashboardSnapshot:
        await self._require_instructor(instructor_id)
        return await self._repository.dashboard(instructor_id)

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


def _current_revision(course: CourseSummary) -> UUID:
    revision_id = course.working_revision_id or course.active_revision_id
    if revision_id is None:
        raise CourseOSValidationError("Course has no active or working revision.")
    return revision_id


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
