from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.dashboard.models import DashboardSignalStatus
from app.dashboard.service import DashboardService
from app.dependencies import get_dashboard_service
from app.main import app
from tests.test_dashboard_service import MemoryDashboardRepository


@pytest.mark.anyio
async def test_dashboard_api_refresh_accept_and_override_flow() -> None:
    repository = MemoryDashboardRepository()
    service = DashboardService(repository)
    app.dependency_overrides[get_dashboard_service] = lambda: service

    try:
        async with _client() as client:
            dashboard = await client.get(f"/courses/{repository.course_id}/dashboard")
            assert dashboard.status_code == 200
            body = dashboard.json()
            assert body["not_enough_data"] is False
            assert body["concept_performance"][0]["concept_name"] == "Elimination"
            assert body["concept_performance"][0]["struggling_learners"] == 3
            assert body["question_performance"] == []
            assert body["clip_performance"] == []
            signal_id = body["signals"][0]["id"]

            accepted = await client.post(
                f"/dashboard/signals/{signal_id}/accept",
                json={
                    "action": "accept_ai_suggestion",
                    "note": "Apply going forward.",
                    "retroactive": False,
                },
            )
            assert accepted.status_code == 200
            assert accepted.json()["status"] == DashboardSignalStatus.ACCEPTED.value
            assert repository.mutations

            override = await client.post(
                f"/courses/{repository.course_id}/dashboard/learner-override",
                json={
                    "learner_id": str(repository.concept_id),
                    "concept_id": str(repository.concept_id),
                    "action": "skip_ahead",
                    "note": "Manual exception.",
                },
            )
            assert override.status_code == 200
            assert override.json()["ok"] is True
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_dashboard_api_rejects_invalid_learner_override() -> None:
    repository = MemoryDashboardRepository()
    service = DashboardService(repository)
    app.dependency_overrides[get_dashboard_service] = lambda: service

    try:
        async with _client() as client:
            response = await client.post(
                f"/courses/{repository.course_id}/dashboard/learner-override",
                json={
                    "learner_id": str(repository.concept_id),
                    "concept_id": str(repository.concept_id),
                    "action": "teleport",
                },
            )
            assert response.status_code == 400
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_dashboard_api_dismiss_does_not_mutate_signal_entity() -> None:
    repository = MemoryDashboardRepository()
    signal = repository.make_signal()
    repository.signals.append(signal)
    service = DashboardService(repository)
    app.dependency_overrides[get_dashboard_service] = lambda: service

    try:
        async with _client() as client:
            response = await client.post(
                f"/dashboard/signals/{signal.id}/dismiss",
                json={"action": "dismiss", "note": "No action."},
            )
            assert response.status_code == 200
            assert response.json()["status"] == "dismissed"
            assert repository.mutations == []
    finally:
        app.dependency_overrides.clear()


@asynccontextmanager
async def _client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
