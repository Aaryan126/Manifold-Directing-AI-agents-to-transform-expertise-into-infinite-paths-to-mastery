from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.dependencies import get_learning_service
from app.learning.models import LearningGuideMessage
from app.main import app


def test_learning_guide_message_routes_persisted_exchange() -> None:
    learner_id = uuid4()
    course_id = uuid4()
    created_at = datetime.now(UTC)
    learner_message = LearningGuideMessage(
        id=uuid4(),
        role="learner",
        content="What should I do next?",
        intent=None,
        action=None,
        created_at=created_at,
    )
    guide_message = LearningGuideMessage(
        id=uuid4(),
        role="guide",
        content="Your next active step is to watch the reviewed explanation.",
        intent="next",
        action="replay",
        created_at=created_at,
    )
    service = AsyncMock()
    service.guide_messages.return_value = (learner_message, guide_message)
    service.message_guide.return_value = (learner_message, guide_message)
    app.dependency_overrides[get_learning_service] = lambda: service
    client = TestClient(app)

    try:
        history = client.get(
            f"/learn/courses/{course_id}/guide/messages",
            headers={"X-User-ID": str(learner_id)},
        )
        exchange = client.post(
            f"/learn/courses/{course_id}/guide/messages",
            headers={"X-User-ID": str(learner_id)},
            json={"content": "What should I do next?"},
        )

        assert history.status_code == 200
        assert exchange.status_code == 200
        assert exchange.json()[1]["intent"] == "next"
        assert exchange.json()[1]["action"] == "replay"
        service.guide_messages.assert_awaited_once_with(learner_id, course_id)
        service.message_guide.assert_awaited_once_with(
            learner_id,
            course_id,
            "What should I do next?",
        )
    finally:
        app.dependency_overrides.clear()
