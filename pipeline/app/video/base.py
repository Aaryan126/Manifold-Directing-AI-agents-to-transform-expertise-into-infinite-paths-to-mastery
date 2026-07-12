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
    asset_id: str | None = None


@dataclass(frozen=True)
class DeliveryCapacity:
    provider: str
    stored_count: int
    max_stored: int | None

    @property
    def can_upload(self) -> bool:
        return self.max_stored is None or self.stored_count < self.max_stored

    @property
    def remaining(self) -> int | None:
        if self.max_stored is None:
            return None
        return max(self.max_stored - self.stored_count, 0)


class VideoDeliveryError(RuntimeError):
    pass


class VideoCapacityError(VideoDeliveryError):
    pass


class VideoDeliveryProvider(ABC):
    @abstractmethod
    async def capacity(self) -> DeliveryCapacity:
        """Return current provider storage usage and configured limit."""

    @abstractmethod
    async def create_playback_reference(self, source: VideoSource) -> PlaybackReference:
        """Store or register a video and return an internal playback reference."""
