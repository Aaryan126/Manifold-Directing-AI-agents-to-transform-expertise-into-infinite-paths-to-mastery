from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.dashboard.models import (
    ActivityPoint,
    ClipSignalStats,
    ConceptSignalStats,
    DashboardAction,
    DashboardSignal,
    DashboardSignalProposal,
    DashboardSignalStatus,
    DashboardSignalType,
    LearnerOverride,
    MasteryDistribution,
    QuestionSignalStats,
)
from app.dashboard.repository import DashboardRepository
from app.db.pool import pooled_connection


class PostgresDashboardRepository(DashboardRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def seed_demo_insights(self, course_id: UUID) -> None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            demo_video = await (
                await conn.execute(
                    """
                    select id, source_metadata
                    from videos
                    where course_id = %s
                      and source_metadata ->> 'demo_fixture' = 'manifold-default'
                    order by created_at
                    limit 1
                    for update
                    """,
                    (course_id,),
                )
            ).fetchone()
            if demo_video is None:
                return
            metadata = (
                demo_video["source_metadata"]
                if isinstance(demo_video["source_metadata"], dict)
                else {}
            )
            if metadata.get("insights_fixture_seeded") is True:
                return

            learners = await (
                await conn.execute(
                    """
                    select learner_id
                    from enrollments
                    where course_id = %s
                    order by learner_id
                    limit 2
                    """,
                    (course_id,),
                )
            ).fetchall()
            concept = await (
                await conn.execute(
                    """
                    select c.id
                    from concepts c
                    join topic_concepts tc on tc.concept_id = c.id
                    join questions q on q.topic_id = tc.topic_id
                      and q.review_status in ('accepted', 'edited')
                    join attempts a on a.question_id = q.id
                    where c.course_id = %s
                      and c.review_status in ('accepted', 'edited')
                    group by c.id
                    having count(distinct a.learner_id) >= 2
                    order by count(distinct a.learner_id) desc, c.name
                    limit 1
                    """,
                    (course_id,),
                )
            ).fetchone()
            if len(learners) < 2 or concept is None:
                return

            cursor = conn.cursor()
            await cursor.executemany(
                """
                insert into learner_concept_mastery (learner_id, concept_id, state)
                values (%s, %s, 'struggling')
                on conflict (learner_id, concept_id) do update
                set state = excluded.state,
                    updated_at = now()
                """,
                [(learner["learner_id"], concept["id"]) for learner in learners],
            )
            await conn.execute(
                """
                update videos
                set source_metadata = source_metadata || %s::jsonb
                where id = %s
                """,
                (Jsonb({"insights_fixture_seeded": True}), demo_video["id"]),
            )

    async def learner_count(self, course_id: UUID) -> int:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    "select count(*) from enrollments where course_id = %s",
                    (course_id,),
                )
            ).fetchone()
            return int(row[0] or 0) if row else 0

    async def attempt_count(self, course_id: UUID) -> int:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    select count(*)
                    from attempts a
                    join questions q on q.id = a.question_id
                    join topics t on t.id = q.topic_id
                    where t.course_id = %s
                    """,
                    (course_id,),
                )
            ).fetchone()
            return int(row[0] or 0) if row else 0

    async def concept_stats(self, course_id: UUID) -> tuple[ConceptSignalStats, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    with touched as (
                      select tc.concept_id, count(distinct a.learner_id) as learner_count
                      from topic_concepts tc
                      join topics t on t.id = tc.topic_id
                      join questions q on q.topic_id = t.id
                        and q.review_status in ('accepted', 'edited')
                      join attempts a on a.question_id = q.id
                      where t.course_id = %s
                      group by tc.concept_id
                    ), mastery as (
                      select
                        m.concept_id,
                        count(*) filter (where m.state = 'struggling') as struggling_count
                      from learner_concept_mastery m
                      join concepts mc on mc.id = m.concept_id
                      where mc.course_id = %s
                      group by m.concept_id
                    ), prereq_ready as (
                      select m.concept_id, count(*) as learner_count
                      from learner_concept_mastery m
                      join concepts mc on mc.id = m.concept_id
                      where mc.course_id = %s
                        and m.state = 'struggling'
                        and exists (
                          select 1 from concept_edges e
                          where e.to_concept_id = m.concept_id
                            and e.review_status in ('accepted', 'edited')
                        )
                        and not exists (
                          select 1
                          from concept_edges e
                          where e.to_concept_id = m.concept_id
                            and e.review_status in ('accepted', 'edited')
                            and not exists (
                              select 1
                              from learner_concept_mastery pm
                              where pm.learner_id = m.learner_id
                                and pm.concept_id = e.from_concept_id
                                and pm.state = 'mastered'
                            )
                        )
                      group by m.concept_id
                    )
                    select
                      c.id,
                      c.name,
                      coalesce(touched.learner_count, 0) as touched_learners,
                      coalesce(mastery.struggling_count, 0) as struggling_learners,
                      coalesce(prereq_ready.learner_count, 0)
                        as mastered_prerequisite_struggling_learners
                    from concepts c
                    left join touched on touched.concept_id = c.id
                    left join mastery on mastery.concept_id = c.id
                    left join prereq_ready on prereq_ready.concept_id = c.id
                    where c.course_id = %s
                      and c.review_status in ('accepted', 'edited')
                    order by c.name
                    """,
                    (course_id, course_id, course_id, course_id),
                )
            ).fetchall()
            return tuple(
                ConceptSignalStats(
                    concept_id=UUID(str(row["id"])),
                    concept_name=str(row["name"]),
                    touched_learners=int(row["touched_learners"] or 0),
                    struggling_learners=int(row["struggling_learners"] or 0),
                    mastered_prerequisite_struggling_learners=int(
                        row["mastered_prerequisite_struggling_learners"] or 0,
                    ),
                )
                for row in rows
            )

    async def question_stats(self, course_id: UUID) -> tuple[QuestionSignalStats, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select
                      q.id,
                      q.topic_id,
                      q.body,
                      count(a.id) as attempts,
                      count(a.id) filter (where not a.correctness) as incorrect_attempts,
                      count(a.id) filter (where a.correctness and a.confidence < 3)
                        as low_confidence_correct_attempts
                    from questions q
                    join topics t on t.id = q.topic_id
                    left join attempts a on a.question_id = q.id
                    where t.course_id = %s
                      and q.review_status in ('accepted', 'edited')
                      and t.review_status in ('accepted', 'edited')
                    group by q.id, q.topic_id, q.body
                    order by q.created_at
                    """,
                    (course_id,),
                )
            ).fetchall()
            return tuple(
                QuestionSignalStats(
                    question_id=UUID(str(row["id"])),
                    topic_id=UUID(str(row["topic_id"])),
                    prompt=str(row["body"]),
                    attempts=int(row["attempts"] or 0),
                    incorrect_attempts=int(row["incorrect_attempts"] or 0),
                    low_confidence_correct_attempts=int(
                        row["low_confidence_correct_attempts"] or 0,
                    ),
                )
                for row in rows
            )

    async def clip_stats(self, course_id: UUID) -> tuple[ClipSignalStats, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    with struggling as (
                      select concept_id, count(*) as learner_count
                      from learner_concept_mastery
                      where state = 'struggling'
                      group by concept_id
                    ), remediation as (
                      select
                        clip.id as clip_id,
                        count(distinct a.id) as attempt_count
                      from clips clip
                      join clip_concepts cc on cc.clip_id = clip.id
                      join remediation_rules rr
                        on rr.target_clip_id = clip.id
                        or rr.target_concept_id = cc.concept_id
                      join attempts a on a.question_id = rr.question_id
                      where not a.correctness
                      group by clip.id
                    )
                    select
                      clip.id,
                      clip.topic_id,
                      cc.concept_id,
                      coalesce(remediation.attempt_count, 0) as remediation_attempts,
                      coalesce(struggling.learner_count, 0) as struggling_learners
                    from clips clip
                    join topics t on t.id = clip.topic_id
                    join lateral (
                      select linked.concept_id
                      from clip_concepts linked
                      join concepts c on c.id = linked.concept_id
                      where linked.clip_id = clip.id
                        and c.review_status in ('accepted', 'edited')
                      order by linked.concept_id
                      limit 1
                    ) cc on true
                    left join struggling on struggling.concept_id = cc.concept_id
                    left join remediation on remediation.clip_id = clip.id
                    where t.course_id = %s
                      and clip.status = 'active'
                    order by clip.start_seconds
                    """,
                    (course_id,),
                )
            ).fetchall()
            return tuple(
                ClipSignalStats(
                    clip_id=UUID(str(row["id"])),
                    topic_id=UUID(str(row["topic_id"])),
                    concept_id=UUID(str(row["concept_id"])),
                    remediation_attempts=int(row["remediation_attempts"] or 0),
                    struggling_learners=int(row["struggling_learners"] or 0),
                )
                for row in rows
            )

    async def activity_history(self, course_id: UUID) -> tuple[ActivityPoint, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    with days as (
                      select generate_series(
                        (now() at time zone 'UTC')::date - interval '13 days',
                        (now() at time zone 'UTC')::date,
                        interval '1 day'
                      )::date as activity_date
                    ), daily_attempts as (
                      select
                        (a.created_at at time zone 'UTC')::date as activity_date,
                        count(*) as attempts,
                        count(distinct a.learner_id) as active_learners
                      from attempts a
                      join questions q on q.id = a.question_id
                      join topics t on t.id = q.topic_id
                      where t.course_id = %s
                        and a.created_at >= (now() at time zone 'UTC')::date - interval '13 days'
                      group by (a.created_at at time zone 'UTC')::date
                    )
                    select
                      days.activity_date,
                      coalesce(daily_attempts.attempts, 0) as attempts,
                      coalesce(daily_attempts.active_learners, 0) as active_learners
                    from days
                    left join daily_attempts using (activity_date)
                    order by days.activity_date
                    """,
                    (course_id,),
                )
            ).fetchall()
            return tuple(
                ActivityPoint(
                    date=row["activity_date"].isoformat(),
                    attempts=int(row["attempts"] or 0),
                    active_learners=int(row["active_learners"] or 0),
                )
                for row in rows
            )

    async def mastery_distribution(self, course_id: UUID) -> MasteryDistribution:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    with course_size as (
                      select
                        (select count(*) from enrollments where course_id = %s) as learners,
                        (
                          select count(*)
                          from concepts
                          where course_id = %s
                            and review_status in ('accepted', 'edited')
                        ) as concepts
                    ), states as (
                      select
                        count(*) filter (where m.state = 'mastered') as mastered,
                        count(*) filter (where m.state = 'practiced') as practiced,
                        count(*) filter (where m.state = 'struggling') as struggling,
                        count(*) filter (where m.state = 'not_started') as explicit_not_started
                      from learner_concept_mastery m
                      join concepts c on c.id = m.concept_id
                      join enrollments e
                        on e.learner_id = m.learner_id
                       and e.course_id = c.course_id
                      where c.course_id = %s
                        and c.review_status in ('accepted', 'edited')
                    )
                    select
                      coalesce(states.mastered, 0) as mastered,
                      coalesce(states.practiced, 0) as practiced,
                      coalesce(states.struggling, 0) as struggling,
                      greatest(
                        course_size.learners * course_size.concepts
                          - coalesce(states.mastered, 0)
                          - coalesce(states.practiced, 0)
                          - coalesce(states.struggling, 0),
                        coalesce(states.explicit_not_started, 0)
                      ) as not_started
                    from course_size
                    cross join states
                    """,
                    (course_id, course_id, course_id),
                )
            ).fetchone()
            if row is None:
                return MasteryDistribution()
            return MasteryDistribution(
                mastered=int(row["mastered"] or 0),
                practiced=int(row["practiced"] or 0),
                struggling=int(row["struggling"] or 0),
                not_started=int(row["not_started"] or 0),
            )

    async def open_signals(self, course_id: UUID) -> tuple[DashboardSignal, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select id, course_id, type, related_entity_type, related_entity_id,
                           ai_diagnosis, status, instructor_action
                    from dashboard_signals
                    where course_id = %s and status = 'open'
                    order by created_at desc
                    """,
                    (course_id,),
                )
            ).fetchall()
            return tuple(_signal_from_row(row) for row in rows)

    async def upsert_signal(
        self,
        course_id: UUID,
        proposal: DashboardSignalProposal,
    ) -> DashboardSignal:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            existing = await (
                await conn.execute(
                    """
                    select id, course_id, type, related_entity_type, related_entity_id,
                           ai_diagnosis, status, instructor_action
                    from dashboard_signals
                    where course_id = %s
                      and status = 'open'
                      and ai_diagnosis->>'fingerprint' = %s
                    limit 1
                    """,
                    (course_id, proposal.fingerprint),
                )
            ).fetchone()
            if existing:
                return _signal_from_row(existing)
            row = await (
                await conn.execute(
                    """
                    insert into dashboard_signals (
                      course_id, type, related_entity_type, related_entity_id, ai_diagnosis
                    )
                    values (%s, %s, %s, %s, %s::jsonb)
                    returning id, course_id, type, related_entity_type, related_entity_id,
                              ai_diagnosis, status, instructor_action
                    """,
                    (
                        course_id,
                        proposal.type.value,
                        proposal.related_entity_type,
                        proposal.related_entity_id,
                        Jsonb(_proposal_json(proposal)),
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to create dashboard signal.")
            return _signal_from_row(row)

    async def upsert_signals(
        self,
        course_id: UUID,
        proposals: tuple[DashboardSignalProposal, ...],
    ) -> None:
        if not proposals:
            return
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            fingerprints = [proposal.fingerprint for proposal in proposals]
            rows = await (
                await conn.execute(
                    """
                    select ai_diagnosis->>'fingerprint' as fingerprint
                    from dashboard_signals
                    where course_id = %s
                      and status = 'open'
                      and ai_diagnosis->>'fingerprint' = any(%s::text[])
                    """,
                    (course_id, fingerprints),
                )
            ).fetchall()
            existing = {str(row["fingerprint"]) for row in rows}
            missing = [proposal for proposal in proposals if proposal.fingerprint not in existing]
            if not missing:
                return
            cursor = conn.cursor()
            await cursor.executemany(
                """
                insert into dashboard_signals (
                  course_id, type, related_entity_type, related_entity_id, ai_diagnosis
                ) values (%s, %s, %s, %s, %s::jsonb)
                """,
                [
                    (
                        course_id,
                        proposal.type.value,
                        proposal.related_entity_type,
                        proposal.related_entity_id,
                        Jsonb(_proposal_json(proposal)),
                    )
                    for proposal in missing
                ],
            )

    async def accept_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        return await self._resolve_signal(signal_id, DashboardSignalStatus.ACCEPTED, action)

    async def edit_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        return await self._resolve_signal(signal_id, DashboardSignalStatus.EDITED, action)

    async def dismiss_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        return await self._resolve_signal(signal_id, DashboardSignalStatus.DISMISSED, action)

    async def apply_learner_override(self, override: LearnerOverride) -> None:
        state = "mastered" if override.action == "skip_ahead" else "struggling"
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                insert into learner_concept_mastery (learner_id, concept_id, state)
                values (%s, %s, %s)
                on conflict (learner_id, concept_id) do update
                set state = excluded.state,
                    updated_at = now()
                """,
                (override.learner_id, override.concept_id, state),
            )
            course = await (
                await conn.execute(
                    "select course_id from concepts where id = %s",
                    (override.concept_id,),
                )
            ).fetchone()
            if course:
                await conn.execute(
                    """
                    insert into dashboard_signals (
                      course_id, type, related_entity_type, related_entity_id,
                      ai_diagnosis, status, instructor_action, resolved_at
                    )
                    values (%s, 'stuck_cohort', 'learner_override', %s,
                            %s::jsonb, 'accepted', %s::jsonb, now())
                    """,
                    (
                        UUID(str(course[0])),
                        override.learner_id,
                        Jsonb(
                            {
                                "title": "Manual learner override",
                                "summary": "Instructor manually adjusted learner mastery.",
                                "concept_id": str(override.concept_id),
                            },
                        ),
                        Jsonb(
                            {
                                "action": override.action,
                                "note": override.note,
                                "applied_scope": "single_learner",
                            },
                        ),
                    ),
                )

    async def course_id_for_concept(self, concept_id: UUID) -> UUID | None:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    "select course_id from concepts where id = %s",
                    (concept_id,),
                )
            ).fetchone()
            return UUID(str(row[0])) if row else None

    async def _resolve_signal(
        self,
        signal_id: UUID,
        status: DashboardSignalStatus,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            signal = await self._get_signal(conn, signal_id)
            if signal is None:
                return None
            if status is not DashboardSignalStatus.DISMISSED:
                await self._apply_signal_action(conn, signal, status, action)
            row = await (
                await conn.execute(
                    """
                    update dashboard_signals
                    set status = %s,
                        instructor_action = %s::jsonb,
                        resolved_at = now()
                    where id = %s
                    returning id, course_id, type, related_entity_type, related_entity_id,
                              ai_diagnosis, status, instructor_action
                    """,
                    (
                        status.value,
                        Jsonb(
                            {
                                "action": action.action,
                                "note": action.note,
                                "retroactive": action.retroactive,
                                "applied_scope": (
                                    "retroactive_reprocess"
                                    if action.retroactive
                                    else "going_forward"
                                ),
                            },
                        ),
                        signal_id,
                    ),
                )
            ).fetchone()
            return _signal_from_row(row) if row else None

    async def _get_signal(
        self,
        conn: psycopg.AsyncConnection[Any],
        signal_id: UUID,
    ) -> DashboardSignal | None:
        row = await (
            await conn.execute(
                """
                select id, course_id, type, related_entity_type, related_entity_id,
                       ai_diagnosis, status, instructor_action
                from dashboard_signals
                where id = %s
                """,
                (signal_id,),
            )
        ).fetchone()
        return _signal_from_row(row) if row else None

    async def _apply_signal_action(
        self,
        conn: psycopg.AsyncConnection[Any],
        signal: DashboardSignal,
        status: DashboardSignalStatus,
        action: DashboardAction,
    ) -> None:
        note = action.note or signal.ai_diagnosis.get("recommended_action") or ""
        if (
            signal.type is DashboardSignalType.STUCK_COHORT
            and signal.related_entity_type == "concept"
        ):
            await conn.execute(
                """
                insert into routing_policies (course_id, concept_id, policy)
                values (%s, %s, %s::jsonb)
                on conflict (course_id, concept_id) do update
                set policy = excluded.policy,
                    updated_at = now()
                """,
                (
                    signal.course_id,
                    signal.related_entity_id,
                    Jsonb(
                        {
                            "confidence_threshold": 3,
                            "correct_attempts_for_mastery": 1,
                            "advancement_mode": "require_mastery",
                            "max_remediation_attempts": 3,
                            "dashboard_signal_id": str(signal.id),
                            "instructor_note": note,
                            "review_status": status.value,
                        },
                    ),
                ),
            )
        elif (
            signal.type is DashboardSignalType.UNDERPERFORMING_CONTENT
            and signal.related_entity_type == "clip"
        ):
            await conn.execute(
                """
                update clips
                set status = 'flagged',
                    flagged_at = now(),
                    flag_note = %s,
                    instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                      || %s::jsonb,
                    updated_at = now()
                where id = %s and status = 'active'
                """,
                (
                    note,
                    Jsonb({"dashboard_signal_id": str(signal.id), "review_status": status.value}),
                    signal.related_entity_id,
                ),
            )
        elif (
            signal.type is DashboardSignalType.UNDERPERFORMING_CONTENT
            and signal.related_entity_type == "question"
        ):
            await conn.execute(
                """
                update questions
                set review_status = 'edited',
                    instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                      || %s::jsonb,
                    updated_at = now()
                where id = %s
                """,
                (
                    Jsonb(
                        {
                            "dashboard_signal_id": str(signal.id),
                            "instructor_note": note,
                            "review_status": status.value,
                        },
                    ),
                    signal.related_entity_id,
                ),
            )
        elif (
            signal.type is DashboardSignalType.GRAPH_DRIFT
            and signal.related_entity_type == "concept"
        ):
            await conn.execute(
                """
                update concepts
                set instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                  || %s::jsonb,
                    updated_at = now()
                where id = %s
                """,
                (
                    Jsonb(
                        {
                            "dashboard_signal_id": str(signal.id),
                            "instructor_note": note,
                            "suggested_graph_review": True,
                            "review_status": status.value,
                        },
                    ),
                    signal.related_entity_id,
                ),
            )


def _proposal_json(proposal: DashboardSignalProposal) -> dict[str, object]:
    return {
        "title": proposal.title,
        "summary": proposal.summary,
        "recommended_action": proposal.recommended_action,
        "fingerprint": proposal.fingerprint,
        "metrics": proposal.metrics,
    }


def _signal_from_row(row: dict[str, Any]) -> DashboardSignal:
    diagnosis = row["ai_diagnosis"]
    instructor_action = row["instructor_action"]
    if not isinstance(diagnosis, dict):
        diagnosis = {}
    if instructor_action is not None and not isinstance(instructor_action, dict):
        instructor_action = {}
    return DashboardSignal(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        type=DashboardSignalType(str(row["type"])),
        related_entity_type=str(row["related_entity_type"]),
        related_entity_id=UUID(str(row["related_entity_id"])),
        status=DashboardSignalStatus(str(row["status"])),
        ai_diagnosis=diagnosis,
        instructor_action=instructor_action,
    )
