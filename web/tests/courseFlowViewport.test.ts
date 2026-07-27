import { describe, expect, it } from "vitest";

import { courseFlowViewportPolicy } from "../app/courseFlowViewport";

describe("Course Flow viewport policy", () => {
  it("opens a single course unit in a close readable view", () => {
    expect(courseFlowViewportPolicy(1)).toEqual({
      density: "close",
      maxZoom: 1.3,
      padding: 0.2,
    });
  });

  it("uses a comfortable standard view for two to four units", () => {
    expect(courseFlowViewportPolicy(2).density).toBe("standard");
    expect(courseFlowViewportPolicy(4).maxZoom).toBe(1.05);
  });

  it("opens five or more units in overview scale", () => {
    expect(courseFlowViewportPolicy(5)).toEqual({
      density: "overview",
      maxZoom: 0.82,
      padding: 0.2,
    });
    expect(courseFlowViewportPolicy(12).density).toBe("overview");
  });
});
