export type TraceableArtifact = {
  review_status?: string;
  status?: string;
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
};

export function aiRationale(artifact: TraceableArtifact): string | null {
  const proposal = artifact.ai_proposal;
  if (!proposal) return null;
  for (const key of ["evidence", "rationale", "reason", "summary"]) {
    const value = proposal[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function instructorTrace(artifact: TraceableArtifact): string | null {
  const revision = artifact.instructor_revision;
  if (!revision) return null;
  for (const key of ["note", "instructor_note", "rationale", "action"]) {
    const value = revision[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function traceabilityStatus(artifact: TraceableArtifact): string {
  return artifact.review_status ?? artifact.status ?? "unknown";
}
