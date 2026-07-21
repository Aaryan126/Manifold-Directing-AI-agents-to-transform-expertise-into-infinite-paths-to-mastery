from typing import Any
from uuid import UUID

from psycopg.rows import dict_row

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
from app.db.pool import pooled_connection


class PostgresAccessRepository(AccessRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def development_identities(self) -> tuple[DevelopmentIdentity, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            await conn.execute(
                """
                insert into users (email, display_name, role)
                values
                  ('dev-instructor@coursefoundry.local', 'David', 'instructor'),
                  ('dev-learner@coursefoundry.local', 'Brian', 'learner')
                on conflict (email) do update
                set display_name = excluded.display_name,
                    role = excluded.role
                """,
            )
            rows = await (
                await conn.execute(
                    """
                    select id, email, display_name, role
                    from users
                    where email in (
                      'dev-instructor@coursefoundry.local',
                      'dev-learner@coursefoundry.local'
                    )
                    order by role, email
                    """,
                )
            ).fetchall()
            return tuple(_identity_from_row(row) for row in rows)

    async def learner_courses(self, learner_id: UUID) -> tuple[LearnerCourseSummary, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select course.id, course.title, course.description,
                           (enrollment.id is not null) as enrolled,
                           (select count(*) from topics topic
                            where topic.course_id = course.id
                              and topic.revision_id = course.active_revision_id
                              and topic.review_status in ('accepted', 'edited')) as topic_count,
                           (select count(*) from concepts concept
                            where concept.course_id = course.id
                              and concept.revision_id = course.active_revision_id
                              and concept.review_status in ('accepted', 'edited')) as concept_count,
                           (select count(*) from learner_concept_mastery mastery
                            join concepts concept on concept.id = mastery.concept_id
                            where mastery.learner_id = %s
                              and concept.course_id = course.id
                              and concept.revision_id = coalesce(
                                enrollment.revision_id, course.active_revision_id
                              )
                              and mastery.state = 'mastered') as mastered_concept_count
                    from courses course
                    left join enrollments enrollment
                      on enrollment.course_id = course.id
                     and enrollment.learner_id = %s
                    where course.status = 'published'
                      and course.active_revision_id is not null
                    order by enrollment.created_at desc nulls last, course.updated_at desc
                    """,
                    (learner_id, learner_id),
                )
            ).fetchall()
            return tuple(
                LearnerCourseSummary(
                    id=UUID(str(row["id"])),
                    title=str(row["title"]),
                    description=str(row["description"]) if row["description"] else None,
                    enrolled=bool(row["enrolled"]),
                    topic_count=int(row["topic_count"]),
                    concept_count=int(row["concept_count"]),
                    mastered_concept_count=int(row["mastered_concept_count"]),
                )
                for row in rows
            )

    async def learner_course_experience(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> LearnerCourseExperience | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            course = await (
                await conn.execute(
                    """
                    select course.id, course.title, course.description,
                           coalesce(enrollment.revision_id, course.active_revision_id)
                             as revision_id
                    from courses course
                    join enrollments enrollment
                      on enrollment.course_id = course.id
                     and enrollment.learner_id = %s
                    where course.id = %s and course.status = 'published'
                    """,
                    (learner_id, course_id),
                )
            ).fetchone()
            if course is None:
                return None
            revision_id = UUID(str(course["revision_id"]))
            topic_rows = await (
                await conn.execute(
                    """
                    select id, title, summary from topics
                    where course_id = %s and revision_id = %s
                      and review_status in ('accepted', 'edited')
                    order by start_seconds, title
                    """,
                    (course_id, revision_id),
                )
            ).fetchall()
            clip_rows = await (
                await conn.execute(
                    """
                    select clip.id, clip.topic_id, topic.video_id,
                           coalesce(clip.ai_proposal->>'title', topic.title) as title,
                           clip.start_seconds, clip.end_seconds, clip.type, clip.difficulty,
                           coalesce(video.playback_provider, 'local') as playback_provider,
                           video.playback_id,
                           coalesce(video.source_metadata->>'playback_url',
                                    '/videos/' || video.id::text || '/media') as playback_url,
                           video.source_metadata->>'delivery_asset_id' as delivery_asset_id,
                           coalesce(clip.materialization_status, 'source_reference')
                             as materialization_status
                    from clips clip
                    join topics topic on topic.id = clip.topic_id
                    join videos video on video.id = topic.video_id
                    where topic.course_id = %s and clip.revision_id = %s
                      and topic.review_status in ('accepted', 'edited')
                      and clip.status = 'active'
                    order by topic.start_seconds, clip.start_seconds
                    """,
                    (course_id, revision_id),
                )
            ).fetchall()
            question_rows = await (
                await conn.execute(
                    """
                    select q.id, q.topic_id, q.body, q.type, q.correct_answer,
                           q.confidence_prompt
                    from questions q
                    join topics topic on topic.id = q.topic_id
                    where topic.course_id = %s and q.revision_id = %s
                      and topic.review_status in ('accepted', 'edited')
                      and q.review_status in ('accepted', 'edited')
                    order by topic.start_seconds, q.created_at
                    """,
                    (course_id, revision_id),
                )
            ).fetchall()
            return LearnerCourseExperience(
                id=UUID(str(course["id"])),
                title=str(course["title"]),
                description=str(course["description"]) if course["description"] else None,
                topics=tuple(
                    LearnerTopic(
                        id=UUID(str(row["id"])),
                        title=str(row["title"]),
                        summary=str(row["summary"]) if row["summary"] else None,
                    )
                    for row in topic_rows
                ),
                clips=tuple(
                    LearnerClip(
                        id=UUID(str(row["id"])),
                        topic_id=UUID(str(row["topic_id"])),
                        video_id=UUID(str(row["video_id"])),
                        title=str(row["title"]),
                        start_seconds=float(row["start_seconds"]),
                        end_seconds=float(row["end_seconds"]),
                        type=str(row["type"]),
                        difficulty=str(row["difficulty"]) if row["difficulty"] else None,
                        playback_provider=str(row["playback_provider"]),
                        playback_id=str(row["playback_id"]) if row["playback_id"] else None,
                        playback_url=str(row["playback_url"]),
                        delivery_asset_id=(
                            str(row["delivery_asset_id"])
                            if row["delivery_asset_id"] else None
                        ),
                        materialization_status=str(row["materialization_status"]),
                    )
                    for row in clip_rows
                ),
                questions=tuple(
                    LearnerQuestion(
                        id=UUID(str(row["id"])),
                        topic_id=UUID(str(row["topic_id"])),
                        body=str(row["body"]),
                        type=str(row["type"]),
                        choices=_answer_choices(row["correct_answer"]),
                        confidence_prompt=str(row["confidence_prompt"]),
                    )
                    for row in question_rows
                ),
            )

    async def get_course(self, course_id: UUID) -> CourseAccess | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select id, instructor_id, title, description, status,
                           published_at::text as published_at
                    from courses
                    where id = %s
                    """,
                    (course_id,),
                )
            ).fetchone()
            return _course_from_row(row) if row else None

    async def publish_readiness(self, course_id: UUID) -> PublishReadiness | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            exists = await (
                await conn.execute("select 1 from courses where id = %s", (course_id,))
            ).fetchone()
            if exists is None:
                return None
            row = await (
                await conn.execute(
                    """
                    select
                      (select count(*) from videos
                       where course_id = course.id and transcript is not null) as ready_videos,
                      (select count(*) from topics
                       where revision_id = coalesce(
                         course.working_revision_id, course.active_revision_id
                       ) and review_status <> 'dismissed') as active_topics,
                      (select count(*) from topics
                       where revision_id = coalesce(
                         course.working_revision_id, course.active_revision_id
                       ) and review_status = 'proposed') as proposed_topics,
                      (select count(*) from concepts
                       where revision_id = coalesce(
                         course.working_revision_id, course.active_revision_id
                       ) and review_status in ('accepted', 'edited'))
                        as reviewed_concepts,
                      (select count(*) from concepts
                       where revision_id = coalesce(
                         course.working_revision_id, course.active_revision_id
                       ) and review_status = 'proposed') as proposed_concepts,
                      (select count(*) from concept_edges e where e.revision_id = coalesce(
                         course.working_revision_id, course.active_revision_id
                       ) and e.review_status = 'proposed') as proposed_edges,
                      (select count(*) from topics t
                       where t.revision_id = coalesce(
                           course.working_revision_id, course.active_revision_id
                         )
                         and t.review_status in ('accepted', 'edited')
                         and not exists (
                           select 1 from questions q
                           where q.topic_id = t.id
                             and q.review_status in ('accepted', 'edited')
                         )) as topics_without_question,
                      (select count(*) from concepts c
                       where c.revision_id = coalesce(
                           course.working_revision_id, course.active_revision_id
                         )
                         and c.review_status in ('accepted', 'edited')
                         and not exists (
                           select 1 from routing_policies rp
                           where rp.course_id = c.course_id
                             and rp.revision_id = c.revision_id
                             and (rp.concept_id = c.id or rp.concept_id is null)
                         )) as concepts_without_policy
                    from courses course
                    where course.id = %s
                    """,
                    (course_id,),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to calculate publish readiness.")
            blockers: list[str] = []
            if int(row["ready_videos"]) == 0:
                blockers.append("At least one ingested video must finish processing.")
            if int(row["active_topics"]) == 0:
                blockers.append("At least one reviewed topic is required.")
            if int(row["proposed_topics"]) > 0:
                blockers.append("Review every proposed topic before publishing.")
            if int(row["reviewed_concepts"]) == 0:
                blockers.append("At least one accepted or edited concept is required.")
            if int(row["proposed_concepts"]) > 0 or int(row["proposed_edges"]) > 0:
                blockers.append("Review every proposed concept and prerequisite edge.")
            if int(row["topics_without_question"]) > 0:
                blockers.append("Every reviewed topic needs an approved question.")
            if int(row["concepts_without_policy"]) > 0:
                blockers.append("Confirm adaptive routing settings for every reviewed concept.")
            return PublishReadiness(course_id=course_id, blockers=tuple(blockers))

    async def publish_course(self, course_id: UUID) -> CourseAccess:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    update courses
                    set status = 'published', published_at = now(), updated_at = now()
                    where id = %s
                    returning id, instructor_id, title, description, status,
                              published_at::text as published_at
                    """,
                    (course_id,),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Course disappeared during publishing.")
            return _course_from_row(row)

    async def user_role(self, user_id: UUID) -> str | None:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute("select role::text from users where id = %s", (user_id,))
            ).fetchone()
            return str(row[0]) if row else None

    async def enroll(self, learner_id: UUID, course_id: UUID) -> None:
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                insert into enrollments (learner_id, course_id)
                values (%s, %s)
                on conflict (learner_id, course_id) do nothing
                """,
                (learner_id, course_id),
            )

    async def is_enrolled(self, learner_id: UUID, course_id: UUID) -> bool:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    select exists (
                      select 1
                      from enrollments e
                      join courses c on c.id = e.course_id
                      where e.learner_id = %s
                        and e.course_id = %s
                        and c.status = 'published'
                    )
                    """,
                    (learner_id, course_id),
                )
            ).fetchone()
            return row is not None and row[0] is True

    async def record_watch_event(self, event: WatchEventCreate) -> UUID:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into learner_watch_events (
                      learner_id, course_id, video_id, clip_id,
                      path_mode, watched_seconds
                    )
                    values (%s, %s, %s, %s, %s, %s)
                    returning id
                    """,
                    (
                        event.learner_id,
                        event.course_id,
                        event.video_id,
                        event.clip_id,
                        event.path_mode,
                        event.watched_seconds,
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to record watch event.")
            return UUID(str(row[0]))


def _identity_from_row(row: dict[str, Any]) -> DevelopmentIdentity:
    return DevelopmentIdentity(
        id=UUID(str(row["id"])),
        email=str(row["email"]),
        display_name=str(row["display_name"]),
        role=UserRole(str(row["role"])),
    )


def _course_from_row(row: dict[str, Any]) -> CourseAccess:
    return CourseAccess(
        id=UUID(str(row["id"])),
        instructor_id=UUID(str(row["instructor_id"])),
        title=str(row["title"]),
        description=str(row["description"]) if row["description"] else None,
        status=CourseStatus(str(row["status"])),
        published_at=str(row["published_at"]) if row["published_at"] else None,
    )


def _answer_choices(value: Any) -> tuple[str, ...]:
    if not isinstance(value, dict):
        return ()
    choices = value.get("choices")
    if not isinstance(choices, list):
        return ()
    return tuple(str(choice) for choice in choices if str(choice).strip())
