import { describe, expect, it } from "vitest";

import { nextProductionAction } from "../app/productionGuidance";

describe("production guidance", () => {
  it("routes a question blocker to assessment review", () => {
    expect(nextProductionAction(
      [{ label: "Publish", state: "active" }],
      ["Every reviewed topic needs an approved question."],
      "draft",
    )).toEqual({
      label: "Open assessments",
      reason: "Every reviewed topic needs an approved question.",
      target: "assessments",
    });
  });

  it("guides the instructor to the active checkpoint", () => {
    expect(nextProductionAction(
      [
        { label: "Source", state: "complete" },
        { label: "Graph", state: "active" },
      ],
      [],
      "draft",
    )?.target).toBe("concept-graph");
  });

  it("stops recommending work after publication", () => {
    expect(nextProductionAction([], [], "published")).toBeNull();
  });
});
