export type ClipReviewTopic = {
  id?: string;
  review_status: string;
};

export type ClipReviewClip = {
  status: string;
};

export type ClipReviewConcept = {
  review_status: string;
  ai_proposal: Record<string, unknown> | null;
  instructor_revision?: Record<string, unknown> | null;
};

export function isTopicReviewedForClipGeneration(topic: ClipReviewTopic): boolean {
  return topic.review_status === "accepted" || topic.review_status === "edited";
}

export function reviewedConceptCountForTopic(
  topicId: string,
  concepts: ClipReviewConcept[],
): number {
  return concepts.filter(
    (concept) =>
      (concept.review_status === "accepted" || concept.review_status === "edited") &&
      conceptTopicIds(concept).includes(topicId),
  ).length;
}

export function topicClipGenerationBlockReason(
  topic: ClipReviewTopic,
  concepts: ClipReviewConcept[],
): string | null {
  if (!isTopicReviewedForClipGeneration(topic)) {
    return "Accept or edit this topic before generating clips.";
  }
  if (!topic.id) return "Topic id is missing.";
  if (reviewedConceptCountForTopic(topic.id, concepts) === 0) {
    return "Accept or edit at least one graph concept linked to this topic first.";
  }
  return null;
}

export function clipSpotCheckActionsDisabled(clip: ClipReviewClip): boolean {
  return clip.status === "superseded";
}

export function conceptTopicIds(concept: ClipReviewConcept): string[] {
  const revisedTopicIds = concept.instructor_revision?.topic_ids;
  const topicIds = Array.isArray(revisedTopicIds)
    ? revisedTopicIds
    : concept.ai_proposal?.topic_ids;
  return Array.isArray(topicIds)
    ? topicIds.filter((topicId): topicId is string => typeof topicId === "string")
    : [];
}
