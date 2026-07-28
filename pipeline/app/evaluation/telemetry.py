from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class AIUsageRecord:
    operation: str
    provider: str
    model: str
    latency_ms: float
    input_tokens: int | None = None
    cached_input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    audio_seconds: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in asdict(self).items()
            if value is not None
        }


_usage_records: ContextVar[list[AIUsageRecord] | None] = ContextVar(
    "generation_ai_usage_records",
    default=None,
)


@contextmanager
def capture_ai_usage() -> Iterator[list[AIUsageRecord]]:
    """Capture provider calls made in one durable generation-task context."""

    records: list[AIUsageRecord] = []
    token = _usage_records.set(records)
    try:
        yield records
    finally:
        _usage_records.reset(token)


def record_openai_usage(
    response: Any,
    *,
    operation: str,
    model: str,
    latency_ms: float,
    audio_seconds: float | None = None,
) -> None:
    """Record actual provider-returned usage without coupling to one SDK response type."""

    records = _usage_records.get()
    if records is None:
        return
    usage = _value(response, "usage")
    input_details = _value(usage, "input_tokens_details")
    records.append(
        AIUsageRecord(
            operation=operation,
            provider="openai",
            model=model,
            latency_ms=round(latency_ms, 2),
            input_tokens=_integer(_value(usage, "input_tokens")),
            cached_input_tokens=_integer(_value(input_details, "cached_tokens")),
            output_tokens=_integer(_value(usage, "output_tokens")),
            total_tokens=_integer(_value(usage, "total_tokens")),
            audio_seconds=(
                round(float(audio_seconds), 3) if audio_seconds is not None else None
            ),
        )
    )


def _value(value: Any, key: str) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def _integer(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
