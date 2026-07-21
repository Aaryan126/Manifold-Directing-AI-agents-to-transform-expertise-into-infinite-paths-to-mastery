from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, create_autospec
from uuid import UUID, uuid4

import pytest

from app.course_os.models import (
    GenerationRun,
    GenerationRunStatus,
    GenerationTask,
    GenerationTaskStatus,
)
from app.course_os.repository import CourseOSRepository
from app.course_os.worker import CourseGenerationWorker


def _task(task_type: str) -> GenerationTask:
    return GenerationTask(
        id=uuid4(),
        run_id=uuid4(),
        task_type=task_type,
        scope_key="course",
        status=GenerationTaskStatus.RUNNING,
        depends_on=(),
        attempts=1,
        max_attempts=3,
        input={"video_id": str(uuid4())},
        output=None,
        error_message=None,
    )


def _source_task_with_ingestion_job() -> GenerationTask:
    task = _task("source_ready")
    return replace(
        task,
        input={
            **task.input,
            "ingestion_job_id": str(uuid4()),
        },
    )


def _run(task: GenerationTask) -> GenerationRun:
    return GenerationRun(
        id=task.run_id,
        course_id=uuid4(),
        revision_id=uuid4(),
        status=GenerationRunStatus.RUNNING,
        phase=task.task_type,
        progress=0,
        error_summary=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        tasks=(task,),
    )


def _worker(repository: CourseOSRepository, **services: object) -> CourseGenerationWorker:
    defaults = {
        "ingestion": AsyncMock(),
        "segmentation": AsyncMock(),
        "graph": AsyncMock(),
        "clips": AsyncMock(),
        "assessments": AsyncMock(),
    }
    defaults.update(services)
    return CourseGenerationWorker(
        repository=repository,
        worker_id="test-worker",
        poll_seconds=0.01,
        lease_seconds=60,
        **defaults,
    )


@pytest.mark.anyio
async def test_source_task_requeues_while_transcription_is_in_progress() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("source_ready")
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=_run(task))
    repository.fail_generation_task = AsyncMock()
    ingestion = AsyncMock()
    ingestion.get_video_transcript.return_value = None

    worked = await _worker(repository, ingestion=ingestion).run_once()

    assert worked is True
    repository.fail_generation_task.assert_awaited_once()
    assert repository.fail_generation_task.await_args.kwargs["retry"] is True
    repository.complete_generation_task.assert_not_awaited()


@pytest.mark.anyio
async def test_source_task_runs_transcription_inside_the_durable_worker() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _source_task_with_ingestion_job()
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=_run(task))
    repository.complete_generation_task = AsyncMock()
    ingestion = AsyncMock()
    ingestion.get_video_transcript.side_effect = [None, {"text": "durable"}]

    worked = await _worker(repository, ingestion=ingestion).run_once()

    assert worked is True
    ingestion.process_job.assert_awaited_once_with(UUID(task.input["ingestion_job_id"]))
    repository.complete_generation_task.assert_awaited_once_with(
        task.id,
        {"video_id": task.input["video_id"], "transcript_ready": True},
    )


@pytest.mark.anyio
async def test_outline_task_applies_reviewable_course_title_proposal() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("outline")
    run = _run(task)
    topic_id = uuid4()
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=run)
    repository.complete_generation_task = AsyncMock()
    repository.apply_course_title_proposal = AsyncMock(return_value="Practical Vectors")
    segmentation = AsyncMock()
    segmentation.propose_topics.return_value = (SimpleNamespace(id=topic_id),)

    worked = await _worker(repository, segmentation=segmentation).run_once()

    assert worked is True
    repository.apply_course_title_proposal.assert_awaited_once_with(
        run.course_id,
        run.revision_id,
    )
    repository.complete_generation_task.assert_awaited_once_with(
        task.id,
        {
            "topic_ids": [str(topic_id)],
            "count": 1,
            "course_title": "Practical Vectors",
        },
    )


@pytest.mark.anyio
async def test_graph_task_generates_private_proposals_before_review() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("concept_graph")
    run = _run(task)
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=run)
    repository.complete_generation_task = AsyncMock()
    graph = AsyncMock()
    graph.propose_graph.return_value = SimpleNamespace(
        concepts=(object(), object()),
        edges=(object(),),
    )

    worked = await _worker(repository, graph=graph).run_once()

    assert worked is True
    graph.propose_graph.assert_awaited_once_with(run.course_id, provisional=True)
    repository.complete_generation_task.assert_awaited_once_with(
        task.id,
        {"concept_count": 2, "edge_count": 1},
    )
