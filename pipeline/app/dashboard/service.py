import asyncio
from uuid import UUID

from app.audit.models import AuditEventCreate
from app.audit.service import AuditService, rationale_from_state, snapshot
from app.dashboard.models import (
    ActivityPoint,
    ClipSignalStats,
    ConceptSignalStats,
    DashboardAction,
    DashboardSignal,
    DashboardSignalStatus,
    DashboardSummary,
    LearnerOverride,
    MasteryDistribution,
    QuestionSignalStats,
)
from app.dashboard.repository import DashboardRepository
from app.dashboard.signal_generation import generate_signal_proposals


class DashboardValidationError(ValueError):
    pass


class DashboardService:
    def __init__(
        self,
        repository: DashboardRepository,
        audit_service: AuditService | None = None,
    ) -> None:
        self._repository = repository
        self._audit_service = audit_service
        self._refresh_tasks: dict[UUID, asyncio.Task[DashboardSummary]] = {}
        self._refresh_lock = asyncio.Lock()

    async def refresh_dashboard(self, course_id: UUID) -> DashboardSummary:
        async with self._refresh_lock:
            task = self._refresh_tasks.get(course_id)
            if task is None:
                task = asyncio.create_task(self._compute_dashboard(course_id))
                self._refresh_tasks[course_id] = task
        try:
            return await asyncio.shield(task)
        finally:
            async with self._refresh_lock:
                if self._refresh_tasks.get(course_id) is task and task.done():
                    del self._refresh_tasks[course_id]

    async def _compute_dashboard(self, course_id: UUID) -> DashboardSummary:
        learner_count = await self._repository.learner_count(course_id)
        attempt_count = await self._repository.attempt_count(course_id)
        concept_stats: tuple[ConceptSignalStats, ...] = ()
        question_stats: tuple[QuestionSignalStats, ...] = ()
        clip_stats: tuple[ClipSignalStats, ...] = ()
        activity_history: tuple[ActivityPoint, ...] = ()
        mastery_distribution = MasteryDistribution()
        if learner_count > 0 or attempt_count > 0:
            (
                concept_stats,
                question_stats,
                clip_stats,
                activity_history,
                mastery_distribution,
            ) = await asyncio.gather(
                self._repository.concept_stats(course_id),
                self._repository.question_stats(course_id),
                self._repository.clip_stats(course_id),
                self._repository.activity_history(course_id),
                self._repository.mastery_distribution(course_id),
            )
            proposals = generate_signal_proposals(
                concept_stats=concept_stats,
                question_stats=question_stats,
                clip_stats=clip_stats,
            )
            await self._repository.upsert_signals(course_id, proposals)
        signals = await self._repository.open_signals(course_id)
        return DashboardSummary(
            course_id=course_id,
            learner_count=learner_count,
            attempt_count=attempt_count,
            signals=signals,
            concept_stats=concept_stats,
            question_stats=question_stats,
            clip_stats=clip_stats,
            activity_history=activity_history,
            mastery_distribution=mastery_distribution,
        )

    async def accept_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        signal = await self._repository.accept_signal(signal_id, action)
        if signal is not None:
            await self._audit_signal(signal, "accept", action)
        return signal

    async def edit_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        signal = await self._repository.edit_signal(signal_id, action)
        if signal is not None:
            await self._audit_signal(signal, "edit", action)
        return signal

    async def dismiss_signal(
        self,
        signal_id: UUID,
        action: DashboardAction,
    ) -> DashboardSignal | None:
        signal = await self._repository.dismiss_signal(signal_id, action)
        if signal is not None:
            await self._audit_signal(signal, "dismiss", action)
        return signal

    async def apply_learner_override(self, override: LearnerOverride) -> None:
        if override.action not in {"skip_ahead", "send_back"}:
            raise DashboardValidationError(
                "Learner override action must be skip_ahead or send_back.",
            )
        await self._repository.apply_learner_override(override)
        await self._audit_override(override)

    async def _audit_signal(
        self,
        signal: DashboardSignal,
        action_name: str,
        action: DashboardAction,
    ) -> None:
        if self._audit_service is None:
            return
        state = snapshot(signal)
        await self._audit_service.record(
            AuditEventCreate(
                course_id=signal.course_id,
                artifact_type="dashboard_signal",
                artifact_id=signal.id,
                action=action_name,
                source="instructor",
                previous_state=None,
                new_state=state,
                ai_rationale=rationale_from_state(state),
                instructor_note=action.note,
                dashboard_signal_id=signal.id,
                scope="retroactive_reprocess" if action.retroactive else "going_forward",
            ),
        )

    async def _audit_override(self, override: LearnerOverride) -> None:
        if self._audit_service is None:
            return
        course_id = await self._repository.course_id_for_concept(override.concept_id)
        if course_id is None:
            return
        await self._audit_service.record(
            AuditEventCreate(
                course_id=course_id,
                artifact_type="learner_override",
                artifact_id=override.learner_id,
                action=override.action,
                source="instructor",
                previous_state=None,
                new_state=snapshot(override),
                ai_rationale=None,
                instructor_note=override.note,
                scope="single_learner",
            ),
        )


def not_enough_data(summary: DashboardSummary) -> bool:
    return summary.learner_count == 0 and summary.attempt_count == 0 and not summary.signals


def action_result_label(status: DashboardSignalStatus, retroactive: bool) -> str:
    scope = (
        "retroactively reprocessed in-progress learners"
        if retroactive
        else "applies going forward"
    )
    return f"{status.value}; {scope}"
