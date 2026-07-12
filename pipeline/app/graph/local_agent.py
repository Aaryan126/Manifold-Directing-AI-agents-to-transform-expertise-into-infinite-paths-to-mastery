from app.graph.agent import ConceptGraphAgent
from app.graph.models import ConceptGraphProposal, ConceptProposal, CourseGraphContext, EdgeProposal


class LocalHeuristicGraphAgent(ConceptGraphAgent):
    async def propose_graph(self, context: CourseGraphContext) -> ConceptGraphProposal:
        concepts: list[ConceptProposal] = []
        edges: list[EdgeProposal] = []
        previous_key: str | None = None

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
            if previous_key is not None:
                edges.append(
                    EdgeProposal(
                        from_key=previous_key,
                        to_key=key,
                        rationale="Sequential lecture structure suggests prerequisite order.",
                        evidence=f"{previous_key} appears before {key}.",
                        confidence=0.45,
                    )
                )
            previous_key = key

        return ConceptGraphProposal(concepts=tuple(concepts), edges=tuple(edges))
