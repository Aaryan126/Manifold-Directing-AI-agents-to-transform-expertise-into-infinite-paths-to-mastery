import { describe, expect, it } from "vitest";

import {
  correctAnswerPayload,
  questionToAssessmentDraft,
  remediationPayload,
} from "../app/assessmentEditor";

describe("assessmentEditor", () => {
  it("presents generated JSON fields as readable editable values", () => {
    const draft = questionToAssessmentDraft({
      body: "What is a vector?",
      type: "mcq",
      correct_answer: { answer: "Magnitude and direction", choices: ["Only magnitude", "Magnitude and direction"] },
      confidence_prompt: "How sure are you?",
      remediation_rules: [{
        wrong_answer_pattern: "Only magnitude",
        target_clip_id: "clip-1",
        target_concept_id: "concept-1",
        ai_proposal: { rationale: "Review the definition." },
        instructor_revision: null,
      }],
    });

    expect(draft.correct_answer).toBe("Magnitude and direction");
    expect(draft.answer_choices).toBe("Only magnitude\nMagnitude and direction");
    expect(draft.remediation_rules[0]?.rationale).toBe("Review the definition.");
  });

  it("reconstructs the existing API payload without exposing JSON editing", () => {
    const draft = questionToAssessmentDraft({
      body: "Question",
      type: "mcq",
      correct_answer: { answer: "Old", source: "ai" },
      confidence_prompt: "Confidence?",
      remediation_rules: [],
    });
    draft.correct_answer = "New";
    draft.answer_choices = "A\n\nB";
    draft.remediation_rules.push({
      wrong_answer_pattern: "A",
      target_clip_id: "clip-2",
      target_concept_id: "",
      rationale: "Revisit the example.",
    });

    expect(correctAnswerPayload({ answer: "Old", source: "ai" }, draft)).toEqual({
      answer: "New",
      choices: ["A", "B"],
      source: "ai",
    });
    expect(remediationPayload(draft)).toEqual([{
      wrong_answer_pattern: "A",
      target_clip_id: "clip-2",
      target_concept_id: null,
      rationale: "Revisit the example.",
    }]);
  });
});
