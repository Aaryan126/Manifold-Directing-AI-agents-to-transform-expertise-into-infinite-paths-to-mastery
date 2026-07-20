from dataclasses import dataclass

from app.clips.models import ClipProposal
from app.segmentation.models import TranscriptWord

BOUNDARY_TOLERANCE_SECONDS = 5.0
MIN_CLIP_SECONDS = 8.0
SENTENCE_ENDINGS = (".", "?", "!")


class ClipBoundaryError(ValueError):
    pass


@dataclass(frozen=True)
class SentenceSpan:
    start_seconds: float
    end_seconds: float


def snap_proposal_to_clean_boundaries(
    proposal: ClipProposal,
    words: tuple[TranscriptWord, ...],
    topic_start_seconds: float,
    topic_end_seconds: float,
) -> ClipProposal:
    topic_words = tuple(
        word
        for word in words
        if word.end_seconds >= topic_start_seconds and word.start_seconds <= topic_end_seconds
    )
    if not topic_words:
        raise ClipBoundaryError("Cannot cut clips without word-level transcript timestamps.")

    clean_topic_start = _inward_topic_start(topic_start_seconds, topic_words)
    clean_topic_end = _inward_topic_end(topic_end_seconds, topic_words)
    if clean_topic_end <= clean_topic_start:
        raise ClipBoundaryError("Topic is too short after aligning it to transcript timestamps.")

    sentence_spans = sentence_spans_from_words(topic_words)
    clean_start = _nearest_sentence_start(
        proposal.start_seconds,
        sentence_spans,
        clean_topic_start,
        clean_topic_end,
    )
    clean_end = _nearest_sentence_end(
        proposal.end_seconds,
        sentence_spans,
        clean_topic_start,
        clean_topic_end,
    )
    if clean_end - clean_start < MIN_CLIP_SECONDS:
        clean_start = _floor_word_start(clean_start, topic_words, clean_topic_start)
        clean_end = _ceil_word_end(clean_end, topic_words, clean_topic_end)
    if clean_end <= clean_start:
        raise ClipBoundaryError("Clip proposal collapses after boundary snapping.")
    if clean_end - clean_start < MIN_CLIP_SECONDS:
        raise ClipBoundaryError("Clip proposal is too short after boundary snapping.")
    return ClipProposal(
        title=proposal.title,
        start_seconds=clean_start,
        end_seconds=clean_end,
        type=proposal.type,
        difficulty=proposal.difficulty,
        concept_ids=proposal.concept_ids,
        rationale=proposal.rationale,
        confidence=proposal.confidence,
    )


def sentence_spans_from_words(words: tuple[TranscriptWord, ...]) -> tuple[SentenceSpan, ...]:
    if not words:
        return ()
    spans: list[SentenceSpan] = []
    sentence_start = words[0].start_seconds
    for word in words:
        if word.text.strip().endswith(SENTENCE_ENDINGS):
            spans.append(SentenceSpan(sentence_start, word.end_seconds))
            sentence_start = word.end_seconds
    if not spans or spans[-1].end_seconds < words[-1].end_seconds:
        spans.append(SentenceSpan(sentence_start, words[-1].end_seconds))
    return tuple(spans)


def is_clean_boundary(
    start_seconds: float,
    end_seconds: float,
    words: tuple[TranscriptWord, ...],
) -> bool:
    return _is_word_boundary(start_seconds, words, start=True) and _is_word_boundary(
        end_seconds,
        words,
        start=False,
    )


def _nearest_sentence_start(
    target: float,
    spans: tuple[SentenceSpan, ...],
    floor: float,
    ceiling: float,
) -> float:
    candidates = [span.start_seconds for span in spans if floor <= span.start_seconds <= ceiling]
    return _nearest_with_tolerance(target, candidates, floor)


def _nearest_sentence_end(
    target: float,
    spans: tuple[SentenceSpan, ...],
    floor: float,
    ceiling: float,
) -> float:
    candidates = [span.end_seconds for span in spans if floor <= span.end_seconds <= ceiling]
    return _nearest_with_tolerance(target, candidates, ceiling)


def _nearest_with_tolerance(target: float, candidates: list[float], fallback: float) -> float:
    if not candidates:
        return fallback
    nearest = min(candidates, key=lambda candidate: abs(candidate - target))
    if abs(nearest - target) <= BOUNDARY_TOLERANCE_SECONDS:
        return nearest
    return fallback


def _floor_word_start(
    target: float,
    words: tuple[TranscriptWord, ...],
    fallback: float,
) -> float:
    candidates = [word.start_seconds for word in words if word.start_seconds <= target]
    return max(candidates) if candidates else fallback


def _ceil_word_end(
    target: float,
    words: tuple[TranscriptWord, ...],
    fallback: float,
) -> float:
    candidates = [word.end_seconds for word in words if word.end_seconds >= target]
    return min(candidates) if candidates else fallback


def _is_word_boundary(
    target: float,
    words: tuple[TranscriptWord, ...],
    *,
    start: bool,
) -> bool:
    tolerance = 0.001
    exact_boundaries = (
        (word.start_seconds if start else word.end_seconds)
        for word in words
    )
    if any(abs(target - boundary) <= tolerance for boundary in exact_boundaries):
        return True
    return not any(
        word.start_seconds + tolerance < target < word.end_seconds - tolerance
        for word in words
    )


def _inward_topic_start(target: float, words: tuple[TranscriptWord, ...]) -> float:
    if _is_word_boundary(target, words, start=True):
        return target
    candidates = [
        boundary
        for word in words
        for boundary in (word.start_seconds, word.end_seconds)
        if boundary >= target
    ]
    if not candidates:
        raise ClipBoundaryError("Topic start cannot be aligned to transcript timestamps.")
    return min(candidates)


def _inward_topic_end(target: float, words: tuple[TranscriptWord, ...]) -> float:
    if _is_word_boundary(target, words, start=False):
        return target
    candidates = [
        boundary
        for word in words
        for boundary in (word.start_seconds, word.end_seconds)
        if boundary <= target
    ]
    if not candidates:
        raise ClipBoundaryError("Topic end cannot be aligned to transcript timestamps.")
    return max(candidates)
