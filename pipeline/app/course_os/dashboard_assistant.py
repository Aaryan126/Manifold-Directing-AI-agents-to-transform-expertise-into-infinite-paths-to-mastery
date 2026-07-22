import json
import re
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.course_os.models import (
    CourseRadarItem,
    DashboardEvidenceReference,
    DashboardSnapshot,
)


@dataclass(frozen=True)
class DashboardAssistantAnalysis:
    intent: Literal["question", "change_request"]
    answer: str
    course_id: UUID | None
    course_title: str | None
    action_label: str | None
    evidence: tuple[DashboardEvidenceReference, ...]
    searched_course_count: int


class DashboardAssistant(Protocol):
    async def analyze(
        self,
        question: str,
        snapshot: DashboardSnapshot,
    ) -> DashboardAssistantAnalysis: ...


@dataclass(frozen=True)
class _EvidenceRecord:
    reference: DashboardEvidenceReference
    search_text: str


class _CommandOutput(BaseModel):
    intent: Literal["question", "change_request"]
    answer: str = Field(min_length=1, max_length=360)
    target_course_id: str | None = None
    evidence_ids: list[str] = Field(default_factory=list, max_length=8)
    action_label: str | None = Field(default=None, max_length=60)


class OpenAIDashboardAssistant:
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def analyze(
        self,
        question: str,
        snapshot: DashboardSnapshot,
    ) -> DashboardAssistantAnalysis:
        records = search_dashboard_evidence(question, snapshot)
        response = await self._client.responses.parse(
            model=self._model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You are Manifold, an evidence analyst for an instructor. Answer only "
                        "from the supplied saved evidence. Never invent learners, causes, trends, "
                        "or measurements. If evidence is missing, say so plainly. Classify "
                        "requests "
                        "to alter course content as change_request; everything else is question. "
                        "A change request is only a private proposal and must not imply that a "
                        "live "
                        "course changed. Cite the evidence IDs that directly support the answer. "
                        "Write at most two short sentences and 45 words. Lead with the practical "
                        "conclusion, then the most important supporting fact. Never mention "
                        "database IDs, raw record IDs, unchanged zero-value details, or enumerate "
                        "every course when a portfolio-level comparison is enough. The interface "
                        "shows the cited evidence separately."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "request": question,
                            "published_course_count": len(snapshot.course_radar),
                            "retrieved_evidence": [
                                {
                                    "id": item.reference.id,
                                    "course_id": (
                                        str(item.reference.course_id)
                                        if item.reference.course_id
                                        else None
                                    ),
                                    "course": item.reference.course_title,
                                    "metric": item.reference.metric,
                                    "label": item.reference.label,
                                    "value": item.reference.value,
                                }
                                for item in records
                            ],
                        }
                    ),
                },
            ],
            text_format=_CommandOutput,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("Dashboard analysis did not match the expected schema.")
        return _analysis_from_output(parsed, records, snapshot)


class LocalDashboardAssistant:
    """Grounded fallback for development without an API key."""

    async def analyze(
        self,
        question: str,
        snapshot: DashboardSnapshot,
    ) -> DashboardAssistantAnalysis:
        records = search_dashboard_evidence(question, snapshot)
        normalized = question.lower()
        target = _select_course(snapshot.course_radar, question)
        intent: Literal["question", "change_request"] = (
            "change_request" if _looks_like_change(question) else "question"
        )
        if intent == "change_request":
            message = (
                f"I found {target.title} as the strongest evidence-backed target and can prepare "
                "your request as a private proposal."
                if target
                else "There is not enough published-course evidence to choose a safe target."
            )
        elif "confident" in normalized and "incorrect" in normalized:
            target = max(
                snapshot.course_radar,
                key=lambda item: item.confident_incorrect_attempts,
                default=None,
            )
            message = (
                f"{target.title} has {target.confident_incorrect_attempts} "
                "confident-but-incorrect attempts."
                if target and target.confident_incorrect_attempts
                else "No confident-but-incorrect attempts are recorded across published courses."
            )
        elif "clip" in normalized or "drop-off" in normalized:
            measured = [
                item for item in snapshot.course_radar if item.clip_completion_percent is not None
            ]
            target = min(measured, key=lambda item: item.clip_completion_percent or 0, default=None)
            message = (
                f"{target.title} has the lowest measured clip completion at "
                f"{target.clip_completion_percent:.0f}%."
                if target
                else "No clip watch evidence has been recorded yet."
            )
        elif "confidence" in normalized and "compare" in normalized:
            measured = sorted(
                (item for item in snapshot.course_radar if item.confidence_percent is not None),
                key=lambda item: item.confidence_percent or 0,
            )
            target = measured[0] if measured else None
            message = (
                "Confidence across published courses: "
                + "; ".join(f"{item.title} {item.confidence_percent:.0f}%" for item in measured)
                + "."
                if measured
                else "No assessment confidence evidence has been recorded yet."
            )
        elif "changed" in normalized or "yesterday" in normalized:
            today = (
                snapshot.activity_history[-1].active_learners if snapshot.activity_history else 0
            )
            yesterday = (
                snapshot.activity_history[-2].active_learners
                if len(snapshot.activity_history) > 1
                else 0
            )
            message = (
                f"Daily active learners changed from {yesterday} to {today}. "
                f"There are {sum(item.open_issues for item in snapshot.course_radar)} open issues "
                "across published courses."
            )
        elif target:
            message = (
                f"{target.title} is the current focus with {target.open_issues} open issues, "
                f"{_percent(target.accuracy_percent)} accuracy, and "
                f"{_percent(target.mastery_percent)} mastery."
            )
        else:
            message = "No grounded published-course evidence is available yet."
        evidence = tuple(record.reference for record in records[:4])
        return DashboardAssistantAnalysis(
            intent=intent,
            answer=message,
            course_id=target.course_id if target else None,
            course_title=target.title if target else None,
            action_label="Inspect evidence" if target else None,
            evidence=evidence,
            searched_course_count=len(snapshot.course_radar),
        )


def search_dashboard_evidence(
    question: str,
    snapshot: DashboardSnapshot,
    limit: int = 14,
) -> tuple[_EvidenceRecord, ...]:
    records = _evidence_records(snapshot)
    terms = set(re.findall(r"[a-z0-9]+", question.lower()))
    intent_terms = _expanded_terms(terms)

    def score(record: _EvidenceRecord) -> tuple[int, int]:
        haystack = set(re.findall(r"[a-z0-9]+", record.search_text.lower()))
        overlap = len(intent_terms & haystack)
        course_match = sum(
            1
            for term in terms
            if record.reference.course_title and term in record.reference.course_title.lower()
        )
        return overlap + (course_match * 3), int(record.reference.course_id is not None)

    ranked = sorted(records, key=score, reverse=True)
    relevant = [record for record in ranked if score(record)[0] > 0]
    if len(relevant) < min(5, len(records)):
        relevant.extend(record for record in ranked if record not in relevant)
    return tuple(relevant[:limit])


def _evidence_records(snapshot: DashboardSnapshot) -> list[_EvidenceRecord]:
    history = snapshot.activity_history
    today = history[-1].active_learners if history else 0
    yesterday = history[-2].active_learners if len(history) > 1 else 0
    records = [
        _record(
            "portfolio:activity",
            "Portfolio activity",
            f"{yesterday} → {today} daily active learners",
            "activity",
        ),
        _record("portfolio:new-learners", "New learners", str(snapshot.new_learners), "learners"),
        _record(
            "portfolio:open-issues",
            "Open issues",
            str(sum(item.open_issues for item in snapshot.course_radar)),
            "issues",
        ),
    ]
    for course in snapshot.course_radar:
        prefix = f"course:{course.course_id}"
        values = (
            ("activity", "Seven-day activity", ", ".join(map(str, course.activity_trend))),
            ("accuracy", "Accuracy", _percent(course.accuracy_percent)),
            ("confidence", "Confidence", _percent(course.confidence_percent)),
            (
                "confident-incorrect",
                "Confident but incorrect",
                str(course.confident_incorrect_attempts),
            ),
            ("clip-completion", "Clip completion", _percent(course.clip_completion_percent)),
            ("mastery", "Mastery", _percent(course.mastery_percent)),
            ("mastery-movement", "Mastery movement", f"{course.mastery_movement:+d} this week"),
            ("open-issues", "Open issues", str(course.open_issues)),
            (
                "agent",
                "Agent status",
                f"{course.agent_status}: {course.agent_role or 'course team'}",
            ),
        )
        records.extend(
            _record(f"{prefix}:{metric}", label, value, metric, course)
            for metric, label, value in values
        )
    return records


def _record(
    record_id: str,
    label: str,
    value: str,
    metric: str,
    course: CourseRadarItem | None = None,
) -> _EvidenceRecord:
    reference = DashboardEvidenceReference(
        id=record_id,
        label=label,
        value=value,
        metric=metric,
        course_id=course.course_id if course else None,
        course_title=course.title if course else None,
    )
    return _EvidenceRecord(
        reference=reference,
        search_text=" ".join(
            filter(None, (label, value, metric, course.title if course else None))
        ),
    )


def _analysis_from_output(
    output: _CommandOutput,
    records: tuple[_EvidenceRecord, ...],
    snapshot: DashboardSnapshot,
) -> DashboardAssistantAnalysis:
    references = {item.reference.id: item.reference for item in records}
    evidence = tuple(references[item] for item in output.evidence_ids if item in references)
    if not evidence:
        evidence = tuple(item.reference for item in records[:3])
    target = next(
        (
            item
            for item in snapshot.course_radar
            if output.target_course_id and str(item.course_id) == output.target_course_id
        ),
        None,
    )
    if target is None:
        target = _select_course(snapshot.course_radar, output.answer)
    return DashboardAssistantAnalysis(
        intent=output.intent,
        answer=output.answer,
        course_id=target.course_id if target else None,
        course_title=target.title if target else None,
        action_label=output.action_label or ("Inspect evidence" if target else None),
        evidence=evidence,
        searched_course_count=len(snapshot.course_radar),
    )


def _expanded_terms(terms: set[str]) -> set[str]:
    expanded = set(terms)
    groups = (
        ({"changed", "yesterday", "trend"}, {"activity", "learners", "movement"}),
        (
            {"confident", "confidence", "incorrect"},
            {"confidence", "confident", "incorrect", "accuracy"},
        ),
        ({"clip", "clips", "drop", "off"}, {"clip", "completion", "watch"}),
        (
            {"weak", "weakest", "improvement", "improvements"},
            {"accuracy", "mastery", "issues", "confidence"},
        ),
    )
    for triggers, additions in groups:
        if terms & triggers:
            expanded.update(additions)
    return expanded


def _select_course(
    courses: tuple[CourseRadarItem, ...],
    text: str,
) -> CourseRadarItem | None:
    if not courses:
        return None
    normalized = text.lower()
    named = next((item for item in courses if item.title.lower() in normalized), None)
    return named or max(
        courses,
        key=lambda item: (
            item.open_issues,
            100 - (item.accuracy_percent if item.accuracy_percent is not None else 100),
        ),
    )


def _looks_like_change(text: str) -> bool:
    normalized = text.lower()
    return any(
        term in normalized
        for term in (
            "prepare improvement",
            "change ",
            "modify ",
            "update ",
            "shorten ",
            "replace ",
            "add ",
            "remove ",
            "revise ",
            "rewrite ",
            "cut down",
        )
    )


def _percent(value: float | None) -> str:
    return "unmeasured" if value is None else f"{value:.0f}%"
