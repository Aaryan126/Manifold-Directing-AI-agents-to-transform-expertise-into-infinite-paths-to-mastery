export type LearnerCourseSummary = {
  id: string;
  title: string;
  description: string | null;
  enrolled: boolean;
  topic_count: number;
  concept_count: number;
  mastered_concept_count: number;
  lecture_count: number;
  quiz_count: number;
  assignment_count: number;
};

export type LearnerTopic = {
  id: string;
  video_id: string;
  title: string;
  summary: string | null;
};

export type LearnerCourseUnit = {
  id: string;
  logical_id: string;
  kind: "lecture" | "quiz" | "assignment";
  title: string;
  summary: string;
  instructions: string;
  video_id: string | null;
  sequence_rank: number;
  status: "not_started" | "in_progress" | "completed";
  topic_ids: string[];
  question_count: number;
};

export type LearnerClip = {
  id: string;
  topic_id: string;
  video_id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  type: string;
  difficulty: string | null;
  playback_provider: "local" | "mux";
  playback_id: string | null;
  playback_url: string;
  delivery_asset_id: string | null;
  materialization_status: "source_reference" | "processing" | "ready" | "failed";
};

export type LearnerQuestion = {
  id: string;
  topic_id: string;
  body: string;
  type: "mcq" | "short_answer" | "worked_problem";
  choices: string[];
  confidence_prompt: string;
};

export type LearnerCourseExperience = {
  id: string;
  title: string;
  description: string | null;
  units: LearnerCourseUnit[];
  topics: LearnerTopic[];
  clips: LearnerClip[];
  questions: LearnerQuestion[];
  resources: Array<{
    id: string;
    filename: string;
    source_type: "pdf" | "pptx";
    size_bytes: number;
  }>;
};

export type LearnerProgress = {
  concept_id: string;
  name: string;
  state: "not_started" | "struggling" | "practiced" | "mastered";
  topic_id: string | null;
};

export type LearnerRouteDecision = {
  action: "advance" | "reinforce" | "remediate" | "flag_instructor" | "complete";
  mastery_state: LearnerProgress["state"];
  why: string;
  target_concept_id: string | null;
  target_clip_id: string | null;
  dashboard_signal_id: string | null;
  route_event_id?: string | null;
};

export type LearnerPathAid = {
  source_id: string;
  title: string;
  page_number: number;
  excerpt: string;
};

export type LearnerPathItem = {
  concept_id: string;
  name: string;
  description: string;
  sequence_rank: number;
  state: LearnerProgress["state"];
  topic_id: string | null;
  topic_title: string | null;
  prerequisite_ids: string[];
  clip_ids: string[];
  question_ids: string[];
  aids: LearnerPathAid[];
  eligible: boolean;
  actionable?: boolean;
  coverage_state?:
    | "complete"
    | "missing_teaching"
    | "missing_assessment"
    | "missing_both";
  current: boolean;
};

export type LearnerPath = {
  course_id: string;
  revision_id: string;
  current_concept_id: string | null;
  items: LearnerPathItem[];
  last_route_action: LearnerRouteDecision["action"] | null;
  last_route_why: string | null;
};

export type LearnerTranscriptWord = {
  text: string;
  start_seconds: number;
  end_seconds: number;
};

export type LearnerSessionStep = {
  id: string;
  ordinal: number;
  kind: "watch" | "question" | "resource" | "reflect";
  purpose:
    | "foundation"
    | "learn"
    | "practice"
    | "reinforcement"
    | "remediation"
    | "review"
    | "reflect";
  concept_id: string | null;
  concept_name: string | null;
  clip_id: string | null;
  question_id: string | null;
  source_id: string | null;
  title: string;
  reason_code: string;
  reason: string;
  status: "pending" | "active" | "completed" | "skipped" | "replaced" | "unavailable";
};

export type LearnerStudySession = {
  id: string;
  course_id: string;
  revision_id: string;
  status: "planned" | "active" | "reflecting" | "completed" | "superseded";
  mode: LearnerModeKey;
  finish_requested: boolean;
  plan_version: number;
  steps: LearnerSessionStep[];
};

export type LearnerOrientation = {
  completed: boolean;
  entry_choice: "recommended" | "placement" | "foundations" | null;
};

export type LearnerModeKey =
  | "continue_path"
  | "learn_new"
  | "strengthen_weak_areas"
  | "review_learned";

export type LearnerMode = {
  key: LearnerModeKey;
  title: string;
  description: string;
  available: boolean;
  recommended: boolean;
  reason: string | null;
  disabled_reason: string | null;
};

export type LearnerPlacementItem = {
  id: string;
  ordinal: number;
  concept_id: string;
  concept_name: string;
  question_id: string;
  question_body: string;
  choices: string[];
  confidence_prompt: string;
  status: "pending" | "answered" | "skipped";
  outcome: "mastered" | "practiced" | "retained" | null;
};

export type LearnerPlacement = {
  id: string;
  status: "in_progress" | "completed" | "unavailable";
  unavailable_reason: string | null;
  items: LearnerPlacementItem[];
};

export type LearnerMasteryReview = {
  concepts: Array<{
    concept_id: string;
    name: string;
    state: LearnerProgress["state"];
    access_state: "ready" | "blocked" | "content_unavailable";
    coverage_state: LearnerPathItem["coverage_state"];
    due_at: string | null;
    mismatch: string | null;
  }>;
  recent_routes: Array<{
    action: string;
    explanation: string;
    created_at: string;
  }>;
};

export type LearnerWorkspace = {
  revision_id: string;
  orientation: LearnerOrientation;
  modes: LearnerMode[];
  session: LearnerStudySession | null;
  placement: LearnerPlacement | null;
  mastery: LearnerMasteryReview;
  guide_actions: string[];
  content_message: string | null;
};

export type LearnerPathVisualState =
  | "mastered"
  | "recommended"
  | "review"
  | "ready"
  | "blocked";

export function courseProgressPercent(course: LearnerCourseSummary) {
  if (!course.concept_count) return 0;
  return Math.round((course.mastered_concept_count / course.concept_count) * 100);
}

export function courseCompositionLabels(course: LearnerCourseSummary) {
  const lectures = course.lecture_count ?? (course.topic_count ? 1 : 0);
  const labels = [countLabel(lectures, "lecture")];
  if (course.quiz_count) labels.push(countLabel(course.quiz_count, "quiz"));
  if (course.assignment_count) labels.push(countLabel(course.assignment_count, "assignment"));
  if (labels.length === 1) labels.push(countLabel(course.concept_count, "concept"));
  return labels;
}

export function learnerPathVisualState(
  item: LearnerPathItem,
  recommendedConceptId: string | null,
): LearnerPathVisualState {
  if (item.state === "mastered") return "mastered";
  if (item.concept_id === recommendedConceptId || item.current) {
    return item.state === "struggling" ? "review" : "recommended";
  }
  return item.eligible && item.actionable !== false ? "ready" : "blocked";
}

export function clipTranscriptWords(
  words: LearnerTranscriptWord[],
  clipStartSeconds: number,
  clipEndSeconds: number,
) {
  return words
    .filter((word) => (
      word.end_seconds > clipStartSeconds && word.start_seconds < clipEndSeconds
    ))
    .map((word) => ({
      ...word,
      start_seconds: Math.max(0, word.start_seconds - clipStartSeconds),
      end_seconds: Math.min(
        Math.max(0, clipEndSeconds - clipStartSeconds),
        Math.max(0, word.end_seconds - clipStartSeconds),
      ),
    }));
}

export function activeTranscriptWordIndex(
  words: LearnerTranscriptWord[],
  playbackSeconds: number,
) {
  return words.findIndex((word) => (
    playbackSeconds >= word.start_seconds && playbackSeconds < word.end_seconds
  ));
}

export function nextTopicId(
  experience: LearnerCourseExperience,
  progress: LearnerProgress[],
) {
  const unfinished = progress.find(
    (item) => item.topic_id && item.state !== "mastered",
  )?.topic_id;
  return unfinished ?? experience.topics[0]?.id ?? null;
}

export function topicForDecision(
  decision: LearnerRouteDecision,
  experience: LearnerCourseExperience,
  progress: LearnerProgress[],
  currentTopicId: string,
) {
  if (decision.target_clip_id) {
    return experience.clips.find((clip) => clip.id === decision.target_clip_id)?.topic_id
      ?? currentTopicId;
  }
  if (decision.target_concept_id) {
    return progress.find((item) => item.concept_id === decision.target_concept_id)?.topic_id
      ?? currentTopicId;
  }
  if (decision.action === "advance") {
    const currentIndex = experience.topics.findIndex((topic) => topic.id === currentTopicId);
    return experience.topics[currentIndex + 1]?.id ?? currentTopicId;
  }
  return currentTopicId;
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
