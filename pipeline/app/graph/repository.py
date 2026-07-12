from abc import ABC, abstractmethod
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ConceptEdge:
    from_concept_id: UUID
    to_concept_id: UUID
    relationship: str = "requires"


class GraphRepository(ABC):
    @abstractmethod
    async def add_edge(self, edge: ConceptEdge) -> None:
        """Persist an edge after DAG validation."""

    @abstractmethod
    async def eligible_next_concepts(
        self,
        course_id: UUID,
        mastered_concept_ids: set[UUID],
    ) -> set[UUID]:
        """Return concepts whose prerequisites are all mastered."""
