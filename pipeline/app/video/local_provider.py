from pathlib import Path

from app.video.base import PlaybackReference, VideoDeliveryProvider, VideoSource


class LocalVideoDeliveryProvider(VideoDeliveryProvider):
    def __init__(self, storage_path: str) -> None:
        self._storage_path = Path(storage_path)

    async def create_playback_reference(self, source: VideoSource) -> PlaybackReference:
        playback_id = source.local_path.name
        return PlaybackReference(
            provider="local",
            playback_id=playback_id,
            playback_url=f"/media/{playback_id}",
        )
