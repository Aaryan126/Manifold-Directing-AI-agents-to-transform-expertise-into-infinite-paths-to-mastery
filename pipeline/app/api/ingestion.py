from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, HttpUrl

from app.dependencies import get_ingestion_service
from app.ingestion.models import IngestionJob, SourceKind
from app.ingestion.service import IngestionService
from app.video.base import VideoCapacityError, VideoDeliveryError

router = APIRouter(prefix="/videos", tags=["videos"])
IngestionServiceDependency = Annotated[IngestionService, Depends(get_ingestion_service)]


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    course_id: UUID | None = None
    defer_processing: bool = False


class IngestionJobResponse(BaseModel):
    id: UUID
    video_id: UUID | None
    course_id: UUID | None
    source_kind: str
    source_uri: str
    status: str
    progress: float
    error_message: str | None


class DeliveryCapacityResponse(BaseModel):
    provider: str
    stored_count: int
    max_stored: int | None
    remaining: int | None
    can_upload: bool


class PlaybackResponse(BaseModel):
    provider: str
    playback_id: str | None
    playback_url: str
    delivery_asset_id: str | None


@router.get("/delivery/capacity", response_model=DeliveryCapacityResponse)
async def delivery_capacity(service: IngestionServiceDependency) -> DeliveryCapacityResponse:
    try:
        capacity = await service.delivery_capacity()
    except VideoDeliveryError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return DeliveryCapacityResponse(
        provider=capacity.provider,
        stored_count=capacity.stored_count,
        max_stored=capacity.max_stored,
        remaining=capacity.remaining,
        can_upload=capacity.can_upload,
    )


@router.post("/upload", response_model=IngestionJobResponse, status_code=202)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    service: IngestionServiceDependency,
    course_id: Annotated[UUID | None, Form()] = None,
    defer_processing: Annotated[bool, Form()] = False,
) -> IngestionJobResponse:
    try:
        stored = await service.store_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        job = await service.create_upload_job(stored.source_uri, stored.content_type, course_id)
    except VideoCapacityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not defer_processing:
        background_tasks.add_task(service.process_job, job.id)
    return _job_response(job)


@router.post("/url", response_model=IngestionJobResponse, status_code=202)
async def ingest_url(
    request: UrlIngestRequest,
    background_tasks: BackgroundTasks,
    service: IngestionServiceDependency,
) -> IngestionJobResponse:
    try:
        job = await service.create_url_job(str(request.url), request.course_id)
    except VideoCapacityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not request.defer_processing:
        background_tasks.add_task(service.process_job, job.id)
    return _job_response(job)


@router.post("/demo", response_model=IngestionJobResponse)
async def load_demo_video(service: IngestionServiceDependency) -> IngestionJobResponse:
    try:
        job = await service.get_or_create_demo_job()
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _job_response(job)


@router.get("/jobs/{job_id}", response_model=IngestionJobResponse)
async def get_job(
    job_id: UUID,
    service: IngestionServiceDependency,
) -> IngestionJobResponse:
    job = await service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found.")
    return _job_response(job)


@router.get("/{video_id}/transcript")
async def get_video_transcript(
    video_id: UUID,
    service: IngestionServiceDependency,
) -> dict[str, object]:
    transcript = await service.get_video_transcript(video_id)
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found.")
    return transcript


@router.get("/{video_id}/captions.vtt")
async def get_video_captions(
    video_id: UUID,
    service: IngestionServiceDependency,
) -> Response:
    transcript = await service.get_video_transcript(video_id)
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found.")
    words = transcript.get("words")
    if not isinstance(words, list):
        raise HTTPException(status_code=404, detail="Timestamped transcript not found.")
    return Response(
        content=_transcript_vtt(words),
        media_type="text/vtt",
        headers={"Content-Disposition": 'inline; filename="captions.vtt"'},
    )


@router.get("/{video_id}/media")
async def get_video_media(
    video_id: UUID,
    service: IngestionServiceDependency,
) -> Response:
    media = await service.get_video_media(video_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Video media not found.")
    if media.source_kind == SourceKind.URL:
        return RedirectResponse(media.source_uri)

    path = Path(media.source_uri)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Local video media not found.")
    return FileResponse(
        path,
        media_type=media.content_type or "application/octet-stream",
        filename=path.name,
    )


@router.get("/{video_id}/playback", response_model=PlaybackResponse)
async def get_video_playback(
    video_id: UUID,
    service: IngestionServiceDependency,
) -> PlaybackResponse:
    media = await service.get_video_media(video_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Video playback not found.")
    if media.playback_provider == "mux" and media.playback_url:
        return PlaybackResponse(
            provider="mux",
            playback_id=media.playback_id,
            playback_url=media.playback_url,
            delivery_asset_id=media.delivery_asset_id,
        )
    return PlaybackResponse(
        provider="local",
        playback_id=media.playback_id,
        playback_url=f"/videos/{video_id}/media",
        delivery_asset_id=None,
    )


def _job_response(job: IngestionJob) -> IngestionJobResponse:
    return IngestionJobResponse(
        id=job.id,
        video_id=job.video_id,
        course_id=job.course_id,
        source_kind=job.source_kind.value,
        source_uri=job.source_uri,
        status=job.status.value,
        progress=job.progress,
        error_message=job.error_message,
    )


def _transcript_vtt(words: list[object]) -> str:
    cues: list[str] = ["WEBVTT", ""]
    valid_words = [word for word in words if isinstance(word, dict)]
    for cue_index, start in enumerate(range(0, len(valid_words), 8), start=1):
        chunk = valid_words[start : start + 8]
        if not chunk:
            continue
        start_seconds = float(chunk[0].get("start_seconds", 0))
        end_seconds = float(chunk[-1].get("end_seconds", start_seconds + 0.1))
        text = " ".join(str(word.get("text", "")).strip() for word in chunk).strip()
        if not text:
            continue
        cues.extend(
            [
                str(cue_index),
                f"{_vtt_timestamp(start_seconds)} --> {_vtt_timestamp(end_seconds)}",
                text,
                "",
            ],
        )
    return "\n".join(cues)


def _vtt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{millis:03d}"
