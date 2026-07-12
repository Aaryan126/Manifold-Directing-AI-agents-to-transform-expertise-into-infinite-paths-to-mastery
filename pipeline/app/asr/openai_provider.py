import subprocess
import tempfile
from pathlib import Path

from openai import AsyncOpenAI

from app.asr.base import ASRProvider, Transcript, TranscriptWord

MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024
AUDIO_BITRATE = "32k"


class OpenAIASRProvider(ASRProvider):
    """OpenAI-backed ASR adapter that returns only internal transcript models."""

    def __init__(self, api_key: str | None, model: str = "whisper-1") -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def transcribe(self, media_path: Path) -> Transcript:
        with tempfile.TemporaryDirectory(prefix="coursefoundry-asr-") as temp_dir:
            audio_path = Path(temp_dir) / "audio.mp3"
            _extract_speech_audio(media_path, audio_path)
            chunks = _chunk_audio(audio_path, Path(temp_dir))

            transcripts: list[Transcript] = []
            offset_seconds = 0.0
            for chunk in chunks:
                chunk_transcript = await self._transcribe_single_file(chunk.path)
                transcripts.append(_offset_transcript(chunk_transcript, offset_seconds))
                offset_seconds += chunk.duration_seconds

            return _merge_transcripts(transcripts)

    async def _transcribe_single_file(self, media_path: Path) -> Transcript:
        with media_path.open("rb") as audio_file:
            response = await self._client.audio.transcriptions.create(
                file=audio_file,
                model=self._model,
                response_format="verbose_json",
                timestamp_granularities=["word"],
            )

        raw_words = response.words or []
        words = tuple(
            TranscriptWord(
                text=str(word.word),
                start_seconds=float(word.start),
                end_seconds=float(word.end),
            )
            for word in raw_words
        )
        return Transcript(text=str(response.text), words=words)


class _AudioChunk:
    def __init__(self, path: Path, duration_seconds: float) -> None:
        self.path = path
        self.duration_seconds = duration_seconds


def _extract_speech_audio(input_path: Path, output_path: Path) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        AUDIO_BITRATE,
        str(output_path),
    ]
    _run_ffmpeg(command)


def _chunk_audio(audio_path: Path, temp_dir: Path) -> list[_AudioChunk]:
    if audio_path.stat().st_size <= MAX_TRANSCRIPTION_BYTES:
        return [_AudioChunk(audio_path, _probe_duration(audio_path))]

    duration_seconds = _probe_duration(audio_path)
    bytes_per_second = audio_path.stat().st_size / duration_seconds
    target_seconds = max(60, int(MAX_TRANSCRIPTION_BYTES / bytes_per_second * 0.9))
    chunk_pattern = temp_dir / "chunk-%03d.mp3"
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(audio_path),
        "-f",
        "segment",
        "-segment_time",
        str(target_seconds),
        "-c",
        "copy",
        str(chunk_pattern),
    ]
    _run_ffmpeg(command)

    chunks = sorted(temp_dir.glob("chunk-*.mp3"))
    if not chunks:
        msg = "Failed to split audio for transcription."
        raise RuntimeError(msg)
    oversized = [chunk for chunk in chunks if chunk.stat().st_size > MAX_TRANSCRIPTION_BYTES]
    if oversized:
        msg = "Audio chunk still exceeds transcription size limit after preprocessing."
        raise RuntimeError(msg)
    return [_AudioChunk(chunk, _probe_duration(chunk)) for chunk in chunks]


def _probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def _run_ffmpeg(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        msg = result.stderr.strip() or "ffmpeg failed to process media."
        raise RuntimeError(msg)


def _offset_transcript(transcript: Transcript, offset_seconds: float) -> Transcript:
    return Transcript(
        text=transcript.text,
        words=tuple(
            TranscriptWord(
                text=word.text,
                start_seconds=word.start_seconds + offset_seconds,
                end_seconds=word.end_seconds + offset_seconds,
            )
            for word in transcript.words
        ),
    )


def _merge_transcripts(transcripts: list[Transcript]) -> Transcript:
    return Transcript(
        text=" ".join(
            transcript.text.strip()
            for transcript in transcripts
            if transcript.text.strip()
        ),
        words=tuple(word for transcript in transcripts for word in transcript.words),
    )
