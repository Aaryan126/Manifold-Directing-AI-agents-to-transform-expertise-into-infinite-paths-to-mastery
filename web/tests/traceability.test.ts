import { describe, expect, it } from "vitest";

import { aiRationale, instructorTrace, traceabilityStatus } from "../app/traceability";

describe("traceability", () => {
  it("extracts AI rationale from standard proposal fields", () => {
    expect(
      aiRationale({
        ai_proposal: { evidence: "Transcript evidence." },
        instructor_revision: null,
      }),
    ).toBe("Transcript evidence.");
  });

  it("extracts instructor trace from standard revision fields", () => {
    expect(
      instructorTrace({
        ai_proposal: null,
        instructor_revision: { instructor_note: "Reviewed manually." },
      }),
    ).toBe("Reviewed manually.");
  });

  it("normalizes review or operational status", () => {
    expect(
      traceabilityStatus({
        review_status: "accepted",
        ai_proposal: null,
        instructor_revision: null,
      }),
    ).toBe("accepted");
    expect(
      traceabilityStatus({
        status: "flagged",
        ai_proposal: null,
        instructor_revision: null,
      }),
    ).toBe("flagged");
  });
});
