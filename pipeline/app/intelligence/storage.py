import hashlib
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile


@dataclass(frozen=True)
class StoredSource:
    path: Path
    size_bytes: int
    checksum_sha256: str


class SupplementalSourceStorage:
    def __init__(self, root_path: str, max_bytes: int) -> None:
        self._root_path = Path(root_path) / "sources"
        self._max_bytes = max_bytes

    async def store(self, upload: UploadFile) -> StoredSource:
        suffix = Path(upload.filename or "source").suffix.lower()
        if suffix not in {".pdf", ".pptx"}:
            raise ValueError("Only PDF and PowerPoint (.pptx) sources are supported.")
        self._root_path.mkdir(parents=True, exist_ok=True)
        target = self._root_path / f"{uuid4()}{suffix}"
        digest = hashlib.sha256()
        size = 0
        try:
            with target.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > self._max_bytes:
                        raise ValueError(
                            "Supplemental sources may be at most "
                            f"{self._max_bytes // 1_000_000} MB."
                        )
                    digest.update(chunk)
                    output.write(chunk)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        if size == 0:
            target.unlink(missing_ok=True)
            raise ValueError("The uploaded source is empty.")
        return StoredSource(path=target, size_bytes=size, checksum_sha256=digest.hexdigest())
