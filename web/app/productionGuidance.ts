export type ProductionStepState = "complete" | "active" | "pending";

export type ProductionStep = {
  label: string;
  state: ProductionStepState;
};

export type ProductionAction = {
  label: string;
  reason: string;
  target: string;
};

const stepTargets: Record<string, string> = {
  Source: "course-setup",
  Outline: "outline",
  Graph: "concept-graph",
  Clips: "clips",
  Assessments: "assessments",
  Routing: "routing",
  Publish: "course-overview",
};

export function nextProductionAction(
  steps: ProductionStep[],
  blockers: string[],
  courseStatus: "draft" | "published" | undefined,
): ProductionAction | null {
  if (courseStatus === "published") return null;

  const activeStep = steps.find((step) => step.state === "active");
  const blocker = blockers[0];
  const target = blocker
    ? targetForBlocker(blocker)
    : stepTargets[activeStep?.label ?? "Source"] ?? "course-setup";
  const label = activeStep?.label === "Publish" && blockers.length === 0
    ? "Publish course"
    : `Open ${labelForTarget(target)}`;

  return {
    label,
    reason: blocker ?? reasonForStep(activeStep?.label ?? "Source"),
    target,
  };
}

function targetForBlocker(blocker: string): string {
  const normalized = blocker.toLowerCase();
  if (normalized.includes("question")) return "assessments";
  if (normalized.includes("clip")) return "clips";
  if (
    normalized.includes("concept") ||
    normalized.includes("edge") ||
    normalized.includes("graph")
  ) return "concept-graph";
  if (normalized.includes("topic") || normalized.includes("outline")) return "outline";
  if (normalized.includes("routing") || normalized.includes("policy")) return "routing";
  return "course-setup";
}

function labelForTarget(target: string): string {
  return {
    "course-setup": "source setup",
    outline: "outline review",
    "concept-graph": "concept graph",
    clips: "clip review",
    assessments: "assessments",
    routing: "routing policy",
    "course-overview": "publish controls",
  }[target] ?? "next step";
}

function reasonForStep(label: string): string {
  return {
    Source: "Add a lecture or load the prepared demo to begin course production.",
    Outline: "Review the proposed topic boundaries before concept generation.",
    Graph: "Review concepts and prerequisites before generating learner content.",
    Clips: "Generate and spot-check independent clips for reviewed topics.",
    Assessments: "Generate and approve a comprehension check for every reviewed topic.",
    Routing: "Confirm how mastery, confidence, and remediation should affect each concept.",
    Publish: "All required checkpoints are ready for final publication.",
  }[label] ?? "Continue the next required production checkpoint.";
}
