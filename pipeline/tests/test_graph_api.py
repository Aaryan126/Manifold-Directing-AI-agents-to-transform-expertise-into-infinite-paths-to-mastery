from uuid import uuid4

from fastapi.testclient import TestClient

from app.dependencies import get_concept_graph_service
from app.graph.models import (
    ConceptGraphProposal,
    ConceptProposal,
    CourseGraphContext,
    EdgeProposal,
    TopicContext,
)
from app.graph.review_service import ConceptGraphService
from app.main import app
from tests.fakes import MemoryConceptGraphRepository, StaticConceptGraphAgent


def test_graph_review_api_supports_generate_edit_accept_dismiss_and_merge() -> None:
    course_id = uuid4()
    topic_id = uuid4()
    service = ConceptGraphService(
        repository=MemoryConceptGraphRepository(
            CourseGraphContext(
                course_id=course_id,
                topics=(
                    TopicContext(
                        id=topic_id,
                        title="Vector spaces",
                        summary="Vectors before bases",
                        start_seconds=0,
                        end_seconds=600,
                    ),
                ),
            )
        ),
        agent=StaticConceptGraphAgent(
            ConceptGraphProposal(
                concepts=(
                    ConceptProposal(
                        key="vectors",
                        name="Vectors",
                        description="Vector basics",
                        topic_ids=(topic_id,),
                        evidence="Vector section",
                        confidence=0.9,
                    ),
                    ConceptProposal(
                        key="bases",
                        name="Bases",
                        description="Basis basics",
                        topic_ids=(topic_id,),
                        evidence="Basis section",
                        confidence=0.9,
                    ),
                ),
                edges=(
                    EdgeProposal(
                        from_key="vectors",
                        to_key="bases",
                        rationale="Vectors before bases",
                        evidence="Order",
                        confidence=0.9,
                    ),
                ),
            )
        ),
    )
    app.dependency_overrides[get_concept_graph_service] = lambda: service
    client = TestClient(app)

    try:
        generated = client.post(f"/courses/{course_id}/graph/generate")
        assert generated.status_code == 200
        graph = generated.json()
        assert len(graph["concepts"]) == 2
        assert len(graph["edges"]) == 1
        first_concept_id = graph["concepts"][0]["id"]
        second_concept_id = graph["concepts"][1]["id"]
        edge_id = graph["edges"][0]["id"]

        edit_response = client.patch(
            f"/courses/graph/concepts/{first_concept_id}",
            json={"name": "Instructor vectors", "description": "Edited concept"},
        )
        assert edit_response.status_code == 200
        assert edit_response.json()["review_status"] == "edited"
        assert edit_response.json()["ai_proposal"]["name"] == "Vectors"

        accept_edge = client.post(f"/courses/graph/edges/{edge_id}/accept")
        assert accept_edge.status_code == 200
        assert accept_edge.json()["review_status"] == "accepted"

        merge_response = client.post(
            "/courses/graph/concepts/merge",
            json={
                "source_concept_id": first_concept_id,
                "target_concept_id": second_concept_id,
            },
        )
        assert merge_response.status_code == 200
        assert merge_response.json()["review_status"] == "dismissed"
        assert merge_response.json()["merged_into_concept_id"] == second_concept_id

        dismiss_edge = client.post(f"/courses/graph/edges/{edge_id}/dismiss")
        assert dismiss_edge.status_code == 200
        assert dismiss_edge.json()["review_status"] == "dismissed"
    finally:
        app.dependency_overrides.clear()
