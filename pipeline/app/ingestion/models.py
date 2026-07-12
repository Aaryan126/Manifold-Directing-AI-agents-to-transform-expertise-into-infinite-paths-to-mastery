from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from uuid import UUID

from app.asr.base import Transcript


class IngestionJobStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"


class SourceKind(StrEnum):
    UPLOAD = "upload"
    URL = "url"


@dataclass(frozen=True)
class IngestionJob:
    id: UUID
    video_id: UUID | None
    course_id: UUID | None
    source_kind: SourceKind
    source_uri: str
    status: IngestionJobStatus
    progress: float
    error_message: str | None


@dataclass(frozen=True)
class StoredUpload:
    path: Path
    source_uri: str
    content_type: str


@dataclass(frozen=True)
class VideoMedia:
    source_kind: SourceKind
    source_uri: str
    content_type: str | None
    playback_provider: str | None = None
    playback_id: str | None = None
    playback_url: str | None = None
    delivery_asset_id: str | None = None


def transcript_to_json(transcript: Transcript) -> dict[str, object]:
    return {
        "text": transcript.text,
        "words": [
            {
                "text": word.text,
                "start_seconds": word.start_seconds,
                "end_seconds": word.end_seconds,
            }
            for word in transcript.words
        ],
    }
