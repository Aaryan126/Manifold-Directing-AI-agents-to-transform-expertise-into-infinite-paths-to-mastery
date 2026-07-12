import json
from pathlib import Path

import httpx
import pytest

from app.video.base import VideoCapacityError, VideoSource
from app.video.mux_provider import MuxVideoDeliveryProvider


@pytest.mark.anyio
async def test_mux_direct_upload_returns_public_playback_reference(tmp_path: Path) -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/video/v1/assets":
            return httpx.Response(200, json={"data": []})
        if request.url.path == "/video/v1/uploads" and request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "data": {
                        "id": "upload-1",
                        "url": "https://storage.example.test/upload-1",
                    },
                },
            )
        if request.url.host == "storage.example.test":
            assert "authorization" not in request.headers
            assert request.headers["content-length"] == str(len(b"video bytes"))
            return httpx.Response(200)
        if request.url.path == "/video/v1/uploads/upload-1":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "upload-1",
                        "status": "asset_created",
                        "asset_id": "asset-1",
                    },
                },
            )
        if request.url.path == "/video/v1/assets/asset-1":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "asset-1",
                        "status": "ready",
                        "playback_ids": [{"id": "playback-1", "policy": "public"}],
                    },
                },
            )
        return httpx.Response(404, content=json.dumps({"path": request.url.path}))

    media = tmp_path / "lecture.mp4"
    media.write_bytes(b"video bytes")
    provider = MuxVideoDeliveryProvider(
        "token-id",
        "token-secret",
        poll_interval_seconds=0,
        transport=httpx.MockTransport(handler),
    )

    playback = await provider.create_playback_reference(
        VideoSource(local_path=media, content_type="video/mp4"),
    )

    assert playback.provider == "mux"
    assert playback.asset_id == "asset-1"
    assert playback.playback_id == "playback-1"
    assert playback.playback_url == "https://stream.mux.com/playback-1.m3u8"
    assert ("PUT", "/upload-1") in requests


@pytest.mark.anyio
async def test_mux_capacity_blocks_at_free_plan_limit_without_creating_upload() -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        return httpx.Response(
            200,
            json={"data": [{"id": f"asset-{index}"} for index in range(10)]},
        )

    provider = MuxVideoDeliveryProvider(
        "token-id",
        "token-secret",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(VideoCapacityError, match="10-video"):
        await provider.create_playback_reference(
            VideoSource(local_path=Path("unused.mp4"), content_type="video/mp4"),
        )

    assert requests == [("GET", "/video/v1/assets")]
