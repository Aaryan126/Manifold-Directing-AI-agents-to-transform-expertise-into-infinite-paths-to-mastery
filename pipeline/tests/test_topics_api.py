from uuid import uuid4

from fastapi.testclient import TestClient

from app.dependencies import get_segmentation_service
from app.main import app
from app.segmentation.models import TopicProposal, VideoTranscript
from app.segmentation.service import SegmentationService
from tests.fakes import MemoryTopicRepository, StaticSegmentationAgent


def test_topic_review_endpoints_support_accept_edit_and_dismiss() -> None:
    video_id = uuid4()
    transcript = VideoTranscript(video_id=video_id, course_id=uuid4(), text="", words=())
    repository = MemoryTopicRepository(transcript)
    service = SegmentationService(
        repository=repository,
        agent=StaticSegmentationAgent(
            (
                TopicProposal(
                    title="AI topic",
                    summary="AI summary",
                    start_seconds=0,
                    end_seconds=700,
                    evidence="boundary cue",
                    confidence=0.8,
                ),
            )
        ),
    )
    app.dependency_overrides[get_segmentation_service] = lambda: service
    client = TestClient(app)

    try:
        segment_response = client.post(f"/videos/{video_id}/segment")
        assert segment_response.status_code == 200
        topic_id = segment_response.json()[0]["id"]

        accept_response = client.post(f"/videos/topics/{topic_id}/accept")
        assert accept_response.status_code == 200
        assert accept_response.json()["review_status"] == "accepted"

        edit_response = client.patch(
            f"/videos/topics/{topic_id}",
            json={
                "title": "Instructor topic",
                "summary": "Edited summary",
                "start_seconds": 0,
                "end_seconds": 720,
            },
        )
        assert edit_response.status_code == 200
        edited = edit_response.json()
        assert edited["review_status"] == "edited"
        assert edited["ai_proposal"]["title"] == "AI topic"
        assert edited["instructor_revision"]["title"] == "Instructor topic"

        dismiss_response = client.post(f"/videos/topics/{topic_id}/dismiss")
        assert dismiss_response.status_code == 200
        assert dismiss_response.json()["review_status"] == "dismissed"
        list_response = client.get(f"/videos/{video_id}/topics")
        assert list_response.status_code == 200
        assert list_response.json() == []
    finally:
        app.dependency_overrides.clear()
