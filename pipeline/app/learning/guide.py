import json
import re
from typing import Literal, Protocol

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict

LearningGuideIntent = Literal[
    "next",
    "why_next",
    "status",
    "stuck",
    "replay",
    "prerequisite",
    "approved_source",
    "approved_hint",
    "quiz",
    "change_mode",
    "finish_session",
    "platform_transcript",
    "platform_mastery",
    "platform_placement",
    "platform_resources",
    "content_question",
    "capabilities",
]


class LearningGuideInterpreter(Protocol):
    async def classify(
        self,
        question: str,
        available_actions: tuple[str, ...],
    ) -> LearningGuideIntent: ...


class _IntentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: LearningGuideIntent


class OpenAILearningGuideInterpreter:
    """Classify free text without allowing model-authored text to reach a learner."""

    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._fallback = LocalLearningGuideInterpreter()

    async def classify(
        self,
        question: str,
        available_actions: tuple[str, ...],
    ) -> LearningGuideIntent:
        try:
            response = await self._client.responses.parse(
                model=self._model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Classify a learner's request into exactly one allowlisted intent. "
                            "Do not answer the learner and do not create teaching content. Use "
                            "content_question for requests asking what a course concept means or "
                            "for a new explanation. Use capabilities when no intent fits."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "request": question,
                                "available_course_actions": available_actions,
                            }
                        ),
                    },
                ],
                text_format=_IntentOutput,
            )
            if response.output_parsed is not None:
                return response.output_parsed.intent
        except Exception:
            # The Guide remains available when model classification is unavailable.
            pass
        return await self._fallback.classify(question, available_actions)


class LocalLearningGuideInterpreter:
    """Deterministic development/test classifier for the same bounded intents."""

    async def classify(
        self,
        question: str,
        available_actions: tuple[str, ...],
    ) -> LearningGuideIntent:
        del available_actions
        normalized = " ".join(re.findall(r"[a-z0-9']+", question.lower()))
        if _contains(normalized, "stuck", "lost", "confused", "need help", "can't do"):
            return "stuck"
        if _contains(normalized, "what next", "do next", "should i do", "next lesson"):
            return "next"
        if _contains(normalized, "why this", "why next", "why am i", "recommended"):
            return "why_next"
        if _contains(normalized, "my progress", "my status", "how am i doing"):
            return "status"
        if _contains(normalized, "transcript", "captions", "words follow"):
            return "platform_transcript"
        if _contains(normalized, "mastery", "mastered", "blocked", "ready concept"):
            return "platform_mastery"
        if _contains(normalized, "placement", "skip what i know", "diagnostic"):
            return "platform_placement"
        if _contains(normalized, "resource", "source", "reading", "slides", "pdf"):
            return "platform_resources"
        if _contains(normalized, "change mode", "learning mode", "learn mode"):
            return "change_mode"
        if _contains(normalized, "finish session", "end session", "stop session"):
            return "finish_session"
        if _contains(normalized, "prerequisite", "foundation", "before this"):
            return "prerequisite"
        if _contains(normalized, "hint", "clue"):
            return "approved_hint"
        if _contains(normalized, "quiz me", "test me", "question", "practice check"):
            return "quiz"
        if _contains(normalized, "replay", "watch again", "video", "clip"):
            return "replay"
        if _looks_like_content_question(normalized):
            return "content_question"
        return "capabilities"


def _contains(value: str, *phrases: str) -> bool:
    return any(phrase in value for phrase in phrases)


def _looks_like_content_question(value: str) -> bool:
    return value.startswith(
        (
            "what is ",
            "what are ",
            "how does ",
            "how do ",
            "explain ",
            "tell me about ",
            "give me an example",
        )
    )
