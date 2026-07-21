from uuid import UUID

from app.access.models import (
    CourseAccess,
    DevelopmentIdentity,
    LearnerCourseExperience,
    LearnerCourseSummary,
    PublishReadiness,
    UserRole,
    WatchEventCreate,
)
from app.access.repository import AccessRepository


class AccessValidationError(ValueError):
    pass


class AccessService:
    def __init__(self, repository: AccessRepository) -> None:
        self._repository = repository

    async def development_identities(self) -> tuple[DevelopmentIdentity, ...]:
        return await self._repository.development_identities()

    async def development_login(self, username: str, password: str) -> DevelopmentIdentity:
        normalized = username.strip().casefold()
        expected = {
            "david": ("David1", UserRole.INSTRUCTOR),
            "brian": ("Brian1", UserRole.LEARNER),
        }.get(normalized)
        if expected is None or password != expected[0]:
            raise AccessValidationError("The username or password is incorrect.")
        identity = next(
            (
                candidate
                for candidate in await self._repository.development_identities()
                if candidate.role == expected[1]
            ),
            None,
        )
        if identity is None:
            raise AccessValidationError("The development identity is unavailable.")
        return identity

    async def learner_courses(self, learner_id: UUID) -> tuple[LearnerCourseSummary, ...]:
        await self._require_learner(learner_id)
        return await self._repository.learner_courses(learner_id)

    async def learner_course_experience(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> LearnerCourseExperience:
        await self._require_learner(learner_id)
        course = await self._repository.learner_course_experience(learner_id, course_id)
        if course is None:
            raise AccessValidationError(
                "Enroll in this published course before opening its learner workspace."
            )
        return course

    async def course(self, course_id: UUID) -> CourseAccess | None:
        return await self._repository.get_course(course_id)

    async def publish_readiness(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> PublishReadiness:
        course = await self._require_owned_course(course_id, instructor_id)
        del course
        readiness = await self._repository.publish_readiness(course_id)
        if readiness is None:
            raise AccessValidationError("Course not found.")
        return readiness

    async def publish(self, course_id: UUID, instructor_id: UUID) -> CourseAccess:
        readiness = await self.publish_readiness(course_id, instructor_id)
        if not readiness.ready:
            raise AccessValidationError(" ".join(readiness.blockers))
        return await self._repository.publish_course(course_id)

    async def enroll(self, course_id: UUID, learner_id: UUID) -> None:
        if await self._repository.user_role(learner_id) != UserRole.LEARNER.value:
            raise AccessValidationError("Only a learner identity can enroll in a course.")
        course = await self._repository.get_course(course_id)
        if course is None:
            raise AccessValidationError("Course not found.")
        if course.status.value != "published":
            raise AccessValidationError("Course must be published before enrollment.")
        await self._repository.enroll(learner_id, course_id)

    async def is_enrolled(self, course_id: UUID, learner_id: UUID) -> bool:
        return await self._repository.is_enrolled(learner_id, course_id)

    async def record_watch_event(self, event: WatchEventCreate) -> UUID:
        if event.watched_seconds < 0:
            raise AccessValidationError("Watched seconds cannot be negative.")
        if event.path_mode not in {"adaptive", "linear"}:
            raise AccessValidationError("Path mode must be adaptive or linear.")
        if not await self._repository.is_enrolled(event.learner_id, event.course_id):
            raise AccessValidationError("Learner must be enrolled in the published course.")
        return await self._repository.record_watch_event(event)

    async def _require_owned_course(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseAccess:
        if await self._repository.user_role(instructor_id) != UserRole.INSTRUCTOR.value:
            raise AccessValidationError("Only an instructor identity can publish a course.")
        course = await self._repository.get_course(course_id)
        if course is None or course.instructor_id != instructor_id:
            raise AccessValidationError("Instructor does not own this course.")
        return course

    async def _require_learner(self, learner_id: UUID) -> None:
        if await self._repository.user_role(learner_id) != UserRole.LEARNER.value:
            raise AccessValidationError("Only a learner identity can open the learner workspace.")
