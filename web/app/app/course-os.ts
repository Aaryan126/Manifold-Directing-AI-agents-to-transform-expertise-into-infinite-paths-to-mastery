export type DevelopmentIdentity = {
  id: string;
  display_name: string;
  role: "instructor" | "learner";
};

export type CourseSummary = {
  id: string;
  instructor_id: string;
  title: string;
  description: string | null;
  status: "draft" | "published";
  active_revision_id: string | null;
  working_revision_id: string | null;
  revision_status: "building" | "review" | "published" | "superseded" | null;
  generation_run_id: string | null;
  generation_status: "queued" | "running" | "waiting_review" | "complete" | "failed" | "cancelled" | null;
  generation_phase: string | null;
  generation_progress: number;
  source_count: number;
  topic_count: number;
  concept_count: number;
  pending_review_count: number;
  open_signal_count: number;
  updated_at: string;
};

export type AttentionItem = {
  id: string;
  course_id: string;
  kind: "generation_active" | "generation_failed" | "review_ready" | "learner_insight";
  title: string;
  detail: string;
  urgency: "normal" | "high";
};

export type DashboardSnapshot = {
  courses: CourseSummary[];
  attention: AttentionItem[];
  total_courses: number;
  published_courses: number;
  courses_in_review: number;
  active_learners: number;
};

export type GenerationTask = {
  id: string;
  task_type: string;
  scope_key: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  output: Record<string, unknown> | null;
  error_message: string | null;
};

export type GenerationRun = {
  id: string;
  course_id: string;
  revision_id: string;
  status: "queued" | "running" | "waiting_review" | "complete" | "failed" | "cancelled";
  phase: string;
  progress: number;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
  tasks: GenerationTask[];
};

export type CourseMessage = {
  id: string;
  role: "instructor" | "manifold" | "system";
  content: string;
  blocks: Array<Record<string, unknown>>;
  created_at: string;
};

export type ReviewItem = {
  id: string;
  artifact_type: string;
  artifact_id: string;
  logical_artifact_id: string;
  status: "pending" | "accepted" | "edited" | "dismissed";
  risk_level: "normal" | "high";
  evidence: Record<string, unknown>;
};

export type ReviewBundle = {
  id: string;
  kind: "course_structure" | "learner_experience" | "publish_setup";
  title: string;
  summary: string;
  status: "pending" | "in_review" | "complete";
  items: ReviewItem[];
};

export type CourseMap = {
  course_id: string;
  revision_id: string;
  nodes: Array<{
    id: string;
    logical_id: string;
    kind: "topic" | "concept";
    title: string;
    status: string;
    topic_id: string | null;
    metadata: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    logical_id: string;
    source_id: string;
    target_id: string;
    kind: string;
    status: string;
  }>;
};

export type RevisionDiff = {
  active_revision_id: string | null;
  working_revision_id: string;
  changes: Array<{
    artifact_type: string;
    logical_artifact_id: string;
    change_type: "added" | "changed" | "removed";
    before_state: Record<string, unknown> | null;
    after_state: Record<string, unknown> | null;
  }>;
};

export function courseState(course: CourseSummary): {
  label: string;
  tone: "neutral" | "building" | "review" | "live" | "danger";
  action: string;
} {
  if (course.generation_status === "failed") {
    return { label: "Needs help", tone: "danger", action: "Resolve issue" };
  }
  if (course.generation_status === "queued" || course.generation_status === "running") {
    return {
      label: `${Math.round(course.generation_progress)}% built`,
      tone: "building",
      action: "Watch progress",
    };
  }
  if (course.pending_review_count > 0 || course.generation_status === "waiting_review") {
    return { label: "Ready to review", tone: "review", action: "Review course" };
  }
  if (course.status === "published") {
    return { label: "Live", tone: "live", action: "Open workspace" };
  }
  if (course.source_count === 0) {
    return { label: "Waiting for a lecture", tone: "neutral", action: "Add lecture" };
  }
  return { label: "Draft", tone: "neutral", action: "Continue" };
}

export function generationPhaseLabel(phase: string | null): string {
  const labels: Record<string, string> = {
    source_ready: "Understanding your lecture",
    outline: "Shaping the course outline",
    concept_graph: "Mapping concepts and prerequisites",
    clips: "Preparing focused teaching moments",
    assessments: "Designing checks for understanding",
    review_bundles: "Assembling your review",
    review: "Your private draft is ready",
    complete: "Course published",
  };
  return phase ? labels[phase] ?? "Building your course" : "Ready when you are";
}

export function shouldHydrateGenerationRun(course: CourseSummary): boolean {
  return Boolean(
    course.generation_run_id
    && course.generation_status !== "complete"
    && course.generation_status !== "cancelled",
  );
}

export function studioPresentationMode(course: CourseSummary | null): "creation" | "workspace" {
  if (!course) return "creation";
  const ready = course.status === "published"
    || course.pending_review_count > 0
    || course.generation_status === "waiting_review"
    || course.generation_status === "complete"
    || course.revision_status === "review"
    || course.revision_status === "published";
  return ready ? "workspace" : "creation";
}

export function shouldCenterCreationComposer(
  course: CourseSummary | null,
  hasInstructorMessage: boolean,
  hasRun: boolean,
  hasSourceLabel: boolean,
  sending: boolean,
): boolean {
  return studioPresentationMode(course) === "creation"
    && (course?.source_count ?? 0) === 0
    && !hasInstructorMessage
    && !hasRun
    && !hasSourceLabel
    && !sending;
}

export function evidenceTitle(item: ReviewItem): string {
  const evidence = item.evidence;
  const candidate = evidence.title ?? evidence.name ?? evidence.body ?? evidence.type;
  return typeof candidate === "string" && candidate.trim()
    ? candidate
    : item.artifact_type.replaceAll("_", " ");
}
