from uuid import uuid4

import pytest

from app.graph.models import (
    ConceptCreate,
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
async def test_instructor_can_add_reviewed_concept_with_topic_link() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))

    concept = await service.add_concept(
        course_id,
        ConceptCreate(
            name="Instructor concept",
            description="Added directly on the graph",
            topic_ids=(topic_id,),
            action="add",
        ),
    )

    assert concept.review_status == GraphReviewStatus.EDITED
    assert concept.instructor_revision is not None
    assert concept.instructor_revision["topic_ids"] == [str(topic_id)]


@pytest.mark.anyio
async def test_graph_generation_limits_density_and_drops_uncertain_edges() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    concepts = tuple(
        ConceptProposal(
            key=f"concept-{index}",
            name=f"Concept {index}",
            description=f"Description {index}",
            topic_ids=(topic_id,),
            evidence=f"Evidence {index}",
            confidence=0.9 - index / 100,
        )
        for index in range(4)
    )
    proposal = ConceptGraphProposal(
        concepts=concepts,
        edges=(
            EdgeProposal(
                from_key="concept-0",
                to_key="concept-1",
                rationale="Necessary",
                evidence="Explicit dependency",
                confidence=0.9,
            ),
            EdgeProposal(
                from_key="concept-1",
                to_key="concept-2",
                rationale="Chronological only",
                evidence="Appears next",
                confidence=0.4,
            ),
        ),
    )
    service = ConceptGraphService(
        repository=MemoryConceptGraphRepository(_context(course_id, topic_id)),
        agent=StaticConceptGraphAgent(proposal),
    )

    graph = await service.propose_graph(course_id)

    assert len(graph.concepts) == 3
    assert len(graph.edges) == 1


@pytest.mark.anyio
async def test_graph_regeneration_preserves_reviewed_concepts_and_edges() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)
    first, second = graph.concepts
    reviewed_first = await service.accept_concept(first.id)
    reviewed_second = await service.edit_concept(
        second.id,
        ConceptEdit(name=second.name, description="Instructor wording", action="edit"),
    )
    reviewed_edge = await service.accept_edge(graph.edges[0].id)

    regenerated = await service.propose_graph(course_id)

    assert reviewed_first is not None
    assert reviewed_second is not None
    assert reviewed_edge is not None
    assert (
        next(item for item in regenerated.concepts if item.id == reviewed_first.id).review_status
        == GraphReviewStatus.ACCEPTED
    )
    assert (
        next(item for item in regenerated.concepts if item.id == reviewed_second.id).review_status
        == GraphReviewStatus.EDITED
    )
    assert (
        next(item for item in regenerated.edges if item.id == reviewed_edge.id).review_status
        == GraphReviewStatus.ACCEPTED
    )
    assert len(regenerated.concepts) == 2
    assert len(regenerated.edges) == 1


@pytest.mark.anyio
async def test_graph_regeneration_skips_edges_that_conflict_with_reviewed_graph() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)
    for concept in graph.concepts:
        await service.accept_concept(concept.id)
    reviewed_edge = await service.accept_edge(graph.edges[0].id)
    reverse_proposal = ConceptGraphProposal(
        concepts=_proposal(topic_id).concepts,
        edges=(
            EdgeProposal(
                from_key="bases",
                to_key="vectors",
                rationale="Conflicts with the reviewed direction",
                evidence="A later model run changed its mind",
                confidence=0.95,
            ),
        ),
    )

    regenerated = await ConceptGraphService(
        repository,
        StaticConceptGraphAgent(reverse_proposal),
    ).propose_graph(course_id)

    assert reviewed_edge is not None
    assert len(regenerated.edges) == 1
    assert regenerated.edges[0].id == reviewed_edge.id
    assert regenerated.edges[0].review_status == GraphReviewStatus.ACCEPTED


@pytest.mark.anyio
async def test_graph_regeneration_does_not_resurrect_dismissed_near_duplicate() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    initial = ConceptGraphProposal(
        concepts=(
            ConceptProposal(
                key="vector",
                name="Vectors",
                description="Vector basics",
                topic_ids=(topic_id,),
                evidence="Defined in the lecture",
                confidence=0.9,
            ),
        ),
        edges=(),
    )
    service = ConceptGraphService(repository, StaticConceptGraphAgent(initial))
    graph = await service.propose_graph(course_id)
    dismissed = await service.dismiss_concept(graph.concepts[0].id)
    regenerated = await ConceptGraphService(
        repository,
        StaticConceptGraphAgent(
            ConceptGraphProposal(
                concepts=(
                    ConceptProposal(
                        key="vector-new",
                        name="Vector",
                        description="Duplicate wording",
                        topic_ids=(topic_id,),
                        evidence="Defined in the lecture",
                        confidence=0.95,
                    ),
                ),
                edges=(),
            )
        ),
    ).propose_graph(course_id)

    assert dismissed is not None
    assert len(regenerated.concepts) == 1
    assert regenerated.concepts[0].id == dismissed.id
    assert regenerated.concepts[0].review_status == GraphReviewStatus.DISMISSED


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
async def test_instructor_can_repair_concept_topic_links() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    second_topic_id = uuid4()
    repository = MemoryConceptGraphRepository(_context(course_id, topic_id))
    service = ConceptGraphService(repository, StaticConceptGraphAgent(_proposal(topic_id)))
    graph = await service.propose_graph(course_id)

    edited = await service.set_concept_topics(
        graph.concepts[0].id,
        (topic_id, second_topic_id),
    )

    assert edited is not None
    assert edited.review_status == GraphReviewStatus.EDITED
    assert edited.instructor_revision is not None
    assert edited.instructor_revision["topic_ids"] == [str(topic_id), str(second_topic_id)]


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
