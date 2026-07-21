from abc import ABC, abstractmethod
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
    GenerationTask,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionDiff,
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
    async def generation_topic_ids(self, revision_id: UUID) -> tuple[UUID, ...]: ...

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
