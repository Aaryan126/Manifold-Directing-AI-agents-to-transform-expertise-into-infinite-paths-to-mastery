from app.asr.base import ASRProvider
from app.asr.openai_provider import OpenAIASRProvider
from app.config import Settings


def build_asr_provider(settings: Settings) -> ASRProvider:
    if settings.asr_provider == "openai":
        return OpenAIASRProvider(api_key=settings.openai_api_key)
    msg = f"Unsupported ASR provider: {settings.asr_provider}"
    raise ValueError(msg)
