import json
from typing import Any
from uuid import UUID

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from app.intelligence.agent import CourseImprovementAgent
from app.intelligence.models import ImprovementDraft


class _ImprovementOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal_type: str = Field(min_length=1, max_length=80)
    proposed_state_json: str = Field(min_length=2)
    rationale: str = Field(min_length=1, max_length=4000)


class OpenAICourseImprovementAgent(CourseImprovementAgent):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def prepare(
        self,
        *,
        artifact_type: str,
        logical_artifact_id: UUID,
        current_state: dict[str, Any],
        evidence: dict[str, Any],
        instruction: str,
    ) -> ImprovementDraft:
        response = await self._client.responses.parse(
            model=self._model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You are a specialist on an instructor's course team. Prepare one exact, "
                        "minimal private-revision change from persisted evidence. Preserve all "
                        "required IDs and fields, do not invent learner statistics, and do not "
                        "claim the change has been applied. Return a complete proposed artifact "
                        "state as a valid JSON object string in proposed_state_json, plus a "
                        "concise evidence-grounded rationale for instructor review."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Artifact type: {artifact_type}\n"
                        f"Instruction: {instruction}\n"
                        f"Current state: {current_state}\n"
                        f"Evidence: {evidence}"
                    ),
                },
            ],
            text_format=_ImprovementOutput,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("Course improvement response did not match its schema.")
        try:
            parsed_state = json.loads(parsed.proposed_state_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Course improvement returned invalid proposed-state JSON.") from exc
        if not isinstance(parsed_state, dict):
            raise RuntimeError("Course improvement proposed state must be a JSON object.")
        proposed = dict(current_state)
        proposed.update(parsed_state)
        return ImprovementDraft(
            proposal_type=parsed.proposal_type,
            artifact_type=artifact_type,
            logical_artifact_id=logical_artifact_id,
            before_state=current_state,
            proposed_state=proposed,
            rationale=parsed.rationale,
        )
