from decimal import Decimal
from uuid import uuid4

import pytest

from app.segmentation.local_agent import (
    LocalHeuristicSegmentationAgent,
    remove_repeated_intro_noise,
)
from app.segmentation.models import (
    Topic,
    TopicEdit,
    TopicProposal,
    TopicReviewStatus,
    TranscriptWord,
    VideoTranscript,
)
from app.segmentation.postgres_repository import _float_from_row
from app.segmentation.service import SegmentationService, TopicValidationError, validate_proposals
from tests.fakes import MemoryTopicRepository, StaticSegmentationAgent, segmentation_words


def test_validate_proposals_rejects_overlaps_and_large_gaps() -> None:
    with pytest.raises(TopicValidationError, match="overlap"):
        validate_proposals(
            (
                _proposal("First", 0, 600),
                _proposal("Second", 590, 1200),
            )
        )

    with pytest.raises(TopicValidationError, match="large gaps"):
        validate_proposals(
            (
                _proposal("First", 0, 600),
                _proposal("Second", 620, 1200),
            )
        )


def test_postgres_numeric_timestamps_parse_from_decimal() -> None:
    assert _float_from_row(Decimal("12.345")) == 12.345


@pytest.mark.anyio
async def test_segmentation_produces_target_length_topics_for_well_behaved_fixture() -> None:
    transcript = VideoTranscript(
        video_id=uuid4(),
        course_id=uuid4(),
        text="well structured lecture",
        words=segmentation_words(),
    )
    service = SegmentationService(
        repository=MemoryTopicRepository(transcript),
        agent=LocalHeuristicSegmentationAgent(),
    )

    topics = await service.propose_topics(transcript.video_id)

    assert len(topics) == 3
    durations = [topic.end_seconds - topic.start_seconds for topic in topics]
    assert all(10 * 60 <= duration <= 20 * 60 for duration in durations)


def test_repeated_intro_noise_is_ignored_before_segmentation() -> None:
    words = tuple(
        [TranscriptWord("GERRARD", second, second + 0.2) for second in range(8)]
        + [
            TranscriptWord("Thank", 8, 8.2),
            TranscriptWord("you", 9, 9.2),
            TranscriptWord("today", 10, 10.2),
        ]
    )

    cleaned = remove_repeated_intro_noise(words)

    assert cleaned[0].text == "Thank"


@pytest.mark.anyio
async def test_instructor_edit_preserves_ai_proposal_trace() -> None:
    video_id = uuid4()
    transcript = VideoTranscript(
        video_id=video_id,
        course_id=uuid4(),
        text="lecture",
        words=(),
    )
    repository = MemoryTopicRepository(transcript)
    service = SegmentationService(
        repository=repository,
        agent=StaticSegmentationAgent((_proposal("AI title", 0, 700),)),
    )
    proposed = await service.propose_topics(video_id)

    edited = await service.edit_topic(
        proposed[0].id,
        TopicEdit(
            title="Instructor title",
            summary="Instructor summary",
            start_seconds=0,
            end_seconds=720,
            action="edit",
        ),
    )

    assert edited is not None
    assert edited.review_status == TopicReviewStatus.EDITED
    assert edited.ai_proposal is not None
    assert edited.ai_proposal["title"] == "AI title"
    assert edited.instructor_revision is not None
    assert edited.instructor_revision["title"] == "Instructor title"


@pytest.mark.anyio
async def test_list_topics_excludes_rows_from_a_previous_video_course() -> None:
    video_id = uuid4()
    course_id = uuid4()
    transcript = VideoTranscript(
        video_id=video_id,
        course_id=course_id,
        text="lecture",
        words=(),
    )
    repository = MemoryTopicRepository(transcript)
    valid_topic = repository._topic_from_proposal(
        video_id,
        course_id,
        _proposal("Current course", 0, 600),
    )
    stale_topic = Topic(
        id=uuid4(),
        course_id=uuid4(),
        video_id=video_id,
        title="Previous course",
        summary="Should not leak into this workspace.",
        start_seconds=0,
        end_seconds=600,
        review_status=TopicReviewStatus.ACCEPTED,
        ai_proposal=None,
        instructor_revision=None,
        approved_at="now",
        dismissed_at=None,
    )
    repository.topics = {valid_topic.id: valid_topic, stale_topic.id: stale_topic}

    topics = await SegmentationService(
        repository=repository,
        agent=StaticSegmentationAgent(()),
    ).list_topics(video_id)

    assert topics == (valid_topic,)


@pytest.mark.anyio
async def test_merge_and_split_are_stored_as_instructor_revisions() -> None:
    video_id = uuid4()
    transcript = VideoTranscript(video_id=video_id, course_id=uuid4(), text="", words=())
    repository = MemoryTopicRepository(transcript)
    service = SegmentationService(
        repository=repository,
        agent=StaticSegmentationAgent(
            (
                _proposal("Part one", 0, 600),
                _proposal("Part two", 600, 1200),
            )
        ),
    )
    topics = await service.propose_topics(video_id)

    merged = await service.merge_topics(topics[0].id, topics[1].id)

    assert merged is not None
    assert merged.review_status == TopicReviewStatus.EDITED
    assert merged.instructor_revision is not None
    assert merged.instructor_revision["action"] == "merge"
    visible_after_merge = await service.list_topics(video_id)
    assert len(visible_after_merge) == 1

    split = await service.split_topic(merged.id, 600)

    assert split is not None
    assert len(split) == 2
    assert all(topic.review_status == TopicReviewStatus.EDITED for topic in split)
    assert all(topic.instructor_revision is not None for topic in split)


def _proposal(title: str, start: float, end: float) -> TopicProposal:
    return TopicProposal(
        title=title,
        summary=f"{title} summary",
        start_seconds=start,
        end_seconds=end,
        evidence=f"{title} evidence",
        confidence=0.8,
    )
