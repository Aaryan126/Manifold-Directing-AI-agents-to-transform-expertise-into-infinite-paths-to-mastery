from types import SimpleNamespace
from typing import Any, cast

import pytest
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict

from app.ai.agnes import AgnesResponseError, AgnesStructuredClient
from app.evaluation.telemetry import capture_ai_usage


class _Output(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: str


class _FakeCompletions:
    def __init__(self, content: str | list[str]) -> None:
        self.contents = [content] if isinstance(content, str) else list(content)
        self.request: dict[str, Any] | None = None
        self.requests: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.request = kwargs
        self.requests.append(kwargs)
        content = self.contents[min(len(self.requests) - 1, len(self.contents) - 1)]
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
            usage=SimpleNamespace(
                prompt_tokens=21,
                completion_tokens=5,
                total_tokens=26,
                prompt_tokens_details=SimpleNamespace(cached_tokens=8),
            ),
        )


class _FakeClient:
    def __init__(self, content: str | list[str]) -> None:
        self.completions = _FakeCompletions(content)
        self.chat = SimpleNamespace(completions=self.completions)


@pytest.mark.anyio
async def test_agnes_client_uses_chat_completions_and_validates_json() -> None:
    fake = _FakeClient('```json\n{"intent":"why_next"}\n```')
    client = AgnesStructuredClient(
        "test-key",
        "agnes-2.5-flash",
        client=cast(AsyncOpenAI, fake),
    )

    with capture_ai_usage() as usage:
        output = await client.parse(
            messages=[{"role": "user", "content": "Why is this next?"}],
            output_type=_Output,
            operation="test_agnes",
        )

    assert output.intent == "why_next"
    assert fake.completions.request is not None
    assert fake.completions.request["model"] == "agnes-2.5-flash"
    assert fake.completions.request["response_format"] == {"type": "json_object"}
    assert fake.completions.request["temperature"] == 0
    assert "JSON Schema" in fake.completions.request["messages"][0]["content"]
    assert usage[0].provider == "agnes"
    assert usage[0].input_tokens == 21
    assert usage[0].cached_input_tokens == 8
    assert usage[0].output_tokens == 5


@pytest.mark.anyio
async def test_agnes_client_rejects_schema_invalid_output() -> None:
    fake = _FakeClient('{"unexpected":"value"}')
    client = AgnesStructuredClient(
        "test-key",
        "agnes-2.5-flash",
        client=cast(AsyncOpenAI, fake),
    )

    with pytest.raises(AgnesResponseError, match="did not match"):
        await client.parse(
            messages=[{"role": "user", "content": "Classify this"}],
            output_type=_Output,
            operation="test_agnes_invalid",
        )


@pytest.mark.anyio
async def test_agnes_client_rejects_non_json_output() -> None:
    fake = _FakeClient("I cannot provide JSON.")
    client = AgnesStructuredClient(
        "test-key",
        "agnes-2.5-flash",
        client=cast(AsyncOpenAI, fake),
    )

    with pytest.raises(AgnesResponseError, match="did not contain"):
        await client.parse(
            messages=[{"role": "user", "content": "Classify this"}],
            output_type=_Output,
            operation="test_agnes_invalid_json",
        )


@pytest.mark.anyio
async def test_agnes_client_repairs_one_schema_invalid_response() -> None:
    fake = _FakeClient(['{"unexpected":"value"}', '{"intent":"why_next"}'])
    client = AgnesStructuredClient(
        "test-key",
        "agnes-2.5-flash",
        client=cast(AsyncOpenAI, fake),
    )

    with capture_ai_usage() as usage:
        output = await client.parse(
            messages=[{"role": "user", "content": "Classify this"}],
            output_type=_Output,
            operation="test_agnes_repair",
        )

    assert output.intent == "why_next"
    assert len(fake.completions.requests) == 2
    repair_messages = fake.completions.requests[1]["messages"]
    assert "failed validation" in repair_messages[-1]["content"]
    assert len(usage) == 2
