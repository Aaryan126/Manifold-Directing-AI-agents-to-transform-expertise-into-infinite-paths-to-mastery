import { describe, expect, it } from "vitest";
import { acceptButtonDisabled, acceptButtonLabel } from "../app/reviewState";

describe("reviewState", () => {
  it("keeps proposed items actionable", () => {
    expect(acceptButtonLabel("proposed")).toBe("Accept AI suggestion");
    expect(acceptButtonDisabled("proposed")).toBe(false);
  });

  it("shows reviewed states as completed actions", () => {
    expect(acceptButtonLabel("accepted")).toBe("Accepted");
    expect(acceptButtonDisabled("accepted")).toBe(true);
    expect(acceptButtonLabel("edited")).toBe("Edited");
    expect(acceptButtonDisabled("edited")).toBe(true);
  });

  it("does not show dismissed items as accept-ready", () => {
    expect(acceptButtonLabel("dismissed")).toBe("Dismissed");
    expect(acceptButtonDisabled("dismissed")).toBe(true);
  });
});
