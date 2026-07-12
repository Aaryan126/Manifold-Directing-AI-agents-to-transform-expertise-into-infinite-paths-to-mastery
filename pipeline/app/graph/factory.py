from app.config import Settings
from app.graph.agent import ConceptGraphAgent
from app.graph.local_agent import LocalHeuristicGraphAgent
from app.graph.openai_agent import OpenAIConceptGraphAgent


def build_concept_graph_agent(settings: Settings) -> ConceptGraphAgent:
    if settings.graph_agent_provider == "local":
        return LocalHeuristicGraphAgent()
    if settings.graph_agent_provider != "openai":
        raise ValueError(f"Unsupported graph agent provider: {settings.graph_agent_provider}")
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required when GRAPH_AGENT_PROVIDER=openai")
    return OpenAIConceptGraphAgent(settings.openai_api_key, settings.llm_model)
