from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, HttpUrl

from app.dependencies import get_ingestion_service
from app.ingestion.models import IngestionJob, SourceKind
from app.ingestion.service import IngestionService

router = APIRouter(prefix="/videos", tags=["videos"])
IngestionServiceDependency = Annotated[IngestionService, Depends(get_ingestion_service)]


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    course_id: UUID | None = None


class IngestionJobResponse(BaseModel):
    id: UUID
    video_id: UUID | None
    course_id: UUID | None
    source_kind: str
    source_uri: str
    status: str
    progress: float
    error_message: str | None


@router.post("/upload", response_model=IngestionJobResponse, status_code=202)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    service: IngestionServiceDependency,
    course_id: Annotated[UUID | None, Form()] = None,
) -> IngestionJobResponse:
    try:
        stored = await service.store_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = await service.create_upload_job(stored.source_uri, stored.content_type, course_id)
    background_tasks.add_task(service.process_job, job.id)
    return _job_response(job)


@router.post("/url", response_model=IngestionJobResponse, status_code=202)
async def ingest_url(
    request: UrlIngestRequest,
    background_tasks: BackgroundTasks,
    service: IngestionServiceDependency,
) -> IngestionJobResponse:
    job = await service.create_url_job(str(request.url), request.course_id)
    background_tasks.add_task(service.process_job, job.id)
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
