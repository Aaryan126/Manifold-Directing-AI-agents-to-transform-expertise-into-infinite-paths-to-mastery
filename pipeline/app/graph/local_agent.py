from app.graph.agent import ConceptGraphAgent
from app.graph.models import ConceptGraphProposal, ConceptProposal, CourseGraphContext


class LocalHeuristicGraphAgent(ConceptGraphAgent):
    async def propose_graph(self, context: CourseGraphContext) -> ConceptGraphProposal:
        concepts: list[ConceptProposal] = []
        for index, topic in enumerate(context.topics, start=1):
            key = f"topic-{index}"
            concepts.append(
                ConceptProposal(
                    key=key,
                    name=topic.title,
                    description=topic.summary or f"Core idea from {topic.title}",
                    topic_ids=(topic.id,),
                    evidence=topic.summary or topic.title,
                    confidence=0.55,
                )
            )
        return ConceptGraphProposal(concepts=tuple(concepts), edges=())
