from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_concept_graph_service
from app.graph.models import Concept, ConceptEdit, ConceptGraph, ConceptGraphEdge, EdgeEdit
from app.graph.review_service import (
    ConceptGraphService,
    ConceptGraphValidationError,
    graph_warnings,
)

router = APIRouter(prefix="/courses", tags=["graph"])
GraphServiceDependency = Annotated[ConceptGraphService, Depends(get_concept_graph_service)]


class ConceptResponse(BaseModel):
    id: UUID
    course_id: UUID
    name: str
    description: str | None
    review_status: str
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None
    merged_into_concept_id: UUID | None


class EdgeResponse(BaseModel):
    id: UUID
    from_concept_id: UUID
    to_concept_id: UUID
    relationship: str
    review_status: str
    ai_proposal: dict[str, object] | None
    instructor_revision: dict[str, object] | None
    approved_at: str | None
    dismissed_at: str | None


class GraphResponse(BaseModel):
    course_id: UUID
    concepts: list[ConceptResponse]
    edges: list[EdgeResponse]
    warnings: list[str]


class ConceptEditRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class EdgeEditRequest(BaseModel):
    from_concept_id: UUID
    to_concept_id: UUID
    rationale: str = ""


class MergeConceptsRequest(BaseModel):
    source_concept_id: UUID
    target_concept_id: UUID


@router.post("/{course_id}/graph/generate", response_model=GraphResponse)
async def generate_graph(course_id: UUID, service: GraphServiceDependency) -> GraphResponse:
    try:
        graph = await service.propose_graph(course_id)
    except (ConceptGraphValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _graph_response(graph)


@router.get("/{course_id}/graph", response_model=GraphResponse)
async def get_graph(course_id: UUID, service: GraphServiceDependency) -> GraphResponse:
    return _graph_response(await service.get_graph(course_id))


@router.patch("/graph/concepts/{concept_id}", response_model=ConceptResponse)
async def edit_concept(
    concept_id: UUID,
    request: ConceptEditRequest,
    service: GraphServiceDependency,
) -> ConceptResponse:
    try:
        concept = await service.edit_concept(
            concept_id,
            ConceptEdit(name=request.name, description=request.description, action="edit"),
        )
    except ConceptGraphValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found.")
    return _concept_response(concept)


@router.post("/graph/concepts/{concept_id}/accept", response_model=ConceptResponse)
async def accept_concept(concept_id: UUID, service: GraphServiceDependency) -> ConceptResponse:
    concept = await service.accept_concept(concept_id)
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found.")
    return _concept_response(concept)


@router.post("/graph/concepts/{concept_id}/dismiss", response_model=ConceptResponse)
async def dismiss_concept(concept_id: UUID, service: GraphServiceDependency) -> ConceptResponse:
    concept = await service.dismiss_concept(concept_id)
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found.")
    return _concept_response(concept)


@router.post("/graph/concepts/merge", response_model=ConceptResponse)
async def merge_concepts(
    request: MergeConceptsRequest,
    service: GraphServiceDependency,
) -> ConceptResponse:
    try:
        concept = await service.merge_concepts(
            request.source_concept_id,
            request.target_concept_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found.")
    return _concept_response(concept)


@router.post("/{course_id}/graph/edges", response_model=EdgeResponse, status_code=201)
async def add_edge(
    course_id: UUID,
    request: EdgeEditRequest,
    service: GraphServiceDependency,
) -> EdgeResponse:
    try:
        edge = await service.add_edge(course_id, _edge_edit_from_request(request, "add"))
    except (ConceptGraphValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _edge_response(edge)


@router.patch("/graph/edges/{edge_id}", response_model=EdgeResponse)
async def edit_edge(
    edge_id: UUID,
    request: EdgeEditRequest,
    service: GraphServiceDependency,
) -> EdgeResponse:
    try:
        edge = await service.edit_edge(edge_id, _edge_edit_from_request(request, "edit"))
    except (ConceptGraphValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if edge is None:
        raise HTTPException(status_code=404, detail="Edge not found.")
    return _edge_response(edge)


@router.post("/graph/edges/{edge_id}/accept", response_model=EdgeResponse)
async def accept_edge(edge_id: UUID, service: GraphServiceDependency) -> EdgeResponse:
    edge = await service.accept_edge(edge_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="Edge not found.")
    return _edge_response(edge)


@router.post("/graph/edges/{edge_id}/dismiss", response_model=EdgeResponse)
async def dismiss_edge(edge_id: UUID, service: GraphServiceDependency) -> EdgeResponse:
    edge = await service.dismiss_edge(edge_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="Edge not found.")
    return _edge_response(edge)


def _edge_edit_from_request(request: EdgeEditRequest, action: str) -> EdgeEdit:
    return EdgeEdit(
        from_concept_id=request.from_concept_id,
        to_concept_id=request.to_concept_id,
        rationale=request.rationale,
        action=action,
    )


def _graph_response(graph: ConceptGraph) -> GraphResponse:
    return GraphResponse(
        course_id=graph.course_id,
        concepts=[_concept_response(concept) for concept in graph.concepts],
        edges=[_edge_response(edge) for edge in graph.edges],
        warnings=graph_warnings(graph),
    )


def _concept_response(concept: Concept) -> ConceptResponse:
    return ConceptResponse(
        id=concept.id,
        course_id=concept.course_id,
        name=concept.name,
        description=concept.description,
        review_status=concept.review_status.value,
        ai_proposal=concept.ai_proposal,
        instructor_revision=concept.instructor_revision,
        approved_at=concept.approved_at,
        dismissed_at=concept.dismissed_at,
        merged_into_concept_id=concept.merged_into_concept_id,
    )


def _edge_response(edge: ConceptGraphEdge) -> EdgeResponse:
    return EdgeResponse(
        id=edge.id,
        from_concept_id=edge.from_concept_id,
        to_concept_id=edge.to_concept_id,
        relationship=edge.relationship,
        review_status=edge.review_status.value,
        ai_proposal=edge.ai_proposal,
        instructor_revision=edge.instructor_revision,
        approved_at=edge.approved_at,
        dismissed_at=edge.dismissed_at,
    )
