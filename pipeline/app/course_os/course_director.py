import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Literal, Protocol, cast
from uuid import UUID

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from app.ai.agnes import AgnesStructuredClient
from app.course_os.models import BlueprintNode, CourseBlueprint, CourseFlow

DirectorOperation = Literal[
    "update_artifact",
    "remove_artifact",
    "create_topic",
    "create_concept",
    "create_question",
    "create_relationship",
    "reconnect_relationship",
    "remove_relationship",
    "create_course_unit",
    "remove_course_unit",
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
    async def plan(
        self,
        instruction: str,
        blueprint: CourseBlueprint,
        active_blueprint: CourseBlueprint | None = None,
        course_flow: CourseFlow | None = None,
    ) -> CourseDirectorPlan: ...


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
    course_unit_kind: Literal["quiz", "assignment"] | None = None
    concept_logical_ids: list[str] | None = None

    def as_proposal_state(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class _DirectorActionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: DirectorOperation
    summary: str = Field(min_length=1, max_length=120)
    rationale: str = Field(min_length=1, max_length=240)
    artifact_kind: Literal[
        "topic", "concept", "clip", "question", "source", "course_unit"
    ] | None = None
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


def _director_messages(
    instruction: str,
    blueprint: CourseBlueprint,
    active_blueprint: CourseBlueprint | None,
    course_flow: CourseFlow | None,
) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are Course Director, planning bounded edits to a private course "
                "revision. Return only concrete actions grounded in the supplied Blueprint. "
                "Never imply learner-facing changes are already made: every action becomes "
                "an independent Accept/Edit/Dismiss proposal. Use exact logical IDs. "
                "Supported operations include update_artifact and remove_artifact for any "
                "supplied topic, concept, clip, question, or source; create_topic, "
                "create_concept, create_question; and the relationship operations below. "
                "At whole-course scope, create_course_unit can add a standalone quiz or "
                "assignment with title, summary, instructions, course_unit_kind, and "
                "concept_logical_ids. remove_course_unit removes one supplied Course Flow "
                "unit. Never use these operations for a lecture. "
                "When an instructor asks to remove or delete one exact named artifact, use "
                "remove_artifact with its exact artifact_kind and logical_artifact_id. "
                "Editable fields are topic title/summary/start_seconds/end_seconds; "
                "concept name/description; clip type/difficulty/start_seconds/end_seconds; "
                "and question body/type/correct_answer/confidence_prompt. Supported "
                "relationship semantics are contains(topic→concept), "
                "requires(prerequisite concept→dependent concept), "
                "teaches(concept→clip), assesses(concept→question), "
                "remediates_to(question→concept|clip), and cites(artifact→source). "
                "For example, if Fundraising requires Startup speed, use Startup speed "
                "as source and Fundraising as target. "
                "For reconnect_relationship, identify the exact existing relationship "
                "in the previous_* fields and the replacement in the normal relationship "
                "fields so it remains one atomic review decision. "
                "When asked to move a concept between topics, first inspect its current "
                "contains relationships. If the destination topic already contains the "
                "concept, remove only the old source-topic relationship; never reconnect "
                "onto a duplicate relationship. "
                "For create_topic provide title, summary, start_seconds, end_seconds. "
                "For create_concept provide name, description, topic_logical_ids, and "
                "sequence_after_id. For create_question provide topic_logical_id, "
                "primary_concept_logical_id, body, type, correct_answer, and "
                "confidence_prompt. Ground the question in that concept; for MCQ include "
                "plausible choices in correct_answer. If the request is ambiguous, unsafe, "
                "or cannot be expressed with these operations, return no actions and one "
                "clarification. "
                "The context may list published artifacts that are absent from the private "
                "working revision. If an instructor asks to remove one, do not target a "
                "different artifact and do not create another action. Explain that it is "
                "already removed privately, remains visible in Live until Publish updates, "
                "and can be inspected in Design. "
                "Prefer the smallest coherent plan and explain each action plainly."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                _blueprint_context(instruction, blueprint, active_blueprint, course_flow)
            ),
        },
    ]


def _finish_director_plan(
    parsed: _DirectorPlanOutput,
    instruction: str,
    blueprint: CourseBlueprint,
    active_blueprint: CourseBlueprint | None,
    course_flow: CourseFlow | None,
) -> CourseDirectorPlan:
    plan = _validated_plan(parsed, blueprint, course_flow)
    if not plan.actions:
        reconnect_plan = _deterministic_reconnect_plan(instruction, blueprint)
        if reconnect_plan is not None:
            return reconnect_plan
    published_only_match = _published_only_removal_match(
        instruction,
        blueprint,
        active_blueprint,
    )
    if not plan.actions and published_only_match is not None:
        return _already_removed_plan(published_only_match.title)
    return plan


class OpenAICourseDirector:
    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def plan(
        self,
        instruction: str,
        blueprint: CourseBlueprint,
        active_blueprint: CourseBlueprint | None = None,
        course_flow: CourseFlow | None = None,
    ) -> CourseDirectorPlan:
        response = await self._client.responses.parse(
            model=self._model,
            input=cast(
                Any,
                _director_messages(
                    instruction, blueprint, active_blueprint, course_flow
                ),
            ),
            text_format=_DirectorPlanOutput,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("Course Director did not return a valid edit plan.")
        return _finish_director_plan(
            parsed,
            instruction,
            blueprint,
            active_blueprint,
            course_flow,
        )


class AgnesCourseDirector:
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str,
        *,
        fallback: CourseDirector | None = None,
    ) -> None:
        self._client = AgnesStructuredClient(api_key, model, base_url)
        self._fallback = fallback

    async def plan(
        self,
        instruction: str,
        blueprint: CourseBlueprint,
        active_blueprint: CourseBlueprint | None = None,
        course_flow: CourseFlow | None = None,
    ) -> CourseDirectorPlan:
        try:
            parsed = await self._client.parse(
                messages=_director_messages(
                    instruction, blueprint, active_blueprint, course_flow
                ),
                output_type=_DirectorPlanOutput,
                operation="course_director_plan",
            )
        except Exception:
            if self._fallback is None:
                raise
            return await self._fallback.plan(
                instruction,
                blueprint,
                active_blueprint,
                course_flow,
            )
        return _finish_director_plan(
            parsed,
            instruction,
            blueprint,
            active_blueprint,
            course_flow,
        )


def _blueprint_context(
    instruction: str,
    blueprint: CourseBlueprint,
    active_blueprint: CourseBlueprint | None = None,
    course_flow: CourseFlow | None = None,
) -> dict[str, Any]:
    """Build model context without allowing legacy orphaned edges to crash a request."""

    logical_ids_by_node_id = {node.id: node.logical_id for node in blueprint.nodes}
    relationships = []
    for edge in blueprint.edges:
        source_logical_id = logical_ids_by_node_id.get(edge.source_id)
        target_logical_id = logical_ids_by_node_id.get(edge.target_id)
        if (
            edge.kind == "next"
            or source_logical_id is None
            or target_logical_id is None
        ):
            continue
        relationships.append(
            {
                "kind": edge.kind,
                "source_logical_id": str(source_logical_id),
                "target_logical_id": str(target_logical_id),
                "status": edge.status,
            }
        )
    working_logical_ids = {node.logical_id for node in blueprint.nodes}
    published_only_nodes = [
        {
            "logical_id": str(node.logical_id),
            "kind": node.kind,
            "title": node.title,
            "status": node.status,
        }
        for node in (active_blueprint.nodes if active_blueprint else ())
        if node.logical_id not in working_logical_ids
    ]
    return {
        "instruction": instruction,
        "revision_id": str(blueprint.revision_id),
        "revision_kind": blueprint.revision_kind,
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
        "relationships": relationships,
        "published_artifacts_absent_from_private_revision": published_only_nodes,
        "course_flow": [
            {
                "logical_id": str(unit.logical_id),
                "kind": unit.kind,
                "title": unit.title,
                "summary": unit.summary,
                "status": unit.status,
                "concept_logical_ids": [
                    str(value) for value in unit.concept_logical_ids
                ],
            }
            for unit in (course_flow.units if course_flow else ())
        ],
    }


class LocalCourseDirector:
    """Deterministic development fallback with a small, explicit command grammar."""

    async def plan(
        self,
        instruction: str,
        blueprint: CourseBlueprint,
        active_blueprint: CourseBlueprint | None = None,
        course_flow: CourseFlow | None = None,
    ) -> CourseDirectorPlan:
        normalized = instruction.strip()
        lowered = normalized.lower()
        reconnect_plan = _deterministic_reconnect_plan(normalized, blueprint)
        if reconnect_plan is not None:
            return reconnect_plan
        flow_matches = sorted(
            (
                unit
                for unit in (course_flow.units if course_flow else ())
                if _instruction_matches_title(normalized, unit.title)
            ),
            key=lambda unit: len(unit.title),
            reverse=True,
        )
        if ("remove" in lowered or "delete" in lowered) and flow_matches:
            unit = flow_matches[0]
            return CourseDirectorPlan(
                summary=f"Prepare removal of {unit.title} from the Course Flow.",
                actions=(
                    CourseDirectorAction(
                        operation="remove_course_unit",
                        artifact_kind="course_unit",
                        logical_artifact_id=unit.logical_id,
                        summary=f"Remove {unit.title}",
                        rationale=(
                            "The instructor explicitly requested this private "
                            "Course Flow change."
                        ),
                    ),
                ),
            )
        matches = sorted(
            (
                node
                for node in blueprint.nodes
                if _instruction_matches_title(normalized, node.title)
            ),
            key=lambda node: len(node.title),
            reverse=True,
        )
        requested_unit_kind = (
            "quiz" if "quiz" in lowered
            else "assignment" if "assignment" in lowered
            else None
        )
        matched_concepts = [node for node in matches if node.kind == "concept"]
        if ("add" in lowered or "create" in lowered) and requested_unit_kind:
            if not matched_concepts:
                return CourseDirectorPlan(
                    summary=f"I can prepare that {requested_unit_kind}.",
                    actions=(),
                    clarification=(
                        "Name at least one exact concept the new "
                        f"{requested_unit_kind} should assess."
                    ),
                )
            concept_titles = ", ".join(node.title for node in matched_concepts)
            title = (
                f"{requested_unit_kind.title()}: {matched_concepts[0].title}"
            )
            return CourseDirectorPlan(
                summary=f"Prepare a standalone {requested_unit_kind}.",
                actions=(
                    CourseDirectorAction(
                        operation="create_course_unit",
                        artifact_kind="course_unit",
                        proposed_state={
                            "course_unit_kind": requested_unit_kind,
                            "title": title,
                            "summary": f"Checks understanding of {concept_titles}.",
                            "instructions": (
                                "Complete this after the connected lecture and "
                                "explain your reasoning."
                            ),
                            "concept_logical_ids": [
                                str(node.logical_id) for node in matched_concepts
                            ],
                        },
                        summary=f"Add {title}",
                        rationale=(
                            "The instructor requested a new whole-course learning unit "
                            "grounded in these reviewed concepts."
                        ),
                    ),
                ),
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
        if ("remove" in lowered or "delete" in lowered) and active_blueprint is not None:
            working_logical_ids = {node.logical_id for node in blueprint.nodes}
            published_only_matches = sorted(
                (
                    node
                    for node in active_blueprint.nodes
                    if node.logical_id not in working_logical_ids
                    and _instruction_matches_title(normalized, node.title)
                ),
                key=lambda node: len(node.title),
                reverse=True,
            )
            if published_only_matches:
                node = published_only_matches[0]
                return CourseDirectorPlan(
                    summary=f"{node.title} is already removed from the private revision.",
                    actions=(),
                    clarification=(
                        f"“{node.title}” is already removed in Design. Live still shows the "
                        "published course until you choose Publish updates."
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


def _validated_plan(
    output: _DirectorPlanOutput,
    blueprint: CourseBlueprint,
    course_flow: CourseFlow | None = None,
) -> CourseDirectorPlan:
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
    course_units = {
        unit.logical_id: unit for unit in (course_flow.units if course_flow else ())
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
        if candidate.operation == "remove_course_unit":
            if logical_id not in course_units or candidate.artifact_kind != "course_unit":
                continue
        if candidate.operation == "create_course_unit":
            state = proposed_state
            try:
                concept_ids = [
                    UUID(str(value)) for value in state.get("concept_logical_ids", [])
                ]
            except (TypeError, ValueError):
                continue
            if (
                state.get("course_unit_kind") not in {"quiz", "assignment"}
                or not str(state.get("title", "")).strip()
                or not concept_ids
                or any(
                    concept_id not in nodes or nodes[concept_id].kind != "concept"
                    for concept_id in concept_ids
                )
            ):
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
        operation = candidate.operation
        relationship_type = candidate.relationship_type
        normalized_source_id = source_id
        normalized_target_id = target_id
        normalized_previous_relationship_type = candidate.previous_relationship_type
        normalized_previous_source_id = previous_source_id
        normalized_previous_target_id = previous_target_id
        if (
            candidate.operation == "reconnect_relationship"
            and candidate.relationship_type == "requires"
            and source_id == previous_target_id
            and target_id not in {previous_source_id, previous_target_id}
        ):
            # Natural language usually says "dependent requires prerequisite", while the
            # stored graph points prerequisite → dependent. Normalize the common reversed
            # model output when it keeps the old dependent and replaces its prerequisite.
            normalized_source_id = target_id
            normalized_target_id = source_id
        if (
            candidate.operation == "reconnect_relationship"
            and (
                candidate.relationship_type,
                normalized_source_id,
                normalized_target_id,
            )
            in relationships
            and (
                candidate.previous_relationship_type,
                previous_source_id,
                previous_target_id,
            )
            != (
                candidate.relationship_type,
                normalized_source_id,
                normalized_target_id,
            )
        ):
            operation = "remove_relationship"
            relationship_type = candidate.previous_relationship_type
            normalized_source_id = previous_source_id
            normalized_target_id = previous_target_id
            normalized_previous_relationship_type = None
            normalized_previous_source_id = None
            normalized_previous_target_id = None
        actions.append(
            CourseDirectorAction(
                operation=operation,
                artifact_kind=candidate.artifact_kind,
                logical_artifact_id=logical_id,
                relationship_type=relationship_type,
                source_logical_id=normalized_source_id,
                target_logical_id=normalized_target_id,
                previous_relationship_type=normalized_previous_relationship_type,
                previous_source_logical_id=normalized_previous_source_id,
                previous_target_logical_id=normalized_previous_target_id,
                proposed_state=proposed_state,
                summary=_clear_director_text(candidate.summary) or "Prepare a private change",
                rationale=_clear_director_text(candidate.rationale)
                or "This change follows the instructor's request.",
            )
        )
    clarification = _clear_director_text(output.clarification)
    if not actions and not clarification:
        clarification = "I could not map that request to a safe, bounded Blueprint edit."
    return CourseDirectorPlan(
        summary=_clear_director_text(output.summary)
        or "I reviewed that request against the current Blueprint.",
        actions=tuple(actions),
        clarification=clarification,
    )


def _clear_director_text(value: str | None) -> str | None:
    """Keep instructor-facing replies concise and free of internal implementation detail."""

    if value is None:
        return None
    text = re.sub(
        r"\s*\(\s*(?:logical[_\s-]*id|artifact[_\s-]*id|id)\s*:\s*"
        r"[0-9a-f]{8}-[0-9a-f-]{27,}\s*\)",
        "",
        value,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[\u3400-\u9fff]+/?", "", text)
    text = re.sub(r"\s+You can\s*/?\s*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip(" \n/") or None


def _normalized_title(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower().replace(",", "")).split())


def _instruction_matches_title(instruction: str, title: str) -> bool:
    normalized_instruction = _normalized_title(instruction)
    normalized_title = _normalized_title(title)
    if normalized_title in normalized_instruction:
        return True
    title_tokens = set(normalized_title.split())
    instruction_tokens = set(normalized_instruction.split())
    token_coverage = len(title_tokens & instruction_tokens) / max(len(title_tokens), 1)
    return (
        token_coverage >= 0.72
        or SequenceMatcher(None, normalized_instruction, normalized_title).ratio() >= 0.68
    )


def _deterministic_reconnect_plan(
    instruction: str,
    blueprint: CourseBlueprint,
) -> CourseDirectorPlan | None:
    """Recover one explicit quoted prerequisite swap without relaxing graph safety."""

    lowered = instruction.lower()
    if (
        not re.search(r"\breconnect\b", lowered)
        or not re.search(r"\brequires?\b", lowered)
        or not re.search(r"\b(?:not|instead\s+of)\b", lowered)
    ):
        return None
    references = _quoted_instruction_references(instruction)
    if len(references) != 3:
        return None
    concepts = tuple(node for node in blueprint.nodes if node.kind == "concept")
    dependent = _unique_concept_reference(references[0], concepts)
    replacement = _unique_concept_reference(references[1], concepts)
    previous = _unique_concept_reference(references[2], concepts)
    if (
        dependent is None
        or replacement is None
        or previous is None
        or len({dependent.logical_id, replacement.logical_id, previous.logical_id}) != 3
    ):
        return None

    logical_ids_by_node_id = {node.id: node.logical_id for node in blueprint.nodes}
    relationships = {
        (
            edge.kind,
            logical_ids_by_node_id.get(edge.source_id),
            logical_ids_by_node_id.get(edge.target_id),
        )
        for edge in blueprint.edges
        if edge.kind != "next"
    }
    previous_relationship = ("requires", previous.logical_id, dependent.logical_id)
    replacement_relationship = (
        "requires",
        replacement.logical_id,
        dependent.logical_id,
    )
    if (
        previous_relationship not in relationships
        and replacement_relationship in relationships
    ):
        return CourseDirectorPlan(
            summary=f"{replacement.title} is already the private prerequisite.",
            actions=(),
            clarification=(
                "That prerequisite reconnect is already applied in Design. Live still shows "
                "the published relationship until you choose Publish updates."
            ),
        )
    if previous_relationship not in relationships:
        return None

    output = _DirectorPlanOutput(
        summary=f"Reconnect the prerequisite for {dependent.title}.",
        actions=[
            _DirectorActionOutput(
                operation="reconnect_relationship",
                relationship_type="requires",
                source_logical_id=str(replacement.logical_id),
                target_logical_id=str(dependent.logical_id),
                previous_relationship_type="requires",
                previous_source_logical_id=str(previous.logical_id),
                previous_target_logical_id=str(dependent.logical_id),
                summary=f"Use {replacement.title} as the prerequisite",
                rationale=(
                    "The instructor named the dependent concept, replacement prerequisite, "
                    "and existing prerequisite explicitly."
                ),
            )
        ],
    )
    plan = _validated_plan(output, blueprint)
    return plan if plan.actions else None


def _quoted_instruction_references(instruction: str) -> tuple[str, ...]:
    matches = re.finditer(
        r'“([^”]+)”|‘([^’]+)’|"([^"]+)"|\'([^\']+)\'',
        instruction,
    )
    return tuple(
        next(group for group in match.groups() if group is not None).strip()
        for match in matches
    )


def _reference_tokens(value: str) -> set[str]:
    tokens = _normalized_title(value).split()
    return {
        token[:-1] if token.endswith("s") and len(token) > 4 else token
        for token in tokens
        if token not in {"a", "an", "and", "are", "as", "for", "is", "of", "the", "to"}
    }


def _unique_concept_reference(
    reference: str,
    concepts: tuple[BlueprintNode, ...],
) -> BlueprintNode | None:
    normalized_reference = _normalized_title(reference)
    reference_tokens = _reference_tokens(reference)
    if not normalized_reference or not reference_tokens:
        return None
    ranked: list[tuple[float, BlueprintNode]] = []
    for concept in concepts:
        normalized_title = _normalized_title(concept.title)
        title_tokens = _reference_tokens(concept.title)
        coverage = len(reference_tokens & title_tokens) / len(reference_tokens)
        score = max(
            coverage,
            SequenceMatcher(None, normalized_reference, normalized_title).ratio(),
        )
        if normalized_reference == normalized_title:
            score = 1.2
        elif normalized_reference in normalized_title:
            score = 1.1
        if coverage >= 0.8 or score >= 0.72:
            ranked.append((score, concept))
    ranked.sort(key=lambda candidate: candidate[0], reverse=True)
    if not ranked:
        return None
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 0.12:
        return None
    return ranked[0][1]


def _published_only_removal_match(
    instruction: str,
    blueprint: CourseBlueprint,
    active_blueprint: CourseBlueprint | None,
) -> BlueprintNode | None:
    lowered = instruction.lower()
    if active_blueprint is None or not re.search(r"\b(remove|delete)\b", lowered):
        return None
    working_ids = {node.logical_id for node in blueprint.nodes}
    matches = [
        node
        for node in active_blueprint.nodes
        if node.logical_id not in working_ids
        and _instruction_matches_title(instruction, node.title)
    ]
    return max(matches, key=lambda node: len(node.title), default=None)


def _already_removed_plan(title: str) -> CourseDirectorPlan:
    return CourseDirectorPlan(
        summary=f"{title} is already removed from the private revision.",
        actions=(),
        clarification=(
            f"“{title}” is already removed from Design. It remains visible in Live until "
            "you publish the update."
        ),
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
