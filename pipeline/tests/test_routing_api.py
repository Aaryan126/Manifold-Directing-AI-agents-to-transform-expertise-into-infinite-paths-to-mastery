from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.dependencies import get_routing_service
from app.main import app
from app.routing.models import RoutingPolicy
from app.routing.service import RoutingService
from tests.test_routing_service import MemoryRoutingRepository


@pytest.mark.anyio
async def test_routing_api_attempt_and_policy_flow() -> None:
    repository = MemoryRoutingRepository()
    service = RoutingService(repository)
    app.dependency_overrides[get_routing_service] = lambda: service

    try:
        async with _client() as client:
            learner_response = await client.post(
                f"/courses/{repository.course_id}/routing/demo-learner",
            )
            assert learner_response.status_code == 200
            learner_id = learner_response.json()["learner_id"]

            policy_response = await client.put(
                f"/courses/{repository.course_id}/routing/policies/{repository.current_concept_id}",
                json={
                    "confidence_threshold": 4,
                    "correct_attempts_for_mastery": 1,
                    "advancement_mode": "require_mastery",
                    "max_remediation_attempts": 2,
                },
            )
            assert policy_response.status_code == 200
            assert policy_response.json()["confidence_threshold"] == 4

            policies = await client.get(f"/courses/{repository.course_id}/routing/policies")
            assert policies.status_code == 200
            assert policies.json()[0]["concept_id"] == str(repository.current_concept_id)

            attempt_response = await client.post(
                f"/learners/{learner_id}/questions/{repository.question_id}/attempt",
                json={
                    "answer": {"answer": "x"},
                    "correctness": True,
                    "confidence": 4,
                },
            )
            assert attempt_response.status_code == 200
            assert attempt_response.json()["action"] == "advance"
            assert attempt_response.json()["target_concept_id"] == str(repository.next_concept_id)

            progress = await client.get(
                f"/learners/{learner_id}/courses/{repository.course_id}/progress",
            )
            assert progress.status_code == 200
            assert progress.json()[0]["state"] == "mastered"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_routing_api_returns_stuck_signal_when_loop_limit_is_hit() -> None:
    repository = MemoryRoutingRepository(policy=RoutingPolicy(max_remediation_attempts=0))
    service = RoutingService(repository)
    app.dependency_overrides[get_routing_service] = lambda: service

    try:
        async with _client() as client:
            response = await client.post(
                f"/learners/{repository.learner_id}/questions/{repository.question_id}/attempt",
                json={
                    "answer": {"answer": "x"},
                    "correctness": False,
                    "confidence": 1,
                },
            )
            assert response.status_code == 200
            body = response.json()
            assert body["action"] == "flag_instructor"
            assert body["dashboard_signal_id"] is not None
    finally:
        app.dependency_overrides.clear()


@asynccontextmanager
async def _client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
