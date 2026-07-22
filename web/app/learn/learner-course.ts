export type LearnerCourseSummary = {
  id: string;
  title: string;
  description: string | null;
  enrolled: boolean;
  topic_count: number;
  concept_count: number;
  mastered_concept_count: number;
};

export type LearnerTopic = {
  id: string;
  title: string;
  summary: string | null;
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

export function courseProgressPercent(course: LearnerCourseSummary) {
  if (!course.concept_count) return 0;
  return Math.round((course.mastered_concept_count / course.concept_count) * 100);
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
