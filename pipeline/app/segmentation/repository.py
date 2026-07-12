from abc import ABC, abstractmethod
from uuid import UUID

from app.segmentation.models import Topic, TopicEdit, TopicProposal, VideoTranscript


class TopicRepository(ABC):
    @abstractmethod
    async def get_video_transcript(self, video_id: UUID) -> VideoTranscript | None:
        """Return the transcript and course context needed for segmentation."""

    @abstractmethod
    async def replace_ai_proposals(
        self,
        video_id: UUID,
        course_id: UUID,
        proposals: tuple[TopicProposal, ...],
    ) -> tuple[Topic, ...]:
        """Persist new AI topic proposals for a video."""

    @abstractmethod
    async def list_topics(self, video_id: UUID) -> tuple[Topic, ...]:
        """Return non-deleted topics for the video in timeline order."""

    @abstractmethod
    async def get_topic(self, topic_id: UUID) -> Topic | None:
        """Return one topic by id, including dismissed topics for trace operations."""

    @abstractmethod
    async def edit_topic(self, topic_id: UUID, edit: TopicEdit) -> Topic | None:
        """Persist a manual instructor revision distinct from the original AI proposal."""

    @abstractmethod
    async def accept_topic(self, topic_id: UUID) -> Topic | None:
        """Mark a proposed or edited topic as accepted."""

    @abstractmethod
    async def dismiss_topic(self, topic_id: UUID) -> Topic | None:
        """Dismiss a topic without deleting its trace."""

    @abstractmethod
    async def add_manual_topic(
        self,
        video_id: UUID,
        course_id: UUID,
        edit: TopicEdit,
    ) -> Topic:
        """Create an instructor-authored topic."""
