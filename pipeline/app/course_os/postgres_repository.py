from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.course_os.models import (
    AttentionItem,
    ConversationMessage,
    CourseCreate,
    CourseMap,
    CourseMapEdge,
    CourseMapNode,
    CourseProposal,
    CourseSummary,
    DashboardSnapshot,
    GenerationRun,
    GenerationRunStatus,
    GenerationTask,
    GenerationTaskStatus,
    ReviewBundle,
    ReviewDecision,
    ReviewItem,
    RevisionChange,
    RevisionDiff,
)
from app.course_os.repository import CourseOSRepository
from app.db.pool import pooled_connection


class PostgresCourseOSRepository(CourseOSRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def user_role(self, user_id: UUID) -> str | None:
        async with pooled_connection(self._database_url) as conn:
            cursor = await conn.execute("select role from users where id = %s", (user_id,))
            row = await cursor.fetchone()
            return str(row[0]) if row else None

    async def create_course(self, instructor_id: UUID, create: CourseCreate) -> CourseSummary:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            course = await (
                await conn.execute(
                    """
                    insert into courses (instructor_id, title, description, brief)
                    values (%s, %s, %s, %s::jsonb)
                    returning id
                    """,
                    (instructor_id, create.title, create.description, Jsonb(create.brief)),
                )
            ).fetchone()
            if course is None:
                raise RuntimeError("Failed to create course.")
            revision = await (
                await conn.execute(
                    """
                    insert into course_revisions (
                      course_id, revision_number, status, created_by, brief
                    )
                    values (%s, 1, 'building', %s, %s::jsonb)
                    returning id
                    """,
                    (course["id"], instructor_id, Jsonb(create.brief)),
                )
            ).fetchone()
            if revision is None:
                raise RuntimeError("Failed to create course revision.")
            await conn.execute(
                "update courses set working_revision_id = %s where id = %s",
                (revision["id"], course["id"]),
            )
            conversation = await (
                await conn.execute(
                    """
                    insert into course_conversations (course_id, revision_id)
                    values (%s, %s)
                    returning id
                    """,
                    (course["id"], revision["id"]),
                )
            ).fetchone()
            if conversation is None:
                raise RuntimeError("Failed to create course conversation.")
            await conn.execute(
                """
                insert into course_messages (conversation_id, role, content, blocks)
                values (%s, 'manifold', %s, %s::jsonb)
                """,
                (
                    conversation["id"],
                    "Share one lecture file or link. I’ll build a complete private draft, "
                    "then bring you the decisions that need your judgment.",
                    Jsonb([{"type": "source_request"}]),
                ),
            )
        summary = await self.get_course(UUID(str(course["id"])))
        if summary is None:
            raise RuntimeError("Created course could not be loaded.")
        return summary

    async def list_courses(self, instructor_id: UUID) -> tuple[CourseSummary, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    _COURSE_SUMMARY_SQL + " where c.instructor_id = %s order by c.updated_at desc",
                    (instructor_id,),
                )
            ).fetchall()
        return tuple(_course_summary(row) for row in rows)

    async def get_course(self, course_id: UUID) -> CourseSummary | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    _COURSE_SUMMARY_SQL + " where c.id = %s",
                    (course_id,),
                )
            ).fetchone()
        return _course_summary(row) if row else None

    async def create_working_revision(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            course = await (
                await conn.execute(
                    """
                    select * from courses
                    where id = %s and instructor_id = %s for update
                    """,
                    (course_id, instructor_id),
                )
            ).fetchone()
            if course is None:
                raise ValueError("Instructor does not own this course.")
            if course["working_revision_id"] is not None:
                raise ValueError("This course already has a working revision.")
            if course["active_revision_id"] is None or str(course["status"]) != "published":
                raise ValueError("Only a published course can open an update revision.")
            active_revision_id = UUID(str(course["active_revision_id"]))
            revision = await (
                await conn.execute(
                    """
                    insert into course_revisions (
                      course_id, parent_revision_id, revision_number, status, created_by, brief
                    )
                    select %s, %s, coalesce(max(revision_number), 0) + 1,
                           'building', %s,
                           (select brief from course_revisions where id = %s)
                    from course_revisions where course_id = %s
                    returning id
                    """,
                    (
                        course_id,
                        active_revision_id,
                        instructor_id,
                        active_revision_id,
                        course_id,
                    ),
                )
            ).fetchone()
            if revision is None:
                raise RuntimeError("Failed to open a working revision.")
            working_revision_id = UUID(str(revision["id"]))
            await conn.execute(
                """
                insert into topics (
                  course_id, video_id, title, summary, start_seconds, end_seconds,
                  ai_proposal, instructor_revision, approved_at, review_status,
                  dismissed_at, revision_id, logical_id
                )
                select course_id, video_id, title, summary, start_seconds, end_seconds,
                       ai_proposal, instructor_revision, approved_at, review_status,
                       dismissed_at, %s, logical_id
                from topics where revision_id = %s
                """,
                (working_revision_id, active_revision_id),
            )
            await conn.execute(
                """
                insert into concepts (
                  course_id, name, description, ai_proposal, instructor_revision,
                  approved_at, review_status, dismissed_at, revision_id, logical_id
                )
                select course_id, name, description, ai_proposal, instructor_revision,
                       approved_at, review_status, dismissed_at, %s, logical_id
                from concepts where revision_id = %s
                """,
                (working_revision_id, active_revision_id),
            )
            await conn.execute(
                """
                insert into topic_concepts (topic_id, concept_id, revision_id)
                select new_topic.id, new_concept.id, %s
                from topic_concepts old_link
                join topics old_topic on old_topic.id = old_link.topic_id
                join concepts old_concept on old_concept.id = old_link.concept_id
                join topics new_topic
                  on new_topic.revision_id = %s
                 and new_topic.logical_id = old_topic.logical_id
                join concepts new_concept
                  on new_concept.revision_id = %s
                 and new_concept.logical_id = old_concept.logical_id
                where old_link.revision_id = %s
                """,
                (
                    working_revision_id,
                    working_revision_id,
                    working_revision_id,
                    active_revision_id,
                ),
            )
            await conn.execute(
                """
                insert into concept_edges (
                  from_concept_id, to_concept_id, relationship, ai_proposal,
                  instructor_revision, approved_at, review_status, dismissed_at,
                  revision_id, logical_id
                )
                select new_from.id, new_to.id, old_edge.relationship,
                       old_edge.ai_proposal, old_edge.instructor_revision,
                       old_edge.approved_at, old_edge.review_status,
                       old_edge.dismissed_at, %s, old_edge.logical_id
                from concept_edges old_edge
                join concepts old_from on old_from.id = old_edge.from_concept_id
                join concepts old_to on old_to.id = old_edge.to_concept_id
                join concepts new_from
                  on new_from.revision_id = %s
                 and new_from.logical_id = old_from.logical_id
                join concepts new_to
                  on new_to.revision_id = %s
                 and new_to.logical_id = old_to.logical_id
                where old_edge.revision_id = %s
                """,
                (
                    working_revision_id,
                    working_revision_id,
                    working_revision_id,
                    active_revision_id,
                ),
            )
            await conn.execute(
                """
                insert into clips (
                  topic_id, start_seconds, end_seconds, type, difficulty,
                  playback_provider, playback_id, ai_proposal, instructor_revision,
                  approved_at, status, flagged_at, flag_note,
                  materialization_status, materialization_error, revision_id, logical_id
                )
                select new_topic.id, old_clip.start_seconds, old_clip.end_seconds,
                       old_clip.type, old_clip.difficulty, old_clip.playback_provider,
                       old_clip.playback_id, old_clip.ai_proposal,
                       old_clip.instructor_revision, old_clip.approved_at,
                       old_clip.status, old_clip.flagged_at, old_clip.flag_note,
                       old_clip.materialization_status, old_clip.materialization_error,
                       %s, old_clip.logical_id
                from clips old_clip
                join topics old_topic on old_topic.id = old_clip.topic_id
                join topics new_topic
                  on new_topic.revision_id = %s
                 and new_topic.logical_id = old_topic.logical_id
                where old_clip.revision_id = %s
                  and old_clip.status <> 'superseded'
                """,
                (working_revision_id, working_revision_id, active_revision_id),
            )
            await conn.execute(
                """
                insert into clip_concepts (clip_id, concept_id, revision_id)
                select new_clip.id, new_concept.id, %s
                from clip_concepts old_link
                join clips old_clip on old_clip.id = old_link.clip_id
                join concepts old_concept on old_concept.id = old_link.concept_id
                join clips new_clip
                  on new_clip.revision_id = %s
                 and new_clip.logical_id = old_clip.logical_id
                join concepts new_concept
                  on new_concept.revision_id = %s
                 and new_concept.logical_id = old_concept.logical_id
                where old_link.revision_id = %s
                """,
                (
                    working_revision_id,
                    working_revision_id,
                    working_revision_id,
                    active_revision_id,
                ),
            )
            await conn.execute(
                """
                insert into questions (
                  topic_id, body, type, correct_answer, confidence_prompt,
                  ai_proposal, instructor_revision, approved_at, review_status,
                  dismissed_at, revision_id, logical_id
                )
                select new_topic.id, old_question.body, old_question.type,
                       old_question.correct_answer, old_question.confidence_prompt,
                       old_question.ai_proposal, old_question.instructor_revision,
                       old_question.approved_at, old_question.review_status,
                       old_question.dismissed_at, %s, old_question.logical_id
                from questions old_question
                join topics old_topic on old_topic.id = old_question.topic_id
                join topics new_topic
                  on new_topic.revision_id = %s
                 and new_topic.logical_id = old_topic.logical_id
                where old_question.revision_id = %s
                """,
                (working_revision_id, working_revision_id, active_revision_id),
            )
            await conn.execute(
                """
                insert into remediation_rules (
                  question_id, wrong_answer_pattern, target_clip_id,
                  target_concept_id, ai_proposal, instructor_revision,
                  approved_at, revision_id, logical_id
                )
                select new_question.id, old_rule.wrong_answer_pattern,
                       new_clip.id, new_concept.id, old_rule.ai_proposal,
                       old_rule.instructor_revision, old_rule.approved_at,
                       %s, old_rule.logical_id
                from remediation_rules old_rule
                join questions old_question on old_question.id = old_rule.question_id
                join questions new_question
                  on new_question.revision_id = %s
                 and new_question.logical_id = old_question.logical_id
                left join clips old_clip on old_clip.id = old_rule.target_clip_id
                left join clips new_clip
                  on new_clip.revision_id = %s
                 and new_clip.logical_id = old_clip.logical_id
                left join concepts old_concept on old_concept.id = old_rule.target_concept_id
                left join concepts new_concept
                  on new_concept.revision_id = %s
                 and new_concept.logical_id = old_concept.logical_id
                where old_rule.revision_id = %s
                  and (new_clip.id is not null or new_concept.id is not null)
                """,
                (
                    working_revision_id,
                    working_revision_id,
                    working_revision_id,
                    working_revision_id,
                    active_revision_id,
                ),
            )
            await conn.execute(
                """
                insert into routing_policies (
                  course_id, concept_id, policy, revision_id, logical_id
                )
                select old_policy.course_id, new_concept.id, old_policy.policy,
                       %s, old_policy.logical_id
                from routing_policies old_policy
                left join concepts old_concept on old_concept.id = old_policy.concept_id
                left join concepts new_concept
                  on new_concept.revision_id = %s
                 and new_concept.logical_id = old_concept.logical_id
                where old_policy.revision_id = %s
                """,
                (working_revision_id, working_revision_id, active_revision_id),
            )
            await conn.execute(
                "update courses set working_revision_id = %s, updated_at = now() where id = %s",
                (working_revision_id, course_id),
            )
            await conn.execute(
                """
                insert into course_conversations (course_id, revision_id)
                values (%s, %s)
                returning id
                """,
                (course_id, working_revision_id),
            )
            await conn.execute(
                """
                insert into course_messages (conversation_id, role, content, blocks)
                select id, 'manifold', %s, %s::jsonb
                from course_conversations
                where course_id = %s and revision_id = %s
                """,
                (
                    "I’ve opened a private working revision. The live course stays unchanged "
                    "until you review these decisions and publish the update.",
                    Jsonb([{"type": "revision_opened"}]),
                    course_id,
                    working_revision_id,
                ),
            )
        await self.assemble_review_bundles(course_id, working_revision_id)
        summary = await self.get_course(course_id)
        if summary is None:
            raise RuntimeError("Working revision could not be loaded.")
        return summary

    async def publish_working_revision(
        self,
        course_id: UUID,
        instructor_id: UUID,
    ) -> CourseSummary:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            course = await (
                await conn.execute(
                    """
                    select * from courses
                    where id = %s and instructor_id = %s for update
                    """,
                    (course_id, instructor_id),
                )
            ).fetchone()
            if course is None:
                raise ValueError("Instructor does not own this course.")
            if course["working_revision_id"] is None:
                raise ValueError("Course has no working revision to publish.")
            working_revision_id = UUID(str(course["working_revision_id"]))
            active_revision_id = (
                UUID(str(course["active_revision_id"]))
                if course["active_revision_id"] is not None
                else None
            )
            readiness = await (
                await conn.execute(
                    """
                    select
                      (select count(*) from review_bundles
                       where revision_id = %s) as bundle_count,
                      (select count(*) from review_items ri
                       join review_bundles rb on rb.id = ri.bundle_id
                       where rb.revision_id = %s and ri.status = 'pending') as pending_items,
                      (select count(*) from topics
                       where revision_id = %s and review_status = 'proposed') as proposed_topics,
                      (select count(*) from concepts
                       where revision_id = %s and review_status = 'proposed') as proposed_concepts,
                      (select count(*) from concept_edges
                       where revision_id = %s and review_status = 'proposed') as proposed_edges,
                      (select count(*) from questions
                       where revision_id = %s and review_status = 'proposed') as proposed_questions,
                      (select count(*) from topics
                       where revision_id = %s and review_status in ('accepted', 'edited'))
                        as reviewed_topics,
                      (select count(*) from concepts
                       where revision_id = %s and review_status in ('accepted', 'edited'))
                        as reviewed_concepts,
                      (select count(*) from topics t
                       where t.revision_id = %s
                         and t.review_status in ('accepted', 'edited')
                         and not exists (
                           select 1 from questions q
                           where q.topic_id = t.id
                             and q.review_status in ('accepted', 'edited')
                         )) as topics_without_question,
                      (select count(*) from concepts c
                       where c.revision_id = %s
                         and c.review_status in ('accepted', 'edited')
                         and not exists (
                           select 1 from routing_policies rp
                           where rp.revision_id = c.revision_id
                             and (rp.concept_id = c.id or rp.concept_id is null)
                         )) as concepts_without_policy
                    """,
                    (working_revision_id,) * 10,
                )
            ).fetchone()
            blockers: list[str] = []
            if readiness is None or int(readiness["bundle_count"]) < 3:
                blockers.append("Review bundles have not been assembled.")
            elif int(readiness["pending_items"]) > 0:
                blockers.append("Resolve every remaining review decision before publishing.")
            if readiness is not None and any(
                int(readiness[key]) > 0
                for key in (
                    "proposed_topics",
                    "proposed_concepts",
                    "proposed_edges",
                    "proposed_questions",
                )
            ):
                blockers.append("Accept, edit, or dismiss every AI proposal before publishing.")
            if readiness is None or int(readiness["reviewed_topics"]) == 0:
                blockers.append("At least one reviewed topic is required.")
            if readiness is None or int(readiness["reviewed_concepts"]) == 0:
                blockers.append("At least one reviewed concept is required.")
            if readiness is not None and int(readiness["topics_without_question"]) > 0:
                blockers.append("Every reviewed topic needs an accepted or edited question.")
            if readiness is not None and int(readiness["concepts_without_policy"]) > 0:
                blockers.append("Every reviewed concept needs confirmed routing settings.")
            if blockers:
                raise ValueError(" ".join(blockers))

            if active_revision_id is not None:
                await conn.execute(
                    """
                    insert into learner_concept_mastery (
                      learner_id, concept_id, state, updated_at
                    )
                    select mastery.learner_id, new_concept.id, mastery.state, now()
                    from learner_concept_mastery mastery
                    join concepts old_concept on old_concept.id = mastery.concept_id
                    join concepts new_concept
                      on new_concept.revision_id = %s
                     and new_concept.logical_id = old_concept.logical_id
                    where old_concept.revision_id = %s
                    on conflict (learner_id, concept_id) do update
                    set state = excluded.state, updated_at = now()
                    """,
                    (working_revision_id, active_revision_id),
                )
                await conn.execute(
                    "update enrollments set revision_id = %s where course_id = %s",
                    (working_revision_id, course_id),
                )
                await conn.execute(
                    """
                    update course_revisions set status = 'superseded', updated_at = now()
                    where id = %s
                    """,
                    (active_revision_id,),
                )
            await conn.execute(
                """
                update course_revisions
                set status = 'published', published_at = now(), updated_at = now()
                where id = %s
                """,
                (working_revision_id,),
            )
            await conn.execute(
                """
                update generation_runs set status = 'complete', updated_at = now()
                where revision_id = %s and status = 'waiting_review'
                """,
                (working_revision_id,),
            )
            await conn.execute(
                """
                update courses
                set status = 'published', active_revision_id = %s,
                    working_revision_id = null,
                    brief = (select brief from course_revisions where id = %s),
                    published_at = coalesce(published_at, now()), updated_at = now()
                where id = %s
                """,
                (working_revision_id, working_revision_id, course_id),
            )
        summary = await self.get_course(course_id)
        if summary is None:
            raise RuntimeError("Published course could not be loaded.")
        return summary

    async def dashboard(self, instructor_id: UUID) -> DashboardSnapshot:
        courses = await self.list_courses(instructor_id)
        attention: list[AttentionItem] = []
        for course in courses:
            if course.generation_status == GenerationRunStatus.FAILED.value:
                attention.append(
                    AttentionItem(
                        id=f"generation:{course.id}",
                        course_id=course.id,
                        kind="generation_failed",
                        title=f"{course.title} needs help",
                        detail="A generation step failed. Open the studio to retry it.",
                        urgency="high",
                    )
                )
            if course.pending_review_count:
                attention.append(
                    AttentionItem(
                        id=f"review:{course.id}",
                        course_id=course.id,
                        kind="review_ready",
                        title=f"{course.title} is ready for review",
                        detail=(
                            f"{course.pending_review_count} decisions remain "
                            "across the review bundles."
                        ),
                        urgency="normal",
                    )
                )
            if course.open_signal_count:
                attention.append(
                    AttentionItem(
                        id=f"insight:{course.id}",
                        course_id=course.id,
                        kind="learner_insight",
                        title=f"Learners need attention in {course.title}",
                        detail=(
                            f"{course.open_signal_count} evidence-backed "
                            "teaching insights are open."
                        ),
                        urgency="normal",
                    )
                )
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    select count(distinct e.learner_id)
                    from enrollments e
                    join courses c on c.id = e.course_id
                    where c.instructor_id = %s
                    """,
                    (instructor_id,),
                )
            ).fetchone()
        return DashboardSnapshot(
            courses=courses,
            attention=tuple(attention),
            total_courses=len(courses),
            published_courses=sum(course.status == "published" for course in courses),
            courses_in_review=sum(course.pending_review_count > 0 for course in courses),
            active_learners=int(row[0]) if row else 0,
        )

    async def create_generation_run(
        self,
        course_id: UUID,
        revision_id: UUID,
        instructor_id: UUID,
        video_id: UUID,
        ingestion_job_id: UUID,
    ) -> GenerationRun:
        task_ids = {name: uuid4() for name in _TASK_ORDER}
        dependencies = {
            "source_ready": (),
            "outline": (task_ids["source_ready"],),
            "concept_graph": (task_ids["outline"],),
            "clips": (task_ids["concept_graph"],),
            "assessments": (task_ids["clips"],),
            "review_bundles": (task_ids["assessments"],),
        }
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            owned = await (
                await conn.execute(
                    """
                    select 1 from courses c
                    join videos v on v.course_id = c.id
                    join ingestion_jobs j on j.video_id = v.id
                    where c.id = %s and c.instructor_id = %s
                      and c.working_revision_id = %s and v.id = %s and j.id = %s
                    """,
                    (course_id, instructor_id, revision_id, video_id, ingestion_job_id),
                )
            ).fetchone()
            if owned is None:
                raise ValueError("Course, revision, or source was not found.")
            active = await (
                await conn.execute(
                    """
                    select 1 from generation_runs
                    where revision_id = %s and status in ('queued', 'running')
                    """,
                    (revision_id,),
                )
            ).fetchone()
            if active is not None:
                raise ValueError("This course already has an active generation run.")
            run = await (
                await conn.execute(
                    """
                    insert into generation_runs (
                      course_id, revision_id, created_by, status, phase, progress
                    )
                    values (%s, %s, %s, 'queued', 'source_ready', 0)
                    returning id
                    """,
                    (course_id, revision_id, instructor_id),
                )
            ).fetchone()
            if run is None:
                raise RuntimeError("Failed to create generation run.")
            for task_type in _TASK_ORDER:
                await conn.execute(
                    """
                    insert into generation_tasks (
                      id, run_id, task_type, depends_on, idempotency_key, input, max_attempts
                    )
                    values (%s, %s, %s, %s, %s, %s::jsonb, %s)
                    """,
                    (
                        task_ids[task_type],
                        run["id"],
                        task_type,
                        list(dependencies[task_type]),
                        f"{revision_id}:{task_type}:course",
                        Jsonb(
                            {
                                "video_id": str(video_id),
                                "ingestion_job_id": str(ingestion_job_id),
                            }
                        ),
                        120 if task_type == "source_ready" else 3,
                    ),
                )
        created = await self.get_generation_run(UUID(str(run["id"])))
        if created is None:
            raise RuntimeError("Created generation run could not be loaded.")
        return created

    async def get_generation_run(self, run_id: UUID) -> GenerationRun | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            run = await (
                await conn.execute("select * from generation_runs where id = %s", (run_id,))
            ).fetchone()
            if run is None:
                return None
            tasks = await (
                await conn.execute(
                    "select * from generation_tasks where run_id = %s order by created_at",
                    (run_id,),
                )
            ).fetchall()
        return _generation_run(run, tuple(_generation_task(task) for task in tasks))

    async def cancel_generation_run(self, run_id: UUID) -> GenerationRun | None:
        async with pooled_connection(self._database_url) as conn:
            result = await conn.execute(
                """
                update generation_runs
                set status = 'cancelled', completed_at = now(), updated_at = now()
                where id = %s and status in ('queued', 'running', 'failed')
                """,
                (run_id,),
            )
            if result.rowcount:
                await conn.execute(
                    """
                    update generation_tasks set status = 'cancelled', updated_at = now()
                    where run_id = %s and status in ('queued', 'running', 'failed')
                    """,
                    (run_id,),
                )
        return await self.get_generation_run(run_id)

    async def retry_generation_run(self, run_id: UUID) -> GenerationRun | None:
        async with pooled_connection(self._database_url) as conn:
            result = await conn.execute(
                """
                update generation_runs
                set status = 'queued', error_summary = null, completed_at = null, updated_at = now()
                where id = %s and status = 'failed'
                """,
                (run_id,),
            )
            if result.rowcount:
                await conn.execute(
                    """
                    update generation_tasks
                    set status = 'queued', error_message = null, next_attempt_at = now(),
                        lease_owner = null, lease_expires_at = null, updated_at = now()
                    where run_id = %s and status = 'failed'
                    """,
                    (run_id,),
                )
        return await self.get_generation_run(run_id)

    async def claim_generation_task(
        self,
        worker_id: str,
        lease_seconds: int,
    ) -> GenerationTask | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    with candidate as (
                      select t.id
                      from generation_tasks t
                      join generation_runs r on r.id = t.run_id
                      where r.status in ('queued', 'running')
                        and t.next_attempt_at <= now()
                        and (
                          t.status = 'queued'
                          or (t.status = 'running' and t.lease_expires_at < now())
                        )
                        and not exists (
                          select 1
                          from unnest(t.depends_on) dependency_id
                          join generation_tasks dependency on dependency.id = dependency_id
                          where dependency.status <> 'complete'
                        )
                      order by t.created_at
                      for update of t skip locked
                      limit 1
                    )
                    update generation_tasks t
                    set status = 'running', lease_owner = %s,
                        lease_expires_at = now() + (%s * interval '1 second'),
                        attempts = attempts + 1,
                        started_at = coalesce(started_at, now()), updated_at = now()
                    from candidate
                    where t.id = candidate.id
                    returning t.*
                    """,
                    (worker_id, lease_seconds),
                )
            ).fetchone()
            if row is None:
                return None
            await conn.execute(
                """
                update generation_runs
                set status = 'running', phase = %s,
                    started_at = coalesce(started_at, now()), updated_at = now()
                where id = %s
                """,
                (row["task_type"], row["run_id"]),
            )
        return _generation_task(row)

    async def complete_generation_task(
        self,
        task_id: UUID,
        output: dict[str, Any],
    ) -> None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update generation_tasks
                    set status = 'complete', output = %s::jsonb, completed_at = now(),
                        lease_owner = null, lease_expires_at = null, updated_at = now()
                    where id = %s returning run_id
                    """,
                    (Jsonb(output), task_id),
                )
            ).fetchone()
            if row is not None:
                await _refresh_run(conn, UUID(str(row["run_id"])))

    async def fail_generation_task(
        self,
        task_id: UUID,
        error_message: str,
        retry: bool,
    ) -> None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update generation_tasks
                    set status = case
                                      when %s and attempts < max_attempts
                                        then 'queued'::generation_task_status
                                      else 'failed'::generation_task_status end,
                        next_attempt_at = case
                                           when %s
                                             then now() + (
                                               least(attempts, 5) * interval '5 seconds'
                                             )
                                               else next_attempt_at end,
                        error_message = %s, lease_owner = null, lease_expires_at = null,
                        updated_at = now()
                    where id = %s returning run_id, status
                    """,
                    (retry, retry, error_message[:2000], task_id),
                )
            ).fetchone()
            if row is not None and str(row["status"]) == GenerationTaskStatus.FAILED.value:
                await conn.execute(
                    """
                    update generation_runs set status = 'failed', error_summary = %s,
                        completed_at = now(), updated_at = now() where id = %s
                    """,
                    (error_message[:2000], row["run_id"]),
                )

    async def generation_topic_ids(self, revision_id: UUID) -> tuple[UUID, ...]:
        async with pooled_connection(self._database_url) as conn:
            rows = await (
                await conn.execute(
                    """
                    select id from topics
                    where revision_id = %s and review_status <> 'dismissed'
                    order by start_seconds
                    """,
                    (revision_id,),
                )
            ).fetchall()
        return tuple(UUID(str(row[0])) for row in rows)

    async def assemble_review_bundles(
        self,
        course_id: UUID,
        revision_id: UUID,
    ) -> tuple[ReviewBundle, ...]:
        definitions = (
            (
                "course_structure",
                "Course structure",
                "Review the outline, concepts, and prerequisite relationships.",
                ("topic", "concept", "concept_edge"),
            ),
            (
                "learner_experience",
                "Learner experience",
                "Review the generated teaching clips and assessment decisions.",
                ("clip", "question"),
            ),
            (
                "publish_setup",
                "Publish setup",
                "Confirm the recommended adaptive-routing behavior before publishing.",
                ("routing_policy",),
            ),
        )
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await conn.execute(
                """
                insert into routing_policies (course_id, concept_id, revision_id, policy)
                select %s, c.id, %s, %s::jsonb
                from concepts c
                where c.revision_id = %s and c.review_status <> 'dismissed'
                on conflict (revision_id, concept_id) do nothing
                """,
                (
                    course_id,
                    revision_id,
                    Jsonb(
                        {
                            "confidence_threshold": 3,
                            "correct_attempts_for_mastery": 1,
                            "advancement_mode": "require_mastery",
                            "max_remediation_attempts": 2,
                            "recommendation": "standard",
                        }
                    ),
                    revision_id,
                ),
            )
            for kind, title, summary, artifact_types in definitions:
                bundle = await (
                    await conn.execute(
                        """
                        insert into review_bundles (
                          course_id, revision_id, kind, title, summary
                        ) values (%s, %s, %s, %s, %s)
                        on conflict (revision_id, kind) do update
                        set title = excluded.title, summary = excluded.summary,
                            updated_at = now()
                        returning id
                        """,
                        (course_id, revision_id, kind, title, summary),
                    )
                ).fetchone()
                if bundle is None:
                    raise RuntimeError("Failed to create review bundle.")
                artifacts = await _review_artifacts(conn, revision_id, artifact_types)
                for artifact in artifacts:
                    await conn.execute(
                        """
                        insert into review_items (
                          bundle_id, artifact_type, artifact_id,
                          logical_artifact_id, risk_level, evidence
                        ) values (%s, %s, %s, %s, %s, %s::jsonb)
                        on conflict (bundle_id, artifact_type, artifact_id) do nothing
                        """,
                        (
                            bundle["id"],
                            artifact["artifact_type"],
                            artifact["artifact_id"],
                            artifact["logical_id"],
                            artifact["risk_level"],
                            Jsonb(artifact["evidence"]),
                        ),
                    )
        return await self.review_bundles(revision_id)

    async def list_messages(
        self,
        course_id: UUID,
        revision_id: UUID,
    ) -> tuple[ConversationMessage, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select m.* from course_messages m
                    join course_conversations c on c.id = m.conversation_id
                    where c.course_id = %s and c.revision_id = %s
                    order by m.created_at
                    """,
                    (course_id, revision_id),
                )
            ).fetchall()
        return tuple(_message(row) for row in rows)

    async def add_message(
        self,
        course_id: UUID,
        revision_id: UUID,
        role: str,
        content: str,
        blocks: tuple[dict[str, Any], ...] = (),
    ) -> ConversationMessage:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            conversation = await (
                await conn.execute(
                    """
                    insert into course_conversations (course_id, revision_id)
                    values (%s, %s)
                    on conflict (course_id, revision_id) do update set updated_at = now()
                    returning id
                    """,
                    (course_id, revision_id),
                )
            ).fetchone()
            if conversation is None:
                raise RuntimeError("Failed to load the course conversation.")
            row = await (
                await conn.execute(
                    """
                    insert into course_messages (conversation_id, role, content, blocks)
                    values (%s, %s, %s, %s::jsonb) returning *
                    """,
                    (conversation["id"], role, content, Jsonb(list(blocks))),
                )
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to add course message.")
        return _message(row)

    async def create_proposal(
        self,
        course_id: UUID,
        revision_id: UUID,
        message_id: UUID,
        instruction: str,
    ) -> CourseProposal:
        proposed_state = {"instruction": instruction}
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into course_proposals (
                      course_id, revision_id, message_id, proposal_type, artifact_type,
                      proposed_state, rationale
                    ) values (%s, %s, %s, 'brief_update', 'course_brief', %s::jsonb, %s)
                    returning *
                    """,
                    (
                        course_id,
                        revision_id,
                        message_id,
                        Jsonb(proposed_state),
                        "Manifold will treat this instruction as a durable "
                        "course-building directive.",
                    ),
                )
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to create course proposal.")
        return _proposal(row)

    async def course_evidence(
        self,
        course_id: UUID,
        revision_id: UUID,
    ) -> dict[str, Any]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select
                      (select count(*) from enrollments where course_id = %s)
                        as enrolled_learners,
                      (select count(*) from topics where revision_id = %s
                        and review_status <> 'dismissed') as topics,
                      (select count(*) from concepts where revision_id = %s
                        and review_status <> 'dismissed') as concepts,
                      (select count(*) from attempts a
                        join questions q on q.id = a.question_id
                        join topics t on t.id = q.topic_id
                        where t.course_id = %s) as attempts,
                      (select count(*) from attempts a
                        join questions q on q.id = a.question_id
                        join topics t on t.id = q.topic_id
                        where t.course_id = %s and not a.correctness) as incorrect_attempts,
                      (select count(*) from attempts a
                        join questions q on q.id = a.question_id
                        join topics t on t.id = q.topic_id
                        where t.course_id = %s and a.confidence <= 2)
                        as low_confidence_attempts,
                      (select count(*) from dashboard_signals
                        where course_id = %s and status = 'open') as open_signals
                    """,
                    (
                        course_id,
                        revision_id,
                        revision_id,
                        course_id,
                        course_id,
                        course_id,
                        course_id,
                    ),
                )
            ).fetchone()
        return {key: int(value) for key, value in (row or {}).items()}

    async def resolve_proposal(
        self,
        course_id: UUID,
        proposal_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
        instructor_revision: dict[str, Any] | None,
    ) -> CourseProposal | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            proposal = await (
                await conn.execute(
                    "select * from course_proposals where id = %s and course_id = %s for update",
                    (proposal_id, course_id),
                )
            ).fetchone()
            if proposal is None:
                return None
            resolved_state = instructor_revision or _json_dict(proposal["proposed_state"])
            row = await (
                await conn.execute(
                    """
                    update course_proposals
                    set status = %s, instructor_revision = %s::jsonb, resolved_at = now()
                    where id = %s returning *
                    """,
                    (
                        decision.value,
                        Jsonb(instructor_revision) if instructor_revision else None,
                        proposal_id,
                    ),
                )
            ).fetchone()
            if decision in {ReviewDecision.ACCEPTED, ReviewDecision.EDITED}:
                directive = str(resolved_state.get("instruction", "")).strip()
                if directive:
                    await conn.execute(
                        """
                        update course_revisions
                        set brief = jsonb_set(
                          brief, '{directives}',
                          coalesce(brief -> 'directives', '[]'::jsonb) || %s::jsonb,
                          true
                        ), updated_at = now()
                        where id = %s
                        """,
                        (Jsonb([directive]), proposal["revision_id"]),
                    )
            await conn.execute(
                """
                insert into audit_events (
                  course_id, actor_type, actor_id, artifact_type, artifact_id,
                  action, source, previous_state, new_state, ai_rationale,
                  scope, revision_id, course_proposal_id
                ) values (
                  %s, 'user', %s, 'course_brief', %s, %s, 'instructor',
                  %s::jsonb, %s::jsonb, %s, 'revision', %s, %s
                )
                """,
                (
                    course_id,
                    instructor_id,
                    proposal_id,
                    decision.value,
                    Jsonb(_json_dict(proposal["proposed_state"])),
                    Jsonb(resolved_state),
                    proposal["rationale"],
                    proposal["revision_id"],
                    proposal_id,
                ),
            )
        return _proposal(row) if row else None

    async def course_map(self, course_id: UUID, revision_id: UUID) -> CourseMap:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            topics = await (
                await conn.execute(
                    """
                    select id, logical_id, title, summary, review_status, start_seconds, end_seconds
                    from topics where course_id = %s and revision_id = %s
                    order by start_seconds
                    """,
                    (course_id, revision_id),
                )
            ).fetchall()
            concepts = await (
                await conn.execute(
                    """
                    select c.id, c.logical_id, c.name, c.description, c.review_status,
                           min(tc.topic_id::text)::uuid as topic_id
                    from concepts c
                    left join topic_concepts tc on tc.concept_id = c.id
                    where c.course_id = %s and c.revision_id = %s
                    group by c.id
                    order by c.name
                    """,
                    (course_id, revision_id),
                )
            ).fetchall()
            edges = await (
                await conn.execute(
                    """
                    select id, logical_id, from_concept_id, to_concept_id,
                           relationship, review_status
                    from concept_edges where revision_id = %s order by created_at
                    """,
                    (revision_id,),
                )
            ).fetchall()
        nodes = [
            CourseMapNode(
                id=UUID(str(row["id"])),
                logical_id=UUID(str(row["logical_id"])),
                kind="topic",
                title=str(row["title"]),
                status=str(row["review_status"]),
                topic_id=None,
                metadata={
                    "summary": str(row["summary"] or ""),
                    "start_seconds": float(row["start_seconds"]),
                    "end_seconds": float(row["end_seconds"]),
                },
            )
            for row in topics
        ]
        nodes.extend(
            CourseMapNode(
                id=UUID(str(row["id"])),
                logical_id=UUID(str(row["logical_id"])),
                kind="concept",
                title=str(row["name"]),
                status=str(row["review_status"]),
                topic_id=UUID(str(row["topic_id"])) if row["topic_id"] else None,
                metadata={"description": str(row["description"] or "")},
            )
            for row in concepts
        )
        return CourseMap(
            course_id=course_id,
            revision_id=revision_id,
            nodes=tuple(nodes),
            edges=tuple(
                CourseMapEdge(
                    id=UUID(str(row["id"])),
                    logical_id=UUID(str(row["logical_id"])),
                    source_id=UUID(str(row["from_concept_id"])),
                    target_id=UUID(str(row["to_concept_id"])),
                    kind=str(row["relationship"]),
                    status=str(row["review_status"]),
                )
                for row in edges
            ),
        )

    async def revision_diff(
        self,
        active_revision_id: UUID | None,
        working_revision_id: UUID,
    ) -> RevisionDiff:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            before = (
                await _revision_artifact_states(conn, active_revision_id)
                if active_revision_id
                else {}
            )
            after = await _revision_artifact_states(conn, working_revision_id)
        changes: list[RevisionChange] = []
        for key in sorted(set(before) | set(after), key=lambda value: (value[0], str(value[1]))):
            before_state = before.get(key)
            after_state = after.get(key)
            if before_state == after_state:
                continue
            change_type = "changed"
            if before_state is None:
                change_type = "added"
            elif after_state is None:
                change_type = "removed"
            changes.append(
                RevisionChange(
                    artifact_type=key[0],
                    logical_artifact_id=key[1],
                    change_type=change_type,
                    before_state=before_state,
                    after_state=after_state,
                )
            )
        return RevisionDiff(
            active_revision_id=active_revision_id,
            working_revision_id=working_revision_id,
            changes=tuple(changes),
        )

    async def review_bundles(self, revision_id: UUID) -> tuple[ReviewBundle, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            bundles = await (
                await conn.execute(
                    "select * from review_bundles where revision_id = %s order by created_at",
                    (revision_id,),
                )
            ).fetchall()
            items = await (
                await conn.execute(
                    """
                    select ri.* from review_items ri
                    join review_bundles rb on rb.id = ri.bundle_id
                    where rb.revision_id = %s order by ri.created_at
                    """,
                    (revision_id,),
                )
            ).fetchall()
        by_bundle: dict[UUID, list[ReviewItem]] = {}
        for row in items:
            by_bundle.setdefault(UUID(str(row["bundle_id"])), []).append(_review_item(row))
        return tuple(
            _review_bundle(row, tuple(by_bundle.get(UUID(str(row["id"])), []))) for row in bundles
        )

    async def resolve_review_item(
        self,
        course_id: UUID,
        item_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
        instructor_revision: dict[str, Any] | None,
    ) -> ReviewItem | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            item = await (
                await conn.execute(
                    """
                    select ri.* from review_items ri
                    join review_bundles rb on rb.id = ri.bundle_id
                    where ri.id = %s and rb.course_id = %s for update of ri
                    """,
                    (item_id, course_id),
                )
            ).fetchone()
            if item is None:
                return None
            artifact_type = str(item["artifact_type"])
            await _apply_artifact_review(
                conn,
                artifact_type,
                UUID(str(item["artifact_id"])),
                decision,
                instructor_revision,
            )
            row = await (
                await conn.execute(
                    """
                    update review_items set status = %s, updated_at = now()
                    where id = %s returning *
                    """,
                    (decision.value, item_id),
                )
            ).fetchone()
            bundle = await (
                await conn.execute(
                    "select revision_id from review_bundles where id = %s",
                    (item["bundle_id"],),
                )
            ).fetchone()
            await conn.execute(
                """
                insert into audit_events (
                  course_id, actor_type, actor_id, artifact_type, artifact_id,
                  action, source, previous_state, new_state, instructor_note,
                  scope, revision_id
                ) values (
                  %s, 'user', %s, %s, %s, %s, 'instructor',
                  %s::jsonb, %s::jsonb, %s, 'revision', %s
                )
                """,
                (
                    course_id,
                    instructor_id,
                    artifact_type,
                    item["artifact_id"],
                    decision.value,
                    Jsonb(_json_dict(item["evidence"])),
                    Jsonb(instructor_revision or {"status": decision.value}),
                    (
                        str(instructor_revision.get("note"))
                        if instructor_revision and instructor_revision.get("note")
                        else None
                    ),
                    bundle["revision_id"] if bundle else None,
                ),
            )
            await _refresh_bundle(conn, UUID(str(item["bundle_id"])))
        return _review_item(row) if row else None

    async def resolve_review_bundle_remaining(
        self,
        course_id: UUID,
        bundle_id: UUID,
        instructor_id: UUID,
        decision: ReviewDecision,
    ) -> ReviewBundle | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select ri.id from review_items ri
                    join review_bundles rb on rb.id = ri.bundle_id
                    where ri.bundle_id = %s and rb.course_id = %s and ri.status = 'pending'
                    """,
                    (bundle_id, course_id),
                )
            ).fetchall()
            bundle = await (
                await conn.execute(
                    "select revision_id from review_bundles where id = %s and course_id = %s",
                    (bundle_id, course_id),
                )
            ).fetchone()
        if bundle is None:
            return None
        for row in rows:
            await self.resolve_review_item(
                course_id,
                UUID(str(row["id"])),
                instructor_id,
                decision,
                None,
            )
        bundles = await self.review_bundles(UUID(str(bundle["revision_id"])))
        return next((item for item in bundles if item.id == bundle_id), None)


_COURSE_SUMMARY_SQL = """
select c.id, c.instructor_id, c.title, c.description, c.status,
       c.active_revision_id, c.working_revision_id, c.updated_at,
       cr.status as revision_status,
       gr.id as generation_run_id, gr.status as generation_status, gr.phase as generation_phase,
       coalesce(gr.progress, 0) as generation_progress,
       (select count(*) from videos v where v.course_id = c.id) as source_count,
       (select count(*) from topics t
         where t.revision_id = cr.id and t.review_status <> 'dismissed') as topic_count,
       (select count(*) from concepts x
         where x.revision_id = cr.id and x.review_status <> 'dismissed') as concept_count,
       (select count(*) from review_items ri join review_bundles rb on rb.id = ri.bundle_id
         where rb.revision_id = cr.id and ri.status = 'pending') as pending_review_count,
       (select count(*) from dashboard_signals ds
         where ds.course_id = c.id and ds.status = 'open') as open_signal_count
from courses c
left join course_revisions cr on cr.id = coalesce(c.working_revision_id, c.active_revision_id)
left join lateral (
  select id, status, phase, progress from generation_runs
  where course_id = c.id and revision_id = cr.id
  order by created_at desc limit 1
) gr on true
"""

_TASK_ORDER = (
    "source_ready",
    "outline",
    "concept_graph",
    "clips",
    "assessments",
    "review_bundles",
)


async def _apply_artifact_review(
    conn: Any,
    artifact_type: str,
    artifact_id: UUID,
    decision: ReviewDecision,
    revision: dict[str, Any] | None,
) -> None:
    if decision == ReviewDecision.EDITED and revision:
        if artifact_type == "topic":
            await conn.execute(
                """
                update topics set
                  title = coalesce(%s, title), summary = coalesce(%s, summary),
                  start_seconds = coalesce(%s, start_seconds),
                  end_seconds = coalesce(%s, end_seconds)
                where id = %s
                """,
                (
                    revision.get("title"),
                    revision.get("summary"),
                    revision.get("start_seconds"),
                    revision.get("end_seconds"),
                    artifact_id,
                ),
            )
        elif artifact_type == "concept":
            await conn.execute(
                """
                update concepts set name = coalesce(%s, name),
                  description = coalesce(%s, description) where id = %s
                """,
                (revision.get("name"), revision.get("description"), artifact_id),
            )
        elif artifact_type == "concept_edge":
            await _edit_concept_edge(conn, artifact_id, revision)
        elif artifact_type == "clip":
            await conn.execute(
                """
                update clips set start_seconds = coalesce(%s, start_seconds),
                  end_seconds = coalesce(%s, end_seconds),
                  type = coalesce(%s, type::text)::clip_type where id = %s
                """,
                (
                    revision.get("start_seconds"),
                    revision.get("end_seconds"),
                    revision.get("type"),
                    artifact_id,
                ),
            )
        elif artifact_type == "question":
            correct_answer = revision.get("correct_answer")
            await conn.execute(
                """
                update questions set body = coalesce(%s, body),
                  correct_answer = coalesce(%s::jsonb, correct_answer),
                  confidence_prompt = coalesce(%s, confidence_prompt)
                where id = %s
                """,
                (
                    revision.get("body"),
                    Jsonb(correct_answer) if isinstance(correct_answer, dict) else None,
                    revision.get("confidence_prompt"),
                    artifact_id,
                ),
            )
        elif artifact_type == "routing_policy":
            policy = revision.get("policy")
            if isinstance(policy, dict):
                await conn.execute(
                    """
                    update routing_policies set policy = %s::jsonb, updated_at = now()
                    where id = %s
                    """,
                    (Jsonb(policy), artifact_id),
                )

    if artifact_type == "clip":
        clip_status = "superseded" if decision == ReviewDecision.DISMISSED else "active"
        await conn.execute(
            """
            update clips set status = %s,
              instructor_revision = coalesce(%s::jsonb, instructor_revision),
              updated_at = now() where id = %s
            """,
            (clip_status, Jsonb(revision) if revision else None, artifact_id),
        )
        return
    if artifact_type == "routing_policy":
        return
    tables = {
        "topic": "topics",
        "concept": "concepts",
        "concept_edge": "concept_edges",
        "question": "questions",
    }
    table = tables.get(artifact_type)
    if table is None:
        return
    await conn.execute(
        f"update {table} set review_status = %s, "
        "instructor_revision = coalesce(%s::jsonb, instructor_revision), "
        "approved_at = case when %s = 'dismissed' then approved_at else now() end, "
        "dismissed_at = case when %s = 'dismissed' then now() else null end, "
        "updated_at = now() where id = %s",
        (
            decision.value,
            Jsonb(revision) if revision else None,
            decision.value,
            decision.value,
            artifact_id,
        ),
    )


async def _edit_concept_edge(
    conn: Any,
    artifact_id: UUID,
    revision: dict[str, Any],
) -> None:
    current = await (
        await conn.execute(
            """
            select revision_id, from_concept_id, to_concept_id, relationship
            from concept_edges where id = %s
            """,
            (artifact_id,),
        )
    ).fetchone()
    if current is None:
        raise ValueError("The prerequisite relationship no longer exists.")
    try:
        from_concept_id = UUID(str(revision.get("from_concept_id", current["from_concept_id"])))
        to_concept_id = UUID(str(revision.get("to_concept_id", current["to_concept_id"])))
    except (TypeError, ValueError) as exc:
        raise ValueError("Concept relationship endpoints must be valid concept IDs.") from exc
    relationship = str(revision.get("relationship", current["relationship"]))
    if relationship != "requires":
        raise ValueError("Prerequisite relationships must use the 'requires' type.")
    if from_concept_id == to_concept_id:
        raise ValueError("A concept cannot require itself.")

    concepts = await (
        await conn.execute(
            """
            select count(*) as count from concepts
            where revision_id = %s and id = any(%s)
            """,
            (current["revision_id"], [from_concept_id, to_concept_id]),
        )
    ).fetchone()
    if concepts is None or int(concepts["count"]) != 2:
        raise ValueError("Both concepts must belong to this working revision.")
    duplicate = await (
        await conn.execute(
            """
            select 1 from concept_edges
            where id <> %s and from_concept_id = %s and to_concept_id = %s
              and relationship = %s
            """,
            (artifact_id, from_concept_id, to_concept_id, relationship),
        )
    ).fetchone()
    if duplicate is not None:
        raise ValueError("That prerequisite relationship already exists.")
    cycle = await (
        await conn.execute(
            """
            with recursive reachable(concept_id) as (
              select to_concept_id from concept_edges
              where revision_id = %s and from_concept_id = %s
                and id <> %s and review_status <> 'dismissed'
              union
              select e.to_concept_id from concept_edges e
              join reachable r on e.from_concept_id = r.concept_id
              where e.revision_id = %s and e.id <> %s
                and e.review_status <> 'dismissed'
            )
            select 1 from reachable where concept_id = %s limit 1
            """,
            (
                current["revision_id"],
                to_concept_id,
                artifact_id,
                current["revision_id"],
                artifact_id,
                from_concept_id,
            ),
        )
    ).fetchone()
    if cycle is not None:
        raise ValueError("That edit would create a prerequisite cycle.")
    await conn.execute(
        """
        update concept_edges set from_concept_id = %s, to_concept_id = %s,
          relationship = %s, updated_at = now() where id = %s
        """,
        (from_concept_id, to_concept_id, relationship, artifact_id),
    )


async def _refresh_run(conn: Any, run_id: UUID) -> None:
    counts = await (
        await conn.execute(
            """
            select count(*) as total,
                   count(*) filter (where status = 'complete') as complete
            from generation_tasks where run_id = %s
            """,
            (run_id,),
        )
    ).fetchone()
    total = int(counts["total"])
    complete = int(counts["complete"])
    progress = 100.0 if total == 0 else round((complete / total) * 100, 2)
    if complete == total:
        run = await (
            await conn.execute(
                """
                update generation_runs set status = 'waiting_review', phase = 'review',
                    progress = 100, completed_at = now(), updated_at = now()
                where id = %s returning revision_id
                """,
                (run_id,),
            )
        ).fetchone()
        if run is not None:
            await conn.execute(
                "update course_revisions set status = 'review', updated_at = now() where id = %s",
                (run["revision_id"],),
            )
        return
    next_task = await (
        await conn.execute(
            """
            select task_type from generation_tasks
            where run_id = %s and status = 'queued' order by created_at limit 1
            """,
            (run_id,),
        )
    ).fetchone()
    await conn.execute(
        "update generation_runs set progress = %s, phase = %s, updated_at = now() where id = %s",
        (progress, str(next_task["task_type"]) if next_task else "generation", run_id),
    )


async def _review_artifacts(
    conn: Any,
    revision_id: UUID,
    artifact_types: tuple[str, ...],
) -> list[dict[str, Any]]:
    queries = {
        "topic": """
            select id as artifact_id, logical_id, 'normal' as risk_level,
                   jsonb_build_object(
                     'title', title, 'summary', coalesce(summary, ''),
                     'start_seconds', start_seconds, 'end_seconds', end_seconds,
                     'ai_proposal', ai_proposal
                   ) as evidence
            from topics where revision_id = %s and review_status <> 'dismissed'
            order by start_seconds
        """,
        "concept": """
            select id as artifact_id, logical_id, 'normal' as risk_level,
                   jsonb_build_object(
                     'name', name, 'description', coalesce(description, ''),
                     'ai_proposal', ai_proposal
                   ) as evidence
            from concepts where revision_id = %s and review_status <> 'dismissed'
            order by name
        """,
        "concept_edge": """
            select e.id as artifact_id, e.logical_id,
                   case when coalesce((e.ai_proposal ->> 'confidence')::numeric, 1) < 0.7
                        then 'high' else 'normal' end as risk_level,
                   jsonb_build_object(
                     'from_concept_id', e.from_concept_id,
                     'to_concept_id', e.to_concept_id,
                     'relationship', e.relationship,
                     'ai_proposal', e.ai_proposal
                   ) as evidence
            from concept_edges e
            where e.revision_id = %s and e.review_status <> 'dismissed'
            order by e.created_at
        """,
        "clip": """
            select id as artifact_id, logical_id, 'normal' as risk_level,
                   jsonb_build_object(
                     'topic_id', topic_id, 'type', type,
                     'start_seconds', start_seconds, 'end_seconds', end_seconds,
                     'ai_proposal', ai_proposal
                   ) as evidence
            from clips where revision_id = %s and status <> 'superseded'
            order by start_seconds
        """,
        "question": """
            select id as artifact_id, logical_id, 'high' as risk_level,
                   jsonb_build_object(
                     'topic_id', topic_id, 'body', body, 'type', type,
                     'correct_answer', correct_answer,
                     'confidence_prompt', confidence_prompt,
                     'ai_proposal', ai_proposal
                   ) as evidence
            from questions where revision_id = %s and review_status <> 'dismissed'
            order by created_at
        """,
        "routing_policy": """
            select id as artifact_id, logical_id, 'high' as risk_level,
                   jsonb_build_object('concept_id', concept_id, 'policy', policy) as evidence
            from routing_policies where revision_id = %s
            order by created_at
        """,
    }
    artifacts: list[dict[str, Any]] = []
    for artifact_type in artifact_types:
        rows = await (await conn.execute(queries[artifact_type], (revision_id,))).fetchall()
        artifacts.extend(
            {
                "artifact_type": artifact_type,
                "artifact_id": UUID(str(row["artifact_id"])),
                "logical_id": UUID(str(row["logical_id"])),
                "risk_level": str(row["risk_level"]),
                "evidence": _json_dict(row["evidence"]),
            }
            for row in rows
        )
    return artifacts


async def _refresh_bundle(conn: Any, bundle_id: UUID) -> None:
    await conn.execute(
        """
        update review_bundles rb
        set status = case
          when not exists (
            select 1 from review_items where bundle_id = rb.id and status = 'pending'
          )
            then 'complete'::review_bundle_status
          else 'in_review'::review_bundle_status
        end,
        updated_at = now()
        where rb.id = %s
        """,
        (bundle_id,),
    )


async def _revision_artifact_states(
    conn: Any,
    revision_id: UUID,
) -> dict[tuple[str, UUID], dict[str, Any]]:
    rows = await (
        await conn.execute(
            """
            select 'topic' as artifact_type, t.logical_id,
                   jsonb_build_object(
                     'title', t.title, 'summary', coalesce(t.summary, ''),
                     'start_seconds', t.start_seconds, 'end_seconds', t.end_seconds,
                     'included', t.review_status <> 'dismissed'
                   ) as state
            from topics t where t.revision_id = %s
            union all
            select 'course_brief', revision.course_id,
                   jsonb_build_object('brief', revision.brief)
            from course_revisions revision where revision.id = %s
            union all
            select 'concept', c.logical_id,
                   jsonb_build_object(
                     'name', c.name, 'description', coalesce(c.description, ''),
                     'included', c.review_status <> 'dismissed',
                     'topic_logical_ids', coalesce((
                       select jsonb_agg(t.logical_id order by t.logical_id)
                       from topic_concepts tc join topics t on t.id = tc.topic_id
                       where tc.concept_id = c.id
                     ), '[]'::jsonb)
                   )
            from concepts c where c.revision_id = %s
            union all
            select 'concept_edge', e.logical_id,
                   jsonb_build_object(
                     'from_concept_logical_id', source.logical_id,
                     'to_concept_logical_id', target.logical_id,
                     'relationship', e.relationship,
                     'included', e.review_status <> 'dismissed'
                   )
            from concept_edges e
            join concepts source on source.id = e.from_concept_id
            join concepts target on target.id = e.to_concept_id
            where e.revision_id = %s
            union all
            select 'clip', c.logical_id,
                   jsonb_build_object(
                     'topic_logical_id', t.logical_id, 'type', c.type,
                     'start_seconds', c.start_seconds, 'end_seconds', c.end_seconds,
                     'included', c.status <> 'superseded',
                     'concept_logical_ids', coalesce((
                       select jsonb_agg(x.logical_id order by x.logical_id)
                       from clip_concepts cc join concepts x on x.id = cc.concept_id
                       where cc.clip_id = c.id
                     ), '[]'::jsonb)
                   )
            from clips c join topics t on t.id = c.topic_id
            where c.revision_id = %s and c.status <> 'superseded'
            union all
            select 'question', q.logical_id,
                   jsonb_build_object(
                     'topic_logical_id', t.logical_id, 'body', q.body, 'type', q.type,
                     'correct_answer', q.correct_answer,
                     'confidence_prompt', q.confidence_prompt,
                     'included', q.review_status <> 'dismissed'
                   )
            from questions q join topics t on t.id = q.topic_id
            where q.revision_id = %s
            union all
            select 'remediation_rule', rr.logical_id,
                   jsonb_build_object(
                     'question_logical_id', q.logical_id,
                     'wrong_answer_pattern', rr.wrong_answer_pattern,
                     'target_clip_logical_id', clip.logical_id,
                     'target_concept_logical_id', concept.logical_id
                   )
            from remediation_rules rr
            join questions q on q.id = rr.question_id
            left join clips clip on clip.id = rr.target_clip_id
            left join concepts concept on concept.id = rr.target_concept_id
            where rr.revision_id = %s
            union all
            select 'routing_policy', rp.logical_id,
                   jsonb_build_object(
                     'concept_logical_id', concept.logical_id,
                     'policy', rp.policy
                   )
            from routing_policies rp
            left join concepts concept on concept.id = rp.concept_id
            where rp.revision_id = %s
            """,
            (revision_id,) * 8,
        )
    ).fetchall()
    return {
        (str(row["artifact_type"]), UUID(str(row["logical_id"]))): _json_dict(row["state"])
        for row in rows
    }


def _course_summary(row: dict[str, Any]) -> CourseSummary:
    return CourseSummary(
        id=UUID(str(row["id"])),
        instructor_id=UUID(str(row["instructor_id"])),
        title=str(row["title"]),
        description=str(row["description"]) if row["description"] is not None else None,
        status=str(row["status"]),
        active_revision_id=(
            UUID(str(row["active_revision_id"])) if row["active_revision_id"] else None
        ),
        working_revision_id=(
            UUID(str(row["working_revision_id"])) if row["working_revision_id"] else None
        ),
        revision_status=str(row["revision_status"]) if row["revision_status"] else None,
        generation_run_id=(
            UUID(str(row["generation_run_id"])) if row["generation_run_id"] else None
        ),
        generation_status=str(row["generation_status"]) if row["generation_status"] else None,
        generation_phase=str(row["generation_phase"]) if row["generation_phase"] else None,
        generation_progress=float(row["generation_progress"]),
        source_count=int(row["source_count"]),
        topic_count=int(row["topic_count"]),
        concept_count=int(row["concept_count"]),
        pending_review_count=int(row["pending_review_count"]),
        open_signal_count=int(row["open_signal_count"]),
        updated_at=_datetime(row["updated_at"]),
    )


def _generation_task(row: dict[str, Any]) -> GenerationTask:
    return GenerationTask(
        id=UUID(str(row["id"])),
        run_id=UUID(str(row["run_id"])),
        task_type=str(row["task_type"]),
        scope_key=str(row["scope_key"]),
        status=GenerationTaskStatus(str(row["status"])),
        depends_on=tuple(UUID(str(value)) for value in row["depends_on"]),
        attempts=int(row["attempts"]),
        max_attempts=int(row["max_attempts"]),
        input=_json_dict(row["input"]),
        output=_json_dict(row["output"]) if row["output"] is not None else None,
        error_message=str(row["error_message"]) if row["error_message"] else None,
    )


def _generation_run(row: dict[str, Any], tasks: tuple[GenerationTask, ...]) -> GenerationRun:
    return GenerationRun(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        revision_id=UUID(str(row["revision_id"])),
        status=GenerationRunStatus(str(row["status"])),
        phase=str(row["phase"]),
        progress=float(row["progress"]),
        error_summary=str(row["error_summary"]) if row["error_summary"] else None,
        created_at=_datetime(row["created_at"]),
        updated_at=_datetime(row["updated_at"]),
        tasks=tasks,
    )


def _message(row: dict[str, Any]) -> ConversationMessage:
    blocks = row["blocks"] if isinstance(row["blocks"], list) else []
    return ConversationMessage(
        id=UUID(str(row["id"])),
        role=str(row["role"]),
        content=str(row["content"]),
        blocks=tuple(block for block in blocks if isinstance(block, dict)),
        created_at=_datetime(row["created_at"]),
    )


def _proposal(row: dict[str, Any]) -> CourseProposal:
    return CourseProposal(
        id=UUID(str(row["id"])),
        proposal_type=str(row["proposal_type"]),
        artifact_type=str(row["artifact_type"]) if row["artifact_type"] else None,
        logical_artifact_id=(
            UUID(str(row["logical_artifact_id"])) if row["logical_artifact_id"] else None
        ),
        before_state=_json_dict(row["before_state"]) if row["before_state"] is not None else None,
        proposed_state=_json_dict(row["proposed_state"]),
        rationale=str(row["rationale"]),
        status=str(row["status"]),
        created_at=_datetime(row["created_at"]),
    )


def _review_item(row: dict[str, Any]) -> ReviewItem:
    return ReviewItem(
        id=UUID(str(row["id"])),
        artifact_type=str(row["artifact_type"]),
        artifact_id=UUID(str(row["artifact_id"])),
        logical_artifact_id=UUID(str(row["logical_artifact_id"])),
        status=str(row["status"]),
        risk_level=str(row["risk_level"]),
        evidence=_json_dict(row["evidence"]),
    )


def _review_bundle(row: dict[str, Any], items: tuple[ReviewItem, ...]) -> ReviewBundle:
    return ReviewBundle(
        id=UUID(str(row["id"])),
        kind=str(row["kind"]),
        title=str(row["title"]),
        summary=str(row["summary"]),
        status=str(row["status"]),
        items=items,
    )


def _json_dict(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _datetime(value: object) -> datetime:
    return value if isinstance(value, datetime) else datetime.now(UTC)
