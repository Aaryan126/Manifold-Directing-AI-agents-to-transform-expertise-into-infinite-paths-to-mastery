from uuid import uuid4

from fastapi.testclient import TestClient

from app.clips.models import ClipProposal, ClipType
from app.clips.service import ClipService
from app.dependencies import get_clip_service
from app.main import app
from tests.test_clip_service import MemoryClipRepository, StaticClipAgent, _clip_context


def test_clip_api_generates_flags_and_recuts_clips() -> None:
    topic_id = uuid4()
    concept_id = uuid4()
    service = ClipService(
        repository=MemoryClipRepository(_clip_context(topic_id, concept_id)),
        agent=StaticClipAgent(
            (
                ClipProposal(
                    title="Definition",
                    start_seconds=0,
                    end_seconds=20,
                    type=ClipType.DEFINITION,
                    difficulty="introductory",
                    concept_ids=(concept_id,),
                    rationale="Reusable definition.",
                    confidence=0.9,
                ),
            )
        ),
    )
    app.dependency_overrides[get_clip_service] = lambda: service
    client = TestClient(app)

    try:
        generated = client.post(f"/topics/{topic_id}/clips/generate")
        assert generated.status_code == 200
        clip_id = generated.json()[0]["id"]

        flagged = client.post(f"/clips/{clip_id}/flag", json={"note": "Awkward opening."})
        assert flagged.status_code == 200
        assert flagged.json()["status"] == "flagged"
        assert flagged.json()["flag_note"] == "Awkward opening."

        recut = client.post(
            f"/clips/{clip_id}/recut",
            json={"note": "Include the setup sentence."},
        )
        assert recut.status_code == 200
        assert recut.json()["source_clip_id"] == clip_id
    finally:
        app.dependency_overrides.clear()
