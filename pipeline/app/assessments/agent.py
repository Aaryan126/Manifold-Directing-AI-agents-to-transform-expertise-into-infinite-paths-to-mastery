from abc import ABC, abstractmethod

from app.assessments.models import AnswerGrade, AssessmentContext, Question, QuestionProposal


class AssessmentAgent(ABC):
    @abstractmethod
    async def propose_question(
        self,
        context: AssessmentContext,
        previous_question: str | None = None,
    ) -> QuestionProposal:
        pass

    async def grade_answer(self, question: Question, learner_answer: str) -> AnswerGrade:
        expected = str(question.correct_answer.get("answer", "")).strip().casefold()
        submitted = learner_answer.strip().casefold()
        is_correct = bool(expected) and submitted == expected
        return AnswerGrade(
            is_correct=is_correct,
            feedback="Correct." if is_correct else "That does not match the reviewed answer yet.",
            wrong_answer_pattern=(
                None
                if is_correct
                else question.remediation_rules[0].wrong_answer_pattern
                if question.remediation_rules
                else "incorrect"
            ),
        )
