from abc import ABC, abstractmethod

from app.clips.models import ClipContext, ClipProposal


class ClipExtractionAgent(ABC):
    @abstractmethod
    async def propose_clips(
        self,
        context: ClipContext,
        instructor_notes: str | None = None,
    ) -> tuple[ClipProposal, ...]:
        pass

