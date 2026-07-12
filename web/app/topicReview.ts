export type ReviewableTopic = {
  review_status: string;
};

export function reviewedTopicCount(topics: ReviewableTopic[]): number {
  return topics.filter((topic) => topic.review_status === "accepted" || topic.review_status === "edited")
    .length;
}

export function graphGenerationBlockedReason(topics: ReviewableTopic[]): string | null {
  if (topics.length === 0) {
    return "Generate and review a topic outline before creating the concept graph.";
  }
  if (reviewedTopicCount(topics) === 0) {
    return "Accept or edit at least one topic before creating the concept graph.";
  }
  return null;
}
