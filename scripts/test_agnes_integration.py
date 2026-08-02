#!/usr/bin/env python3
"""Opt-in real Agnes smoke test for Manifold's three selected agent surfaces."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import NoReturn
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from app.config import Settings  # noqa: E402
from app.course_os.course_director import AgnesCourseDirector  # noqa: E402
from app.course_os.dashboard_assistant import AgnesDashboardAssistant  # noqa: E402
from app.course_os.models import (  # noqa: E402
    BlueprintEdge,
    BlueprintNode,
    CourseBlueprint,
    CourseRadarItem,
    DashboardActivityPoint,
    DashboardSnapshot,
)
from app.evaluation.telemetry import AIUsageRecord, capture_ai_usage  # noqa: E402
from app.learning.guide import (  # noqa: E402
    AgnesLearningGuideInterpreter,
    LearningGuideIntent,
)


class _FailIfUsedGuide:
    async def classify(
        self,
        question: str,
        available_actions: tuple[str, ...],
    ) -> LearningGuideIntent:
        del question, available_actions
        raise RuntimeError("Agnes learner-intent classification fell back.")


def _id(value: str) -> UUID:
    return UUID(value)


def _blueprint() -> tuple[CourseBlueprint, UUID, UUID]:
    why_topic = BlueprintNode(
        id=_id("00000000-0000-0000-0000-000000000101"),
        logical_id=_id("10000000-0000-0000-0000-000000000101"),
        kind="topic",
        title="Why plan: the business plan as a thinking tool",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    core_topic = BlueprintNode(
        id=_id("00000000-0000-0000-0000-000000000102"),
        logical_id=_id("10000000-0000-0000-0000-000000000102"),
        kind="topic",
        title="Core entrepreneurial principles",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    concept = BlueprintNode(
        id=_id("00000000-0000-0000-0000-000000000201"),
        logical_id=_id("20000000-0000-0000-0000-000000000201"),
        kind="concept",
        title="Value creation and value capture as the core venture test",
        status="accepted",
        parent_id=None,
        metadata={"description": "A venture must create and capture value."},
    )
    blueprint = CourseBlueprint(
        course_id=_id("00000000-0000-0000-0000-000000000001"),
        revision_id=_id("00000000-0000-0000-0000-000000000002"),
        revision_kind="working",
        nodes=(why_topic, core_topic, concept),
        edges=(
            BlueprintEdge(
                id="contains:why-value",
                source_id=why_topic.id,
                target_id=concept.id,
                kind="contains",
                status="accepted",
            ),
            BlueprintEdge(
                id="contains:core-value",
                source_id=core_topic.id,
                target_id=concept.id,
                kind="contains",
                status="accepted",
            ),
        ),
        uncovered_concept_ids=(),
    )
    return blueprint, why_topic.logical_id, concept.logical_id


def _dashboard() -> DashboardSnapshot:
    mechanics_id = _id("30000000-0000-0000-0000-000000000001")
    vectors_id = _id("30000000-0000-0000-0000-000000000002")
    return DashboardSnapshot(
        courses=(),
        attention=(),
        total_courses=2,
        published_courses=2,
        courses_in_review=0,
        active_learners=18,
        new_learners=4,
        activity_history=(
            DashboardActivityPoint("2026-08-01", 12),
            DashboardActivityPoint("2026-08-02", 15),
        ),
        course_radar=(
            CourseRadarItem(
                course_id=mechanics_id,
                title="Mechanics",
                activity_trend=(7, 8, 9, 9, 10, 12, 15),
                active_learners=15,
                accuracy_percent=58,
                confidence_percent=86,
                confident_incorrect_attempts=6,
                clip_completion_percent=61,
                mastery_percent=39,
                mastery_movement=1,
                open_issues=3,
                agent_status="needs_attention",
                agent_role="learning_analyst",
            ),
            CourseRadarItem(
                course_id=vectors_id,
                title="Vectors",
                activity_trend=(2, 2, 3, 3, 3, 3, 3),
                active_learners=3,
                accuracy_percent=91,
                confidence_percent=74,
                confident_incorrect_attempts=0,
                clip_completion_percent=93,
                mastery_percent=76,
                mastery_movement=3,
                open_issues=0,
                agent_status="monitoring",
                agent_role=None,
            ),
        ),
    )


def _usage(records: list[AIUsageRecord]) -> list[dict[str, object]]:
    return [record.as_dict() for record in records]


async def _run(settings: Settings) -> dict[str, object]:
    if not settings.agnes_api_key:
        raise RuntimeError(
            "AGNES_API_KEY is missing. Add it to .env before running the live test."
        )

    blueprint, expected_source, expected_target = _blueprint()
    director = AgnesCourseDirector(
        settings.agnes_api_key,
        settings.agnes_agent_model,
        settings.agnes_base_url,
    )
    with capture_ai_usage() as director_usage:
        plan = await director.plan(
            "Remove 'Value creation and value capture as the core venture test' from "
            "'Why plan: the business plan as a thinking tool' only, while keeping it "
            "under 'Core entrepreneurial principles'.",
            blueprint,
        )
    if len(plan.actions) != 1:
        raise RuntimeError(f"Expected one Course Director action, got {len(plan.actions)}.")
    action = plan.actions[0]
    if (
        action.operation != "remove_relationship"
        or action.relationship_type != "contains"
        or action.source_logical_id != expected_source
        or action.target_logical_id != expected_target
    ):
        raise RuntimeError(f"Agnes returned the wrong bounded graph edit: {action!r}")

    assistant = AgnesDashboardAssistant(
        settings.agnes_api_key,
        settings.agnes_agent_model,
        settings.agnes_base_url,
    )
    with capture_ai_usage() as dashboard_usage:
        analysis = await assistant.analyze(
            "Where are learners confident but incorrect?",
            _dashboard(),
        )
    if analysis.course_title != "Mechanics" or not analysis.evidence:
        raise RuntimeError("Agnes dashboard analysis did not select grounded evidence.")

    guide = AgnesLearningGuideInterpreter(
        settings.agnes_api_key,
        settings.agnes_fast_model,
        settings.agnes_base_url,
        fallback=_FailIfUsedGuide(),
    )
    with capture_ai_usage() as guide_usage:
        intent = await guide.classify(
            "Why is this concept recommended next?",
            ("why_next", "next", "status"),
        )
    if intent != "why_next":
        raise RuntimeError(f"Expected why_next intent, got {intent}.")

    usage = [*director_usage, *dashboard_usage, *guide_usage]
    if len(usage) != 3 or any(record.provider != "agnes" for record in usage):
        raise RuntimeError("Expected three directly measured Agnes provider calls.")
    return {
        "status": "passed",
        "base_url": settings.agnes_base_url,
        "models": {
            "agent": settings.agnes_agent_model,
            "fast": settings.agnes_fast_model,
        },
        "checks": {
            "course_director": {
                "operation": action.operation,
                "relationship": action.relationship_type,
                "summary": action.summary,
            },
            "dashboard": {
                "course": analysis.course_title,
                "intent": analysis.intent,
                "evidence_ids": [item.id for item in analysis.evidence],
            },
            "learning_guide": {"intent": intent},
        },
        "usage": _usage(usage),
    }


def _fail(message: str) -> NoReturn:
    print(f"Agnes integration test failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional JSON evidence path; the API key is never written.",
    )
    args = parser.parse_args()
    try:
        result = asyncio.run(_run(Settings(_env_file=ROOT / ".env")))
    except Exception as exc:
        _fail(str(exc))
    rendered = json.dumps(result, indent=2)
    print(rendered)
    if args.output:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"{rendered}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
