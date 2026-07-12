from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VideoSource:
    local_path: Path
    content_type: str


@dataclass(frozen=True)
class PlaybackReference:
    provider: str
    playback_id: str
    playback_url: str


class VideoDeliveryProvider(ABC):
    @abstractmethod
    async def create_playback_reference(self, source: VideoSource) -> PlaybackReference:
        """Store or register a video and return an internal playback reference."""
