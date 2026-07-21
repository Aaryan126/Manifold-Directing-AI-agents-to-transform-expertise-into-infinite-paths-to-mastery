import asyncio
from contextlib import suppress
from typing import Any
from uuid import UUID

from app.assessments.service import AssessmentService
from app.clips.service import ClipService
from app.course_os.models import GenerationTask
from app.course_os.repository import CourseOSRepository
from app.graph.review_service import ConceptGraphService
from app.ingestion.service import IngestionService
from app.segmentation.service import SegmentationService


class GenerationTaskRetryableError(RuntimeError):
    pass


class CourseGenerationWorker:
    def __init__(
        self,
        repository: CourseOSRepository,
        ingestion: IngestionService,
        segmentation: SegmentationService,
        graph: ConceptGraphService,
        clips: ClipService,
        assessments: AssessmentService,
        *,
        worker_id: str,
        poll_seconds: float = 1.0,
        lease_seconds: int = 900,
    ) -> None:
        self._repository = repository
        self._ingestion = ingestion
        self._segmentation = segmentation
        self._graph = graph
        self._clips = clips
        self._assessments = assessments
        self._worker_id = worker_id
        self._poll_seconds = poll_seconds
        self._lease_seconds = lease_seconds

    async def run(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            worked = False
            try:
                worked = await self.run_once()
            except Exception:
                # A temporary database outage must not terminate restart recovery.
                worked = False
            if worked:
                continue
            with suppress(TimeoutError):
                await asyncio.wait_for(stop_event.wait(), timeout=self._poll_seconds)

    async def run_once(self) -> bool:
        task = await self._repository.claim_generation_task(
            self._worker_id,
            self._lease_seconds,
        )
        if task is None:
            return False
        try:
            output = await self._execute(task)
        except GenerationTaskRetryableError as exc:
            await self._repository.fail_generation_task(task.id, str(exc), retry=True)
        except Exception as exc:
            await self._repository.fail_generation_task(task.id, str(exc), retry=True)
        else:
            await self._repository.complete_generation_task(task.id, output)
        return True

    async def _execute(self, task: GenerationTask) -> dict[str, Any]:
        run = await self._repository.get_generation_run(task.run_id)
        if run is None:
            raise RuntimeError("Generation run disappeared while its task was leased.")
        video_id = _video_id(task)
        if task.task_type == "source_ready":
            transcript = await self._ingestion.get_video_transcript(video_id)
            if transcript is None:
                ingestion_job_id = _ingestion_job_id(task)
                if ingestion_job_id is None:
                    raise GenerationTaskRetryableError(
                        "The lecture is still being transcribed. Manifold will check again."
                    )
                await self._ingestion.process_job(ingestion_job_id)
                transcript = await self._ingestion.get_video_transcript(video_id)
                if transcript is None:
                    job = await self._ingestion.get_job(ingestion_job_id)
                    detail = job.error_message if job and job.error_message else None
                    raise GenerationTaskRetryableError(
                        detail or "The lecture could not be transcribed yet. Manifold will retry."
                    )
            return {"video_id": str(video_id), "transcript_ready": True}
        if task.task_type == "outline":
            topics = await self._segmentation.propose_topics(video_id)
            return {"topic_ids": [str(topic.id) for topic in topics], "count": len(topics)}
        if task.task_type == "concept_graph":
            graph = await self._graph.propose_graph(run.course_id, provisional=True)
            return {"concept_count": len(graph.concepts), "edge_count": len(graph.edges)}
        if task.task_type == "clips":
            clip_ids: list[str] = []
            for topic_id in await self._repository.generation_topic_ids(run.revision_id):
                clips = await self._clips.generate_clips_for_topic(
                    topic_id,
                    provisional=True,
                )
                clip_ids.extend(str(clip.id) for clip in clips)
            return {"clip_ids": clip_ids, "count": len(clip_ids)}
        if task.task_type == "assessments":
            question_ids: list[str] = []
            for topic_id in await self._repository.generation_topic_ids(run.revision_id):
                question = await self._assessments.generate_question(
                    topic_id,
                    provisional=True,
                )
                question_ids.append(str(question.id))
            return {"question_ids": question_ids, "count": len(question_ids)}
        if task.task_type == "review_bundles":
            bundles = await self._repository.assemble_review_bundles(
                run.course_id,
                run.revision_id,
            )
            return {
                "bundle_ids": [str(bundle.id) for bundle in bundles],
                "item_count": sum(len(bundle.items) for bundle in bundles),
            }
        raise RuntimeError(f"Unsupported generation task: {task.task_type}")


def _video_id(task: GenerationTask) -> UUID:
    value = task.input.get("video_id")
    if not isinstance(value, str):
        raise RuntimeError("Generation task has no video source.")
    return UUID(value)


def _ingestion_job_id(task: GenerationTask) -> UUID | None:
    value = task.input.get("ingestion_job_id")
    return UUID(value) if isinstance(value, str) else None
