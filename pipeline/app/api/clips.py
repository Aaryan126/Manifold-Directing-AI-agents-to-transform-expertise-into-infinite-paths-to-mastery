from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app.clips.models import Clip
from app.clips.service import ClipService, ClipValidationError
from app.dependencies import get_clip_service
from app.segmentation.models import TranscriptWord

router = APIRouter(tags=["clips"])
ClipServiceDependency = Annotated[ClipService, Depends(get_clip_service)]


class ClipResponse(BaseModel):
    id: UUID
    topic_id: UUID
    start_seconds: float
    end_seconds: float
    type: str
    difficulty: str | None
    status: str
    concept_ids: list[UUID]
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    flagged_at: str | None
    flag_note: str | None
    superseded_by_clip_id: UUID | None
    source_clip_id: UUID | None
    playback_provider: str | None
    playback_id: str | None
    materialization_status: str
    materialization_error: str | None
    created_at: str | None


class FlagClipRequest(BaseModel):
    note: str = Field(min_length=1)


@router.post("/topics/{topic_id}/clips/generate", response_model=list[ClipResponse])
async def generate_clips(
    topic_id: UUID,
    service: ClipServiceDependency,
) -> list[ClipResponse]:
    try:
        clips = await service.generate_clips_for_topic(topic_id)
    except ClipValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [_clip_response(clip) for clip in clips]


@router.get("/videos/{video_id}/clips", response_model=list[ClipResponse])
async def list_video_clips(
    video_id: UUID,
    service: ClipServiceDependency,
) -> list[ClipResponse]:
    return [_clip_response(clip) for clip in await service.list_clips_for_video(video_id)]


@router.post("/videos/{video_id}/clips/materialize", response_model=list[ClipResponse])
async def materialize_video_clips(
    video_id: UUID,
    service: ClipServiceDependency,
) -> list[ClipResponse]:
    return [
        _clip_response(clip)
        for clip in await service.materialize_clips_for_video(video_id)
    ]


@router.get("/clips/{clip_id}/media")
async def get_clip_media(
    clip_id: UUID,
    service: ClipServiceDependency,
) -> FileResponse:
    path = await service.get_clip_media(clip_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Materialized clip media not found.")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
        content_disposition_type="inline",
    )


@router.get("/clips/{clip_id}/captions.vtt")
async def get_clip_captions(
    clip_id: UUID,
    service: ClipServiceDependency,
) -> Response:
    found = await service.get_clip_with_context(clip_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Clip captions not found.")
    clip, context = found
    words = tuple(
        word
        for word in context.words
        if word.end_seconds > clip.start_seconds and word.start_seconds < clip.end_seconds
    )
    return Response(
        content=_clip_vtt(words, clip.start_seconds, clip.end_seconds),
        media_type="text/vtt",
        headers={"Content-Disposition": 'inline; filename="captions.vtt"'},
    )


@router.post("/clips/{clip_id}/flag", response_model=ClipResponse)
async def flag_clip(
    clip_id: UUID,
    request: FlagClipRequest,
    service: ClipServiceDependency,
) -> ClipResponse:
    try:
        clip = await service.flag_clip(clip_id, request.note)
    except ClipValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found.")
    return _clip_response(clip)


@router.post("/clips/{clip_id}/recut", response_model=ClipResponse)
async def recut_clip(
    clip_id: UUID,
    request: FlagClipRequest,
    service: ClipServiceDependency,
) -> ClipResponse:
    try:
        clip = await service.recut_clip(clip_id, request.note)
    except ClipValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found.")
    return _clip_response(clip)


def _clip_response(clip: Clip) -> ClipResponse:
    return ClipResponse(
        id=clip.id,
        topic_id=clip.topic_id,
        start_seconds=clip.start_seconds,
        end_seconds=clip.end_seconds,
        type=clip.type.value,
        difficulty=clip.difficulty,
        status=clip.status.value,
        concept_ids=list(clip.concept_ids),
        ai_proposal=clip.ai_proposal,
        instructor_revision=clip.instructor_revision,
        flagged_at=clip.flagged_at,
        flag_note=clip.flag_note,
        superseded_by_clip_id=clip.superseded_by_clip_id,
        source_clip_id=clip.source_clip_id,
        playback_provider=clip.playback_provider,
        playback_id=clip.playback_id,
        materialization_status=clip.materialization_status.value,
        materialization_error=clip.materialization_error,
        created_at=clip.created_at,
    )


def _clip_vtt(
    words: tuple[TranscriptWord, ...],
    clip_start_seconds: float,
    clip_end_seconds: float,
) -> str:
    cues = ["WEBVTT", ""]
    for cue_index, start in enumerate(range(0, len(words), 8), start=1):
        chunk = words[start : start + 8]
        if not chunk:
            continue
        first = chunk[0]
        last = chunk[-1]
        first_start = first.start_seconds
        last_end = last.end_seconds
        start_seconds = max(0.0, first_start - clip_start_seconds)
        end_seconds = min(clip_end_seconds, last_end) - clip_start_seconds
        text = " ".join(word.text.strip() for word in chunk).strip()
        if not text or end_seconds <= start_seconds:
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
