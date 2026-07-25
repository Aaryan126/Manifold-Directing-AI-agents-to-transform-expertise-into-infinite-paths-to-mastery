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
  new_learners: number;
  activity_history: Array<{
    date: string;
    active_learners: number;
  }>;
  course_radar: CourseRadarItem[];
};

export type CourseRadarItem = {
  course_id: string;
  title: string;
  activity_trend: number[];
  active_learners: number;
  accuracy_percent: number | null;
  confidence_percent: number | null;
  confident_incorrect_attempts: number;
  clip_completion_percent: number | null;
  mastery_percent: number | null;
  mastery_movement: number;
  open_issues: number;
  agent_status: "working" | "ready_for_review" | "needs_attention" | "monitoring";
  agent_role: "learning_analyst" | "curriculum_architect" | "clip_editor" | "assessment_designer" | null;
};

export type DashboardCommandResult = {
  kind: "evidence" | "proposal" | "empty";
  message: string;
  course_id: string | null;
  course_title: string | null;
  action_label: string | null;
  evidence: Array<{
    id: string;
    label: string;
    value: string;
    metric: string;
    course_id: string | null;
    course_title: string | null;
  }>;
  searched_course_count: number;
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

export type BlueprintNodeKind = "topic" | "concept" | "clip" | "question" | "source";

export type BlueprintNode = {
  id: string;
  logical_id: string;
  kind: BlueprintNodeKind;
  title: string;
  status: string;
  parent_id: string | null;
  metadata: Record<string, unknown>;
};

export type BlueprintEdgeKind =
  | "contains"
  | "requires"
  | "teaches"
  | "assesses"
  | "next"
  | "remediates_to"
  | "cites";

export type BlueprintEdge = {
  id: string;
  source_id: string;
  target_id: string;
  kind: BlueprintEdgeKind;
  status: string;
};

export const blueprintEdgeKinds: BlueprintEdgeKind[] = [
  "contains",
  "next",
  "requires",
  "teaches",
  "assesses",
  "remediates_to",
  "cites",
];

export const coreBlueprintEdgeKinds = new Set<BlueprintEdgeKind>([
  "contains",
  "next",
  "requires",
  "teaches",
  "assesses",
]);

export type EditableBlueprintRelationship = Exclude<BlueprintEdgeKind, "next">;

export function availableBlueprintRelationshipKinds(
  node: BlueprintNode,
): EditableBlueprintRelationship[] {
  if (node.kind === "topic") return ["contains", "cites"];
  if (node.kind === "concept") return ["requires", "teaches", "assesses", "cites"];
  if (node.kind === "question") return ["remediates_to", "cites"];
  if (node.kind === "clip") return ["cites"];
  return [];
}

export function isValidBlueprintRelationshipTarget(
  source: BlueprintNode,
  target: BlueprintNode,
  kind: EditableBlueprintRelationship,
): boolean {
  if (source.id === target.id) return false;
  if (kind === "contains") return source.kind === "topic" && target.kind === "concept";
  if (kind === "requires") return source.kind === "concept" && target.kind === "concept";
  if (kind === "teaches") return source.kind === "concept" && target.kind === "clip";
  if (kind === "assesses") {
    return source.kind === "concept" && target.kind === "question";
  }
  if (kind === "remediates_to") {
    return source.kind === "question" && ["clip", "concept"].includes(target.kind);
  }
  return source.kind !== "source" && target.kind === "source";
}

export function visibleBlueprintEdges(
  edges: BlueprintEdge[],
  enabledKinds: ReadonlySet<BlueprintEdgeKind>,
  selectedNodeId: string | null,
): BlueprintEdge[] {
  return edges.filter(
    (edge) => enabledKinds.has(edge.kind)
      || Boolean(
        selectedNodeId
        && (edge.source_id === selectedNodeId || edge.target_id === selectedNodeId),
      ),
  );
}

export function blueprintNodeLayer(kind: BlueprintNodeKind): number {
  if (kind === "source") return 0;
  if (kind === "topic") return 1;
  if (kind === "concept") return 2;
  return 3;
}

export type CourseBlueprint = {
  course_id: string;
  revision_id: string;
  revision_kind: "active" | "working";
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  uncovered_concept_ids: string[];
};

export type CourseFlowModule = {
  id: string;
  logical_id: string;
  title: string;
  summary: string;
  sequence_rank: number;
  status: string;
  x: number | null;
  y: number | null;
};

export type CourseFlowUnitKind = "lecture" | "quiz" | "assignment";

export type CourseFlowUnit = {
  id: string;
  logical_id: string;
  module_logical_id: string | null;
  kind: CourseFlowUnitKind;
  title: string;
  summary: string;
  instructions: string;
  video_id: string | null;
  sequence_rank: number;
  status: string;
  topic_count: number;
  concept_count: number;
  question_count: number;
  source_count: number;
  concept_logical_ids: string[];
  x: number | null;
  y: number | null;
};

export type CourseFlowEdge = {
  id: string;
  logical_id: string;
  source_unit_logical_id: string;
  target_unit_logical_id: string;
  relationship: "next" | "requires" | "assesses";
  status: string;
};

export type CourseFlow = {
  course_id: string;
  revision_id: string;
  revision_kind: "active" | "working";
  modules: CourseFlowModule[];
  units: CourseFlowUnit[];
  edges: CourseFlowEdge[];
};

export type BlueprintConceptEvidence = {
  concept_id: string;
  attempts: number;
  touched_learners: number;
  correct_percent: number | null;
  confident_percent: number | null;
  confident_incorrect: number;
  mastery: Record<string, number>;
  route_actions: Record<string, number>;
};

export type BlueprintMutationImpact = {
  artifact_kind: "topic" | "concept" | "clip" | "question";
  logical_artifact_id: string;
  title: string;
  affected_topics: string[];
  affected_concepts: string[];
  affected_clips: string[];
  affected_questions: string[];
  affected_relationships: number;
  learner_records_preserved: boolean;
  warnings: string[];
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

export type DashboardSummary = {
  course_id: string;
  learner_count: number;
  attempt_count: number;
  not_enough_data: boolean;
  signals: Array<{
    id: string;
    type: string;
    status: string;
    ai_diagnosis: Record<string, unknown>;
  }>;
  concept_performance: Array<{
    concept_id: string;
    concept_name: string;
    touched_learners: number;
    struggling_learners: number;
    mastered_prerequisite_struggling_learners: number;
    attempts: number;
    correct_attempts: number;
    confidence_1: number;
    confidence_2: number;
    confidence_3: number;
    confidence_4: number;
    mastered_learners: number;
    practiced_learners: number;
  }>;
  question_performance: Array<{
    question_id: string;
    prompt: string;
    attempts: number;
    incorrect_attempts: number;
    low_confidence_correct_attempts: number;
  }>;
  clip_performance: Array<{
    clip_id: string;
    remediation_attempts: number;
    struggling_learners: number;
  }>;
  activity_history: Array<{
    date: string;
    attempts: number;
    active_learners: number;
  }>;
  mastery_distribution: {
    mastered: number;
    practiced: number;
    struggling: number;
    not_started: number;
  };
  topic_health: TopicHealth[];
  priorities: CoursePriority[];
};

export type TopicHealth = {
  topic_id: string;
  logical_id: string;
  title: string;
  learner_reach: number;
  attempts: number;
  correct_attempts: number;
  confidence_1: number;
  confidence_2: number;
  confidence_3: number;
  confidence_4: number;
  mastered_learners: number;
  practiced_learners: number;
  struggling_learners: number;
  remediation_attempts: number;
  active_clips: number;
  clip_duration_seconds: number;
  assessment_count: number;
  concept_count: number;
};

export type CoursePriority = {
  id: string;
  title: string;
  summary: string;
  severity: "high" | "medium" | "low";
  score: number;
  specialist_role: SpecialistRole;
  target_artifact_type: string | null;
  target_artifact_id: string | null;
  target_logical_artifact_id: string | null;
  affected_learners: number;
  evidence_count: number;
  evidence: Record<string, unknown>;
  recommended_action: string;
};

export type SpecialistRole =
  | "learning_analyst"
  | "curriculum_architect"
  | "clip_editor"
  | "assessment_designer";

export type CourseSource = {
  id: string;
  logical_id: string;
  filename: string;
  source_type: "lecture_video" | "lecture_audio" | "pdf" | "pptx";
  mime_type: string;
  size_bytes: number;
  extraction_status: "queued" | "processing" | "ready" | "failed";
  extraction_error: string | null;
  purpose: "ai_context" | "learner_resource" | "both";
  review_status: "proposed" | "accepted" | "edited" | "dismissed";
  learner_visible: boolean;
  section_count: number;
  created_at: string;
  updated_at: string;
};

export type CourseAgentTask = {
  id: string;
  specialist_role: SpecialistRole;
  task_type: string;
  target_artifact_type: string | null;
  target_logical_artifact_id: string | null;
  request_context: Record<string, unknown>;
  evidence_snapshot: Record<string, unknown>;
  status: "queued" | "running" | "waiting_review" | "complete" | "failed" | "cancelled";
  result: Record<string, unknown> | null;
  proposal_ids: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentTaskProposal = {
  id: string;
  proposal_type: string;
  artifact_type: string | null;
  logical_artifact_id: string | null;
  before_state: Record<string, unknown> | null;
  proposed_state: Record<string, unknown>;
  rationale: string;
  status: string;
  citations: Array<{
    source_id: string;
    source_title: string;
    section_id: string;
    page_number: number;
    excerpt: string;
  }>;
};

export type AgentTaskPack = {
  task: CourseAgentTask;
  proposals: AgentTaskProposal[];
};

export function performancePercent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function canPrepareImprovement(
  priority: CoursePriority,
  tasks: CourseAgentTask[],
): boolean {
  if (!priority.target_artifact_type || !priority.target_logical_artifact_id) return false;
  return !tasks.some((task) => (
    task.task_type === "prepare_improvement"
    && task.target_logical_artifact_id === priority.target_logical_artifact_id
    && ["queued", "running", "waiting_review"].includes(task.status)
  ));
}

export type AssessmentRule = {
  id?: string;
  wrong_answer_pattern: string;
  target_clip_id: string | null;
  target_concept_id: string | null;
};

export type CourseAssessment = {
  id: string;
  logical_id: string;
  topic_id: string;
  topic_title: string;
  body: string;
  type: "mcq" | "short_answer" | "worked_problem";
  correct_answer: Record<string, unknown>;
  confidence_prompt: string;
  review_status: "proposed" | "accepted" | "edited" | "dismissed";
  remediation_rules: AssessmentRule[];
  primary_concept_id: string | null;
  concept_ids: string[];
};

export type AssessmentWorkspace = {
  revision_id: string;
  is_working_revision: boolean;
  topics: Array<{ id: string; title: string }>;
  concepts: Array<{ id: string; name: string; topic_ids: string[] }>;
  clips: Array<{
    id: string;
    topic_id: string;
    topic_title: string;
    video_id: string;
    label: string;
    start_seconds: number;
    end_seconds: number;
    type: string;
    difficulty: string | null;
    status: string;
    playback_provider: "local" | "mux";
    playback_id: string | null;
    playback_url: string;
    delivery_asset_id: string | null;
    materialization_status: "source_reference" | "processing" | "ready" | "failed";
  }>;
  questions: CourseAssessment[];
};

export function findBlueprintClip(
  node: BlueprintNode,
  clips: AssessmentWorkspace["clips"],
): AssessmentWorkspace["clips"][number] | null {
  const exact = clips.find((clip) => clip.id === node.id);
  if (exact) return exact;

  const startSeconds = Number(node.metadata.start_seconds);
  const endSeconds = Number(node.metadata.end_seconds);
  if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
    const boundedMatch = clips.find(
      (clip) => Math.abs(clip.start_seconds - startSeconds) < 0.1
        && Math.abs(clip.end_seconds - endSeconds) < 0.1,
    );
    if (boundedMatch) return boundedMatch;
  }

  const normalizedTitle = node.title.replaceAll("_", " ").trim().toLowerCase();
  const sameType = clips.filter(
    (clip) => clip.type.replaceAll("_", " ").trim().toLowerCase() === normalizedTitle,
  );
  return sameType.length === 1 ? sameType[0] : null;
}

export type RoutingPolicy = {
  confidence_threshold: number;
  correct_attempts_for_mastery: number;
  advancement_mode: "require_mastery" | "allow_partial_understanding";
  max_remediation_attempts: number;
};

export type RoutingWorkspace = {
  revision_id: string;
  is_working_revision: boolean;
  concepts: Array<{ id: string; name: string; topic_ids: string[] }>;
  policies: Array<{
    id: string | null;
    concept_id: string | null;
    concept_name: string | null;
    policy: RoutingPolicy;
  }>;
};

export function answerOutcomeSummary(summary: DashboardSummary | null) {
  const questions = summary?.question_performance ?? [];
  const attempts = questions.reduce((total, item) => total + item.attempts, 0);
  const incorrect = questions.reduce((total, item) => total + item.incorrect_attempts, 0);
  const unsure = questions.reduce(
    (total, item) => total + item.low_confidence_correct_attempts,
    0,
  );
  return {
    attempts,
    confident_correct: Math.max(0, attempts - incorrect - unsure),
    unsure_correct: unsure,
    incorrect,
  };
}

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

const generationTaskSequence = [
  "source_ready",
  "outline",
  "concept_graph",
  "clips",
  "assessments",
  "review_bundles",
] as const;

export function orderedGenerationTasks(tasks: GenerationTask[]): GenerationTask[] {
  const rank = new Map<string, number>(generationTaskSequence.map((task, index) => [task, index]));
  return [...tasks].sort(
    (left, right) => (rank.get(left.task_type) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.task_type) ?? Number.MAX_SAFE_INTEGER),
  );
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

export function compareBlueprintSequence(left: BlueprintNode, right: BlueprintNode): number {
  const leftRank = typeof left.metadata.sequence_rank === "number"
    ? left.metadata.sequence_rank
    : Number.MAX_SAFE_INTEGER;
  const rightRank = typeof right.metadata.sequence_rank === "number"
    ? right.metadata.sequence_rank
    : Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || left.title.localeCompare(right.title);
}

export function masteryStateForConcept(
  conceptId: string,
  evidence: BlueprintConceptEvidence[],
): "not_started" | "mastered" | "struggling" | "practiced" {
  const record = evidence.find((item) => item.concept_id === conceptId);
  if (!record || !record.attempts) return "not_started";
  if ((record.mastery.mastered ?? 0) > 0) return "mastered";
  if ((record.mastery.struggling ?? 0) > 0 || (record.correct_percent ?? 100) < 60) {
    return "struggling";
  }
  return "practiced";
}

export function visibleBlueprintNodeIds(
  blueprint: CourseBlueprint,
  topicLogicalId: string | null,
): Set<string> | null {
  if (!topicLogicalId) return null;
  const topic = blueprint.nodes.find(
    (node) => node.kind === "topic" && node.logical_id === topicLogicalId,
  );
  if (!topic) return null;
  const ids = new Set<string>([topic.id]);
  const conceptIds = new Set(
    blueprint.edges
      .filter((edge) => edge.kind === "contains" && edge.source_id === topic.id)
      .map((edge) => edge.target_id),
  );
  conceptIds.forEach((id) => ids.add(id));
  blueprint.edges.forEach((edge) => {
    if (conceptIds.has(edge.source_id)) ids.add(edge.target_id);
    if (conceptIds.has(edge.target_id)) ids.add(edge.source_id);
  });
  return ids;
}

export type BlueprintConceptOccurrence = {
  id: string;
  concept: BlueprintNode;
  topic: BlueprintNode;
  sharedTopicCount: number;
  clipCount: number;
  questionCount: number;
  evidence: BlueprintConceptEvidence | null;
};

export type BlueprintTopicLane = {
  topic: BlueprintNode;
  concepts: BlueprintConceptOccurrence[];
};

export function buildBlueprintTopicLanes(
  blueprint: CourseBlueprint,
  evidence: BlueprintConceptEvidence[],
): BlueprintTopicLane[] {
  const nodeById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const evidenceByConcept = new Map(evidence.map((item) => [item.concept_id, item]));
  const topicIdsByConcept = new Map<string, Set<string>>();
  const artifactCounts = new Map<string, { clips: Set<string>; questions: Set<string> }>();

  blueprint.edges.forEach((edge) => {
    if (edge.kind === "contains") {
      const source = nodeById.get(edge.source_id);
      const target = nodeById.get(edge.target_id);
      if (source?.kind === "topic" && target?.kind === "concept") {
        const topicIds = topicIdsByConcept.get(target.id) ?? new Set<string>();
        topicIds.add(source.id);
        topicIdsByConcept.set(target.id, topicIds);
      }
    }
    const source = nodeById.get(edge.source_id);
    const target = nodeById.get(edge.target_id);
    const concept = source?.kind === "concept" ? source : target?.kind === "concept" ? target : null;
    const artifact = source?.kind === "concept" ? target : source;
    if (!concept || !artifact) return;
    const counts = artifactCounts.get(concept.id) ?? {
      clips: new Set<string>(),
      questions: new Set<string>(),
    };
    if (artifact.kind === "clip") counts.clips.add(artifact.id);
    if (artifact.kind === "question") counts.questions.add(artifact.id);
    artifactCounts.set(concept.id, counts);
  });

  return blueprint.nodes
    .filter((node) => node.kind === "topic")
    .sort(compareBlueprintSequence)
    .map((topic) => {
      const concepts = blueprint.edges
        .filter((edge) => edge.kind === "contains" && edge.source_id === topic.id)
        .map((edge) => nodeById.get(edge.target_id))
        .filter((node): node is BlueprintNode => node?.kind === "concept")
        .sort(compareBlueprintSequence)
        .map((concept) => {
          const counts = artifactCounts.get(concept.id);
          return {
            id: `occurrence:${topic.logical_id}:${concept.logical_id}`,
            concept,
            topic,
            sharedTopicCount: topicIdsByConcept.get(concept.id)?.size ?? 1,
            clipCount: counts?.clips.size ?? 0,
            questionCount: counts?.questions.size ?? 0,
            evidence: evidenceByConcept.get(concept.id) ?? null,
          };
        });
      return { topic, concepts };
    });
}

export function topicLogicalIdsForConcept(
  blueprint: CourseBlueprint,
  conceptId: string,
): string[] {
  const topicsById = new Map(
    blueprint.nodes
      .filter((node) => node.kind === "topic")
      .map((node) => [node.id, node.logical_id]),
  );
  return blueprint.edges
    .filter(
      (edge) => edge.kind === "contains"
        && edge.target_id === conceptId
        && topicsById.has(edge.source_id),
    )
    .map((edge) => topicsById.get(edge.source_id) as string);
}

export function reorderBlueprintConcepts(
  concepts: BlueprintNode[],
  movedLogicalId: string,
  targetLogicalId: string | null,
): string[] {
  const ordered = [...concepts].sort(compareBlueprintSequence).map((concept) => concept.logical_id);
  const withoutMoved = ordered.filter((logicalId) => logicalId !== movedLogicalId);
  if (!targetLogicalId) return [...withoutMoved, movedLogicalId];
  const targetIndex = withoutMoved.indexOf(targetLogicalId);
  if (targetIndex < 0) return ordered;
  withoutMoved.splice(targetIndex, 0, movedLogicalId);
  return withoutMoved;
}

export function blueprintConceptNeighborhoodIds(
  blueprint: CourseBlueprint,
  conceptId: string,
): Set<string> {
  const ids = new Set<string>([conceptId]);
  blueprint.edges.forEach((edge) => {
    if (edge.source_id === conceptId) ids.add(edge.target_id);
    if (edge.target_id === conceptId) ids.add(edge.source_id);
  });
  return ids;
}
