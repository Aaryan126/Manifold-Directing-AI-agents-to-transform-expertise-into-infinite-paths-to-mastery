from uuid import uuid4

import pytest

from app.course_os.course_director import LocalCourseDirector
from app.course_os.models import BlueprintNode, CourseBlueprint


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
