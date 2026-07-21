from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

from app.course_os.models import CourseSummary
from app.course_os.postgres_repository import _is_portfolio_course


def _course() -> CourseSummary:
    return CourseSummary(
        id=uuid4(),
        instructor_id=uuid4(),
        title="Untitled course",
        description=None,
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


def test_portfolio_excludes_empty_shells_and_active_builds() -> None:
    shell = _course()
    active = replace(
        shell,
        source_count=1,
        generation_status="running",
        generation_progress=42,
    )

    assert not _is_portfolio_course(shell)
    assert not _is_portfolio_course(active)


def test_portfolio_includes_named_completed_drafts_and_published_courses() -> None:
    shell = _course()
    review_ready = replace(
        shell,
        title="Designing Effective Learning Loops",
        source_count=1,
        generation_status="waiting_review",
        generation_progress=100,
    )
    published = replace(shell, title="Mechanics for Designers", status="published")

    assert _is_portfolio_course(review_ready)
    assert _is_portfolio_course(published)


def test_portfolio_keeps_placeholder_drafts_out_even_if_generation_finishes() -> None:
    shell = _course()
    unnamed = replace(
        shell,
        source_count=1,
        generation_status="waiting_review",
        generation_progress=100,
    )

    assert not _is_portfolio_course(unnamed)


def test_portfolio_keeps_placeholder_published_courses_out() -> None:
    assert not _is_portfolio_course(replace(_course(), status="published"))
