from pathlib import Path
from uuid import UUID

from fastapi import UploadFile

from app.asr.base import ASRProvider
from app.ingestion.models import IngestionJob, SourceKind, StoredUpload, VideoMedia
from app.ingestion.repository import IngestionRepository
from app.ingestion.storage import LocalUploadStorage
from app.ingestion.url_fetcher import DirectUrlFetcher
from app.video.base import (
    DeliveryCapacity,
    VideoCapacityError,
    VideoDeliveryProvider,
    VideoSource,
)


class IngestionService:
    def __init__(
        self,
        repository: IngestionRepository,
        asr_provider: ASRProvider,
        upload_storage: LocalUploadStorage,
        url_fetcher: DirectUrlFetcher,
        video_delivery_provider: VideoDeliveryProvider | None = None,
    ) -> None:
        self._repository = repository
        self._asr_provider = asr_provider
        self._upload_storage = upload_storage
        self._url_fetcher = url_fetcher
        self._video_delivery_provider = video_delivery_provider

    async def store_upload(self, upload: UploadFile) -> StoredUpload:
        return await self._upload_storage.store(upload)

    async def create_upload_job(
        self,
        stored_source_uri: str,
        content_type: str,
        course_id: UUID | None,
    ) -> IngestionJob:
        await self.ensure_delivery_capacity()
        return await self._repository.create_video_and_job(
            source_kind=SourceKind.UPLOAD,
            source_uri=stored_source_uri,
            course_id=course_id,
            content_type=content_type,
        )

    async def create_url_job(self, url: str, course_id: UUID | None) -> IngestionJob:
        await self.ensure_delivery_capacity()
        return await self._repository.create_video_and_job(
            source_kind=SourceKind.URL,
            source_uri=url,
            course_id=course_id,
            content_type=None,
        )

    async def process_job(self, job_id: UUID) -> None:
        job = await self._repository.get_job(job_id)
        if job is None:
            return

        try:
            await self._repository.mark_processing(job_id)
            media_path = (
                await self._url_fetcher.fetch(job.source_uri)
                if job.source_kind == SourceKind.URL
                else self._upload_storage_path(job.source_uri)
            )
            transcript = await self._asr_provider.transcribe(media_path)
            playback = None
            if self._video_delivery_provider is not None:
                media = (
                    await self._repository.get_video_media(job.video_id) if job.video_id else None
                )
                playback = await self._video_delivery_provider.create_playback_reference(
                    VideoSource(
                        local_path=media_path,
                        content_type=(
                            media.content_type if media and media.content_type else "video/mp4"
                        ),
                    ),
                )
            await self._repository.mark_complete(job_id, transcript, playback)
        except Exception as exc:
            await self._repository.mark_failed(job_id, str(exc))

    async def get_job(self, job_id: UUID) -> IngestionJob | None:
        return await self._repository.get_job(job_id)

    async def get_video_transcript(self, video_id: UUID) -> dict[str, object] | None:
        return await self._repository.get_video_transcript(video_id)

    async def get_video_media(self, video_id: UUID) -> VideoMedia | None:
        return await self._repository.get_video_media(video_id)

    async def delivery_capacity(self) -> DeliveryCapacity:
        if self._video_delivery_provider is None:
            return DeliveryCapacity(provider="local", stored_count=0, max_stored=None)
        return await self._video_delivery_provider.capacity()

    async def ensure_delivery_capacity(self) -> None:
        capacity = await self.delivery_capacity()
        if not capacity.can_upload:
            raise VideoCapacityError(
                "Mux storage is at the configured 10-video Free Plan limit. "
                "Delete an unneeded Mux asset or use VIDEO_PROVIDER=local; "
                "no video was overwritten.",
            )

    @staticmethod
    def _upload_storage_path(source_uri: str) -> Path:
        return Path(source_uri)
