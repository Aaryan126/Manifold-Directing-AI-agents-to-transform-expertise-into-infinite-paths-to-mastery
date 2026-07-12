export type AssessmentReviewStatus = "proposed" | "accepted" | "edited" | "dismissed" | string;

export type AssessmentReviewTopic = {
  id?: string;
  review_status: AssessmentReviewStatus;
};

export type AssessmentReviewConcept = {
  review_status: AssessmentReviewStatus;
  ai_proposal: Record<string, unknown> | null;
};

export type AssessmentReviewClip = {
  topic_id: string;
  status: string;
};

export type AssessmentReviewQuestion = {
  topic_id: string;
  review_status: AssessmentReviewStatus;
};

export function reviewedConceptCountForAssessment(
  topicId: string,
  concepts: AssessmentReviewConcept[],
): number {
  return concepts.filter(
    (concept) =>
      isReviewed(concept.review_status) && conceptTopicIds(concept).includes(topicId),
  ).length;
}

export function usableClipCountForAssessment(
  topicId: string,
  clips: AssessmentReviewClip[],
): number {
  return clips.filter(
    (clip) => clip.topic_id === topicId && (clip.status === "active" || clip.status === "flagged"),
  ).length;
}

export function assessmentGenerationBlockReason(
  topic: AssessmentReviewTopic,
  concepts: AssessmentReviewConcept[],
  clips: AssessmentReviewClip[],
): string | null {
  if (!isReviewed(topic.review_status)) {
    return "Accept or edit this topic before generating an assessment.";
  }
  if (!topic.id) return "Topic id is missing.";
  if (reviewedConceptCountForAssessment(topic.id, concepts) === 0) {
    return "Accept or edit at least one graph concept linked to this topic first.";
  }
  if (usableClipCountForAssessment(topic.id, clips) === 0) {
    return "Generate at least one active or flagged reviewed clip for this topic first.";
  }
  return null;
}

export function learnerAccessBlockedReason(
  topicId: string,
  questions: AssessmentReviewQuestion[],
): string | null {
  const approved = questions.some(
    (question) => question.topic_id === topicId && isReviewed(question.review_status),
  );
  return approved ? null : "Topic has no accepted or edited assessment question.";
}

function isReviewed(status: AssessmentReviewStatus) {
  return status === "accepted" || status === "edited";
}

function conceptTopicIds(concept: AssessmentReviewConcept): string[] {
  const topicIds = concept.ai_proposal?.topic_ids;
  return Array.isArray(topicIds)
    ? topicIds.filter((topicId): topicId is string => typeof topicId === "string")
    : [];
}
