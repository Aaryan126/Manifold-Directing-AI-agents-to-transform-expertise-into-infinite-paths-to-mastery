import { describe, expect, it } from "vitest";
import { detectCoverageGaps } from "../app/topicCoverage";

describe("detectCoverageGaps", () => {
  it("flags the range left behind when an active topic is dismissed", () => {
    const gaps = detectCoverageGaps(
      [
        {
          id: "first",
          start_seconds: 0,
          end_seconds: 600,
          review_status: "accepted",
        },
        {
          id: "dismissed",
          start_seconds: 600,
          end_seconds: 1200,
          review_status: "dismissed",
        },
        {
          id: "third",
          start_seconds: 1200,
          end_seconds: 1800,
          review_status: "edited",
        },
      ],
      0,
      1800,
    );

    expect(gaps).toEqual([
      {
        start_seconds: 600,
        end_seconds: 1200,
        duration_seconds: 600,
      },
    ]);
  });

  it("does not flag tiny rounding gaps between adjacent active topics", () => {
    const gaps = detectCoverageGaps(
      [
        {
          id: "first",
          start_seconds: 0,
          end_seconds: 600,
          review_status: "proposed",
        },
        {
          id: "second",
          start_seconds: 602,
          end_seconds: 1200,
          review_status: "proposed",
        },
      ],
      0,
      1200,
    );

    expect(gaps).toEqual([]);
  });
});
