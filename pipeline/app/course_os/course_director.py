import json
import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from app.course_os.models import CourseBlueprint

DirectorOperation = Literal[
    "update_artifact",
    "remove_artifact",
    "create_topic",
    "create_concept",
    "create_question",
    "create_relationship",
    "reconnect_relationship",
    "remove_relationship",
]
DirectorRelationship = Literal[
    "contains",
    "requires",
    "teaches",
    "assesses",
    "remediates_to",
    "cites",
]


@dataclass(frozen=True)
class CourseDirectorAction:
    operation: DirectorOperation
    summary: str
    rationale: str
    artifact_kind: str | None = None
    logical_artifact_id: UUID | None = None
    relationship_type: DirectorRelationship | None = None
    source_logical_id: UUID | None = None
    target_logical_id: UUID | None = None
    previous_relationship_type: DirectorRelationship | None = None
    previous_source_logical_id: UUID | None = None
    previous_target_logical_id: UUID | None = None
    proposed_state: dict[str, Any] | None = None


@dataclass(frozen=True)
class CourseDirectorPlan:
    summary: str
    actions: tuple[CourseDirectorAction, ...]
    clarification: str | None = None


class CourseDirector(Protocol):
    async def plan(self, instruction: str, blueprint: CourseBlueprint) -> CourseDirectorPlan: ...


class _DirectorCorrectAnswerOutput(BaseModel):
    """Closed model-facing answer shape required by OpenAI strict structured output."""

    model_config = ConfigDict(extra="forbid")

    answer: str | None = None
    choices: list[str] | None = None


class _DirectorProposedStateOutput(BaseModel):
    """Every state field Course Director may place in a reviewed typed proposal."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    summary: str | None = None
    name: str | None = None
    description: str | None = None
    type: str | None = None
    difficulty: str | None = None
    body: str | None = None
    correct_answer: _DirectorCorrectAnswerOutput | None = None
    confidence_prompt: str | None = None
    start_seconds: float | None = None
    end_seconds: float | None = None
    topic_logical_ids: list[str] | None = None
    sequence_after_id: str | None = None
    topic_logical_id: str | None = None
    primary_concept_logical_id: str | None = None

    def as_proposal_state(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class _DirectorActionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: DirectorOperation
    summary: str = Field(min_length=1, max_length=120)
    rationale: str = Field(min_length=1, max_length=240)
    artifact_kind: Literal["topic", "concept", "clip", "question", "source"] | None = None
    logical_artifact_id: str | None = None
    relationship_type: DirectorRelationship | None = None
    source_logical_id: str | None = None
    target_logical_id: str | None = None
    previous_relationship_type: DirectorRelationship | None = None
    previous_source_logical_id: str | None = None
    previous_target_logical_id: str | None = None
    proposed_state: _DirectorProposedStateOutput = Field(
        default_factory=_DirectorProposedStateOutput
    )


class _DirectorPlanOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=300)
    clarification: str | None = Field(default=None, max_length=240)
    actions: list[_DirectorActionOutput] = Field(default_factory=list, max_length=8)


class OpenAICourseDirector:
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def plan(self, instruction: str, blueprint: CourseBlueprint) -> CourseDirectorPlan:
        response = await self._client.responses.parse(
            model=self._model,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You are Course Director, planning bounded edits to a private course "
                        "revision. Return only concrete actions grounded in the supplied "
                        "Blueprint. "
                        "Never imply learner-facing changes are already made: every action becomes "
                        "an independent Accept/Edit/Dismiss proposal. Use exact logical IDs. "
                        "Supported updates: topic title/summary/start_seconds/end_seconds; concept "
                        "name/description; clip type/difficulty/start_seconds/end_seconds; "
                        "question body/type/correct_answer/confidence_prompt. Supported "
                        "relationship "
                        "semantics are contains(topic→concept), requires(concept→concept), "
                        "teaches(concept→clip), assesses(concept→question), "
                        "remediates_to(question→concept|clip), and cites(artifact→source). "
                        "For reconnect_relationship, identify the exact existing relationship "
                        "in the previous_* fields and the replacement in the normal relationship "
                        "fields so it remains one atomic review decision. "
                        "For create_topic provide title, summary, start_seconds, end_seconds. "
                        "For create_concept provide name, description, topic_logical_ids, and "
                        "sequence_after_id. For create_question provide topic_logical_id, "
                        "primary_concept_logical_id, body, type, correct_answer, and "
                        "confidence_prompt. Ground the question in that concept; for MCQ include "
                        "plausible choices in correct_answer. If the request is ambiguous, unsafe, "
                        "or cannot be expressed with these operations, return no actions and one "
                        "clarification. "
                        "Prefer the smallest coherent plan and explain each action plainly."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "instruction": instruction,
                            "revision_id": str(blueprint.revision_id),
                            "nodes": [
                                {
                                    "logical_id": str(node.logical_id),
                                    "kind": node.kind,
                                    "title": node.title,
                                    "status": node.status,
                                    "metadata": node.metadata,
                                }
                                for node in blueprint.nodes
                            ],
                            "relationships": [
                                {
                                    "kind": edge.kind,
                                    "source_logical_id": str(
                                        next(
                                            node.logical_id
                                            for node in blueprint.nodes
                                            if node.id == edge.source_id
                                        )
                                    ),
                                    "target_logical_id": str(
                                        next(
                                            node.logical_id
                                            for node in blueprint.nodes
                                            if node.id == edge.target_id
                                        )
                                    ),
                                    "status": edge.status,
                                }
                                for edge in blueprint.edges
                                if edge.kind != "next"
                            ],
                        }
                    ),
                },
            ],
            text_format=_DirectorPlanOutput,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("Course Director did not return a valid edit plan.")
        return _validated_plan(parsed, blueprint)


class LocalCourseDirector:
    """Deterministic development fallback with a small, explicit command grammar."""

    async def plan(self, instruction: str, blueprint: CourseBlueprint) -> CourseDirectorPlan:
        normalized = instruction.strip()
        lowered = normalized.lower()
        matches = sorted(
            (node for node in blueprint.nodes if node.title.lower() in lowered),
            key=lambda node: len(node.title),
            reverse=True,
        )
        if ("remove" in lowered or "delete" in lowered) and matches:
            node = matches[0]
            return CourseDirectorPlan(
                summary=f"Prepare removal of {node.title}.",
                actions=(
                    CourseDirectorAction(
                        operation="remove_artifact",
                        artifact_kind=node.kind,
                        logical_artifact_id=node.logical_id,
                        summary=f"Remove {node.title}",
                        rationale="The instructor explicitly requested this private removal.",
                    ),
                ),
            )
        if ("add" in lowered or "create" in lowered) and (
            "question" in lowered or "assessment" in lowered
        ) and matches and matches[0].kind == "concept":
            concept = matches[0]
            topic_edge = next(
                (
                    edge
                    for edge in blueprint.edges
                    if edge.kind == "contains" and edge.target_id == concept.id
                ),
                None,
            )
            topic = next(
                (
                    node
                    for node in blueprint.nodes
                    if topic_edge is not None and node.id == topic_edge.source_id
                ),
                None,
            )
            if topic is not None:
                description = str(concept.metadata.get("description", "")).strip()
                expected = description or concept.title
                return CourseDirectorPlan(
                    summary=f"Prepare another assessment for {concept.title}.",
                    actions=(
                        CourseDirectorAction(
                            operation="create_question",
                            artifact_kind="question",
                            proposed_state={
                                "topic_logical_id": str(topic.logical_id),
                                "primary_concept_logical_id": str(concept.logical_id),
                                "body": (
                                    f"How would you explain {concept.title} in your own words?"
                                ),
                                "type": "short_answer",
                                "correct_answer": {"answer": expected},
                                "confidence_prompt": (
                                    "How confident are you in your explanation?"
                                ),
                            },
                            summary=f"Add a question for {concept.title}",
                            rationale=(
                                "The instructor explicitly requested another reviewed "
                                "assessment for this concept."
                            ),
                        ),
                    ),
                )
        rename = re.search(r"rename\s+(.+?)\s+to\s+[“\"']?(.+?)[”\"']?$", normalized, re.I)
        if rename and matches:
            node = matches[0]
            next_title = rename.group(2).strip()
            field = "name" if node.kind == "concept" else "title"
            return CourseDirectorPlan(
                summary=f"Prepare a rename for {node.title}.",
                actions=(
                    CourseDirectorAction(
                        operation="update_artifact",
                        artifact_kind=node.kind,
                        logical_artifact_id=node.logical_id,
                        proposed_state={field: next_title},
                        summary=f"Rename {node.title} to {next_title}",
                        rationale="The instructor requested this exact title change.",
                    ),
                ),
            )
        return CourseDirectorPlan(
            summary="I need one more detail before preparing a safe course change.",
            actions=(),
            clarification=(
                "Name the exact topic, concept, clip, question, or connection to change. "
                "For example: “Rename Motivation for rapid skill acquisition to Learning faster.”"
            ),
        )


def _validated_plan(output: _DirectorPlanOutput, blueprint: CourseBlueprint) -> CourseDirectorPlan:
    nodes = {node.logical_id: node for node in blueprint.nodes}
    node_logical_ids = {node.id: node.logical_id for node in blueprint.nodes}
    relationships = {
        (
            edge.kind,
            node_logical_ids.get(edge.source_id),
            node_logical_ids.get(edge.target_id),
        )
        for edge in blueprint.edges
        if edge.kind != "next"
    }
    actions: list[CourseDirectorAction] = []
    for candidate in output.actions:
        proposed_state = candidate.proposed_state.as_proposal_state()
        try:
            logical_id = (
                UUID(candidate.logical_artifact_id) if candidate.logical_artifact_id else None
            )
            source_id = UUID(candidate.source_logical_id) if candidate.source_logical_id else None
            target_id = UUID(candidate.target_logical_id) if candidate.target_logical_id else None
            previous_source_id = (
                UUID(candidate.previous_source_logical_id)
                if candidate.previous_source_logical_id
                else None
            )
            previous_target_id = (
                UUID(candidate.previous_target_logical_id)
                if candidate.previous_target_logical_id
                else None
            )
        except ValueError:
            continue
        if candidate.operation in {"update_artifact", "remove_artifact"}:
            if logical_id not in nodes or nodes[logical_id].kind != candidate.artifact_kind:
                continue
        if candidate.operation == "create_question":
            state = proposed_state
            try:
                topic_id = UUID(str(state["topic_logical_id"]))
                concept_id = UUID(str(state["primary_concept_logical_id"]))
            except (KeyError, TypeError, ValueError):
                continue
            if (
                topic_id not in nodes
                or nodes[topic_id].kind != "topic"
                or concept_id not in nodes
                or nodes[concept_id].kind != "concept"
                or ("contains", topic_id, concept_id) not in relationships
                or not str(state.get("body", "")).strip()
                or state.get("type") not in {"mcq", "short_answer", "worked_problem"}
                or not isinstance(state.get("correct_answer"), dict)
                or not state["correct_answer"]
                or not str(state.get("confidence_prompt", "")).strip()
            ):
                continue
        if candidate.operation in {
            "create_relationship",
            "reconnect_relationship",
            "remove_relationship",
        }:
            if (
                candidate.relationship_type is None
                or source_id not in nodes
                or target_id not in nodes
                or not _valid_relationship(
                    nodes[source_id].kind,
                    nodes[target_id].kind,
                    candidate.relationship_type,
                )
            ):
                continue
        if candidate.operation in {"remove_relationship", "reconnect_relationship"} and (
            candidate.relationship_type,
            source_id,
            target_id,
        ) not in relationships:
            if candidate.operation == "remove_relationship":
                continue
        if candidate.operation == "reconnect_relationship":
            if (
                candidate.previous_relationship_type is None
                or previous_source_id not in nodes
                or previous_target_id not in nodes
                or not _valid_relationship(
                    nodes[previous_source_id].kind,
                    nodes[previous_target_id].kind,
                    candidate.previous_relationship_type,
                )
                or (
                    candidate.previous_relationship_type,
                    previous_source_id,
                    previous_target_id,
                )
                not in relationships
            ):
                continue
        actions.append(
            CourseDirectorAction(
                operation=candidate.operation,
                artifact_kind=candidate.artifact_kind,
                logical_artifact_id=logical_id,
                relationship_type=candidate.relationship_type,
                source_logical_id=source_id,
                target_logical_id=target_id,
                previous_relationship_type=candidate.previous_relationship_type,
                previous_source_logical_id=previous_source_id,
                previous_target_logical_id=previous_target_id,
                proposed_state=proposed_state,
                summary=candidate.summary,
                rationale=candidate.rationale,
            )
        )
    clarification = output.clarification
    if not actions and not clarification:
        clarification = "I could not map that request to a safe, bounded Blueprint edit."
    return CourseDirectorPlan(
        summary=output.summary,
        actions=tuple(actions),
        clarification=clarification,
    )


def _valid_relationship(source: str, target: str, relationship: str) -> bool:
    return {
        "contains": source == "topic" and target == "concept",
        "requires": source == "concept" and target == "concept",
        "teaches": source == "concept" and target == "clip",
        "assesses": source == "concept" and target == "question",
        "remediates_to": source == "question" and target in {"concept", "clip"},
        "cites": source != "source" and target == "source",
    }.get(relationship, False)
