from uuid import UUID

from app.assessments.agent import AssessmentAgent
from app.assessments.models import (
    AssessmentContext,
    Question,
    QuestionEdit,
    QuestionProposal,
)
from app.assessments.repository import AssessmentRepository
from app.audit.models import AuditEventCreate
from app.audit.service import (
    AuditService,
    instructor_note_from_state,
    rationale_from_state,
    snapshot,
)


class AssessmentValidationError(ValueError):
    pass


class AssessmentService:
    def __init__(
        self,
        repository: AssessmentRepository,
        agent: AssessmentAgent,
        audit_service: AuditService | None = None,
    ) -> None:
        self._repository = repository
        self._agent = agent
        self._audit_service = audit_service

    async def generate_question(self, topic_id: UUID) -> Question:
        context = await self._context(topic_id)
        proposal = await self._agent.propose_question(context)
        validate_proposal(proposal, context)
        question = await self._repository.replace_proposed_question(topic_id, proposal)
        await self._audit(context.topic.course_id, question, None, question, "propose", "ai")
        return question

    async def regenerate_question(self, question_id: UUID) -> Question | None:
        existing = await self._repository.get_question(question_id)
        if existing is None:
            return None
        context = await self._context(existing.topic_id)
        proposal = await self._agent.propose_question(context, previous_question=existing.body)
        validate_proposal(proposal, context)
        question = await self._repository.replace_proposed_question(existing.topic_id, proposal)
        await self._audit(
            context.topic.course_id,
            question,
            existing,
            question,
            "regenerate",
            "ai",
        )
        return question

    async def list_questions_for_video(self, video_id: UUID) -> tuple[Question, ...]:
        return await self._repository.list_questions_for_video(video_id)

    async def accept_question(self, question_id: UUID) -> Question | None:
        previous = await self._repository.get_question(question_id)
        question = await self._repository.accept_question(question_id)
        if question is not None:
            context = await self._context(question.topic_id)
            await self._audit(
                context.topic.course_id,
                question,
                previous,
                question,
                "accept",
                "instructor",
            )
        return question

    async def dismiss_question(self, question_id: UUID) -> Question | None:
        previous = await self._repository.get_question(question_id)
        question = await self._repository.dismiss_question(question_id)
        if question is not None:
            context = await self._context(question.topic_id)
            await self._audit(
                context.topic.course_id,
                question,
                previous,
                question,
                "dismiss",
                "instructor",
            )
        return question

    async def edit_question(self, question_id: UUID, edit: QuestionEdit) -> Question | None:
        existing = await self._repository.get_question(question_id)
        if existing is None:
            return None
        context = await self._context(existing.topic_id)
        validate_edit(edit, context)
        question = await self._repository.edit_question(question_id, edit)
        if question is not None:
            await self._audit(
                context.topic.course_id,
                question,
                existing,
                question,
                edit.action,
                "instructor",
            )
        return question

    async def topic_is_learner_ready(self, topic_id: UUID) -> bool:
        return await self._repository.topic_has_approved_question(topic_id)

    async def _context(self, topic_id: UUID) -> AssessmentContext:
        context = await self._repository.get_context_for_topic(topic_id)
        if context is None:
            raise AssessmentValidationError("Reviewed topic context not found.")
        if not context.concepts:
            raise AssessmentValidationError("No reviewed concepts are available for assessment.")
        if not context.clips:
            raise AssessmentValidationError(
                "No usable reviewed clips are available for remediation.",
            )
        return context

    async def _audit(
        self,
        course_id: UUID,
        question: Question,
        previous: Question | None,
        new: Question,
        action: str,
        source: str,
    ) -> None:
        if self._audit_service is None:
            return
        previous_state = snapshot(previous)
        new_state = snapshot(new)
        await self._audit_service.record(
            AuditEventCreate(
                course_id=course_id,
                artifact_type="question",
                artifact_id=question.id,
                action=action,
                source=source,
                previous_state=previous_state,
                new_state=new_state,
                ai_rationale=rationale_from_state(new_state or previous_state),
                instructor_note=instructor_note_from_state(new_state),
            ),
        )


def validate_edit(edit: QuestionEdit, context: AssessmentContext) -> None:
    proposal = QuestionProposal(
        body=edit.body,
        type=edit.type,
        correct_answer=edit.correct_answer,
        confidence_prompt=edit.confidence_prompt,
        remediation_rules=edit.remediation_rules,
        rationale="Instructor edit",
        confidence=1.0,
    )
    validate_proposal(proposal, context)


def validate_proposal(proposal: QuestionProposal, context: AssessmentContext) -> None:
    if not proposal.body.strip():
        raise AssessmentValidationError("Question body is required.")
    if not proposal.confidence_prompt.strip():
        raise AssessmentValidationError("Confidence prompt is required.")
    if not proposal.correct_answer:
        raise AssessmentValidationError("Correct answer is required.")
    if not proposal.remediation_rules:
        raise AssessmentValidationError("At least one remediation rule is required.")

    concept_ids = {concept.id for concept in context.concepts}
    clip_ids = {clip.id for clip in context.clips}
    for rule in proposal.remediation_rules:
        if not rule.wrong_answer_pattern.strip():
            raise AssessmentValidationError("Wrong-answer pattern is required.")
        if rule.target_clip_id is None and rule.target_concept_id is None:
            raise AssessmentValidationError("Each remediation rule needs a target.")
        if rule.target_clip_id is not None and rule.target_clip_id not in clip_ids:
            raise AssessmentValidationError("Remediation rule targets an unusable clip.")
        if rule.target_concept_id is not None and rule.target_concept_id not in concept_ids:
            raise AssessmentValidationError("Remediation rule targets an unreviewed concept.")
