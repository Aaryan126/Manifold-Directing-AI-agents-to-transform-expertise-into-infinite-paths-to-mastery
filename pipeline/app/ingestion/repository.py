from abc import ABC, abstractmethod
from uuid import UUID

from app.asr.base import Transcript
from app.ingestion.models import IngestionJob, SourceKind, VideoMedia


class IngestionRepository(ABC):
    @abstractmethod
    async def create_video_and_job(
        self,
        source_kind: SourceKind,
        source_uri: str,
        course_id: UUID | None,
        content_type: str | None,
    ) -> IngestionJob:
        """Create a video record and queued ingestion job."""

    @abstractmethod
    async def mark_processing(self, job_id: UUID) -> None:
        """Mark a queued job as processing."""

    @abstractmethod
    async def mark_complete(self, job_id: UUID, transcript: Transcript) -> None:
        """Persist transcript JSON and mark the job complete."""

    @abstractmethod
    async def mark_failed(self, job_id: UUID, error_message: str) -> None:
        """Persist a clear failure state."""

    @abstractmethod
    async def get_job(self, job_id: UUID) -> IngestionJob | None:
        """Return job status for polling."""

    @abstractmethod
    async def get_video_transcript(self, video_id: UUID) -> dict[str, object] | None:
        """Return stored transcript JSON for a video."""

    @abstractmethod
    async def get_video_media(self, video_id: UUID) -> VideoMedia | None:
        """Return media source metadata for preview playback."""
