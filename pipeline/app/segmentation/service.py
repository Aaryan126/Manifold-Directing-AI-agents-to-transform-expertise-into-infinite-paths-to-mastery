from uuid import UUID

from app.audit.models import AuditEventCreate
from app.audit.service import (
    AuditService,
    instructor_note_from_state,
    rationale_from_state,
    snapshot,
)
from app.segmentation.agent import SegmentationAgent
from app.segmentation.models import Topic, TopicEdit, TopicProposal, TopicReviewStatus
from app.segmentation.repository import TopicRepository

GAP_TOLERANCE_SECONDS = 3.0


class TopicValidationError(ValueError):
    pass


class SegmentationService:
    def __init__(
        self,
        repository: TopicRepository,
        agent: SegmentationAgent,
        audit_service: AuditService | None = None,
    ) -> None:
        self._repository = repository
        self._agent = agent
        self._audit_service = audit_service

    async def propose_topics(self, video_id: UUID) -> tuple[Topic, ...]:
        transcript = await self._repository.get_video_transcript(video_id)
        if transcript is None:
            raise TopicValidationError("Transcript not found for this video.")
        proposals = await self._agent.propose_topics(transcript)
        validate_proposals(proposals)
        topics = await self._repository.replace_ai_proposals(
            video_id,
            transcript.course_id,
            proposals,
        )
        for topic in topics:
            await self._audit(topic, None, topic, "propose", "ai")
        return topics

    async def list_topics(self, video_id: UUID) -> tuple[Topic, ...]:
        return await self._repository.list_topics(video_id)

    async def edit_topic(self, topic_id: UUID, edit: TopicEdit) -> Topic | None:
        validate_edit(edit)
        previous = await self._repository.get_topic(topic_id)
        topic = await self._repository.edit_topic(topic_id, edit)
        if topic is not None:
            await self._audit(topic, previous, topic, edit.action, "instructor")
        return topic

    async def accept_topic(self, topic_id: UUID) -> Topic | None:
        previous = await self._repository.get_topic(topic_id)
        topic = await self._repository.accept_topic(topic_id)
        if topic is not None:
            await self._audit(topic, previous, topic, "accept", "instructor")
        return topic

    async def dismiss_topic(self, topic_id: UUID) -> Topic | None:
        previous = await self._repository.get_topic(topic_id)
        topic = await self._repository.dismiss_topic(topic_id)
        if topic is not None:
            await self._audit(topic, previous, topic, "dismiss", "instructor")
        return topic

    async def add_manual_topic(self, video_id: UUID, edit: TopicEdit) -> Topic:
        transcript = await self._repository.get_video_transcript(video_id)
        if transcript is None:
            raise TopicValidationError("Transcript not found for this video.")
        validate_edit(edit)
        topic = await self._repository.add_manual_topic(video_id, transcript.course_id, edit)
        await self._audit(topic, None, topic, edit.action, "instructor")
        return topic

    async def merge_topics(self, first_topic_id: UUID, second_topic_id: UUID) -> Topic | None:
        first = await _find_topic(self._repository, first_topic_id)
        second = await _find_topic(self._repository, second_topic_id)
        if first is None or second is None:
            return None
        if first.video_id != second.video_id:
            raise TopicValidationError("Cannot merge topics from different videos.")
        ordered = sorted((first, second), key=lambda topic: topic.start_seconds)
        gap = ordered[1].start_seconds - ordered[0].end_seconds
        if abs(gap) > GAP_TOLERANCE_SECONDS:
            raise TopicValidationError("Only adjacent topics can be merged.")

        merged = TopicEdit(
            title=f"{ordered[0].title} / {ordered[1].title}",
            summary=" ".join(
                summary
                for summary in (ordered[0].summary, ordered[1].summary)
                if summary is not None
            ),
            start_seconds=ordered[0].start_seconds,
            end_seconds=ordered[1].end_seconds,
            action="merge",
        )
        updated = await self.edit_topic(ordered[0].id, merged)
        await self.dismiss_topic(ordered[1].id)
        return updated

    async def split_topic(self, topic_id: UUID, split_seconds: float) -> tuple[Topic, Topic] | None:
        topic = await _find_topic(self._repository, topic_id)
        if topic is None:
            return None
        if not topic.start_seconds < split_seconds < topic.end_seconds:
            raise TopicValidationError("Split time must be inside the topic range.")
        first = await self._repository.add_manual_topic(
            topic.video_id,
            topic.course_id,
            TopicEdit(
                title=f"{topic.title} (part 1)",
                summary=topic.summary or "",
                start_seconds=topic.start_seconds,
                end_seconds=split_seconds,
                action="split",
            ),
        )
        second = await self._repository.add_manual_topic(
            topic.video_id,
            topic.course_id,
            TopicEdit(
                title=f"{topic.title} (part 2)",
                summary=topic.summary or "",
                start_seconds=split_seconds,
                end_seconds=topic.end_seconds,
                action="split",
            ),
        )
        await self.dismiss_topic(topic.id)
        return (first, second)

    async def _audit(
        self,
        topic: Topic,
        previous: Topic | None,
        new: Topic,
        action: str,
        source: str,
    ) -> None:
        if self._audit_service is None:
            return
        previous_state = snapshot(previous)
        new_state = snapshot(new)
        await self._audit_service.record(
            AuditEventCreate(
                course_id=topic.course_id,
                artifact_type="topic",
                artifact_id=topic.id,
                action=action,
                source=source,
                previous_state=previous_state,
                new_state=new_state,
                ai_rationale=rationale_from_state(new_state or previous_state),
                instructor_note=instructor_note_from_state(new_state),
            ),
        )


def validate_edit(edit: TopicEdit) -> None:
    if not edit.title.strip():
        raise TopicValidationError("Topic title is required.")
    if edit.end_seconds <= edit.start_seconds:
        raise TopicValidationError("Topic end time must be after start time.")


def validate_proposals(proposals: tuple[TopicProposal, ...]) -> None:
    if not proposals:
        raise TopicValidationError("Segmentation produced no topics.")
    previous_end: float | None = None
    for proposal in sorted(proposals, key=lambda item: item.start_seconds):
        if proposal.end_seconds <= proposal.start_seconds:
            raise TopicValidationError("Topic end time must be after start time.")
        if previous_end is not None:
            overlap = previous_end - proposal.start_seconds
            gap = proposal.start_seconds - previous_end
            if overlap > GAP_TOLERANCE_SECONDS:
                raise TopicValidationError("Topic ranges cannot overlap.")
            if gap > GAP_TOLERANCE_SECONDS:
                raise TopicValidationError("Topic ranges cannot leave large gaps.")
        previous_end = proposal.end_seconds


async def _find_topic(repository: TopicRepository, topic_id: UUID) -> Topic | None:
    return await repository.get_topic(topic_id)


def is_reviewed(topic: Topic) -> bool:
    return topic.review_status in {TopicReviewStatus.ACCEPTED, TopicReviewStatus.EDITED}
