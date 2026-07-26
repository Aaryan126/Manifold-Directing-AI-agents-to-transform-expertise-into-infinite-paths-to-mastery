import { describe, expect, it } from "vitest";

import {
  activeTranscriptWordIndex,
  clipTranscriptWords,
  courseCompositionLabels,
  courseProgressPercent,
  learnerMasteryConnections,
  learnerMasteryFocusIds,
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

  it("builds true prerequisite branches and merges without inventing topic links", () => {
    const item = (conceptId: string, rank: number, prerequisiteIds: string[]) => ({
      concept_id: conceptId,
      name: conceptId,
      description: "",
      sequence_rank: rank,
      state: "not_started" as const,
      topic_id: "topic-1",
      topic_title: "Topic",
      prerequisite_ids: prerequisiteIds,
      clip_ids: ["clip-1"],
      question_ids: ["question-1"],
      aids: [],
      eligible: true,
      actionable: true,
      coverage_state: "complete" as const,
      current: false,
    });
    expect(learnerMasteryConnections([
      item("foundation", 1, []),
      item("branch-a", 2, ["foundation"]),
      item("branch-b", 3, ["foundation"]),
      item("merge", 4, ["branch-a", "branch-b"]),
    ])).toEqual([
      {
        id: "prerequisite:foundation:branch-a",
        source: "foundation",
        target: "branch-a",
        kind: "prerequisite",
      },
      {
        id: "prerequisite:foundation:branch-b",
        source: "foundation",
        target: "branch-b",
        kind: "prerequisite",
      },
      {
        id: "prerequisite:branch-a:merge",
        source: "branch-a",
        target: "merge",
        kind: "prerequisite",
      },
      {
        id: "prerequisite:branch-b:merge",
        source: "branch-b",
        target: "merge",
        kind: "prerequisite",
      },
    ]);
  });

  it("uses a dashed sequence connector only for a disconnected course step", () => {
    const disconnected = ["one", "two"].map((conceptId, index) => ({
      concept_id: conceptId,
      name: conceptId,
      description: "",
      sequence_rank: index + 1,
      state: "not_started" as const,
      topic_id: "topic-1",
      topic_title: "Topic",
      prerequisite_ids: [],
      clip_ids: [],
      question_ids: [],
      aids: [],
      eligible: true,
      current: false,
    }));
    expect(learnerMasteryConnections(disconnected)).toEqual([{
      id: "sequence:one:two",
      source: "one",
      target: "two",
      kind: "sequence",
    }]);
  });

  it("does not add course-order context that would cycle against prerequisites", () => {
    const base = {
      description: "",
      state: "not_started" as const,
      topic_id: "topic-1",
      topic_title: "Topic",
      clip_ids: [],
      question_ids: [],
      aids: [],
      eligible: true,
      current: false,
    };
    expect(learnerMasteryConnections([
      {
        ...base,
        concept_id: "dependent",
        name: "Dependent",
        sequence_rank: 1,
        prerequisite_ids: ["foundation"],
      },
      {
        ...base,
        concept_id: "foundation",
        name: "Foundation",
        sequence_rank: 2,
        prerequisite_ids: [],
      },
    ])).toEqual([{
      id: "prerequisite:foundation:dependent",
      source: "foundation",
      target: "dependent",
      kind: "prerequisite",
    }]);
  });

  it("focuses mastery on the current concept and its nearest graph neighborhood", () => {
    const item = (conceptId: string, rank: number, prerequisiteIds: string[]) => ({
      concept_id: conceptId,
      name: conceptId,
      description: "",
      sequence_rank: rank,
      state: "not_started" as const,
      topic_id: "topic-1",
      topic_title: "Topic",
      prerequisite_ids: prerequisiteIds,
      clip_ids: ["clip-1"],
      question_ids: ["question-1"],
      aids: [],
      eligible: true,
      actionable: true,
      coverage_state: "complete" as const,
      current: conceptId === "current",
    });
    const items = [
      item("foundation", 1, []),
      item("current", 2, ["foundation"]),
      item("branch-a", 3, ["current"]),
      item("branch-b", 4, ["current"]),
      item("later", 5, ["branch-a", "branch-b"]),
      item("much-later", 6, ["later"]),
    ];
    expect(learnerMasteryFocusIds(items, "current")).toEqual([
      "current",
      "foundation",
      "branch-a",
      "branch-b",
      "later",
    ]);
  });

  it("rebases a clip transcript and finds the word active at playback time", () => {
    const words = clipTranscriptWords([
      { text: "before", start_seconds: 8, end_seconds: 9 },
      { text: "Learning", start_seconds: 10, end_seconds: 10.8 },
      { text: "adapts", start_seconds: 10.8, end_seconds: 12 },
      { text: "after", start_seconds: 13, end_seconds: 14 },
    ], 10, 12);

    expect(words.map((word) => word.text)).toEqual(["Learning", "adapts"]);
    expect(words[0]?.start_seconds).toBe(0);
    expect(words[0]?.end_seconds).toBeCloseTo(0.8);
    expect(words[1]?.start_seconds).toBeCloseTo(0.8);
    expect(words[1]?.end_seconds).toBe(2);
    expect(activeTranscriptWordIndex(words, 0.4)).toBe(0);
    expect(activeTranscriptWordIndex(words, 1.2)).toBe(1);
    expect(activeTranscriptWordIndex(words, 2.1)).toBe(-1);
  });
});
