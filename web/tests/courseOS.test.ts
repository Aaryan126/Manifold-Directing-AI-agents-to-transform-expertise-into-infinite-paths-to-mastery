import { describe, expect, it } from "vitest";
import {
  courseState,
  evidenceTitle,
  generationPhaseLabel,
  shouldHydrateGenerationRun,
  type CourseSummary,
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

  it("does not hydrate a completed or cancelled run as active generation", () => {
    const withRun = { ...course, generation_run_id: "run" };

    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "running" })).toBe(true);
    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "waiting_review" })).toBe(true);
    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "complete" })).toBe(false);
    expect(shouldHydrateGenerationRun({ ...withRun, generation_status: "cancelled" })).toBe(false);
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
});
