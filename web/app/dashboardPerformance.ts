export type ConceptPerformance = {
  concept_id: string;
  concept_name: string;
  touched_learners: number;
  struggling_learners: number;
  mastered_prerequisite_struggling_learners: number;
};

export type QuestionPerformance = {
  question_id: string;
  topic_id: string;
  prompt: string;
  attempts: number;
  incorrect_attempts: number;
  low_confidence_correct_attempts: number;
};

export type ClipPerformance = {
  clip_id: string;
  concept_id: string;
  topic_id: string;
  remediation_attempts: number;
  struggling_learners: number;
};

export type AnswerOutcomeSummary = {
  attempts: number;
  confident_correct: number;
  unsure_correct: number;
  incorrect: number;
};

export function answerOutcomeSummary(items: QuestionPerformance[]): AnswerOutcomeSummary {
  const attempts = items.reduce((total, item) => total + item.attempts, 0);
  const incorrect = items.reduce((total, item) => total + item.incorrect_attempts, 0);
  const unsureCorrect = items.reduce(
    (total, item) => total + item.low_confidence_correct_attempts,
    0,
  );
  return {
    attempts,
    confident_correct: Math.max(0, attempts - incorrect - unsureCorrect),
    unsure_correct: unsureCorrect,
    incorrect,
  };
}

export function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.max(0, part) / total) * 100);
}

export function rankedConceptPerformance(
  items: ConceptPerformance[],
  limit = 5,
): ConceptPerformance[] {
  return [...items]
    .sort((left, right) => {
      const rateDifference =
        percentage(right.struggling_learners, right.touched_learners) -
        percentage(left.struggling_learners, left.touched_learners);
      return rateDifference || right.touched_learners - left.touched_learners;
    })
    .slice(0, limit);
}

export function rankedQuestionPerformance(
  items: QuestionPerformance[],
  limit = 5,
): QuestionPerformance[] {
  return [...items]
    .filter((item) => item.attempts > 0)
    .sort((left, right) => {
      const attemptDifference = right.attempts - left.attempts;
      return attemptDifference ||
        percentage(right.incorrect_attempts, right.attempts) -
          percentage(left.incorrect_attempts, left.attempts);
    })
    .slice(0, limit);
}

export function rankedClipPerformance(
  items: ClipPerformance[],
  limit = 5,
): ClipPerformance[] {
  return [...items]
    .filter(
      (item) => item.remediation_attempts > 0 || item.struggling_learners > 0,
    )
    .sort(
      (left, right) =>
        right.remediation_attempts + right.struggling_learners -
        (left.remediation_attempts + left.struggling_learners),
    )
    .slice(0, limit);
}
