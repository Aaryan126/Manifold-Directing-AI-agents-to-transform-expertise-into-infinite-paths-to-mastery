import asyncio
from time import monotonic
from typing import Any

import httpx

from app.video.base import (
    DeliveryCapacity,
    PlaybackReference,
    VideoCapacityError,
    VideoDeliveryError,
    VideoDeliveryProvider,
    VideoSource,
)


class MuxVideoDeliveryProvider(VideoDeliveryProvider):
    """Mux on-demand delivery through Direct Uploads and public playback IDs."""

    _api_base_url = "https://api.mux.com/video/v1"

    def __init__(
        self,
        token_id: str | None,
        token_secret: str | None,
        *,
        max_stored_videos: int = 10,
        poll_interval_seconds: float = 2.0,
        poll_timeout_seconds: float = 600.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token_id = token_id
        self._token_secret = token_secret
        self._max_stored_videos = max_stored_videos
        self._poll_interval_seconds = poll_interval_seconds
        self._poll_timeout_seconds = poll_timeout_seconds
        self._transport = transport

    async def capacity(self) -> DeliveryCapacity:
        async with self._client() as client:
            response = await client.get("/assets", params={"limit": 100, "page": 1})
            data = self._response_data(response)
        assets = data if isinstance(data, list) else []
        return DeliveryCapacity(
            provider="mux",
            stored_count=len(assets),
            max_stored=self._max_stored_videos,
        )

    async def create_playback_reference(self, source: VideoSource) -> PlaybackReference:
        capacity = await self.capacity()
        if not capacity.can_upload:
            raise VideoCapacityError(
                "Mux storage is at the configured 10-video Free Plan limit. "
                "Delete an unneeded asset in Mux or switch VIDEO_PROVIDER=local; "
                "CourseFoundry will not overwrite an existing video.",
            )

        async with self._client() as client:
            upload_response = await client.post(
                "/uploads",
                json={
                    "cors_origin": "*",
                    "new_asset_settings": {
                        "playback_policies": ["public"],
                        "video_quality": "basic",
                        "meta": {"title": source.local_path.name},
                    },
                },
            )
            upload = self._response_data(upload_response)
            if not isinstance(upload, dict) or not upload.get("id") or not upload.get("url"):
                raise VideoDeliveryError("Mux did not return a valid Direct Upload.")

            await self._upload_file(str(upload["url"]), source)
            asset_id = await self._wait_for_asset(client, str(upload["id"]))
            asset_response = await client.get(f"/assets/{asset_id}")
            asset = self._response_data(asset_response)

        if not isinstance(asset, dict):
            raise VideoDeliveryError("Mux returned an invalid asset response.")
        playback_ids = asset.get("playback_ids")
        if not isinstance(playback_ids, list):
            raise VideoDeliveryError("Mux asset has no public playback ID.")
        playback_id = next(
            (
                str(item["id"])
                for item in playback_ids
                if isinstance(item, dict) and item.get("policy") == "public" and item.get("id")
            ),
            None,
        )
        if playback_id is None:
            raise VideoDeliveryError("Mux asset has no public playback ID.")
        return PlaybackReference(
            provider="mux",
            asset_id=asset_id,
            playback_id=playback_id,
            playback_url=f"https://stream.mux.com/{playback_id}.m3u8",
        )

    def _client(self) -> httpx.AsyncClient:
        if not self._token_id or not self._token_secret:
            raise VideoDeliveryError(
                "Mux delivery requires both MUX_TOKEN_ID and MUX_TOKEN_SECRET.",
            )
        return httpx.AsyncClient(
            base_url=self._api_base_url,
            auth=httpx.BasicAuth(self._token_id, self._token_secret),
            timeout=httpx.Timeout(60.0, write=None),
            transport=self._transport,
        )

    async def _upload_file(
        self,
        upload_url: str,
        source: VideoSource,
    ) -> None:
        async def chunks() -> Any:
            with source.local_path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    yield chunk

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, write=None),
            transport=self._transport,
        ) as upload_client:
            response = await upload_client.put(
                upload_url,
                content=chunks(),
                headers={
                    "Content-Length": str(source.local_path.stat().st_size),
                    "Content-Type": source.content_type,
                },
            )
        if response.status_code not in {200, 201}:
            raise VideoDeliveryError(
                f"Mux file upload failed with status {response.status_code}.",
            )

    async def _wait_for_asset(self, client: httpx.AsyncClient, upload_id: str) -> str:
        deadline = monotonic() + self._poll_timeout_seconds
        while monotonic() < deadline:
            response = await client.get(f"/uploads/{upload_id}")
            upload = self._response_data(response)
            if not isinstance(upload, dict):
                raise VideoDeliveryError("Mux returned an invalid upload status.")
            status = str(upload.get("status", ""))
            if status == "asset_created" and upload.get("asset_id"):
                return str(upload["asset_id"])
            if status in {"cancelled", "errored", "timed_out"}:
                raise VideoDeliveryError(f"Mux upload ended with status '{status}'.")
            await asyncio.sleep(self._poll_interval_seconds)
        raise VideoDeliveryError("Timed out waiting for Mux to create the video asset.")

    @staticmethod
    def _response_data(response: httpx.Response) -> object:
        if response.is_error:
            detail = ""
            try:
                body = response.json()
                if isinstance(body, dict):
                    error = body.get("error")
                    if isinstance(error, dict) and error.get("message"):
                        detail = f": {error['message']}"
            except ValueError:
                pass
            raise VideoDeliveryError(f"Mux API request failed ({response.status_code}){detail}.")
        body = response.json()
        if not isinstance(body, dict) or "data" not in body:
            raise VideoDeliveryError("Mux API response did not include data.")
        return body["data"]
