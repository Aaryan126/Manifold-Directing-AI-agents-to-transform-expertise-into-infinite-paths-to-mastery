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
    LearnerPath,
    LearnerPathAid,
    LearnerPathItem,
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
                    select q.id, q.topic_id, q.revision_id, t.course_id,
                           qc.concept_id
                    from questions q
                    join topics t on t.id = q.topic_id
                    join question_concepts qc
                      on qc.question_id = q.id and qc.is_primary
                    where q.id = %s
                      and q.review_status in ('accepted', 'edited')
                      and t.review_status in ('accepted', 'edited')
                      and exists (
                        select 1
                        from enrollments e
                        join courses course on course.id = e.course_id
                        join users learner on learner.id = e.learner_id
                        where e.learner_id = %s
                          and e.course_id = t.course_id
                          and e.revision_id = q.revision_id
                          and (course.status = 'published' or learner.is_simulated)
                      )
                    """,
                    (question_id, learner_id),
                )
            ).fetchone()
            if question is None:
                return None
            topic_id = UUID(str(question["topic_id"]))
            course_id = UUID(str(question["course_id"]))
            current_concept_id = UUID(str(question["concept_id"]))
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
                revision_id=UUID(str(question["revision_id"])),
            )

    async def record_attempt(self, submission: AttemptSubmission) -> UUID:
        async with pooled_connection(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    insert into attempts (
                      learner_id, question_id, answer, correctness, confidence,
                      purpose, study_session_id
                    )
                    values (%s, %s, %s::jsonb, %s, %s, %s, %s)
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
                        submission.purpose,
                        submission.study_session_id,
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
                      learner_id, question_id, answer, correctness, confidence,
                      purpose, study_session_id
                    )
                    values (%s, %s, %s::jsonb, %s, %s, %s, %s)
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
                        submission.purpose,
                        submission.study_session_id,
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

    async def record_attempt_mastery_and_route(
        self,
        context: AttemptContext,
        submission: AttemptSubmission,
        mastery: LearnerMastery,
        decision: RouteDecision,
    ) -> tuple[UUID, UUID | None]:
        if context.revision_id is None:
            raise RuntimeError("Attempt routing context has no course revision.")
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
                            }
                        ),
                        submission.correctness,
                        submission.confidence,
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to record attempt.")
            attempt_id = UUID(str(row[0]))
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
            event = await (
                await conn.execute(
                    """
                    insert into learner_route_events (
                      course_id, revision_id, learner_id, attempt_id, concept_id,
                      mastery_before, mastery_after, action, target_concept_id,
                      target_clip_id, why, evidence_snapshot
                    ) values (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                    ) returning id
                    """,
                    (
                        context.course_id,
                        context.revision_id,
                        submission.learner_id,
                        attempt_id,
                        context.current_concept_id,
                        context.mastery.state.value,
                        mastery.state.value,
                        decision.action.value,
                        decision.target_concept_id,
                        decision.target_clip_id,
                        decision.why,
                        Jsonb(
                            {
                                "question_id": str(context.question_id),
                                "correctness": submission.correctness,
                                "confidence": submission.confidence,
                                "wrong_answer_pattern": submission.wrong_answer_pattern,
                                "mastered_concept_ids": sorted(
                                    str(value) for value in context.mastered_concept_ids
                                ),
                            }
                        ),
                    ),
                )
            ).fetchone()
            if event is None:
                raise RuntimeError("Failed to record route event.")
            return attempt_id, UUID(str(event[0]))

    async def eligible_next_concepts(
        self,
        course_id: UUID,
        mastered_concept_ids: frozenset[UUID],
    ) -> tuple[RouteableConcept, ...]:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            rows = await (
                await conn.execute(
                    """
                    select c.id, c.name, c.sequence_rank,
                           min(tc.topic_id::text) as topic_id
                    from concepts c
                    join courses course on course.id = c.course_id
                    left join topic_concepts tc on tc.concept_id = c.id
                    where c.course_id = %s
                      and c.revision_id = coalesce(
                        course.active_revision_id,
                        course.working_revision_id
                      )
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
                      and exists (
                        select 1
                        from clip_concepts ready_cc
                        join clips ready_clip on ready_clip.id = ready_cc.clip_id
                        where ready_cc.concept_id = c.id
                          and ready_clip.revision_id = c.revision_id
                          and ready_clip.status = 'active'
                      )
                      and exists (
                        select 1
                        from question_concepts ready_qc
                        join questions ready_q on ready_q.id = ready_qc.question_id
                        where ready_qc.concept_id = c.id
                          and ready_qc.revision_id = c.revision_id
                          and ready_qc.is_primary
                          and ready_q.review_status in ('accepted', 'edited')
                      )
                    group by c.id, c.name, c.sequence_rank
                    order by c.sequence_rank, c.name
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
                    sequence_rank=int(row["sequence_rank"]),
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
                    """
                    select rp.concept_id, rp.policy
                    from routing_policies rp
                    join courses c on c.id = rp.course_id
                    where rp.course_id = %s
                      and rp.revision_id = coalesce(
                        c.working_revision_id,
                        c.active_revision_id
                      )
                    """,
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
                on conflict (revision_id, concept_id) do update
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
                    insert into users (email, display_name, role, is_simulated)
                    values ('demo-learner-' || gen_random_uuid()::text || '@coursefoundry.local',
                            'Routing simulator learner', 'learner', true)
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
                    join users learner on learner.id = enrollment.learner_id
                    left join learner_concept_mastery m
                      on m.concept_id = c.id and m.learner_id = %s
                    left join topic_concepts tc on tc.concept_id = c.id
                    where c.course_id = %s
                      and c.revision_id = enrollment.revision_id
                      and c.review_status in ('accepted', 'edited')
                      and (course.status = 'published' or learner.is_simulated)
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

    async def learner_path(self, learner_id: UUID, course_id: UUID) -> LearnerPath | None:
        async with pooled_connection(self._database_url, row_factory=dict_row) as conn:
            enrollment = await (
                await conn.execute(
                    """
                    select e.revision_id
                    from enrollments e
                    join courses course on course.id = e.course_id
                    join users learner on learner.id = e.learner_id
                    where e.learner_id = %s and e.course_id = %s
                      and (course.status = 'published' or learner.is_simulated)
                    """,
                    (learner_id, course_id),
                )
            ).fetchone()
            if enrollment is None:
                return None
            revision_id = UUID(str(enrollment["revision_id"]))
            rows = await (
                await conn.execute(
                    """
                    select c.id, c.logical_id, c.name, c.description, c.sequence_rank,
                           coalesce(m.state, 'not_started') as state,
                           topic.id as topic_id, topic.title as topic_title,
                           coalesce((
                             select array_agg(edge.from_concept_id order by prereq.sequence_rank)
                             from concept_edges edge
                             join concepts prereq on prereq.id = edge.from_concept_id
                             where edge.to_concept_id = c.id
                               and edge.review_status in ('accepted', 'edited')
                               and prereq.review_status in ('accepted', 'edited')
                           ), '{}') as prerequisite_ids,
                           coalesce((
                             select array_agg(distinct clip.id order by clip.id)
                             from clip_concepts cc
                             join clips clip on clip.id = cc.clip_id
                             where cc.concept_id = c.id
                               and clip.revision_id = c.revision_id
                               and clip.status = 'active'
                           ), '{}') as clip_ids,
                           coalesce((
                             select array_agg(distinct q.id order by q.id)
                             from question_concepts qc
                             join questions q on q.id = qc.question_id
                             where qc.concept_id = c.id
                               and qc.revision_id = c.revision_id
                               and qc.is_primary
                               and q.review_status in ('accepted', 'edited')
                           ), '{}') as question_ids
                    from concepts c
                    left join learner_concept_mastery m
                      on m.concept_id = c.id and m.learner_id = %s
                    left join lateral (
                      select t.id, t.title
                      from topic_concepts tc
                      join topics t on t.id = tc.topic_id
                      where tc.concept_id = c.id
                        and t.review_status in ('accepted', 'edited')
                      order by t.start_seconds, t.id
                      limit 1
                    ) topic on true
                    where c.course_id = %s and c.revision_id = %s
                      and c.review_status in ('accepted', 'edited')
                    order by c.sequence_rank, c.name
                    """,
                    (learner_id, course_id, revision_id),
                )
            ).fetchall()
            aid_rows = await (
                await conn.execute(
                    """
                    select citation.logical_artifact_id, source.id as source_id,
                           source.filename, section.page_number, citation.excerpt
                    from source_citations citation
                    join source_sections section on section.id = citation.source_section_id
                    join course_sources source on source.id = section.source_id
                    join course_revision_sources link
                      on link.source_id = source.id and link.revision_id = citation.revision_id
                    where citation.revision_id = %s
                      and citation.artifact_type = 'concept'
                      and link.learner_visible
                      and link.review_status in ('accepted', 'edited')
                      and link.removed_at is null
                    order by source.filename, section.page_number
                    """,
                    (revision_id,),
                )
            ).fetchall()
            latest_route = await (
                await conn.execute(
                    """
                    select action, why
                    from learner_route_events
                    where learner_id = %s and course_id = %s and revision_id = %s
                    order by created_at desc limit 1
                    """,
                    (learner_id, course_id, revision_id),
                )
            ).fetchone()

        mastered = {
            UUID(str(row["id"])) for row in rows if str(row["state"]) == MasteryState.MASTERED.value
        }
        prerequisites = {
            UUID(str(row["id"])): tuple(UUID(str(value)) for value in row["prerequisite_ids"])
            for row in rows
        }
        eligible = {
            concept_id
            for concept_id, required in prerequisites.items()
            if all(value in mastered for value in required)
        }
        actionable = {
            UUID(str(row["id"])) for row in rows if row["clip_ids"] and row["question_ids"]
        }
        current_row = next(
            (
                row
                for row in rows
                if str(row["state"])
                in {
                    MasteryState.STRUGGLING.value,
                    MasteryState.PRACTICED.value,
                }
                and UUID(str(row["id"])) in eligible
                and UUID(str(row["id"])) in actionable
            ),
            None,
        )
        if current_row is None:
            current_row = next(
                (
                    row
                    for row in rows
                    if UUID(str(row["id"])) in eligible
                    and UUID(str(row["id"])) in actionable
                    and UUID(str(row["id"])) not in mastered
                ),
                None,
            )
        current_id = UUID(str(current_row["id"])) if current_row else None
        aids_by_logical: dict[UUID, list[LearnerPathAid]] = {}
        for row in aid_rows:
            logical_id = UUID(str(row["logical_artifact_id"]))
            aids_by_logical.setdefault(logical_id, []).append(
                LearnerPathAid(
                    source_id=UUID(str(row["source_id"])),
                    title=str(row["filename"]),
                    page_number=int(row["page_number"]),
                    excerpt=str(row["excerpt"]),
                )
            )
        return LearnerPath(
            course_id=course_id,
            revision_id=revision_id,
            current_concept_id=current_id,
            items=tuple(
                LearnerPathItem(
                    concept_id=UUID(str(row["id"])),
                    name=str(row["name"]),
                    description=str(row["description"] or ""),
                    sequence_rank=int(row["sequence_rank"]),
                    state=MasteryState(str(row["state"])),
                    topic_id=UUID(str(row["topic_id"])) if row["topic_id"] else None,
                    topic_title=str(row["topic_title"]) if row["topic_title"] else None,
                    prerequisite_ids=prerequisites[UUID(str(row["id"]))],
                    clip_ids=tuple(UUID(str(value)) for value in row["clip_ids"]),
                    question_ids=tuple(UUID(str(value)) for value in row["question_ids"]),
                    aids=tuple(aids_by_logical.get(UUID(str(row["logical_id"])), [])),
                    eligible=UUID(str(row["id"])) in eligible,
                    actionable=UUID(str(row["id"])) in actionable,
                    coverage_state=(
                        "complete"
                        if row["clip_ids"] and row["question_ids"]
                        else "missing_teaching"
                        if not row["clip_ids"] and row["question_ids"]
                        else "missing_assessment"
                        if row["clip_ids"] and not row["question_ids"]
                        else "missing_both"
                    ),
                    current=UUID(str(row["id"])) == current_id,
                )
                for row in rows
            ),
            last_route_action=str(latest_route["action"]) if latest_route else None,
            last_route_why=str(latest_route["why"]) if latest_route else None,
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
                join enrollments e
                  on e.course_id = c.course_id and e.learner_id = m.learner_id
                where m.learner_id = %s
                  and c.course_id = %s
                  and c.revision_id = e.revision_id
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
                where course_id = %s
                  and revision_id = (select revision_id from concepts where id = %s)
                  and (concept_id = %s or concept_id is null)
                order by concept_id is null
                limit 1
                """,
                (course_id, concept_id, concept_id),
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
                join question_concepts qc on qc.question_id = a.question_id
                where a.learner_id = %s and qc.concept_id = %s and qc.is_primary
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
