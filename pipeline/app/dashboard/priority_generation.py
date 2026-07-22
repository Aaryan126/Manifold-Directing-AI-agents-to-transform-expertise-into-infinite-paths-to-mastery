from uuid import UUID

from app.dashboard.models import DashboardPriority, DashboardSignal, TopicHealth


def generate_priorities(
    signals: tuple[DashboardSignal, ...],
    topics: tuple[TopicHealth, ...],
) -> tuple[DashboardPriority, ...]:
    priorities: list[DashboardPriority] = []
    for signal in signals:
        diagnosis = signal.ai_diagnosis
        metrics = _object_dict(diagnosis.get("metrics"))
        affected = _number(metrics, "struggling_learners", "learners")
        evidence_count = _number(metrics, "attempts", "remediation_attempts", "touched_learners")
        priorities.append(
            DashboardPriority(
                id=f"signal:{signal.id}",
                title=_text(diagnosis, "title", "Evidence needs your judgment"),
                summary=_text(
                    diagnosis,
                    "summary",
                    "Persisted learner evidence crossed a review threshold.",
                ),
                severity="high" if affected >= 2 else "medium",
                score=100 + min(30, affected * 6 + evidence_count),
                specialist_role=_specialist(signal.related_entity_type),
                target_artifact_type=signal.related_entity_type,
                target_artifact_id=signal.related_entity_id,
                target_logical_artifact_id=_uuid(diagnosis.get("target_logical_artifact_id")),
                affected_learners=affected,
                evidence_count=evidence_count,
                evidence={"signal_id": str(signal.id), **metrics},
                recommended_action=_text(
                    diagnosis,
                    "recommended_action",
                    "Inspect the evidence and prepare a private improvement.",
                ),
            )
        )
    for topic in topics:
        gaps: list[str] = []
        score = 0
        if topic.concept_count == 0:
            gaps.append("has no reviewed concept coverage")
            score += 85
        if topic.active_clips == 0:
            gaps.append("has no active learner clip")
            score += 75
        if topic.assessment_count == 0:
            gaps.append("has no reviewed assessment")
            score += 80
        if gaps:
            priorities.append(
                DashboardPriority(
                    id=f"design:{topic.logical_id}",
                    title=f"{topic.title} is not learner-ready",
                    summary=f"This topic {'; '.join(gaps)}.",
                    severity="high" if score >= 150 else "medium",
                    score=score,
                    specialist_role="curriculum_architect",
                    target_artifact_type="topic",
                    target_artifact_id=topic.topic_id,
                    target_logical_artifact_id=topic.logical_id,
                    affected_learners=0,
                    evidence_count=topic.concept_count
                    + topic.active_clips
                    + topic.assessment_count,
                    evidence={
                        "concept_count": topic.concept_count,
                        "active_clips": topic.active_clips,
                        "assessment_count": topic.assessment_count,
                    },
                    recommended_action="Prepare the missing learner-ready course artifact.",
                )
            )
        if topic.attempts >= 3:
            uncertain = topic.confidence_1 + topic.confidence_2
            incorrect = topic.attempts - topic.correct_attempts
            if uncertain / topic.attempts >= 0.4 or incorrect / topic.attempts >= 0.5:
                priorities.append(
                    DashboardPriority(
                        id=f"learning:{topic.logical_id}",
                        title=f"Learners need support in {topic.title}",
                        summary=(
                            f"{incorrect} of {topic.attempts} attempts were incorrect and "
                            f"{uncertain} carried low confidence."
                        ),
                        severity="high" if incorrect / topic.attempts >= 0.5 else "medium",
                        score=90 + incorrect + uncertain,
                        specialist_role="learning_analyst",
                        target_artifact_type="topic",
                        target_artifact_id=topic.topic_id,
                        target_logical_artifact_id=topic.logical_id,
                        affected_learners=topic.learner_reach,
                        evidence_count=topic.attempts,
                        evidence={
                            "attempts": topic.attempts,
                            "incorrect_attempts": incorrect,
                            "low_confidence_attempts": uncertain,
                        },
                        recommended_action="Inspect the related question and remediation clip.",
                    )
                )
    priorities.sort(key=lambda item: (-item.score, item.title))
    return tuple(priorities[:5])


def _specialist(entity_type: str) -> str:
    if entity_type == "clip":
        return "clip_editor"
    if entity_type == "question":
        return "assessment_designer"
    if entity_type in {"concept", "concept_edge"}:
        return "curriculum_architect"
    return "learning_analyst"


def _text(data: dict[str, object], key: str, fallback: str) -> str:
    value = data.get(key)
    return str(value) if value else fallback


def _number(data: dict[str, object], *keys: str) -> int:
    for key in keys:
        value = data.get(key)
        if isinstance(value, (int, float)):
            return int(value)
    return 0


def _object_dict(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in value.items()}


def _uuid(value: object) -> UUID | None:
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None
