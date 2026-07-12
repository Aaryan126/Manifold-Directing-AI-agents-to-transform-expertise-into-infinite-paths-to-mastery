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
                where video_id = %s and review_status = 'proposed'
                """,
                (video_id,),
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
                    select *
                    from topics
                    where video_id = %s and review_status <> 'dismissed'
                    order by start_seconds asc, created_at asc
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


def _proposal_json(proposal: TopicProposal) -> dict[str, object]:
    return {
        "title": proposal.title,
        "summary": proposal.summary,
        "start_seconds": proposal.start_seconds,
        "end_seconds": proposal.end_seconds,
        "evidence": proposal.evidence,
        "confidence": proposal.confidence,
    }


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
