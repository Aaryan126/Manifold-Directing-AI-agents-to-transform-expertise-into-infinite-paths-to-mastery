export type DashboardSignal = {
  id: string;
  status: "open" | "accepted" | "edited" | "dismissed" | string;
  ai_diagnosis: Record<string, unknown>;
};

export type DashboardSummary = {
  learner_count: number;
  attempt_count: number;
  not_enough_data: boolean;
  signals: DashboardSignal[];
};

export function dashboardColdStartMessage(summary: DashboardSummary | null): string | null {
  if (!summary?.not_enough_data) return null;
  return "Not enough learner data yet. Signals will appear after learners attempt reviewed questions.";
}

export function dashboardActionScopeLabel(retroactive: boolean): string {
  return retroactive
    ? "Reprocess in-progress learners after applying this change."
    : "Apply this change going forward only.";
}

export function dashboardSignalTitle(signal: DashboardSignal): string {
  const title = signal.ai_diagnosis.title;
  return typeof title === "string" && title.trim() ? title : "Dashboard signal";
}

export function dashboardSignalSummary(signal: DashboardSignal): string {
  const summary = signal.ai_diagnosis.summary;
  return typeof summary === "string" && summary.trim()
    ? summary
    : "Review the related course entity.";
}

export function dashboardSignalRecommendedAction(signal: DashboardSignal): string {
  const action = signal.ai_diagnosis.recommended_action;
  return typeof action === "string" && action.trim()
    ? action
    : "Review and decide whether to apply a course correction.";
}
