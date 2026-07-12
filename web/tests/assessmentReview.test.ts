import { describe, expect, it } from "vitest";

import {
  assessmentGenerationBlockReason,
  learnerAccessBlockedReason,
  reviewedConceptCountForAssessment,
  usableClipCountForAssessment,
} from "../app/assessmentReview";

describe("assessmentReview", () => {
  it("requires reviewed topics, linked concepts, and usable clips before generation", () => {
    const proposedTopic = { id: "topic-1", review_status: "proposed" };
    const acceptedTopic = { id: "topic-1", review_status: "accepted" };
    const concepts = [
      { review_status: "accepted", ai_proposal: { topic_ids: ["topic-1"] } },
      { review_status: "dismissed", ai_proposal: { topic_ids: ["topic-1"] } },
      { review_status: "edited", ai_proposal: { topic_ids: ["topic-2"] } },
    ];
    const clips = [
      { topic_id: "topic-1", status: "superseded" },
      { topic_id: "topic-1", status: "active" },
    ];

    expect(assessmentGenerationBlockReason(proposedTopic, concepts, clips)).toMatch(
      /Accept or edit this topic/,
    );
    expect(reviewedConceptCountForAssessment("topic-1", concepts)).toBe(1);
    expect(usableClipCountForAssessment("topic-1", clips)).toBe(1);
    expect(assessmentGenerationBlockReason(acceptedTopic, concepts, clips)).toBeNull();
    expect(assessmentGenerationBlockReason(acceptedTopic, [], clips)).toMatch(/graph concept/);
    expect(assessmentGenerationBlockReason(acceptedTopic, concepts, [])).toMatch(/clip/);
  });

  it("blocks learner access until a question is accepted or edited", () => {
    expect(
      learnerAccessBlockedReason("topic-1", [
        { topic_id: "topic-1", review_status: "proposed" },
        { topic_id: "topic-2", review_status: "accepted" },
      ]),
    ).toBe("Topic has no accepted or edited assessment question.");
    expect(
      learnerAccessBlockedReason("topic-1", [{ topic_id: "topic-1", review_status: "edited" }]),
    ).toBeNull();
  });
});
