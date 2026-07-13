from decimal import Decimal
from pathlib import Path
from typing import Any, cast
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.clips.models import (
    Clip,
    ClipConcept,
    ClipContext,
    ClipFlag,
    ClipMaterializationStatus,
    ClipProposal,
    ClipStatus,
    ClipTopicContext,
    ClipType,
)
from app.clips.repository import ClipRepository
from app.segmentation.models import TranscriptWord


class PostgresClipRepository(ClipRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def get_context_for_topic(self, topic_id: UUID) -> ClipContext | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            topic_row = await (
                await conn.execute(
                    """
                    select t.*, v.transcript, v.source_kind, v.source_uri, v.source_metadata
                    from topics t
                    join videos v on v.id = t.video_id
                    where t.id = %s
                      and t.review_status in ('accepted', 'edited')
                      and v.transcript is not null
                    """,
                    (topic_id,),
                )
            ).fetchone()
            if topic_row is None or not isinstance(topic_row["transcript"], dict):
                return None
            concept_rows = await (
                await conn.execute(
                    """
                    select c.id, c.name, c.description
                    from topic_concepts tc
                    join concepts c on c.id = tc.concept_id
                    where tc.topic_id = %s
                      and c.review_status in ('accepted', 'edited')
                    order by c.name asc
                    """,
                    (topic_id,),
                )
            ).fetchall()
            transcript = topic_row["transcript"]
            words = transcript.get("words", [])
            return ClipContext(
                topic=_topic_context_from_row(topic_row),
                transcript_text=str(transcript.get("text", "")),
                words=tuple(_word_from_json(word) for word in words if isinstance(word, dict)),
                concepts=tuple(_concept_from_row(row) for row in concept_rows),
            )

    async def list_clips_for_video(self, video_id: UUID) -> tuple[Clip, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select c.*
                    from clips c
                    join topics t on t.id = c.topic_id
                    where t.video_id = %s
                    order by c.start_seconds asc, c.created_at asc
                    """,
                    (video_id,),
                )
            ).fetchall()
            return tuple([await _clip_from_row_with_concepts(conn, row) for row in rows])

    async def list_replaceable_clips_for_topic(self, topic_id: UUID) -> tuple[Clip, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select * from clips
                    where topic_id = %s and status = 'active' and source_clip_id is null
                    order by start_seconds asc
                    """,
                    (topic_id,),
                )
            ).fetchall()
            return tuple([await _clip_from_row_with_concepts(conn, row) for row in rows])

    async def get_clip(self, clip_id: UUID) -> Clip | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select * from clips where id = %s", (clip_id,))
            ).fetchone()
            return await _clip_from_row_with_concepts(conn, row) if row else None

    async def replace_topic_clips(
        self,
        topic_id: UUID,
        proposals: tuple[ClipProposal, ...],
    ) -> tuple[Clip, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await conn.execute(
                """
                delete from clip_concepts
                where clip_id in (
                  select id from clips
                  where topic_id = %s and status = 'active' and source_clip_id is null
                )
                """,
                (topic_id,),
            )
            await conn.execute(
                """
                delete from clips
                where topic_id = %s and status = 'active' and source_clip_id is null
                """,
                (topic_id,),
            )
            rows: list[dict[str, Any]] = []
            for proposal in proposals:
                row = await self._insert_clip(conn, topic_id, proposal)
                rows.append(row)
            return tuple([await _clip_from_row_with_concepts(conn, row) for row in rows])

    async def flag_clip(self, clip_id: UUID, flag: ClipFlag) -> Clip | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update clips
                    set status = 'flagged',
                        flagged_at = now(),
                        flag_note = %s,
                        instructor_revision = %s::jsonb,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (
                        flag.note,
                        Jsonb({"action": "flag", "note": flag.note}),
                        clip_id,
                    ),
                )
            ).fetchone()
            return await _clip_from_row_with_concepts(conn, row) if row else None

    async def get_clip_context(self, clip_id: UUID) -> tuple[Clip, ClipContext] | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select * from clips where id = %s", (clip_id,))
            ).fetchone()
            if row is None:
                return None
            clip = await _clip_from_row_with_concepts(conn, row)
            context = await self.get_context_for_topic(clip.topic_id)
            if context is None:
                return None
            return (clip, context)

    async def supersede_clip(
        self,
        clip_id: UUID,
        proposal: ClipProposal,
        note: str,
    ) -> Clip | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            original = await (
                await conn.execute("select * from clips where id = %s", (clip_id,))
            ).fetchone()
            if original is None:
                return None
            replacement_row = await self._insert_clip(
                conn,
                UUID(str(original["topic_id"])),
                proposal,
                source_clip_id=clip_id,
                instructor_revision={"action": "recut", "note": note},
            )
            await conn.execute(
                """
                update clips
                set status = 'superseded',
                    superseded_by_clip_id = %s,
                    instructor_revision = %s::jsonb,
                    updated_at = now()
                where id = %s
                """,
                (
                    replacement_row["id"],
                    Jsonb({"action": "superseded_by_recut", "note": note}),
                    clip_id,
                ),
            )
            return await _clip_from_row_with_concepts(conn, replacement_row)

    async def update_materialization(
        self,
        clip_id: UUID,
        status: ClipMaterializationStatus,
        *,
        playback_provider: str | None = None,
        playback_id: str | None = None,
        error: str | None = None,
    ) -> Clip | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update clips
                    set materialization_status = %s,
                        playback_provider = %s,
                        playback_id = %s,
                        materialization_error = %s,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (status.value, playback_provider, playback_id, error, clip_id),
                )
            ).fetchone()
            return await _clip_from_row_with_concepts(conn, row) if row else None

    async def _insert_clip(
        self,
        conn: psycopg.AsyncConnection[Any],
        topic_id: UUID,
        proposal: ClipProposal,
        *,
        source_clip_id: UUID | None = None,
        instructor_revision: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        row = await (
            await conn.execute(
                """
                insert into clips (
                  topic_id, start_seconds, end_seconds, type, difficulty, ai_proposal,
                  instructor_revision, source_clip_id, status
                )
                values (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, 'active')
                returning *
                """,
                (
                    topic_id,
                    proposal.start_seconds,
                    proposal.end_seconds,
                    proposal.type.value,
                    proposal.difficulty,
                    Jsonb(_proposal_json(proposal)),
                    Jsonb(instructor_revision) if instructor_revision is not None else None,
                    source_clip_id,
                ),
            )
        ).fetchone()
        if row is None:
            raise RuntimeError("Failed to insert clip.")
        for concept_id in proposal.concept_ids:
            await conn.execute(
                """
                insert into clip_concepts (clip_id, concept_id)
                values (%s, %s)
                on conflict do nothing
                """,
                (row["id"], concept_id),
            )
        return cast(dict[str, Any], row)


def _topic_context_from_row(row: dict[str, Any]) -> ClipTopicContext:
    metadata = row["source_metadata"] if isinstance(row.get("source_metadata"), dict) else {}
    local_source_uri = metadata.get("local_source_uri")
    source_uri = local_source_uri or (
        row.get("source_uri") if str(row.get("source_kind")) == "upload" else None
    )
    return ClipTopicContext(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        video_id=UUID(str(row["video_id"])),
        title=str(row["title"]),
        summary=str(row["summary"]) if row["summary"] is not None else None,
        start_seconds=_float_from_row(row["start_seconds"]),
        end_seconds=_float_from_row(row["end_seconds"]),
        source_path=Path(str(source_uri)) if source_uri else None,
    )


def _concept_from_row(row: dict[str, Any]) -> ClipConcept:
    return ClipConcept(
        id=UUID(str(row["id"])),
        name=str(row["name"]),
        description=str(row["description"]) if row["description"] is not None else None,
    )


def _word_from_json(word: dict[str, object]) -> TranscriptWord:
    return TranscriptWord(
        text=str(word.get("text", "")),
        start_seconds=_float_from_row(word.get("start_seconds", 0)),
        end_seconds=_float_from_row(word.get("end_seconds", 0)),
    )


async def _clip_from_row_with_concepts(
    conn: psycopg.AsyncConnection[Any],
    row: dict[str, Any],
) -> Clip:
    concept_rows = await (
        await conn.execute(
            """
            select concept_id
            from clip_concepts
            where clip_id = %s
            order by concept_id
            """,
            (row["id"],),
        )
    ).fetchall()
    return Clip(
        id=UUID(str(row["id"])),
        topic_id=UUID(str(row["topic_id"])),
        start_seconds=_float_from_row(row["start_seconds"]),
        end_seconds=_float_from_row(row["end_seconds"]),
        type=ClipType(str(row["type"])),
        difficulty=str(row["difficulty"]) if row["difficulty"] is not None else None,
        status=ClipStatus(str(row["status"])),
        concept_ids=tuple(UUID(str(concept_row["concept_id"])) for concept_row in concept_rows),
        ai_proposal=row["ai_proposal"] if isinstance(row["ai_proposal"], dict) else None,
        instructor_revision=(
            row["instructor_revision"] if isinstance(row["instructor_revision"], dict) else None
        ),
        flagged_at=str(row["flagged_at"]) if row["flagged_at"] else None,
        flag_note=str(row["flag_note"]) if row["flag_note"] else None,
        superseded_by_clip_id=(
            UUID(str(row["superseded_by_clip_id"])) if row["superseded_by_clip_id"] else None
        ),
        source_clip_id=UUID(str(row["source_clip_id"])) if row["source_clip_id"] else None,
        playback_provider=(
            str(row["playback_provider"]) if row.get("playback_provider") else None
        ),
        playback_id=str(row["playback_id"]) if row.get("playback_id") else None,
        materialization_status=ClipMaterializationStatus(
            str(row.get("materialization_status", "source_reference"))
        ),
        materialization_error=(
            str(row["materialization_error"]) if row.get("materialization_error") else None
        ),
        created_at=str(row["created_at"]) if row["created_at"] else None,
    )


def _proposal_json(proposal: ClipProposal) -> dict[str, object]:
    return {
        "title": proposal.title,
        "start_seconds": proposal.start_seconds,
        "end_seconds": proposal.end_seconds,
        "type": proposal.type.value,
        "difficulty": proposal.difficulty,
        "concept_ids": [str(concept_id) for concept_id in proposal.concept_ids],
        "rationale": proposal.rationale,
        "confidence": proposal.confidence,
    }


def _float_from_row(value: object) -> float:
    if isinstance(value, int | float | str | Decimal):
        return float(value)
    raise TypeError(f"Expected numeric database value, got {type(value).__name__}")
