import { describe, expect, it } from "vitest";

import {
  blueprintEdgeRevealProgress,
  blueprintMotionTotalDuration,
  blueprintNodeMotionDuration,
  blueprintNodeMotionProgress,
  createBlueprintNodeMotionPlan,
} from "../app/blueprint-motion";

const nodes = [
  { id: "source", layer: 0, logicalId: "source-logical", position: { x: 10, y: 20 } },
  { id: "topic", layer: 1, logicalId: "topic-logical", position: { x: 30, y: 80 } },
  { id: "concept", layer: 2, logicalId: "concept-logical", position: { x: 60, y: 160 } },
  { id: "clip", layer: 3, logicalId: "clip-logical", position: { x: 90, y: 240 } },
];

describe("Blueprint node motion", () => {
  it("introduces semantic layers in order from above their final positions", () => {
    const plans = createBlueprintNodeMotionPlan(nodes, new Map());

    expect(plans.map((plan) => plan.delay)).toEqual([0, 36, 72, 108]);
    plans.forEach((plan) => {
      expect(plan.entering).toBe(true);
      expect(plan.from.y).toBeLessThan(plan.position.y);
    });
  });

  it("moves matching logical artifacts from their previous layout", () => {
    const previous = new Map([
      ["concept-logical", { x: 300, y: 400 }],
    ]);
    const plan = createBlueprintNodeMotionPlan(nodes, previous)
      .find((item) => item.logicalId === "concept-logical");

    expect(plan).toMatchObject({
      entering: false,
      from: { x: 300, y: 400 },
      position: { x: 60, y: 160 },
    });
  });

  it("reveals edges after node motion is underway and completes them together", () => {
    const plans = createBlueprintNodeMotionPlan(nodes, new Map());
    const total = blueprintMotionTotalDuration(plans);

    expect(blueprintNodeMotionProgress(0, plans[0].delay)).toBe(0);
    expect(blueprintNodeMotionProgress(
      plans[0].delay + blueprintNodeMotionDuration,
      plans[0].delay,
    )).toBe(1);
    expect(blueprintEdgeRevealProgress(total * 0.4, total)).toBe(0);
    expect(blueprintEdgeRevealProgress(total, total)).toBe(1);
  });
});
