from abc import ABC, abstractmethod
from uuid import UUID

from app.clips.models import Clip, ClipContext, ClipFlag, ClipProposal


class ClipRepository(ABC):
    @abstractmethod
    async def get_context_for_topic(self, topic_id: UUID) -> ClipContext | None:
        pass

    @abstractmethod
    async def list_clips_for_video(self, video_id: UUID) -> tuple[Clip, ...]:
        pass

    @abstractmethod
    async def replace_topic_clips(
        self,
        topic_id: UUID,
        proposals: tuple[ClipProposal, ...],
    ) -> tuple[Clip, ...]:
        pass

    @abstractmethod
    async def flag_clip(self, clip_id: UUID, flag: ClipFlag) -> Clip | None:
        pass

    @abstractmethod
    async def get_clip_context(self, clip_id: UUID) -> tuple[Clip, ClipContext] | None:
        pass

    @abstractmethod
    async def supersede_clip(
        self,
        clip_id: UUID,
        proposal: ClipProposal,
        note: str,
    ) -> Clip | None:
        pass

