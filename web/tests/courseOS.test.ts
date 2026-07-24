import { describe, expect, it } from "vitest";
import {
  answerOutcomeSummary,
  blueprintNodeLayer,
  blueprintConceptNeighborhoodIds,
  coreBlueprintEdgeKinds,
  buildBlueprintTopicLanes,
  canPrepareImprovement,
  compareBlueprintSequence,
  courseState,
  evidenceTitle,
  generationPhaseLabel,
  orderedGenerationTasks,
  performancePercent,
  reorderBlueprintConcepts,
  masteryStateForConcept,
  shouldHydrateGenerationRun,
  shouldCenterCreationComposer,
  studioPresentationMode,
  topicLogicalIdsForConcept,
  visibleBlueprintNodeIds,
  visibleBlueprintEdges,
  type BlueprintConceptEvidence,
  type BlueprintNode,
  type CourseBlueprint,
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

  it("keeps Blueprint order and mastery presentation grounded in saved evidence", () => {
    const node = (id: string, rank: number): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind: "concept",
      title: id,
      status: "accepted",
      parent_id: null,
      metadata: { sequence_rank: rank },
    });
    const evidence: BlueprintConceptEvidence[] = [{
      concept_id: "concept-2",
      attempts: 2,
      touched_learners: 1,
      correct_percent: 50,
      confident_percent: 100,
      confident_incorrect: 1,
      mastery: { struggling: 1 },
      route_actions: { remediate: 1 },
    }];

    expect([node("concept-2", 2), node("concept-1", 1)].sort(compareBlueprintSequence)
      .map((item) => item.id)).toEqual(["concept-1", "concept-2"]);
    expect(masteryStateForConcept("concept-1", evidence)).toBe("not_started");
    expect(masteryStateForConcept("concept-2", evidence)).toBe("struggling");
  });

  it("keeps the whole-course Blueprint on semantic layers with contextual detail", () => {
    expect((["source", "topic", "concept", "clip", "question"] satisfies CourseBlueprint["nodes"][number]["kind"][])
      .map(blueprintNodeLayer))
      .toEqual([0, 1, 2, 3, 3]);
    const edges = [
      { id: "contains", source_id: "topic", target_id: "concept", kind: "contains", status: "accepted" },
      { id: "cites", source_id: "concept", target_id: "source", kind: "cites", status: "accepted" },
      { id: "remediation", source_id: "question", target_id: "clip", kind: "remediates_to", status: "accepted" },
    ] satisfies CourseBlueprint["edges"];

    expect(visibleBlueprintEdges(edges, coreBlueprintEdgeKinds, null).map((edge) => edge.id))
      .toEqual(["contains"]);
    expect(visibleBlueprintEdges(edges, coreBlueprintEdgeKinds, "concept").map((edge) => edge.id))
      .toEqual(["contains", "cites"]);
  });

  it("builds topic swimlanes with shared concept aliases and artifact coverage", () => {
    const node = (
      id: string,
      kind: BlueprintNode["kind"],
      rank: number,
    ): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind,
      title: id,
      status: "accepted",
      parent_id: null,
      metadata: { sequence_rank: rank },
    });
    const topicA = node("topic-a", "topic", 0);
    const topicB = node("topic-b", "topic", 1);
    const conceptA = node("concept-a", "concept", 0);
    const conceptB = node("concept-b", "concept", 1);
    const clip = node("clip-a", "clip", 0);
    const question = node("question-a", "question", 0);
    const blueprint: CourseBlueprint = {
      course_id: "course",
      revision_id: "revision",
      revision_kind: "active",
      nodes: [topicA, topicB, conceptA, conceptB, clip, question],
      edges: [
        { id: "a", source_id: topicA.id, target_id: conceptA.id, kind: "contains", status: "accepted" },
        { id: "b", source_id: topicB.id, target_id: conceptA.id, kind: "contains", status: "accepted" },
        { id: "c", source_id: topicB.id, target_id: conceptB.id, kind: "contains", status: "accepted" },
        { id: "d", source_id: conceptA.id, target_id: clip.id, kind: "teaches", status: "accepted" },
        { id: "e", source_id: question.id, target_id: conceptA.id, kind: "assesses", status: "accepted" },
      ],
      uncovered_concept_ids: [],
    };

    const lanes = buildBlueprintTopicLanes(blueprint, []);

    expect(lanes).toHaveLength(2);
    expect(lanes[0].concepts[0]).toMatchObject({
      id: "occurrence:logical-topic-a:logical-concept-a",
      sharedTopicCount: 2,
      clipCount: 1,
      questionCount: 1,
    });
    expect(topicLogicalIdsForConcept(blueprint, conceptA.id)).toEqual([
      topicA.logical_id,
      topicB.logical_id,
    ]);
    expect(blueprintConceptNeighborhoodIds(blueprint, conceptA.id)).toEqual(
      new Set([conceptA.id, topicA.id, topicB.id, clip.id, question.id]),
    );
  });

  it("reorders a concept once even when it is represented in multiple topic lanes", () => {
    const concept = (id: string, rank: number): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind: "concept",
      title: id,
      status: "accepted",
      parent_id: null,
      metadata: { sequence_rank: rank },
    });
    const concepts = [concept("a", 0), concept("b", 1), concept("c", 2)];

    expect(reorderBlueprintConcepts(concepts, "logical-c", "logical-b")).toEqual([
      "logical-a",
      "logical-c",
      "logical-b",
    ]);
  });

  it("limits a 300-concept Blueprint to the selected topic's visible neighborhood", () => {
    const topics: BlueprintNode[] = Array.from({ length: 60 }, (_, index) => ({
      id: `topic-${index}`,
      logical_id: `topic-logical-${index}`,
      kind: "topic",
      title: `Topic ${index}`,
      status: "accepted",
      parent_id: null,
      metadata: {},
    }));
    const concepts: BlueprintNode[] = Array.from({ length: 300 }, (_, index) => ({
      id: `concept-${index}`,
      logical_id: `concept-logical-${index}`,
      kind: "concept",
      title: `Concept ${index}`,
      status: "accepted",
      parent_id: `topic-${Math.floor(index / 5)}`,
      metadata: { sequence_rank: index },
    }));
    const blueprint: CourseBlueprint = {
      course_id: "course",
      revision_id: "revision",
      revision_kind: "active",
      nodes: [...topics, ...concepts],
      edges: [
        ...concepts.map((concept, index) => ({
          id: `contains-${index}`,
          source_id: `topic-${Math.floor(index / 5)}`,
          target_id: concept.id,
          kind: "contains" as const,
          status: "accepted",
        })),
        ...concepts.slice(1).map((concept, index) => ({
          id: `next-${index}`,
          source_id: concepts[index].id,
          target_id: concept.id,
          kind: "next" as const,
          status: "accepted",
        })),
      ],
      uncovered_concept_ids: [],
    };

    const started = performance.now();
    const visible = visibleBlueprintNodeIds(blueprint, "topic-logical-30");

    expect(visible?.size).toBe(8);
    expect(visible?.has("topic-30")).toBe(true);
    expect(visible?.has("concept-150")).toBe(true);
    expect(visible?.has("concept-149")).toBe(true);
    expect(visible?.has("concept-155")).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
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
    expect(canPrepareImprovement(priority, [{ ...task, status: "waiting_review" }])).toBe(false);
  });
});
