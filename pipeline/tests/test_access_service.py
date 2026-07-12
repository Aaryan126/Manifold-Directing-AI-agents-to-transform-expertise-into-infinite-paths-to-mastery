from uuid import UUID, uuid4

import pytest

from app.access.models import (
    CourseAccess,
    CourseStatus,
    DevelopmentIdentity,
    PublishReadiness,
    UserRole,
    WatchEventCreate,
)
from app.access.repository import AccessRepository
from app.access.service import AccessService, AccessValidationError


class MemoryAccessRepository(AccessRepository):
    def __init__(self, blockers: tuple[str, ...] = ()) -> None:
        self.instructor_id = uuid4()
        self.learner_id = uuid4()
        self.course = CourseAccess(
            id=uuid4(),
            instructor_id=self.instructor_id,
            title="Course",
            description=None,
            status=CourseStatus.DRAFT,
            published_at=None,
        )
        self.blockers = blockers
        self.enrollments: set[tuple[UUID, UUID]] = set()
        self.watch_events: list[WatchEventCreate] = []

    async def development_identities(self) -> tuple[DevelopmentIdentity, ...]:
        return ()

    async def get_course(self, course_id: UUID) -> CourseAccess | None:
        return self.course if course_id == self.course.id else None

    async def publish_readiness(self, course_id: UUID) -> PublishReadiness | None:
        if course_id != self.course.id:
            return None
        return PublishReadiness(course_id=course_id, blockers=self.blockers)

    async def publish_course(self, course_id: UUID) -> CourseAccess:
        self.course = CourseAccess(
            id=self.course.id,
            instructor_id=self.course.instructor_id,
            title=self.course.title,
            description=self.course.description,
            status=CourseStatus.PUBLISHED,
            published_at="now",
        )
        return self.course

    async def user_role(self, user_id: UUID) -> str | None:
        if user_id == self.instructor_id:
            return UserRole.INSTRUCTOR.value
        if user_id == self.learner_id:
            return UserRole.LEARNER.value
        return None

    async def enroll(self, learner_id: UUID, course_id: UUID) -> None:
        self.enrollments.add((learner_id, course_id))

    async def is_enrolled(self, learner_id: UUID, course_id: UUID) -> bool:
        return (
            self.course.status == CourseStatus.PUBLISHED
            and (learner_id, course_id) in self.enrollments
        )

    async def record_watch_event(self, event: WatchEventCreate) -> UUID:
        self.watch_events.append(event)
        return uuid4()


@pytest.mark.anyio
async def test_publish_requires_reviewed_course_and_owner() -> None:
    repository = MemoryAccessRepository(blockers=("Review every proposed topic.",))
    service = AccessService(repository)

    with pytest.raises(AccessValidationError, match="Review every proposed topic"):
        await service.publish(repository.course.id, repository.instructor_id)

    assert repository.course.status == CourseStatus.DRAFT


@pytest.mark.anyio
async def test_published_course_allows_learner_enrollment_and_watch_instrumentation() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)
    await service.publish(repository.course.id, repository.instructor_id)

    await service.enroll(repository.course.id, repository.learner_id)
    event = WatchEventCreate(
        learner_id=repository.learner_id,
        course_id=repository.course.id,
        video_id=uuid4(),
        clip_id=uuid4(),
        path_mode="adaptive",
        watched_seconds=42.5,
    )
    await service.record_watch_event(event)

    assert await service.is_enrolled(repository.course.id, repository.learner_id)
    assert repository.watch_events == [event]


@pytest.mark.anyio
async def test_draft_course_rejects_enrollment() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)

    with pytest.raises(AccessValidationError, match="published"):
        await service.enroll(repository.course.id, repository.learner_id)
