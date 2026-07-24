from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.course_os.models import BlueprintNode, CourseBlueprint, CourseSummary
from app.intelligence.models import SpecialistRole
from app.intelligence.service import CourseIntelligenceService, IntelligenceValidationError


def _working_course() -> CourseSummary:
    return CourseSummary(
        id=uuid4(),
        instructor_id=uuid4(),
        title="Adaptive systems",
        description=None,
        status="draft",
        active_revision_id=None,
        working_revision_id=uuid4(),
        revision_status="building",
        generation_run_id=None,
        generation_status=None,
        generation_phase=None,
        generation_progress=0,
        source_count=1,
        topic_count=0,
        concept_count=0,
        pending_review_count=0,
        open_signal_count=0,
        updated_at=datetime.now(UTC),
    )


@pytest.mark.anyio
async def test_blueprint_layout_accepts_typed_source_artifacts() -> None:
    course = _working_course()
    source_logical_id = uuid4()
    course_os = AsyncMock()
    course_os.course.return_value = course
    course_os.blueprint.return_value = CourseBlueprint(
        course_id=course.id,
        revision_id=course.working_revision_id,
        revision_kind="working",
        nodes=(
            BlueprintNode(
                id=uuid4(),
                logical_id=source_logical_id,
                kind="source",
                title="Lecture source",
                status="accepted",
                parent_id=None,
                metadata={},
            ),
        ),
        edges=(),
        uncovered_concept_ids=(),
    )
    repository = AsyncMock()
    service = CourseIntelligenceService(repository, course_os, AsyncMock())

    await service.save_map_layout(
        course.id,
        course.instructor_id,
        {source_logical_id: (120.0, 240.0)},
    )

    course_os.blueprint.assert_awaited_once_with(
        course.id,
        course.instructor_id,
        "working",
    )
    repository.save_map_layout.assert_awaited_once_with(
        course.working_revision_id,
        {source_logical_id: (120.0, 240.0)},
    )


@pytest.mark.anyio
async def test_blueprint_layout_rejects_artifacts_outside_the_revision() -> None:
    course = _working_course()
    course_os = AsyncMock()
    course_os.course.return_value = course
    course_os.blueprint.return_value = CourseBlueprint(
        course_id=course.id,
        revision_id=course.working_revision_id,
        revision_kind="working",
        nodes=(),
        edges=(),
        uncovered_concept_ids=(),
    )
    repository = AsyncMock()
    service = CourseIntelligenceService(repository, course_os, AsyncMock())

    with pytest.raises(IntelligenceValidationError, match="unknown artifact"):
        await service.save_map_layout(
            course.id,
            course.instructor_id,
            {uuid4(): (10.0, 20.0)},
        )

    repository.save_map_layout.assert_not_awaited()


@pytest.mark.anyio
async def test_cleanup_blueprint_requires_target_and_creates_reviewable_task() -> None:
    course = _working_course()
    target_id = uuid4()
    course_os = AsyncMock()
    course_os.course.return_value = course
    repository = AsyncMock()
    repository.create_agent_task.return_value = object()
    service = CourseIntelligenceService(repository, course_os, AsyncMock())

    with pytest.raises(IntelligenceValidationError, match="require an artifact target"):
        await service.request_task(
            course.id,
            course.instructor_id,
            specialist_role=SpecialistRole.CURRICULUM_ARCHITECT,
            task_type="cleanup_blueprint",
            target_artifact_type=None,
            target_logical_artifact_id=None,
            instruction="Inspect my edit.",
            evidence={},
        )

    await service.request_task(
        course.id,
        course.instructor_id,
        specialist_role=SpecialistRole.CURRICULUM_ARCHITECT,
        task_type="cleanup_blueprint",
        target_artifact_type="concept",
        target_logical_artifact_id=target_id,
        instruction="  Inspect adjacent coverage.  ",
        evidence={"adjacent_artifacts": []},
    )

    repository.create_agent_task.assert_awaited_once_with(
        course_id=course.id,
        revision_id=course.working_revision_id,
        specialist_role=SpecialistRole.CURRICULUM_ARCHITECT,
        task_type="cleanup_blueprint",
        target_artifact_type="concept",
        target_logical_artifact_id=target_id,
        request_context={"instruction": "Inspect adjacent coverage."},
        evidence_snapshot={"adjacent_artifacts": []},
    )
