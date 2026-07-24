from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.course_os.models import (
    AssessmentClipOption,
    AssessmentConceptOption,
    AssessmentTopicOption,
    AssessmentWorkspace,
    BlueprintConceptEvidence,
    BlueprintEdge,
    BlueprintMutationImpact,
    BlueprintNode,
    CourseAssessment,
    CourseBlueprint,
    CourseRoutingPolicy,
    CourseSummary,
    DashboardCommandResult,
    DashboardSnapshot,
    RoutingPolicyDraft,
)
from app.dependencies import get_course_os_service
from app.main import app


def test_teacher_dashboard_returns_empty_state_metrics() -> None:
    instructor_id = uuid4()
    service = AsyncMock()
    service.dashboard.return_value = DashboardSnapshot(
        courses=(),
        attention=(),
        total_courses=0,
        published_courses=0,
        courses_in_review=0,
        active_learners=0,
        new_learners=0,
        activity_history=(),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.get(
            "/instructors/me/dashboard",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert response.status_code == 200
        assert response.json() == {
            "courses": [],
            "attention": [],
            "total_courses": 0,
            "published_courses": 0,
            "courses_in_review": 0,
            "active_learners": 0,
            "new_learners": 0,
            "activity_history": [],
            "course_radar": [],
        }
        service.dashboard.assert_awaited_once_with(instructor_id)
    finally:
        app.dependency_overrides.clear()


def test_dashboard_command_returns_grounded_result() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    service = AsyncMock()
    service.dashboard_command.return_value = DashboardCommandResult(
        kind="evidence",
        message="Mechanics has the strongest misconception signal.",
        course_id=course_id,
        course_title="Mechanics",
        action_label="Inspect evidence",
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/instructors/me/dashboard/command",
            headers={"X-User-ID": str(instructor_id)},
            json={"content": "Where are learners confident but incorrect?"},
        )

        assert response.status_code == 200
        assert response.json()["course_id"] == str(course_id)
        assert response.json()["kind"] == "evidence"
        service.dashboard_command.assert_awaited_once_with(
            instructor_id,
            "Where are learners confident but incorrect?",
        )
    finally:
        app.dependency_overrides.clear()


def test_create_course_returns_working_revision() -> None:
    instructor_id = uuid4()
    course = CourseSummary(
        id=uuid4(),
        instructor_id=instructor_id,
        title="Mechanics",
        description=None,
        status="draft",
        active_revision_id=None,
        working_revision_id=uuid4(),
        revision_status="building",
        generation_run_id=None,
        generation_status=None,
        generation_phase=None,
        generation_progress=0,
        source_count=0,
        topic_count=0,
        concept_count=0,
        pending_review_count=0,
        open_signal_count=0,
        updated_at=datetime.now(UTC),
    )
    service = AsyncMock()
    service.create_course.return_value = course
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            "/courses",
            headers={"X-User-ID": str(instructor_id)},
            json={"title": "Mechanics"},
        )

        assert response.status_code == 201
        assert response.json()["working_revision_id"] == str(course.working_revision_id)
        assert response.json()["revision_status"] == "building"
    finally:
        app.dependency_overrides.clear()


def test_blueprint_returns_typed_artifact_graph_and_evidence() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    topic_id = uuid4()
    concept_id = uuid4()
    clip_id = uuid4()
    service = AsyncMock()
    service.blueprint.return_value = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
        revision_kind="active",
        nodes=(
            BlueprintNode(topic_id, uuid4(), "topic", "Foundations", "accepted", None, {}),
            BlueprintNode(
                concept_id,
                uuid4(),
                "concept",
                "Core idea",
                "accepted",
                topic_id,
                {"sequence_rank": 1},
            ),
            BlueprintNode(
                clip_id,
                uuid4(),
                "clip",
                "Focused explanation",
                "active",
                topic_id,
                {"duration_seconds": 75},
            ),
        ),
        edges=(
            BlueprintEdge(
                f"contains:{topic_id}:{concept_id}",
                topic_id,
                concept_id,
                "contains",
                "accepted",
            ),
            BlueprintEdge(
                f"teaches:{concept_id}:{clip_id}",
                concept_id,
                clip_id,
                "teaches",
                "accepted",
            ),
        ),
        uncovered_concept_ids=(),
    )
    service.blueprint_evidence.return_value = (
        BlueprintConceptEvidence(
            concept_id=concept_id,
            attempts=4,
            touched_learners=2,
            correct_percent=50.0,
            confident_percent=75.0,
            confident_incorrect=1,
            mastery={"struggling": 1, "mastered": 1},
            route_actions={"remediate": 2},
        ),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        graph_response = client.get(
            f"/courses/{course_id}/blueprint?revision=active",
            headers={"X-User-ID": str(instructor_id)},
        )
        evidence_response = client.get(
            f"/courses/{course_id}/blueprint/evidence?revision=active&days=14",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert graph_response.status_code == 200
        assert {node["kind"] for node in graph_response.json()["nodes"]} == {
            "topic",
            "concept",
            "clip",
        }
        assert {edge["kind"] for edge in graph_response.json()["edges"]} == {
            "contains",
            "teaches",
        }
        assert evidence_response.status_code == 200
        assert evidence_response.json()[0]["confident_incorrect"] == 1
        service.blueprint.assert_awaited_once_with(course_id, instructor_id, "active")
        service.blueprint_evidence.assert_awaited_once_with(
            course_id,
            instructor_id,
            "active",
            14,
            None,
        )
    finally:
        app.dependency_overrides.clear()


def test_blueprint_sequence_forwards_complete_instructor_order() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    first_id = uuid4()
    second_id = uuid4()
    service = AsyncMock()
    service.update_concept_sequence.return_value = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
        revision_kind="working",
        nodes=(),
        edges=(),
        uncovered_concept_ids=(),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.put(
            f"/courses/{course_id}/blueprint/sequence",
            headers={"X-User-ID": str(instructor_id)},
            json={"concept_ids": [str(first_id), str(second_id)]},
        )

        assert response.status_code == 200
        service.update_concept_sequence.assert_awaited_once_with(
            course_id,
            instructor_id,
            (first_id, second_id),
        )
    finally:
        app.dependency_overrides.clear()


def test_blueprint_prerequisite_opens_a_reviewable_working_graph_edit() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    from_concept_id = uuid4()
    to_concept_id = uuid4()
    service = AsyncMock()
    service.add_blueprint_prerequisite.return_value = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
        revision_kind="working",
        nodes=(),
        edges=(),
        uncovered_concept_ids=(),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.post(
            f"/courses/{course_id}/blueprint/prerequisites",
            headers={"X-User-ID": str(instructor_id)},
            json={
                "from_concept_id": str(from_concept_id),
                "to_concept_id": str(to_concept_id),
            },
        )

        assert response.status_code == 201
        assert response.json()["revision_kind"] == "working"
        service.add_blueprint_prerequisite.assert_awaited_once_with(
            course_id,
            instructor_id,
            from_concept_id,
            to_concept_id,
        )
    finally:
        app.dependency_overrides.clear()


def test_blueprint_concept_edit_is_forwarded_as_private_instructor_work() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    concept_id = uuid4()
    service = AsyncMock()
    service.update_blueprint_concept.return_value = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
        revision_kind="working",
        nodes=(),
        edges=(),
        uncovered_concept_ids=(),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.patch(
            f"/courses/{course_id}/blueprint/concepts/{concept_id}",
            headers={"X-User-ID": str(instructor_id)},
            json={"name": "Revised concept", "description": "Clearer scope."},
        )

        assert response.status_code == 200
        service.update_blueprint_concept.assert_awaited_once_with(
            course_id,
            instructor_id,
            concept_id,
            "Revised concept",
            "Clearer scope.",
        )
    finally:
        app.dependency_overrides.clear()


def test_blueprint_concept_topic_assignment_is_forwarded_as_private_work() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    concept_id = uuid4()
    topic_ids = (uuid4(), uuid4())
    service = AsyncMock()
    service.update_blueprint_concept_topics.return_value = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
        revision_kind="working",
        nodes=(),
        edges=(),
        uncovered_concept_ids=(),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.put(
            f"/courses/{course_id}/blueprint/concepts/{concept_id}/topics",
            headers={"X-User-ID": str(instructor_id)},
            json={"topic_logical_ids": [str(topic_id) for topic_id in topic_ids]},
        )

        assert response.status_code == 200
        assert response.json()["revision_kind"] == "working"
        service.update_blueprint_concept_topics.assert_awaited_once_with(
            course_id,
            instructor_id,
            concept_id,
            topic_ids,
        )
    finally:
        app.dependency_overrides.clear()


def test_blueprint_design_mutations_and_impact_are_forwarded_as_private_work() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    topic_id = uuid4()
    concept_id = uuid4()
    prerequisite_id = uuid4()
    service = AsyncMock()
    blueprint = CourseBlueprint(
        course_id=course_id,
        revision_id=revision_id,
        revision_kind="working",
        nodes=(),
        edges=(),
        uncovered_concept_ids=(),
    )
    service.create_blueprint_topic.return_value = blueprint
    service.create_blueprint_concept.return_value = blueprint
    service.remove_blueprint_prerequisite.return_value = blueprint
    service.remove_blueprint_artifact.return_value = blueprint
    service.blueprint_mutation_impact.return_value = BlueprintMutationImpact(
        artifact_kind="concept",
        logical_artifact_id=concept_id,
        title="Deliberate practice",
        affected_topics=("Practice foundations",),
        affected_concepts=("Deliberate practice",),
        affected_clips=("Focused explanation",),
        affected_questions=("What makes practice deliberate?",),
        affected_relationships=3,
        learner_records_preserved=True,
        warnings=("One teaching clip will be removed from this revision.",),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        topic_response = client.post(
            f"/courses/{course_id}/blueprint/topics",
            headers={"X-User-ID": str(instructor_id)},
            json={
                "title": "Practice foundations",
                "summary": "Establish the core idea.",
                "start_seconds": 10,
                "end_seconds": 70,
            },
        )
        concept_response = client.post(
            f"/courses/{course_id}/blueprint/concepts",
            headers={"X-User-ID": str(instructor_id)},
            json={
                "name": "Deliberate practice",
                "description": "Purposeful practice with feedback.",
                "topic_logical_ids": [str(topic_id)],
                "sequence_after_id": None,
            },
        )
        prerequisite_response = client.delete(
            f"/courses/{course_id}/blueprint/prerequisites/{prerequisite_id}",
            headers={"X-User-ID": str(instructor_id)},
        )
        impact_response = client.get(
            f"/courses/{course_id}/blueprint/artifacts/concept/{concept_id}/impact",
            headers={"X-User-ID": str(instructor_id)},
        )
        removal_response = client.delete(
            f"/courses/{course_id}/blueprint/artifacts/concept/{concept_id}",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert topic_response.status_code == 201
        assert concept_response.status_code == 201
        assert prerequisite_response.status_code == 200
        assert impact_response.status_code == 200
        assert impact_response.json()["learner_records_preserved"] is True
        assert impact_response.json()["affected_relationships"] == 3
        assert removal_response.status_code == 200
        service.create_blueprint_topic.assert_awaited_once_with(
            course_id,
            instructor_id,
            "Practice foundations",
            "Establish the core idea.",
            10.0,
            70.0,
        )
        service.create_blueprint_concept.assert_awaited_once_with(
            course_id,
            instructor_id,
            "Deliberate practice",
            "Purposeful practice with feedback.",
            (topic_id,),
            None,
        )
        service.remove_blueprint_prerequisite.assert_awaited_once_with(
            course_id,
            instructor_id,
            prerequisite_id,
        )
        service.remove_blueprint_artifact.assert_awaited_once_with(
            course_id,
            instructor_id,
            "concept",
            concept_id,
        )
    finally:
        app.dependency_overrides.clear()


def test_delete_course_returns_no_content_after_confirmation_request() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    service = AsyncMock()
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.delete(
            f"/courses/{course_id}",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert response.status_code == 204
        assert response.content == b""
        service.delete_course.assert_awaited_once_with(course_id, instructor_id)
    finally:
        app.dependency_overrides.clear()


def test_assessment_workspace_returns_current_revision_questions_and_targets() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    revision_id = uuid4()
    topic_id = uuid4()
    concept_id = uuid4()
    clip_id = uuid4()
    question_id = uuid4()
    service = AsyncMock()
    service.assessment_workspace.return_value = AssessmentWorkspace(
        revision_id=revision_id,
        is_working_revision=False,
        topics=(AssessmentTopicOption(id=topic_id, title="Foundations"),),
        concepts=(
            AssessmentConceptOption(
                id=concept_id,
                name="Core idea",
                topic_ids=(topic_id,),
            ),
        ),
        clips=(
            AssessmentClipOption(
                id=clip_id,
                topic_id=topic_id,
                topic_title="Foundations",
                video_id=uuid4(),
                label="Recap",
                start_seconds=30.0,
                end_seconds=75.0,
                type="explanation",
                difficulty="introductory",
                status="active",
                playback_provider="mux",
                playback_id="playback-1",
                playback_url="https://stream.example/video.m3u8",
                delivery_asset_id="asset-1",
                materialization_status="source_reference",
            ),
        ),
        questions=(
            CourseAssessment(
                id=question_id,
                logical_id=uuid4(),
                topic_id=topic_id,
                topic_title="Foundations",
                body="Explain the core idea.",
                type="short_answer",
                correct_answer={"text": "A grounded explanation"},
                confidence_prompt="How confident are you?",
                review_status="accepted",
                remediation_rules=(
                    {
                        "wrong_answer_pattern": "missing evidence",
                        "target_clip_id": str(clip_id),
                        "target_concept_id": str(concept_id),
                    },
                ),
            ),
        ),
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.get(
            f"/courses/{course_id}/assessment-workspace",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["revision_id"] == str(revision_id)
        assert payload["is_working_revision"] is False
        assert payload["questions"][0]["body"] == "Explain the core idea."
        assert payload["questions"][0]["remediation_rules"][0]["target_concept_id"] == str(
            concept_id
        )
        assert payload["clips"][0]["topic_title"] == "Foundations"
        assert payload["clips"][0]["video_id"]
        assert payload["clips"][0]["playback_provider"] == "mux"
        assert payload["clips"][0]["start_seconds"] == 30.0
        service.assessment_workspace.assert_awaited_once_with(course_id, instructor_id)
    finally:
        app.dependency_overrides.clear()


def test_update_default_routing_policy_validates_and_forwards_structured_policy() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    service = AsyncMock()
    expected = RoutingPolicyDraft(
        confidence_threshold=3,
        correct_attempts_for_mastery=2,
        advancement_mode="require_mastery",
        max_remediation_attempts=2,
    )
    service.upsert_routing_policy.return_value = CourseRoutingPolicy(
        id=uuid4(),
        concept_id=None,
        concept_name=None,
        policy=expected,
    )
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.put(
            f"/courses/{course_id}/routing-workspace/default",
            headers={"X-User-ID": str(instructor_id)},
            json={
                "confidence_threshold": 3,
                "correct_attempts_for_mastery": 2,
                "advancement_mode": "require_mastery",
                "max_remediation_attempts": 2,
            },
        )

        assert response.status_code == 200
        assert response.json()["policy"] == {
            "confidence_threshold": 3,
            "correct_attempts_for_mastery": 2,
            "advancement_mode": "require_mastery",
            "max_remediation_attempts": 2,
        }
        service.upsert_routing_policy.assert_awaited_once_with(
            course_id,
            None,
            instructor_id,
            expected,
        )
    finally:
        app.dependency_overrides.clear()


def test_delete_concept_routing_policy_returns_no_content() -> None:
    instructor_id = uuid4()
    course_id = uuid4()
    concept_id = uuid4()
    service = AsyncMock()
    app.dependency_overrides[get_course_os_service] = lambda: service
    client = TestClient(app)

    try:
        response = client.delete(
            f"/courses/{course_id}/routing-workspace/{concept_id}",
            headers={"X-User-ID": str(instructor_id)},
        )

        assert response.status_code == 204
        assert response.content == b""
        service.delete_routing_policy.assert_awaited_once_with(
            course_id,
            concept_id,
            instructor_id,
        )
    finally:
        app.dependency_overrides.clear()
