from abc import ABC, abstractmethod

from app.segmentation.models import TopicProposal, VideoTranscript


class SegmentationAgent(ABC):
    @abstractmethod
    async def propose_topics(self, transcript: VideoTranscript) -> tuple[TopicProposal, ...]:
        """Return topic proposals without leaking provider response shapes."""
