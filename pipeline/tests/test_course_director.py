from uuid import uuid4

import pytest

from app.course_os.course_director import (
    LocalCourseDirector,
    _blueprint_context,
    _clear_director_text,
    _DirectorActionOutput,
    _DirectorPlanOutput,
    _validated_plan,
)
from app.course_os.models import BlueprintEdge, BlueprintNode, CourseBlueprint


def _blueprint() -> CourseBlueprint:
    concept = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="concept",
        title="Learning efficiently",
        status="accepted",
        parent_id=None,
        metadata={"description": "The original explanation."},
    )
    return CourseBlueprint(
        course_id=uuid4(),
        revision_id=uuid4(),
        revision_kind="working",
        nodes=(concept,),
        edges=(),
        uncovered_concept_ids=(),
    )


def test_openai_director_plan_uses_closed_nested_structured_output_models() -> None:
    schema = _DirectorPlanOutput.model_json_schema()

    assert schema["additionalProperties"] is False
    assert schema["$defs"]["_DirectorActionOutput"]["additionalProperties"] is False
    assert schema["$defs"]["_DirectorProposedStateOutput"]["additionalProperties"] is False
    assert schema["$defs"]["_DirectorCorrectAnswerOutput"]["additionalProperties"] is False


def test_director_context_omits_relationships_with_a_missing_endpoint() -> None:
    blueprint = _blueprint()
    blueprint = CourseBlueprint(
        course_id=blueprint.course_id,
        revision_id=blueprint.revision_id,
        revision_kind=blueprint.revision_kind,
        nodes=blueprint.nodes,
        edges=(
            BlueprintEdge(
                id=f"assesses:{uuid4()}",
                source_id=uuid4(),
                target_id=blueprint.nodes[0].id,
                kind="assesses",
                status="accepted",
            ),
        ),
        uncovered_concept_ids=(),
    )

    context = _blueprint_context("Remove the topic", blueprint)

    assert context["relationships"] == []
    assert context["nodes"][0]["logical_id"] == str(blueprint.nodes[0].logical_id)


def test_director_context_identifies_artifacts_already_removed_privately() -> None:
    working = _blueprint()
    removed_topic = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="topic",
        title="Debunking the popular 10,000-hour rule",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    active = CourseBlueprint(
        course_id=working.course_id,
        revision_id=uuid4(),
        revision_kind="active",
        nodes=(*working.nodes, removed_topic),
        edges=(),
        uncovered_concept_ids=(),
    )

    context = _blueprint_context("Remove the 10,000-hour topic", working, active)

    assert context["published_artifacts_absent_from_private_revision"] == [
        {
            "logical_id": str(removed_topic.logical_id),
            "kind": "topic",
            "title": removed_topic.title,
            "status": "accepted",
        }
    ]


def test_director_accepts_a_reviewed_topic_removal_plan() -> None:
    topic = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="topic",
        title="Debunking the popular 10,000-hour rule",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    blueprint = CourseBlueprint(
        course_id=uuid4(),
        revision_id=uuid4(),
        revision_kind="working",
        nodes=(topic,),
        edges=(),
        uncovered_concept_ids=(),
    )
    output = _DirectorPlanOutput(
        summary="Prepare the requested topic removal.",
        actions=[
            _DirectorActionOutput(
                operation="remove_artifact",
                artifact_kind="topic",
                logical_artifact_id=str(topic.logical_id),
                summary="Remove the 10,000-hour rule topic",
                rationale="The instructor explicitly requested this private removal.",
            )
        ],
    )

    plan = _validated_plan(output, blueprint)

    assert plan.clarification is None
    assert len(plan.actions) == 1
    assert plan.actions[0].operation == "remove_artifact"
    assert plan.actions[0].logical_artifact_id == topic.logical_id


@pytest.mark.anyio
async def test_local_director_plans_bounded_rename_against_exact_blueprint_node() -> None:
    blueprint = _blueprint()

    plan = await LocalCourseDirector().plan(
        "Rename Learning efficiently to Deliberate learning",
        blueprint,
    )

    assert plan.clarification is None
    assert len(plan.actions) == 1
    action = plan.actions[0]
    assert action.operation == "update_artifact"
    assert action.logical_artifact_id == blueprint.nodes[0].logical_id
    assert action.proposed_state == {"name": "Deliberate learning"}


@pytest.mark.anyio
async def test_local_director_requests_clarification_instead_of_guessing() -> None:
    plan = await LocalCourseDirector().plan("Make it better", _blueprint())

    assert plan.actions == ()
    assert plan.clarification is not None
    assert "exact topic, concept, clip, question, or connection" in plan.clarification


@pytest.mark.anyio
async def test_local_director_explains_artifact_already_removed_from_private_revision() -> None:
    working = _blueprint()
    removed_topic = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="topic",
        title="Debunking the popular 10,000-hour rule",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    active = CourseBlueprint(
        course_id=working.course_id,
        revision_id=uuid4(),
        revision_kind="active",
        nodes=(*working.nodes, removed_topic),
        edges=(),
        uncovered_concept_ids=(),
    )

    plan = await LocalCourseDirector().plan(
        "Remove the Debunking the popular 10,000-hour rule topic",
        working,
        active,
    )

    assert plan.actions == ()
    assert plan.clarification is not None
    assert "already removed in Design" in plan.clarification
    assert "Publish updates" in plan.clarification


@pytest.mark.anyio
async def test_local_director_fuzzily_matches_small_numeric_title_typo() -> None:
    working = _blueprint()
    removed_topic = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="topic",
        title="Debunking the popular 10,000-hour rule",
        status="accepted",
        parent_id=None,
        metadata={},
    )
    active = CourseBlueprint(
        course_id=working.course_id,
        revision_id=uuid4(),
        revision_kind="active",
        nodes=(*working.nodes, removed_topic),
        edges=(),
        uncovered_concept_ids=(),
    )

    plan = await LocalCourseDirector().plan(
        "Remove the debunking the popular 1000 hour rule topic",
        working,
        active,
    )

    assert plan.actions == ()
    assert plan.clarification == (
        "“Debunking the popular 10,000-hour rule” is already removed in Design. "
        "Live still shows the published course until you choose Publish updates."
    )


def test_director_reply_removes_internal_ids_and_stray_non_english_fragments() -> None:
    value = (
        'The topic "Debunking" '
        "(logical_id: fa435b53-2e7f-4678-81ab-ee81f43b42b0) is already removed. "
        "You can确认/"
    )

    assert _clear_director_text(value) == 'The topic "Debunking" is already removed.'


@pytest.mark.anyio
async def test_local_director_prepares_reviewed_question_for_named_concept() -> None:
    course_id = uuid4()
    revision_id = uuid4()
    topic = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="topic",
        title="Practice design",
        status="accepted",
        parent_id=None,
        metadata={"summary": "How to structure practice."},
    )
    concept = BlueprintNode(
        id=uuid4(),
        logical_id=uuid4(),
        kind="concept",
        title="Deliberate practice",
        status="accepted",
        parent_id=topic.id,
        metadata={"description": "Practice with focused feedback and correction."},
    )
    blueprint = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
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
    )

    plan = await LocalCourseDirector().plan(
        "Add another question for Deliberate practice",
        blueprint,
    )

    assert plan.clarification is None
    assert len(plan.actions) == 1
    action = plan.actions[0]
    assert action.operation == "create_question"
    assert action.proposed_state is not None
    assert action.proposed_state["topic_logical_id"] == str(topic.logical_id)
    assert action.proposed_state["primary_concept_logical_id"] == str(concept.logical_id)
    assert action.proposed_state["type"] == "short_answer"
