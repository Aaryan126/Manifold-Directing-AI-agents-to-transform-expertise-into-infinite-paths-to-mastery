from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.clips.models import ClipProposal, ClipType
from app.clips.service import ClipService
from app.dependencies import get_clip_service
from app.main import app
from tests.test_clip_service import (
    MemoryClipMaterializer,
    MemoryClipRepository,
    StaticClipAgent,
    _clip_context,
)


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


def test_materialized_clip_media_and_rebased_captions_are_served(tmp_path: Path) -> None:
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
        materializer=MemoryClipMaterializer(tmp_path),
    )
    app.dependency_overrides[get_clip_service] = lambda: service
    client = TestClient(app)

    try:
        generated = client.post(f"/topics/{topic_id}/clips/generate")
        clip_id = generated.json()[0]["id"]

        media = client.get(f"/clips/{clip_id}/media")
        captions = client.get(f"/clips/{clip_id}/captions.vtt")

        assert media.status_code == 200
        assert media.content == b"independent clip"
        assert captions.status_code == 200
        assert captions.text.startswith("WEBVTT")
        assert "00:00:00.000 -->" in captions.text
        assert "A vector space has vectors." in captions.text
    finally:
        app.dependency_overrides.clear()
