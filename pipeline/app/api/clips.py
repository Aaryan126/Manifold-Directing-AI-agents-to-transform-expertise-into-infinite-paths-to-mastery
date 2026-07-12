from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.clips.models import Clip
from app.clips.service import ClipService, ClipValidationError
from app.dependencies import get_clip_service

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
        created_at=clip.created_at,
    )
