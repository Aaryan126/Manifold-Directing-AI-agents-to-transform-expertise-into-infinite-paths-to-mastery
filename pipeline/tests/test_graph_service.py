from uuid import uuid4

import pytest

from app.graph.models import (
    ConceptEdit,
    ConceptGraphProposal,
    ConceptProposal,
    CourseGraphContext,
    EdgeEdit,
    EdgeProposal,
    GraphReviewStatus,
    TopicContext,
)
from app.graph.review_service import ConceptGraphService, graph_warnings
from app.graph.validator import GraphValidationError, validate_no_cycle
from tests.fakes import MemoryConceptGraphRepository, StaticConceptGraphAgent


def test_validate_no_cycle_rejects_cycles() -> None:
    first = uuid4()
    second = uuid4()
    third = uuid4()

    with pytest.raises(GraphValidationError, match="acyclic"):
        validate_no_cycle({(first, second), (second, third), (third, first)})


@pytest.mark.anyio
async def test_graph_generation_preserves_ai_proposals_and_edges() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    service = ConceptGraphService(
        repository=MemoryConceptGraphRepository(_context(course_id, topic_id)),
        agent=StaticConceptGraphAgent(_proposal(topic_id)),
    )

    graph = await service.propose_graph(course_id)

    assert len(graph.concepts) == 2
    assert len(graph.edges) == 1
    assert all(concept.review_status == GraphReviewStatus.PROPOSED for concept in graph.concepts)
    assert graph.concepts[0].ai_proposal is not None
    assert graph.edges[0].ai_proposal is not None


@pytest.mark.anyio
async def test_concept_edit_and_accept_preserve_traceability() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)

    edited = await service.edit_concept(
        graph.concepts[0].id,
        ConceptEdit(name="Instructor vector spaces", description="Edited", action="edit"),
    )
    accepted_edge = await service.accept_edge(graph.edges[0].id)

    assert edited is not None
    assert edited.review_status == GraphReviewStatus.EDITED
    assert edited.ai_proposal is not None
    assert edited.instructor_revision is not None
    assert accepted_edge is not None
    assert accepted_edge.review_status == GraphReviewStatus.ACCEPTED


@pytest.mark.anyio
async def test_dismissing_concept_keeps_it_visible_and_dismisses_orphaned_edges() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)

    dismissed = await service.dismiss_concept(graph.concepts[0].id)
    next_graph = await service.get_graph(course_id)

    assert dismissed is not None
    assert dismissed.review_status == GraphReviewStatus.DISMISSED
    assert any(concept.id == dismissed.id for concept in next_graph.concepts)
    assert next_graph.edges[0].review_status == GraphReviewStatus.DISMISSED
    assert "dismissed edge" in " ".join(graph_warnings(next_graph))


@pytest.mark.anyio
async def test_merge_duplicate_concepts_marks_source_dismissed_and_relinks_edges() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)
    source, target = graph.concepts

    merged_source = await service.merge_concepts(source.id, target.id)

    assert merged_source is not None
    assert merged_source.review_status == GraphReviewStatus.DISMISSED
    assert merged_source.merged_into_concept_id == target.id
    assert merged_source.instructor_revision is not None
    assert merged_source.instructor_revision["action"] == "merge"


@pytest.mark.anyio
async def test_service_rejects_cycle_creating_edge() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)
    first, second = graph.concepts

    with pytest.raises(ValueError, match="acyclic"):
        await service.add_edge(
            course_id,
            EdgeEdit(
                from_concept_id=second.id,
                to_concept_id=first.id,
                rationale="Cycle",
                action="add",
            ),
        )


def _context(course_id: object, topic_id: object) -> CourseGraphContext:
    return CourseGraphContext(
        course_id=course_id,  # type: ignore[arg-type]
        topics=(
            TopicContext(
                id=topic_id,  # type: ignore[arg-type]
                title="Vector spaces",
                summary="Vectors come before bases.",
                start_seconds=0,
                end_seconds=600,
            ),
        ),
    )


def _proposal(topic_id: object) -> ConceptGraphProposal:
    return ConceptGraphProposal(
        concepts=(
            ConceptProposal(
                key="vectors",
                name="Vectors",
                description="Quantities with magnitude and direction.",
                topic_ids=(topic_id,),  # type: ignore[arg-type]
                evidence="The lecture defines vectors first.",
                confidence=0.9,
            ),
            ConceptProposal(
                key="bases",
                name="Bases",
                description="Independent spanning sets.",
                topic_ids=(topic_id,),  # type: ignore[arg-type]
                evidence="Bases are introduced after vectors.",
                confidence=0.9,
            ),
        ),
        edges=(
            EdgeProposal(
                from_key="vectors",
                to_key="bases",
                rationale="Bases require understanding vectors.",
                evidence="The lecture builds from vectors to bases.",
                confidence=0.9,
            ),
        ),
    )
