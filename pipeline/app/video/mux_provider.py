from app.video.base import PlaybackReference, VideoDeliveryProvider, VideoSource


class MuxVideoDeliveryProvider(VideoDeliveryProvider):
    """Mux-backed video adapter.

    The production Mux integration will be added with video ingestion. Dev and
    CI use LocalVideoDeliveryProvider so no external credentials are required.
    """

    def __init__(self, token_id: str | None, token_secret: str | None) -> None:
        self._token_id = token_id
        self._token_secret = token_secret

    async def create_playback_reference(self, source: VideoSource) -> PlaybackReference:
        raise NotImplementedError("Mux video delivery integration is scheduled for Phase 1.")
