from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import AsyncMock, create_autospec
from uuid import uuid4

import pytest

from app.course_os.models import (
    ConversationMessage,
    CourseCreate,
    CourseProposal,
    CourseSummary,
    RevisionDiff,
)
from app.course_os.repository import CourseOSRepository
from app.course_os.service import CourseOSService, CourseOSValidationError


def _course() -> CourseSummary:
    return CourseSummary(
        id=uuid4(),
        instructor_id=uuid4(),
        title="Vectors",
        description="A first course",
        status="draft",
        active_revision_id=None,
        working_revision_id=uuid4(),
        revision_status="building",
        generation_run_id=None,
        generation_status=None,
        generation_phase=None,
        generation_progress=0,
        source_count=0,
        topic_count=0,
        concept_count=0,
        pending_review_count=0,
        open_signal_count=0,
        updated_at=datetime.now(UTC),
    )


@pytest.mark.anyio
async def test_create_course_requires_instructor_and_normalizes_copy() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = _course()
    repository.user_role = AsyncMock(return_value="instructor")
    repository.create_course = AsyncMock(return_value=course)
    service = CourseOSService(repository)

    created = await service.create_course(
        course.instructor_id,
        CourseCreate(title="  Vectors  ", description="  A first course  "),
    )

    assert created == course
    repository.create_course.assert_awaited_once_with(
        course.instructor_id,
        CourseCreate(title="Vectors", description="A first course", brief={}),
    )


@pytest.mark.anyio
async def test_learner_cannot_open_teacher_dashboard() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    repository.user_role = AsyncMock(return_value="learner")
    service = CourseOSService(repository)

    with pytest.raises(CourseOSValidationError, match="Only an instructor"):
        await service.dashboard(uuid4())


@pytest.mark.anyio
async def test_chat_turn_creates_reviewable_directive_instead_of_mutating_course() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = _course()
    instructor_message = ConversationMessage(
        id=uuid4(),
        role="instructor",
        content="Make the first example more concrete.",
        blocks=(),
        created_at=datetime.now(UTC),
    )
    proposal = CourseProposal(
        id=uuid4(),
        proposal_type="brief_update",
        artifact_type="course_brief",
        logical_artifact_id=None,
        before_state=None,
        proposed_state={"instruction": instructor_message.content},
        rationale="Use this as a durable directive.",
        status="proposed",
        created_at=datetime.now(UTC),
    )
    response_message = ConversationMessage(
        id=uuid4(),
        role="manifold",
        content="Review this directive.",
        blocks=({"type": "proposal", "proposal_id": str(proposal.id)},),
        created_at=datetime.now(UTC),
    )
    repository.user_role = AsyncMock(return_value="instructor")
    repository.get_course = AsyncMock(return_value=course)
    repository.add_message = AsyncMock(side_effect=[instructor_message, response_message])
    repository.create_proposal = AsyncMock(return_value=proposal)
    service = CourseOSService(repository)

    response, created_proposal = await service.send_message(
        course.id,
        course.instructor_id,
        instructor_message.content,
    )

    assert response == response_message
    assert created_proposal == proposal
    repository.create_proposal.assert_awaited_once_with(
        course.id,
        course.working_revision_id,
        instructor_message.id,
        instructor_message.content,
    )


@pytest.mark.anyio
async def test_copilot_question_answers_from_saved_evidence_without_a_mutation_proposal() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = _course()
    instructor_message = ConversationMessage(
        id=uuid4(),
        role="instructor",
        content="How are learners doing?",
        blocks=(),
        created_at=datetime.now(UTC),
    )
    response_message = ConversationMessage(
        id=uuid4(),
        role="manifold",
        content="Based on saved evidence.",
        blocks=({"type": "evidence", "attempts": 12},),
        created_at=datetime.now(UTC),
    )
    repository.user_role = AsyncMock(return_value="instructor")
    repository.get_course = AsyncMock(return_value=course)
    repository.add_message = AsyncMock(side_effect=[instructor_message, response_message])
    repository.course_evidence = AsyncMock(
        return_value={
            "enrolled_learners": 3,
            "attempts": 12,
            "incorrect_attempts": 4,
            "low_confidence_attempts": 2,
            "open_signals": 1,
        }
    )
    service = CourseOSService(repository)

    response, proposal = await service.send_message(
        course.id,
        course.instructor_id,
        instructor_message.content,
    )

    assert response == response_message
    assert proposal is None
    repository.create_proposal.assert_not_awaited()
    repository.course_evidence.assert_awaited_once_with(course.id, course.working_revision_id)


@pytest.mark.anyio
async def test_live_course_requires_working_revision_before_chat_can_propose_mutation() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = replace(
        _course(),
        status="published",
        active_revision_id=uuid4(),
        working_revision_id=None,
    )
    repository.user_role = AsyncMock(return_value="instructor")
    repository.get_course = AsyncMock(return_value=course)
    service = CourseOSService(repository)

    with pytest.raises(CourseOSValidationError, match="Open an update revision"):
        await service.send_message(course.id, course.instructor_id, "Shorten the introduction")

    repository.add_message.assert_not_awaited()


@pytest.mark.anyio
async def test_revision_diff_is_scoped_to_owned_active_and_working_revisions() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = replace(_course(), status="published", active_revision_id=uuid4())
    expected = RevisionDiff(
        active_revision_id=course.active_revision_id,
        working_revision_id=course.working_revision_id,
        changes=(),
    )
    repository.user_role = AsyncMock(return_value="instructor")
    repository.get_course = AsyncMock(return_value=course)
    repository.revision_diff = AsyncMock(return_value=expected)
    service = CourseOSService(repository)

    result = await service.revision_diff(course.id, course.instructor_id)

    assert result == expected
    repository.revision_diff.assert_awaited_once_with(
        course.active_revision_id,
        course.working_revision_id,
    )


@pytest.mark.anyio
async def test_published_course_opens_isolated_working_revision() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = replace(
        _course(),
        status="published",
        active_revision_id=uuid4(),
        working_revision_id=None,
        revision_status="published",
    )
    working = replace(
        course,
        working_revision_id=uuid4(),
        revision_status="building",
    )
    repository.user_role = AsyncMock(return_value="instructor")
    repository.get_course = AsyncMock(return_value=course)
    repository.create_working_revision = AsyncMock(return_value=working)
    service = CourseOSService(repository)

    result = await service.open_working_revision(course.id, course.instructor_id)

    assert result == working
    repository.create_working_revision.assert_awaited_once_with(
        course.id,
        course.instructor_id,
    )


@pytest.mark.anyio
async def test_draft_course_cannot_open_second_revision() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    course = _course()
    repository.user_role = AsyncMock(return_value="instructor")
    repository.get_course = AsyncMock(return_value=course)
    service = CourseOSService(repository)

    with pytest.raises(CourseOSValidationError, match="already has a working revision"):
        await service.open_working_revision(course.id, course.instructor_id)
