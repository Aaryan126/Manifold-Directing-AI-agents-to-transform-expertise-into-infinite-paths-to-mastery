export type LearnerClip = {
  id: string;
  topic_id: string;
  concept_ids: string[];
  status: string;
  start_seconds: number;
  end_seconds: number;
  materialization_status?: "source_reference" | "processing" | "ready" | "failed";
};

export type LearnerProgress = {
  concept_id: string;
  name: string;
  state: "not_started" | "struggling" | "practiced" | "mastered" | string;
  topic_id: string | null;
};

export type LearnerRouteDecision = {
  action: string;
  target_clip_id: string | null;
  target_concept_id: string | null;
};

export function clipForRoute(
  clips: LearnerClip[],
  decision: LearnerRouteDecision | null,
  fallbackTopicId: string | null,
): LearnerClip | null {
  if (decision?.target_clip_id) {
    return clips.find((clip) => clip.id === decision.target_clip_id && clip.status === "active")
      ?? null;
  }
  if (decision?.target_concept_id) {
    const conceptClip = clips.find(
      (clip) =>
        clip.status === "active" && clip.concept_ids.includes(decision.target_concept_id!),
    );
    if (conceptClip) return conceptClip;
  }
  return (
    clips.find((clip) => clip.status === "active" && clip.topic_id === fallbackTopicId) ??
    clips.find((clip) => clip.status === "active") ??
    null
  );
}

export function masterySummary(progress: LearnerProgress[]): string {
  const mastered = progress.filter((item) => item.state === "mastered").length;
  return `${mastered} of ${progress.length} concept(s) mastered`;
}

export function routeTone(action: string): "advance" | "support" | "attention" {
  if (action === "advance" || action === "complete") return "advance";
  if (action === "flag_instructor") return "attention";
  return "support";
}
