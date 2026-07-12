from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.audit.models import AuditEventCreate
from app.audit.service import AuditService
from app.dependencies import get_audit_service
from app.main import app
from tests.test_audit_service import MemoryAuditRepository


@pytest.mark.anyio
async def test_audit_api_lists_artifact_events() -> None:
    repository = MemoryAuditRepository()
    service = AuditService(repository)
    course_id = uuid4()
    artifact_id = uuid4()
    await service.record(
        AuditEventCreate(
            course_id=course_id,
            artifact_type="topic",
            artifact_id=artifact_id,
            action="accept",
            source="instructor",
            ai_rationale="Boundary matched a semantic shift.",
            scope="artifact",
        ),
    )
    app.dependency_overrides[get_audit_service] = lambda: service

    try:
        async with _client() as client:
            response = await client.get(f"/audit/topic/{artifact_id}")
            assert response.status_code == 200
            body = response.json()
            assert body[0]["artifact_type"] == "topic"
            assert body[0]["ai_rationale"] == "Boundary matched a semantic shift."
    finally:
        app.dependency_overrides.clear()


@asynccontextmanager
async def _client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
