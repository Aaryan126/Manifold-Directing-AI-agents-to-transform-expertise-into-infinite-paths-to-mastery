from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from app.intelligence.models import (
    AgentTask,
    AgentTaskStatus,
    ImprovementDraft,
    SpecialistRole,
)
from app.intelligence.worker import CourseIntelligenceWorker


def _task(
    pack_targets: list[dict[str, str]],
    *,
    task_type: str = "prepare_improvement",
    suggested_prerequisite: dict[str, str] | None = None,
) -> AgentTask:
    now = datetime.now(UTC)
    return AgentTask(
        id=uuid4(),
        course_id=uuid4(),
        revision_id=uuid4(),
        specialist_role=SpecialistRole.CURRICULUM_ARCHITECT,
        task_type=task_type,
        target_artifact_type="concept",
        target_logical_artifact_id=uuid4(),
        request_context={"instruction": "Prepare a coordinated recovery path."},
        evidence_snapshot={
            "confident_incorrect": 3,
            "pack_targets": pack_targets,
            **(
                {"suggested_prerequisite": suggested_prerequisite}
                if suggested_prerequisite
                else {}
            ),
        },
        status=AgentTaskStatus.RUNNING,
        result=None,
        proposal_ids=(),
        attempts=1,
        max_attempts=3,
        error_message=None,
        created_at=now,
        updated_at=now,
    )


def _draft(artifact_type: str, logical_id: UUID) -> ImprovementDraft:
    return ImprovementDraft(
        proposal_type="artifact_update",
        artifact_type=artifact_type,
        logical_artifact_id=logical_id,
        before_state={"version": "before"},
        proposed_state={"version": "after"},
        rationale="Evidence-grounded recovery change.",
    )


@pytest.mark.anyio
async def test_specialist_worker_saves_a_six_artifact_pack_once() -> None:
    targets = [
        {"artifact_type": artifact_type, "logical_artifact_id": str(uuid4())}
        for artifact_type in ["clip", "question", "remediation_rule", "concept", "topic"]
    ]
    task = _task(targets)
    repository = AsyncMock()
    repository.claim_agent_task.return_value = task
    repository.target_state.return_value = {"version": "before"}
    repository.target_state_by_identity.return_value = {"version": "before"}
    repository.search_sources.return_value = ()
    agent = AsyncMock()
    agent.prepare.side_effect = lambda *, artifact_type, logical_artifact_id, **_kwargs: _draft(
        artifact_type,
        logical_artifact_id,
    )
    worker = CourseIntelligenceWorker(
        repository,
        AsyncMock(),
        agent,
        worker_id="test-worker",
    )

    assert await worker.run_once() is True

    saved_task, drafts, citations = repository.save_improvement_pack.await_args.args
    assert saved_task == task
    assert len(drafts) == 6
    assert citations == ()
    assert all(draft.before_state != draft.proposed_state for draft in drafts)
    repository.fail_task.assert_not_awaited()


@pytest.mark.anyio
async def test_specialist_worker_exposes_pack_failure_without_saving_partial_work() -> None:
    target_id = uuid4()
    task = _task([{"artifact_type": "question", "logical_artifact_id": str(target_id)}])
    repository = AsyncMock()
    repository.claim_agent_task.return_value = task
    repository.target_state.return_value = {"version": "before"}
    repository.target_state_by_identity.return_value = {"version": "before"}
    repository.search_sources.return_value = ()
    agent = AsyncMock()
    assert task.target_logical_artifact_id is not None
    agent.prepare.side_effect = [
        _draft("concept", task.target_logical_artifact_id),
        RuntimeError("Question proposal could not be prepared."),
    ]
    worker = CourseIntelligenceWorker(
        repository,
        AsyncMock(),
        agent,
        worker_id="test-worker",
    )

    assert await worker.run_once() is True

    repository.save_improvement_pack.assert_not_awaited()
    repository.fail_task.assert_awaited_once_with(
        task,
        "Question proposal could not be prepared.",
    )


@pytest.mark.anyio
async def test_blueprint_cleanup_is_bounded_and_returns_reviewable_adjacent_proposals() -> None:
    prerequisite = {
        "from_concept_logical_id": str(uuid4()),
        "to_concept_logical_id": str(uuid4()),
    }
    task = _task([], task_type="cleanup_blueprint", suggested_prerequisite=prerequisite)
    repository = AsyncMock()
    repository.claim_agent_task.return_value = task
    repository.target_state.return_value = {"name": "New concept"}
    repository.search_sources.return_value = ()
    agent = AsyncMock()
    assert task.target_logical_artifact_id is not None
    agent.prepare.return_value = _draft("concept", task.target_logical_artifact_id)
    worker = CourseIntelligenceWorker(
        repository,
        AsyncMock(),
        agent,
        worker_id="test-worker",
    )

    assert await worker.run_once() is True

    _, drafts, _ = repository.save_improvement_pack.await_args.args
    assert len(drafts) == 2
    assert drafts[0].artifact_type == "concept"
    assert drafts[1].artifact_type == "concept_edge_create"
    assert drafts[1].proposed_state == {
        **prerequisite,
        "relationship": "requires",
    }
    assert "smallest adjacent cleanup" in agent.prepare.await_args.kwargs["instruction"]
