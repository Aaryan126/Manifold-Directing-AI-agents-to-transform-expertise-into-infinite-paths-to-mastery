from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from app.intelligence.models import ImprovementDraft


class CourseImprovementAgent(ABC):
    @abstractmethod
    async def prepare(
        self,
        *,
        artifact_type: str,
        logical_artifact_id: UUID,
        current_state: dict[str, Any],
        evidence: dict[str, Any],
        instruction: str,
    ) -> ImprovementDraft: ...
