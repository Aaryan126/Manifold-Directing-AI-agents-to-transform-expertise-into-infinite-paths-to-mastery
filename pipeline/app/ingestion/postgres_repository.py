from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.asr.base import Transcript
from app.ingestion.models import (
    IngestionJob,
    IngestionJobStatus,
    SourceKind,
    VideoMedia,
    transcript_to_json,
)
from app.ingestion.repository import IngestionRepository
from app.video.base import PlaybackReference


class PostgresIngestionRepository(IngestionRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def create_video_and_job(
        self,
        source_kind: SourceKind,
        source_uri: str,
        course_id: UUID | None,
        content_type: str | None,
    ) -> IngestionJob:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            resolved_course_id = course_id or await self._ensure_dev_course(conn)
            video_row = await (
                await conn.execute(
                    """
                    insert into videos (course_id, source_kind, source_uri, source_metadata)
                    values (%s, %s, %s, %s::jsonb)
                    returning id
                    """,
                    (
                        resolved_course_id,
                        source_kind.value,
                        source_uri,
                        Jsonb({"content_type": content_type} if content_type else {}),
                    ),
                )
            ).fetchone()
            if video_row is None:
                raise RuntimeError("Failed to create video record.")
            job_row = await (
                await conn.execute(
                    """
                    insert into ingestion_jobs (video_id, course_id, source_kind, source_uri)
                    values (%s, %s, %s, %s)
                    returning *
                    """,
                    (video_row["id"], resolved_course_id, source_kind.value, source_uri),
                )
            ).fetchone()
            if job_row is None:
                raise RuntimeError("Failed to create ingestion job.")
            return _job_from_row(job_row)

    async def get_or_create_demo_job(
        self,
        source_uri: str,
        transcript: dict[str, object],
        duration_seconds: float,
    ) -> IngestionJob:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            course_id = await self._ensure_demo_course(conn)
            existing = await (
                await conn.execute(
                    """
                    select j.*
                    from ingestion_jobs j
                    join videos v on v.id = j.video_id
                    where v.source_metadata ->> 'demo_fixture' = 'manifold-default'
                      and v.course_id = %s
                      and j.course_id = %s
                      and j.status = 'complete'
                    order by j.created_at
                    limit 1
                    """,
                    (course_id, course_id),
                )
            ).fetchone()
            if existing is not None:
                await conn.execute(
                    "update videos set source_uri = %s where id = %s",
                    (source_uri, existing["video_id"]),
                )
                await conn.execute(
                    "update ingestion_jobs set source_uri = %s where id = %s",
                    (source_uri, existing["id"]),
                )
                return _job_from_row({
                    **existing,
                    "source_uri": source_uri,
                    "course_id": course_id,
                })

            video_row = await (
                await conn.execute(
                    """
                    insert into videos (
                        course_id, source_kind, source_uri, playback_provider,
                        duration_seconds, transcript, source_metadata
                    )
                    values (%s, 'upload', %s, 'local', %s, %s::jsonb, %s::jsonb)
                    returning id
                    """,
                    (
                        course_id,
                        source_uri,
                        duration_seconds,
                        Jsonb(transcript),
                        Jsonb({
                            "content_type": "video/mp4",
                            "demo_fixture": "manifold-default",
                        }),
                    ),
                )
            ).fetchone()
            if video_row is None:
                raise RuntimeError("Failed to create demo video record.")
            job_row = await (
                await conn.execute(
                    """
                    insert into ingestion_jobs (
                        video_id, course_id, source_kind, source_uri, status,
                        progress, completed_at
                    )
                    values (%s, %s, 'upload', %s, 'complete', 100, now())
                    returning *
                    """,
                    (video_row["id"], course_id, source_uri),
                )
            ).fetchone()
            if job_row is None:
                raise RuntimeError("Failed to create demo ingestion job.")
            return _job_from_row(job_row)

    async def mark_processing(self, job_id: UUID) -> None:
        await self._execute_status_update(
            """
            update ingestion_jobs
            set status = 'processing', progress = 10, updated_at = now()
            where id = %s
            """,
            (job_id,),
        )

    async def mark_complete(
        self,
        job_id: UUID,
        transcript: Transcript,
        playback: PlaybackReference | None = None,
        local_source_uri: str | None = None,
    ) -> None:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            await conn.execute(
                """
                update videos
                set transcript = %s::jsonb,
                    playback_provider = coalesce(%s, playback_provider),
                    playback_id = coalesce(%s, playback_id),
                    source_metadata = source_metadata || %s::jsonb
                where id = (select video_id from ingestion_jobs where id = %s)
                """,
                (
                    Jsonb(transcript_to_json(transcript)),
                    playback.provider if playback else None,
                    playback.playback_id if playback else None,
                    Jsonb(
                        {
                            "playback_url": playback.playback_url,
                            "delivery_asset_id": playback.asset_id,
                            "local_source_uri": local_source_uri,
                        }
                        if playback
                        else ({"local_source_uri": local_source_uri} if local_source_uri else {}),
                    ),
                    job_id,
                ),
            )
            await conn.execute(
                """
                update ingestion_jobs
                set status = 'complete',
                    progress = 100,
                    error_message = null,
                    updated_at = now(),
                    completed_at = now()
                where id = %s
                """,
                (job_id,),
            )

    async def mark_failed(self, job_id: UUID, error_message: str) -> None:
        await self._execute_status_update(
            """
            update ingestion_jobs
            set status = 'failed',
                progress = 100,
                error_message = %s,
                updated_at = now(),
                completed_at = now()
            where id = %s
            """,
            (error_message, job_id),
        )

    async def get_job(self, job_id: UUID) -> IngestionJob | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select * from ingestion_jobs where id = %s", (job_id,))
            ).fetchone()
            return _job_from_row(row) if row else None

    async def get_video_transcript(self, video_id: UUID) -> dict[str, object] | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select transcript from videos where id = %s", (video_id,))
            ).fetchone()
            if row is None:
                return None
            transcript = row["transcript"]
            return transcript if isinstance(transcript, dict) else None

    async def get_video_media(self, video_id: UUID) -> VideoMedia | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    select source_kind, source_uri, source_metadata,
                           playback_provider, playback_id
                    from videos
                    where id = %s
                    """,
                    (video_id,),
                )
            ).fetchone()
            if row is None:
                return None
            metadata = row["source_metadata"] if isinstance(row["source_metadata"], dict) else {}
            content_type = metadata.get("content_type")
            playback_url = metadata.get("playback_url")
            delivery_asset_id = metadata.get("delivery_asset_id")
            local_source_uri = metadata.get("local_source_uri")
            return VideoMedia(
                source_kind=SourceKind(str(row["source_kind"])),
                source_uri=str(row["source_uri"]),
                content_type=str(content_type) if content_type else None,
                playback_provider=(
                    str(row["playback_provider"]) if row["playback_provider"] else None
                ),
                playback_id=str(row["playback_id"]) if row["playback_id"] else None,
                playback_url=str(playback_url) if playback_url else None,
                delivery_asset_id=str(delivery_asset_id) if delivery_asset_id else None,
                local_source_uri=str(local_source_uri) if local_source_uri else None,
            )

    async def _ensure_dev_course(self, conn: psycopg.AsyncConnection[dict[str, Any]]) -> UUID:
        user_row = await (
            await conn.execute(
                """
                insert into users (email, role)
                values ('dev-instructor@coursefoundry.local', 'instructor')
                on conflict (email) do update set email = excluded.email
                returning id
                """
            )
        ).fetchone()
        if user_row is None:
            raise RuntimeError("Failed to create dev instructor.")
        course_row = await (
            await conn.execute(
                """
                insert into courses (instructor_id, title, description)
                values (%s, 'Development Course', 'Auto-created for local Phase 1 ingestion.')
                returning id
                """,
                (user_row["id"],),
            )
        ).fetchone()
        if course_row is None:
            raise RuntimeError("Failed to create dev course.")
        return UUID(str(course_row["id"]))

    async def _ensure_demo_course(self, conn: psycopg.AsyncConnection[dict[str, Any]]) -> UUID:
        user_row = await (
            await conn.execute(
                """
                insert into users (email, role, display_name)
                values ('dev-instructor@coursefoundry.local', 'instructor', 'Dev Instructor')
                on conflict (email) do update set display_name = excluded.display_name
                returning id
                """
            )
        ).fetchone()
        if user_row is None:
            raise RuntimeError("Failed to create demo instructor.")
        existing = await (
            await conn.execute(
                """
                select id from courses
                where instructor_id = %s and title = 'Learn Anything in 20 Hours'
                order by created_at
                limit 1
                """,
                (user_row["id"],),
            )
        ).fetchone()
        if existing is not None:
            return UUID(str(existing["id"]))
        course_row = await (
            await conn.execute(
                """
                insert into courses (instructor_id, title, description)
                values (%s, 'Learn Anything in 20 Hours', 'Reusable Manifold demonstration course.')
                returning id
                """,
                (user_row["id"],),
            )
        ).fetchone()
        if course_row is None:
            raise RuntimeError("Failed to create demo course.")
        return UUID(str(course_row["id"]))

    async def _execute_status_update(self, sql: str, params: tuple[object, ...]) -> None:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            await conn.execute(sql, params)


def _job_from_row(row: dict[str, Any]) -> IngestionJob:
    return IngestionJob(
        id=UUID(str(row["id"])),
        video_id=UUID(str(row["video_id"])) if row["video_id"] else None,
        course_id=UUID(str(row["course_id"])) if row["course_id"] else None,
        source_kind=SourceKind(str(row["source_kind"])),
        source_uri=str(row["source_uri"]),
        status=IngestionJobStatus(str(row["status"])),
        progress=float(row["progress"]),
        error_message=str(row["error_message"]) if row["error_message"] else None,
    )
