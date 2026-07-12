from abc import ABC, abstractmethod

from app.graph.models import ConceptGraphProposal, CourseGraphContext


class ConceptGraphAgent(ABC):
    @abstractmethod
    async def propose_graph(self, context: CourseGraphContext) -> ConceptGraphProposal:
        """Return concept/prerequisite proposals without leaking provider response shapes."""
