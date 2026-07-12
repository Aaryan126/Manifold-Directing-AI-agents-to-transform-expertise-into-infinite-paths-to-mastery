from app.config import Settings
from app.segmentation.agent import SegmentationAgent
from app.segmentation.local_agent import LocalHeuristicSegmentationAgent
from app.segmentation.openai_agent import OpenAISegmentationAgent


def build_segmentation_agent(settings: Settings) -> SegmentationAgent:
    if settings.segmentation_provider == "local":
        return LocalHeuristicSegmentationAgent()
    if settings.segmentation_provider != "openai":
        raise ValueError(f"Unsupported segmentation provider: {settings.segmentation_provider}")
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required when SEGMENTATION_PROVIDER=openai")
    return OpenAISegmentationAgent(settings.openai_api_key, settings.llm_model)
