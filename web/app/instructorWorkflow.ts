export type InstructorStageId =
  | "source"
  | "structure"
  | "assessments"
  | "adapt"
  | "publish"
  | "insights";

export type CreationStageId = Exclude<InstructorStageId, "insights">;
export type StageState = "complete" | "active" | "pending" | "blocked";

export type WorkflowTask = {
  id: string;
  stage: CreationStageId;
  title: string;
  detail: string;
  target: string;
  count?: number;
};

export type WorkflowStage = {
  id: CreationStageId;
  label: string;
  description: string;
  state: StageState;
  taskCount: number;
};

export type TopicReadiness = {
  id: string;
  title: string;
  reviewStatus: "proposed" | "accepted" | "edited" | "dismissed";
  reviewedConcepts: number;
  clips: number;
  staleClips: number;
  flaggedClips: number;
  approvedQuestions: number;
  proposedQuestions: number;
};

export type WorkflowSnapshot = {
  sourceStatus: "missing" | "processing" | "complete" | "failed";
  topicCount: number;
  proposedTopics: number;
  reviewedTopics: number;
  conceptCount: number;
  proposedConcepts: number;
  proposedEdges: number;
  topicsMissingConcepts: number;
  topicsMissingClips: number;
  topicsMissingQuestions: number;
  proposedQuestions: number;
  reviewedQuestions: number;
  reviewedConcepts: number;
  routingPolicyCount: number;
  routingTested: boolean;
  publishBlockers: string[];
  publishReady: boolean;
  published: boolean;
};

const stageDetails: Record<CreationStageId, Pick<WorkflowStage, "label" | "description">> = {
  source: {
    label: "Source",
    description: "Add the lecture and let Manifold prepare a timestamped transcript.",
  },
  structure: {
    label: "Structure",
    description: "Review topic boundaries, concepts, and prerequisite relationships.",
  },
  assessments: {
    label: "Assessments",
    description: "Approve a comprehension check and remediation path for every topic.",
  },
  adapt: {
    label: "Adaptation",
    description: "Confirm routing behavior and test how the learner path responds.",
  },
  publish: {
    label: "Publish",
    description: "Resolve final blockers, preview the experience, and make the course available.",
  },
};

export const creationStageOrder: CreationStageId[] = [
  "source",
  "structure",
  "assessments",
  "adapt",
  "publish",
];

export function buildWorkflow(snapshot: WorkflowSnapshot): {
  stages: WorkflowStage[];
  tasks: WorkflowTask[];
  recommendedStage: CreationStageId;
} {
  const tasks = buildTasks(snapshot);
  const complete: Record<CreationStageId, boolean> = {
    source: snapshot.sourceStatus === "complete",
    structure:
      snapshot.topicCount > 0 &&
      snapshot.proposedTopics === 0 &&
      snapshot.conceptCount > 0 &&
      snapshot.proposedConcepts === 0 &&
      snapshot.proposedEdges === 0 &&
      snapshot.topicsMissingConcepts === 0 &&
      snapshot.topicsMissingClips === 0,
    assessments:
      snapshot.reviewedTopics > 0 &&
      snapshot.topicsMissingQuestions === 0 &&
      snapshot.proposedQuestions === 0,
    adapt:
      snapshot.reviewedConcepts > 0 &&
      snapshot.routingPolicyCount >= snapshot.reviewedConcepts &&
      snapshot.routingTested,
    publish: snapshot.published,
  };
  const recommendedStage = creationStageOrder.find((stage) => !complete[stage]) ?? "publish";

  return {
    tasks,
    recommendedStage,
    stages: creationStageOrder.map((id) => {
      const isBlocked = isStageBlocked(id, snapshot);
      return {
        id,
        ...stageDetails[id],
        state: complete[id]
          ? "complete"
          : isBlocked
            ? "blocked"
            : id === recommendedStage
              ? "active"
              : "pending",
        taskCount: tasks.filter((task) => task.stage === id).length,
      };
    }),
  };
}

export function topicReadinessLabel(topic: TopicReadiness): string {
  if (topic.reviewStatus === "dismissed") return "Dismissed";
  if (topic.reviewStatus === "proposed") return "Review outline";
  if (topic.reviewedConcepts === 0) return "Link a concept";
  if (topic.clips === 0) return topic.staleClips > 0 ? "Regenerate clips" : "Generate clips";
  if (topic.approvedQuestions === 0) {
    return topic.proposedQuestions > 0 ? "Review question" : "Generate question";
  }
  return "Ready";
}

export function topicProductionLabel(topic: TopicReadiness): string {
  if (topic.reviewStatus === "dismissed") return "Dismissed";
  if (topic.reviewStatus === "proposed") return "Review topic";
  if (topic.reviewedConcepts === 0) return "Needs concept";
  if (topic.clips === 0) return topic.staleClips > 0 ? "Regenerate clips" : "Generate clips";
  if (topic.flaggedClips > 0) return "Clip flagged";
  return "Ready";
}

export function topicRepairTarget(topic: TopicReadiness): {
  stage: CreationStageId;
  target: string;
} {
  if (topic.reviewStatus === "proposed") return { stage: "structure", target: "outline" };
  if (topic.reviewedConcepts === 0) return { stage: "structure", target: "concept-graph" };
  if (topic.clips === 0) return { stage: "structure", target: "outline" };
  return { stage: "assessments", target: "assessments" };
}

function buildTasks(snapshot: WorkflowSnapshot): WorkflowTask[] {
  const tasks: WorkflowTask[] = [];

  if (snapshot.sourceStatus === "missing" || snapshot.sourceStatus === "failed") {
    tasks.push({
      id: "add-source",
      stage: "source",
      title: snapshot.sourceStatus === "failed" ? "Repair source ingestion" : "Add source material",
      detail: snapshot.sourceStatus === "failed"
        ? "The last source could not be processed. Retry with a supported file or URL."
        : "Upload a lecture, provide a media URL, or load the prepared demo.",
      target: "course-setup",
    });
  }
  if (snapshot.sourceStatus === "processing") {
    tasks.push({
      id: "source-processing",
      stage: "source",
      title: "Manifold is preparing the source",
      detail: "Transcription and source metadata are processing. You can leave and resume later.",
      target: "course-setup",
    });
  }
  if (snapshot.sourceStatus === "complete" && snapshot.topicCount === 0) {
    tasks.push({
      id: "generate-outline",
      stage: "structure",
      title: "Prepare the topic outline",
      detail: "Generate the first topic proposal from the completed transcript.",
      target: "outline",
    });
  }
  if (snapshot.proposedTopics > 0) {
    tasks.push({
      id: "review-topics",
      stage: "structure",
      title: "Review topic proposals",
      detail: "Confirm boundaries, titles, and summaries before concept generation.",
      target: "outline",
      count: snapshot.proposedTopics,
    });
  }
  if (snapshot.reviewedTopics > 0 && snapshot.conceptCount === 0) {
    tasks.push({
      id: "generate-graph",
      stage: "structure",
      title: "Generate the concept graph",
      detail: "Build concepts and prerequisite relationships from the reviewed outline.",
      target: "concept-graph",
    });
  }
  if (snapshot.proposedConcepts + snapshot.proposedEdges > 0) {
    tasks.push({
      id: "review-graph",
      stage: "structure",
      title: "Review graph proposals",
      detail: "Confirm concepts and prerequisite edges before learner material is created.",
      target: "concept-graph",
      count: snapshot.proposedConcepts + snapshot.proposedEdges,
    });
  }
  if (snapshot.topicsMissingConcepts > 0) {
    tasks.push({
      id: "repair-topic-links",
      stage: "structure",
      title: "Repair topic coverage",
      detail: "Every reviewed topic needs at least one reviewed concept link.",
      target: "concept-graph",
      count: snapshot.topicsMissingConcepts,
    });
  }
  if (snapshot.topicsMissingClips > 0) {
    tasks.push({
      id: "prepare-clips",
      stage: "structure",
      title: "Prepare topic clips",
      detail: "Generate and spot-check concise learning clips for uncovered topics.",
      target: "outline",
      count: snapshot.topicsMissingClips,
    });
  }
  if (snapshot.topicsMissingQuestions > 0) {
    tasks.push({
      id: "prepare-questions",
      stage: "assessments",
      title: "Prepare comprehension checks",
      detail: "Generate a learner check for each reviewed topic that is still uncovered.",
      target: "assessments",
      count: snapshot.topicsMissingQuestions,
    });
  }
  if (snapshot.proposedQuestions > 0) {
    tasks.push({
      id: "review-questions",
      stage: "assessments",
      title: "Review assessment proposals",
      detail: "Approve, edit, dismiss, or regenerate each proposed learner check.",
      target: "assessments",
      count: snapshot.proposedQuestions,
    });
  }
  const missingPolicies = Math.max(0, snapshot.reviewedConcepts - snapshot.routingPolicyCount);
  if (snapshot.reviewedConcepts > 0 && missingPolicies > 0) {
    tasks.push({
      id: "configure-routing",
      stage: "adapt",
      title: "Confirm routing policy",
      detail: "Set mastery, confidence, and remediation behavior for reviewed concepts.",
      target: "routing",
      count: missingPolicies,
    });
  }
  if (snapshot.reviewedQuestions > 0 && !snapshot.routingTested) {
    tasks.push({
      id: "test-routing",
      stage: "adapt",
      title: "Test the learner path",
      detail: "Run at least one confident, unsure, or incorrect outcome before publishing.",
      target: "routing-simulator",
    });
  }
  if (!snapshot.published) {
    if (snapshot.publishBlockers.length > 0) {
      tasks.push({
        id: "resolve-publish-blockers",
        stage: "publish",
        title: "Resolve publishing blockers",
        detail: snapshot.publishBlockers[0],
        target: targetForBlocker(snapshot.publishBlockers[0]),
        count: snapshot.publishBlockers.length,
      });
    } else if (snapshot.publishReady) {
      tasks.push({
        id: "publish-course",
        stage: "publish",
        title: "Publish the course",
        detail: "All required review checkpoints are ready for final publication.",
        target: "publish-review",
      });
    }
  }
  return tasks;
}

function isStageBlocked(stage: CreationStageId, snapshot: WorkflowSnapshot): boolean {
  if (stage === "source") return false;
  if (stage === "structure") return snapshot.sourceStatus !== "complete";
  if (stage === "assessments") {
    return snapshot.reviewedTopics === 0 ||
      snapshot.reviewedConcepts === 0 ||
      snapshot.topicsMissingClips > 0;
  }
  if (stage === "adapt") return snapshot.reviewedQuestions === 0;
  if (stage === "publish") return snapshot.sourceStatus !== "complete";
  return false;
}

function targetForBlocker(blocker: string): string {
  const normalized = blocker.toLowerCase();
  if (normalized.includes("question")) return "assessments";
  if (normalized.includes("clip")) return "clips";
  if (normalized.includes("concept") || normalized.includes("edge") || normalized.includes("graph")) {
    return "concept-graph";
  }
  if (normalized.includes("topic") || normalized.includes("outline")) return "outline";
  if (normalized.includes("routing") || normalized.includes("policy")) return "routing";
  return "course-setup";
}
