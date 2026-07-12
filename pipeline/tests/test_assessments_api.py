from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.assessments.service import AssessmentService
from app.dependencies import get_assessment_service
from app.main import app
from tests.test_assessment_service import (
    MemoryAssessmentRepository,
    SequencedAssessmentAgent,
    _context,
    _proposal,
)


@pytest.mark.anyio
async def test_assessment_api_review_flow_and_learner_gate() -> None:
    context = _context()
    repository = MemoryAssessmentRepository(context)
    service = AssessmentService(
        repository=repository,
        agent=SequencedAssessmentAgent(
            (
                _proposal(context, body="Original?"),
                _proposal(context, body="Regenerated?"),
            ),
        ),
    )
    app.dependency_overrides[get_assessment_service] = lambda: service

    try:
        async with _client() as client:
            blocked = await client.get(f"/topics/{context.topic.id}/learner-gate")
            assert blocked.status_code == 200
            assert blocked.json()["learner_accessible"] is False

            generated = await client.post(f"/topics/{context.topic.id}/questions/generate")
            assert generated.status_code == 200
            question = generated.json()
            assert question["review_status"] == "proposed"
            assert question["body"] == "Original?"
            assert len(question["remediation_rules"]) == 1

            regenerated = await client.post(f"/questions/{question['id']}/regenerate")
            assert regenerated.status_code == 200
            regenerated_question = regenerated.json()
            assert regenerated_question["body"] == "Regenerated?"
            assert regenerated_question["id"] != question["id"]

            accepted = await client.post(f"/questions/{regenerated_question['id']}/accept")
            assert accepted.status_code == 200
            assert accepted.json()["review_status"] == "accepted"

            allowed = await client.get(f"/topics/{context.topic.id}/learner-gate")
            assert allowed.status_code == 200
            assert allowed.json()["learner_accessible"] is True

            graded = await client.post(
                f"/questions/{regenerated_question['id']}/grade",
                json={"answer": "It creates simpler equivalent systems."},
            )
            assert graded.status_code == 200
            assert graded.json()["is_correct"] is True
            assert graded.json()["wrong_answer_pattern"] is None

            edited = await client.patch(
                f"/questions/{regenerated_question['id']}",
                json={
                    "body": "Instructor version?",
                    "type": "short_answer",
                    "correct_answer": {"answer": "Equivalent systems"},
                    "confidence_prompt": "How confident are you?",
                    "remediation_rules": [
                        {
                            "wrong_answer_pattern": "misses equivalence",
                            "target_clip_id": str(context.clips[0].id),
                            "target_concept_id": str(context.concepts[0].id),
                            "rationale": "Review the core explanation.",
                        },
                    ],
                },
            )
            assert edited.status_code == 200
            assert edited.json()["review_status"] == "edited"
            assert edited.json()["instructor_revision"] is not None

            dismissed = await client.post(f"/questions/{regenerated_question['id']}/dismiss")
            assert dismissed.status_code == 200
            assert dismissed.json()["review_status"] == "dismissed"

            reblocked = await client.get(f"/topics/{context.topic.id}/learner-gate")
            assert reblocked.status_code == 200
            assert reblocked.json()["learner_accessible"] is False
    finally:
        app.dependency_overrides.clear()


@asynccontextmanager
async def _client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
