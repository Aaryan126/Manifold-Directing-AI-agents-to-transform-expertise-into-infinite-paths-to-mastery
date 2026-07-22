import asyncio
from contextlib import suppress
from uuid import UUID

from app.intelligence.agent import CourseImprovementAgent
from app.intelligence.extractor import DocumentExtractor
from app.intelligence.postgres_repository import PostgresIntelligenceRepository


class CourseIntelligenceWorker:
    def __init__(
        self,
        repository: PostgresIntelligenceRepository,
        extractor: DocumentExtractor,
        improvement_agent: CourseImprovementAgent,
        *,
        worker_id: str,
        poll_seconds: float = 1.0,
        lease_seconds: int = 900,
    ) -> None:
        self._repository = repository
        self._extractor = extractor
        self._improvement_agent = improvement_agent
        self._worker_id = worker_id
        self._poll_seconds = poll_seconds
        self._lease_seconds = lease_seconds

    async def run(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            worked = False
            try:
                worked = await self.run_once()
            except Exception:
                worked = False
            if worked:
                continue
            with suppress(TimeoutError):
                await asyncio.wait_for(stop_event.wait(), timeout=self._poll_seconds)

    async def run_once(self) -> bool:
        task = await self._repository.claim_agent_task(self._worker_id, self._lease_seconds)
        if task is None:
            return False
        try:
            if task.task_type == "extract_source":
                source_id, path, source_type = await self._repository.source_for_task(task)
                sections = await self._extractor.extract(path, source_type)
                if not sections:
                    raise ValueError("No readable pages or slides were found.")
                await self._repository.save_source_sections(source_id, sections)
                await self._repository.complete_task(
                    task.id,
                    {"source_id": str(source_id), "section_count": len(sections)},
                )
            elif task.task_type == "prepare_improvement":
                current = await self._repository.target_state(task)
                if task.target_artifact_type is None or task.target_logical_artifact_id is None:
                    raise ValueError("Prepared improvement has no artifact target.")
                instruction = str(task.request_context.get("instruction", ""))
                citations = (
                    await self._repository.search_sources(
                        task.course_id,
                        task.revision_id,
                        instruction,
                        limit=4,
                    )
                    if instruction.strip()
                    else ()
                )
                evidence = dict(task.evidence_snapshot)
                if citations:
                    evidence["source_citations"] = [
                        {
                            "source_title": citation.source_title,
                            "page_number": citation.page_number,
                            "excerpt": citation.excerpt,
                        }
                        for citation in citations
                    ]
                drafts = [
                    await self._improvement_agent.prepare(
                        artifact_type=task.target_artifact_type,
                        logical_artifact_id=task.target_logical_artifact_id,
                        current_state=current,
                        evidence=evidence,
                        instruction=instruction,
                    )
                ]
                pack_targets = task.evidence_snapshot.get("pack_targets", [])
                if isinstance(pack_targets, list):
                    for target in pack_targets[:5]:
                        if not isinstance(target, dict):
                            continue
                        artifact_type = str(target.get("artifact_type", ""))
                        raw_logical_id = target.get("logical_artifact_id")
                        if not artifact_type or not raw_logical_id:
                            continue
                        logical_id = UUID(str(raw_logical_id))
                        if (
                            artifact_type == task.target_artifact_type
                            and logical_id == task.target_logical_artifact_id
                        ):
                            continue
                        target_state = await self._repository.target_state_by_identity(
                            task.revision_id,
                            artifact_type,
                            logical_id,
                        )
                        drafts.append(
                            await self._improvement_agent.prepare(
                                artifact_type=artifact_type,
                                logical_artifact_id=logical_id,
                                current_state=target_state,
                                evidence=evidence,
                                instruction=instruction,
                            )
                        )
                await self._repository.save_improvement_pack(task, tuple(drafts), citations)
            elif task.task_type == "investigate":
                await self._repository.complete_task(
                    task.id,
                    {
                        "summary": "The specialist assembled the persisted evidence for review.",
                        "evidence": task.evidence_snapshot,
                    },
                )
            else:
                raise ValueError(f"Unsupported specialist task: {task.task_type}")
        except Exception as exc:
            await self._repository.fail_task(task, str(exc))
        return True
