import { describe, expect, it } from "vitest";

import { clipForRoute, masterySummary, routeTone } from "../app/learnerExperience";

describe("learnerExperience", () => {
  it("selects an active clip from route targets without using flagged clips", () => {
    const clips = [
      {
        id: "flagged",
        topic_id: "topic-1",
        concept_ids: ["concept-1"],
        status: "flagged",
        start_seconds: 0,
        end_seconds: 10,
      },
      {
        id: "active",
        topic_id: "topic-1",
        concept_ids: ["concept-1"],
        status: "active",
        start_seconds: 10,
        end_seconds: 20,
      },
    ];

    expect(
      clipForRoute(clips, { action: "remediate", target_clip_id: null, target_concept_id: "concept-1" }, null)?.id,
    ).toBe("active");
    expect(
      clipForRoute(clips, { action: "remediate", target_clip_id: "flagged", target_concept_id: null }, null),
    ).toBeNull();
  });

  it("summarizes mastery and classifies route tone", () => {
    expect(
      masterySummary([
        { concept_id: "a", name: "A", state: "mastered", topic_id: "topic-1" },
        { concept_id: "b", name: "B", state: "practiced", topic_id: "topic-2" },
      ]),
    ).toBe("1 of 2 concept(s) mastered");
    expect(routeTone("advance")).toBe("advance");
    expect(routeTone("remediate")).toBe("support");
    expect(routeTone("flag_instructor")).toBe("attention");
  });
});
