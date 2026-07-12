from app.dashboard.models import (
    ClipSignalStats,
    ConceptSignalStats,
    DashboardSignalProposal,
    DashboardSignalType,
    QuestionSignalStats,
)


def generate_signal_proposals(
    *,
    concept_stats: tuple[ConceptSignalStats, ...],
    question_stats: tuple[QuestionSignalStats, ...],
    clip_stats: tuple[ClipSignalStats, ...],
) -> tuple[DashboardSignalProposal, ...]:
    proposals: list[DashboardSignalProposal] = []
    proposals.extend(_stuck_cohort_signals(concept_stats))
    proposals.extend(_underperforming_question_signals(question_stats))
    proposals.extend(_underperforming_clip_signals(clip_stats))
    proposals.extend(_graph_drift_signals(concept_stats))
    return tuple(proposals)


def _stuck_cohort_signals(
    concept_stats: tuple[ConceptSignalStats, ...],
) -> tuple[DashboardSignalProposal, ...]:
    proposals: list[DashboardSignalProposal] = []
    for stats in concept_stats:
        if stats.touched_learners == 0:
            continue
        struggling_rate = stats.struggling_learners / stats.touched_learners
        if stats.struggling_learners >= 2 or struggling_rate >= 0.4:
            proposals.append(
                DashboardSignalProposal(
                    type=DashboardSignalType.STUCK_COHORT,
                    related_entity_type="concept",
                    related_entity_id=stats.concept_id,
                    title=f"Learners are stuck on {stats.concept_name}",
                    summary=(
                        f"{stats.struggling_learners} of {stats.touched_learners} learner(s) "
                        "who touched this concept are struggling."
                    ),
                    recommended_action="Review routing policy and remediation coverage.",
                    fingerprint=f"stuck:{stats.concept_id}:{stats.struggling_learners}",
                    metrics={
                        "touched_learners": stats.touched_learners,
                        "struggling_learners": stats.struggling_learners,
                        "struggling_rate": struggling_rate,
                    },
                ),
            )
    return tuple(proposals)


def _underperforming_question_signals(
    question_stats: tuple[QuestionSignalStats, ...],
) -> tuple[DashboardSignalProposal, ...]:
    proposals: list[DashboardSignalProposal] = []
    for stats in question_stats:
        if stats.attempts < 3:
            continue
        incorrect_rate = stats.incorrect_attempts / stats.attempts
        low_confidence_rate = stats.low_confidence_correct_attempts / stats.attempts
        if incorrect_rate >= 0.5:
            proposals.append(
                DashboardSignalProposal(
                    type=DashboardSignalType.UNDERPERFORMING_CONTENT,
                    related_entity_type="question",
                    related_entity_id=stats.question_id,
                    title="Question may be confusing learners",
                    summary=(
                        f"{stats.incorrect_attempts} of {stats.attempts} attempt(s) were "
                        "incorrect."
                    ),
                    recommended_action="Review the question wording and remediation mapping.",
                    fingerprint=f"question:{stats.question_id}:{stats.incorrect_attempts}",
                    metrics={
                        "attempts": stats.attempts,
                        "incorrect_attempts": stats.incorrect_attempts,
                        "incorrect_rate": incorrect_rate,
                        "low_confidence_rate": low_confidence_rate,
                    },
                ),
            )
    return tuple(proposals)


def _underperforming_clip_signals(
    clip_stats: tuple[ClipSignalStats, ...],
) -> tuple[DashboardSignalProposal, ...]:
    proposals: list[DashboardSignalProposal] = []
    for stats in clip_stats:
        if stats.remediation_attempts >= 3 or stats.struggling_learners >= 2:
            proposals.append(
                DashboardSignalProposal(
                    type=DashboardSignalType.UNDERPERFORMING_CONTENT,
                    related_entity_type="clip",
                    related_entity_id=stats.clip_id,
                    title="Clip may need review",
                    summary=(
                        f"This clip is tied to {stats.remediation_attempts} remediation "
                        f"attempt(s) and {stats.struggling_learners} struggling learner(s)."
                    ),
                    recommended_action="Flag the clip for instructor review or replacement.",
                    fingerprint=f"clip:{stats.clip_id}:{stats.remediation_attempts}",
                    metrics={
                        "remediation_attempts": stats.remediation_attempts,
                        "struggling_learners": stats.struggling_learners,
                    },
                ),
            )
    return tuple(proposals)


def _graph_drift_signals(
    concept_stats: tuple[ConceptSignalStats, ...],
) -> tuple[DashboardSignalProposal, ...]:
    proposals: list[DashboardSignalProposal] = []
    for stats in concept_stats:
        if stats.mastered_prerequisite_struggling_learners >= 2:
            proposals.append(
                DashboardSignalProposal(
                    type=DashboardSignalType.GRAPH_DRIFT,
                    related_entity_type="concept",
                    related_entity_id=stats.concept_id,
                    title=f"Prerequisite graph may be incomplete for {stats.concept_name}",
                    summary=(
                        f"{stats.mastered_prerequisite_struggling_learners} learner(s) "
                        "struggled here despite mastering listed prerequisites."
                    ),
                    recommended_action="Review whether an additional prerequisite edge is missing.",
                    fingerprint=(
                        "graph-drift:"
                        f"{stats.concept_id}:{stats.mastered_prerequisite_struggling_learners}"
                    ),
                    metrics={
                        "mastered_prerequisite_struggling_learners": (
                            stats.mastered_prerequisite_struggling_learners
                        ),
                    },
                ),
            )
    return tuple(proposals)
