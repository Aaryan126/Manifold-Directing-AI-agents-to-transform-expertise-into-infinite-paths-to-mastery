import { describe, expect, it } from "vitest";
import {
  clipDisplayTitle,
  clipDurationLabel,
  sourceRangeLabel,
  topicClipDurationLabel,
  type PresentableClip,
} from "../app/clipPresentation";

const clip: PresentableClip = {
  topic_id: "topic-1",
  start_seconds: 189.12,
  end_seconds: 430.08,
  type: "misconception_correction",
  status: "active",
  ai_proposal: { title: "Why the rule is misleading" },
};

describe("clip presentation", () => {
  it("uses clip-relative title and duration for primary UI", () => {
    expect(clipDisplayTitle(clip)).toBe("Why the rule is misleading");
    expect(clipDurationLabel(clip)).toBe("4m 1s");
  });

  it("keeps the source range available as instructor provenance", () => {
    expect(sourceRangeLabel(clip)).toBe("3:09–7:10 in original recording");
  });

  it("summarizes active playable time for the learner outline", () => {
    expect(topicClipDurationLabel([clip], "topic-1")).toBe("~4 min");
    expect(topicClipDurationLabel([clip], "topic-2")).toBe("Clip unavailable");
  });

  it("falls back to a readable type-based title", () => {
    expect(clipDisplayTitle({ ...clip, ai_proposal: null })).toBe(
      "Misconception Correction clip",
    );
  });
});
