from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_segmentation_service
from app.segmentation.models import Topic, TopicEdit
from app.segmentation.service import SegmentationService, TopicValidationError

router = APIRouter(prefix="/videos", tags=["topics"])
SegmentationServiceDependency = Annotated[SegmentationService, Depends(get_segmentation_service)]


class TopicResponse(BaseModel):
    id: UUID
    course_id: UUID
    video_id: UUID
    title: str
    summary: str | None
    start_seconds: float
    end_seconds: float
    review_status: str
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None


class TopicEditRequest(BaseModel):
    title: str = Field(min_length=1)
    summary: str = ""
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)


class TopicSplitRequest(BaseModel):
    split_seconds: float = Field(gt=0)


class TopicMergeRequest(BaseModel):
    first_topic_id: UUID
    second_topic_id: UUID


@router.post("/{video_id}/segment", response_model=list[TopicResponse])
async def segment_video(
    video_id: UUID,
    service: SegmentationServiceDependency,
) -> list[TopicResponse]:
    try:
        topics = await service.propose_topics(video_id)
    except TopicValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [_topic_response(topic) for topic in topics]


@router.get("/{video_id}/topics", response_model=list[TopicResponse])
async def list_video_topics(
    video_id: UUID,
    service: SegmentationServiceDependency,
) -> list[TopicResponse]:
    return [_topic_response(topic) for topic in await service.list_topics(video_id)]


@router.post("/{video_id}/topics", response_model=TopicResponse, status_code=201)
async def add_manual_topic(
    video_id: UUID,
    request: TopicEditRequest,
    service: SegmentationServiceDependency,
) -> TopicResponse:
    try:
        topic = await service.add_manual_topic(video_id, _edit_from_request(request, "add"))
    except TopicValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _topic_response(topic)


@router.patch("/topics/{topic_id}", response_model=TopicResponse)
async def edit_topic(
    topic_id: UUID,
    request: TopicEditRequest,
    service: SegmentationServiceDependency,
) -> TopicResponse:
    try:
        topic = await service.edit_topic(topic_id, _edit_from_request(request, "edit"))
    except TopicValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found.")
    return _topic_response(topic)


@router.post("/topics/{topic_id}/accept", response_model=TopicResponse)
async def accept_topic(
    topic_id: UUID,
    service: SegmentationServiceDependency,
) -> TopicResponse:
    topic = await service.accept_topic(topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found.")
    return _topic_response(topic)


@router.post("/topics/{topic_id}/dismiss", response_model=TopicResponse)
async def dismiss_topic(
    topic_id: UUID,
    service: SegmentationServiceDependency,
) -> TopicResponse:
    topic = await service.dismiss_topic(topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found.")
    return _topic_response(topic)


@router.post("/topics/merge", response_model=TopicResponse)
async def merge_topics(
    request: TopicMergeRequest,
    service: SegmentationServiceDependency,
) -> TopicResponse:
    try:
        topic = await service.merge_topics(request.first_topic_id, request.second_topic_id)
    except TopicValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found.")
    return _topic_response(topic)


@router.post("/topics/{topic_id}/split", response_model=list[TopicResponse])
async def split_topic(
    topic_id: UUID,
    request: TopicSplitRequest,
    service: SegmentationServiceDependency,
) -> list[TopicResponse]:
    try:
        topics = await service.split_topic(topic_id, request.split_seconds)
    except TopicValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if topics is None:
        raise HTTPException(status_code=404, detail="Topic not found.")
    return [_topic_response(topic) for topic in topics]


def _edit_from_request(request: TopicEditRequest, action: str) -> TopicEdit:
    return TopicEdit(
        title=request.title,
        summary=request.summary,
        start_seconds=request.start_seconds,
        end_seconds=request.end_seconds,
        action=action,
    )


def _topic_response(topic: Topic) -> TopicResponse:
    return TopicResponse(
        id=topic.id,
        course_id=topic.course_id,
        video_id=topic.video_id,
        title=topic.title,
        summary=topic.summary,
        start_seconds=topic.start_seconds,
        end_seconds=topic.end_seconds,
        review_status=topic.review_status.value,
        ai_proposal=topic.ai_proposal,
        instructor_revision=topic.instructor_revision,
        approved_at=topic.approved_at,
        dismissed_at=topic.dismissed_at,
    )
