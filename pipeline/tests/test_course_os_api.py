from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.course_os.models import CourseSummary, DashboardSnapshot
from app.dependencies import get_course_os_service
from app.main import app


def test_teacher_dashboard_returns_empty_state_metrics() -> None:
    instructor_id = uuid4()
    service = AsyncMock()
    service.dashboard.return_value = DashboardSnapshot(
        courses=(),
        attention=(),
        total_courses=0,
        published_courses=0,
        courses_in_review=0,
        active_learners=0,
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.get(
            "/instructors/me/dashboard",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert response.status_code == 200
        assert response.json() == {
            "courses": [],
            "attention": [],
            "total_courses": 0,
            "published_courses": 0,
            "courses_in_review": 0,
            "active_learners": 0,
        }
        service.dashboard.assert_awaited_once_with(instructor_id)
    finally:
        app.dependency_overrides.clear()


def test_create_course_returns_working_revision() -> None:
    instructor_id = uuid4()
    course = CourseSummary(
        id=uuid4(),
        instructor_id=instructor_id,
        title="Mechanics",
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
    service = AsyncMock()
    service.create_course.return_value = course
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/courses",
            headers={"X-User-ID": str(instructor_id)},
            json={"title": "Mechanics"},
        )

        assert response.status_code == 201
        assert response.json()["working_revision_id"] == str(course.working_revision_id)
        assert response.json()["revision_status"] == "building"
    finally:
        app.dependency_overrides.clear()
