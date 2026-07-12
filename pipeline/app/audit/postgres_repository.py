from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.audit.models import AuditEvent, AuditEventCreate
from app.audit.repository import AuditRepository


class PostgresAuditRepository(AuditRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def record_event(self, event: AuditEventCreate) -> AuditEvent:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            return await _record_event(conn, event)

    async def record_events(
        self,
        events: tuple[AuditEventCreate, ...],
    ) -> tuple[AuditEvent, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            return tuple([await _record_event(conn, event) for event in events])

    async def list_for_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID,
    ) -> tuple[AuditEvent, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select id, course_id, actor_type, actor_id, artifact_type,
                           artifact_id, action, source, previous_state, new_state,
                           ai_rationale, instructor_note, dashboard_signal_id,
                           scope, created_at::text
                    from audit_events
                    where artifact_type = %s and artifact_id = %s
                    order by created_at
                    """,
                    (artifact_type, artifact_id),
                )
            ).fetchall()
            return tuple(_event_from_row(row) for row in rows)

    async def list_for_course(self, course_id: UUID) -> tuple[AuditEvent, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select id, course_id, actor_type, actor_id, artifact_type,
                           artifact_id, action, source, previous_state, new_state,
                           ai_rationale, instructor_note, dashboard_signal_id,
                           scope, created_at::text
                    from audit_events
                    where course_id = %s
                    order by created_at
                    """,
                    (course_id,),
                )
            ).fetchall()
            return tuple(_event_from_row(row) for row in rows)


async def _record_event(
    conn: psycopg.AsyncConnection[Any],
    event: AuditEventCreate,
) -> AuditEvent:
    row = await (
        await conn.execute(
            """
            insert into audit_events (
              course_id, actor_type, actor_id, artifact_type, artifact_id,
              action, source, previous_state, new_state, ai_rationale,
              instructor_note, dashboard_signal_id, scope
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb,
                    %s, %s, %s, %s)
            returning id, course_id, actor_type, actor_id, artifact_type,
                      artifact_id, action, source, previous_state, new_state,
                      ai_rationale, instructor_note, dashboard_signal_id,
                      scope, created_at::text
            """,
            (
                event.course_id,
                event.actor_type,
                event.actor_id,
                event.artifact_type,
                event.artifact_id,
                event.action,
                event.source,
                Jsonb(event.previous_state) if event.previous_state is not None else None,
                Jsonb(event.new_state) if event.new_state is not None else None,
                event.ai_rationale,
                event.instructor_note,
                event.dashboard_signal_id,
                event.scope,
            ),
        )
    ).fetchone()
    if row is None:
        raise RuntimeError("Failed to record audit event.")
    return _event_from_row(row)


def _event_from_row(row: dict[str, Any]) -> AuditEvent:
    previous_state = row["previous_state"]
    new_state = row["new_state"]
    return AuditEvent(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        actor_type=str(row["actor_type"]),
        actor_id=UUID(str(row["actor_id"])) if row["actor_id"] else None,
        artifact_type=str(row["artifact_type"]),
        artifact_id=UUID(str(row["artifact_id"])),
        action=str(row["action"]),
        source=str(row["source"]),
        previous_state=previous_state if isinstance(previous_state, dict) else None,
        new_state=new_state if isinstance(new_state, dict) else None,
        ai_rationale=str(row["ai_rationale"]) if row["ai_rationale"] else None,
        instructor_note=str(row["instructor_note"]) if row["instructor_note"] else None,
        dashboard_signal_id=(
            UUID(str(row["dashboard_signal_id"])) if row["dashboard_signal_id"] else None
        ),
        scope=str(row["scope"]),
        created_at=str(row["created_at"]),
    )
