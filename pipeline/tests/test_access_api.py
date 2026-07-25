from fastapi.testclient import TestClient

from app.access.models import LearnerCourseSummary
from app.access.service import AccessService
from app.dependencies import get_access_service
from app.main import app
from tests.test_access_service import MemoryAccessRepository, learner_experience_fixture


def test_publish_then_enroll_development_identity_flow() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)
    app.dependency_overrides[get_access_service] = lambda: service
    client = TestClient(app)

    try:
        publish = client.post(
            f"/courses/{repository.course.id}/publish",
            headers={"X-User-ID": str(repository.instructor_id)},
        )
        enrollment = client.post(
            f"/courses/{repository.course.id}/enrollment",
            headers={"X-User-ID": str(repository.learner_id)},
        )
        repeated_enrollment = client.post(
            f"/courses/{repository.course.id}/enrollment",
            headers={"X-User-ID": str(repository.learner_id)},
        )
        status = client.get(
            f"/courses/{repository.course.id}/enrollment",
            headers={"X-User-ID": str(repository.learner_id)},
        )

        assert publish.status_code == 200
        assert publish.json()["status"] == "published"
        assert enrollment.status_code == 200
        assert repeated_enrollment.status_code == 200
        assert status.json() == {"enrolled": True}
        assert repository.enrollments == {(repository.learner_id, repository.course.id)}
    finally:
        app.dependency_overrides.clear()


def test_learner_course_portfolio_reports_course_unit_composition() -> None:
    repository = MemoryAccessRepository()
    repository.learner_course_summaries = (
        LearnerCourseSummary(
            id=repository.course.id,
            title="A multi-lecture course",
            description="One enrollment contains the complete published Course Flow.",
            enrolled=True,
            topic_count=5,
            concept_count=8,
            mastered_concept_count=3,
            lecture_count=2,
            quiz_count=1,
            assignment_count=1,
        ),
    )
    service = AccessService(repository)
    app.dependency_overrides[get_access_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.get(
            "/learners/me/courses",
            headers={"X-User-ID": str(repository.learner_id)},
        )

        assert response.status_code == 200
        assert response.json() == [
            {
                "id": str(repository.course.id),
                "title": "A multi-lecture course",
                "description": "One enrollment contains the complete published Course Flow.",
                "enrolled": True,
                "topic_count": 5,
                "concept_count": 8,
                "mastered_concept_count": 3,
                "lecture_count": 2,
                "quiz_count": 1,
                "assignment_count": 1,
            }
        ]
    finally:
        app.dependency_overrides.clear()


def test_learner_cannot_publish_course() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)
    app.dependency_overrides[get_access_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            f"/courses/{repository.course.id}/publish",
            headers={"X-User-ID": str(repository.learner_id)},
        )

        assert response.status_code == 400
        assert "Only an instructor" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_development_login_returns_role_specific_identity_without_exposing_password() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)
    app.dependency_overrides[get_access_service] = lambda: service
    client = TestClient(app)

    try:
        success = client.post(
            "/development/login",
            json={"username": "David", "password": "David1"},
        )
        rejected = client.post(
            "/development/login",
            json={"username": "David", "password": "incorrect"},
        )

        assert success.status_code == 200
        assert success.json()["display_name"] == "David"
        assert success.json()["role"] == "instructor"
        assert "password" not in success.json()
        assert rejected.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_learner_course_api_returns_reviewed_payload_without_answer_key() -> None:
    repository = MemoryAccessRepository()
    repository.learner_experience = learner_experience_fixture(repository)
    service = AccessService(repository)
    app.dependency_overrides[get_access_service] = lambda: service
    client = TestClient(app)

    try:
        learner = client.get(
            f"/learners/me/courses/{repository.course.id}",
            headers={"X-User-ID": str(repository.learner_id)},
        )
        instructor = client.get(
            "/learners/me/courses",
            headers={"X-User-ID": str(repository.instructor_id)},
        )

        assert learner.status_code == 200
        assert [unit["title"] for unit in learner.json()["units"]] == [
            "Lecture one",
            "Lecture two",
        ]
        assert learner.json()["clips"][0]["start_seconds"] == 12.0
        assert learner.json()["questions"][0]["choices"] == ["A", "B"]
        assert "correct_answer" not in learner.json()["questions"][0]
        assert instructor.status_code == 403
    finally:
        app.dependency_overrides.clear()
