from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.course_os.models import (
    AssessmentClipOption,
    AssessmentConceptOption,
    AssessmentTopicOption,
    AssessmentWorkspace,
    CourseAssessment,
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
        assert payload["questions"][0]["remediation_rules"][0][
            "target_concept_id"
        ] == str(concept_id)
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
