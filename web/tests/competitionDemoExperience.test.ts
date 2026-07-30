import { describe, expect, it } from "vitest";

import {
  openingBlueprintNodeIds,
  pendingBlueprintProposalPreview,
} from "../app/app/courses/[courseId]/course-studio";
import {
  confidenceLabel,
  nextRouteStepLabel,
  railStepTitle,
} from "../app/learn/courses/[courseId]/learner-course-player";
import type {
  LearnerSessionStep,
  LearnerStudySession,
} from "../app/learn/learner-course";

function step(
  overrides: Partial<LearnerSessionStep>,
): LearnerSessionStep {
  return {
    id: "step",
    ordinal: 0,
    kind: "watch",
    purpose: "learn",
    concept_id: "concept",
    concept_name: "Value creation",
    clip_id: "clip",
    question_id: null,
    source_id: null,
    title: "Worked example",
    reason_code: "recommended",
    reason: "Build the idea before checking it.",
    status: "active",
    ...overrides,
  };
}

describe("competition demo experience", () => {
  it("opens a large Blueprint on the first topic neighborhood", () => {
    const nodes = [
      { id: "topic-2", kind: "topic" as const, sequence_rank: 1, title: "Second" },
      { id: "topic-1", kind: "topic" as const, sequence_rank: 0, title: "First" },
      { id: "concept-1", kind: "concept" as const, sequence_rank: 0, title: "Concept" },
      { id: "clip-1", kind: "clip" as const, sequence_rank: 0, title: "Clip" },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `other-${index}`,
        kind: "concept" as const,
        sequence_rank: index + 2,
        title: `Other ${index}`,
      })),
    ];
    expect(openingBlueprintNodeIds(nodes, [
      { source: "topic-1", target: "concept-1", kind: "contains" },
      { source: "concept-1", target: "clip-1", kind: "teaches" },
      { source: "topic-2", target: "other-0", kind: "contains" },
    ])).toEqual(["topic-1", "concept-1", "clip-1"]);
  });

  it("derives the exact pending relationship removal without changing the graph", () => {
    expect(pendingBlueprintProposalPreview([{
      id: "message",
      role: "manifold",
      content: "Prepared one private change.",
      created_at: "2026-07-30T00:00:00Z",
      blocks: [{
        type: "proposal",
        proposal_id: "proposal",
        status: "proposed",
        artifact_type: "blueprint_relationship_remove",
        proposed_state: {
          relationship_type: "contains",
          source_logical_id: "topic-logical",
          target_logical_id: "concept-logical",
          summary: "Remove the concept from Why plan only.",
        },
      }],
    }], {})).toEqual({
      action: "remove",
      kind: "contains",
      sourceLogicalId: "topic-logical",
      targetLogicalId: "concept-logical",
      summary: "Remove the concept from Why plan only.",
    });
  });

  it("removes the preview as soon as the proposal is resolved", () => {
    const messages = [{
      id: "message",
      role: "manifold" as const,
      content: "Prepared one private change.",
      created_at: "2026-07-30T00:00:00Z",
      blocks: [{
        type: "proposal",
        proposal_id: "proposal",
        status: "proposed",
        artifact_type: "blueprint_relationship_remove",
        proposed_state: {
          relationship_type: "contains",
          source_logical_id: "topic-logical",
          target_logical_id: "concept-logical",
        },
      }],
    }];
    expect(pendingBlueprintProposalPreview(messages, { proposal: "dismissed" }))
      .toBeNull();
  });

  it("uses action-specific learner rail titles and identifies the next route step", () => {
    const alternate = step({
      purpose: "remediation",
      title: "A different explanation",
    });
    const recovery = step({
      id: "question",
      ordinal: 1,
      kind: "question",
      purpose: "remediation",
      title: "Apply the distinction",
      clip_id: null,
      question_id: "question",
      status: "pending",
    });
    expect(railStepTitle(alternate))
      .toBe("Alternate explanation: A different explanation");
    expect(railStepTitle(recovery))
      .toBe("Recovery check: Apply the distinction");
    expect(confidenceLabel(4)).toBe("high confidence");

    const session: LearnerStudySession = {
      id: "session",
      course_id: "course",
      revision_id: "revision",
      status: "active",
      mode: "continue_path",
      finish_requested: false,
      plan_version: 2,
      steps: [
        { ...step({ status: "completed" }) },
        alternate,
        recovery,
      ],
    };
    expect(nextRouteStepLabel(session))
      .toBe("Alternate explanation: A different explanation");
  });
});
