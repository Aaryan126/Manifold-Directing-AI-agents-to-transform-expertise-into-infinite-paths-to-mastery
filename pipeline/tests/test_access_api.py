from fastapi.testclient import TestClient

from app.access.service import AccessService
from app.dependencies import get_access_service
from app.main import app
from tests.test_access_service import MemoryAccessRepository


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
        status = client.get(
            f"/courses/{repository.course.id}/enrollment",
            headers={"X-User-ID": str(repository.learner_id)},
        )

        assert publish.status_code == 200
        assert publish.json()["status"] == "published"
        assert enrollment.status_code == 200
        assert status.json() == {"enrolled": True}
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
