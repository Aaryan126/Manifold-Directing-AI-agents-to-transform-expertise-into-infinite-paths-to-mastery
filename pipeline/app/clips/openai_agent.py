import json
from uuid import UUID

from openai import AsyncOpenAI

from app.clips.agent import ClipExtractionAgent
from app.clips.models import ClipContext, ClipProposal, ClipType


class OpenAIClipExtractionAgent(ClipExtractionAgent):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def propose_clips(
        self,
        context: ClipContext,
        instructor_notes: str | None = None,
    ) -> tuple[ClipProposal, ...]:
        response = await self._client.responses.create(
            model=self._model,
            input=_prompt(context, instructor_notes),
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
- Keep clips inside the topic range.
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
        proposals.append(
            ClipProposal(
                title=str(item.get("title", "Untitled clip")),
                start_seconds=float(item["start_seconds"]),
                end_seconds=float(item["end_seconds"]),
                type=ClipType(str(item.get("type", ClipType.EXPLANATION))),
                difficulty=str(item.get("difficulty", "standard")),
                concept_ids=concept_ids,
                rationale=str(item.get("rationale", "")),
                confidence=float(item.get("confidence", 0.5)),
            )
        )
    return tuple(proposals)


def _is_valid_uuid(value: str, valid_concept_ids: set[UUID]) -> bool:
    try:
        return UUID(value) in valid_concept_ids
    except ValueError:
        return False
