from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.segmentation.agent import SegmentationAgent
from app.segmentation.models import TopicProposal, VideoTranscript


class _TopicOutput(BaseModel):
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    start_seconds: float
    end_seconds: float
    evidence: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class _SegmentationOutput(BaseModel):
    topics: list[_TopicOutput]


class OpenAISegmentationAgent(SegmentationAgent):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def propose_topics(self, transcript: VideoTranscript) -> tuple[TopicProposal, ...]:
        transcript_payload = _compact_transcript(transcript)
        response = await self._client.responses.parse(
            model=self._model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You segment lecture transcripts for an instructor review workflow. "
                        "Return semantic topic shifts, not fixed time windows. Target 10-20 "
                        "minute topics unless the lecture structure strongly warrants otherwise. "
                        "Ignore obvious ASR intro/noise artifacts such as repeated venue names, "
                        "audio bed labels, or repeated uppercase phrases unless they are central "
                        "to the pedagogy. Each topic must include a concise title, one-paragraph "
                        "summary, time range, confidence, and a transcript excerpt explaining "
                        "why the boundary was chosen."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Segment this timestamped transcript into instructor-reviewable topics:\n"
                        f"{transcript_payload}"
                    ),
                },
            ],
            text_format=_SegmentationOutput,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI segmentation response did not match the expected schema.")
        return tuple(
            TopicProposal(
                title=topic.title,
                summary=topic.summary,
                start_seconds=topic.start_seconds,
                end_seconds=topic.end_seconds,
                evidence=topic.evidence,
                confidence=topic.confidence,
            )
            for topic in parsed.topics
        )


def _compact_transcript(transcript: VideoTranscript) -> list[dict[str, Any]]:
    words = transcript.words
    if not words:
        return [{"start_seconds": 0, "end_seconds": 0, "text": transcript.text}]

    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    start = words[0].start_seconds
    end = words[0].end_seconds
    for word in words:
        if word.start_seconds - start >= 60 and current:
            chunks.append(
                {
                    "start_seconds": round(start, 3),
                    "end_seconds": round(end, 3),
                    "text": " ".join(current),
                }
            )
            current = []
            start = word.start_seconds
        current.append(word.text)
        end = word.end_seconds
    if current:
        chunks.append(
            {
                "start_seconds": round(start, 3),
                "end_seconds": round(end, 3),
                "text": " ".join(current),
            }
        )
    return chunks
