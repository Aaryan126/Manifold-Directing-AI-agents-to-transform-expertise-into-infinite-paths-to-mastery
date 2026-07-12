from app.asr.factory import build_asr_provider
from app.asr.openai_provider import OpenAIASRProvider
from app.config import Settings
from app.video.factory import build_video_delivery_provider
from app.video.local_provider import LocalVideoDeliveryProvider
from app.video.mux_provider import MuxVideoDeliveryProvider


def test_asr_provider_factory_returns_openai_adapter() -> None:
    provider = build_asr_provider(Settings(asr_provider="openai", openai_api_key="test-key"))

    assert isinstance(provider, OpenAIASRProvider)


def test_video_provider_factory_returns_local_adapter_by_default() -> None:
    provider = build_video_delivery_provider(Settings(video_provider="local"))

    assert isinstance(provider, LocalVideoDeliveryProvider)


def test_video_provider_factory_can_return_mux_adapter() -> None:
    provider = build_video_delivery_provider(Settings(video_provider="mux"))

    assert isinstance(provider, MuxVideoDeliveryProvider)
