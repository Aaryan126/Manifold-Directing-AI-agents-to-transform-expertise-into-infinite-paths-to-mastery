from abc import ABC, abstractmethod
from uuid import UUID

from app.clips.models import (
    Clip,
    ClipContext,
    ClipFlag,
    ClipMaterializationStatus,
    ClipProposal,
)


class ClipRepository(ABC):
    @abstractmethod
    async def get_context_for_topic(
        self,
        topic_id: UUID,
        include_proposed: bool = False,
    ) -> ClipContext | None:
        pass

    @abstractmethod
    async def list_clips_for_video(self, video_id: UUID) -> tuple[Clip, ...]:
        pass

    @abstractmethod
    async def list_replaceable_clips_for_topic(self, topic_id: UUID) -> tuple[Clip, ...]:
        pass

    @abstractmethod
    async def get_clip(self, clip_id: UUID) -> Clip | None:
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

    @abstractmethod
    async def update_materialization(
        self,
        clip_id: UUID,
        status: ClipMaterializationStatus,
        *,
        playback_provider: str | None = None,
        playback_id: str | None = None,
        error: str | None = None,
    ) -> Clip | None:
        pass
