from uuid import UUID

import psycopg

from app.db.pool import pooled_connection
from app.graph.repository import ConceptEdge, GraphRepository


class PostgresGraphRepository(GraphRepository):
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def add_edge(self, edge: ConceptEdge) -> None:
        if edge.relationship != "requires":
            msg = "Only requires edges are supported in the prerequisite graph."
            raise ValueError(msg)
        async with pooled_connection(self._database_url) as conn:
            await self._raise_if_cycle(conn, edge)
            await conn.execute(
                """
                insert into concept_edges (from_concept_id, to_concept_id, relationship)
                values (%s, %s, 'requires')
                on conflict (from_concept_id, to_concept_id, relationship) do nothing
                """,
                (edge.from_concept_id, edge.to_concept_id),
            )

    async def eligible_next_concepts(
        self,
        course_id: UUID,
        mastered_concept_ids: set[UUID],
    ) -> set[UUID]:
        async with pooled_connection(self._database_url) as conn:
            rows = await conn.execute(
                """
                select c.id
                from concepts c
                where c.course_id = %s
                  and not (c.id = any(%s::uuid[]))
                  and not exists (
                    select 1
                    from concept_edges e
                    where e.to_concept_id = c.id
                      and not (e.from_concept_id = any(%s::uuid[]))
                  )
                """,
                (course_id, list(mastered_concept_ids), list(mastered_concept_ids)),
            )
            return {row[0] async for row in rows}

    async def _raise_if_cycle(
        self,
        conn: psycopg.AsyncConnection[tuple[object, ...]],
        edge: ConceptEdge,
    ) -> None:
        rows = await conn.execute(
            """
            with recursive descendants(id) as (
              select %s::uuid
              union
              select e.to_concept_id
              from concept_edges e
              join descendants d on e.from_concept_id = d.id
            )
            select 1 from descendants where id = %s::uuid limit 1
            """,
            (edge.to_concept_id, edge.from_concept_id),
        )
        if await rows.fetchone() is not None:
            msg = "Concept edge would create a cycle."
            raise ValueError(msg)
