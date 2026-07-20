import { describe, expect, it } from "vitest";
import {
  clipSpotCheckActionsDisabled,
  reviewedConceptCountForTopic,
  isTopicReviewedForClipGeneration,
  topicClipGenerationBlockReason,
  topicsReadyForAutomaticClipGeneration,
} from "../app/clipReview";

describe("clipReview", () => {
  it("allows clip generation only for reviewed topics", () => {
    expect(isTopicReviewedForClipGeneration({ review_status: "accepted" })).toBe(true);
    expect(isTopicReviewedForClipGeneration({ review_status: "edited" })).toBe(true);
    expect(isTopicReviewedForClipGeneration({ review_status: "proposed" })).toBe(false);
    expect(isTopicReviewedForClipGeneration({ review_status: "dismissed" })).toBe(false);
  });

  it("requires at least one reviewed linked concept before clip generation", () => {
    const topic = { id: "topic-1", review_status: "accepted" };
    const concepts = [
      { review_status: "proposed", ai_proposal: { topic_ids: ["topic-1"] } },
      { review_status: "accepted", ai_proposal: { topic_ids: ["topic-2"] } },
      { review_status: "edited", ai_proposal: { topic_ids: ["topic-1"] } },
    ];

    expect(reviewedConceptCountForTopic("topic-1", concepts)).toBe(1);
    expect(topicClipGenerationBlockReason(topic, concepts)).toBeNull();
    expect(topicClipGenerationBlockReason(topic, concepts.slice(0, 2))).toMatch(
      /graph concept/,
    );
  });

  it("prevents additional spot-check actions on superseded clips", () => {
    expect(clipSpotCheckActionsDisabled({ status: "active" })).toBe(false);
    expect(clipSpotCheckActionsDisabled({ status: "flagged" })).toBe(false);
    expect(clipSpotCheckActionsDisabled({ status: "superseded" })).toBe(true);
  });

  it("uses instructor-repaired topic links over the original AI links", () => {
    const concepts = [{
      review_status: "edited",
      ai_proposal: { topic_ids: ["topic-1"] },
      instructor_revision: { topic_ids: ["topic-2"] },
    }];

    expect(reviewedConceptCountForTopic("topic-1", concepts)).toBe(0);
    expect(reviewedConceptCountForTopic("topic-2", concepts)).toBe(1);
  });

  it("automatically prepares clips only for reviewed, uncovered topics", () => {
    const topics = [
      { id: "topic-1", review_status: "accepted" },
      { id: "topic-2", review_status: "edited" },
      { id: "topic-3", review_status: "proposed" },
    ];
    const concepts = [
      { review_status: "accepted", ai_proposal: { topic_ids: ["topic-1", "topic-2"] } },
    ];

    expect(topicsReadyForAutomaticClipGeneration(topics, concepts, [
      { topic_id: "topic-1", status: "active" },
      { topic_id: "topic-2", status: "superseded" },
    ])).toEqual(["topic-2"]);
  });

  it("replaces a flagged-only clip because learners require an active clip", () => {
    const topics = [{ id: "topic-1", review_status: "edited" }];
    const concepts = [
      { review_status: "accepted", ai_proposal: { topic_ids: ["topic-1"] } },
    ];

    expect(topicsReadyForAutomaticClipGeneration(topics, concepts, [
      { topic_id: "topic-1", status: "flagged" },
    ])).toEqual(["topic-1"]);
  });
});
