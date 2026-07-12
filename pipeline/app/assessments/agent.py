from abc import ABC, abstractmethod

from app.assessments.models import AssessmentContext, QuestionProposal


class AssessmentAgent(ABC):
    @abstractmethod
    async def propose_question(
        self,
        context: AssessmentContext,
        previous_question: str | None = None,
    ) -> QuestionProposal:
        pass
