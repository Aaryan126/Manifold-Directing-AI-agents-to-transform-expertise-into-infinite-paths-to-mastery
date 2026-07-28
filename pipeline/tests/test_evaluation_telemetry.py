from types import SimpleNamespace

from app.evaluation.telemetry import capture_ai_usage, record_openai_usage


def test_openai_usage_capture_handles_sdk_objects_and_cached_tokens() -> None:
    response = SimpleNamespace(
        usage=SimpleNamespace(
            input_tokens=120,
            output_tokens=30,
            total_tokens=150,
            input_tokens_details=SimpleNamespace(cached_tokens=40),
        )
    )

    with capture_ai_usage() as records:
        record_openai_usage(
            response,
            operation="segment_lecture",
            model="gpt-5.4",
            latency_ms=123.456,
        )

    assert [record.as_dict() for record in records] == [
        {
            "operation": "segment_lecture",
            "provider": "openai",
            "model": "gpt-5.4",
            "latency_ms": 123.46,
            "input_tokens": 120,
            "cached_input_tokens": 40,
            "output_tokens": 30,
            "total_tokens": 150,
        }
    ]


def test_usage_outside_capture_scope_is_a_noop() -> None:
    record_openai_usage(
        {"usage": {"input_tokens": 10}},
        operation="ignored",
        model="gpt-5.4",
        latency_ms=1,
    )
