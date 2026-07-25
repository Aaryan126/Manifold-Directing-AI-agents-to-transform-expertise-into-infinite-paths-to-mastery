import { describe, expect, it } from "vitest";

import {
  courseCompositionLabels,
  courseProgressPercent,
  learnerPathVisualState,
  nextTopicId,
  topicForDecision,
  type LearnerCourseExperience,
  type LearnerProgress,
} from "../app/learn/learner-course";

const course: LearnerCourseExperience = {
  id: "course-1",
  title: "Course",
  description: null,
  units: [],
  topics: [
    { id: "topic-1", video_id: "video-1", title: "One", summary: null },
    { id: "topic-2", video_id: "video-1", title: "Two", summary: null },
  ],
  clips: [{
    id: "clip-2",
    topic_id: "topic-2",
    video_id: "video-1",
    title: "Support",
    start_seconds: 10,
    end_seconds: 20,
    type: "explanation",
    difficulty: null,
    playback_provider: "local",
    playback_id: null,
    playback_url: "/videos/video-1/media",
    delivery_asset_id: null,
    materialization_status: "ready",
  }],
  questions: [],
  resources: [],
};

const progress: LearnerProgress[] = [
  { concept_id: "concept-1", name: "One", state: "mastered", topic_id: "topic-1" },
  { concept_id: "concept-2", name: "Two", state: "not_started", topic_id: "topic-2" },
];

describe("learner course routing presentation", () => {
  it("resumes at the first unfinished topic and calculates portfolio progress", () => {
    expect(nextTopicId(course, progress)).toBe("topic-2");
    const summary = {
      id: "course-1",
      title: "Course",
      description: null,
      enrolled: true,
      topic_count: 2,
      concept_count: 4,
      mastered_concept_count: 3,
      lecture_count: 2,
      quiz_count: 1,
      assignment_count: 2,
    };
    expect(courseProgressPercent(summary)).toBe(75);
    expect(courseCompositionLabels(summary)).toEqual([
      "2 lectures",
      "1 quiz",
      "2 assignments",
    ]);
  });

  it("follows the routing engine's reviewed clip target", () => {
    expect(topicForDecision({
      action: "remediate",
      mastery_state: "struggling",
      why: "Review",
      target_concept_id: null,
      target_clip_id: "clip-2",
      dashboard_signal_id: null,
    }, course, progress, "topic-1")).toBe("topic-2");
  });

  it("keeps mastery separate from recommendation and prerequisite access", () => {
    const base = {
      concept_id: "concept-1",
      name: "Concept",
      description: "",
      sequence_rank: 1,
      state: "not_started" as const,
      topic_id: "topic-1",
      topic_title: "Topic",
      prerequisite_ids: [],
      clip_ids: [],
      question_ids: [],
      aids: [],
      eligible: true,
      current: false,
    };

    expect(learnerPathVisualState({ ...base, current: true }, "concept-1"))
      .toBe("recommended");
    expect(learnerPathVisualState({ ...base, state: "struggling" }, "concept-1"))
      .toBe("review");
    expect(learnerPathVisualState(base, "concept-2")).toBe("ready");
    expect(learnerPathVisualState({ ...base, eligible: false }, "concept-2"))
      .toBe("blocked");
    expect(learnerPathVisualState({
      ...base,
      eligible: false,
      state: "mastered",
    }, "concept-2")).toBe("mastered");
  });
});
