export type AdvancementMode = "require_mastery" | "allow_partial_understanding";

export type RoutingPolicyDraft = {
  confidence_threshold: number;
  correct_attempts_for_mastery: number;
  advancement_mode: AdvancementMode;
  max_remediation_attempts: number;
};

export function defaultRoutingPolicyDraft(): RoutingPolicyDraft {
  return {
    confidence_threshold: 3,
    correct_attempts_for_mastery: 1,
    advancement_mode: "require_mastery",
    max_remediation_attempts: 2,
  };
}

export function routingPolicyValidationError(policy: RoutingPolicyDraft): string | null {
  if (policy.confidence_threshold < 1 || policy.confidence_threshold > 4) {
    return "Confidence threshold must be between 1 and 4.";
  }
  if (policy.correct_attempts_for_mastery < 1) {
    return "Correct attempts for mastery must be at least 1.";
  }
  if (policy.max_remediation_attempts < 0) {
    return "Max remediation attempts must be non-negative.";
  }
  return null;
}

export function policyLabel(policy: RoutingPolicyDraft): string {
  const mode =
    policy.advancement_mode === "require_mastery"
      ? "requires mastery"
      : "allows partial understanding";
  return `${mode}, confidence ${policy.confidence_threshold}+, ${policy.correct_attempts_for_mastery} correct attempt(s), ${policy.max_remediation_attempts} remediation attempt(s)`;
}
