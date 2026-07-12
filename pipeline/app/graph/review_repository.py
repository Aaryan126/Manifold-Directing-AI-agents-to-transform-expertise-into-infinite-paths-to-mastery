from abc import ABC, abstractmethod
from uuid import UUID

from app.graph.models import (
    Concept,
    ConceptEdit,
    ConceptGraph,
    ConceptGraphEdge,
    ConceptGraphProposal,
    CourseGraphContext,
    EdgeEdit,
)


class ConceptGraphRepository(ABC):
    @abstractmethod
    async def get_course_context(self, course_id: UUID) -> CourseGraphContext | None:
        """Return reviewed topic context for graph generation."""

    @abstractmethod
    async def replace_ai_graph(
        self,
        course_id: UUID,
        proposal: ConceptGraphProposal,
    ) -> ConceptGraph:
        """Persist a fresh AI graph proposal."""

    @abstractmethod
    async def get_graph(self, course_id: UUID) -> ConceptGraph:
        """Return graph including dismissed nodes and edges for review traceability."""

    @abstractmethod
    async def edit_concept(self, concept_id: UUID, edit: ConceptEdit) -> Concept | None:
        """Persist an instructor concept revision."""

    @abstractmethod
    async def accept_concept(self, concept_id: UUID) -> Concept | None:
        """Accept a concept proposal."""

    @abstractmethod
    async def dismiss_concept(self, concept_id: UUID) -> Concept | None:
        """Dismiss a concept while keeping it visible in review context."""

    @abstractmethod
    async def merge_concepts(
        self,
        source_concept_id: UUID,
        target_concept_id: UUID,
    ) -> Concept | None:
        """Merge a duplicate source concept into the target concept."""

    @abstractmethod
    async def add_edge(self, course_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge:
        """Create an instructor-authored prerequisite edge after DAG validation."""

    @abstractmethod
    async def edit_edge(self, edge_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge | None:
        """Edit a prerequisite edge after DAG validation."""

    @abstractmethod
    async def accept_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        """Accept an edge proposal."""

    @abstractmethod
    async def dismiss_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        """Dismiss an edge while keeping it visible in review context."""
