from pathlib import Path
from uuid import UUID, uuid4

import pytest

from app.clips.agent import ClipExtractionAgent
from app.clips.boundaries import is_clean_boundary, snap_proposal_to_clean_boundaries
from app.clips.materializer import ClipMaterializer
from app.clips.models import (
    Clip,
    ClipConcept,
    ClipContext,
    ClipFlag,
    ClipMaterializationStatus,
    ClipProposal,
    ClipStatus,
    ClipTopicContext,
    ClipType,
)
from app.clips.repository import ClipRepository
from app.clips.service import ClipService, ClipValidationError, normalize_snapped_overlaps
from app.segmentation.models import TranscriptWord


@pytest.mark.anyio
async def test_generate_clips_snaps_boundaries_to_sentence_word_timestamps() -> None:
    topic_id = uuid4()
    concept_id = uuid4()
    context = _clip_context(topic_id, concept_id)
    service = ClipService(
        repository=MemoryClipRepository(context),
        agent=StaticClipAgent(
            (
                ClipProposal(
                    title="Definition",
                    start_seconds=0.3,
                    end_seconds=18.7,
                    type=ClipType.DEFINITION,
                    difficulty="introductory",
                    concept_ids=(concept_id,),
                    rationale="Defines the concept.",
                    confidence=0.9,
                ),
            )
        ),
    )

    clips = await service.generate_clips_for_topic(topic_id)

    assert len(clips) == 1
    assert clips[0].start_seconds == 0.0
    assert clips[0].end_seconds == 20.0
    assert is_clean_boundary(clips[0].start_seconds, clips[0].end_seconds, context.words)


@pytest.mark.anyio
async def test_generate_clips_rejects_unknown_concept_tags() -> None:
    topic_id = uuid4()
    concept_id = uuid4()
    context = _clip_context(topic_id, concept_id)
    service = ClipService(
        repository=MemoryClipRepository(context),
        agent=StaticClipAgent(
            (
                ClipProposal(
                    title="Unknown tag",
                    start_seconds=0,
                    end_seconds=20,
                    type=ClipType.EXPLANATION,
                    difficulty="standard",
                    concept_ids=(uuid4(),),
                    rationale="Bad tag.",
                    confidence=0.4,
                ),
            )
        ),
    )

    with pytest.raises(ClipValidationError, match="outside the topic graph"):
        await service.generate_clips_for_topic(topic_id)


@pytest.mark.anyio
async def test_flag_then_recut_supersedes_original_clip() -> None:
    topic_id = uuid4()
    concept_id = uuid4()
    context = _clip_context(topic_id, concept_id)
    repository = MemoryClipRepository(context)
    service = ClipService(
        repository=repository,
        agent=StaticClipAgent(
            (
                ClipProposal(
                    title="Original",
                    start_seconds=0,
                    end_seconds=20,
                    type=ClipType.EXPLANATION,
                    difficulty="standard",
                    concept_ids=(concept_id,),
                    rationale="Initial cut.",
                    confidence=0.8,
                ),
            )
        ),
    )
    original = (await service.generate_clips_for_topic(topic_id))[0]

    flagged = await service.flag_clip(original.id, "Cut starts too abruptly.")
    replacement = await service.recut_clip(original.id, "Start at the full setup sentence.")

    assert flagged is not None
    assert flagged.status == ClipStatus.FLAGGED
    assert replacement is not None
    assert replacement.source_clip_id == original.id
    assert repository.clips[original.id].status == ClipStatus.SUPERSEDED
    assert repository.clips[original.id].superseded_by_clip_id == replacement.id


@pytest.mark.anyio
async def test_generate_materializes_independent_clip_and_removes_replaced_file(
    tmp_path: Path,
) -> None:
    topic_id = uuid4()
    concept_id = uuid4()
    repository = MemoryClipRepository(_clip_context(topic_id, concept_id))
    materializer = MemoryClipMaterializer(tmp_path)
    service = ClipService(
        repository=repository,
        agent=StaticClipAgent(
            (
                ClipProposal(
                    title="Definition",
                    start_seconds=0,
                    end_seconds=20,
                    type=ClipType.DEFINITION,
                    difficulty="introductory",
                    concept_ids=(concept_id,),
                    rationale="Reusable definition.",
                    confidence=0.9,
                ),
            )
        ),
        materializer=materializer,
    )

    first = (await service.generate_clips_for_topic(topic_id))[0]
    second = (await service.generate_clips_for_topic(topic_id))[0]

    assert first.materialization_status == ClipMaterializationStatus.READY
    assert first.playback_provider == "local_clip"
    assert first.playback_id is not None
    assert first.playback_id in materializer.removed
    assert second.playback_id is not None
    assert materializer.resolve(second.playback_id) is not None


def test_boundary_snapper_rejects_mid_word_cleanliness_regressions() -> None:
    concept_id = uuid4()
    words = _words()
    snapped = snap_proposal_to_clean_boundaries(
        ClipProposal(
            title="Clean",
            start_seconds=0.2,
            end_seconds=19.8,
            type=ClipType.EXPLANATION,
            difficulty="standard",
            concept_ids=(concept_id,),
            rationale="Clean cut.",
            confidence=0.9,
        ),
        words,
        0,
        20,
    )

    assert snapped.start_seconds == 0.0
    assert snapped.end_seconds == 20.0
    assert is_clean_boundary(snapped.start_seconds, snapped.end_seconds, words)


def test_boundary_snapper_aligns_manual_topic_splits_inward() -> None:
    concept_id = uuid4()
    words = (
        TranscriptWord(text="previous", start_seconds=14.0, end_seconds=16.0),
        TranscriptWord(text="topic", start_seconds=16.2, end_seconds=20.0),
        TranscriptWord(text="continues.", start_seconds=20.2, end_seconds=30.0),
    )
    snapped = snap_proposal_to_clean_boundaries(
        ClipProposal(
            title="Split topic",
            start_seconds=15.0,
            end_seconds=30.0,
            type=ClipType.EXPLANATION,
            difficulty="standard",
            concept_ids=(concept_id,),
            rationale="Topic starts at a manually entered split.",
            confidence=0.9,
        ),
        words,
        15.0,
        30.0,
    )

    assert snapped.start_seconds == 16.0
    assert snapped.end_seconds == 30.0
    assert is_clean_boundary(snapped.start_seconds, snapped.end_seconds, words)


def test_normalize_snapped_overlaps_moves_next_start_to_clean_previous_end() -> None:
    concept_id = uuid4()
    words = _words()
    normalized = normalize_snapped_overlaps(
        (
            ClipProposal(
                title="First",
                start_seconds=0,
                end_seconds=10,
                type=ClipType.DEFINITION,
                difficulty="introductory",
                concept_ids=(concept_id,),
                rationale="First sentence.",
                confidence=0.9,
            ),
            ClipProposal(
                title="Second",
                start_seconds=7,
                end_seconds=20,
                type=ClipType.EXPLANATION,
                difficulty="standard",
                concept_ids=(concept_id,),
                rationale="Second sentence.",
                confidence=0.9,
            ),
        ),
        words,
    )

    assert normalized[0].start_seconds == 0
    assert normalized[0].end_seconds == 10
    assert normalized[1].start_seconds == 10
    assert normalized[1].end_seconds == 20
    assert all(
        is_clean_boundary(clip.start_seconds, clip.end_seconds, words) for clip in normalized
    )


class StaticClipAgent(ClipExtractionAgent):
    def __init__(self, proposals: tuple[ClipProposal, ...]) -> None:
        self._proposals = proposals

    async def propose_clips(
        self,
        context: ClipContext,
        instructor_notes: str | None = None,
    ) -> tuple[ClipProposal, ...]:
        del context, instructor_notes
        return self._proposals


class MemoryClipMaterializer(ClipMaterializer):
    def __init__(self, root: Path) -> None:
        self.root = root
        self.removed: list[str] = []

    async def materialize(self, clip: Clip, context: ClipContext) -> str:
        del context
        playback_id = f"{clip.id}.mp4"
        (self.root / playback_id).write_bytes(b"independent clip")
        return playback_id

    def resolve(self, playback_id: str) -> Path | None:
        path = self.root / playback_id
        return path if path.is_file() else None

    def remove(self, playback_id: str) -> None:
        self.removed.append(playback_id)
        (self.root / playback_id).unlink(missing_ok=True)


class MemoryClipRepository(ClipRepository):
    def __init__(self, context: ClipContext) -> None:
        self.context = context
        self.clips: dict[UUID, Clip] = {}

    async def get_context_for_topic(
        self,
        topic_id: UUID,
        include_proposed: bool = False,
    ) -> ClipContext | None:
        del include_proposed
        if topic_id != self.context.topic.id:
            return None
        return self.context

    async def list_clips_for_video(self, video_id: UUID) -> tuple[Clip, ...]:
        if video_id != self.context.topic.video_id:
            return ()
        return tuple(sorted(self.clips.values(), key=lambda clip: clip.start_seconds))

    async def list_replaceable_clips_for_topic(self, topic_id: UUID) -> tuple[Clip, ...]:
        return tuple(
            clip
            for clip in self.clips.values()
            if clip.topic_id == topic_id
            and clip.status == ClipStatus.ACTIVE
            and clip.source_clip_id is None
        )

    async def get_clip(self, clip_id: UUID) -> Clip | None:
        return self.clips.get(clip_id)

    async def replace_topic_clips(
        self,
        topic_id: UUID,
        proposals: tuple[ClipProposal, ...],
    ) -> tuple[Clip, ...]:
        self.clips = {
            clip_id: clip
            for clip_id, clip in self.clips.items()
            if not (
                clip.topic_id == topic_id
                and clip.status == ClipStatus.ACTIVE
                and clip.source_clip_id is None
            )
        }
        created = tuple(_clip_from_proposal(topic_id, proposal) for proposal in proposals)
        for clip in created:
            self.clips[clip.id] = clip
        return created

    async def flag_clip(self, clip_id: UUID, flag: ClipFlag) -> Clip | None:
        clip = self.clips.get(clip_id)
        if clip is None:
            return None
        updated = _replace_clip(
            clip,
            status=ClipStatus.FLAGGED,
            flagged_at="now",
            flag_note=flag.note,
        )
        self.clips[clip_id] = updated
        return updated

    async def get_clip_context(self, clip_id: UUID) -> tuple[Clip, ClipContext] | None:
        clip = self.clips.get(clip_id)
        if clip is None:
            return None
        return (clip, self.context)

    async def supersede_clip(
        self,
        clip_id: UUID,
        proposal: ClipProposal,
        note: str,
    ) -> Clip | None:
        del note
        original = self.clips.get(clip_id)
        if original is None:
            return None
        replacement = _clip_from_proposal(
            original.topic_id,
            proposal,
            source_clip_id=clip_id,
        )
        self.clips[replacement.id] = replacement
        self.clips[clip_id] = _replace_clip(
            original,
            status=ClipStatus.SUPERSEDED,
            superseded_by_clip_id=replacement.id,
        )
        return replacement

    async def update_materialization(
        self,
        clip_id: UUID,
        status: ClipMaterializationStatus,
        *,
        playback_provider: str | None = None,
        playback_id: str | None = None,
        error: str | None = None,
    ) -> Clip | None:
        clip = self.clips.get(clip_id)
        if clip is None:
            return None
        updated = _replace_clip(
            clip,
            materialization_status=status,
            playback_provider=playback_provider,
            playback_id=playback_id,
            materialization_error=error,
        )
        self.clips[clip_id] = updated
        return updated


def _clip_context(topic_id: UUID, concept_id: UUID) -> ClipContext:
    return ClipContext(
        topic=ClipTopicContext(
            id=topic_id,
            course_id=uuid4(),
            video_id=uuid4(),
            title="Vector spaces",
            summary="Definitions and examples.",
            start_seconds=0,
            end_seconds=20,
            source_path=None,
        ),
        transcript_text="A vector space has vectors. It also has operations.",
        words=_words(),
        concepts=(ClipConcept(id=concept_id, name="Vector spaces", description="Basics"),),
    )


def _words() -> tuple[TranscriptWord, ...]:
    return (
        TranscriptWord("A", 0.0, 1.0),
        TranscriptWord("vector", 1.0, 3.0),
        TranscriptWord("space", 3.0, 5.0),
        TranscriptWord("has", 5.0, 7.0),
        TranscriptWord("vectors.", 7.0, 10.0),
        TranscriptWord("It", 10.0, 11.0),
        TranscriptWord("also", 11.0, 13.0),
        TranscriptWord("has", 13.0, 15.0),
        TranscriptWord("operations.", 15.0, 20.0),
    )


def _clip_from_proposal(
    topic_id: UUID,
    proposal: ClipProposal,
    *,
    source_clip_id: UUID | None = None,
) -> Clip:
    return Clip(
        id=uuid4(),
        topic_id=topic_id,
        start_seconds=proposal.start_seconds,
        end_seconds=proposal.end_seconds,
        type=proposal.type,
        difficulty=proposal.difficulty,
        status=ClipStatus.ACTIVE,
        concept_ids=proposal.concept_ids,
        ai_proposal={"title": proposal.title},
        instructor_revision=None,
        flagged_at=None,
        flag_note=None,
        superseded_by_clip_id=None,
        source_clip_id=source_clip_id,
        playback_provider=None,
        playback_id=None,
        materialization_status=ClipMaterializationStatus.SOURCE_REFERENCE,
        materialization_error=None,
        created_at="now",
    )


def _replace_clip(
    clip: Clip,
    *,
    status: ClipStatus | None = None,
    flagged_at: str | None = None,
    flag_note: str | None = None,
    superseded_by_clip_id: UUID | None = None,
    playback_provider: str | None = None,
    playback_id: str | None = None,
    materialization_status: ClipMaterializationStatus | None = None,
    materialization_error: str | None = None,
) -> Clip:
    return Clip(
        id=clip.id,
        topic_id=clip.topic_id,
        start_seconds=clip.start_seconds,
        end_seconds=clip.end_seconds,
        type=clip.type,
        difficulty=clip.difficulty,
        status=clip.status if status is None else status,
        concept_ids=clip.concept_ids,
        ai_proposal=clip.ai_proposal,
        instructor_revision=clip.instructor_revision,
        flagged_at=clip.flagged_at if flagged_at is None else flagged_at,
        flag_note=clip.flag_note if flag_note is None else flag_note,
        superseded_by_clip_id=(
            clip.superseded_by_clip_id if superseded_by_clip_id is None else superseded_by_clip_id
        ),
        source_clip_id=clip.source_clip_id,
        playback_provider=(
            clip.playback_provider if playback_provider is None else playback_provider
        ),
        playback_id=clip.playback_id if playback_id is None else playback_id,
        materialization_status=(
            clip.materialization_status
            if materialization_status is None
            else materialization_status
        ),
        materialization_error=(
            clip.materialization_error if materialization_error is None else materialization_error
        ),
        created_at=clip.created_at,
    )
