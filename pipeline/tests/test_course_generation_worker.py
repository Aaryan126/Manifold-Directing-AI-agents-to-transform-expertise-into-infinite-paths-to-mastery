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
from app.evaluation.telemetry import record_openai_usage


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
    completed_task_id, output = repository.complete_generation_task.await_args.args
    assert completed_task_id == task.id
    assert output["video_id"] == task.input["video_id"]
    assert output["transcript_ready"] is True
    assert output["measurement"]["wall_time_ms"] >= 0
    assert output["measurement"]["ai_calls"] == []
    assert output["measurement_attempts"] == [output["measurement"]]


@pytest.mark.anyio
async def test_competition_demo_task_replays_cached_output_without_providers() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = replace(
        _task("outline"),
        input={
            "video_id": str(uuid4()),
            "competition_demo_replay": True,
            "demo_step_delay_seconds": 0,
            "demo_output": {"count": 9, "topic_ids": ["cached-topic"]},
        },
    )
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=_run(task))
    repository.complete_generation_task = AsyncMock()
    segmentation = AsyncMock()

    worked = await _worker(repository, segmentation=segmentation).run_once()

    assert worked is True
    segmentation.propose_topics.assert_not_awaited()
    output = repository.complete_generation_task.await_args.args[1]
    assert output["count"] == 9
    assert output["topic_ids"] == ["cached-topic"]


@pytest.mark.anyio
async def test_outline_task_prepares_an_editable_private_course_title() -> None:
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
        UUID(task.input["video_id"]),
    )
    completed_task_id, output = repository.complete_generation_task.await_args.args
    assert completed_task_id == task.id
    assert output["topic_ids"] == [str(topic_id)]
    assert output["count"] == 1
    assert output["course_title"] == "Practical Vectors"
    assert output["measurement"]["wall_time_ms"] >= 0


@pytest.mark.anyio
async def test_graph_task_generates_private_draft_artifacts() -> None:
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
    graph.propose_graph.assert_awaited_once_with(
        run.course_id,
        provisional=True,
        video_id=UUID(task.input["video_id"]),
    )
    completed_task_id, output = repository.complete_generation_task.await_args.args
    assert completed_task_id == task.id
    assert output["concept_count"] == 2
    assert output["edge_count"] == 1
    assert output["measurement"]["wall_time_ms"] >= 0


@pytest.mark.anyio
async def test_clip_task_resumes_only_topics_without_persisted_clips() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("clips")
    run = _run(task)
    pending_topic_id = uuid4()
    clip_id = uuid4()
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=run)
    repository.generation_topic_ids = AsyncMock(return_value=(pending_topic_id,))
    repository.complete_generation_task = AsyncMock()
    clips = AsyncMock()
    clips.generate_clips_for_topic.return_value = (SimpleNamespace(id=clip_id),)

    worked = await _worker(repository, clips=clips).run_once()

    assert worked is True
    repository.generation_topic_ids.assert_awaited_once_with(
        run.revision_id,
        UUID(task.input["video_id"]),
        missing_artifact="clip",
    )
    clips.generate_clips_for_topic.assert_awaited_once_with(
        pending_topic_id,
        provisional=True,
    )
    output = repository.complete_generation_task.await_args.args[1]
    assert output["clip_ids"] == [str(clip_id)]


@pytest.mark.anyio
async def test_assessment_task_resumes_only_topics_without_questions() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("assessments")
    run = _run(task)
    pending_topic_id = uuid4()
    question_id = uuid4()
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=run)
    repository.generation_topic_ids = AsyncMock(return_value=(pending_topic_id,))
    repository.complete_generation_task = AsyncMock()
    assessments = AsyncMock()
    assessments.generate_question.return_value = SimpleNamespace(id=question_id)

    worked = await _worker(repository, assessments=assessments).run_once()

    assert worked is True
    repository.generation_topic_ids.assert_awaited_once_with(
        run.revision_id,
        UUID(task.input["video_id"]),
        missing_artifact="assessment",
    )
    assessments.generate_question.assert_awaited_once_with(
        pending_topic_id,
        provisional=True,
    )
    output = repository.complete_generation_task.await_args.args[1]
    assert output["question_ids"] == [str(question_id)]


@pytest.mark.anyio
async def test_final_task_auto_accepts_the_editable_private_draft() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("review_bundles")
    run = _run(task)
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=run)
    repository.complete_generation_task = AsyncMock()
    repository.finalize_generated_private_draft = AsyncMock(
        return_value={
            "topic": 4,
            "concept": 6,
            "concept_edge": 3,
            "clip": 4,
            "question": 4,
            "course_unit": 1,
        }
    )

    worked = await _worker(repository).run_once()

    assert worked is True
    repository.finalize_generated_private_draft.assert_awaited_once_with(
        run.course_id,
        run.revision_id,
    )
    output = repository.complete_generation_task.await_args.args[1]
    assert output["artifact_count"] == 22
    assert output["auto_accepted_private_draft"]["question"] == 4


@pytest.mark.anyio
async def test_failed_attempt_persists_provider_usage_for_retry_cost_accounting() -> None:
    repository = create_autospec(CourseOSRepository, instance=True)
    task = _task("outline")
    repository.claim_generation_task = AsyncMock(return_value=task)
    repository.get_generation_run = AsyncMock(return_value=_run(task))
    repository.fail_generation_task = AsyncMock()
    segmentation = AsyncMock()

    async def fail_after_provider_call(*_args: object, **_kwargs: object) -> None:
        record_openai_usage(
            SimpleNamespace(
                usage=SimpleNamespace(
                    input_tokens=100,
                    output_tokens=25,
                    total_tokens=125,
                )
            ),
            operation="segment_lecture",
            model="gpt-5.4",
            latency_ms=20,
        )
        raise RuntimeError("provider output was unusable")

    segmentation.propose_topics.side_effect = fail_after_provider_call

    worked = await _worker(repository, segmentation=segmentation).run_once()

    assert worked is True
    measurement = repository.fail_generation_task.await_args.kwargs["measurement"]
    assert measurement["wall_time_ms"] >= 0
    assert measurement["ai_calls"][0]["input_tokens"] == 100
    assert measurement["ai_calls"][0]["output_tokens"] == 25
