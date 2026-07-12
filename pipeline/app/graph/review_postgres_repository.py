from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.graph.models import (
    Concept,
    ConceptEdit,
    ConceptGraph,
    ConceptGraphEdge,
    ConceptGraphProposal,
    ConceptProposal,
    CourseGraphContext,
    EdgeEdit,
    EdgeProposal,
    GraphReviewStatus,
    TopicContext,
)
from app.graph.review_repository import ConceptGraphRepository


class PostgresConceptGraphRepository(ConceptGraphRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def get_course_context(self, course_id: UUID) -> CourseGraphContext | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            rows = await (
                await conn.execute(
                    """
                    select id, title, summary, start_seconds, end_seconds
                    from topics
                    where course_id = %s
                      and review_status in ('accepted', 'edited')
                    order by start_seconds asc
                    """,
                    (course_id,),
                )
            ).fetchall()
            if not rows:
                return None
            return CourseGraphContext(
                course_id=course_id,
                topics=tuple(
                    TopicContext(
                        id=UUID(str(row["id"])),
                        title=str(row["title"]),
                        summary=str(row["summary"] or ""),
                        start_seconds=float(row["start_seconds"]),
                        end_seconds=float(row["end_seconds"]),
                    )
                    for row in rows
                ),
            )

    async def replace_ai_graph(
        self,
        course_id: UUID,
        proposal: ConceptGraphProposal,
    ) -> ConceptGraph:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await conn.execute(
                """
                delete from concept_edges
                where review_status = 'proposed'
                  and from_concept_id in (select id from concepts where course_id = %s)
                """,
                (course_id,),
            )
            await conn.execute(
                "delete from concepts where course_id = %s and review_status = 'proposed'",
                (course_id,),
            )
            key_to_id: dict[str, UUID] = {}
            for concept in proposal.concepts:
                row = await (
                    await conn.execute(
                        """
                        insert into concepts (
                          course_id, name, description, ai_proposal, review_status
                        )
                        values (%s, %s, %s, %s::jsonb, 'proposed')
                        on conflict (course_id, name) do update
                        set description = excluded.description,
                            ai_proposal = excluded.ai_proposal,
                            review_status = 'proposed',
                            dismissed_at = null,
                            merged_into_concept_id = null,
                            updated_at = now()
                        returning id
                        """,
                        (
                            course_id,
                            concept.name,
                            concept.description,
                            Jsonb(_concept_proposal_json(concept)),
                        ),
                    )
                ).fetchone()
                if row is None:
                    raise RuntimeError("Failed to persist concept proposal.")
                key_to_id[concept.key] = UUID(str(row["id"]))

                for topic_id in concept.topic_ids:
                    await conn.execute(
                        """
                        insert into topic_concepts (topic_id, concept_id)
                        values (%s, %s)
                        on conflict do nothing
                        """,
                        (topic_id, row["id"]),
                    )

            for edge in proposal.edges:
                from_id = key_to_id.get(edge.from_key)
                to_id = key_to_id.get(edge.to_key)
                if from_id is None or to_id is None or from_id == to_id:
                    continue
                await self._raise_if_cycle(conn, from_id, to_id)
                await conn.execute(
                    """
                    insert into concept_edges (
                      from_concept_id, to_concept_id, relationship, ai_proposal, review_status
                    )
                    values (%s, %s, 'requires', %s::jsonb, 'proposed')
                    on conflict (from_concept_id, to_concept_id, relationship) do update
                    set ai_proposal = excluded.ai_proposal,
                        review_status = 'proposed',
                        dismissed_at = null,
                        updated_at = now()
                    """,
                    (from_id, to_id, Jsonb(_edge_proposal_json(edge))),
                )

        return await self.get_graph(course_id)

    async def get_graph(self, course_id: UUID) -> ConceptGraph:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            concepts = await (
                await conn.execute(
                    "select * from concepts where course_id = %s order by name asc",
                    (course_id,),
                )
            ).fetchall()
            edges = await (
                await conn.execute(
                    """
                    select e.*
                    from concept_edges e
                    join concepts c on c.id = e.from_concept_id
                    where c.course_id = %s
                    order by e.created_at asc
                    """,
                    (course_id,),
                )
            ).fetchall()
            return ConceptGraph(
                course_id=course_id,
                concepts=tuple(_concept_from_row(row) for row in concepts),
                edges=tuple(_edge_from_row(row) for row in edges),
            )

    async def edit_concept(self, concept_id: UUID, edit: ConceptEdit) -> Concept | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update concepts
                    set name = %s,
                        description = %s,
                        instructor_revision = %s::jsonb,
                        review_status = 'edited',
                        approved_at = now(),
                        dismissed_at = null,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (edit.name, edit.description, Jsonb(_concept_edit_json(edit)), concept_id),
                )
            ).fetchone()
            return _concept_from_row(row) if row else None

    async def get_concept(self, concept_id: UUID) -> Concept | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await self._get_concept_row(conn, concept_id)
            return _concept_from_row(row) if row else None

    async def accept_concept(self, concept_id: UUID) -> Concept | None:
        return await self._update_concept_status(concept_id, GraphReviewStatus.ACCEPTED)

    async def dismiss_concept(self, concept_id: UUID) -> Concept | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    update concepts
                    set review_status = 'dismissed',
                        dismissed_at = now(),
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (concept_id,),
                )
            ).fetchone()
            await conn.execute(
                """
                update concept_edges
                set review_status = 'dismissed',
                    dismissed_at = now(),
                    updated_at = now(),
                    instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                      || '{"action":"auto_dismiss_orphaned_by_concept"}'::jsonb
                where from_concept_id = %s or to_concept_id = %s
                """,
                (concept_id, concept_id),
            )
            return _concept_from_row(row) if row else None

    async def merge_concepts(
        self,
        source_concept_id: UUID,
        target_concept_id: UUID,
    ) -> Concept | None:
        if source_concept_id == target_concept_id:
            raise ValueError("Cannot merge a concept into itself.")
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            source = await self._get_concept_row(conn, source_concept_id)
            target = await self._get_concept_row(conn, target_concept_id)
            if source is None or target is None:
                return None
            await conn.execute(
                """
                insert into topic_concepts (topic_id, concept_id)
                select topic_id, %s
                from topic_concepts
                where concept_id = %s
                on conflict do nothing
                """,
                (target_concept_id, source_concept_id),
            )
            await conn.execute(
                """
                update concept_edges
                set from_concept_id = %s,
                    instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                      || '{"action":"merge_relink_source"}'::jsonb,
                    review_status = 'edited',
                    approved_at = now(),
                    updated_at = now()
                where from_concept_id = %s
                  and to_concept_id <> %s
                """,
                (target_concept_id, source_concept_id, target_concept_id),
            )
            await conn.execute(
                """
                update concept_edges
                set to_concept_id = %s,
                    instructor_revision = coalesce(instructor_revision, '{}'::jsonb)
                      || '{"action":"merge_relink_target"}'::jsonb,
                    review_status = 'edited',
                    approved_at = now(),
                    updated_at = now()
                where to_concept_id = %s
                  and from_concept_id <> %s
                """,
                (target_concept_id, source_concept_id, target_concept_id),
            )
            await conn.execute(
                """
                update concept_edges
                set review_status = 'dismissed',
                    dismissed_at = now(),
                    updated_at = now()
                where from_concept_id = to_concept_id
                   or from_concept_id = %s
                   or to_concept_id = %s
                """,
                (source_concept_id, source_concept_id),
            )
            row = await (
                await conn.execute(
                    """
                    update concepts
                    set review_status = 'dismissed',
                        dismissed_at = now(),
                        merged_into_concept_id = %s,
                        instructor_revision = %s::jsonb,
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (
                        target_concept_id,
                        Jsonb(
                            {
                                "action": "merge",
                                "merged_into_concept_id": str(target_concept_id),
                            }
                        ),
                        source_concept_id,
                    ),
                )
            ).fetchone()
            return _concept_from_row(row) if row else None

    async def add_edge(self, course_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge:
        del course_id
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await self._raise_if_cycle(conn, edit.from_concept_id, edit.to_concept_id)
            row = await (
                await conn.execute(
                    """
                    insert into concept_edges (
                      from_concept_id, to_concept_id, relationship, instructor_revision,
                      review_status, approved_at
                    )
                    values (%s, %s, 'requires', %s::jsonb, 'edited', now())
                    on conflict (from_concept_id, to_concept_id, relationship) do update
                    set instructor_revision = excluded.instructor_revision,
                        review_status = 'edited',
                        dismissed_at = null,
                        approved_at = now(),
                        updated_at = now()
                    returning *
                    """,
                    (
                        edit.from_concept_id,
                        edit.to_concept_id,
                        Jsonb(_edge_edit_json(edit)),
                    ),
                )
            ).fetchone()
            if row is None:
                raise RuntimeError("Failed to create concept edge.")
            return _edge_from_row(row)

    async def edit_edge(self, edge_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            await self._raise_if_cycle(conn, edit.from_concept_id, edit.to_concept_id, edge_id)
            row = await (
                await conn.execute(
                    """
                    update concept_edges
                    set from_concept_id = %s,
                        to_concept_id = %s,
                        instructor_revision = %s::jsonb,
                        review_status = 'edited',
                        dismissed_at = null,
                        approved_at = now(),
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (
                        edit.from_concept_id,
                        edit.to_concept_id,
                        Jsonb(_edge_edit_json(edit)),
                        edge_id,
                    ),
                )
            ).fetchone()
            return _edge_from_row(row) if row else None

    async def get_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute("select * from concept_edges where id = %s", (edge_id,))
            ).fetchone()
            return _edge_from_row(row) if row else None

    async def course_id_for_edge(self, edge_id: UUID) -> UUID | None:
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    select c.course_id
                    from concept_edges e
                    join concepts c on c.id = e.from_concept_id
                    where e.id = %s
                    """,
                    (edge_id,),
                )
            ).fetchone()
            return UUID(str(row["course_id"])) if row else None

    async def accept_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        return await self._update_edge_status(edge_id, GraphReviewStatus.ACCEPTED)

    async def dismiss_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        return await self._update_edge_status(edge_id, GraphReviewStatus.DISMISSED)

    async def _raise_if_cycle(
        self,
        conn: psycopg.AsyncConnection[dict[str, Any]],
        from_id: UUID,
        to_id: UUID,
        ignore_edge_id: UUID | None = None,
    ) -> None:
        if from_id == to_id:
            raise ValueError("Concept edge cannot point to itself.")
        rows = await conn.execute(
            """
            with recursive descendants(id) as (
              select %s::uuid
              union
              select e.to_concept_id
              from concept_edges e
              join descendants d on e.from_concept_id = d.id
              where e.review_status <> 'dismissed'
                and (%s::uuid is null or e.id <> %s::uuid)
            )
            select 1 from descendants where id = %s::uuid limit 1
            """,
            (to_id, ignore_edge_id, ignore_edge_id, from_id),
        )
        if await rows.fetchone() is not None:
            raise ValueError("Concept edge would create a cycle.")

    async def _update_concept_status(
        self,
        concept_id: UUID,
        status: GraphReviewStatus,
    ) -> Concept | None:
        dismissed_expr = "now()" if status == GraphReviewStatus.DISMISSED else "null"
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    f"""
                    update concepts
                    set review_status = %s,
                        approved_at = case when %s in ('accepted', 'edited') then now()
                                          else approved_at end,
                        dismissed_at = {dismissed_expr},
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (status.value, status.value, concept_id),
                )
            ).fetchone()
            return _concept_from_row(row) if row else None

    async def _update_edge_status(
        self,
        edge_id: UUID,
        status: GraphReviewStatus,
    ) -> ConceptGraphEdge | None:
        dismissed_expr = "now()" if status == GraphReviewStatus.DISMISSED else "null"
        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as conn:
            row = await (
                await conn.execute(
                    f"""
                    update concept_edges
                    set review_status = %s,
                        approved_at = case when %s in ('accepted', 'edited') then now()
                                          else approved_at end,
                        dismissed_at = {dismissed_expr},
                        updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (status.value, status.value, edge_id),
                )
            ).fetchone()
            return _edge_from_row(row) if row else None

    async def _get_concept_row(
        self,
        conn: psycopg.AsyncConnection[dict[str, Any]],
        concept_id: UUID,
    ) -> dict[str, Any] | None:
        rows = await conn.execute("select * from concepts where id = %s", (concept_id,))
        return await rows.fetchone()


def _concept_proposal_json(concept: ConceptProposal) -> dict[str, object]:
    return {
        "key": concept.key,
        "name": concept.name,
        "description": concept.description,
        "topic_ids": [str(topic_id) for topic_id in concept.topic_ids],
        "evidence": concept.evidence,
        "confidence": concept.confidence,
    }


def _edge_proposal_json(edge: EdgeProposal) -> dict[str, object]:
    return {
        "from_key": edge.from_key,
        "to_key": edge.to_key,
        "rationale": edge.rationale,
        "evidence": edge.evidence,
        "confidence": edge.confidence,
    }


def _concept_edit_json(edit: ConceptEdit) -> dict[str, object]:
    return {"name": edit.name, "description": edit.description, "action": edit.action}


def _edge_edit_json(edit: EdgeEdit) -> dict[str, object]:
    return {
        "from_concept_id": str(edit.from_concept_id),
        "to_concept_id": str(edit.to_concept_id),
        "rationale": edit.rationale,
        "action": edit.action,
    }


def _concept_from_row(row: dict[str, Any]) -> Concept:
    return Concept(
        id=UUID(str(row["id"])),
        course_id=UUID(str(row["course_id"])),
        name=str(row["name"]),
        description=str(row["description"]) if row["description"] else None,
        review_status=GraphReviewStatus(str(row["review_status"])),
        ai_proposal=row["ai_proposal"] if isinstance(row["ai_proposal"], dict) else None,
        instructor_revision=(
            row["instructor_revision"] if isinstance(row["instructor_revision"], dict) else None
        ),
        approved_at=str(row["approved_at"]) if row["approved_at"] else None,
        dismissed_at=str(row["dismissed_at"]) if row["dismissed_at"] else None,
        merged_into_concept_id=(
            UUID(str(row["merged_into_concept_id"])) if row["merged_into_concept_id"] else None
        ),
    )


def _edge_from_row(row: dict[str, Any]) -> ConceptGraphEdge:
    return ConceptGraphEdge(
        id=UUID(str(row["id"])),
        from_concept_id=UUID(str(row["from_concept_id"])),
        to_concept_id=UUID(str(row["to_concept_id"])),
        relationship=str(row["relationship"]),
        review_status=GraphReviewStatus(str(row["review_status"])),
        ai_proposal=row["ai_proposal"] if isinstance(row["ai_proposal"], dict) else None,
        instructor_revision=(
            row["instructor_revision"] if isinstance(row["instructor_revision"], dict) else None
        ),
        approved_at=str(row["approved_at"]) if row["approved_at"] else None,
        dismissed_at=str(row["dismissed_at"]) if row["dismissed_at"] else None,
    )
