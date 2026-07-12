from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.assessments.models import Question, QuestionEdit, QuestionType, RemediationProposal
from app.assessments.service import AssessmentService, AssessmentValidationError
from app.dependencies import get_assessment_service

router = APIRouter(tags=["assessments"])
AssessmentServiceDependency = Annotated[AssessmentService, Depends(get_assessment_service)]


class RemediationRequest(BaseModel):
    wrong_answer_pattern: str = Field(min_length=1)
    target_clip_id: UUID | None = None
    target_concept_id: UUID | None = None
    rationale: str = ""


class QuestionEditRequest(BaseModel):
    body: str = Field(min_length=1)
    type: QuestionType
    correct_answer: dict[str, object]
    confidence_prompt: str = Field(min_length=1)
    remediation_rules: list[RemediationRequest]


class RemediationResponse(BaseModel):
    id: UUID
    question_id: UUID
    wrong_answer_pattern: str
    target_clip_id: UUID | None
    target_concept_id: UUID | None
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None


class QuestionResponse(BaseModel):
    id: UUID
    topic_id: UUID
    body: str
    type: str
    correct_answer: dict[str, object]
    confidence_prompt: str
    review_status: str
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None
    remediation_rules: list[RemediationResponse]


class LearnerGateResponse(BaseModel):
    topic_id: UUID
    learner_accessible: bool
    reason: str | None


@router.post("/topics/{topic_id}/questions/generate", response_model=QuestionResponse)
async def generate_question(
    topic_id: UUID,
    service: AssessmentServiceDependency,
) -> QuestionResponse:
    try:
        question = await service.generate_question(topic_id)
    except AssessmentValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _question_response(question)


@router.get("/videos/{video_id}/questions", response_model=list[QuestionResponse])
async def list_video_questions(
    video_id: UUID,
    service: AssessmentServiceDependency,
) -> list[QuestionResponse]:
    questions = await service.list_questions_for_video(video_id)
    return [_question_response(question) for question in questions]


@router.post("/questions/{question_id}/regenerate", response_model=QuestionResponse)
async def regenerate_question(
    question_id: UUID,
    service: AssessmentServiceDependency,
) -> QuestionResponse:
    try:
        question = await service.regenerate_question(question_id)
    except AssessmentValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found.")
    return _question_response(question)


@router.post("/questions/{question_id}/accept", response_model=QuestionResponse)
async def accept_question(
    question_id: UUID,
    service: AssessmentServiceDependency,
) -> QuestionResponse:
    question = await service.accept_question(question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found.")
    return _question_response(question)


@router.post("/questions/{question_id}/dismiss", response_model=QuestionResponse)
async def dismiss_question(
    question_id: UUID,
    service: AssessmentServiceDependency,
) -> QuestionResponse:
    question = await service.dismiss_question(question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found.")
    return _question_response(question)


@router.patch("/questions/{question_id}", response_model=QuestionResponse)
async def edit_question(
    question_id: UUID,
    request: QuestionEditRequest,
    service: AssessmentServiceDependency,
) -> QuestionResponse:
    try:
        question = await service.edit_question(question_id, _edit_from_request(request))
    except AssessmentValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found.")
    return _question_response(question)


@router.get("/topics/{topic_id}/learner-gate", response_model=LearnerGateResponse)
async def topic_learner_gate(
    topic_id: UUID,
    service: AssessmentServiceDependency,
) -> LearnerGateResponse:
    learner_ready = await service.topic_is_learner_ready(topic_id)
    return LearnerGateResponse(
        topic_id=topic_id,
        learner_accessible=learner_ready,
        reason=None if learner_ready else "Topic has no approved assessment question.",
    )


def _edit_from_request(request: QuestionEditRequest) -> QuestionEdit:
    return QuestionEdit(
        body=request.body,
        type=request.type,
        correct_answer=request.correct_answer,
        confidence_prompt=request.confidence_prompt,
        remediation_rules=tuple(
            RemediationProposal(
                wrong_answer_pattern=rule.wrong_answer_pattern,
                target_clip_id=rule.target_clip_id,
                target_concept_id=rule.target_concept_id,
                rationale=rule.rationale,
            )
            for rule in request.remediation_rules
        ),
        action="edit",
    )


def _question_response(question: Question) -> QuestionResponse:
    return QuestionResponse(
        id=question.id,
        topic_id=question.topic_id,
        body=question.body,
        type=question.type.value,
        correct_answer=question.correct_answer,
        confidence_prompt=question.confidence_prompt,
        review_status=question.review_status.value,
        ai_proposal=question.ai_proposal,
        instructor_revision=question.instructor_revision,
        approved_at=question.approved_at,
        dismissed_at=question.dismissed_at,
        remediation_rules=[
            RemediationResponse(
                id=rule.id,
                question_id=rule.question_id,
                wrong_answer_pattern=rule.wrong_answer_pattern,
                target_clip_id=rule.target_clip_id,
                target_concept_id=rule.target_concept_id,
                ai_proposal=rule.ai_proposal,
                instructor_revision=rule.instructor_revision,
            )
            for rule in question.remediation_rules
        ],
    )
