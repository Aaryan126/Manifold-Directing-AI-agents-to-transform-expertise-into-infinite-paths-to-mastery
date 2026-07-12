from uuid import uuid4

from app.dashboard.models import ClipSignalStats, ConceptSignalStats, QuestionSignalStats
from app.dashboard.signal_generation import generate_signal_proposals


def test_dashboard_signal_generation_emits_all_signal_types() -> None:
    concept_id = uuid4()
    question_id = uuid4()
    clip_id = uuid4()
    topic_id = uuid4()

    proposals = generate_signal_proposals(
        concept_stats=(
            ConceptSignalStats(
                concept_id=concept_id,
                concept_name="Back substitution",
                touched_learners=5,
                struggling_learners=3,
                mastered_prerequisite_struggling_learners=2,
            ),
        ),
        question_stats=(
            QuestionSignalStats(
                question_id=question_id,
                topic_id=topic_id,
                prompt="Which step comes next?",
                attempts=4,
                incorrect_attempts=3,
                low_confidence_correct_attempts=0,
            ),
        ),
        clip_stats=(
            ClipSignalStats(
                clip_id=clip_id,
                concept_id=concept_id,
                topic_id=topic_id,
                remediation_attempts=3,
                struggling_learners=1,
            ),
        ),
    )

    assert {proposal.type.value for proposal in proposals} == {
        "stuck_cohort",
        "underperforming_content",
        "graph_drift",
    }
    assert any(proposal.related_entity_id == concept_id for proposal in proposals)
    assert any(proposal.related_entity_id == question_id for proposal in proposals)
    assert any(proposal.related_entity_id == clip_id for proposal in proposals)


def test_dashboard_signal_generation_ignores_low_sample_question_data() -> None:
    proposals = generate_signal_proposals(
        concept_stats=(),
        question_stats=(
            QuestionSignalStats(
                question_id=uuid4(),
                topic_id=uuid4(),
                prompt="Too early?",
                attempts=2,
                incorrect_attempts=2,
                low_confidence_correct_attempts=0,
            ),
        ),
        clip_stats=(),
    )

    assert proposals == ()
