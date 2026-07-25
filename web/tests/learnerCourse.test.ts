import { describe, expect, it } from "vitest";

import {
  courseProgressPercent,
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
    expect(courseProgressPercent({
      id: "course-1",
      title: "Course",
      description: null,
      enrolled: true,
      topic_count: 2,
      concept_count: 4,
      mastered_concept_count: 3,
    })).toBe(75);
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
});
