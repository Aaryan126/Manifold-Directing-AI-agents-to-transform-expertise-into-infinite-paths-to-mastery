from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
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
