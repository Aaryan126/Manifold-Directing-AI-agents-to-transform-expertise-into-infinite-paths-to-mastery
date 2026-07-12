from app.clips.agent import ClipExtractionAgent
from app.clips.local_agent import LocalClipExtractionAgent
from app.clips.openai_agent import OpenAIClipExtractionAgent
from app.config import Settings


def build_clip_extraction_agent(settings: Settings) -> ClipExtractionAgent:
    if settings.clip_agent_provider == "local" or not settings.openai_api_key:
        return LocalClipExtractionAgent()
    if settings.clip_agent_provider == "openai":
        return OpenAIClipExtractionAgent(settings.openai_api_key, settings.llm_model)
    raise ValueError(f"Unsupported clip agent provider: {settings.clip_agent_provider}")

