from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Any
from uuid import UUID, uuid4

import pytest

import app.course_os.postgres_repository as repository_module
from app.course_os.postgres_repository import PostgresCourseOSRepository, _publication_blockers


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


class _BlueprintEvidenceConnection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.statements: list[str] = []

    async def execute(self, query: str, parameters: object = None) -> _RowsCursor:
        self.statements.append(" ".join(query.split()))
        return _RowsCursor(self.rows)


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


def test_published_update_does_not_reuse_first_publication_bundle_gate() -> None:
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

    assert _publication_blockers(readiness, is_update=True) == []
    assert _publication_blockers(readiness, is_update=False) == [
        "Review bundles have not been assembled.",
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
