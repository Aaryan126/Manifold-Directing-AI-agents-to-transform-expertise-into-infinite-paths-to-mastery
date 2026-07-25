from uuid import UUID, uuid4

import pytest

from app.access.models import (
    CourseAccess,
    CourseStatus,
    DevelopmentIdentity,
    LearnerClip,
    LearnerCourseExperience,
    LearnerCourseSummary,
    LearnerQuestion,
    LearnerTopic,
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
        self.learner_course_summaries: tuple[LearnerCourseSummary, ...] = ()
        self.learner_experience: LearnerCourseExperience | None = None

    async def development_identities(self) -> tuple[DevelopmentIdentity, ...]:
        return (
            DevelopmentIdentity(
                id=self.instructor_id,
                email="dev-instructor@coursefoundry.local",
                display_name="David",
                role=UserRole.INSTRUCTOR,
            ),
            DevelopmentIdentity(
                id=self.learner_id,
                email="dev-learner@coursefoundry.local",
                display_name="Brian",
                role=UserRole.LEARNER,
            ),
        )

    async def learner_courses(self, learner_id: UUID) -> tuple[LearnerCourseSummary, ...]:
        return self.learner_course_summaries

    async def learner_course_experience(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> LearnerCourseExperience | None:
        if course_id != self.course.id:
            return None
        return self.learner_experience

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


@pytest.mark.anyio
async def test_development_login_maps_fixed_credentials_to_persisted_roles() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)

    instructor = await service.development_login("David", "David1")
    learner = await service.development_login("brian", "Brian1")

    assert instructor.id == repository.instructor_id
    assert instructor.display_name == "David"
    assert learner.id == repository.learner_id
    assert learner.display_name == "Brian"

    with pytest.raises(AccessValidationError, match="username or password"):
        await service.development_login("David", "wrong")


@pytest.mark.anyio
async def test_learner_workspace_requires_learner_role_and_enrolled_course() -> None:
    repository = MemoryAccessRepository()
    service = AccessService(repository)

    with pytest.raises(AccessValidationError, match="learner identity"):
        await service.learner_courses(repository.instructor_id)

    with pytest.raises(AccessValidationError, match="Enroll"):
        await service.learner_course_experience(
            repository.learner_id,
            repository.course.id,
        )


def learner_experience_fixture(repository: MemoryAccessRepository) -> LearnerCourseExperience:
    topic_id = uuid4()
    video_id = uuid4()
    return LearnerCourseExperience(
        id=repository.course.id,
        title="Reviewed course",
        description="A learner-safe course payload.",
        units=(),
        topics=(
            LearnerTopic(
                id=topic_id,
                video_id=video_id,
                title="Topic one",
                summary="Summary",
            ),
        ),
        clips=(
            LearnerClip(
                id=uuid4(),
                topic_id=topic_id,
                video_id=video_id,
                title="Focused clip",
                start_seconds=12.0,
                end_seconds=42.0,
                type="explanation",
                difficulty="introductory",
                playback_provider="mux",
                playback_id="playback-id",
                playback_url="https://stream.mux.com/playback-id.m3u8",
                delivery_asset_id="asset-id",
                materialization_status="source_reference",
            ),
        ),
        questions=(
            LearnerQuestion(
                id=uuid4(),
                topic_id=topic_id,
                body="What changed?",
                type="mcq",
                choices=("A", "B"),
                confidence_prompt="How confident are you?",
            ),
        ),
    )
