from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal
from time import perf_counter
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

import app.course_os.postgres_repository as repository_module
from app.course_os.models import BlueprintEdge, BlueprintNode, CourseCreate, CourseSummary
from app.course_os.postgres_repository import (
    PostgresCourseOSRepository,
    _create_blueprint_relationship,
    _json_value,
    _message,
    _publication_blockers,
    _visible_blueprint_edges,
)


def test_proposal_undo_snapshot_normalizes_database_values_for_jsonb() -> None:
    identifier = uuid4()
    moment = datetime.now(UTC)

    assert _json_value({
        "seconds": Decimal("12.375"),
        "identifier": identifier,
        "moment": moment,
    }) == {
        "seconds": 12.375,
        "identifier": str(identifier),
        "moment": str(moment),
    }


def test_visible_blueprint_edges_remove_orphaned_relationships() -> None:
    visible = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="concept",
        title="Visible concept",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    second_visible = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="concept",
        title="Second visible concept",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    orphaned = BlueprintEdge(
        id=f"assesses:{uuid4()}",
        source_id=visible.id,
        target_id=uuid4(),
        kind="assesses",
        status="accepted",
    )
    complete = BlueprintEdge(
        id=f"requires:{uuid4()}",
        source_id=visible.id,
        target_id=second_visible.id,
        kind="requires",
        status="accepted",
    )

    assert _visible_blueprint_edges(
        [visible, second_visible],
        [orphaned, complete],
    ) == [complete]


class _Cursor:
    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self._row = row

    async def fetchone(self) -> dict[str, Any] | None:
        return self._row


class _RowsCursor:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    async def fetchall(self) -> list[dict[str, Any]]:
        return self._rows


class _DismissedPrerequisiteConnection:
    def __init__(
        self,
        source_id: UUID,
        source_logical_id: UUID,
        target_id: UUID,
        target_logical_id: UUID,
        edge_id: UUID,
    ) -> None:
        self.nodes = [
            {"kind": "concept", "id": source_id, "logical_id": source_logical_id},
            {"kind": "concept", "id": target_id, "logical_id": target_logical_id},
        ]
        self.edge_id = edge_id
        self.statements: list[str] = []

    async def execute(self, query: str, parameters: object = None) -> object:
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        if normalized.startswith("select 'topic' as kind"):
            return _RowsCursor(self.nodes)
        if normalized.startswith("select id, review_status from concept_edges"):
            return _Cursor({"id": self.edge_id, "review_status": "dismissed"})
        if normalized.startswith("with recursive reachable"):
            return _Cursor(None)
        return _Cursor()


@pytest.mark.anyio
async def test_create_prerequisite_reactivates_a_dismissed_edge() -> None:
    source_id = uuid4()
    source_logical_id = uuid4()
    target_id = uuid4()
    target_logical_id = uuid4()
    edge_id = uuid4()
    conn = _DismissedPrerequisiteConnection(
        source_id,
        source_logical_id,
        target_id,
        target_logical_id,
        edge_id,
    )

    await _create_blueprint_relationship(
        conn,
        course_id=uuid4(),
        revision_id=uuid4(),
        instructor_id=uuid4(),
        relationship="requires",
        source_logical_id=source_logical_id,
        target_logical_id=target_logical_id,
        mutation_source="course_director",
    )

    assert any(
        statement.startswith("update concept_edges")
        and "review_status = 'edited'" in statement
        and "dismissed_at = null" in statement
        for statement in conn.statements
    )
    assert not any(
        statement.startswith("insert into concept_edges") for statement in conn.statements
    )


class _BlueprintEvidenceConnection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.statements: list[str] = []

    async def execute(self, query: str, parameters: object = None) -> _RowsCursor:
        self.statements.append(" ".join(query.split()))
        return _RowsCursor(self.rows)


class _DecisionTraceConnection:
    def __init__(self) -> None:
        self.course_id = uuid4()
        self.active_revision_id = uuid4()
        self.working_revision_id = uuid4()
        self.concept_id = uuid4()
        self.concept_logical_id = uuid4()
        self.video_id = uuid4()
        self.question_id = uuid4()
        self.question_logical_id = uuid4()
        self.clip_id = uuid4()
        self.clip_logical_id = uuid4()
        self.attempt_id = uuid4()
        self.route_id = uuid4()
        self.signal_id = uuid4()
        self.proposal_id = uuid4()
        self.statements: list[str] = []
        self.parameters: list[object] = []

    async def execute(self, query: str, parameters: object = None) -> _Cursor:
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        self.parameters.append(parameters)
        if normalized.startswith("select c.id, c.logical_id, c.name"):
            return _Cursor({
                "id": self.concept_id,
                "logical_id": self.concept_logical_id,
                "name": "Iterative venture design",
                "description": "Plans evolve as evidence changes.",
                "review_status": "accepted",
                "topic_id": uuid4(),
                "topic_logical_id": uuid4(),
                "topic_title": "Why plan",
                "start_seconds": Decimal("10"),
                "end_seconds": Decimal("90"),
                "video_id": self.video_id,
                "source_label": "Lecture recording",
            })
        if normalized.startswith("select event.id, event.learner_id"):
            return _Cursor({
                "id": self.route_id,
                "learner_id": uuid4(),
                "attempt_id": self.attempt_id,
                "mastery_before": "not_started",
                "mastery_after": "struggling",
                "action": "remediate",
                "target_concept_id": self.concept_id,
                "target_clip_id": self.clip_id,
                "why": "Incorrect answer matched a reviewed remediation rule.",
                "evidence_snapshot": {"correctness": False, "confidence": 4},
                "created_at": datetime.now(UTC),
                "question_id": self.question_id,
                "correctness": False,
                "confidence": 4,
                "answer": "A finished document",
                "purpose": "lesson",
                "question_logical_id": self.question_logical_id,
                "question_body": "Why is planning iterative?",
            })
        if normalized.startswith("select clip.id, clip.logical_id"):
            return _Cursor({
                "id": self.clip_id,
                "logical_id": self.clip_logical_id,
                "type": "misconception_correction",
                "start_seconds": Decimal("30"),
                "end_seconds": Decimal("60"),
            })
        if normalized.startswith("select id, type, related_entity_type"):
            return _Cursor({
                "id": self.signal_id,
                "type": "stuck_cohort",
                "related_entity_type": "concept",
                "related_entity_id": self.concept_id,
                "ai_diagnosis": {
                    "title": "Learners are stuck on iterative planning",
                    "summary": "One simulated learner is struggling.",
                },
                "status": "open",
                "instructor_action": None,
                "created_at": datetime.now(UTC),
            })
        if normalized.startswith("select proposal.id, proposal.proposal_type"):
            return _Cursor({
                "id": self.proposal_id,
                "proposal_type": "concept_revision",
                "artifact_type": "concept",
                "logical_artifact_id": self.concept_logical_id,
                "proposed_state": {
                    "description": "Contrast a static plan with iterative venture design."
                },
                "rationale": (
                    "The high-confidence misconception supports a contrastive explanation."
                ),
                "status": "proposed",
                "created_at": datetime.now(UTC),
            })
        if normalized.startswith("select citation.id, citation.excerpt"):
            return _Cursor(None)
        raise AssertionError(f"Unexpected decision-trace query: {normalized}")


class _RoutingDeleteConnection:
    def __init__(self, concept_id: UUID, override_id: UUID, default_id: UUID) -> None:
        self.concept_id = concept_id
        self.override_id = override_id
        self.default_id = default_id
        self.statements: list[str] = []

    async def execute(self, query: str, parameters: object = None) -> _Cursor:
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        if normalized.startswith("select id from concepts"):
            return _Cursor({"id": self.concept_id})
        if normalized.startswith("select id from routing_policies"):
            return _Cursor(None)
        if normalized.startswith("insert into routing_policies"):
            return _Cursor({"id": self.default_id})
        if normalized.startswith("delete from routing_policies"):
            return _Cursor(
                {
                    "id": self.override_id,
                    "policy": {
                        "confidence_threshold": 4,
                        "correct_attempts_for_mastery": 2,
                        "advancement_mode": "require_mastery",
                        "max_remediation_attempts": 1,
                    },
                }
            )
        return _Cursor()


class _ConceptTopicConnection:
    def __init__(
        self,
        concept_id: UUID,
        concept_logical_id: UUID,
        previous_topic: dict[str, UUID],
        next_topics: list[dict[str, UUID]],
    ) -> None:
        self.concept_id = concept_id
        self.concept_logical_id = concept_logical_id
        self.previous_topic = previous_topic
        self.next_topics = next_topics
        self.statements: list[str] = []
        self.parameters: list[object] = []

    async def execute(self, query: str, parameters: object = None) -> object:
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        self.parameters.append(parameters)
        if normalized.startswith("select id, logical_id from concepts"):
            return _Cursor({"id": self.concept_id, "logical_id": self.concept_logical_id})
        if normalized.startswith("select id, logical_id from topics"):
            return _RowsCursor(self.next_topics)
        if normalized.startswith("select t.id, t.logical_id from topic_concepts"):
            return _RowsCursor([self.previous_topic])
        return _Cursor()


class _CreateCourseConnection:
    def __init__(self, existing_course_id: UUID) -> None:
        self.existing_course_id = existing_course_id
        self.statements: list[str] = []

    async def __aenter__(self) -> "_CreateCourseConnection":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def execute(self, query: str, parameters: object = None) -> _Cursor:
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        if normalized.startswith("insert into courses"):
            return _Cursor(None)
        if normalized.startswith("select id from courses"):
            return _Cursor({"id": self.existing_course_id})
        raise AssertionError(f"Unexpected query after idempotent course lookup: {normalized}")


def test_message_reconciles_proposal_blocks_with_the_current_proposal_ledger() -> None:
    proposal_id = uuid4()
    instructor_revision = {"summary": "The instructor-edited version"}

    message = _message(
        {
            "id": uuid4(),
            "role": "manifold",
            "content": "Review this private proposal.",
            "blocks": [
                {
                    "type": "proposal",
                    "proposal_id": str(proposal_id),
                    "status": "proposed",
                    "proposed_state": {"summary": "The original version"},
                }
            ],
            "created_at": datetime.now(UTC),
        },
        {str(proposal_id): ("edited", instructor_revision)},
    )

    assert message.blocks[0]["status"] == "edited"
    assert message.blocks[0]["proposed_state"] == instructor_revision


@pytest.mark.anyio
async def test_create_course_reuses_the_existing_idempotent_course_without_children(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instructor_id = uuid4()
    existing_course_id = uuid4()
    connection = _CreateCourseConnection(existing_course_id)
    summary = CourseSummary(
        id=existing_course_id,
        instructor_id=instructor_id,
        title="Mechanics",
        description=None,
        status="draft",
        active_revision_id=None,
        working_revision_id=uuid4(),
        revision_status="building",
        generation_run_id=None,
        generation_status=None,
        generation_phase=None,
        generation_progress=0,
        source_count=0,
        topic_count=0,
        concept_count=0,
        pending_review_count=0,
        open_signal_count=0,
        updated_at=datetime.now(UTC),
    )

    async def fake_connect(*_args: object, **_kwargs: object) -> _CreateCourseConnection:
        return connection

    monkeypatch.setattr(repository_module.psycopg.AsyncConnection, "connect", fake_connect)
    repository = PostgresCourseOSRepository("postgresql://unused")
    repository.get_course = AsyncMock(return_value=summary)  # type: ignore[method-assign]

    created = await repository.create_course(
        instructor_id,
        CourseCreate(
            title="Mechanics",
            brief={"creation_request_id": "request-123"},
        ),
    )

    assert created == summary
    assert any(statement.startswith("insert into courses") for statement in connection.statements)
    assert any(
        statement.startswith("select id from courses")
        for statement in connection.statements
    )
    assert not any(
        statement.startswith("insert into course_revisions")
        for statement in connection.statements
    )


@pytest.mark.anyio
async def test_deleting_last_override_persists_the_displayed_course_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    concept_id = uuid4()
    connection = _RoutingDeleteConnection(concept_id, uuid4(), uuid4())

    @asynccontextmanager
    async def fake_connection(*_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield connection

    monkeypatch.setattr(repository_module, "pooled_connection", fake_connection)
    repository = PostgresCourseOSRepository("postgresql://unused")

    deleted = await repository.delete_routing_policy(
        uuid4(),
        uuid4(),
        uuid4(),
        concept_id,
    )

    assert deleted is True
    default_insert = next(
        index
        for index, statement in enumerate(connection.statements)
        if statement.startswith("insert into routing_policies")
    )
    override_delete = next(
        index
        for index, statement in enumerate(connection.statements)
        if statement.startswith("delete from routing_policies")
    )
    assert default_insert < override_delete


@pytest.mark.anyio
async def test_blueprint_evidence_aggregates_300_concepts_in_one_warm_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [
        {
            "id": uuid4(),
            "attempts": 40,
            "touched_learners": 20,
            "correct_percent": 72.5,
            "confident_percent": 65.0,
            "confident_incorrect": 3,
            "mastery": {"mastered": 12, "practiced": 6, "struggling": 2},
            "route_actions": {"advance": 28, "reinforce": 7, "remediate": 5},
        }
        for _ in range(300)
    ]
    connection = _BlueprintEvidenceConnection(rows)

    @asynccontextmanager
    async def fake_connection(*_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield connection

    monkeypatch.setattr(repository_module, "pooled_connection", fake_connection)
    repository = PostgresCourseOSRepository("postgresql://unused")

    started = perf_counter()
    evidence = await repository.blueprint_evidence(uuid4(), uuid4(), 14, None)
    elapsed_ms = (perf_counter() - started) * 1000

    assert len(evidence) == 300
    assert len(connection.statements) == 1
    assert "left join lateral" in connection.statements[0]
    assert elapsed_ms < 250


@pytest.mark.anyio
async def test_live_decision_trace_follows_signal_to_private_child_revision_proposal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _DecisionTraceConnection()

    @asynccontextmanager
    async def fake_connection(*_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield connection

    monkeypatch.setattr(repository_module, "pooled_connection", fake_connection)
    repository = PostgresCourseOSRepository("postgresql://unused")

    trace = await repository.decision_trace(
        connection.course_id,
        connection.active_revision_id,
        "active",
        connection.concept_id,
    )

    assert trace is not None
    assert trace.complete is True
    assert trace.stages[-1].key == "proposed_revision"
    assert trace.stages[-1].artifact_id == connection.proposal_id
    proposal_query_index = next(
        index
        for index, statement in enumerate(connection.statements)
        if statement.startswith("select proposal.id, proposal.proposal_type")
    )
    assert "task.revision_id = owner_course.working_revision_id" in connection.statements[
        proposal_query_index
    ]
    assert "task_revision.parent_revision_id = %s" in connection.statements[
        proposal_query_index
    ]
    assert connection.parameters[proposal_query_index] == (
        connection.course_id,
        connection.active_revision_id,
        "active",
        connection.active_revision_id,
        str(connection.signal_id),
    )


def test_publication_uses_draft_readiness_without_a_review_bundle_gate() -> None:
    readiness: dict[str, object] = {
        "bundle_count": 0,
        "pending_items": 64,
        "proposed_topics": 0,
        "proposed_concepts": 0,
        "proposed_edges": 0,
        "proposed_questions": 0,
        "reviewed_topics": 5,
        "reviewed_concepts": 8,
        "topics_without_question": 0,
        "concepts_without_policy": 0,
    }

    assert _publication_blockers(readiness) == []

    readiness["proposed_questions"] = 1
    assert _publication_blockers(readiness) == [
        "The editable private draft is still being finalized.",
    ]


@pytest.mark.anyio
async def test_concept_topic_assignment_is_audited_and_invalidates_affected_clips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    concept_id = uuid4()
    concept_logical_id = uuid4()
    previous_topic = {"id": uuid4(), "logical_id": uuid4()}
    next_topics = [
        {"id": uuid4(), "logical_id": uuid4()},
        {"id": uuid4(), "logical_id": uuid4()},
    ]
    connection = _ConceptTopicConnection(
        concept_id,
        concept_logical_id,
        previous_topic,
        next_topics,
    )

    @asynccontextmanager
    async def fake_connection(*_args: object, **_kwargs: object) -> AsyncIterator[object]:
        yield connection

    monkeypatch.setattr(repository_module, "pooled_connection", fake_connection)
    repository = PostgresCourseOSRepository("postgresql://unused")

    await repository.update_blueprint_concept_topics(
        uuid4(),
        uuid4(),
        uuid4(),
        concept_logical_id,
        tuple(topic["logical_id"] for topic in next_topics),
    )

    assert any(
        statement.startswith("delete from topic_concepts") for statement in connection.statements
    )
    assert (
        sum(
            statement.startswith("insert into topic_concepts")
            for statement in connection.statements
        )
        == 2
    )
    assert any(
        statement.startswith("update clips set status = 'superseded'")
        for statement in connection.statements
    )
    assert any(
        statement.startswith("insert into audit_events") for statement in connection.statements
    )
