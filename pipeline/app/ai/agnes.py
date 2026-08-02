import json
import re
from time import perf_counter
from typing import TypeVar, cast

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, ValidationError

from app.evaluation.telemetry import record_model_usage

OutputT = TypeVar("OutputT", bound=BaseModel)


class AgnesResponseError(RuntimeError):
    """Raised when Agnes does not return one schema-valid JSON result."""


class AgnesStructuredClient:
    """OpenAI-compatible Agnes Chat Completions client with local schema validation."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://apihub.agnes-ai.com/v1",
        *,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._client = client or AsyncOpenAI(api_key=api_key, base_url=base_url)
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def parse(
        self,
        *,
        messages: list[dict[str, str]],
        output_type: type[OutputT],
        operation: str,
    ) -> OutputT:
        schema_instruction: ChatCompletionMessageParam = {
            "role": "system",
            "content": (
                "Return exactly one JSON object and no prose or Markdown. The object must "
                "validate against this JSON Schema:\n"
                f"{json.dumps(output_type.model_json_schema(), separators=(',', ':'))}"
            ),
        }
        prepared_messages = cast(list[ChatCompletionMessageParam], [schema_instruction, *messages])
        last_error: AgnesResponseError | None = None
        for attempt in range(3):
            started = perf_counter()
            response = await self._client.chat.completions.create(
                model=self.model,
                messages=prepared_messages,
                response_format={"type": "json_object"},
                temperature=0,
            )
            record_model_usage(
                response,
                provider="agnes",
                operation=operation,
                model=self.model,
                latency_ms=(perf_counter() - started) * 1000,
            )
            content = response.choices[0].message.content if response.choices else None
            try:
                if not response.choices:
                    raise AgnesResponseError("Agnes returned no completion choices.")
                if not content:
                    raise AgnesResponseError("Agnes returned an empty structured response.")
                payload = _extract_json_object(content)
                return output_type.model_validate_json(payload)
            except ValidationError as exc:
                last_error = AgnesResponseError(
                    f"Agnes response did not match {output_type.__name__}."
                )
                last_error.__cause__ = exc
            except AgnesResponseError as exc:
                last_error = exc
            if attempt < 2:
                prepared_messages = [
                    *prepared_messages,
                    {"role": "assistant", "content": content or ""},
                    {
                        "role": "user",
                        "content": (
                            f"The prior object failed validation: {last_error}. "
                            "Return one corrected JSON object matching the supplied schema."
                        ),
                    },
                ]
        if last_error is None:
            raise AgnesResponseError("Agnes structured response validation failed.")
        raise last_error


def _extract_json_object(content: str) -> str:
    normalized = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(\{.*\})\s*```", normalized, re.DOTALL)
    if fenced:
        normalized = fenced.group(1).strip()
    if not normalized.startswith("{") or not normalized.endswith("}"):
        start = normalized.find("{")
        end = normalized.rfind("}")
        if start < 0 or end <= start:
            raise AgnesResponseError("Agnes response did not contain a JSON object.")
        normalized = normalized[start : end + 1]
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise AgnesResponseError("Agnes response contained invalid JSON.") from exc
    if not isinstance(parsed, dict):
        raise AgnesResponseError("Agnes structured response must be a JSON object.")
    return json.dumps(parsed)
