from pathlib import Path

import pytest

from app.ingestion.models import IngestionJobStatus
from app.ingestion.service import IngestionService
from tests.fakes import (
    MemoryIngestionRepository,
    MemoryUploadStorage,
    NoopUrlFetcher,
    StaticASRProvider,
)


@pytest.mark.anyio
async def test_process_upload_job_transitions_to_complete(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.mp4"
    media_path.write_bytes(b"fake media")
    repository = MemoryIngestionRepository()
    service = IngestionService(
        repository=repository,
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    job = await service.create_upload_job(str(media_path), "video/mp4", None)

    await service.process_job(job.id)

    completed = await service.get_job(job.id)
    assert completed is not None
    assert completed.status == IngestionJobStatus.COMPLETE
    assert completed.progress == 100
    assert completed.video_id is not None
    transcript = await service.get_video_transcript(completed.video_id)
    assert transcript is not None
    assert transcript["text"] == "Hello adaptive learning."
    assert len(transcript["words"]) == 3


@pytest.mark.anyio
async def test_process_url_job_records_clear_failure(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.mp4"
    media_path.write_bytes(b"fake media")
    repository = MemoryIngestionRepository()
    service = IngestionService(
        repository=repository,
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    job = await service.create_url_job("https://example.com/unsupported", None)

    await service.process_job(job.id)

    failed = await service.get_job(job.id)
    assert failed is not None
    assert failed.status == IngestionJobStatus.FAILED
    assert failed.error_message == "URL did not resolve to a supported direct audio/video file."
