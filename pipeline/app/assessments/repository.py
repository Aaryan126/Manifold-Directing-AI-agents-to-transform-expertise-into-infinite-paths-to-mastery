from abc import ABC, abstractmethod
from uuid import UUID

from app.assessments.models import AssessmentContext, Question, QuestionEdit, QuestionProposal


class AssessmentRepository(ABC):
    @abstractmethod
    async def get_context_for_topic(
        self,
        topic_id: UUID,
        include_proposed: bool = False,
    ) -> AssessmentContext | None:
        pass

    @abstractmethod
    async def replace_proposed_question(
        self,
        topic_id: UUID,
        proposal: QuestionProposal,
    ) -> Question:
        pass

    @abstractmethod
    async def list_questions_for_video(self, video_id: UUID) -> tuple[Question, ...]:
        pass

    @abstractmethod
    async def get_question(self, question_id: UUID) -> Question | None:
        pass

    @abstractmethod
    async def accept_question(self, question_id: UUID) -> Question | None:
        pass

    @abstractmethod
    async def dismiss_question(self, question_id: UUID) -> Question | None:
        pass

    @abstractmethod
    async def edit_question(self, question_id: UUID, edit: QuestionEdit) -> Question | None:
        pass

    @abstractmethod
    async def topic_has_approved_question(self, topic_id: UUID) -> bool:
        pass
