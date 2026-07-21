from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
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


class DevelopmentLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class LearnerCourseSummaryResponse(BaseModel):
    id: UUID
    title: str
    description: str | None
    enrolled: bool
    topic_count: int
    concept_count: int
    mastered_concept_count: int


class LearnerTopicResponse(BaseModel):
    id: UUID
    title: str
    summary: str | None


class LearnerClipResponse(BaseModel):
    id: UUID
    topic_id: UUID
    video_id: UUID
    title: str
    start_seconds: float
    end_seconds: float
    type: str
    difficulty: str | None
    playback_provider: str
    playback_id: str | None
    playback_url: str
    delivery_asset_id: str | None
    materialization_status: str


class LearnerQuestionResponse(BaseModel):
    id: UUID
    topic_id: UUID
    body: str
    type: str
    choices: list[str]
    confidence_prompt: str


class LearnerResourceResponse(BaseModel):
    id: UUID
    filename: str
    source_type: str
    size_bytes: int


class LearnerCourseExperienceResponse(BaseModel):
    id: UUID
    title: str
    description: str | None
    topics: list[LearnerTopicResponse]
    clips: list[LearnerClipResponse]
    questions: list[LearnerQuestionResponse]
    resources: list[LearnerResourceResponse]


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


@router.post("/development/login", response_model=IdentityResponse)
async def development_login(
    request: DevelopmentLoginRequest,
    service: AccessServiceDependency,
) -> IdentityResponse:
    try:
        identity = await service.development_login(request.username, request.password)
    except AccessValidationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return IdentityResponse(
        id=identity.id,
        email=identity.email,
        display_name=identity.display_name,
        role=identity.role.value,
    )


@router.get("/learners/me/courses", response_model=list[LearnerCourseSummaryResponse])
async def learner_courses(
    user_id: UserContext,
    service: AccessServiceDependency,
) -> list[LearnerCourseSummaryResponse]:
    try:
        courses = await service.learner_courses(user_id)
    except AccessValidationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return [
        LearnerCourseSummaryResponse(
            id=course.id,
            title=course.title,
            description=course.description,
            enrolled=course.enrolled,
            topic_count=course.topic_count,
            concept_count=course.concept_count,
            mastered_concept_count=course.mastered_concept_count,
        )
        for course in courses
    ]


@router.get(
    "/learners/me/courses/{course_id}",
    response_model=LearnerCourseExperienceResponse,
)
async def learner_course_experience(
    course_id: UUID,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> LearnerCourseExperienceResponse:
    try:
        course = await service.learner_course_experience(user_id, course_id)
    except AccessValidationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return LearnerCourseExperienceResponse(
        id=course.id,
        title=course.title,
        description=course.description,
        topics=[LearnerTopicResponse(**topic.__dict__) for topic in course.topics],
        clips=[LearnerClipResponse(**clip.__dict__) for clip in course.clips],
        questions=[
            LearnerQuestionResponse(
                id=question.id,
                topic_id=question.topic_id,
                body=question.body,
                type=question.type,
                choices=list(question.choices),
                confidence_prompt=question.confidence_prompt,
            )
            for question in course.questions
        ],
        resources=[LearnerResourceResponse(**resource.__dict__) for resource in course.resources],
    )


@router.get("/learners/me/courses/{course_id}/resources/{source_id}")
async def learner_course_resource(
    course_id: UUID,
    source_id: UUID,
    user_id: UserContext,
    service: AccessServiceDependency,
) -> FileResponse:
    try:
        path, filename, mime_type = await service.learner_resource(
            user_id,
            course_id,
            source_id,
        )
    except AccessValidationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return FileResponse(path, media_type=mime_type, filename=filename)


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
