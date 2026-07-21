from decimal import Decimal
from typing import Any, cast
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.assessments.models import (
    AssessmentClip,
    AssessmentConcept,
    AssessmentContext,
    AssessmentTopic,
    Question,
    QuestionEdit,
    QuestionProposal,
    QuestionReviewStatus,
    QuestionType,
    RemediationProposal,
    RemediationRule,
)
from app.assessments.repository import AssessmentRepository


class PostgresAssessmentRepository(AssessmentRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def get_context_for_topic(
        self,
        topic_id: UUID,
        include_proposed: bool = False,
    ) -> AssessmentContext | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            topic = await (
                await conn.execute(
                    """
                    select id, course_id, title, summary
                    from topics
                    where id = %s
                      and review_status <> 'dismissed'
                      and (%s or review_status in ('accepted', 'edited'))
                    """,
                    (topic_id, include_proposed),
                )
            ).fetchone()
            if topic is None:
                return None
            concept_rows = await (
                await conn.execute(
                    """
                    select c.id, c.name, c.description
                    from topic_concepts tc
                    join concepts c on c.id = tc.concept_id
                    where tc.topic_id = %s
                      and c.review_status <> 'dismissed'
                      and (%s or c.review_status in ('accepted', 'edited'))
                    order by c.name
                    """,
                    (topic_id, include_proposed),
                )
            ).fetchall()
            clip_rows = await (
                await conn.execute(
                    """
                    select c.id, c.type, c.start_seconds, c.end_seconds,
                           coalesce(
                             array_agg(cc.concept_id)
                             filter (where cc.concept_id is not null),
                             '{}'
                           ) as concept_ids
                    from clips c
                    left join clip_concepts cc on cc.clip_id = c.id
                    where c.topic_id = %s and c.status in ('active', 'flagged')
                    group by c.id
                    order by c.start_seconds
                    """,
                    (topic_id,),
                )
            ).fetchall()
            return AssessmentContext(
                topic=AssessmentTopic(
                    id=UUID(str(topic["id"])),
                    course_id=UUID(str(topic["course_id"])),
                    title=str(topic["title"]),
                    summary=str(topic["summary"]) if topic["summary"] else None,
                ),
                concepts=tuple(
                    AssessmentConcept(
                        id=UUID(str(row["id"])),
                        name=str(row["name"]),
                        description=str(row["description"]) if row["description"] else None,
                    )
                    for row in concept_rows
                ),
                clips=tuple(_clip_from_row(row) for row in clip_rows),
            )

    async def replace_proposed_question(
        self,
        topic_id: UUID,
        proposal: QuestionProposal,
    ) -> Question:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await conn.execute(
                """
                delete from remediation_rules
                where question_id in (
                  select id from questions
                  where topic_id = %s and review_status = 'proposed'
                )
                """,
                (topic_id,),
            )
            await conn.execute(
                "delete from questions where topic_id = %s and review_status = 'proposed'",
                (topic_id,),
            )
            row = await self._insert_question(conn, topic_id, proposal, "proposed")
            return await _question_from_row(conn, row)

    async def list_questions_for_video(self, video_id: UUID) -> tuple[Question, ...]:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select q.*
                    from questions q
                    join topics t on t.id = q.topic_id
                    join videos v
                      on v.id = t.video_id
                     and v.course_id = t.course_id
                    join courses course on course.id = t.course_id
                    where t.video_id = %s
                      and q.revision_id = coalesce(
                        course.active_revision_id,
                        course.working_revision_id
                      )
                    order by t.start_seconds, q.created_at
                    """,
                    (video_id,),
                )
            ).fetchall()
            return tuple([await _question_from_row(conn, row) for row in rows])

    async def get_question(self, question_id: UUID) -> Question | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select * from questions where id = %s", (question_id,))
            ).fetchone()
            return await _question_from_row(conn, row) if row else None

    async def accept_question(self, question_id: UUID) -> Question | None:
        return await self._status_update(question_id, "accepted")

    async def dismiss_question(self, question_id: UUID) -> Question | None:
        return await self._status_update(question_id, "dismissed")

    async def edit_question(self, question_id: UUID, edit: QuestionEdit) -> Question | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update questions
                    set body = %s,
                        type = %s,
                        correct_answer = %s::jsonb,
                        confidence_prompt = %s,
                        instructor_revision = %s::jsonb,
                        review_status = 'edited',
                        approved_at = now(),
                        dismissed_at = null,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (
                        edit.body,
                        edit.type.value,
                        Jsonb(edit.correct_answer),
                        edit.confidence_prompt,
                        Jsonb(_edit_json(edit)),
                        question_id,
                    ),
                )
            ).fetchone()
            if row is None:
                return None
            await self._replace_rules(conn, question_id, edit.remediation_rules, "edited")
            return await _question_from_row(conn, row)

    async def topic_has_approved_question(self, topic_id: UUID) -> bool:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    select 1 from questions
                    where topic_id = %s and review_status in ('accepted', 'edited')
                    limit 1
                    """,
                    (topic_id,),
                )
            ).fetchone()
            return row is not None

    async def _status_update(self, question_id: UUID, status: str) -> Question | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update questions
                    set review_status = %s,
                        approved_at = case
                          when %s in ('accepted', 'edited') then now()
                          else approved_at
                        end,
                        dismissed_at = case when %s = 'dismissed' then now() else null end,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (status, status, status, question_id),
                )
            ).fetchone()
            return await _question_from_row(conn, row) if row else None

    async def _insert_question(
        self,
        conn: psycopg.AsyncConnection[Any],
        topic_id: UUID,
        proposal: QuestionProposal,
        status: str,
    ) -> dict[str, Any]:
        row = await (
            await conn.execute(
                """
                insert into questions (
                  topic_id, body, type, correct_answer, confidence_prompt,
                  ai_proposal, review_status
                )
                values (%s, %s, %s, %s::jsonb, %s, %s::jsonb, %s)
                returning *
                """,
                (
                    topic_id,
                    proposal.body,
                    proposal.type.value,
                    Jsonb(proposal.correct_answer),
                    proposal.confidence_prompt,
                    Jsonb(_proposal_json(proposal)),
                    status,
                ),
            )
        ).fetchone()
        if row is None:
            raise RuntimeError("Failed to insert question.")
        question_id = UUID(str(row["id"]))
        await self._replace_rules(
            conn,
            question_id,
            proposal.remediation_rules,
            "proposed",
        )
        return cast(dict[str, Any], row)

    async def _replace_rules(
        self,
        conn: psycopg.AsyncConnection[Any],
        question_id: UUID,
        rules: tuple[RemediationProposal, ...],
        action: str,
    ) -> None:
        await conn.execute("delete from remediation_rules where question_id = %s", (question_id,))
        for rule in rules:
            await conn.execute(
                """
                insert into remediation_rules (
                  question_id, wrong_answer_pattern, target_clip_id, target_concept_id,
                  ai_proposal, instructor_revision
                )
                values (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                """,
                (
                    question_id,
                    rule.wrong_answer_pattern,
                    rule.target_clip_id,
                    rule.target_concept_id,
                    Jsonb(_rule_json(rule)) if action == "proposed" else None,
                    (
                        Jsonb({**_rule_json(rule), "action": action})
                        if action != "proposed"
                        else None
                    ),
                ),
            )


def _clip_from_row(row: dict[str, Any]) -> AssessmentClip:
    return AssessmentClip(
        id=UUID(str(row["id"])),
        concept_ids=tuple(UUID(str(value)) for value in row["concept_ids"]),
        type=str(row["type"]),
        start_seconds=_float(row["start_seconds"]),
        end_seconds=_float(row["end_seconds"]),
    )


async def _question_from_row(conn: psycopg.AsyncConnection[Any], row: dict[str, Any]) -> Question:
    remediation_rows = await (
        await conn.execute(
            "select * from remediation_rules where question_id = %s order by created_at",
            (row["id"],),
        )
    ).fetchall()
    return Question(
        id=UUID(str(row["id"])),
        topic_id=UUID(str(row["topic_id"])),
        body=str(row["body"]),
        type=QuestionType(str(row["type"])),
        correct_answer=_json_dict(row["correct_answer"]),
        confidence_prompt=str(row["confidence_prompt"]),
        review_status=QuestionReviewStatus(str(row["review_status"])),
        ai_proposal=_optional_json_dict(row["ai_proposal"]),
        instructor_revision=_optional_json_dict(row["instructor_revision"]),
        approved_at=str(row["approved_at"]) if row["approved_at"] else None,
        dismissed_at=str(row["dismissed_at"]) if row["dismissed_at"] else None,
        remediation_rules=tuple(_rule_from_row(rule) for rule in remediation_rows),
    )


def _rule_from_row(row: dict[str, Any]) -> RemediationRule:
    return RemediationRule(
        id=UUID(str(row["id"])),
        question_id=UUID(str(row["question_id"])),
        wrong_answer_pattern=str(row["wrong_answer_pattern"]),
        target_clip_id=UUID(str(row["target_clip_id"])) if row["target_clip_id"] else None,
        target_concept_id=UUID(str(row["target_concept_id"])) if row["target_concept_id"] else None,
        ai_proposal=_optional_json_dict(row["ai_proposal"]),
        instructor_revision=_optional_json_dict(row["instructor_revision"]),
    )


def _proposal_json(proposal: QuestionProposal) -> dict[str, object]:
    return {
        "body": proposal.body,
        "type": proposal.type.value,
        "correct_answer": proposal.correct_answer,
        "confidence_prompt": proposal.confidence_prompt,
        "remediation_rules": [_rule_json(rule) for rule in proposal.remediation_rules],
        "rationale": proposal.rationale,
        "confidence": proposal.confidence,
    }


def _edit_json(edit: QuestionEdit) -> dict[str, object]:
    return {
        "body": edit.body,
        "type": edit.type.value,
        "correct_answer": edit.correct_answer,
        "confidence_prompt": edit.confidence_prompt,
        "remediation_rules": [_rule_json(rule) for rule in edit.remediation_rules],
        "action": edit.action,
    }


def _rule_json(rule: RemediationProposal) -> dict[str, object]:
    return {
        "wrong_answer_pattern": rule.wrong_answer_pattern,
        "target_clip_id": str(rule.target_clip_id) if rule.target_clip_id else None,
        "target_concept_id": str(rule.target_concept_id) if rule.target_concept_id else None,
        "rationale": rule.rationale,
    }


def _float(value: object) -> float:
    if isinstance(value, int | float | str | Decimal):
        return float(value)
    raise TypeError(f"Expected numeric value, got {type(value).__name__}")


def _json_dict(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    raise TypeError(f"Expected JSON object, got {type(value).__name__}")


def _optional_json_dict(value: object) -> dict[str, Any] | None:
    if value is None:
        return None
    return _json_dict(value)
