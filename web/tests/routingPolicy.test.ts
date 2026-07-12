import { describe, expect, it } from "vitest";

import {
  defaultRoutingPolicyDraft,
  policyLabel,
  routingPolicyValidationError,
} from "../app/routingPolicy";

describe("routingPolicy", () => {
  it("validates instructor policy ranges", () => {
    expect(routingPolicyValidationError(defaultRoutingPolicyDraft())).toBeNull();
    expect(
      routingPolicyValidationError({
        ...defaultRoutingPolicyDraft(),
        confidence_threshold: 5,
      }),
    ).toMatch(/Confidence/);
    expect(
      routingPolicyValidationError({
        ...defaultRoutingPolicyDraft(),
        max_remediation_attempts: -1,
      }),
    ).toMatch(/non-negative/);
  });

  it("labels the active advancement policy", () => {
    expect(policyLabel(defaultRoutingPolicyDraft())).toContain("requires mastery");
    expect(
      policyLabel({
        ...defaultRoutingPolicyDraft(),
        advancement_mode: "allow_partial_understanding",
      }),
    ).toContain("allows partial");
  });
});
