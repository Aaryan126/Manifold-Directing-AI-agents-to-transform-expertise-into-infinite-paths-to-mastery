import json
from uuid import UUID

from openai import AsyncOpenAI

from app.assessments.agent import AssessmentAgent
from app.assessments.models import (
    AssessmentContext,
    QuestionProposal,
    QuestionType,
    RemediationProposal,
)


class OpenAIAssessmentAgent(AssessmentAgent):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def propose_question(
        self,
        context: AssessmentContext,
        previous_question: str | None = None,
    ) -> QuestionProposal:
        response = await self._client.responses.create(
            model=self._model,
            input=_prompt(context, previous_question),
        )
        return _parse_response(response.output_text)


def _prompt(context: AssessmentContext, previous_question: str | None) -> str:
    concepts = "\n".join(
        f"- {concept.id}: {concept.name} — {concept.description or ''}"
        for concept in context.concepts
    )
    clips = "\n".join(
        f"- {clip.id}: {clip.type}, concepts={','.join(str(cid) for cid in clip.concept_ids)}"
        for clip in context.clips
    )
    previous = previous_question or "None."
    return f"""
Generate one instructor-reviewable comprehension question for a reviewed topic.
Use only reviewed concepts and usable clips listed below.

Return JSON only:
{{
  "body": "...",
  "type": "mcq|short_answer|worked_problem",
  "correct_answer": {{"answer": "...", "choices": ["..."]}},
  "confidence_prompt": "How confident are you...",
  "remediation_rules": [
    {{
      "wrong_answer_pattern": "...",
      "target_clip_id": "uuid or null",
      "target_concept_id": "uuid or null",
      "rationale": "..."
    }}
  ],
  "rationale": "...",
  "confidence": 0.0
}}

Topic: {context.topic.title}
Summary: {context.topic.summary or ""}
Reviewed concepts:
{concepts}
Usable clips:
{clips}
Previous question to avoid duplicating:
{previous}
""".strip()


def _parse_response(text: str) -> QuestionProposal:
    payload = json.loads(text)
    return QuestionProposal(
        body=str(payload["body"]),
        type=QuestionType(str(payload["type"])),
        correct_answer=dict(payload["correct_answer"]),
        confidence_prompt=str(payload["confidence_prompt"]),
        remediation_rules=tuple(
            RemediationProposal(
                wrong_answer_pattern=str(item["wrong_answer_pattern"]),
                target_clip_id=UUID(str(item["target_clip_id"]))
                if item.get("target_clip_id")
                else None,
                target_concept_id=UUID(str(item["target_concept_id"]))
                if item.get("target_concept_id")
                else None,
                rationale=str(item.get("rationale", "")),
            )
            for item in payload.get("remediation_rules", [])
            if isinstance(item, dict)
        ),
        rationale=str(payload.get("rationale", "")),
        confidence=float(payload.get("confidence", 0.5)),
    )
