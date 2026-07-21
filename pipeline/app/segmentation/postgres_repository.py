from decimal import Decimal
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.segmentation.models import (
    Topic,
    TopicEdit,
    TopicProposal,
    TopicReviewStatus,
    TranscriptWord,
    VideoTranscript,
)
from app.segmentation.repository import TopicRepository


class PostgresTopicRepository(TopicRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def get_video_transcript(self, video_id: UUID) -> VideoTranscript | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    select id, course_id, transcript
                    from videos
                    where id = %s and transcript is not null
                    """,
                    (video_id,),
                )
            ).fetchone()
            if row is None or not isinstance(row["transcript"], dict):
                return None
            transcript = row["transcript"]
            words = transcript.get("words", [])
            if not isinstance(words, list):
                words = []
            return VideoTranscript(
                video_id=UUID(str(row["id"])),
                course_id=UUID(str(row["course_id"])),
                text=str(transcript.get("text", "")),
                words=tuple(_word_from_json(word) for word in words if isinstance(word, dict)),
            )

    async def replace_ai_proposals(
        self,
        video_id: UUID,
        course_id: UUID,
        proposals: tuple[TopicProposal, ...],
    ) -> tuple[Topic, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await conn.execute(
                """
                delete from topics
                where video_id = %s
                  and course_id = %s
                  and revision_id = (
                    select coalesce(working_revision_id, active_revision_id)
                    from courses where id = %s
                  )
                  and review_status = 'proposed'
                """,
                (video_id, course_id, course_id),
            )
            rows: list[dict[str, Any]] = []
            for proposal in proposals:
                row = await (
                    await conn.execute(
                        """
                        insert into topics (
                          course_id, video_id, title, summary, start_seconds, end_seconds,
                          ai_proposal, review_status
                        )
                        values (%s, %s, %s, %s, %s, %s, %s::jsonb, 'proposed')
                        returning *
                        """,
                        (
                            course_id,
                            video_id,
                            proposal.title,
                            proposal.summary,
                            proposal.start_seconds,
                            proposal.end_seconds,
                            Jsonb(_proposal_json(proposal)),
                        ),
                    )
                ).fetchone()
                if row is None:
                    raise RuntimeError("Failed to insert topic proposal.")
                rows.append(row)
            return tuple(_topic_from_row(row) for row in rows)

    async def list_topics(self, video_id: UUID) -> tuple[Topic, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select t.*
                    from topics t
                    join videos v
                      on v.id = t.video_id
                     and v.course_id = t.course_id
                    join courses c on c.id = t.course_id
                    where t.video_id = %s and t.review_status <> 'dismissed'
                      and t.revision_id = coalesce(
                        c.active_revision_id,
                        c.working_revision_id
                      )
                    order by t.start_seconds asc, t.created_at asc
                    """,
                    (video_id,),
                )
            ).fetchall()
            return tuple(_topic_from_row(row) for row in rows)

    async def get_topic(self, topic_id: UUID) -> Topic | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select * from topics where id = %s", (topic_id,))
            ).fetchone()
            return _topic_from_row(row) if row else None

    async def edit_topic(self, topic_id: UUID, edit: TopicEdit) -> Topic | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            previous = await (
                await conn.execute(
                    "select start_seconds, end_seconds from topics where id = %s",
                    (topic_id,),
                )
            ).fetchone()
            row = await (
                await conn.execute(
                    """
                    update topics
                    set title = %s,
                        summary = %s,
                        start_seconds = %s,
                        end_seconds = %s,
                        instructor_revision = %s::jsonb,
                        review_status = 'edited',
                        approved_at = now(),
                        dismissed_at = null,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (
                        edit.title,
                        edit.summary,
                        edit.start_seconds,
                        edit.end_seconds,
                        Jsonb(_edit_json(edit)),
                        topic_id,
                    ),
                )
            ).fetchone()
            if previous is not None and (
                _float_from_row(previous["start_seconds"]) != edit.start_seconds
                or _float_from_row(previous["end_seconds"]) != edit.end_seconds
            ):
                await _invalidate_topic_clips(conn, topic_id, "topic_boundary_changed")
            return _topic_from_row(row) if row else None

    async def accept_topic(self, topic_id: UUID) -> Topic | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update topics
                    set review_status = 'accepted',
                        approved_at = now(),
                        dismissed_at = null,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (topic_id,),
                )
            ).fetchone()
            return _topic_from_row(row) if row else None

    async def dismiss_topic(self, topic_id: UUID) -> Topic | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update topics
                    set review_status = 'dismissed',
                        dismissed_at = now(),
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (topic_id,),
                )
            ).fetchone()
            if row is not None:
                await _invalidate_topic_clips(conn, topic_id, "topic_dismissed")
            return _topic_from_row(row) if row else None

    async def add_manual_topic(
        self,
        video_id: UUID,
        course_id: UUID,
        edit: TopicEdit,
    ) -> Topic:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into topics (
                      course_id, video_id, title, summary, start_seconds, end_seconds,
                      instructor_revision, review_status, approved_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s::jsonb, 'edited', now())
                    returning *
                    """,
                    (
                        course_id,
                        video_id,
                        edit.title,
                        edit.summary,
                        edit.start_seconds,
                        edit.end_seconds,
                        Jsonb(_edit_json(edit)),
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to insert manual topic.")
            return _topic_from_row(row)

    async def remap_concept_links(
        self,
        source_topic_ids: tuple[UUID, ...],
        target_topic_ids: tuple[UUID, ...],
    ) -> None:
        if not source_topic_ids or not target_topic_ids:
            return
        all_topic_ids = tuple(dict.fromkeys((*source_topic_ids, *target_topic_ids)))
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            topic_rows = await (
                await conn.execute(
                    "select id, course_id from topics where id = any(%s::uuid[])",
                    (list(all_topic_ids),),
                )
            ).fetchall()
            if (
                len(topic_rows) != len(all_topic_ids)
                or len({UUID(str(row["course_id"])) for row in topic_rows}) != 1
            ):
                raise ValueError("Remapped topic links must belong to one course.")

            concept_rows = await (
                await conn.execute(
                    """
                    select distinct concept_id
                    from topic_concepts
                    where topic_id = any(%s::uuid[])
                    """,
                    (list(source_topic_ids),),
                )
            ).fetchall()
            concept_ids = tuple(UUID(str(row["concept_id"])) for row in concept_rows)
            if not concept_ids:
                return

            await conn.execute(
                "delete from topic_concepts where topic_id = any(%s::uuid[])",
                (list(source_topic_ids),),
            )
            for concept_id in concept_ids:
                for topic_id in dict.fromkeys(target_topic_ids):
                    await conn.execute(
                        """
                        insert into topic_concepts (topic_id, concept_id)
                        values (%s, %s)
                        on conflict do nothing
                        """,
                        (topic_id, concept_id),
                    )
                linked_rows = await (
                    await conn.execute(
                        """
                        select topic_id
                        from topic_concepts
                        where concept_id = %s
                        order by topic_id
                        """,
                        (concept_id,),
                    )
                ).fetchall()
                linked_topic_ids = [str(row["topic_id"]) for row in linked_rows]
                await conn.execute(
                    """
                    update concepts
                    set instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                          || %s::jsonb,
                        updated_at = now()
                    where id = %s
                    """,
                    (
                        Jsonb(
                            {
                                "action": "inherit_topic_links",
                                "topic_ids": linked_topic_ids,
                            }
                        ),
                        concept_id,
                    ),
                )


def _proposal_json(proposal: TopicProposal) -> dict[str, object]:
    payload: dict[str, object] = {
        "title": proposal.title,
        "summary": proposal.summary,
        "start_seconds": proposal.start_seconds,
        "end_seconds": proposal.end_seconds,
        "evidence": proposal.evidence,
        "confidence": proposal.confidence,
    }
    if proposal.course_title:
        payload["course_title"] = proposal.course_title
    return payload


def _edit_json(edit: TopicEdit) -> dict[str, object]:
    return {
        "title": edit.title,
        "summary": edit.summary,
        "start_seconds": edit.start_seconds,
        "end_seconds": edit.end_seconds,
        "action": edit.action,
    }


def _word_from_json(word: dict[str, object]) -> TranscriptWord:
    return TranscriptWord(
        text=str(word.get("text", "")),
        start_seconds=_float_from_row(word.get("start_seconds", 0)),
        end_seconds=_float_from_row(word.get("end_seconds", 0)),
    )


def _topic_from_row(row: dict[str, Any]) -> Topic:
    return Topic(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        video_id=UUID(str(row["video_id"])),
        title=str(row["title"]),
        summary=str(row["summary"]) if row["summary"] is not None else None,
        start_seconds=_float_from_row(row["start_seconds"]),
        end_seconds=_float_from_row(row["end_seconds"]),
        review_status=TopicReviewStatus(str(row["review_status"])),
        ai_proposal=row["ai_proposal"] if isinstance(row["ai_proposal"], dict) else None,
        instructor_revision=(
            row["instructor_revision"] if isinstance(row["instructor_revision"], dict) else None
        ),
        approved_at=str(row["approved_at"]) if row["approved_at"] else None,
        dismissed_at=str(row["dismissed_at"]) if row["dismissed_at"] else None,
    )


def _float_from_row(value: object) -> float:
    if isinstance(value, int | float | str | Decimal):
        return float(value)
    raise TypeError(f"Expected numeric database value, got {type(value).__name__}")


async def _invalidate_topic_clips(
    conn: psycopg.AsyncConnection[Any],
    topic_id: UUID,
    reason: str,
) -> None:
    await conn.execute(
        """
        update clips
        set status = 'superseded',
            instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
              || %s::jsonb,
            updated_at = now()
        where topic_id = %s
          and status in ('active', 'flagged')
        """,
        (Jsonb({"action": "invalidate", "reason": reason}), topic_id),
    )
