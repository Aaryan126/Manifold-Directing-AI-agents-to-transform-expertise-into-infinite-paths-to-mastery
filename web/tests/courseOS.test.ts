import { describe, expect, it } from "vitest";
import {
  answerOutcomeSummary,
  canPrepareImprovement,
  courseState,
  evidenceTitle,
  generationPhaseLabel,
  orderedGenerationTasks,
  performancePercent,
  shouldHydrateGenerationRun,
  shouldCenterCreationComposer,
  studioPresentationMode,
  type CourseSummary,
  type CourseAgentTask,
  type CoursePriority,
  type GenerationTask,
} from "../app/app/course-os";

const course: CourseSummary = {
  id: "course",
  instructor_id: "instructor",
  title: "Mechanics",
  description: null,
  status: "draft",
  active_revision_id: null,
  working_revision_id: "revision",
  revision_status: "building",
  generation_run_id: null,
  generation_status: null,
  generation_phase: null,
  generation_progress: 0,
  source_count: 0,
  topic_count: 0,
  concept_count: 0,
  pending_review_count: 0,
  open_signal_count: 0,
  updated_at: "2026-07-21T00:00:00Z",
};

describe("Course OS presentation", () => {
  it("prioritizes failed and review states over a generic draft label", () => {
    expect(courseState({ ...course, generation_status: "failed" }).label).toBe("Needs help");
    expect(courseState({ ...course, pending_review_count: 12 }).label).toBe("Ready to review");
  });

  it("turns durable task names into teacher-facing activity", () => {
    expect(generationPhaseLabel("concept_graph")).toBe("Mapping concepts and prerequisites");
    expect(generationPhaseLabel("review")).toBe("Your private draft is ready");
    expect(generationPhaseLabel("complete")).toBe("Course published");
  });

  it("orders generation work from the lecture dependency to review assembly", () => {
    const task = (task_type: string): GenerationTask => ({
      id: task_type,
      task_type,
      scope_key: "course",
      status: "queued",
      attempts: 0,
      max_attempts: 3,
      output: null,
      error_message: null,
    });

    expect(orderedGenerationTasks([
      task("review_bundles"),
      task("concept_graph"),
      task("source_ready"),
      task("outline"),
    ]).map((item) => item.task_type)).toEqual([
      "source_ready",
      "outline",
      "concept_graph",
      "review_bundles",
    ]);
  });

  it("does not hydrate a completed or cancelled run as active generation", () => {
    const withRun = { ...course, generation_run_id: "run" };

    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "running" })).toBe(true);
    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "waiting_review" })).toBe(true);
    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "complete" })).toBe(false);
    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "cancelled" })).toBe(false);
  });

  it("keeps Course Director full-width until the private draft reaches review", () => {
    expect(studioPresentationMode(course)).toBe("creation");
    expect(studioPresentationMode({ ...course, generation_status: "running", source_count: 1 })).toBe("creation");
    expect(studioPresentationMode({ ...course, generation_status: "waiting_review", source_count: 1 })).toBe("workspace");
    expect(studioPresentationMode({ ...course, pending_review_count: 4, source_count: 1 })).toBe("workspace");
  });

  it("centers the pristine composer and docks it after the first submission", () => {
    expect(shouldCenterCreationComposer(course, false, false, false, false)).toBe(true);
    expect(shouldCenterCreationComposer(course, true, false, false, false)).toBe(false);
    expect(shouldCenterCreationComposer(course, false, true, true, true)).toBe(false);
  });

  it("uses human-readable evidence fields for review cards", () => {
    expect(evidenceTitle({
      id: "item",
      artifact_type: "question",
      artifact_id: "question",
      logical_artifact_id: "logical",
      status: "pending",
      risk_level: "high",
      evidence: { body: "Why does this force act here?" },
    })).toBe("Why does this force act here?");
  });

  it("derives answer outcomes from persisted question performance without inventing data", () => {
    expect(answerOutcomeSummary({
      course_id: "course",
      learner_count: 3,
      attempt_count: 10,
      not_enough_data: false,
      signals: [],
      concept_performance: [],
      clip_performance: [],
      activity_history: [],
      mastery_distribution: { mastered: 0, practiced: 0, struggling: 0, not_started: 0 },
      topic_health: [],
      priorities: [],
      question_performance: [{
        question_id: "question",
        prompt: "Prompt",
        attempts: 10,
        incorrect_attempts: 3,
        low_confidence_correct_attempts: 2,
      }],
    })).toEqual({
      attempts: 10,
      confident_correct: 5,
      unsure_correct: 2,
      incorrect: 3,
    });
  });

  it("keeps evidence percentages honest and prevents duplicate specialist work", () => {
    const priority: CoursePriority = {
      id: "priority",
      title: "Clarify the learning curve",
      summary: "Confidence remains low.",
      severity: "high",
      score: 100,
      specialist_role: "learning_analyst",
      target_artifact_type: "topic",
      target_artifact_id: "topic-row",
      target_logical_artifact_id: "topic-logical",
      affected_learners: 2,
      evidence_count: 5,
      evidence: {},
      recommended_action: "Prepare a focused change.",
    };
    const task: CourseAgentTask = {
      id: "task",
      specialist_role: "learning_analyst",
      task_type: "prepare_improvement",
      target_artifact_type: "topic",
      target_logical_artifact_id: "topic-logical",
      request_context: {},
      evidence_snapshot: {},
      status: "running",
      result: null,
      proposal_ids: [],
      error_message: null,
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
    };

    expect(performancePercent(3, 5)).toBe(60);
    expect(performancePercent(1, 0)).toBe(0);
    expect(canPrepareImprovement(priority, [])).toBe(true);
    expect(canPrepareImprovement(priority, [task])).toBe(false);
  });
});
