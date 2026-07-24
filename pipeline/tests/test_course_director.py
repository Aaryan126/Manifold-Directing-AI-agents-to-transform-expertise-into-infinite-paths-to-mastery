from uuid import uuid4

import pytest

from app.course_os.course_director import LocalCourseDirector
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
