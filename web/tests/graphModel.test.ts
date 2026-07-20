import { describe, expect, it } from "vitest";
import { focusedConceptIds, graphEdgeModels, graphNodeModels } from "../app/graphModel";

describe("graphModel", () => {
  it("keeps dismissed concepts visible but muted", () => {
    expect(
      graphNodeModels([
        {
          id: "concept-1",
          name: "Vectors",
          description: "Basics",
          review_status: "dismissed",
          ai_proposal: null,
          instructor_revision: null,
          merged_into_concept_id: null,
        },
      ]),
    ).toMatchObject([
      {
        id: "concept-1",
        label: "Vectors",
        muted: true,
        status: "dismissed",
      },
    ]);
  });

  it("keeps dismissed edges visible but muted", () => {
    expect(
      graphEdgeModels([
        {
          id: "edge-1",
          from_concept_id: "a",
          to_concept_id: "b",
          review_status: "dismissed",
          ai_proposal: null,
          instructor_revision: null,
        },
      ]),
    ).toEqual([
      {
        id: "edge-1",
        source: "a",
        target: "b",
        muted: true,
        status: "dismissed",
      },
    ]);
  });

  it("groups concepts into topic-order columns", () => {
    const nodes = graphNodeModels(
      [
        concept("later", "Later concept", "topic-2"),
        concept("first-b", "First B", "topic-1"),
        concept("first-a", "First A", "topic-1"),
      ],
      [
        { id: "topic-1", title: "Foundations" },
        { id: "topic-2", title: "Application" },
      ],
    );

    expect(nodes.find((node) => node.id === "first-a")).toMatchObject({
      x: 0,
      y: 0,
      topicLabel: "Foundations",
    });
    expect(nodes.find((node) => node.id === "first-b")).toMatchObject({
      x: 0,
      y: 150,
      topicLabel: "Foundations",
    });
    expect(nodes.find((node) => node.id === "later")).toMatchObject({
      x: 260,
      y: 0,
      topicLabel: "Application",
    });
  });

  it("focuses a topic with its immediate graph neighbors", () => {
    const concepts = [
      concept("a", "A", "topic-1"),
      concept("b", "B", "topic-2"),
      concept("c", "C", "topic-3"),
    ];
    const focused = focusedConceptIds(
      concepts,
      [
        edge("a-b", "a", "b"),
        edge("b-c", "b", "c"),
      ],
      "topic-1",
    );

    expect([...focused]).toEqual(["a", "b"]);
  });
});

function concept(id: string, name: string, topicId: string) {
  return {
    id,
    name,
    description: "",
    review_status: "accepted" as const,
    ai_proposal: { topic_ids: [topicId] },
    instructor_revision: null,
    merged_into_concept_id: null,
  };
}

function edge(id: string, fromConceptId: string, toConceptId: string) {
  return {
    id,
    from_concept_id: fromConceptId,
    to_concept_id: toConceptId,
    review_status: "accepted" as const,
    ai_proposal: null,
    instructor_revision: null,
  };
}
