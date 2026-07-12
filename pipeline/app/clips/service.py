from uuid import UUID

from app.audit.models import AuditEventCreate
from app.audit.service import (
    AuditService,
    instructor_note_from_state,
    rationale_from_state,
    snapshot,
)
from app.clips.agent import ClipExtractionAgent
from app.clips.boundaries import (
    ClipBoundaryError,
    is_clean_boundary,
    snap_proposal_to_clean_boundaries,
)
from app.clips.models import Clip, ClipContext, ClipFlag, ClipProposal
from app.clips.repository import ClipRepository
from app.segmentation.models import TranscriptWord

GAP_TOLERANCE_SECONDS = 5.0
OVERLAP_TOLERANCE_SECONDS = 1.0


class ClipValidationError(ValueError):
    pass


class ClipService:
    def __init__(
        self,
        repository: ClipRepository,
        agent: ClipExtractionAgent,
        audit_service: AuditService | None = None,
    ) -> None:
        self._repository = repository
        self._agent = agent
        self._audit_service = audit_service

    async def generate_clips_for_topic(self, topic_id: UUID) -> tuple[Clip, ...]:
        context = await self._repository.get_context_for_topic(topic_id)
        if context is None:
            raise ClipValidationError("Reviewed topic with transcript not found.")
        proposals = await self._agent.propose_clips(context)
        clean = _clean_and_validate_proposals(proposals, context)
        clips = await self._repository.replace_topic_clips(topic_id, clean)
        for clip in clips:
            await self._audit(context.topic.course_id, clip, None, clip, "propose", "ai")
        return clips

    async def list_clips_for_video(self, video_id: UUID) -> tuple[Clip, ...]:
        return await self._repository.list_clips_for_video(video_id)

    async def flag_clip(self, clip_id: UUID, note: str) -> Clip | None:
        if not note.strip():
            raise ClipValidationError("Flag note is required.")
        found = await self._repository.get_clip_context(clip_id)
        clip = await self._repository.flag_clip(clip_id, ClipFlag(note=note.strip()))
        if clip is not None and found is not None:
            previous, context = found
            await self._audit(context.topic.course_id, clip, previous, clip, "flag", "instructor")
        return clip

    async def recut_clip(self, clip_id: UUID, note: str) -> Clip | None:
        if not note.strip():
            raise ClipValidationError("Instructor notes are required for re-cutting.")
        found = await self._repository.get_clip_context(clip_id)
        if found is None:
            return None
        original, context = found
        proposals = await self._agent.propose_clips(context, instructor_notes=note.strip())
        clean = _clean_and_validate_proposals(proposals, context)
        replacement = _best_recut_for_original(original, clean)
        clip = await self._repository.supersede_clip(clip_id, replacement, note.strip())
        if clip is not None:
            await self._audit(context.topic.course_id, clip, original, clip, "recut", "instructor")
        return clip

    async def _audit(
        self,
        course_id: UUID,
        clip: Clip,
        previous: Clip | None,
        new: Clip,
        action: str,
        source: str,
    ) -> None:
        if self._audit_service is None:
            return
        previous_state = snapshot(previous)
        new_state = snapshot(new)
        await self._audit_service.record(
            AuditEventCreate(
                course_id=course_id,
                artifact_type="clip",
                artifact_id=clip.id,
                action=action,
                source=source,
                previous_state=previous_state,
                new_state=new_state,
                ai_rationale=rationale_from_state(new_state or previous_state),
                instructor_note=instructor_note_from_state(new_state) or new.flag_note,
            ),
        )


def _clean_and_validate_proposals(
    proposals: tuple[ClipProposal, ...],
    context: ClipContext,
) -> tuple[ClipProposal, ...]:
    words = context.words
    topic = context.topic
    concept_ids = {concept.id for concept in context.concepts}
    if not concept_ids:
        raise ClipValidationError("No reviewed concepts are available for clip tagging.")
    if not proposals:
        raise ClipValidationError("Clip extraction produced no clips.")
    clean: list[ClipProposal] = []
    for proposal in proposals:
        if not set(proposal.concept_ids).issubset(concept_ids):
            raise ClipValidationError("Clip proposal references concepts outside the topic graph.")
        if not proposal.concept_ids:
            raise ClipValidationError("Every clip must have at least one concept tag.")
        if proposal.end_seconds <= proposal.start_seconds:
            raise ClipValidationError("Clip end time must be after start time.")
        if proposal.start_seconds < topic.start_seconds or proposal.end_seconds > topic.end_seconds:
            raise ClipValidationError("Clip proposal must stay inside its source topic.")
        try:
            snapped = snap_proposal_to_clean_boundaries(
                proposal,
                words,
                topic.start_seconds,
                topic.end_seconds,
            )
        except ClipBoundaryError as exc:
            raise ClipValidationError(str(exc)) from exc
        if not is_clean_boundary(snapped.start_seconds, snapped.end_seconds, words):
            raise ClipValidationError("Clip boundary is not aligned to transcript word timestamps.")
        clean.append(snapped)
    normalized = normalize_snapped_overlaps(tuple(clean), words)
    validate_clip_coverage(normalized, topic.start_seconds, topic.end_seconds)
    return normalized


def normalize_snapped_overlaps(
    proposals: tuple[ClipProposal, ...],
    words: tuple[TranscriptWord, ...],
) -> tuple[ClipProposal, ...]:
    normalized: list[ClipProposal] = []
    for proposal in sorted(proposals, key=lambda item: item.start_seconds):
        if not normalized:
            normalized.append(proposal)
            continue
        previous = normalized[-1]
        if proposal.start_seconds < previous.end_seconds:
            proposal = ClipProposal(
                title=proposal.title,
                start_seconds=previous.end_seconds,
                end_seconds=proposal.end_seconds,
                type=proposal.type,
                difficulty=proposal.difficulty,
                concept_ids=proposal.concept_ids,
                rationale=proposal.rationale,
                confidence=proposal.confidence,
            )
        if proposal.end_seconds <= proposal.start_seconds:
            continue
        if not is_clean_boundary(proposal.start_seconds, proposal.end_seconds, words):
            raise ClipValidationError("Clip boundary is not aligned to transcript word timestamps.")
        normalized.append(proposal)
    if not normalized:
        raise ClipValidationError(
            "Clip extraction produced no usable clips after boundary snapping."
        )
    return tuple(normalized)


def validate_clip_coverage(
    proposals: tuple[ClipProposal, ...],
    topic_start_seconds: float,
    topic_end_seconds: float,
) -> None:
    ordered = sorted(proposals, key=lambda item: item.start_seconds)
    if ordered[0].start_seconds - topic_start_seconds > GAP_TOLERANCE_SECONDS:
        raise ClipValidationError("Generated clips leave a large gap at the start of the topic.")
    if topic_end_seconds - ordered[-1].end_seconds > GAP_TOLERANCE_SECONDS:
        raise ClipValidationError("Generated clips leave a large gap at the end of the topic.")
    previous_end: float | None = None
    for proposal in ordered:
        if previous_end is None:
            previous_end = proposal.end_seconds
            continue
        overlap = previous_end - proposal.start_seconds
        if overlap > OVERLAP_TOLERANCE_SECONDS:
            raise ClipValidationError("Generated clips overlap too much.")
        gap = proposal.start_seconds - previous_end
        if gap > GAP_TOLERANCE_SECONDS:
            raise ClipValidationError("Generated clips leave a large gap inside the topic.")
        previous_end = max(previous_end, proposal.end_seconds)


def _best_recut_for_original(
    original: Clip,
    proposals: tuple[ClipProposal, ...],
) -> ClipProposal:
    original_midpoint = (original.start_seconds + original.end_seconds) / 2
    return min(
        proposals,
        key=lambda proposal: abs(
            ((proposal.start_seconds + proposal.end_seconds) / 2) - original_midpoint
        ),
    )
