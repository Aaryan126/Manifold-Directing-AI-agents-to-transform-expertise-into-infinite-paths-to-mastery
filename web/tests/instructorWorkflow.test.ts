import { describe, expect, it } from "vitest";

import {
  buildWorkflow,
  topicProductionLabel,
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

  it("keeps routing confirmation inside the publish stage", () => {
    const beforeConfirmation = buildWorkflow({ ...reviewedSnapshot, routingPolicyCount: 2 });
    expect(beforeConfirmation.recommendedStage).toBe("publish");
    expect(beforeConfirmation.tasks).toContainEqual(expect.objectContaining({
      id: "configure-routing",
      stage: "publish",
      target: "routing-settings",
      count: 3,
    }));

    const ready = buildWorkflow(reviewedSnapshot);
    expect(ready.recommendedStage).toBe("publish");
    expect(ready.tasks).toContainEqual(expect.objectContaining({ id: "publish-course" }));
  });

  it("keeps missing or stale clips in Structure before opening Assessments", () => {
    const result = buildWorkflow({
      ...reviewedSnapshot,
      topicsMissingClips: 1,
      topicsMissingQuestions: 1,
      reviewedQuestions: 0,
      publishReady: false,
    });

    expect(result.recommendedStage).toBe("structure");
    expect(result.tasks).toContainEqual(expect.objectContaining({
      id: "prepare-clips",
      stage: "structure",
      target: "outline",
    }));
    expect(result.stages.find((stage) => stage.id === "assessments")?.state).toBe("blocked");
  });

  it("routes a topic to its first local repair point", () => {
    const topic = {
      id: "topic-1",
      title: "Foundations",
      reviewStatus: "accepted" as const,
      reviewedConcepts: 1,
      clips: 1,
      staleClips: 0,
      flaggedClips: 0,
      approvedQuestions: 0,
      proposedQuestions: 1,
    };

    expect(topicReadinessLabel(topic)).toBe("Review question");
    expect(topicProductionLabel(topic)).toBe("Ready");
    expect(topicRepairTarget(topic)).toEqual({ stage: "assessments", target: "assessments" });

    expect(topicProductionLabel({
      ...topic,
      clips: 0,
      staleClips: 2,
    })).toBe("Refreshing clips");

    expect(topicProductionLabel({
      ...topic,
      reviewedConcepts: 0,
      clips: 0,
    })).toBe("Connect concept");

    expect(topicProductionLabel({
      ...topic,
      clips: 1,
      flaggedClips: 1,
    })).toBe("Ready");

    expect(topicProductionLabel({
      ...topic,
      clips: 0,
      flaggedClips: 1,
    })).toBe("Preparing clips");
  });
});
