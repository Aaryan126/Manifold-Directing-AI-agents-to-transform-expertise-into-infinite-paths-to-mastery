from uuid import UUID

from app.routing.models import (
    AdvancementMode,
    AttemptContext,
    AttemptSubmission,
    LearnerMastery,
    MasteryState,
    RouteableRemediationRule,
    RouteAction,
    RouteDecision,
    RoutingEvaluation,
)


def evaluate_attempt(
    submission: AttemptSubmission,
    context: AttemptContext,
) -> RoutingEvaluation:
    if submission.confidence < 1 or submission.confidence > 4:
        raise ValueError("Confidence must be between 1 and 4.")

    if submission.correctness:
        return _evaluate_correct(submission, context)
    return _evaluate_incorrect(submission, context)


def _evaluate_correct(
    submission: AttemptSubmission,
    context: AttemptContext,
) -> RoutingEvaluation:
    policy = context.policy
    confident = submission.confidence >= policy.confidence_threshold
    next_correct_confident_attempts = (
        context.mastery.correct_confident_attempts + 1
        if confident
        else context.mastery.correct_confident_attempts
    )
    if confident and next_correct_confident_attempts >= policy.correct_attempts_for_mastery:
        mastery = LearnerMastery(
            concept_id=context.current_concept_id,
            state=MasteryState.MASTERED,
            correct_confident_attempts=next_correct_confident_attempts,
            remediation_attempts=context.mastery.remediation_attempts,
        )
        return RoutingEvaluation(
            decision=RouteDecision(
                action=RouteAction.ADVANCE,
                mastery_state=mastery.state,
                why="Correct and confident; advancing to the next eligible concept.",
            ),
            mastery=mastery,
        )

    mastery = LearnerMastery(
        concept_id=context.current_concept_id,
        state=(
            MasteryState.MASTERED
            if policy.advancement_mode == AdvancementMode.ALLOW_PARTIAL
            else MasteryState.PRACTICED
        ),
        correct_confident_attempts=next_correct_confident_attempts,
        remediation_attempts=context.mastery.remediation_attempts,
    )
    return RoutingEvaluation(
        decision=RouteDecision(
            action=(
                RouteAction.ADVANCE
                if mastery.state == MasteryState.MASTERED
                else RouteAction.REINFORCE
            ),
            mastery_state=mastery.state,
            why=(
                "Correct but not yet confident; showing reinforcement before advancing."
                if mastery.state == MasteryState.PRACTICED
                else "Correct with partial-understanding advancement allowed by policy."
            ),
            target_concept_id=context.current_concept_id,
        ),
        mastery=mastery,
    )


def _evaluate_incorrect(
    submission: AttemptSubmission,
    context: AttemptContext,
) -> RoutingEvaluation:
    remediation_attempts = context.mastery.remediation_attempts + 1
    mastery = LearnerMastery(
        concept_id=context.current_concept_id,
        state=MasteryState.STRUGGLING,
        correct_confident_attempts=context.mastery.correct_confident_attempts,
        remediation_attempts=remediation_attempts,
    )
    if remediation_attempts > context.policy.max_remediation_attempts:
        return RoutingEvaluation(
            decision=RouteDecision(
                action=RouteAction.FLAG_INSTRUCTOR,
                mastery_state=mastery.state,
                why=(
                    "Maximum remediation attempts exceeded; instructor review has been flagged "
                    "instead of looping the learner."
                ),
                target_concept_id=context.current_concept_id,
            ),
            mastery=mastery,
            needs_instructor_signal=True,
        )

    rule = select_remediation_rule(
        context.remediation_rules,
        submission.wrong_answer_pattern,
    )
    return RoutingEvaluation(
        decision=RouteDecision(
            action=RouteAction.REMEDIATE,
            mastery_state=mastery.state,
            why=(
                "Incorrect answer matched a reviewed remediation rule."
                if rule
                else "Incorrect answer; routing to an active reviewed clip for this concept."
            ),
            target_concept_id=rule.target_concept_id if rule else context.current_concept_id,
            target_clip_id=rule.target_clip_id if rule else None,
        ),
        mastery=mastery,
        selected_rule=rule,
    )


def select_remediation_rule(
    rules: tuple[RouteableRemediationRule, ...],
    wrong_answer_pattern: str | None,
) -> RouteableRemediationRule | None:
    if wrong_answer_pattern:
        normalized = wrong_answer_pattern.strip().casefold()
        for rule in rules:
            if rule.wrong_answer_pattern.strip().casefold() == normalized:
                return rule
    return rules[0] if rules else None


def apply_next_target(
    decision: RouteDecision,
    *,
    next_concept_id: UUID | None,
    resolved_clip_id: UUID | None,
) -> RouteDecision:
    if decision.action == RouteAction.ADVANCE:
        if next_concept_id is None:
            return RouteDecision(
                action=RouteAction.COMPLETE,
                mastery_state=decision.mastery_state,
                why="Current concept mastered and no eligible concepts remain.",
            )
        return RouteDecision(
            action=decision.action,
            mastery_state=decision.mastery_state,
            why=decision.why,
            target_concept_id=next_concept_id,
        )
    if decision.action in {RouteAction.REINFORCE, RouteAction.REMEDIATE}:
        return RouteDecision(
            action=decision.action,
            mastery_state=decision.mastery_state,
            why=decision.why,
            target_concept_id=decision.target_concept_id,
            target_clip_id=decision.target_clip_id or resolved_clip_id,
        )
    return decision
