export type AdvancementMode = "require_mastery" | "allow_partial_understanding";

export type RoutingPolicyDraft = {
  confidence_threshold: number;
  correct_attempts_for_mastery: number;
  advancement_mode: AdvancementMode;
  max_remediation_attempts: number;
};

export type RoutingPolicyProfile = "foundation" | "standard" | "applied";

type PolicyConcept = {
  id: string;
  name: string;
  description?: string | null;
};

type PolicyEdge = {
  from_concept_id: string;
  review_status: "proposed" | "accepted" | "edited" | "dismissed";
};

const profilePolicies: Record<RoutingPolicyProfile, RoutingPolicyDraft> = {
  foundation: {
    confidence_threshold: 4,
    correct_attempts_for_mastery: 2,
    advancement_mode: "require_mastery",
    max_remediation_attempts: 3,
  },
  standard: {
    confidence_threshold: 3,
    correct_attempts_for_mastery: 1,
    advancement_mode: "require_mastery",
    max_remediation_attempts: 2,
  },
  applied: {
    confidence_threshold: 3,
    correct_attempts_for_mastery: 1,
    advancement_mode: "allow_partial_understanding",
    max_remediation_attempts: 2,
  },
};

export const routingPolicyProfileLabels: Record<RoutingPolicyProfile, string> = {
  foundation: "Foundation",
  standard: "Standard",
  applied: "Applied practice",
};

export function defaultRoutingPolicyDraft(): RoutingPolicyDraft {
  return routingPolicyForProfile("standard");
}

export function routingPolicyForProfile(profile: RoutingPolicyProfile): RoutingPolicyDraft {
  return { ...profilePolicies[profile] };
}

export function recommendedRoutingProfile(
  concept: PolicyConcept,
  edges: PolicyEdge[],
): RoutingPolicyProfile {
  const isPrerequisite = edges.some(
    (edge) => edge.from_concept_id === concept.id &&
      (edge.review_status === "accepted" || edge.review_status === "edited"),
  );
  if (isPrerequisite) return "foundation";
  const content = `${concept.name} ${concept.description ?? ""}`.toLowerCase();
  if (/\b(example|demonstrat|practice|apply|application|exercise|case stud)/.test(content)) {
    return "applied";
  }
  return "standard";
}

export function recommendedRoutingPolicy(
  concept: PolicyConcept,
  edges: PolicyEdge[],
): RoutingPolicyDraft {
  return routingPolicyForProfile(recommendedRoutingProfile(concept, edges));
}

export function routingProfileForPolicy(
  policy: RoutingPolicyDraft,
): RoutingPolicyProfile | "custom" {
  const match = (Object.keys(profilePolicies) as RoutingPolicyProfile[]).find((profile) => {
    const candidate = profilePolicies[profile];
    return candidate.confidence_threshold === policy.confidence_threshold &&
      candidate.correct_attempts_for_mastery === policy.correct_attempts_for_mastery &&
      candidate.advancement_mode === policy.advancement_mode &&
      candidate.max_remediation_attempts === policy.max_remediation_attempts;
  });
  return match ?? "custom";
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
