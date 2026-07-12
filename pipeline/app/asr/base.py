from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TranscriptWord:
    text: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class Transcript:
    text: str
    words: tuple[TranscriptWord, ...]


class ASRProvider(ABC):
    @abstractmethod
    async def transcribe(self, media_path: Path) -> Transcript:
        """Return a timestamped transcript without leaking vendor response shapes."""
