import { describe, expect, it } from "vitest";

import {
  defaultRoutingPolicyDraft,
  policyLabel,
  recommendedRoutingProfile,
  routingPolicyForProfile,
  routingProfileForPolicy,
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

  it("recommends stricter foundations and flexible applied concepts", () => {
    const foundation = { id: "foundation", name: "Core rule", description: null };
    const applied = { id: "applied", name: "Worked example", description: "Apply the rule." };
    const edges = [{
      from_concept_id: "foundation",
      review_status: "accepted" as const,
    }];

    expect(recommendedRoutingProfile(foundation, edges)).toBe("foundation");
    expect(recommendedRoutingProfile(applied, edges)).toBe("applied");
    expect(routingProfileForPolicy(routingPolicyForProfile("applied"))).toBe("applied");
  });
});
