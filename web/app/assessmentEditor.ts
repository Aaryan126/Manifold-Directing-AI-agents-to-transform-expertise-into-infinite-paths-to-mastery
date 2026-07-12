export type RemediationEditorDraft = {
  wrong_answer_pattern: string;
  target_clip_id: string;
  target_concept_id: string;
  rationale: string;
};

export type AssessmentEditorDraft = {
  body: string;
  type: "mcq" | "short_answer" | "worked_problem";
  correct_answer: string;
  answer_choices: string;
  confidence_prompt: string;
  remediation_rules: RemediationEditorDraft[];
};

type EditableQuestion = {
  body: string;
  type: AssessmentEditorDraft["type"];
  correct_answer: Record<string, unknown>;
  confidence_prompt: string;
  remediation_rules: Array<{
    wrong_answer_pattern: string;
    target_clip_id: string | null;
    target_concept_id: string | null;
    ai_proposal: Record<string, unknown> | null;
    instructor_revision: Record<string, unknown> | null;
  }>;
};

export function questionToAssessmentDraft(question: EditableQuestion): AssessmentEditorDraft {
  const answer = question.correct_answer.answer;
  const choices = question.correct_answer.choices;
  return {
    body: question.body,
    type: question.type,
    correct_answer: typeof answer === "string" ? answer : answer == null ? "" : String(answer),
    answer_choices: Array.isArray(choices)
      ? choices.filter((choice): choice is string => typeof choice === "string").join("\n")
      : "",
    confidence_prompt: question.confidence_prompt,
    remediation_rules: question.remediation_rules.map((rule) => ({
      wrong_answer_pattern: rule.wrong_answer_pattern,
      target_clip_id: rule.target_clip_id ?? "",
      target_concept_id: rule.target_concept_id ?? "",
      rationale: String(
        rule.instructor_revision?.rationale ?? rule.ai_proposal?.rationale ?? "",
      ),
    })),
  };
}

export function correctAnswerPayload(
  original: Record<string, unknown>,
  draft: AssessmentEditorDraft,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...original,
    answer: draft.correct_answer.trim(),
  };
  const choices = draft.answer_choices
    .split("\n")
    .map((choice) => choice.trim())
    .filter(Boolean);
  if (choices.length) payload.choices = choices;
  else delete payload.choices;
  return payload;
}

export function remediationPayload(draft: AssessmentEditorDraft) {
  return draft.remediation_rules.map((rule) => ({
    wrong_answer_pattern: rule.wrong_answer_pattern.trim(),
    target_clip_id: rule.target_clip_id || null,
    target_concept_id: rule.target_concept_id || null,
    rationale: rule.rationale.trim(),
  }));
}
