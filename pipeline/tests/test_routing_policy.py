from uuid import uuid4

import pytest

from app.routing.models import (
    AttemptContext,
    AttemptSubmission,
    LearnerMastery,
    MasteryState,
    RouteableRemediationRule,
    RouteAction,
    RoutingPolicy,
)
from app.routing.policy import apply_next_target, evaluate_attempt


def test_correct_confident_advances_and_masters_current_concept() -> None:
    context = _context(policy=RoutingPolicy(confidence_threshold=3))
    evaluation = evaluate_attempt(
        _submission(correctness=True, confidence=4),
        context,
    )

    assert evaluation.mastery.state == MasteryState.MASTERED
    assert evaluation.decision.action == RouteAction.ADVANCE


def test_correct_low_confidence_reinforces_before_advancing() -> None:
    context = _context(policy=RoutingPolicy(confidence_threshold=4))
    evaluation = evaluate_attempt(
        _submission(correctness=True, confidence=2),
        context,
    )

    assert evaluation.mastery.state == MasteryState.PRACTICED
    assert evaluation.decision.action == RouteAction.REINFORCE
    assert evaluation.decision.target_concept_id == context.current_concept_id


def test_incorrect_uses_matching_remediation_rule() -> None:
    matching_rule = RouteableRemediationRule(
        id=uuid4(),
        wrong_answer_pattern="sign error",
        target_clip_id=uuid4(),
        target_concept_id=uuid4(),
    )
    context = _context(remediation_rules=(matching_rule,))
    evaluation = evaluate_attempt(
        _submission(
            correctness=False,
            confidence=3,
            wrong_answer_pattern="Sign Error",
        ),
        context,
    )

    assert evaluation.mastery.state == MasteryState.STRUGGLING
    assert evaluation.decision.action == RouteAction.REMEDIATE
    assert evaluation.selected_rule == matching_rule
    assert evaluation.decision.target_clip_id == matching_rule.target_clip_id


def test_incorrect_beyond_max_remediation_flags_instructor() -> None:
    context = _context(
        policy=RoutingPolicy(max_remediation_attempts=1),
        mastery=LearnerMastery(
            concept_id=uuid4(),
            state=MasteryState.STRUGGLING,
            remediation_attempts=1,
        ),
    )
    evaluation = evaluate_attempt(_submission(correctness=False, confidence=2), context)

    assert evaluation.decision.action == RouteAction.FLAG_INSTRUCTOR
    assert evaluation.needs_instructor_signal


def test_apply_next_target_completes_when_no_eligible_concepts_remain() -> None:
    context = _context()
    evaluation = evaluate_attempt(_submission(correctness=True, confidence=4), context)

    routed = apply_next_target(
        evaluation.decision,
        next_concept_id=None,
        resolved_clip_id=None,
    )

    assert routed.action == RouteAction.COMPLETE


def _context(
    *,
    policy: RoutingPolicy | None = None,
    mastery: LearnerMastery | None = None,
    remediation_rules: tuple[RouteableRemediationRule, ...] = (),
) -> AttemptContext:
    concept_id = mastery.concept_id if mastery else uuid4()
    return AttemptContext(
        course_id=uuid4(),
        learner_id=uuid4(),
        question_id=uuid4(),
        topic_id=uuid4(),
        current_concept_id=concept_id,
        policy=policy or RoutingPolicy(),
        mastery=mastery
        or LearnerMastery(concept_id=concept_id, state=MasteryState.NOT_STARTED),
        mastered_concept_ids=frozenset(),
        remediation_rules=remediation_rules,
    )


def _submission(
    *,
    correctness: bool,
    confidence: int,
    wrong_answer_pattern: str | None = None,
) -> AttemptSubmission:
    return AttemptSubmission(
        learner_id=uuid4(),
        question_id=uuid4(),
        answer={"answer": "x"},
        correctness=correctness,
        confidence=confidence,
        wrong_answer_pattern=wrong_answer_pattern,
    )


def test_invalid_confidence_is_rejected() -> None:
    with pytest.raises(ValueError, match="Confidence"):
        evaluate_attempt(_submission(correctness=True, confidence=5), _context())
