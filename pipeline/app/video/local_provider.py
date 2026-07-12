from pathlib import Path

from app.video.base import DeliveryCapacity, PlaybackReference, VideoDeliveryProvider, VideoSource


class LocalVideoDeliveryProvider(VideoDeliveryProvider):
    def __init__(self, storage_path: str) -> None:
        self._storage_path = Path(storage_path)

    async def capacity(self) -> DeliveryCapacity:
        return DeliveryCapacity(provider="local", stored_count=0, max_stored=None)

    async def create_playback_reference(self, source: VideoSource) -> PlaybackReference:
        playback_id = source.local_path.name
        return PlaybackReference(
            provider="local",
            playback_id=playback_id,
            playback_url=f"/media/{playback_id}",
        )
