from uuid import uuid4

import pytest

from app.course_os.dashboard_assistant import LocalDashboardAssistant, search_dashboard_evidence
from app.course_os.models import (
    CourseRadarItem,
    DashboardActivityPoint,
    DashboardSnapshot,
)


def _snapshot() -> DashboardSnapshot:
    return DashboardSnapshot(
        courses=(),
        attention=(),
        total_courses=2,
        published_courses=2,
        courses_in_review=0,
        active_learners=5,
        new_learners=1,
        activity_history=(
            DashboardActivityPoint("2026-07-20", 2),
            DashboardActivityPoint("2026-07-21", 5),
        ),
        course_radar=(
            CourseRadarItem(
                course_id=uuid4(),
                title="Mechanics",
                activity_trend=(0, 1, 2, 2, 3, 4, 5),
                active_learners=5,
                accuracy_percent=60,
                confidence_percent=80,
                confident_incorrect_attempts=4,
                clip_completion_percent=55,
                mastery_percent=35,
                mastery_movement=1,
                open_issues=3,
                agent_status="needs_attention",
                agent_role="learning_analyst",
            ),
            CourseRadarItem(
                course_id=uuid4(),
                title="Vectors",
                activity_trend=(0, 0, 1, 1, 1, 1, 1),
                active_learners=1,
                accuracy_percent=90,
                confidence_percent=70,
                confident_incorrect_attempts=0,
                clip_completion_percent=92,
                mastery_percent=70,
                mastery_movement=2,
                open_issues=0,
                agent_status="monitoring",
                agent_role=None,
            ),
        ),
    )


def test_evidence_search_retrieves_relevant_saved_metrics() -> None:
    records = search_dashboard_evidence(
        "Where are learners confident but incorrect?",
        _snapshot(),
    )

    assert records[0].reference.metric in {"confidence", "confident-incorrect"}
    assert any(record.reference.value == "4" for record in records[:5])
    assert all(record.reference.id for record in records)


@pytest.mark.anyio
async def test_local_dashboard_assistant_returns_structured_citations() -> None:
    snapshot = _snapshot()

    result = await LocalDashboardAssistant().analyze(
        "Where are learners confident but incorrect?",
        snapshot,
    )

    assert result.intent == "question"
    assert result.course_title == "Mechanics"
    assert result.searched_course_count == 2
    assert result.evidence
    assert all(reference.id for reference in result.evidence)


@pytest.mark.anyio
async def test_local_change_request_remains_a_private_intent() -> None:
    result = await LocalDashboardAssistant().analyze(
        "Prepare improvements for my weakest topic.",
        _snapshot(),
    )

    assert result.intent == "change_request"
    assert result.course_title == "Mechanics"
