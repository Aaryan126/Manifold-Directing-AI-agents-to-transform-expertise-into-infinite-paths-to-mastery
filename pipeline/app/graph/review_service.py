from collections.abc import Awaitable, Callable
from typing import cast
from uuid import UUID

from app.audit.models import AuditEventCreate
from app.audit.service import (
    AuditService,
    instructor_note_from_state,
    rationale_from_state,
    snapshot,
)
from app.graph.agent import ConceptGraphAgent
from app.graph.models import (
    Concept,
    ConceptCreate,
    ConceptEdit,
    ConceptGraph,
    ConceptGraphEdge,
    EdgeEdit,
    GraphReviewStatus,
)
from app.graph.proposal_policy import normalize_graph_proposal
from app.graph.review_repository import ConceptGraphRepository
from app.graph.validator import GraphValidationError, validate_no_cycle


class ConceptGraphValidationError(ValueError):
    pass


class ConceptGraphService:
    def __init__(
        self,
        repository: ConceptGraphRepository,
        agent: ConceptGraphAgent,
        audit_service: AuditService | None = None,
    ) -> None:
        self._repository = repository
        self._agent = agent
        self._audit_service = audit_service

    async def propose_graph(self, course_id: UUID) -> ConceptGraph:
        context = await self._repository.get_course_context(course_id)
        if context is None:
            raise ConceptGraphValidationError("No accepted or edited topics found for this course.")
        try:
            proposal = normalize_graph_proposal(
                context,
                await self._agent.propose_graph(context),
            )
        except ValueError as exc:
            raise ConceptGraphValidationError(str(exc)) from exc
        graph = await self._repository.replace_ai_graph(course_id, proposal)
        await self._audit_graph_proposal(course_id, graph)
        return graph

    async def get_graph(self, course_id: UUID) -> ConceptGraph:
        return await self._repository.get_graph(course_id)

    async def add_concept(self, course_id: UUID, create: ConceptCreate) -> Concept:
        _validate_concept_edit(
            ConceptEdit(name=create.name, description=create.description, action=create.action)
        )
        if not create.topic_ids:
            raise ConceptGraphValidationError("A concept must be linked to at least one topic.")
        concept = await self._repository.add_concept(course_id, create)
        await self._audit_concept(concept, None, concept, create.action, "instructor")
        return concept

    async def edit_concept(self, concept_id: UUID, edit: ConceptEdit) -> Concept | None:
        _validate_concept_edit(edit)
        previous = await self._find_concept(concept_id)
        concept = await self._repository.edit_concept(concept_id, edit)
        if concept is not None:
            await self._audit_concept(concept, previous, concept, edit.action, "instructor")
        return concept

    async def accept_concept(self, concept_id: UUID) -> Concept | None:
        previous = await self._find_concept(concept_id)
        concept = await self._repository.accept_concept(concept_id)
        if concept is not None:
            await self._audit_concept(concept, previous, concept, "accept", "instructor")
        return concept

    async def set_concept_topics(
        self,
        concept_id: UUID,
        topic_ids: tuple[UUID, ...],
    ) -> Concept | None:
        previous = await self._find_concept(concept_id)
        concept = await self._repository.set_concept_topics(concept_id, topic_ids)
        if concept is not None:
            await self._audit_concept(
                concept,
                previous,
                concept,
                "edit_topic_links",
                "instructor",
            )
        return concept

    async def dismiss_concept(self, concept_id: UUID) -> Concept | None:
        previous = await self._find_concept(concept_id)
        concept = await self._repository.dismiss_concept(concept_id)
        if concept is not None:
            await self._audit_concept(concept, previous, concept, "dismiss", "instructor")
        return concept

    async def merge_concepts(
        self,
        source_concept_id: UUID,
        target_concept_id: UUID,
    ) -> Concept | None:
        previous = await self._find_concept(target_concept_id)
        concept = await self._repository.merge_concepts(source_concept_id, target_concept_id)
        if concept is not None:
            await self._audit_concept(concept, previous, concept, "merge", "instructor")
        return concept

    async def add_edge(self, course_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge:
        _validate_edge_edit(edit)
        edge = await self._repository.add_edge(course_id, edit)
        await self._audit_edge(course_id, edge, None, edge, edit.action, "instructor")
        return edge

    async def edit_edge(self, edge_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge | None:
        _validate_edge_edit(edit)
        previous = await self._find_edge(edge_id)
        edge = await self._repository.edit_edge(edge_id, edit)
        if edge is not None:
            await self._audit_edge_from_edge(edge, previous, edge, edit.action, "instructor")
        return edge

    async def accept_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        previous = await self._find_edge(edge_id)
        edge = await self._repository.accept_edge(edge_id)
        if edge is not None:
            await self._audit_edge_from_edge(edge, previous, edge, "accept", "instructor")
        return edge

    async def dismiss_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        previous = await self._find_edge(edge_id)
        edge = await self._repository.dismiss_edge(edge_id)
        if edge is not None:
            await self._audit_edge_from_edge(edge, previous, edge, "dismiss", "instructor")
        return edge

    async def _find_concept(self, concept_id: UUID) -> Concept | None:
        getter = getattr(self._repository, "get_concept", None)
        if getter is not None:
            typed_getter = cast(Callable[[UUID], Awaitable[object]], getter)
            result = await typed_getter(concept_id)
            return result if isinstance(result, Concept) else None
        for graph_course_id in await self._candidate_course_ids_for_graph_lookup(concept_id):
            graph = await self._repository.get_graph(graph_course_id)
            found = next((concept for concept in graph.concepts if concept.id == concept_id), None)
            if found is not None:
                return found
        return None

    async def _find_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        getter = getattr(self._repository, "get_edge", None)
        if getter is not None:
            typed_getter = cast(Callable[[UUID], Awaitable[object]], getter)
            result = await typed_getter(edge_id)
            return result if isinstance(result, ConceptGraphEdge) else None
        for graph_course_id in await self._candidate_course_ids_for_graph_lookup(edge_id):
            graph = await self._repository.get_graph(graph_course_id)
            found = next((edge for edge in graph.edges if edge.id == edge_id), None)
            if found is not None:
                return found
        return None

    async def _candidate_course_ids_for_graph_lookup(self, artifact_id: UUID) -> tuple[UUID, ...]:
        # Repositories expose graph by course. For production Postgres, returned artifacts carry
        # course_id after mutation; this fallback only supports memory tests that call before-state
        # lookup. It avoids expanding the graph repository contract for Phase 9.
        del artifact_id
        return ()

    async def _audit_concept(
        self,
        concept: Concept,
        previous: Concept | None,
        new: Concept,
        action: str,
        source: str,
    ) -> None:
        if self._audit_service is None:
            return
        previous_state = snapshot(previous)
        new_state = snapshot(new)
        await self._audit_service.record(
            AuditEventCreate(
                course_id=concept.course_id,
                artifact_type="concept",
                artifact_id=concept.id,
                action=action,
                source=source,
                previous_state=previous_state,
                new_state=new_state,
                ai_rationale=rationale_from_state(new_state or previous_state),
                instructor_note=instructor_note_from_state(new_state),
            ),
        )

    async def _audit_graph_proposal(self, course_id: UUID, graph: ConceptGraph) -> None:
        if self._audit_service is None:
            return
        events = tuple(
            [
                AuditEventCreate(
                    course_id=course_id,
                    artifact_type="concept",
                    artifact_id=concept.id,
                    action="propose",
                    source="ai",
                    previous_state=None,
                    new_state=snapshot(concept),
                    ai_rationale=rationale_from_state(snapshot(concept)),
                )
                for concept in graph.concepts
                if concept.review_status == GraphReviewStatus.PROPOSED
            ]
            + [
                AuditEventCreate(
                    course_id=course_id,
                    artifact_type="concept_edge",
                    artifact_id=edge.id,
                    action="propose",
                    source="ai",
                    previous_state=None,
                    new_state=snapshot(edge),
                    ai_rationale=rationale_from_state(snapshot(edge)),
                )
                for edge in graph.edges
                if edge.review_status == GraphReviewStatus.PROPOSED
            ],
        )
        await self._audit_service.record_many(events)

    async def _audit_edge_from_edge(
        self,
        edge: ConceptGraphEdge,
        previous: ConceptGraphEdge | None,
        new: ConceptGraphEdge,
        action: str,
        source: str,
    ) -> None:
        course_id = await self._course_id_for_edge(edge)
        if course_id is not None:
            await self._audit_edge(course_id, edge, previous, new, action, source)

    async def _audit_edge(
        self,
        course_id: UUID,
        edge: ConceptGraphEdge,
        previous: ConceptGraphEdge | None,
        new: ConceptGraphEdge,
        action: str,
        source: str,
    ) -> None:
        if self._audit_service is None:
            return
        previous_state = snapshot(previous)
        new_state = snapshot(new)
        await self._audit_service.record(
            AuditEventCreate(
                course_id=course_id,
                artifact_type="concept_edge",
                artifact_id=edge.id,
                action=action,
                source=source,
                previous_state=previous_state,
                new_state=new_state,
                ai_rationale=rationale_from_state(new_state or previous_state),
                instructor_note=instructor_note_from_state(new_state),
            ),
        )

    async def _course_id_for_edge(self, edge: ConceptGraphEdge) -> UUID | None:
        getter = getattr(self._repository, "course_id_for_edge", None)
        if getter is not None:
            typed_getter = cast(Callable[[UUID], Awaitable[object]], getter)
            result = await typed_getter(edge.id)
            return result if isinstance(result, UUID) else None
        for concept_id in (edge.from_concept_id, edge.to_concept_id):
            concept = await self._find_concept(concept_id)
            if concept is not None:
                return concept.course_id
        return None


def graph_warnings(graph: ConceptGraph) -> list[str]:
    active_concepts = {
        concept.id
        for concept in graph.concepts
        if concept.review_status != GraphReviewStatus.DISMISSED
        and concept.merged_into_concept_id is None
    }
    active_edges = {
        (edge.from_concept_id, edge.to_concept_id)
        for edge in graph.edges
        if edge.review_status != GraphReviewStatus.DISMISSED
        and edge.from_concept_id in active_concepts
        and edge.to_concept_id in active_concepts
    }
    warnings: list[str] = []
    try:
        validate_no_cycle(active_edges)
    except GraphValidationError as exc:
        warnings.append(str(exc))

    dismissed_edges = [
        edge
        for edge in graph.edges
        if edge.review_status == GraphReviewStatus.DISMISSED
        and (edge.from_concept_id in active_concepts or edge.to_concept_id in active_concepts)
    ]
    if dismissed_edges:
        warnings.append(
            f"{len(dismissed_edges)} dismissed edge(s) remain visible for traceability."
        )
    return warnings


def _validate_concept_edit(edit: ConceptEdit) -> None:
    if not edit.name.strip():
        raise ConceptGraphValidationError("Concept name is required.")


def _validate_edge_edit(edit: EdgeEdit) -> None:
    if edit.from_concept_id == edit.to_concept_id:
        raise ConceptGraphValidationError("Concept edge cannot point to itself.")
