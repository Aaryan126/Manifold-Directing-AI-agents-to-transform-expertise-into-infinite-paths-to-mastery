from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.access.models import WatchEventCreate
from app.access.service import AccessService, AccessValidationError
from app.dependencies import get_access_service

router = APIRouter(tags=["access"])
AccessServiceDependency = Annotated[AccessService, Depends(get_access_service)]
UserContext = Annotated[UUID, Header(alias="X-User-ID")]


class IdentityResponse(BaseModel):
    id: UUID
    email: str
    display_name: str
    role: str


class CourseResponse(BaseModel):
    id: UUID
    instructor_id: UUID
    title: str
    description: str | None
    status: str
    published_at: str | None


class PublishReadinessResponse(BaseModel):
    course_id: UUID
    ready: bool
    blockers: list[str]


class EnrollmentResponse(BaseModel):
    enrolled: bool


class WatchEventRequest(BaseModel):
    video_id: UUID
    clip_id: UUID | None = None
    path_mode: str
    watched_seconds: float = Field(ge=0)


class WatchEventResponse(BaseModel):
    id: UUID


@router.get("/development/identities", response_model=list[IdentityResponse])
async def development_identities(service: AccessServiceDependency) -> list[IdentityResponse]:
    identities = await service.development_identities()
    return [
        IdentityResponse(
            id=identity.id,
            email=identity.email,
            display_name=identity.display_name,
            role=identity.role.value,
        )
        for identity in identities
    ]


@router.get("/courses/{course_id}", response_model=CourseResponse)
async def get_course(course_id: UUID, service: AccessServiceDependency) -> CourseResponse:
    course = await service.course(course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found.")
    return _course_response(course)


@router.get(
    "/courses/{course_id}/publish-readiness",
    response_model=PublishReadinessResponse,
)
async def publish_readiness(
    course_id: UUID,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> PublishReadinessResponse:
    try:
        readiness = await service.publish_readiness(course_id, user_id)
    except AccessValidationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return PublishReadinessResponse(
        course_id=readiness.course_id,
        ready=readiness.ready,
        blockers=list(readiness.blockers),
    )


@router.post("/courses/{course_id}/publish", response_model=CourseResponse)
async def publish_course(
    course_id: UUID,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> CourseResponse:
    try:
        course = await service.publish(course_id, user_id)
    except AccessValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _course_response(course)


@router.post("/courses/{course_id}/enrollment", response_model=EnrollmentResponse)
async def enroll(
    course_id: UUID,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> EnrollmentResponse:
    try:
        await service.enroll(course_id, user_id)
    except AccessValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EnrollmentResponse(enrolled=True)


@router.get("/courses/{course_id}/enrollment", response_model=EnrollmentResponse)
async def enrollment_status(
    course_id: UUID,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> EnrollmentResponse:
    return EnrollmentResponse(enrolled=await service.is_enrolled(course_id, user_id))


@router.post(
    "/courses/{course_id}/watch-events",
    response_model=WatchEventResponse,
    status_code=201,
)
async def record_watch_event(
    course_id: UUID,
    request: WatchEventRequest,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> WatchEventResponse:
    try:
        event_id = await service.record_watch_event(
            WatchEventCreate(
                learner_id=user_id,
                course_id=course_id,
                video_id=request.video_id,
                clip_id=request.clip_id,
                path_mode=request.path_mode,
                watched_seconds=request.watched_seconds,
            ),
        )
    except AccessValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return WatchEventResponse(id=event_id)


def _course_response(course: object) -> CourseResponse:
    from app.access.models import CourseAccess

    if not isinstance(course, CourseAccess):
        raise TypeError("Expected CourseAccess.")
    return CourseResponse(
        id=course.id,
        instructor_id=course.instructor_id,
        title=course.title,
        description=course.description,
        status=course.status.value,
        published_at=course.published_at,
    )
