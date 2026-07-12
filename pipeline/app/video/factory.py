from app.config import Settings
from app.video.base import VideoDeliveryProvider
from app.video.local_provider import LocalVideoDeliveryProvider
from app.video.mux_provider import MuxVideoDeliveryProvider


def build_video_delivery_provider(settings: Settings) -> VideoDeliveryProvider:
    if settings.force_local_video_delivery or settings.video_provider == "local":
        return LocalVideoDeliveryProvider(settings.local_video_storage_path)
    if settings.video_provider == "mux":
        return MuxVideoDeliveryProvider(
            settings.mux_token_id,
            settings.mux_token_secret,
            max_stored_videos=settings.mux_max_stored_videos,
            poll_interval_seconds=settings.mux_poll_interval_seconds,
            poll_timeout_seconds=settings.mux_poll_timeout_seconds,
        )
    msg = f"Unsupported video provider: {settings.video_provider}"
    raise ValueError(msg)
