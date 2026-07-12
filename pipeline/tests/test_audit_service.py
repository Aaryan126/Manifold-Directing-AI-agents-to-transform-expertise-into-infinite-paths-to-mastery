from uuid import UUID, uuid4

import pytest

from app.audit.models import AuditEvent, AuditEventCreate
from app.audit.repository import AuditRepository
from app.audit.service import AuditService
from app.dashboard.models import DashboardAction
from app.dashboard.service import DashboardService
from tests.test_dashboard_service import MemoryDashboardRepository


@pytest.mark.anyio
async def test_audit_log_completeness_across_simulated_instructor_and_learner_session() -> None:
    repository = MemoryAuditRepository()
    service = AuditService(repository)
    course_id = uuid4()
    artifacts = {
        "topic": uuid4(),
        "concept": uuid4(),
        "concept_edge": uuid4(),
        "clip": uuid4(),
        "question": uuid4(),
        "dashboard_signal": uuid4(),
    }

    await service.record(
        AuditEventCreate(
            course_id=course_id,
            artifact_type="topic",
            artifact_id=artifacts["topic"],
            action="propose",
            source="ai",
            new_state={"ai_proposal": {"evidence": "Transcript shifted to elimination."}},
            ai_rationale="Transcript shifted to elimination.",
        ),
    )
    for artifact_type in ("topic", "concept", "concept_edge", "clip", "question"):
        await service.record(
            AuditEventCreate(
                course_id=course_id,
                artifact_type=artifact_type,
                artifact_id=artifacts[artifact_type],
                action="accept",
                source="instructor",
                previous_state={"review_status": "proposed"},
                new_state={"review_status": "accepted"},
                ai_rationale="AI rationale remains visible.",
                instructor_note="Instructor approved.",
            ),
        )
    await service.record(
        AuditEventCreate(
            course_id=course_id,
            artifact_type="dashboard_signal",
            artifact_id=artifacts["dashboard_signal"],
            action="edit",
            source="instructor",
            previous_state={"status": "open"},
            new_state={"status": "edited"},
            ai_rationale="Learner attempts showed a stuck cohort.",
            instructor_note="Tune policy for future learners.",
            dashboard_signal_id=artifacts["dashboard_signal"],
            scope="going_forward",
        ),
    )
    await service.record(
        AuditEventCreate(
            course_id=course_id,
            artifact_type="learner_attempt",
            artifact_id=uuid4(),
            action="route",
            source="routing_engine",
            new_state={"mastery_state": "struggling"},
            scope="single_learner",
        ),
    )

    events = await service.list_for_course(course_id)

    assert {event.artifact_type for event in events} >= {
        "topic",
        "concept",
        "concept_edge",
        "clip",
        "question",
        "dashboard_signal",
        "learner_attempt",
    }
    assert all(event.action for event in events)
    assert all(event.source for event in events)
    assert next(
        event for event in events if event.artifact_type == "dashboard_signal"
    ).scope == "going_forward"


@pytest.mark.anyio
async def test_dashboard_going_forward_audit_does_not_mutate_in_progress_mastery() -> None:
    audit_repository = MemoryAuditRepository()
    dashboard_repository = MemoryDashboardRepository()
    learner_id = uuid4()
    dashboard_repository.mastery[(learner_id, dashboard_repository.concept_id)] = "struggling"
    service = DashboardService(
        dashboard_repository,
        audit_service=AuditService(audit_repository),
    )
    summary = await service.refresh_dashboard(dashboard_repository.course_id)

    await service.edit_signal(
        summary.signals[0].id,
        DashboardAction(
            action="edit",
            note="Apply to future learners only.",
            retroactive=False,
        ),
    )

    assert (
        dashboard_repository.mastery[(learner_id, dashboard_repository.concept_id)]
        == "struggling"
    )
    audit_events = await audit_repository.list_for_course(dashboard_repository.course_id)
    assert audit_events[-1].scope == "going_forward"
    assert audit_events[-1].instructor_note == "Apply to future learners only."


class MemoryAuditRepository(AuditRepository):
    def __init__(self) -> None:
        self.events: list[AuditEvent] = []

    async def record_event(self, event: AuditEventCreate) -> AuditEvent:
        stored = AuditEvent(
            id=uuid4(),
            course_id=event.course_id,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            artifact_type=event.artifact_type,
            artifact_id=event.artifact_id,
            action=event.action,
            source=event.source,
            previous_state=event.previous_state,
            new_state=event.new_state,
            ai_rationale=event.ai_rationale,
            instructor_note=event.instructor_note,
            dashboard_signal_id=event.dashboard_signal_id,
            scope=event.scope,
            created_at="2026-07-12T00:00:00Z",
        )
        self.events.append(stored)
        return stored

    async def list_for_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID,
    ) -> tuple[AuditEvent, ...]:
        return tuple(
            event
            for event in self.events
            if event.artifact_type == artifact_type and event.artifact_id == artifact_id
        )

    async def list_for_course(self, course_id: UUID) -> tuple[AuditEvent, ...]:
        return tuple(event for event in self.events if event.course_id == course_id)
