from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.dependencies import get_course_intelligence_service
from app.intelligence.models import (
    AgentTask,
    AgentTaskProposal,
    AgentTaskStatus,
    SourceCitation,
    SpecialistRole,
)
from app.main import app


def test_agent_task_pack_returns_independently_reviewable_cited_proposals() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    task_id = uuid4()
    proposal_id = uuid4()
    now = datetime.now(UTC)
    task = AgentTask(
        id=task_id,
        course_id=course_id,
        revision_id=revision_id,
        specialist_role=SpecialistRole.CURRICULUM_ARCHITECT,
        task_type="prepare_improvement",
        target_artifact_type="concept",
        target_logical_artifact_id=uuid4(),
        request_context={"instruction": "Prepare misconception recovery."},
        evidence_snapshot={"confident_incorrect": 3},
        status=AgentTaskStatus.WAITING_REVIEW,
        result={"summary": "One coordinated pack is ready."},
        proposal_ids=(proposal_id,),
        attempts=1,
        max_attempts=3,
        error_message=None,
        created_at=now,
        updated_at=now,
    )
    citation = SourceCitation(
        source_id=uuid4(),
        source_title="Lecture slides",
        section_id=uuid4(),
        page_number=4,
        excerpt="A source-grounded explanation.",
    )
    proposal = AgentTaskProposal(
        id=proposal_id,
        proposal_type="artifact_update",
        artifact_type="concept",
        logical_artifact_id=task.target_logical_artifact_id,
        before_state={"description": "Before"},
        proposed_state={"description": "After"},
        rationale="Clarifies the misconception.",
        status="proposed",
        citations=(citation,),
    )
    service = AsyncMock()
    service.task.return_value = (task, (proposal,))
    app.dependency_overrides[get_course_intelligence_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.get(
            f"/courses/{course_id}/agent-tasks/{task_id}",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["task"]["status"] == "waiting_review"
        assert payload["proposals"][0]["id"] == str(proposal_id)
        assert payload["proposals"][0]["status"] == "proposed"
        assert payload["proposals"][0]["citations"][0]["page_number"] == 4
        service.task.assert_awaited_once_with(course_id, task_id, instructor_id)
    finally:
        app.dependency_overrides.clear()
