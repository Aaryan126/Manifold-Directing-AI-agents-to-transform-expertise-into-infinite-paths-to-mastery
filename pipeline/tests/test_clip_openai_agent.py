import json
from uuid import uuid4

from app.clips.models import ClipConcept, ClipContext, ClipTopicContext
from app.clips.openai_agent import _parse_response


def test_openai_clip_parser_converts_topic_relative_ranges_to_absolute_time() -> None:
    context = _context(600.0, 1200.0)

    proposals = _parse_response(
        _response(context, start_seconds=25.0, end_seconds=90.0),
        context,
    )

    assert proposals[0].start_seconds == 625.0
    assert proposals[0].end_seconds == 690.0


def test_openai_clip_parser_clamps_small_range_drift_inward() -> None:
    context = _context(600.0, 1200.0)

    proposals = _parse_response(
        _response(context, start_seconds=595.0, end_seconds=1206.0),
        context,
    )

    assert proposals[0].start_seconds == 600.0
    assert proposals[0].end_seconds == 1200.0


def test_openai_clip_parser_leaves_large_invalid_range_for_service_rejection() -> None:
    context = _context(600.0, 1200.0)

    proposals = _parse_response(
        _response(context, start_seconds=500.0, end_seconds=1400.0),
        context,
    )

    assert proposals[0].start_seconds == 500.0
    assert proposals[0].end_seconds == 1400.0


def _context(start_seconds: float, end_seconds: float) -> ClipContext:
    concept = ClipConcept(
        id=uuid4(),
        name="Value creation",
        description="How a venture creates customer value.",
    )
    return ClipContext(
        topic=ClipTopicContext(
            id=uuid4(),
            course_id=uuid4(),
            video_id=uuid4(),
            title="Create and capture value",
            summary="The lecture distinguishes value creation from value capture.",
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            source_path=None,
        ),
        transcript_text="A timestamped lecture segment.",
        words=(),
        concepts=(concept,),
    )


def _response(
    context: ClipContext,
    *,
    start_seconds: float,
    end_seconds: float,
) -> str:
    return json.dumps(
        {
            "clips": [
                {
                    "title": "Value creation",
                    "start_seconds": start_seconds,
                    "end_seconds": end_seconds,
                    "type": "explanation",
                    "difficulty": "standard",
                    "concept_ids": [str(context.concepts[0].id)],
                    "rationale": "Explains the transferable distinction.",
                    "confidence": 0.9,
                }
            ]
        }
    )
