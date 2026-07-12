from pathlib import Path
from typing import Any, cast
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from yt_dlp import YoutubeDL

from app.ingestion.storage import SUPPORTED_UPLOAD_CONTENT_TYPES


class DirectUrlFetcher:
    def __init__(self, storage_root: str, timeout_seconds: float) -> None:
        self._storage_root = Path(storage_root)
        self._timeout_seconds = timeout_seconds

    async def fetch(self, url: str) -> Path:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            msg = "URL ingest supports only http(s) URLs."
            raise ValueError(msg)

        target_dir = self._storage_root / "url-ingest"
        target_dir.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(
            timeout=self._timeout_seconds,
            follow_redirects=True,
        ) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";")[0].strip()
                if content_type not in SUPPORTED_UPLOAD_CONTENT_TYPES:
                    if _is_youtube_url(url):
                        return await self._fetch_youtube(url, target_dir)
                    msg = "URL did not resolve to a supported direct audio/video file."
                    raise ValueError(msg)

                suffix = _suffix_from_url_or_content_type(parsed.path, content_type)
                target_path = target_dir / f"{uuid4()}{suffix}"
                with target_path.open("wb") as output:
                    async for chunk in response.aiter_bytes():
                        output.write(chunk)
                return target_path

    async def _fetch_youtube(self, url: str, target_dir: Path) -> Path:
        import asyncio

        return await asyncio.to_thread(_download_youtube, url, target_dir)


def _suffix_from_url_or_content_type(path: str, content_type: str) -> str:
    suffix = Path(path).suffix
    if suffix:
        return suffix
    if content_type == "video/webm":
        return ".webm"
    if content_type == "video/quicktime":
        return ".mov"
    if content_type.startswith("audio/"):
        return ".mp3"
    return ".mp4"


def _is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host.endswith("youtube.com") or host.endswith("youtu.be")


def _download_youtube(url: str, target_dir: Path) -> Path:
    output_template = str(target_dir / f"{uuid4()}.%(ext)s")
    options: dict[str, Any] = {
        "format": "best[ext=mp4]/best",
        "outtmpl": output_template,
        "quiet": True,
        "noplaylist": True,
    }
    with YoutubeDL(cast(Any, options)) as ydl:
        info = ydl.extract_info(url, download=True)

    requested_downloads = info.get("requested_downloads") if isinstance(info, dict) else None
    if isinstance(requested_downloads, list) and requested_downloads:
        first_download = requested_downloads[0]
        filepath = first_download.get("filepath") if isinstance(first_download, dict) else None
        if filepath:
            return Path(str(filepath))

    if isinstance(info, dict):
        filepath = info.get("filepath") or info.get("_filename")
        if filepath:
            return Path(str(filepath))

    matches = sorted(target_dir.glob("*"), key=lambda path: path.stat().st_mtime, reverse=True)
    if matches:
        return matches[0]

    msg = "YouTube URL could not be downloaded."
    raise ValueError(msg)
