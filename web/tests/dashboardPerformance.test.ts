import { describe, expect, it } from "vitest";

import {
  percentage,
  rankedClipPerformance,
  rankedConceptPerformance,
  rankedQuestionPerformance,
} from "../app/dashboardPerformance";

describe("dashboard performance presentation", () => {
  it("formats safe whole-number percentages", () => {
    expect(percentage(2, 5)).toBe(40);
    expect(percentage(2, 0)).toBe(0);
  });

  it("prioritizes concepts by struggling rate", () => {
    const ranked = rankedConceptPerformance([
      {
        concept_id: "steady",
        concept_name: "Steady",
        touched_learners: 10,
        struggling_learners: 2,
        mastered_prerequisite_struggling_learners: 0,
      },
      {
        concept_id: "blocked",
        concept_name: "Blocked",
        touched_learners: 4,
        struggling_learners: 3,
        mastered_prerequisite_struggling_learners: 1,
      },
    ]);

    expect(ranked.map((item) => item.concept_id)).toEqual(["blocked", "steady"]);
  });

  it("hides content rows without learner evidence", () => {
    expect(rankedQuestionPerformance([
      {
        question_id: "question",
        topic_id: "topic",
        prompt: "Prompt",
        attempts: 0,
        incorrect_attempts: 0,
        low_confidence_correct_attempts: 0,
      },
    ])).toEqual([]);
    expect(rankedClipPerformance([
      {
        clip_id: "clip",
        concept_id: "concept",
        topic_id: "topic",
        remediation_attempts: 0,
        struggling_learners: 0,
      },
    ])).toEqual([]);
  });
});
