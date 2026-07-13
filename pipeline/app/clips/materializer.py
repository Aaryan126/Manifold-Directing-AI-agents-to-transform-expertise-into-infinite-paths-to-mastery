import asyncio
from abc import ABC, abstractmethod
from pathlib import Path

from app.clips.models import Clip, ClipContext


class ClipMaterializationError(RuntimeError):
    pass


class ClipMaterializer(ABC):
    @abstractmethod
    async def materialize(self, clip: Clip, context: ClipContext) -> str:
        """Create an independently playable clip and return its storage identifier."""

    @abstractmethod
    def resolve(self, playback_id: str) -> Path | None:
        """Resolve a trusted storage identifier to a readable local file."""

    @abstractmethod
    def remove(self, playback_id: str) -> None:
        """Remove a no-longer-referenced local clip if it exists."""


class LocalFfmpegClipMaterializer(ClipMaterializer):
    def __init__(self, storage_root: str, timeout_seconds: float = 1800.0) -> None:
        self._clip_root = Path(storage_root) / "clips"
        self._timeout_seconds = timeout_seconds

    async def materialize(self, clip: Clip, context: ClipContext) -> str:
        source_path = context.topic.source_path
        if source_path is None or not source_path.is_file():
            raise ClipMaterializationError("The local source video is unavailable for clipping.")

        self._clip_root.mkdir(parents=True, exist_ok=True)
        playback_id = f"{clip.id}.mp4"
        output_path = self._clip_root / playback_id
        temporary_path = self._clip_root / f".{clip.id}.processing.mp4"
        temporary_path.unlink(missing_ok=True)

        duration = clip.end_seconds - clip.start_seconds
        try:
            process = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{clip.start_seconds:.3f}",
                "-i",
                str(source_path),
                "-t",
                f"{duration:.3f}",
                "-map",
                "0:v:0?",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                str(temporary_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            raise ClipMaterializationError("FFmpeg is unavailable for local clipping.") from exc
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self._timeout_seconds,
            )
        except TimeoutError as exc:
            process.kill()
            await process.communicate()
            temporary_path.unlink(missing_ok=True)
            raise ClipMaterializationError("Local clip rendering timed out.") from exc

        if process.returncode != 0 or not temporary_path.is_file():
            temporary_path.unlink(missing_ok=True)
            detail = stderr.decode("utf-8", errors="replace").strip()
            if len(detail) > 500:
                detail = detail[-500:]
            message = "FFmpeg could not render the local clip."
            if detail:
                message = f"{message} {detail}"
            raise ClipMaterializationError(message)

        temporary_path.replace(output_path)
        return playback_id

    def resolve(self, playback_id: str) -> Path | None:
        if Path(playback_id).name != playback_id or not playback_id.endswith(".mp4"):
            return None
        path = self._clip_root / playback_id
        return path if path.is_file() else None

    def remove(self, playback_id: str) -> None:
        path = self.resolve(playback_id)
        if path is not None:
            path.unlink(missing_ok=True)
