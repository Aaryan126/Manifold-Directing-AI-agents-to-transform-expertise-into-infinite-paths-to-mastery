import { describe, expect, it } from "vitest";
import { graphEdgeModels, graphNodeModels } from "../app/graphModel";

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
});
