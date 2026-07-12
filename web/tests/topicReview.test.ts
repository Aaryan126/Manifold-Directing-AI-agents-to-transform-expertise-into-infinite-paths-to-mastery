import { describe, expect, it } from "vitest";
import { graphGenerationBlockedReason, reviewedTopicCount } from "../app/topicReview";

describe("topicReview", () => {
  it("blocks graph generation when all topics are still proposed", () => {
    const topics = [{ review_status: "proposed" }, { review_status: "proposed" }];

    expect(reviewedTopicCount(topics)).toBe(0);
    expect(graphGenerationBlockedReason(topics)).toBe(
      "Accept or edit at least one topic before creating the concept graph.",
    );
  });

  it("allows graph generation once a topic is accepted or edited", () => {
    expect(
      graphGenerationBlockedReason([
        { review_status: "proposed" },
        { review_status: "edited" },
      ]),
    ).toBeNull();
  });
});
