from pathlib import Path

from fastapi.testclient import TestClient

from app.dependencies import get_ingestion_service
from app.ingestion.service import IngestionService
from app.main import app
from tests.fakes import (
    MemoryIngestionRepository,
    MemoryUploadStorage,
    NoopUrlFetcher,
    StaticASRProvider,
)


def test_upload_endpoint_processes_fixture_video_and_persists_transcript(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.mp4"
    media_path.write_bytes(b"fake media")
    service = IngestionService(
        repository=MemoryIngestionRepository(),
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    app.dependency_overrides[get_ingestion_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/videos/upload",
            files={"file": ("lecture.mp4", b"fake media", "video/mp4")},
        )

        assert response.status_code == 202
        job = response.json()
        status_response = client.get(f"/videos/jobs/{job['id']}")
        assert status_response.status_code == 200
        completed = status_response.json()
        assert completed["status"] == "complete"
        transcript_response = client.get(f"/videos/{completed['video_id']}/transcript")
        assert transcript_response.status_code == 200
        assert transcript_response.json()["text"] == "Hello adaptive learning."
    finally:
        app.dependency_overrides.clear()


def test_uploaded_video_media_is_available_for_clip_preview(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.mp4"
    media_path.write_bytes(b"fake media")
    service = IngestionService(
        repository=MemoryIngestionRepository(),
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    app.dependency_overrides[get_ingestion_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/videos/upload",
            files={"file": ("lecture.mp4", b"fake media", "video/mp4")},
        )
        assert response.status_code == 202
        video_id = response.json()["video_id"]

        media_response = client.get(f"/videos/{video_id}/media")

        assert media_response.status_code == 200
        assert media_response.content == b"fake media"
        assert media_response.headers["content-type"].startswith("video/mp4")
    finally:
        app.dependency_overrides.clear()


def test_timestamped_transcript_is_available_as_webvtt(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.mp4"
    media_path.write_bytes(b"fake media")
    service = IngestionService(
        repository=MemoryIngestionRepository(),
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    app.dependency_overrides[get_ingestion_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/videos/upload",
            files={"file": ("lecture.mp4", b"fake media", "video/mp4")},
        )
        video_id = response.json()["video_id"]

        captions = client.get(f"/videos/{video_id}/captions.vtt")

        assert captions.status_code == 200
        assert captions.headers["content-type"].startswith("text/vtt")
        assert "00:00:00.000 --> 00:00:01.700" in captions.text
        assert "Hello adaptive learning." in captions.text
    finally:
        app.dependency_overrides.clear()


def test_upload_endpoint_rejects_unsupported_file_type(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.bin"
    media_path.write_bytes(b"not media")
    service = IngestionService(
        repository=MemoryIngestionRepository(),
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    app.dependency_overrides[get_ingestion_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/videos/upload",
            files={"file": ("lecture.bin", b"not media", "application/octet-stream")},
        )

        assert response.status_code == 400
        assert "Unsupported upload content type" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_url_ingest_allows_browser_cors_preflight() -> None:
    client = TestClient(app)

    response = client.options(
        "/videos/url",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_local_delivery_capacity_is_unlimited(tmp_path: Path) -> None:
    media_path = tmp_path / "lecture.mp4"
    media_path.write_bytes(b"fake media")
    service = IngestionService(
        repository=MemoryIngestionRepository(),
        asr_provider=StaticASRProvider(),
        upload_storage=MemoryUploadStorage(media_path),
        url_fetcher=NoopUrlFetcher(media_path),
    )
    app.dependency_overrides[get_ingestion_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.get("/videos/delivery/capacity")

        assert response.status_code == 200
        assert response.json() == {
            "provider": "local",
            "stored_count": 0,
            "max_stored": None,
            "remaining": None,
            "can_upload": True,
        }
    finally:
        app.dependency_overrides.clear()
