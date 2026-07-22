from typing import Any
from uuid import UUID

from fastapi import UploadFile

from app.course_os.models import CourseSummary
from app.course_os.service import CourseOSService
from app.intelligence.models import (
    AgentTask,
    AgentTaskProposal,
    CourseSource,
    SourceCitation,
    SourcePurpose,
    SourceReviewStatus,
    SpecialistRole,
)
from app.intelligence.postgres_repository import PostgresIntelligenceRepository
from app.intelligence.storage import SupplementalSourceStorage


class IntelligenceValidationError(ValueError):
    pass


class CourseIntelligenceService:
    def __init__(
        self,
        repository: PostgresIntelligenceRepository,
        course_os: CourseOSService,
        storage: SupplementalSourceStorage,
    ) -> None:
        self._repository = repository
        self._course_os = course_os
        self._storage = storage

    async def sources(self, course_id: UUID, instructor_id: UUID) -> tuple[CourseSource, ...]:
        course = await self._course_os.course(course_id, instructor_id)
        return await self._repository.list_sources(course_id, _current_revision(course))

    async def upload_source(
        self,
        course_id: UUID,
        instructor_id: UUID,
        upload: UploadFile,
        purpose: SourcePurpose,
    ) -> CourseSource:
        course = await self._editable_course(course_id, instructor_id)
        try:
            stored = await self._storage.store(upload)
            source_type, mime_type = _source_type(upload)
            return await self._repository.create_source(
                course_id=course_id,
                revision_id=_current_revision(course),
                filename=(upload.filename or f"Supporting material.{source_type}")[:240],
                source_type=source_type,
                mime_type=mime_type,
                size_bytes=stored.size_bytes,
                checksum_sha256=stored.checksum_sha256,
                storage_uri=str(stored.path),
                purpose=purpose,
            )
        except ValueError as exc:
            raise IntelligenceValidationError(str(exc)) from exc

    async def update_source(
        self,
        course_id: UUID,
        source_id: UUID,
        instructor_id: UUID,
        *,
        purpose: SourcePurpose,
        review_status: SourceReviewStatus,
        learner_visible: bool,
    ) -> CourseSource:
        if learner_visible and (
            purpose is SourcePurpose.AI_CONTEXT
            or review_status not in {SourceReviewStatus.ACCEPTED, SourceReviewStatus.EDITED}
        ):
            raise IntelligenceValidationError(
                "Only a reviewed learner resource can be visible to learners."
            )
        course = await self._editable_course(course_id, instructor_id)
        source = await self._repository.update_source(
            course_id,
            _current_revision(course),
            source_id,
            purpose=purpose,
            review_status=review_status,
            learner_visible=learner_visible,
        )
        if source is None:
            raise IntelligenceValidationError("Supplemental source not found.")
        return source

    async def retry_source(
        self,
        course_id: UUID,
        source_id: UUID,
        instructor_id: UUID,
    ) -> None:
        course = await self._editable_course(course_id, instructor_id)
        if not await self._repository.retry_source(
            course_id,
            _current_revision(course),
            source_id,
        ):
            raise IntelligenceValidationError("Supplemental source not found.")

    async def tasks(self, course_id: UUID, instructor_id: UUID) -> tuple[AgentTask, ...]:
        await self._course_os.course(course_id, instructor_id)
        return await self._repository.list_agent_tasks(course_id)

    async def task(
        self,
        course_id: UUID,
        task_id: UUID,
        instructor_id: UUID,
    ) -> tuple[AgentTask, tuple[AgentTaskProposal, ...]]:
        await self._course_os.course(course_id, instructor_id)
        task = await self._repository.get_agent_task(course_id, task_id)
        if task is None:
            raise IntelligenceValidationError("Specialist task not found.")
        return task, await self._repository.agent_task_proposals(task)

    async def request_task(
        self,
        course_id: UUID,
        instructor_id: UUID,
        *,
        specialist_role: SpecialistRole,
        task_type: str,
        target_artifact_type: str | None,
        target_logical_artifact_id: UUID | None,
        instruction: str,
        evidence: dict[str, Any],
    ) -> AgentTask:
        if task_type not in {"investigate", "prepare_improvement"}:
            raise IntelligenceValidationError("Unsupported specialist task type.")
        if task_type == "prepare_improvement" and (
            target_artifact_type is None or target_logical_artifact_id is None
        ):
            raise IntelligenceValidationError("Prepared improvements require an artifact target.")
        course = await self._editable_course(course_id, instructor_id)
        return await self._repository.create_agent_task(
            course_id=course_id,
            revision_id=_current_revision(course),
            specialist_role=specialist_role,
            task_type=task_type,
            target_artifact_type=target_artifact_type,
            target_logical_artifact_id=target_logical_artifact_id,
            request_context={"instruction": instruction.strip()},
            evidence_snapshot=evidence,
        )

    async def search(
        self,
        course_id: UUID,
        instructor_id: UUID,
        query: str,
    ) -> tuple[SourceCitation, ...]:
        course = await self._course_os.course(course_id, instructor_id)
        cleaned = query.strip()
        if not cleaned:
            return ()
        return await self._repository.search_sources(
            course_id,
            _current_revision(course),
            cleaned,
        )

    async def save_map_layout(
        self,
        course_id: UUID,
        instructor_id: UUID,
        positions: dict[UUID, tuple[float, float]],
    ) -> None:
        course = await self._editable_course(course_id, instructor_id)
        blueprint = await self._course_os.blueprint(course_id, instructor_id, "working")
        allowed = {node.logical_id for node in blueprint.nodes}
        if not set(positions).issubset(allowed):
            raise IntelligenceValidationError("Blueprint layout contains an unknown artifact.")
        await self._repository.save_map_layout(_current_revision(course), positions)

    async def _editable_course(self, course_id: UUID, instructor_id: UUID) -> CourseSummary:
        course = await self._course_os.course(course_id, instructor_id)
        if course.status == "published" and course.working_revision_id is None:
            return await self._course_os.open_working_revision(course_id, instructor_id)
        if course.working_revision_id is None:
            raise IntelligenceValidationError("Course has no editable working revision.")
        return course


def _current_revision(course: CourseSummary) -> UUID:
    revision_id = course.working_revision_id or course.active_revision_id
    if revision_id is None:
        raise IntelligenceValidationError("Course has no active or working revision.")
    return revision_id


def _source_type(upload: UploadFile) -> tuple[str, str]:
    suffix = (upload.filename or "").lower()
    if suffix.endswith(".pdf"):
        return "pdf", "application/pdf"
    if suffix.endswith(".pptx"):
        return "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    raise IntelligenceValidationError("Only PDF and PowerPoint (.pptx) sources are supported.")
