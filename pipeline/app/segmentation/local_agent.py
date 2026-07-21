import re
from dataclasses import replace

from app.segmentation.agent import SegmentationAgent
from app.segmentation.models import TopicProposal, TranscriptWord, VideoTranscript

_BOUNDARY_CUES = (
    "now",
    "next",
    "first",
    "second",
    "third",
    "finally",
    "let's",
    "lets",
    "turn",
    "moving",
)


class LocalHeuristicSegmentationAgent(SegmentationAgent):
    """Deterministic fallback used for tests and local development without LLM credentials."""

    async def propose_topics(self, transcript: VideoTranscript) -> tuple[TopicProposal, ...]:
        words = remove_repeated_intro_noise(transcript.words)
        if not words:
            return ()

        total_start = words[0].start_seconds
        total_end = words[-1].end_seconds
        if total_end - total_start <= 0:
            return ()

        boundaries = [total_start]
        cursor = total_start
        while total_end - cursor > 20 * 60:
            target = cursor + 12 * 60
            boundary = _nearest_semantic_boundary(words, target, min_after=cursor + 8 * 60)
            if boundary <= cursor:
                boundary = min(cursor + 15 * 60, total_end)
            boundaries.append(boundary)
            cursor = boundary
        boundaries.append(total_end)

        proposals: list[TopicProposal] = []
        ranges = zip(boundaries[:-1], boundaries[1:], strict=True)
        for index, (start, end) in enumerate(ranges, start=1):
            segment_words = [
                word for word in words if word.start_seconds >= start and word.end_seconds <= end
            ]
            text = _words_to_text(segment_words)
            proposals.append(
                TopicProposal(
                    title=_title_from_text(text, index),
                    summary=_summary_from_text(text),
                    start_seconds=round(start, 3),
                    end_seconds=round(end, 3),
                    evidence=_summary_from_text(text, max_words=28),
                    confidence=0.55,
                )
            )
        if proposals:
            proposals[0] = replace(
                proposals[0],
                course_title=_course_title_from_topics(proposals),
            )
        return tuple(proposals)


def remove_repeated_intro_noise(words: tuple[TranscriptWord, ...]) -> tuple[TranscriptWord, ...]:
    """Drop repeated one- or two-word intro artifacts before the first meaningful content."""
    if len(words) < 8:
        return words

    normalized = [_normalize_word(word.text) for word in words[:80]]
    first = normalized[0]
    if first and normalized[:8].count(first) >= 6:
        index = 0
        while index < len(words) and _normalize_word(words[index].text) == first:
            index += 1
        return words[index:] or words

    if len(normalized) >= 12:
        phrase = tuple(normalized[:2])
        repeated = 0
        index = 0
        while index + 1 < len(normalized) and tuple(normalized[index : index + 2]) == phrase:
            repeated += 1
            index += 2
        if repeated >= 4:
            return words[index:] or words

    return words


def _nearest_semantic_boundary(
    words: tuple[TranscriptWord, ...],
    target: float,
    min_after: float,
) -> float:
    candidates = [
        word.start_seconds
        for word in words
        if word.start_seconds >= min_after
        and abs(word.start_seconds - target) <= 4 * 60
        and _normalize_word(word.text) in _BOUNDARY_CUES
    ]
    if candidates:
        return min(candidates, key=lambda value: abs(value - target))
    return target


def _title_from_text(text: str, index: int) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return f"Topic {index}"
    words = cleaned.split()[:7]
    return " ".join(words).rstrip(".,;:") or f"Topic {index}"


def _course_title_from_topics(proposals: list[TopicProposal]) -> str:
    first = proposals[0].title.strip().rstrip(".,;:")
    if len(proposals) == 1:
        return first[:90]
    focus = first.split(":", maxsplit=1)[0].strip()
    return f"{focus}: A practical course"[:90]


def _summary_from_text(text: str, max_words: int = 45) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return "No transcript text available for this segment."
    words = cleaned.split()[:max_words]
    suffix = "..." if len(cleaned.split()) > max_words else ""
    return " ".join(words).rstrip(".,;:") + suffix


def _words_to_text(words: list[TranscriptWord]) -> str:
    return " ".join(word.text for word in words)


def _normalize_word(text: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", text.lower())
