import { describe, expect, it } from "vitest";

import {
  dashboardActionScopeLabel,
  dashboardColdStartMessage,
  dashboardSignalRecommendedAction,
  dashboardSignalSummary,
  dashboardSignalTitle,
} from "../app/dashboardReview";

describe("dashboardReview", () => {
  it("shows a cold-start message only when the API marks not enough data", () => {
    expect(
      dashboardColdStartMessage({
        learner_count: 0,
        attempt_count: 0,
        not_enough_data: true,
        signals: [],
      }),
    ).toContain("Not enough learner data");
    expect(
      dashboardColdStartMessage({
        learner_count: 1,
        attempt_count: 1,
        not_enough_data: false,
        signals: [],
      }),
    ).toBeNull();
  });

  it("labels going-forward and retroactive action scope unambiguously", () => {
    expect(dashboardActionScopeLabel(false)).toContain("going forward");
    expect(dashboardActionScopeLabel(true)).toContain("Reprocess in-progress learners");
  });

  it("falls back when signal diagnosis fields are absent", () => {
    const signal = { id: "1", status: "open", ai_diagnosis: {} };

    expect(dashboardSignalTitle(signal)).toBe("Dashboard signal");
    expect(dashboardSignalSummary(signal)).toContain("Review");
    expect(dashboardSignalRecommendedAction(signal)).toContain("course correction");
  });
});
