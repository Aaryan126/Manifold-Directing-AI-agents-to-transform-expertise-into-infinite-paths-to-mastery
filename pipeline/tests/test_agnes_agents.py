from typing import Any, cast
from uuid import uuid4

import pytest
from pydantic import BaseModel

from app.course_os.course_director import (
    AgnesCourseDirector,
    _DirectorActionOutput,
    _DirectorPlanOutput,
)
from app.course_os.dashboard_assistant import (
    AgnesDashboardAssistant,
    _CommandOutput,
    search_dashboard_evidence,
)
from app.course_os.models import (
    BlueprintEdge,
    BlueprintNode,
    CourseBlueprint,
    CourseRadarItem,
    DashboardSnapshot,
)
from app.learning.guide import AgnesLearningGuideInterpreter, _IntentOutput


class _StructuredResult:
    def __init__(self, output: BaseModel) -> None:
        self.output = output
        self.request: dict[str, Any] | None = None

    async def parse(self, **kwargs: Any) -> BaseModel:
        self.request = kwargs
        return self.output


def _director_blueprint() -> tuple[CourseBlueprint, BlueprintNode, BlueprintNode]:
    topic = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="topic",
        title="Why plan",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    concept = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="concept",
        title="Value creation and capture",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    return (
        CourseBlueprint(
            course_id=uuid4(),
            revision_id=uuid4(),
            revision_kind="working",
            nodes=(topic, concept),
            edges=(
                BlueprintEdge(
                    id=f"contains:{uuid4()}",
                    source_id=topic.id,
                    target_id=concept.id,
                    kind="contains",
                    status="accepted",
                ),
            ),
            uncovered_concept_ids=(),
        ),
        topic,
        concept,
    )


def _dashboard_snapshot() -> DashboardSnapshot:
    return DashboardSnapshot(
        courses=(),
        attention=(),
        total_courses=1,
        published_courses=1,
        courses_in_review=0,
        active_learners=12,
        new_learners=3,
        activity_history=(),
        course_radar=(
            CourseRadarItem(
                course_id=uuid4(),
                title="Mechanics",
                activity_trend=(5, 6, 7, 8, 9, 10, 12),
                active_learners=12,
                accuracy_percent=58,
                confidence_percent=86,
                confident_incorrect_attempts=6,
                clip_completion_percent=64,
                mastery_percent=42,
                mastery_movement=1,
                open_issues=2,
                agent_status="needs_attention",
                agent_role="learning_analyst",
            ),
        ),
    )


@pytest.mark.anyio
async def test_agnes_course_director_uses_existing_bounded_graph_validation() -> None:
    blueprint, topic, concept = _director_blueprint()
    structured = _StructuredResult(
        _DirectorPlanOutput(
            summary="Remove the old topic placement only.",
            actions=[
                _DirectorActionOutput(
                    operation="remove_relationship",
                    summary="Remove the old placement",
                    rationale="The concept remains available elsewhere.",
                    relationship_type="contains",
                    source_logical_id=str(topic.logical_id),
                    target_logical_id=str(concept.logical_id),
                )
            ],
        )
    )
    director = AgnesCourseDirector("key", "agnes-2.5-flash", "https://example.test/v1")
    cast(Any, director)._client = structured

    plan = await director.plan("Remove the concept from Why plan.", blueprint)

    assert plan.actions[0].operation == "remove_relationship"
    assert plan.actions[0].source_logical_id == topic.logical_id
    assert plan.actions[0].target_logical_id == concept.logical_id
    assert structured.request is not None
    assert structured.request["operation"] == "course_director_plan"


@pytest.mark.anyio
async def test_agnes_dashboard_answer_is_limited_to_retrieved_evidence() -> None:
    snapshot = _dashboard_snapshot()
    records = search_dashboard_evidence(
        "Where are learners confident but incorrect?", snapshot
    )
    evidence = next(
        record.reference
        for record in records
        if record.reference.metric == "confident-incorrect"
    )
    structured = _StructuredResult(
        _CommandOutput(
            intent="question",
            answer="Mechanics has the clearest confidence mismatch.",
            target_course_id=str(snapshot.course_radar[0].course_id),
            evidence_ids=[evidence.id, "not-a-retrieved-record"],
        )
    )
    assistant = AgnesDashboardAssistant(
        "key", "agnes-2.5-flash", "https://example.test/v1"
    )
    cast(Any, assistant)._client = structured

    result = await assistant.analyze(
        "Where are learners confident but incorrect?", snapshot
    )

    assert result.course_title == "Mechanics"
    assert result.evidence == (evidence,)
    assert structured.request is not None
    assert structured.request["operation"] == "dashboard_analysis"


@pytest.mark.anyio
async def test_agnes_learning_guide_returns_only_an_allowlisted_intent() -> None:
    structured = _StructuredResult(_IntentOutput(intent="why_next"))
    guide = AgnesLearningGuideInterpreter(
        "key", "agnes-1.5-flash", "https://example.test/v1"
    )
    cast(Any, guide)._client = structured

    intent = await guide.classify(
        "Why is this concept recommended next?", ("why_next", "next", "status")
    )

    assert intent == "why_next"
    assert structured.request is not None
    assert structured.request["operation"] == "learning_guide_intent"
