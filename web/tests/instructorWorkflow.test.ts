import { describe, expect, it } from "vitest";

import {
  buildWorkflow,
  topicReadinessLabel,
  topicRepairTarget,
  type WorkflowSnapshot,
} from "../app/instructorWorkflow";

const reviewedSnapshot: WorkflowSnapshot = {
  sourceStatus: "complete",
  topicCount: 3,
  proposedTopics: 0,
  reviewedTopics: 3,
  conceptCount: 5,
  proposedConcepts: 0,
  proposedEdges: 0,
  topicsMissingConcepts: 0,
  topicsMissingClips: 0,
  topicsMissingQuestions: 0,
  proposedQuestions: 0,
  reviewedQuestions: 3,
  reviewedConcepts: 5,
  routingPolicyCount: 5,
  routingTested: true,
  publishBlockers: [],
  publishReady: true,
  published: false,
};

describe("instructor workflow", () => {
  it("blocks downstream stages and focuses source when no lecture exists", () => {
    const result = buildWorkflow({
      ...reviewedSnapshot,
      sourceStatus: "missing",
      topicCount: 0,
      reviewedTopics: 0,
      conceptCount: 0,
      reviewedConcepts: 0,
      reviewedQuestions: 0,
      routingPolicyCount: 0,
      routingTested: false,
      publishReady: false,
      publishBlockers: ["A completed video is required."],
    });

    expect(result.recommendedStage).toBe("source");
    expect(result.tasks[0]).toMatchObject({ id: "add-source", target: "course-setup" });
    expect(result.stages.find((stage) => stage.id === "structure")?.state).toBe("blocked");
  });

  it("turns graph and assessment proposals into focused review tasks", () => {
    const result = buildWorkflow({
      ...reviewedSnapshot,
      proposedConcepts: 2,
      proposedEdges: 3,
      proposedQuestions: 2,
      reviewedQuestions: 1,
      publishReady: false,
    });

    expect(result.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-graph", count: 5, target: "concept-graph" }),
      expect.objectContaining({ id: "review-questions", count: 2, target: "assessments" }),
    ]));
    expect(result.recommendedStage).toBe("structure");
  });

  it("moves to final publication only after routing has been tested", () => {
    const beforeTest = buildWorkflow({ ...reviewedSnapshot, routingTested: false });
    expect(beforeTest.recommendedStage).toBe("adapt");
    expect(beforeTest.tasks.some((task) => task.id === "test-routing")).toBe(true);

    const ready = buildWorkflow(reviewedSnapshot);
    expect(ready.recommendedStage).toBe("publish");
    expect(ready.tasks).toContainEqual(expect.objectContaining({ id: "publish-course" }));
  });

  it("routes a topic to its first local repair point", () => {
    const topic = {
      id: "topic-1",
      title: "Foundations",
      reviewStatus: "accepted" as const,
      reviewedConcepts: 1,
      clips: 1,
      approvedQuestions: 0,
      proposedQuestions: 1,
    };

    expect(topicReadinessLabel(topic)).toBe("Review question");
    expect(topicRepairTarget(topic)).toEqual({ stage: "learning", target: "assessments" });
  });
});
