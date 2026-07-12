from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.ingestion.models import StoredUpload

SUPPORTED_UPLOAD_CONTENT_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "video/mp4",
    "video/quicktime",
    "video/webm",
}


class LocalUploadStorage:
    def __init__(self, root_path: str) -> None:
        self._root_path = Path(root_path)

    async def store(self, upload: UploadFile) -> StoredUpload:
        content_type = upload.content_type or "application/octet-stream"
        if content_type not in SUPPORTED_UPLOAD_CONTENT_TYPES:
            msg = f"Unsupported upload content type: {content_type}"
            raise ValueError(msg)

        suffix = Path(upload.filename or "upload").suffix or _suffix_for_content_type(content_type)
        target_dir = self._root_path / "uploads"
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / f"{uuid4()}{suffix}"

        with target_path.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                output.write(chunk)

        return StoredUpload(
            path=target_path,
            source_uri=str(target_path),
            content_type=content_type,
        )


def _suffix_for_content_type(content_type: str) -> str:
    if content_type == "video/quicktime":
        return ".mov"
    if content_type == "video/webm":
        return ".webm"
    if content_type.startswith("audio/"):
        return ".mp3"
    return ".mp4"
