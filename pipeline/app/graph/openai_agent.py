from uuid import UUID

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.graph.agent import ConceptGraphAgent
from app.graph.models import (
    ConceptGraphProposal,
    ConceptProposal,
    CourseGraphContext,
    EdgeProposal,
    TopicContext,
)


class _ConceptOutput(BaseModel):
    key: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    topic_ids: list[UUID]
    evidence: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class _EdgeOutput(BaseModel):
    from_key: str = Field(min_length=1)
    to_key: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class _GraphOutput(BaseModel):
    concepts: list[_ConceptOutput]
    edges: list[_EdgeOutput]


class OpenAIConceptGraphAgent(ConceptGraphAgent):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def propose_graph(self, context: CourseGraphContext) -> ConceptGraphProposal:
        response = await self._client.responses.parse(
            model=self._model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You build instructor-reviewable concept prerequisite graphs from "
                        "reviewed lecture topics. Extract one to three independently assessable, "
                        "routable concepts per topic. Prefer one concept spanning multiple topics "
                        "over repeated near-duplicates. A concept should represent learner "
                        "mastery, not merely restate a topic title or isolate a minor fact. Add a "
                        "requires edge only when understanding the source is genuinely necessary "
                        "before the target; chronology, adjacency, and association are not "
                        "prerequisites. Keep the graph sparse, use at most two direct "
                        "prerequisites per concept, and return a DAG. Express uncertainty as low "
                        "confidence "
                        "rather than hiding it. "
                        "Include transcript/topic evidence for every node and edge."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Build a concept graph from these reviewed topics:\n"
                        f"{[_topic_payload(topic) for topic in context.topics]}"
                    ),
                },
            ],
            text_format=_GraphOutput,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI graph response did not match the expected schema.")
        return ConceptGraphProposal(
            concepts=tuple(
                ConceptProposal(
                    key=concept.key,
                    name=concept.name,
                    description=concept.description,
                    topic_ids=tuple(concept.topic_ids),
                    evidence=concept.evidence,
                    confidence=concept.confidence,
                )
                for concept in parsed.concepts
            ),
            edges=tuple(
                EdgeProposal(
                    from_key=edge.from_key,
                    to_key=edge.to_key,
                    rationale=edge.rationale,
                    evidence=edge.evidence,
                    confidence=edge.confidence,
                )
                for edge in parsed.edges
            ),
        )


def _topic_payload(topic: TopicContext) -> dict[str, object]:
    return {
        "id": str(topic.id),
        "title": topic.title,
        "summary": topic.summary,
        "start_seconds": topic.start_seconds,
        "end_seconds": topic.end_seconds,
    }
