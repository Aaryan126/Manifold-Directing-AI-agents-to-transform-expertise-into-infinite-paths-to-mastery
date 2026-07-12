from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.db.pool import pooled_connection
from app.routing.models import (
    AdvancementMode,
    AttemptContext,
    AttemptSubmission,
    LearnerConceptProgress,
    LearnerMastery,
    MasteryState,
    RouteableClip,
    RouteableConcept,
    RouteableRemediationRule,
    RouteDecision,
    RoutingPolicy,
)
from app.routing.repository import RoutingRepository


class PostgresRoutingRepository(RoutingRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def get_attempt_context(
        self,
        learner_id: UUID,
        question_id: UUID,
    ) -> AttemptContext | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            question = await (
                await conn.execute(
                    """
                    select q.id, q.topic_id, t.course_id
                    from questions q
                    join topics t on t.id = q.topic_id
                    where q.id = %s
                      and q.review_status in ('accepted', 'edited')
                      and t.review_status in ('accepted', 'edited')
                      and exists (
                        select 1
                        from enrollments e
                        join courses course on course.id = e.course_id
                        where e.learner_id = %s
                          and e.course_id = t.course_id
                          and course.status = 'published'
                      )
                    """,
                    (question_id, learner_id),
                )
            ).fetchone()
            if question is None:
                return None
            topic_id = UUID(str(question["topic_id"]))
            course_id = UUID(str(question["course_id"]))
            current_concept_id = await self._primary_topic_concept(conn, topic_id)
            if current_concept_id is None:
                return None
            mastery = await self._get_mastery(conn, learner_id, current_concept_id)
            mastered = await self._mastered_concept_ids(conn, learner_id, course_id)
            rules = await self._remediation_rules(conn, question_id)
            policy = await self._policy_for_concept(conn, course_id, current_concept_id)
            return AttemptContext(
                course_id=course_id,
                learner_id=learner_id,
                question_id=question_id,
                topic_id=topic_id,
                current_concept_id=current_concept_id,
                policy=policy,
                mastery=mastery,
                mastered_concept_ids=mastered,
                remediation_rules=rules,
            )

    async def record_attempt(self, submission: AttemptSubmission) -> UUID:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into attempts (
                      learner_id, question_id, answer, correctness, confidence
                    )
                    values (%s, %s, %s::jsonb, %s, %s)
                    returning id
                    """,
                    (
                        submission.learner_id,
                        submission.question_id,
                        Jsonb(
                            {
                                **submission.answer,
                                "wrong_answer_pattern": submission.wrong_answer_pattern,
                            },
                        ),
                        submission.correctness,
                        submission.confidence,
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to record attempt.")
            return UUID(str(row[0]))

    async def update_mastery(self, learner_id: UUID, mastery: LearnerMastery) -> None:
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                insert into learner_concept_mastery (learner_id, concept_id, state)
                values (%s, %s, %s)
                on conflict (learner_id, concept_id) do update
                set state = excluded.state,
                    updated_at = now()
                """,
                (learner_id, mastery.concept_id, mastery.state.value),
            )

    async def record_attempt_and_update_mastery(
        self,
        submission: AttemptSubmission,
        mastery: LearnerMastery,
    ) -> UUID:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into attempts (
                      learner_id, question_id, answer, correctness, confidence
                    )
                    values (%s, %s, %s::jsonb, %s, %s)
                    returning id
                    """,
                    (
                        submission.learner_id,
                        submission.question_id,
                        Jsonb(
                            {
                                **submission.answer,
                                "wrong_answer_pattern": submission.wrong_answer_pattern,
                            },
                        ),
                        submission.correctness,
                        submission.confidence,
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to record attempt.")
            await conn.execute(
                """
                insert into learner_concept_mastery (learner_id, concept_id, state)
                values (%s, %s, %s)
                on conflict (learner_id, concept_id) do update
                set state = excluded.state,
                    updated_at = now()
                """,
                (submission.learner_id, mastery.concept_id, mastery.state.value),
            )
            return UUID(str(row[0]))

    async def eligible_next_concepts(
        self,
        course_id: UUID,
        mastered_concept_ids: frozenset[UUID],
    ) -> tuple[RouteableConcept, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select c.id, c.name, min(tc.topic_id::text) as topic_id
                    from concepts c
                    left join topic_concepts tc on tc.concept_id = c.id
                    where c.course_id = %s
                      and c.review_status in ('accepted', 'edited')
                      and not (c.id = any(%s::uuid[]))
                      and not exists (
                        select 1
                        from concept_edges e
                        join concepts prereq on prereq.id = e.from_concept_id
                        where e.to_concept_id = c.id
                          and e.review_status in ('accepted', 'edited')
                          and prereq.review_status in ('accepted', 'edited')
                          and not (e.from_concept_id = any(%s::uuid[]))
                      )
                    group by c.id, c.name
                    order by c.name
                    """,
                    (
                        course_id,
                        list(mastered_concept_ids),
                        list(mastered_concept_ids),
                    ),
                )
            ).fetchall()
            return tuple(
                RouteableConcept(
                    id=UUID(str(row["id"])),
                    name=str(row["name"]),
                    topic_id=UUID(str(row["topic_id"])) if row["topic_id"] else None,
                )
                for row in rows
            )

    async def resolve_active_clip(
        self,
        concept_id: UUID,
        topic_id: UUID,
        preferred_clip_id: UUID | None = None,
    ) -> RouteableClip | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            row = await (
                await conn.execute(
                    """
                    select c.id, c.topic_id, cc.concept_id, c.type,
                           c.start_seconds, c.end_seconds
                    from clips c
                    join clip_concepts cc on cc.clip_id = c.id
                    join concepts concept on concept.id = cc.concept_id
                    where cc.concept_id = %s
                      and c.topic_id = %s
                      and c.status = 'active'
                      and concept.review_status in ('accepted', 'edited')
                      and (%s::uuid is null or c.id = %s)
                    order by
                      case c.type
                        when 'misconception_correction' then 0
                        when 'explanation' then 1
                        when 'worked_example' then 2
                        else 3
                      end,
                      c.start_seconds
                    limit 1
                    """,
                    (concept_id, topic_id, preferred_clip_id, preferred_clip_id),
                )
            ).fetchone()
            return _clip_from_row(row) if row else None

    async def create_stuck_signal(
        self,
        context: AttemptContext,
        decision: RouteDecision,
    ) -> UUID:
        async with pooled_connection(self._database_url) as conn:
            existing = await (
                await conn.execute(
                    """
                    select id
                    from dashboard_signals
                    where course_id = %s
                      and type = 'stuck_cohort'
                      and related_entity_type = 'concept'
                      and related_entity_id = %s
                      and status = 'open'
                    order by created_at desc
                    limit 1
                    """,
                    (context.course_id, context.current_concept_id),
                )
            ).fetchone()
            if existing:
                return UUID(str(existing[0]))
            row = await (
                await conn.execute(
                    """
                    insert into dashboard_signals (
                      course_id, type, related_entity_type, related_entity_id, ai_diagnosis
                    )
                    values (%s, 'stuck_cohort', 'concept', %s, %s::jsonb)
                    returning id
                    """,
                    (
                        context.course_id,
                        context.current_concept_id,
                        Jsonb(
                            {
                                "reason": decision.why,
                                "learner_id": str(context.learner_id),
                                "question_id": str(context.question_id),
                                "remediation_attempts": context.mastery.remediation_attempts + 1,
                            },
                        ),
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to create dashboard signal.")
            return UUID(str(row[0]))

    async def list_policies(self, course_id: UUID) -> dict[UUID | None, RoutingPolicy]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    "select concept_id, policy from routing_policies where course_id = %s",
                    (course_id,),
                )
            ).fetchall()
            return {
                UUID(str(row["concept_id"])) if row["concept_id"] else None: _policy_from_json(
                    row["policy"],
                )
                for row in rows
            }

    async def upsert_policy(
        self,
        course_id: UUID,
        concept_id: UUID | None,
        policy: RoutingPolicy,
    ) -> RoutingPolicy:
        async with pooled_connection(self._database_url) as conn:
            await conn.execute(
                """
                insert into routing_policies (course_id, concept_id, policy)
                values (%s, %s, %s::jsonb)
                on conflict (course_id, concept_id) do update
                set policy = excluded.policy,
                    updated_at = now()
                """,
                (course_id, concept_id, Jsonb(_policy_json(policy))),
            )
            return policy

    async def create_demo_learner(self, course_id: UUID) -> UUID:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into users (email, role)
                    values ('demo-learner-' || gen_random_uuid()::text || '@coursefoundry.local',
                            'learner')
                    returning id
                    """,
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to create demo learner.")
            learner_id = UUID(str(row[0]))
            await conn.execute(
                """
                insert into enrollments (learner_id, course_id)
                values (%s, %s)
                on conflict do nothing
                """,
                (learner_id, course_id),
            )
            return learner_id

    async def learner_progress(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> tuple[LearnerConceptProgress, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select c.id, c.name, coalesce(m.state, 'not_started') as state,
                           min(tc.topic_id::text) as topic_id
                    from concepts c
                    join courses course on course.id = c.course_id
                    join enrollments enrollment
                      on enrollment.course_id = c.course_id
                     and enrollment.learner_id = %s
                    left join learner_concept_mastery m
                      on m.concept_id = c.id and m.learner_id = %s
                    left join topic_concepts tc on tc.concept_id = c.id
                    where c.course_id = %s
                      and c.review_status in ('accepted', 'edited')
                      and course.status = 'published'
                    group by c.id, c.name, m.state
                    order by c.name
                    """,
                    (learner_id, learner_id, course_id),
                )
            ).fetchall()
            return tuple(
                LearnerConceptProgress(
                    concept_id=UUID(str(row["id"])),
                    name=str(row["name"]),
                    state=MasteryState(str(row["state"])),
                    topic_id=UUID(str(row["topic_id"])) if row["topic_id"] else None,
                )
                for row in rows
            )

    async def _primary_topic_concept(
        self,
        conn: psycopg.AsyncConnection[Any],
        topic_id: UUID,
    ) -> UUID | None:
        row = await (
            await conn.execute(
                """
                select c.id
                from topic_concepts tc
                join concepts c on c.id = tc.concept_id
                where tc.topic_id = %s
                  and c.review_status in ('accepted', 'edited')
                order by c.name
                limit 1
                """,
                (topic_id,),
            )
        ).fetchone()
        return UUID(str(row["id"])) if row else None

    async def _get_mastery(
        self,
        conn: psycopg.AsyncConnection[Any],
        learner_id: UUID,
        concept_id: UUID,
    ) -> LearnerMastery:
        row = await (
            await conn.execute(
                """
                select state
                from learner_concept_mastery
                where learner_id = %s and concept_id = %s
                """,
                (learner_id, concept_id),
            )
        ).fetchone()
        state = MasteryState(str(row["state"])) if row else MasteryState.NOT_STARTED
        attempts = await self._concept_attempt_counts(conn, learner_id, concept_id)
        return LearnerMastery(
            concept_id=concept_id,
            state=state,
            correct_confident_attempts=attempts["correct_confident"],
            remediation_attempts=attempts["remediation"],
        )

    async def _mastered_concept_ids(
        self,
        conn: psycopg.AsyncConnection[Any],
        learner_id: UUID,
        course_id: UUID,
    ) -> frozenset[UUID]:
        rows = await (
            await conn.execute(
                """
                select m.concept_id
                from learner_concept_mastery m
                join concepts c on c.id = m.concept_id
                where m.learner_id = %s
                  and c.course_id = %s
                  and c.review_status in ('accepted', 'edited')
                  and m.state = 'mastered'
                """,
                (learner_id, course_id),
            )
        ).fetchall()
        return frozenset(UUID(str(row["concept_id"])) for row in rows)

    async def _remediation_rules(
        self,
        conn: psycopg.AsyncConnection[Any],
        question_id: UUID,
    ) -> tuple[RouteableRemediationRule, ...]:
        rows = await (
            await conn.execute(
                """
                select r.id, r.wrong_answer_pattern, r.target_clip_id, r.target_concept_id
                from remediation_rules r
                left join clips clip on clip.id = r.target_clip_id
                left join concepts concept on concept.id = r.target_concept_id
                where r.question_id = %s
                  and (clip.id is null or clip.status = 'active')
                  and (concept.id is null or concept.review_status in ('accepted', 'edited'))
                order by r.created_at
                """,
                (question_id,),
            )
        ).fetchall()
        return tuple(
            RouteableRemediationRule(
                id=UUID(str(row["id"])),
                wrong_answer_pattern=str(row["wrong_answer_pattern"]),
                target_clip_id=UUID(str(row["target_clip_id"])) if row["target_clip_id"] else None,
                target_concept_id=(
                    UUID(str(row["target_concept_id"])) if row["target_concept_id"] else None
                ),
            )
            for row in rows
        )

    async def _policy_for_concept(
        self,
        conn: psycopg.AsyncConnection[Any],
        course_id: UUID,
        concept_id: UUID,
    ) -> RoutingPolicy:
        row = await (
            await conn.execute(
                """
                select policy
                from routing_policies
                where course_id = %s and (concept_id = %s or concept_id is null)
                order by concept_id is null
                limit 1
                """,
                (course_id, concept_id),
            )
        ).fetchone()
        return _policy_from_json(row["policy"]) if row else RoutingPolicy()

    async def _concept_attempt_counts(
        self,
        conn: psycopg.AsyncConnection[Any],
        learner_id: UUID,
        concept_id: UUID,
    ) -> dict[str, int]:
        row = await (
            await conn.execute(
                """
                select
                  count(*) filter (where a.correctness and a.confidence >= 3)
                    as correct_confident,
                  count(*) filter (where not a.correctness) as remediation
                from attempts a
                join questions q on q.id = a.question_id
                join topic_concepts tc on tc.topic_id = q.topic_id
                where a.learner_id = %s and tc.concept_id = %s
                """,
                (learner_id, concept_id),
            )
        ).fetchone()
        return {
            "correct_confident": int(row["correct_confident"] or 0) if row else 0,
            "remediation": int(row["remediation"] or 0) if row else 0,
        }


def _clip_from_row(row: dict[str, Any]) -> RouteableClip:
    return RouteableClip(
        id=UUID(str(row["id"])),
        topic_id=UUID(str(row["topic_id"])),
        concept_id=UUID(str(row["concept_id"])),
        type=str(row["type"]),
        start_seconds=float(row["start_seconds"]),
        end_seconds=float(row["end_seconds"]),
    )


def _policy_json(policy: RoutingPolicy) -> dict[str, object]:
    return {
        "confidence_threshold": policy.confidence_threshold,
        "correct_attempts_for_mastery": policy.correct_attempts_for_mastery,
        "advancement_mode": policy.advancement_mode.value,
        "max_remediation_attempts": policy.max_remediation_attempts,
    }


def _policy_from_json(value: object) -> RoutingPolicy:
    if not isinstance(value, dict):
        return RoutingPolicy()
    return RoutingPolicy(
        confidence_threshold=int(value.get("confidence_threshold", 3)),
        correct_attempts_for_mastery=int(value.get("correct_attempts_for_mastery", 1)),
        advancement_mode=AdvancementMode(
            str(value.get("advancement_mode", AdvancementMode.REQUIRE_MASTERY.value)),
        ),
        max_remediation_attempts=int(value.get("max_remediation_attempts", 2)),
    )
