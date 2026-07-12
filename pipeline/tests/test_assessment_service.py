from uuid import UUID, uuid4

import pytest

from app.assessments.agent import AssessmentAgent
from app.assessments.models import (
    AssessmentClip,
    AssessmentConcept,
    AssessmentContext,
    AssessmentTopic,
    Question,
    QuestionEdit,
    QuestionProposal,
    QuestionReviewStatus,
    QuestionType,
    RemediationProposal,
    RemediationRule,
)
from app.assessments.repository import AssessmentRepository
from app.assessments.service import AssessmentService, AssessmentValidationError


@pytest.mark.anyio
async def test_generate_question_requires_remediation_targets_to_usable_clips() -> None:
    context = _context()
    service = AssessmentService(
        repository=MemoryAssessmentRepository(context),
        agent=StaticAssessmentAgent(_proposal(context, target_clip_id=uuid4())),
    )

    with pytest.raises(AssessmentValidationError, match="unusable clip"):
        await service.generate_question(context.topic.id)


@pytest.mark.anyio
async def test_generate_accept_and_learner_gate_flow() -> None:
    context = _context()
    repository = MemoryAssessmentRepository(context)
    service = AssessmentService(
        repository=repository,
        agent=StaticAssessmentAgent(_proposal(context)),
    )

    question = await service.generate_question(context.topic.id)
    assert question.review_status == QuestionReviewStatus.PROPOSED
    assert not await service.topic_is_learner_ready(context.topic.id)

    accepted = await service.accept_question(question.id)

    assert accepted is not None
    assert accepted.review_status == QuestionReviewStatus.ACCEPTED
    assert await service.topic_is_learner_ready(context.topic.id)

    grade = await service.grade_answer(question.id, "It creates simpler equivalent systems.")

    assert grade is not None
    assert grade.is_correct is True
    assert grade.wrong_answer_pattern is None


@pytest.mark.anyio
async def test_regenerate_produces_distinct_variant() -> None:
    context = _context()
    repository = MemoryAssessmentRepository(context)
    service = AssessmentService(
        repository=repository,
        agent=SequencedAssessmentAgent(
            (_proposal(context, body="First?"), _proposal(context, body="Second?")),
        ),
    )
    first = await service.generate_question(context.topic.id)

    regenerated = await service.regenerate_question(first.id)

    assert regenerated is not None
    assert regenerated.body == "Second?"
    assert regenerated.body != first.body


@pytest.mark.anyio
async def test_edit_question_preserves_ai_proposal_and_sets_instructor_revision() -> None:
    context = _context()
    repository = MemoryAssessmentRepository(context)
    service = AssessmentService(
        repository=repository,
        agent=StaticAssessmentAgent(_proposal(context)),
    )
    question = await service.generate_question(context.topic.id)

    edited = await service.edit_question(
        question.id,
        QuestionEdit(
            body="Instructor edited?",
            type=QuestionType.SHORT_ANSWER,
            correct_answer={"answer": "Edited"},
            confidence_prompt="Confidence?",
            remediation_rules=_proposal(context).remediation_rules,
            action="edit",
        ),
    )

    assert edited is not None
    assert edited.body == "Instructor edited?"
    assert edited.review_status == QuestionReviewStatus.EDITED
    assert edited.ai_proposal is not None
    assert edited.instructor_revision is not None


class StaticAssessmentAgent(AssessmentAgent):
    def __init__(self, proposal: QuestionProposal) -> None:
        self._proposal = proposal

    async def propose_question(
        self,
        context: AssessmentContext,
        previous_question: str | None = None,
    ) -> QuestionProposal:
        del context, previous_question
        return self._proposal


class SequencedAssessmentAgent(AssessmentAgent):
    def __init__(self, proposals: tuple[QuestionProposal, ...]) -> None:
        self._proposals = list(proposals)

    async def propose_question(
        self,
        context: AssessmentContext,
        previous_question: str | None = None,
    ) -> QuestionProposal:
        del context, previous_question
        return self._proposals.pop(0)


class MemoryAssessmentRepository(AssessmentRepository):
    def __init__(self, context: AssessmentContext) -> None:
        self.context = context
        self.questions: dict[UUID, Question] = {}

    async def get_context_for_topic(self, topic_id: UUID) -> AssessmentContext | None:
        return self.context if topic_id == self.context.topic.id else None

    async def replace_proposed_question(
        self,
        topic_id: UUID,
        proposal: QuestionProposal,
    ) -> Question:
        self.questions = {
            question_id: question
            for question_id, question in self.questions.items()
            if not (
                question.topic_id == topic_id
                and question.review_status == QuestionReviewStatus.PROPOSED
            )
        }
        question = _question_from_proposal(topic_id, proposal)
        self.questions[question.id] = question
        return question

    async def list_questions_for_video(self, video_id: UUID) -> tuple[Question, ...]:
        del video_id
        return tuple(self.questions.values())

    async def get_question(self, question_id: UUID) -> Question | None:
        return self.questions.get(question_id)

    async def accept_question(self, question_id: UUID) -> Question | None:
        question = self.questions.get(question_id)
        if question is None:
            return None
        updated = _replace_question(question, review_status=QuestionReviewStatus.ACCEPTED)
        self.questions[question_id] = updated
        return updated

    async def dismiss_question(self, question_id: UUID) -> Question | None:
        question = self.questions.get(question_id)
        if question is None:
            return None
        updated = _replace_question(question, review_status=QuestionReviewStatus.DISMISSED)
        self.questions[question_id] = updated
        return updated

    async def edit_question(self, question_id: UUID, edit: QuestionEdit) -> Question | None:
        question = self.questions.get(question_id)
        if question is None:
            return None
        updated = _replace_question(
            question,
            body=edit.body,
            type=edit.type,
            correct_answer=edit.correct_answer,
            confidence_prompt=edit.confidence_prompt,
            review_status=QuestionReviewStatus.EDITED,
            instructor_revision={"action": edit.action, "body": edit.body},
        )
        self.questions[question_id] = updated
        return updated

    async def topic_has_approved_question(self, topic_id: UUID) -> bool:
        return any(
            question.topic_id == topic_id
            and question.review_status
            in {QuestionReviewStatus.ACCEPTED, QuestionReviewStatus.EDITED}
            for question in self.questions.values()
        )


def _context() -> AssessmentContext:
    concept_id = uuid4()
    clip_id = uuid4()
    return AssessmentContext(
        topic=AssessmentTopic(
            id=uuid4(),
            course_id=uuid4(),
            title="Linear systems",
            summary="Solving systems by elimination.",
        ),
        concepts=(AssessmentConcept(id=concept_id, name="Elimination", description="Basics"),),
        clips=(
            AssessmentClip(
                id=clip_id,
                concept_ids=(concept_id,),
                type="explanation",
                start_seconds=0,
                end_seconds=60,
            ),
        ),
    )


def _proposal(
    context: AssessmentContext,
    *,
    body: str = "What is elimination?",
    target_clip_id: UUID | None = None,
) -> QuestionProposal:
    concept = context.concepts[0]
    clip = context.clips[0]
    return QuestionProposal(
        body=body,
        type=QuestionType.MCQ,
        correct_answer={"answer": "It creates simpler equivalent systems."},
        confidence_prompt="How confident are you? (1-4)",
        remediation_rules=(
            RemediationProposal(
                wrong_answer_pattern="thinks it changes the solution",
                target_clip_id=clip.id if target_clip_id is None else target_clip_id,
                target_concept_id=concept.id,
                rationale="Review elimination.",
            ),
        ),
        rationale="Tests the main concept.",
        confidence=0.8,
    )


def _question_from_proposal(topic_id: UUID, proposal: QuestionProposal) -> Question:
    question_id = uuid4()
    return Question(
        id=question_id,
        topic_id=topic_id,
        body=proposal.body,
        type=proposal.type,
        correct_answer=proposal.correct_answer,
        confidence_prompt=proposal.confidence_prompt,
        review_status=QuestionReviewStatus.PROPOSED,
        ai_proposal={"body": proposal.body},
        instructor_revision=None,
        approved_at=None,
        dismissed_at=None,
        remediation_rules=tuple(
            RemediationRule(
                id=uuid4(),
                question_id=question_id,
                wrong_answer_pattern=rule.wrong_answer_pattern,
                target_clip_id=rule.target_clip_id,
                target_concept_id=rule.target_concept_id,
                ai_proposal={"rationale": rule.rationale},
                instructor_revision=None,
            )
            for rule in proposal.remediation_rules
        ),
    )


def _replace_question(
    question: Question,
    *,
    body: str | None = None,
    type: QuestionType | None = None,
    correct_answer: dict[str, object] | None = None,
    confidence_prompt: str | None = None,
    review_status: QuestionReviewStatus | None = None,
    instructor_revision: dict[str, object] | None = None,
) -> Question:
    return Question(
        id=question.id,
        topic_id=question.topic_id,
        body=question.body if body is None else body,
        type=question.type if type is None else type,
        correct_answer=question.correct_answer if correct_answer is None else correct_answer,
        confidence_prompt=(
            question.confidence_prompt if confidence_prompt is None else confidence_prompt
        ),
        review_status=question.review_status if review_status is None else review_status,
        ai_proposal=question.ai_proposal,
        instructor_revision=(
            question.instructor_revision if instructor_revision is None else instructor_revision
        ),
        approved_at=question.approved_at,
        dismissed_at=question.dismissed_at,
        remediation_rules=question.remediation_rules,
    )
