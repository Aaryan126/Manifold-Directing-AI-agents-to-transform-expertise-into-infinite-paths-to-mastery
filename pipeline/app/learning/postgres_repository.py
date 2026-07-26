from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.db.pool import pooled_connection
from app.learning.models import (
    ClipTranscript,
    ClipTranscriptWord,
    HelpRequest,
    LearnerRevision,
    LearningGuideMessage,
    MasteryReview,
    Orientation,
    PlacementCheck,
    PlacementItem,
    ReviewConcept,
    RouteHistoryItem,
    SessionStep,
    StudySession,
)


class PostgresLearningRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def learner_revision(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> LearnerRevision | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select e.learner_id, e.course_id, e.revision_id
                    from enrollments e
                    join courses c on c.id = e.course_id
                    join users u on u.id = e.learner_id
                    where e.learner_id = %s and e.course_id = %s
                      and u.role = 'learner'
                      and (c.status = 'published' or u.is_simulated)
                    """,
                    (learner_id, course_id),
                )
            ).fetchone()
        if row is None:
            return None
        return LearnerRevision(
            learner_id=UUID(str(row["learner_id"])),
            course_id=UUID(str(row["course_id"])),
            revision_id=UUID(str(row["revision_id"])),
        )

    async def orientation(self, context: LearnerRevision) -> Orientation:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select orientation_status, entry_choice
                    from learner_course_preferences
                    where learner_id = %s and course_id = %s and revision_id = %s
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchone()
        if row is None:
            return Orientation(False, None)
        return Orientation(
            completed=str(row["orientation_status"]) == "completed",
            entry_choice=str(row["entry_choice"]) if row["entry_choice"] else None,
        )

    async def complete_orientation(
        self,
        context: LearnerRevision,
        *,
        entry_choice: str,
    ) -> Orientation:
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                insert into learner_course_preferences (
                  learner_id, course_id, revision_id, orientation_status,
                  entry_choice, orientation_completed_at
                ) values (%s, %s, %s, 'completed', %s, now())
                on conflict (learner_id, course_id, revision_id) do update
                set orientation_status = 'completed',
                    entry_choice = excluded.entry_choice,
                    orientation_completed_at = coalesce(
                      learner_course_preferences.orientation_completed_at, now()
                    ),
                    updated_at = now()
                """,
                (
                    context.learner_id,
                    context.course_id,
                    context.revision_id,
                    entry_choice,
                ),
            )
        return await self.orientation(context)

    async def concept_artifacts(
        self,
        context: LearnerRevision,
        concept_ids: tuple[UUID, ...],
    ) -> dict[UUID, dict[str, object]]:
        if not concept_ids:
            return {}
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select c.id, c.name,
                           topic.id as topic_id, topic.title as topic_title,
                           clip.id as clip_id,
                           coalesce(clip.ai_proposal->>'title', topic.title) as clip_title,
                           clip.start_seconds, clip.end_seconds,
                           question.id as question_id, question.body,
                           question.type, question.correct_answer,
                           question.confidence_prompt
                    from concepts c
                    left join lateral (
                      select t.id, t.title
                      from topic_concepts tc
                      join topics t on t.id = tc.topic_id
                      where tc.concept_id = c.id
                        and t.revision_id = c.revision_id
                        and t.review_status in ('accepted', 'edited')
                      order by t.start_seconds, t.id limit 1
                    ) topic on true
                    left join lateral (
                      select cl.*
                      from clip_concepts cc
                      join clips cl on cl.id = cc.clip_id
                      where cc.concept_id = c.id
                        and cl.revision_id = c.revision_id
                        and cl.status = 'active'
                      order by
                        case cl.type when 'explanation' then 0
                          when 'worked_example' then 1 else 2 end,
                        cl.start_seconds
                      limit 1
                    ) clip on true
                    left join lateral (
                      select q.*
                      from question_concepts qc
                      join questions q on q.id = qc.question_id
                      where qc.concept_id = c.id
                        and qc.revision_id = c.revision_id
                        and qc.is_primary
                        and q.review_status in ('accepted', 'edited')
                      order by q.created_at, q.id limit 1
                    ) question on true
                    where c.id = any(%s::uuid[])
                      and c.revision_id = %s
                      and c.review_status in ('accepted', 'edited')
                    """,
                    (list(concept_ids), context.revision_id),
                )
            ).fetchall()
        return {
            UUID(str(row["id"])): {
                "concept_id": UUID(str(row["id"])),
                "concept_name": str(row["name"]),
                "topic_id": UUID(str(row["topic_id"])) if row["topic_id"] else None,
                "topic_title": str(row["topic_title"] or ""),
                "clip_id": UUID(str(row["clip_id"])) if row["clip_id"] else None,
                "clip_title": str(row["clip_title"] or ""),
                "clip_duration_seconds": (
                    float(row["end_seconds"]) - float(row["start_seconds"])
                    if row["clip_id"]
                    else 0.0
                ),
                "question_id": UUID(str(row["question_id"])) if row["question_id"] else None,
                "question_body": str(row["body"] or ""),
                "question_type": str(row["type"] or ""),
                "choices": _choices(row["correct_answer"]),
                "confidence_prompt": str(row["confidence_prompt"] or ""),
            }
            for row in rows
        }

    async def active_session(self, context: LearnerRevision) -> StudySession | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select * from learner_study_sessions
                    where learner_id = %s and course_id = %s and revision_id = %s
                      and status in ('planned', 'active', 'reflecting')
                    order by updated_at desc limit 1
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchone()
            if row is None:
                return None
            steps = await self._session_steps(conn, UUID(str(row["id"])), int(row["plan_version"]))
        return _session_from_row(row, steps)

    async def create_session(
        self,
        context: LearnerRevision,
        *,
        mode: str,
        idempotency_key: str,
        steps: tuple[dict[str, object], ...],
    ) -> StudySession:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            existing = await (
                await conn.execute(
                    """
                    select * from learner_study_sessions
                    where learner_id = %s and course_id = %s and revision_id = %s
                      and idempotency_key = %s
                    """,
                    (
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                        idempotency_key,
                    ),
                )
            ).fetchone()
            if existing is None:
                existing = await (
                    await conn.execute(
                        """
                        select * from learner_study_sessions
                        where learner_id = %s and course_id = %s and revision_id = %s
                          and status in ('planned', 'active', 'reflecting')
                        order by updated_at desc limit 1
                        """,
                        (context.learner_id, context.course_id, context.revision_id),
                    )
                ).fetchone()
            if existing is None:
                existing = await (
                    await conn.execute(
                        """
                        insert into learner_study_sessions (
                          learner_id, course_id, revision_id, status, mode,
                          idempotency_key
                        ) values (%s, %s, %s, 'planned', %s, %s)
                        returning *
                        """,
                        (
                            context.learner_id,
                            context.course_id,
                            context.revision_id,
                            mode,
                            idempotency_key,
                        ),
                    )
                ).fetchone()
                if existing is None:
                    raise RuntimeError("Failed to create study session.")
                await self._insert_steps(conn, UUID(str(existing["id"])), 1, steps)
            session_id = UUID(str(existing["id"]))
            version = int(existing["plan_version"])
            loaded_steps = await self._session_steps(conn, session_id, version)
        return _session_from_row(existing, loaded_steps)

    async def start_session(
        self,
        context: LearnerRevision,
        session_id: UUID,
    ) -> StudySession | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    update learner_study_sessions
                    set status = 'active', started_at = coalesce(started_at, now()),
                        updated_at = now()
                    where id = %s and learner_id = %s and course_id = %s
                      and revision_id = %s and status in ('planned', 'active')
                    returning *
                    """,
                    (
                        session_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
            if row is None:
                return None
            await conn.execute(
                """
                update learner_session_steps
                set status = 'active'
                where id = (
                  select id from learner_session_steps
                  where session_id = %s and plan_version = %s and status = 'pending'
                  order by ordinal limit 1
                )
                """,
                (session_id, int(row["plan_version"])),
            )
            steps = await self._session_steps(conn, session_id, int(row["plan_version"]))
        return _session_from_row(row, steps)

    async def replace_pending_steps(
        self,
        context: LearnerRevision,
        session_id: UUID,
        *,
        mode: str,
        steps: tuple[dict[str, object], ...],
        finish_requested: bool = False,
    ) -> StudySession | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select * from learner_study_sessions
                    where id = %s and learner_id = %s and course_id = %s
                      and revision_id = %s and status in ('planned', 'active')
                    for update
                    """,
                    (
                        session_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
            if row is None:
                return None
            await conn.execute(
                """
                update learner_session_steps set status = 'replaced'
                where session_id = %s and plan_version = %s
                  and status in ('pending', 'active')
                """,
                (session_id, int(row["plan_version"])),
            )
            next_version = int(row["plan_version"]) + 1
            await self._insert_steps(conn, session_id, next_version, steps)
            updated = await (
                await conn.execute(
                    """
                    update learner_study_sessions
                    set plan_version = %s, mode = %s,
                        finish_requested = finish_requested or %s,
                        updated_at = now()
                    where id = %s returning *
                    """,
                    (next_version, mode, finish_requested, session_id),
                )
            ).fetchone()
            if updated is None:
                return None
            await conn.execute(
                """
                update learner_session_steps set status = 'active'
                where id = (
                  select id from learner_session_steps
                  where session_id = %s and plan_version = %s and status = 'pending'
                  order by ordinal limit 1
                )
                """,
                (session_id, next_version),
            )
            loaded_steps = await self._session_steps(conn, session_id, next_version)
        return _session_from_row(updated, loaded_steps)

    async def session_step(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
    ) -> dict[str, object] | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select step.*, session.mode
                    from learner_session_steps step
                    join learner_study_sessions session on session.id = step.session_id
                    where step.id = %s and session.id = %s
                      and session.learner_id = %s and session.course_id = %s
                      and session.revision_id = %s
                      and step.plan_version = session.plan_version
                    """,
                    (
                        step_id,
                        session_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
        return dict(row) if row else None

    async def complete_step(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
        *,
        attempt_id: UUID | None = None,
        route_event_id: UUID | None = None,
    ) -> StudySession | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select session.* from learner_study_sessions session
                    join learner_session_steps step on step.session_id = session.id
                    where session.id = %s and step.id = %s
                      and session.learner_id = %s and session.course_id = %s
                      and session.revision_id = %s
                      and step.plan_version = session.plan_version
                    for update
                    """,
                    (
                        session_id,
                        step_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
            if row is None:
                return None
            await conn.execute(
                """
                update learner_session_steps
                set status = 'completed', attempt_id = coalesce(%s, attempt_id),
                    route_event_id = coalesce(%s, route_event_id), completed_at = now()
                where id = %s and status in ('pending', 'active')
                """,
                (attempt_id, route_event_id, step_id),
            )
            next_row = await (
                await conn.execute(
                    """
                    update learner_session_steps set status = 'active'
                    where id = (
                      select id from learner_session_steps
                      where session_id = %s and plan_version = %s and status = 'pending'
                      order by ordinal limit 1
                    )
                    returning id
                    """,
                    (session_id, int(row["plan_version"])),
                )
            ).fetchone()
            if next_row is None:
                updated = await (
                    await conn.execute(
                        """
                        update learner_study_sessions
                        set status = 'reflecting', updated_at = now()
                        where id = %s returning *
                        """,
                        (session_id,),
                    )
                ).fetchone()
            else:
                updated = await (
                    await conn.execute(
                        """
                        update learner_study_sessions
                        set updated_at = now()
                        where id = %s
                        returning *
                        """,
                        (session_id,),
                    )
                ).fetchone()
            if updated is None:
                return None
            steps = await self._session_steps(conn, session_id, int(updated["plan_version"]))
        return _session_from_row(updated, steps)

    async def record_reflection(
        self,
        context: LearnerRevision,
        session_id: UUID,
        *,
        self_report: str,
        note: str | None,
        concept_id: UUID | None,
    ) -> StudySession | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            session = await (
                await conn.execute(
                    """
                    select * from learner_study_sessions
                    where id = %s and learner_id = %s and course_id = %s
                      and revision_id = %s and status in ('active', 'reflecting')
                    for update
                    """,
                    (
                        session_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
            if session is None:
                return None
            await conn.execute(
                """
                insert into learner_reflections (
                  session_id, learner_id, course_id, revision_id,
                  concept_id, self_report, note
                ) values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (session_id) do update
                set self_report = excluded.self_report, note = excluded.note
                """,
                (
                    session_id,
                    context.learner_id,
                    context.course_id,
                    context.revision_id,
                    concept_id,
                    self_report,
                    note,
                ),
            )
            updated = await (
                await conn.execute(
                    """
                    update learner_study_sessions
                    set status = 'completed', completed_at = now(), updated_at = now()
                    where id = %s returning *
                    """,
                    (session_id,),
                )
            ).fetchone()
            if updated is None:
                return None
            steps = await self._session_steps(conn, session_id, int(updated["plan_version"]))
        return _session_from_row(updated, steps)

    async def create_placement(
        self,
        context: LearnerRevision,
        *,
        idempotency_key: str,
        policy_snapshot: dict[str, object],
        candidates: tuple[tuple[UUID, UUID], ...],
        unavailable_reason: str | None,
    ) -> PlacementCheck:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select * from learner_placement_checks
                    where learner_id = %s and course_id = %s and revision_id = %s
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchone()
            if row is None:
                status = "unavailable" if unavailable_reason else "in_progress"
                row = await (
                    await conn.execute(
                        """
                        insert into learner_placement_checks (
                          learner_id, course_id, revision_id, status,
                          idempotency_key, policy_snapshot, unavailable_reason
                        ) values (%s, %s, %s, %s, %s, %s::jsonb, %s)
                        returning *
                        """,
                        (
                            context.learner_id,
                            context.course_id,
                            context.revision_id,
                            status,
                            idempotency_key,
                            Jsonb(policy_snapshot),
                            unavailable_reason,
                        ),
                    )
                ).fetchone()
                if row is None:
                    raise RuntimeError("Failed to create placement check.")
                for ordinal, (concept_id, question_id) in enumerate(candidates):
                    await conn.execute(
                        """
                        insert into learner_placement_items (
                          placement_check_id, ordinal, concept_id, question_id
                        ) values (%s, %s, %s, %s)
                        """,
                        (row["id"], ordinal, concept_id, question_id),
                    )
            items = await self._placement_items(conn, UUID(str(row["id"])))
        return _placement_from_row(row, items)

    async def placement(self, context: LearnerRevision) -> PlacementCheck | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select * from learner_placement_checks
                    where learner_id = %s and course_id = %s and revision_id = %s
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchone()
            if row is None:
                return None
            items = await self._placement_items(conn, UUID(str(row["id"])))
        return _placement_from_row(row, items)

    async def placement_item(
        self,
        context: LearnerRevision,
        check_id: UUID,
        item_id: UUID,
    ) -> dict[str, object] | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select item.*, check.policy_snapshot
                    from learner_placement_items item
                    join learner_placement_checks check on check.id = item.placement_check_id
                    where item.id = %s and check.id = %s
                      and check.learner_id = %s and check.course_id = %s
                      and check.revision_id = %s and check.status = 'in_progress'
                    """,
                    (
                        item_id,
                        check_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
        return dict(row) if row else None

    async def record_placement_answer(
        self,
        context: LearnerRevision,
        check_id: UUID,
        item_id: UUID,
        *,
        answer: str,
        correctness: bool,
        confidence: int,
        wrong_answer_pattern: str | None,
        confidence_threshold: int,
        required_correct: int,
    ) -> PlacementCheck | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            item = await (
                await conn.execute(
                    """
                    select item.*, check.status as check_status
                    from learner_placement_items item
                    join learner_placement_checks check on check.id = item.placement_check_id
                    where item.id = %s and check.id = %s
                      and check.learner_id = %s and check.course_id = %s
                      and check.revision_id = %s
                    for update
                    """,
                    (
                        item_id,
                        check_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
            if item is None:
                return None
            if str(item["status"]) == "answered":
                check_row = await (
                    await conn.execute(
                        "select * from learner_placement_checks where id = %s",
                        (check_id,),
                    )
                ).fetchone()
                items = await self._placement_items(conn, check_id)
                return _placement_from_row(check_row, items) if check_row else None
            mastery_row = await (
                await conn.execute(
                    """
                    select state from learner_concept_mastery
                    where learner_id = %s and concept_id = %s
                    """,
                    (context.learner_id, item["concept_id"]),
                )
            ).fetchone()
            before = str(mastery_row["state"]) if mastery_row else "not_started"
            attempt_row = await (
                await conn.execute(
                    """
                    insert into attempts (
                      learner_id, question_id, answer, correctness, confidence, purpose
                    ) values (%s, %s, %s::jsonb, %s, %s, 'placement')
                    returning id
                    """,
                    (
                        context.learner_id,
                        item["question_id"],
                        Jsonb({"answer": answer, "wrong_answer_pattern": wrong_answer_pattern}),
                        correctness,
                        confidence,
                    ),
                )
            ).fetchone()
            if attempt_row is None:
                raise RuntimeError("Failed to record placement attempt.")
            attempt_id = UUID(str(attempt_row["id"]))
            previous_passes = await (
                await conn.execute(
                    """
                    select count(*)
                    from learner_placement_items pi
                    join attempts a on a.id = pi.attempt_id
                    where pi.placement_check_id = %s
                      and pi.concept_id = %s
                      and a.correctness and a.confidence >= %s
                    """,
                    (check_id, item["concept_id"], confidence_threshold),
                )
            ).fetchone()
            passed = int(previous_passes[0] if previous_passes else 0)
            if correctness and confidence >= confidence_threshold:
                passed += 1
            if before == "mastered":
                after = "mastered"
            elif correctness and confidence >= confidence_threshold and passed >= required_correct:
                after = "mastered"
            elif correctness:
                after = "practiced"
            else:
                after = before
            outcome = (
                "mastered"
                if after == "mastered" and before != "mastered"
                else ("practiced" if after == "practiced" else "retained")
            )
            if after != before:
                await conn.execute(
                    """
                    insert into learner_concept_mastery (learner_id, concept_id, state)
                    values (%s, %s, %s)
                    on conflict (learner_id, concept_id) do update
                    set state = excluded.state, updated_at = now()
                    """,
                    (context.learner_id, item["concept_id"], after),
                )
            await conn.execute(
                """
                insert into learner_route_events (
                  course_id, revision_id, learner_id, attempt_id, concept_id,
                  mastery_before, mastery_after, action, target_concept_id,
                  why, evidence_snapshot
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    context.course_id,
                    context.revision_id,
                    context.learner_id,
                    attempt_id,
                    item["concept_id"],
                    before,
                    after,
                    "placement_skip" if outcome == "mastered" else "placement_retain",
                    item["concept_id"],
                    (
                        "Reviewed placement evidence met the instructor-set mastery policy."
                        if outcome == "mastered"
                        else (
                            "This concept remains in your path because placement "
                            "evidence did not meet the mastery policy."
                        )
                    ),
                    Jsonb(
                        {
                            "purpose": "placement",
                            "correctness": correctness,
                            "confidence": confidence,
                            "confidence_threshold": confidence_threshold,
                            "required_correct": required_correct,
                        }
                    ),
                ),
            )
            await conn.execute(
                """
                update learner_placement_items
                set status = 'answered', outcome = %s, attempt_id = %s, answered_at = now()
                where id = %s
                """,
                (outcome, attempt_id, item_id),
            )
            pending = await (
                await conn.execute(
                    """
                    select 1 from learner_placement_items
                    where placement_check_id = %s and status = 'pending' limit 1
                    """,
                    (check_id,),
                )
            ).fetchone()
            if pending is None:
                await conn.execute(
                    """
                    update learner_placement_checks
                    set status = 'completed', completed_at = now(), updated_at = now()
                    where id = %s
                    """,
                    (check_id,),
                )
            check_row = await (
                await conn.execute(
                    "select * from learner_placement_checks where id = %s",
                    (check_id,),
                )
            ).fetchone()
            items = await self._placement_items(conn, check_id)
        return _placement_from_row(check_row, items) if check_row else None

    async def schedule_review(
        self,
        context: LearnerRevision,
        concept_id: UUID,
        *,
        correctness: bool,
        confidence: int,
        confidence_threshold: int,
        purpose: str,
        attempt_id: UUID | None,
    ) -> None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            existing = await (
                await conn.execute(
                    """
                    select stage from learner_review_schedules
                    where learner_id = %s and revision_id = %s and concept_id = %s
                    """,
                    (context.learner_id, context.revision_id, concept_id),
                )
            ).fetchone()
            stage = int(existing["stage"]) if existing else 0
            if not correctness:
                next_stage, days = 0, 1
            elif confidence < confidence_threshold:
                next_stage, days = 0, 3
            elif purpose == "review":
                next_stage = min(2, stage + 1)
                days = (7, 21, 60)[next_stage]
            else:
                next_stage, days = 0, 7
            await conn.execute(
                """
                insert into learner_review_schedules (
                  learner_id, course_id, revision_id, concept_id,
                  stage, interval_days, due_at, last_attempt_id
                ) values (%s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (learner_id, revision_id, concept_id) do update
                set stage = excluded.stage, interval_days = excluded.interval_days,
                    due_at = excluded.due_at, last_attempt_id = excluded.last_attempt_id,
                    updated_at = now()
                """,
                (
                    context.learner_id,
                    context.course_id,
                    context.revision_id,
                    concept_id,
                    next_stage,
                    days,
                    datetime.now(UTC) + timedelta(days=days),
                    attempt_id,
                ),
            )

    async def mastery_review(
        self,
        context: LearnerRevision,
        path_rows: tuple[dict[str, object], ...],
    ) -> MasteryReview:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            schedule_rows = await (
                await conn.execute(
                    """
                    select concept_id, due_at from learner_review_schedules
                    where learner_id = %s and course_id = %s and revision_id = %s
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchall()
            mismatch_rows = await (
                await conn.execute(
                    """
                    select distinct on (qc.concept_id)
                           qc.concept_id, a.correctness, a.confidence,
                           coalesce((rp.policy->>'confidence_threshold')::int, 3) threshold
                    from attempts a
                    join question_concepts qc on qc.question_id = a.question_id and qc.is_primary
                    left join routing_policies rp
                      on rp.course_id = %s and rp.revision_id = %s
                     and (rp.concept_id = qc.concept_id or rp.concept_id is null)
                    where a.learner_id = %s and qc.revision_id = %s
                    order by qc.concept_id, a.created_at desc, rp.concept_id nulls last
                    """,
                    (
                        context.course_id,
                        context.revision_id,
                        context.learner_id,
                        context.revision_id,
                    ),
                )
            ).fetchall()
            route_rows = await (
                await conn.execute(
                    """
                    select action, why, created_at
                    from learner_route_events
                    where learner_id = %s and course_id = %s and revision_id = %s
                    order by created_at desc limit 8
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchall()
        schedules = {UUID(str(row["concept_id"])): row["due_at"] for row in schedule_rows}
        mismatches: dict[UUID, str] = {}
        for row in mismatch_rows:
            concept_id = UUID(str(row["concept_id"]))
            if not bool(row["correctness"]) and int(row["confidence"]) >= int(row["threshold"]):
                mismatches[concept_id] = "Confident answer needs review"
            elif bool(row["correctness"]) and int(row["confidence"]) < int(row["threshold"]):
                mismatches[concept_id] = "Correct answer, confidence still growing"
        concepts = tuple(
            ReviewConcept(
                concept_id=UUID(str(row["concept_id"])),
                name=str(row["name"]),
                state=str(row["state"]),
                access_state=(
                    "ready"
                    if row["eligible"] and row["actionable"]
                    else "blocked"
                    if not row["eligible"]
                    else "content_unavailable"
                ),
                coverage_state=str(row["coverage_state"]),
                due_at=schedules.get(UUID(str(row["concept_id"]))),
                mismatch=mismatches.get(UUID(str(row["concept_id"]))),
            )
            for row in path_rows
        )
        return MasteryReview(
            concepts=concepts,
            recent_routes=tuple(
                RouteHistoryItem(
                    action=str(row["action"]),
                    explanation=str(row["why"]),
                    created_at=row["created_at"],
                )
                for row in route_rows
            ),
        )

    async def clip_transcript(
        self,
        context: LearnerRevision,
        clip_id: UUID,
    ) -> ClipTranscript | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select clip.id, clip.start_seconds, clip.end_seconds, video.transcript
                    from clips clip
                    join topics topic on topic.id = clip.topic_id
                    join videos video on video.id = topic.video_id
                    where clip.id = %s and clip.revision_id = %s
                      and topic.course_id = %s and clip.status = 'active'
                      and topic.review_status in ('accepted', 'edited')
                    """,
                    (clip_id, context.revision_id, context.course_id),
                )
            ).fetchone()
        if row is None:
            return None
        start = float(row["start_seconds"])
        end = float(row["end_seconds"])
        transcript = row["transcript"] if isinstance(row["transcript"], dict) else {}
        raw_words = transcript.get("words", []) if isinstance(transcript, dict) else []
        words: list[ClipTranscriptWord] = []
        previous_start = 0.0
        for raw in raw_words if isinstance(raw_words, list) else []:
            if not isinstance(raw, dict):
                continue
            try:
                word_start = float(raw["start_seconds"])
                word_end = float(raw["end_seconds"])
            except (KeyError, TypeError, ValueError):
                continue
            if word_end <= start or word_start >= end:
                continue
            relative_start = max(previous_start, max(0.0, word_start - start))
            relative_end = min(end - start, max(relative_start + 0.08, word_end - start))
            text = str(raw.get("text", "")).strip()
            if not text:
                continue
            words.append(ClipTranscriptWord(text, relative_start, relative_end))
            previous_start = relative_start
        return ClipTranscript(
            clip_id=clip_id,
            duration_seconds=max(0.0, end - start),
            timing_basis="clip_relative",
            words=tuple(words),
        )

    async def next_hint(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
    ) -> str | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select step.hint_level, ladder.hints
                    from learner_session_steps step
                    join learner_study_sessions session on session.id = step.session_id
                    join question_hint_ladders ladder on ladder.question_id = step.question_id
                    where step.id = %s and session.id = %s
                      and session.learner_id = %s and session.course_id = %s
                      and session.revision_id = %s
                      and ladder.revision_id = session.revision_id
                      and ladder.review_status in ('accepted', 'edited')
                    for update of step
                    """,
                    (
                        step_id,
                        session_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
            if row is None or not isinstance(row["hints"], list):
                return None
            level = int(row["hint_level"])
            if level >= len(row["hints"]):
                return None
            hint = str(row["hints"][level]).strip()
            if not hint:
                return None
            await conn.execute(
                "update learner_session_steps set hint_level = hint_level + 1 where id = %s",
                (step_id,),
            )
        return hint

    async def has_approved_hint(
        self,
        context: LearnerRevision,
        session_id: UUID,
        step_id: UUID,
    ) -> bool:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select 1
                    from learner_session_steps step
                    join learner_study_sessions session on session.id = step.session_id
                    join question_hint_ladders ladder on ladder.question_id = step.question_id
                    where step.id = %s and session.id = %s
                      and session.learner_id = %s and session.course_id = %s
                      and session.revision_id = %s
                      and ladder.revision_id = session.revision_id
                      and ladder.review_status in ('accepted', 'edited')
                      and jsonb_array_length(ladder.hints) > step.hint_level
                    """,
                    (
                        step_id,
                        session_id,
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchone()
        return row is not None

    async def instructor_hint_ladder(
        self,
        instructor_id: UUID,
        question_id: UUID,
    ) -> dict[str, object] | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select ladder.*
                    from question_hint_ladders ladder
                    join questions question on question.id = ladder.question_id
                    join course_revisions revision on revision.id = question.revision_id
                    join courses course on course.id = revision.course_id
                    where question.id = %s and course.instructor_id = %s
                    """,
                    (question_id, instructor_id),
                )
            ).fetchone()
        if row is None:
            return None
        return {
            "id": UUID(str(row["id"])),
            "question_id": UUID(str(row["question_id"])),
            "hints": tuple(str(value) for value in row["hints"]),
            "review_status": str(row["review_status"]),
            "ai_proposal": (
                dict(row["ai_proposal"]) if isinstance(row["ai_proposal"], dict) else None
            ),
            "instructor_revision": (
                dict(row["instructor_revision"])
                if isinstance(row["instructor_revision"], dict)
                else None
            ),
        }

    async def review_hint_ladder(
        self,
        instructor_id: UUID,
        question_id: UUID,
        *,
        status: str,
        hints: tuple[str, ...] | None = None,
    ) -> dict[str, object] | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    update question_hint_ladders ladder
                    set review_status = %s,
                        hints = coalesce(%s::jsonb, ladder.hints),
                        instructor_revision = case
                          when %s = 'edited'
                          then jsonb_build_object('hints', coalesce(%s::jsonb, ladder.hints))
                          else ladder.instructor_revision
                        end,
                        approved_at = case
                          when %s in ('accepted', 'edited') then now()
                          else ladder.approved_at
                        end,
                        dismissed_at = case when %s = 'dismissed' then now() else null end,
                        updated_at = now()
                    from questions question
                    join course_revisions revision on revision.id = question.revision_id
                    join courses course on course.id = revision.course_id
                    where ladder.question_id = question.id and question.id = %s
                      and course.instructor_id = %s
                    returning ladder.*
                    """,
                    (
                        status,
                        Jsonb(list(hints)) if hints is not None else None,
                        status,
                        Jsonb(list(hints)) if hints is not None else None,
                        status,
                        status,
                        question_id,
                        instructor_id,
                    ),
                )
            ).fetchone()
        if row is None:
            return None
        return await self.instructor_hint_ladder(instructor_id, question_id)

    async def help_preview(
        self,
        context: LearnerRevision,
        *,
        session_id: UUID | None,
        concept_id: UUID | None,
    ) -> dict[str, object]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            course = await (
                await conn.execute(
                    "select title from courses where id = %s",
                    (context.course_id,),
                )
            ).fetchone()
            concept = None
            if concept_id:
                concept = await (
                    await conn.execute(
                        """
                        select c.name, t.title as topic_title
                        from concepts c
                        left join topic_concepts tc on tc.concept_id = c.id
                        left join topics t on t.id = tc.topic_id
                        where c.id = %s and c.revision_id = %s
                        order by t.start_seconds nulls last limit 1
                        """,
                        (concept_id, context.revision_id),
                    )
                ).fetchone()
            attempts = await (
                await conn.execute(
                    """
                    select q.body, a.correctness, a.confidence, a.created_at
                    from attempts a join questions q on q.id = a.question_id
                    where a.learner_id = %s and q.revision_id = %s
                    order by a.created_at desc limit 3
                    """,
                    (context.learner_id, context.revision_id),
                )
            ).fetchall()
            routes = await (
                await conn.execute(
                    """
                    select action, why, created_at
                    from learner_route_events
                    where learner_id = %s and course_id = %s and revision_id = %s
                    order by created_at desc limit 3
                    """,
                    (context.learner_id, context.course_id, context.revision_id),
                )
            ).fetchall()
            artifact = None
            if session_id:
                artifact = await (
                    await conn.execute(
                        """
                        select coalesce(
                          q.body, clip.ai_proposal->>'title', topic.title
                        ) as title, step.kind
                        from learner_study_sessions session
                        join learner_session_steps step on step.session_id = session.id
                        left join questions q on q.id = step.question_id
                        left join clips clip on clip.id = step.clip_id
                        left join topics topic on topic.id = clip.topic_id
                        where session.id = %s and session.learner_id = %s
                          and step.plan_version = session.plan_version
                          and step.status = 'active'
                        limit 1
                        """,
                        (session_id, context.learner_id),
                    )
                ).fetchone()
        return {
            "course": str(course["title"]) if course else "Course",
            "concept": str(concept["name"]) if concept else None,
            "topic": str(concept["topic_title"]) if concept and concept["topic_title"] else None,
            "current_activity": (
                {"kind": str(artifact["kind"]), "title": str(artifact["title"])}
                if artifact
                else None
            ),
            "recent_attempts": [
                {
                    "question": str(row["body"]),
                    "correct": bool(row["correctness"]),
                    "confidence": int(row["confidence"]),
                    "when": row["created_at"].isoformat(),
                }
                for row in attempts
            ],
            "recent_routes": [
                {
                    "action": str(row["action"]),
                    "reason": str(row["why"]),
                    "when": row["created_at"].isoformat(),
                }
                for row in routes
            ],
        }

    async def create_help_request(
        self,
        context: LearnerRevision,
        *,
        session_id: UUID | None,
        concept_id: UUID | None,
        topic_id: UUID | None,
        learner_note: str | None,
        evidence: dict[str, object],
    ) -> HelpRequest:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into learner_help_requests (
                      learner_id, course_id, revision_id, session_id,
                      concept_id, topic_id, learner_note, evidence_snapshot
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    returning *
                    """,
                    (
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                        session_id,
                        concept_id,
                        topic_id,
                        learner_note,
                        Jsonb(evidence),
                    ),
                )
            ).fetchone()
            if row is not None:
                await conn.execute(
                    """
                    insert into dashboard_signals (
                      course_id, type, related_entity_type,
                      related_entity_id, ai_diagnosis
                    ) values (
                      %s, 'stuck_cohort', 'learner_help_request', %s, %s::jsonb
                    )
                    """,
                    (
                        context.course_id,
                        row["id"],
                        Jsonb(
                            {
                                "reason": (
                                    "A learner explicitly requested help during "
                                    "an active reviewed study session."
                                ),
                                "learner_id": str(context.learner_id),
                                "learner_note": learner_note,
                                "evidence": evidence,
                                "recommended_action": (
                                    "Review the learner's evidence and acknowledge "
                                    "or resolve the help request."
                                ),
                            }
                        ),
                    ),
                )
        if row is None:
            raise RuntimeError("Failed to create learner help request.")
        return _help_from_row(row)

    async def instructor_help_requests(
        self,
        instructor_id: UUID,
        course_id: UUID,
    ) -> tuple[HelpRequest, ...] | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            owner = await (
                await conn.execute(
                    """
                    select 1 from courses c join users u on u.id = c.instructor_id
                    where c.id = %s and c.instructor_id = %s and u.role = 'instructor'
                    """,
                    (course_id, instructor_id),
                )
            ).fetchone()
            if owner is None:
                return None
            rows = await (
                await conn.execute(
                    """
                    select * from learner_help_requests
                    where course_id = %s
                    order by case status when 'open' then 0 when 'acknowledged' then 1 else 2 end,
                             created_at desc
                    """,
                    (course_id,),
                )
            ).fetchall()
        return tuple(_help_from_row(row) for row in rows)

    async def update_help_request(
        self,
        instructor_id: UUID,
        course_id: UUID,
        request_id: UUID,
        status: str,
    ) -> HelpRequest | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    update learner_help_requests request
                    set status = %s, updated_at = now(),
                        resolved_at = case when %s = 'resolved' then now() else null end
                    from courses course
                    where request.id = %s and request.course_id = %s
                      and course.id = request.course_id and course.instructor_id = %s
                    returning request.*
                    """,
                    (status, status, request_id, course_id, instructor_id),
                )
            ).fetchone()
            if row is not None:
                await conn.execute(
                    """
                    update dashboard_signals
                    set status = 'accepted',
                        instructor_action = %s::jsonb,
                        resolved_at = now()
                    where related_entity_type = 'learner_help_request'
                      and related_entity_id = %s and status = 'open'
                    """,
                    (
                        Jsonb({"action": status, "source": "learner_help_request"}),
                        request_id,
                    ),
                )
        return _help_from_row(row) if row else None

    async def guide_messages(
        self,
        context: LearnerRevision,
    ) -> tuple[LearningGuideMessage, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select id, role, content, intent, action, created_at
                    from learner_guide_messages
                    where learner_id = %s and course_id = %s and revision_id = %s
                    order by created_at, id
                    """,
                    (
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                    ),
                )
            ).fetchall()
        return tuple(_guide_message_from_row(row) for row in rows)

    async def append_guide_exchange(
        self,
        context: LearnerRevision,
        *,
        learner_content: str,
        guide_content: str,
        intent: str,
        action: str | None,
        evidence: dict[str, object],
    ) -> tuple[LearningGuideMessage, LearningGuideMessage]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            learner_row = await (
                await conn.execute(
                    """
                    insert into learner_guide_messages (
                      learner_id, course_id, revision_id, role, content
                    ) values (%s, %s, %s, 'learner', %s)
                    returning id, role, content, intent, action, created_at
                    """,
                    (
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                        learner_content,
                    ),
                )
            ).fetchone()
            guide_row = await (
                await conn.execute(
                    """
                    insert into learner_guide_messages (
                      learner_id, course_id, revision_id, role, content,
                      intent, action, evidence_snapshot
                    ) values (%s, %s, %s, 'guide', %s, %s, %s, %s::jsonb)
                    returning id, role, content, intent, action, created_at
                    """,
                    (
                        context.learner_id,
                        context.course_id,
                        context.revision_id,
                        guide_content,
                        intent,
                        action,
                        Jsonb(evidence),
                    ),
                )
            ).fetchone()
        if learner_row is None or guide_row is None:
            raise RuntimeError("Failed to persist the Learning Guide conversation.")
        return (
            _guide_message_from_row(learner_row),
            _guide_message_from_row(guide_row),
        )

    async def _insert_steps(
        self,
        conn: Any,
        session_id: UUID,
        plan_version: int,
        steps: tuple[dict[str, object], ...],
    ) -> None:
        for ordinal, step in enumerate(steps):
            await conn.execute(
                """
                insert into learner_session_steps (
                  session_id, plan_version, ordinal, kind, purpose,
                  concept_id, clip_id, question_id, source_id,
                  reason_code, evidence_snapshot
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    session_id,
                    plan_version,
                    ordinal,
                    step["kind"],
                    step["purpose"],
                    step.get("concept_id"),
                    step.get("clip_id"),
                    step.get("question_id"),
                    step.get("source_id"),
                    step["reason_code"],
                    Jsonb(step.get("evidence_snapshot", {})),
                ),
            )

    async def _session_steps(
        self,
        conn: Any,
        session_id: UUID,
        plan_version: int,
    ) -> tuple[SessionStep, ...]:
        rows = await (
            await conn.execute(
                """
                select step.*, concept.name as concept_name,
                       coalesce(question.body, clip.ai_proposal->>'title',
                                topic.title, source.filename,
                                case when step.kind = 'reflect'
                                  then 'Reflect on this session'
                                  else 'Learning activity'
                                end) as title
                from learner_session_steps step
                left join concepts concept on concept.id = step.concept_id
                left join questions question on question.id = step.question_id
                left join clips clip on clip.id = step.clip_id
                left join topics topic on topic.id = clip.topic_id
                left join course_sources source on source.id = step.source_id
                where step.session_id = %s and step.plan_version = %s
                order by step.ordinal
                """,
                (session_id, plan_version),
            )
        ).fetchall()
        return tuple(
            SessionStep(
                id=UUID(str(row["id"])),
                ordinal=int(row["ordinal"]),
                kind=str(row["kind"]),
                purpose=str(row["purpose"]),
                concept_id=UUID(str(row["concept_id"])) if row["concept_id"] else None,
                concept_name=str(row["concept_name"]) if row["concept_name"] else None,
                clip_id=UUID(str(row["clip_id"])) if row["clip_id"] else None,
                question_id=UUID(str(row["question_id"])) if row["question_id"] else None,
                source_id=UUID(str(row["source_id"])) if row["source_id"] else None,
                title=str(row["title"]),
                reason_code=str(row["reason_code"]),
                reason=_reason(str(row["reason_code"]), str(row["concept_name"] or "")),
                status=str(row["status"]),
            )
            for row in rows
        )

    async def _placement_items(
        self,
        conn: Any,
        check_id: UUID,
    ) -> tuple[PlacementItem, ...]:
        rows = await (
            await conn.execute(
                """
                select item.*, concept.name as concept_name, question.body,
                       question.correct_answer, question.confidence_prompt
                from learner_placement_items item
                join concepts concept on concept.id = item.concept_id
                join questions question on question.id = item.question_id
                where item.placement_check_id = %s
                order by item.ordinal
                """,
                (check_id,),
            )
        ).fetchall()
        return tuple(
            PlacementItem(
                id=UUID(str(row["id"])),
                ordinal=int(row["ordinal"]),
                concept_id=UUID(str(row["concept_id"])),
                concept_name=str(row["concept_name"]),
                question_id=UUID(str(row["question_id"])),
                question_body=str(row["body"]),
                choices=_choices(row["correct_answer"]),
                confidence_prompt=str(row["confidence_prompt"]),
                status=str(row["status"]),
                outcome=str(row["outcome"]) if row["outcome"] else None,
            )
            for row in rows
        )


def _choices(value: object) -> tuple[str, ...]:
    if not isinstance(value, dict):
        return ()
    choices = value.get("choices", [])
    return tuple(str(choice) for choice in choices) if isinstance(choices, list) else ()


def _session_from_row(row: dict[str, Any], steps: tuple[SessionStep, ...]) -> StudySession:
    return StudySession(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        revision_id=UUID(str(row["revision_id"])),
        status=str(row["status"]),
        mode=str(row["mode"]),
        finish_requested=bool(row["finish_requested"]),
        plan_version=int(row["plan_version"]),
        steps=steps,
    )


def _placement_from_row(
    row: dict[str, Any],
    items: tuple[PlacementItem, ...],
) -> PlacementCheck:
    return PlacementCheck(
        id=UUID(str(row["id"])),
        status=str(row["status"]),
        unavailable_reason=(str(row["unavailable_reason"]) if row["unavailable_reason"] else None),
        items=items,
    )


def _help_from_row(row: dict[str, Any]) -> HelpRequest:
    evidence = row["evidence_snapshot"]
    return HelpRequest(
        id=UUID(str(row["id"])),
        status=str(row["status"]),
        learner_note=str(row["learner_note"]) if row["learner_note"] else None,
        evidence=dict(evidence) if isinstance(evidence, dict) else {},
        created_at=row["created_at"],
    )


def _guide_message_from_row(row: dict[str, Any]) -> LearningGuideMessage:
    return LearningGuideMessage(
        id=UUID(str(row["id"])),
        role=str(row["role"]),
        content=str(row["content"]),
        intent=str(row["intent"]) if row["intent"] else None,
        action=str(row["action"]) if row["action"] else None,
        created_at=row["created_at"],
    )


def _reason(code: str, concept_name: str) -> str:
    return {
        "recommended_current": f"Continue with {concept_name}, your strongest reviewed next step.",
        "learn_new": f"Learn {concept_name}, an eligible concept you have not started.",
        "strengthen_weak_area": (
            f"Strengthen {concept_name} because your evidence still shows uncertainty."
        ),
        "repair_prerequisite": f"Repair the reviewed foundation for {concept_name}.",
        "reinforce_confidence": f"Reinforce {concept_name} before advancing.",
        "due_review": f"Review {concept_name} because its evidence is due for retrieval.",
        "review_retrieval": (
            f"Retrieve {concept_name} from memory before reopening the explanation."
        ),
        "practice_after_watch": (
            f"Check your understanding of {concept_name} with an approved question."
        ),
        "session_reflection": "Capture what feels clear and what still needs support.",
    }.get(code, "This reviewed activity follows your current course evidence.")
