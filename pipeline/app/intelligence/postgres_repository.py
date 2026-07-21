from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.db.pool import pooled_connection
from app.intelligence.models import (
    AgentTask,
    AgentTaskStatus,
    CourseSource,
    ExtractedSection,
    ImprovementDraft,
    SourceCitation,
    SourceExtractionStatus,
    SourcePurpose,
    SourceReviewStatus,
    SpecialistRole,
)


class PostgresIntelligenceRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def create_source(
        self,
        *,
        course_id: UUID,
        revision_id: UUID,
        filename: str,
        source_type: str,
        mime_type: str,
        size_bytes: int,
        checksum_sha256: str,
        storage_uri: str,
        purpose: SourcePurpose,
    ) -> CourseSource:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            source = await (
                await conn.execute(
                    """
                    insert into course_sources (
                      course_id, filename, source_type, mime_type, size_bytes,
                      checksum_sha256, storage_uri, extraction_status
                    ) values (%s, %s, %s, %s, %s, %s, %s, 'queued')
                    returning *
                    """,
                    (
                        course_id,
                        filename,
                        source_type,
                        mime_type,
                        size_bytes,
                        checksum_sha256,
                        storage_uri,
                    ),
                )
            ).fetchone()
            if source is None:
                raise RuntimeError("Failed to create course source.")
            await conn.execute(
                """
                insert into course_revision_sources (
                  revision_id, source_id, purpose, review_status, learner_visible
                ) values (%s, %s, %s, 'accepted', false)
                """,
                (revision_id, source["id"], purpose.value),
            )
            await conn.execute(
                """
                insert into course_agent_tasks (
                  course_id, revision_id, specialist_role, task_type,
                  target_artifact_type, target_logical_artifact_id, request_context
                ) values (
                  %s, %s, 'curriculum_architect', 'extract_source',
                  'course_source', %s, %s::jsonb
                )
                """,
                (
                    course_id,
                    revision_id,
                    source["logical_id"],
                    Jsonb({"source_id": str(source["id"])}),
                ),
            )
        created = await self.get_source(course_id, revision_id, UUID(str(source["id"])))
        if created is None:
            raise RuntimeError("Created course source could not be loaded.")
        return created

    async def list_sources(self, course_id: UUID, revision_id: UUID) -> tuple[CourseSource, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    _SOURCE_SELECT + _SOURCE_GROUP + " order by s.created_at desc",
                    (revision_id, course_id),
                )
            ).fetchall()
        return tuple(_source(row) for row in rows)

    async def get_source(
        self,
        course_id: UUID,
        revision_id: UUID,
        source_id: UUID,
    ) -> CourseSource | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    _SOURCE_SELECT + " and s.id = %s" + _SOURCE_GROUP,
                    (revision_id, course_id, source_id),
                )
            ).fetchone()
        return _source(row) if row else None

    async def update_source(
        self,
        course_id: UUID,
        revision_id: UUID,
        source_id: UUID,
        *,
        purpose: SourcePurpose,
        review_status: SourceReviewStatus,
        learner_visible: bool,
    ) -> CourseSource | None:
        async with pooled_connection(self._database_url) as conn:
            result = await conn.execute(
                """
                update course_revision_sources rs
                set purpose = %s,
                    review_status = %s,
                    learner_visible = %s,
                    removed_at = case when %s = 'dismissed' then now() else null end,
                    updated_at = now()
                from course_sources s
                where rs.revision_id = %s and rs.source_id = %s
                  and s.id = rs.source_id and s.course_id = %s
                """,
                (
                    purpose.value,
                    review_status.value,
                    learner_visible,
                    review_status.value,
                    revision_id,
                    source_id,
                    course_id,
                ),
            )
            if result.rowcount == 0:
                return None
        return await self.get_source(course_id, revision_id, source_id)

    async def retry_source(self, course_id: UUID, revision_id: UUID, source_id: UUID) -> bool:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            source = await (
                await conn.execute(
                    """
                    update course_sources
                    set extraction_status = 'queued', extraction_error = null, updated_at = now()
                    where id = %s and course_id = %s
                    returning logical_id
                    """,
                    (source_id, course_id),
                )
            ).fetchone()
            if source is None:
                return False
            await conn.execute(
                """
                insert into course_agent_tasks (
                  course_id, revision_id, specialist_role, task_type,
                  target_artifact_type, target_logical_artifact_id, request_context
                ) values (
                  %s, %s, 'curriculum_architect', 'extract_source',
                  'course_source', %s, %s::jsonb
                )
                """,
                (
                    course_id,
                    revision_id,
                    source["logical_id"],
                    Jsonb({"source_id": str(source_id)}),
                ),
            )
            return True

    async def create_agent_task(
        self,
        *,
        course_id: UUID,
        revision_id: UUID,
        specialist_role: SpecialistRole,
        task_type: str,
        target_artifact_type: str | None,
        target_logical_artifact_id: UUID | None,
        request_context: dict[str, Any],
        evidence_snapshot: dict[str, Any],
    ) -> AgentTask:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into course_agent_tasks (
                      course_id, revision_id, specialist_role, task_type,
                      target_artifact_type, target_logical_artifact_id,
                      request_context, evidence_snapshot
                    ) values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                    returning *
                    """,
                    (
                        course_id,
                        revision_id,
                        specialist_role.value,
                        task_type,
                        target_artifact_type,
                        target_logical_artifact_id,
                        Jsonb(request_context),
                        Jsonb(evidence_snapshot),
                    ),
                )
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to create specialist task.")
        return _agent_task(row)

    async def list_agent_tasks(self, course_id: UUID) -> tuple[AgentTask, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select * from course_agent_tasks
                    where course_id = %s
                    order by created_at desc
                    limit 30
                    """,
                    (course_id,),
                )
            ).fetchall()
        return tuple(_agent_task(row) for row in rows)

    async def claim_agent_task(self, worker_id: str, lease_seconds: int) -> AgentTask | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    with candidate as (
                      select id from course_agent_tasks
                      where status in ('queued', 'running')
                        and next_attempt_at <= now()
                        and (status = 'queued' or lease_expires_at < now())
                      order by created_at
                      for update skip locked
                      limit 1
                    )
                    update course_agent_tasks task
                    set status = 'running', attempts = attempts + 1,
                        lease_owner = %s,
                        lease_expires_at = now() + make_interval(secs => %s),
                        started_at = coalesce(started_at, now()), updated_at = now()
                    from candidate
                    where task.id = candidate.id
                    returning task.*
                    """,
                    (worker_id, lease_seconds),
                )
            ).fetchone()
        return _agent_task(row) if row else None

    async def source_for_task(self, task: AgentTask) -> tuple[UUID, Path, str]:
        source_id = UUID(str(task.request_context.get("source_id")))
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    update course_sources
                    set extraction_status = 'processing', extraction_error = null,
                        updated_at = now()
                    where id = %s and course_id = %s
                    returning id, storage_uri, source_type
                    """,
                    (source_id, task.course_id),
                )
            ).fetchone()
        if row is None:
            raise ValueError("The supplemental source no longer exists.")
        return UUID(str(row["id"])), Path(str(row["storage_uri"])), str(row["source_type"])

    async def save_source_sections(
        self,
        source_id: UUID,
        sections: tuple[ExtractedSection, ...],
    ) -> None:
        async with pooled_connection(self._database_url) as conn:
            await conn.execute("delete from source_sections where source_id = %s", (source_id,))
            cursor = conn.cursor()
            await cursor.executemany(
                """
                insert into source_sections (
                  source_id, section_index, page_number, title, native_text,
                  speaker_notes, visual_summary, metadata
                ) values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                [
                    (
                        source_id,
                        section.section_index,
                        section.page_number,
                        section.title,
                        section.native_text,
                        section.speaker_notes,
                        section.visual_summary,
                        Jsonb(section.metadata),
                    )
                    for section in sections
                ],
            )
            await conn.execute(
                """
                update course_sources
                set extraction_status = 'ready', extraction_error = null,
                    metadata = metadata || %s::jsonb, updated_at = now()
                where id = %s
                """,
                (Jsonb({"section_count": len(sections)}), source_id),
            )

    async def target_state(self, task: AgentTask) -> dict[str, Any]:
        if task.target_artifact_type is None or task.target_logical_artifact_id is None:
            return {}
        table = _ARTIFACT_TABLES.get(task.target_artifact_type)
        if table is None:
            raise ValueError(f"Unsupported improvement target: {task.target_artifact_type}")
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    f"select * from {table} where revision_id = %s and logical_id = %s",  # noqa: S608
                    (task.revision_id, task.target_logical_artifact_id),
                )
            ).fetchone()
        if row is None:
            raise ValueError("The improvement target does not exist in this revision.")
        return _json_state(row)

    async def save_improvement(
        self,
        task: AgentTask,
        draft: ImprovementDraft,
        citations: tuple[SourceCitation, ...] = (),
    ) -> UUID:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into course_proposals (
                      course_id, revision_id, proposal_type, artifact_type,
                      logical_artifact_id, before_state, proposed_state, rationale
                    ) values (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
                    returning id
                    """,
                    (
                        task.course_id,
                        task.revision_id,
                        draft.proposal_type,
                        draft.artifact_type,
                        draft.logical_artifact_id,
                        Jsonb(draft.before_state),
                        Jsonb(draft.proposed_state),
                        draft.rationale,
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to save specialist proposal.")
            proposal_id = UUID(str(row["id"]))
            if citations:
                await conn.cursor().executemany(
                    """
                    insert into source_citations (
                      revision_id, source_section_id, proposal_id, excerpt, metadata
                    ) values (%s, %s, %s, %s, %s::jsonb)
                    """,
                    [
                        (
                            task.revision_id,
                            citation.section_id,
                            proposal_id,
                            citation.excerpt,
                            Jsonb(
                                {
                                    "source_id": str(citation.source_id),
                                    "source_title": citation.source_title,
                                    "page_number": citation.page_number,
                                }
                            ),
                        )
                        for citation in citations
                    ],
                )
            await conn.execute(
                """
                update course_agent_tasks
                set status = 'waiting_review', result = %s::jsonb,
                    proposal_ids = array_append(proposal_ids, %s),
                    lease_owner = null, lease_expires_at = null,
                    completed_at = now(), updated_at = now()
                where id = %s
                """,
                (
                    Jsonb(
                        {
                            "summary": draft.rationale,
                            "proposal_id": str(proposal_id),
                            "proposal_type": draft.proposal_type,
                            "artifact_type": draft.artifact_type,
                            "logical_artifact_id": str(draft.logical_artifact_id),
                            "before_state": draft.before_state,
                            "proposed_state": draft.proposed_state,
                            "rationale": draft.rationale,
                            "citations": [
                                {
                                    "source_id": str(citation.source_id),
                                    "source_title": citation.source_title,
                                    "section_id": str(citation.section_id),
                                    "page_number": citation.page_number,
                                    "excerpt": citation.excerpt,
                                }
                                for citation in citations
                            ],
                        }
                    ),
                    proposal_id,
                    task.id,
                ),
            )
        return proposal_id

    async def complete_task(self, task_id: UUID, result: dict[str, Any]) -> None:
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                update course_agent_tasks
                set status = 'complete', result = %s::jsonb, completed_at = now(),
                    lease_owner = null, lease_expires_at = null, updated_at = now()
                where id = %s
                """,
                (Jsonb(result), task_id),
            )

    async def fail_task(self, task: AgentTask, message: str) -> None:
        retry = task.attempts < task.max_attempts
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                update course_agent_tasks
                set status = %s,
                    next_attempt_at = case when %s then now() + interval '5 seconds'
                                           else next_attempt_at end,
                    error_message = %s, lease_owner = null, lease_expires_at = null,
                    completed_at = case when %s then null else now() end,
                    updated_at = now()
                where id = %s
                """,
                ("queued" if retry else "failed", retry, message, retry, task.id),
            )
            if task.task_type == "extract_source":
                source_id = task.request_context.get("source_id")
                if source_id:
                    await conn.execute(
                        """
                        update course_sources
                        set extraction_status = %s, extraction_error = %s, updated_at = now()
                        where id = %s
                        """,
                        ("queued" if retry else "failed", message, source_id),
                    )

    async def search_sources(
        self,
        course_id: UUID,
        revision_id: UUID,
        query: str,
        limit: int = 8,
    ) -> tuple[SourceCitation, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select s.id as source_id, s.filename, section.id as section_id,
                           section.page_number,
                           ts_headline(
                             'english',
                             section.native_text || ' ' || section.speaker_notes || ' '
                               || section.visual_summary,
                             websearch_to_tsquery('english', %s),
                             'MaxWords=35, MinWords=12'
                           ) as excerpt
                    from source_sections section
                    join course_sources s on s.id = section.source_id
                    join course_revision_sources rs on rs.source_id = s.id
                    where s.course_id = %s and rs.revision_id = %s
                      and rs.removed_at is null
                      and section.search_document @@ websearch_to_tsquery('english', %s)
                    order by ts_rank(
                      section.search_document,
                      websearch_to_tsquery('english', %s)
                    ) desc
                    limit %s
                    """,
                    (query, course_id, revision_id, query, query, limit),
                )
            ).fetchall()
        return tuple(
            SourceCitation(
                source_id=UUID(str(row["source_id"])),
                source_title=str(row["filename"]),
                section_id=UUID(str(row["section_id"])),
                page_number=int(row["page_number"]),
                excerpt=str(row["excerpt"] or ""),
            )
            for row in rows
        )

    async def save_map_layout(
        self,
        revision_id: UUID,
        positions: dict[UUID, tuple[float, float]],
    ) -> None:
        if not positions:
            return
        async with pooled_connection(self._database_url) as conn:
            await conn.cursor().executemany(
                """
                insert into course_map_layouts (revision_id, logical_artifact_id, x, y)
                values (%s, %s, %s, %s)
                on conflict (revision_id, logical_artifact_id) do update
                set x = excluded.x, y = excluded.y, updated_at = now()
                """,
                [
                    (revision_id, logical_id, position[0], position[1])
                    for logical_id, position in positions.items()
                ],
            )


_SOURCE_SELECT = """
select s.*, rs.revision_id, rs.purpose, rs.review_status, rs.learner_visible,
       count(section.id) as section_count
from course_sources s
join course_revision_sources rs on rs.source_id = s.id
left join source_sections section on section.source_id = s.id
where rs.revision_id = %s and s.course_id = %s and rs.removed_at is null
"""

_SOURCE_GROUP = """
group by s.id, rs.revision_id, rs.purpose, rs.review_status, rs.learner_visible
"""

_ARTIFACT_TABLES = {
    "topic": "topics",
    "concept": "concepts",
    "concept_edge": "concept_edges",
    "clip": "clips",
    "question": "questions",
    "routing_policy": "routing_policies",
}


def _source(row: dict[str, Any]) -> CourseSource:
    return CourseSource(
        id=UUID(str(row["id"])),
        logical_id=UUID(str(row["logical_id"])),
        course_id=UUID(str(row["course_id"])),
        revision_id=UUID(str(row["revision_id"])),
        filename=str(row["filename"]),
        source_type=str(row["source_type"]),
        mime_type=str(row["mime_type"]),
        size_bytes=int(row["size_bytes"] or 0),
        extraction_status=SourceExtractionStatus(str(row["extraction_status"])),
        extraction_error=str(row["extraction_error"]) if row["extraction_error"] else None,
        purpose=SourcePurpose(str(row["purpose"])),
        review_status=SourceReviewStatus(str(row["review_status"])),
        learner_visible=bool(row["learner_visible"]),
        section_count=int(row["section_count"] or 0),
        created_at=_datetime(row["created_at"]),
        updated_at=_datetime(row["updated_at"]),
    )


def _agent_task(row: dict[str, Any]) -> AgentTask:
    return AgentTask(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        revision_id=UUID(str(row["revision_id"])),
        specialist_role=SpecialistRole(str(row["specialist_role"])),
        task_type=str(row["task_type"]),
        target_artifact_type=(
            str(row["target_artifact_type"]) if row.get("target_artifact_type") else None
        ),
        target_logical_artifact_id=(
            UUID(str(row["target_logical_artifact_id"]))
            if row.get("target_logical_artifact_id")
            else None
        ),
        request_context=_dict(row.get("request_context")),
        evidence_snapshot=_dict(row.get("evidence_snapshot")),
        status=AgentTaskStatus(str(row["status"])),
        result=_dict(row.get("result")) if row.get("result") else None,
        proposal_ids=tuple(UUID(str(value)) for value in (row.get("proposal_ids") or [])),
        attempts=int(row["attempts"] or 0),
        max_attempts=int(row["max_attempts"] or 0),
        error_message=str(row["error_message"]) if row.get("error_message") else None,
        created_at=_datetime(row["created_at"]),
        updated_at=_datetime(row["updated_at"]),
    )


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _json_state(row: dict[str, Any]) -> dict[str, Any]:
    state: dict[str, Any] = {}
    for key, value in row.items():
        if key in {"created_at", "updated_at", "dismissed_at", "flagged_at"}:
            continue
        if isinstance(value, UUID):
            state[key] = str(value)
        elif isinstance(value, datetime):
            state[key] = value.isoformat()
        else:
            state[key] = value
    return state


def _datetime(value: object) -> datetime:
    if not isinstance(value, datetime):
        raise TypeError("Expected datetime from Postgres.")
    return value
