import json
import math
from time import perf_counter
from uuid import UUID

from openai import AsyncOpenAI

from app.clips.agent import ClipExtractionAgent
from app.clips.models import ClipContext, ClipProposal, ClipType
from app.evaluation.telemetry import record_openai_usage

RANGE_REPAIR_TOLERANCE_SECONDS = 15.0


class OpenAIClipExtractionAgent(ClipExtractionAgent):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def propose_clips(
        self,
        context: ClipContext,
        instructor_notes: str | None = None,
    ) -> tuple[ClipProposal, ...]:
        started = perf_counter()
        response = await self._client.responses.create(
            model=self._model,
            input=_prompt(context, instructor_notes),
        )
        record_openai_usage(
            response,
            operation="extract_teaching_clips",
            model=self._model,
            latency_ms=(perf_counter() - started) * 1000,
        )
        return _parse_response(response.output_text, context)


def _prompt(context: ClipContext, instructor_notes: str | None) -> str:
    concept_lines = "\n".join(
        f"- {concept.id}: {concept.name} — {concept.description or ''}"
        for concept in context.concepts
    )
    notes = instructor_notes or "None."
    return f"""
You are extracting independently playable educational clips from one reviewed topic.

Return JSON only with this shape:
{{
  "clips": [
    {{
      "title": "short label",
      "start_seconds": 123.4,
      "end_seconds": 156.7,
      "type": "definition|worked_example|explanation|misconception_correction|prerequisite_recap",
      "difficulty": "introductory|standard|advanced",
      "concept_ids": ["uuid"],
      "rationale": "why this clip is reusable",
      "confidence": 0.0
    }}
  ]
}}

Hard requirements:
- Use only concept_ids from the reviewed concept list.
- start_seconds and end_seconds must use the original lecture's absolute timeline,
  not a zero-based or topic-relative timeline.
- Keep every clip inside the inclusive topic range
  [{context.topic.start_seconds}, {context.topic.end_seconds}].
- Before returning, verify every start/end pair against that exact numeric range.
- Prefer semantic clip boundaries near sentence ends; the system will snap to timestamps.
- Avoid tiny fragments; each clip should be independently useful.
- Use instructor notes when present.

Topic:
ID: {context.topic.id}
Title: {context.topic.title}
Summary: {context.topic.summary or ""}
Range: {context.topic.start_seconds} to {context.topic.end_seconds}

Reviewed concepts:
{concept_lines}

Instructor notes for re-cut:
{notes}

Transcript:
{context.transcript_text}
""".strip()


def _parse_response(text: str, context: ClipContext) -> tuple[ClipProposal, ...]:
    payload = json.loads(text)
    clips = payload.get("clips", [])
    if not isinstance(clips, list):
        return ()
    valid_concept_ids = {concept.id for concept in context.concepts}
    proposals: list[ClipProposal] = []
    for item in clips:
        if not isinstance(item, dict):
            continue
        concept_ids = tuple(
            UUID(str(value))
            for value in item.get("concept_ids", [])
            if _is_valid_uuid(str(value), valid_concept_ids)
        )
        if not concept_ids:
            continue
        start_seconds, end_seconds = _normalize_range(
            float(item["start_seconds"]),
            float(item["end_seconds"]),
            context,
        )
        proposals.append(
            ClipProposal(
                title=str(item.get("title", "Untitled clip")),
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                type=ClipType(str(item.get("type", ClipType.EXPLANATION))),
                difficulty=str(item.get("difficulty", "standard")),
                concept_ids=concept_ids,
                rationale=str(item.get("rationale", "")),
                confidence=float(item.get("confidence", 0.5)),
            )
        )
    return tuple(proposals)


def _normalize_range(
    start_seconds: float,
    end_seconds: float,
    context: ClipContext,
) -> tuple[float, float]:
    if not math.isfinite(start_seconds) or not math.isfinite(end_seconds):
        return start_seconds, end_seconds
    topic_start = context.topic.start_seconds
    topic_end = context.topic.end_seconds
    topic_duration = topic_end - topic_start
    if (
        topic_start > RANGE_REPAIR_TOLERANCE_SECONDS
        and start_seconds < topic_start - RANGE_REPAIR_TOLERANCE_SECONDS
        and 0 <= start_seconds < end_seconds <= topic_duration + RANGE_REPAIR_TOLERANCE_SECONDS
    ):
        start_seconds += topic_start
        end_seconds += topic_start
    if topic_start - RANGE_REPAIR_TOLERANCE_SECONDS <= start_seconds < topic_start:
        start_seconds = topic_start
    if topic_end < end_seconds <= topic_end + RANGE_REPAIR_TOLERANCE_SECONDS:
        end_seconds = topic_end
    return start_seconds, end_seconds


def _is_valid_uuid(value: str, valid_concept_ids: set[UUID]) -> bool:
    try:
        return UUID(value) in valid_concept_ids
    except ValueError:
        return False
