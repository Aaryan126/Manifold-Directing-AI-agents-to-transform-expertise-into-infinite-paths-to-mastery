import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest

from app.clips.materializer import LocalFfmpegClipMaterializer
from app.clips.models import ClipProposal, ClipType
from tests.test_clip_service import _clip_context, _clip_from_proposal


def _ffmpeg_tools_work() -> bool:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        return False
    for command in ("ffmpeg", "ffprobe"):
        result = subprocess.run(
            [command, "-version"],
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            return False
    return True


@pytest.mark.anyio
@pytest.mark.skipif(
    not _ffmpeg_tools_work(),
    reason="FFmpeg integration tools are unavailable.",
)
async def test_ffmpeg_materializer_creates_zero_based_independent_mp4(tmp_path: Path) -> None:
    source_path = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x180:r=24:d=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source_path),
        ],
        check=True,
    )
    topic_id = uuid4()
    concept_id = uuid4()
    base_context = _clip_context(topic_id, concept_id)
    context = replace(
        base_context,
        topic=replace(base_context.topic, source_path=source_path),
    )
    clip = _clip_from_proposal(
        topic_id,
        ClipProposal(
            title="Independent excerpt",
            start_seconds=1,
            end_seconds=3,
            type=ClipType.EXPLANATION,
            difficulty="introductory",
            concept_ids=(concept_id,),
            rationale="Test excerpt.",
            confidence=1,
        ),
    )
    materializer = LocalFfmpegClipMaterializer(str(tmp_path / "storage"), 30)

    playback_id = await materializer.materialize(clip, context)
    output_path = materializer.resolve(playback_id)

    assert output_path is not None
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=start_time,duration",
            "-of",
            "json",
            str(output_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    metadata = json.loads(probe.stdout)["format"]
    assert float(metadata["start_time"]) == 0
    assert float(metadata["duration"]) == pytest.approx(2, abs=0.1)
    assert materializer.resolve("../source.mp4") is None
