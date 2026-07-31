import { describe, expect, it } from "vitest";
import {
  answerOutcomeSummary,
  availableBlueprintRelationshipKinds,
  blueprintHierarchyEdges,
  blueprintNodeDimensions,
  blueprintNodeLayer,
  blueprintConceptNeighborhoodIds,
  coreBlueprintEdgeKinds,
  buildBlueprintTopicLanes,
  canPrepareImprovement,
  compareBlueprintSequence,
  courseState,
  directBlueprintNeighborhood,
  evidenceTitle,
  findBlueprintClip,
  generationPhaseLabel,
  isValidBlueprintRelationshipTarget,
  orderedGenerationTasks,
  packBlueprintHierarchyComponents,
  performancePercent,
  reorderBlueprintConcepts,
  resolveGeneratedLectureHandoff,
  resolveCurrentBlueprintNode,
  resolveBlueprintNodeOverlaps,
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
  type AssessmentWorkspace,
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
  it("resolves a painted artifact to the current revision by stable logical identity", () => {
    const currentTopic: BlueprintNode = {
      id: "topic-working",
      logical_id: "topic-logical",
      kind: "topic",
      title: "Current topic",
      status: "accepted",
      parent_id: null,
      metadata: {},
    };
    const blueprint: CourseBlueprint = {
      course_id: "course",
      revision_id: "working-revision",
      revision_kind: "working",
      nodes: [currentTopic],
      edges: [],
      uncovered_concept_ids: [],
    };

    expect(resolveCurrentBlueprintNode(blueprint, {
      id: "topic-active",
      logical_id: "topic-logical",
    })).toBe(currentTopic);
  });

  it("resolves a live Blueprint clip to its cloned working-revision preview", () => {
    const node: BlueprintNode = {
      id: "clip-active",
      logical_id: "clip-logical",
      kind: "clip",
      title: "Explanation",
      status: "accepted",
      parent_id: "topic-active",
      metadata: { start_seconds: 8.66, end_seconds: 187.9 },
    };
    const clips: AssessmentWorkspace["clips"] = [{
      id: "clip-working",
      topic_id: "topic-working",
      topic_title: "Rapid learning",
      video_id: "video-1",
      label: "Rapid learning · explanation",
      start_seconds: 8.66,
      end_seconds: 187.9,
      type: "explanation",
      difficulty: "introductory",
      status: "active",
      playback_provider: "local",
      playback_id: null,
      playback_url: "/videos/video-1/media",
      delivery_asset_id: null,
      materialization_status: "source_reference",
    }];

    expect(findBlueprintClip(node, clips)?.id).toBe("clip-working");
  });

  it("prioritizes failed and finalized-draft states over a generic draft label", () => {
    expect(courseState({ ...course, generation_status: "failed" }).label).toBe("Needs help");
    expect(courseState({ ...course, pending_review_count: 12 }).label).toBe("Draft ready");
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

  it("isolates only a Blueprint artifact's direct, non-dismissed relationships", () => {
    const node = (id: string, kind: BlueprintNode["kind"] = "concept"): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind,
      title: id,
      status: "accepted",
      parent_id: null,
      metadata: {},
    });
    const blueprint: CourseBlueprint = {
      course_id: "course",
      revision_id: "revision",
      revision_kind: "active",
      nodes: [
        node("focus"),
        node("topic", "topic"),
        node("prerequisite"),
        node("clip", "clip"),
        node("question", "question"),
        node("source", "source"),
        node("second-degree"),
        node("dismissed"),
        node("isolated"),
      ],
      edges: [
        { id: "contains", source_id: "topic", target_id: "focus", kind: "contains", status: "accepted" },
        { id: "requires", source_id: "focus", target_id: "prerequisite", kind: "requires", status: "accepted" },
        { id: "teaches", source_id: "clip", target_id: "focus", kind: "teaches", status: "accepted" },
        { id: "assesses", source_id: "question", target_id: "focus", kind: "assesses", status: "proposed" },
        { id: "cites", source_id: "source", target_id: "focus", kind: "cites", status: "accepted" },
        { id: "second-degree", source_id: "prerequisite", target_id: "second-degree", kind: "next", status: "accepted" },
        { id: "dismissed", source_id: "focus", target_id: "dismissed", kind: "requires", status: "dismissed" },
      ],
      uncovered_concept_ids: [],
    };

    const neighborhood = directBlueprintNeighborhood(blueprint, "focus");

    expect([...neighborhood.nodeIds].sort()).toEqual([
      "clip",
      "focus",
      "prerequisite",
      "question",
      "source",
      "topic",
    ]);
    expect([...neighborhood.edgeIds].sort()).toEqual([
      "assesses",
      "cites",
      "contains",
      "requires",
      "teaches",
    ]);
    expect(directBlueprintNeighborhood(blueprint, "isolated")).toEqual({
      edgeIds: new Set(),
      nodeIds: new Set(["isolated"]),
    });
    expect(directBlueprintNeighborhood(blueprint, "missing")).toEqual({
      edgeIds: new Set(),
      nodeIds: new Set(),
    });
  });

  it("uses only the instructional hierarchy as the Blueprint layout spine", () => {
    const node = (
      id: string,
      kind: BlueprintNode["kind"],
      parentId: string | null = null,
      rank = 1,
    ): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind,
      title: id,
      status: "accepted",
      parent_id: parentId,
      metadata: { sequence_rank: rank },
    });
    const nodes = [
      node("source", "source"),
      node("topic-a", "topic", null, 1),
      node("topic-b", "topic", null, 2),
      node("concept-a", "concept", "topic-a", 1),
      node("concept-b", "concept", "topic-b", 2),
      node("clip", "clip", "topic-a"),
      node("question", "question", "topic-a"),
    ];
    const edges = [
      { id: "contains-a", source_id: "topic-a", target_id: "concept-a", kind: "contains", status: "accepted" },
      { id: "teaches", source_id: "clip", target_id: "concept-a", kind: "teaches", status: "accepted" },
      { id: "assesses", source_id: "question", target_id: "concept-a", kind: "assesses", status: "accepted" },
      { id: "requires", source_id: "concept-a", target_id: "concept-b", kind: "requires", status: "accepted" },
      { id: "next", source_id: "concept-a", target_id: "concept-b", kind: "next", status: "accepted" },
      { id: "cites", source_id: "source", target_id: "concept-a", kind: "cites", status: "accepted" },
    ] satisfies CourseBlueprint["edges"];

    expect(blueprintHierarchyEdges(nodes, edges)).toEqual([
      {
        id: "contains-a",
        source_id: "topic-a",
        target_id: "concept-a",
        semantic_edge_id: "contains-a",
      },
      {
        id: "teaches",
        source_id: "concept-a",
        target_id: "clip",
        semantic_edge_id: "teaches",
      },
      {
        id: "assesses",
        source_id: "concept-a",
        target_id: "question",
        semantic_edge_id: "assesses",
      },
      {
        id: "layout:contains:topic-b:concept-b",
        source_id: "topic-b",
        target_id: "concept-b",
        semantic_edge_id: null,
      },
      {
        id: "layout:source:source:topic-a",
        source_id: "source",
        target_id: "topic-a",
        semantic_edge_id: null,
      },
      {
        id: "layout:source:source:topic-b",
        source_id: "source",
        target_id: "topic-b",
        semantic_edge_id: null,
      },
    ]);
  });

  it("expands Blueprint node height until long titles fit", () => {
    const node = (title: string, kind: BlueprintNode["kind"]): BlueprintNode => ({
      id: `${kind}-${title}`,
      logical_id: `logical-${kind}-${title}`,
      kind,
      title,
      status: "accepted",
      parent_id: null,
      metadata: {},
    });

    expect(blueprintNodeDimensions(node("Short topic", "topic"))).toEqual({
      width: 260,
      height: 108,
    });
    expect(blueprintNodeDimensions(node(
      "Audience composition, expectations, teaching team, and case study introduction",
      "topic",
    )).height).toBeGreaterThan(108);
    const longQuestion = blueprintNodeDimensions(node(
      "In the ukulele example, why did the speaker focus on learning only a small set of chords before performing?",
      "question",
    ));
    expect(longQuestion.width).toBeGreaterThan(210);
    expect(longQuestion.width).toBeLessThanOrEqual(320);
    expect(longQuestion.height).toBeGreaterThan(98);
  });

  it("separates saved Blueprint positions when dynamic nodes would overlap", () => {
    const node = (id: string, title: string): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind: "question",
      title,
      status: "accepted",
      parent_id: null,
      metadata: {},
    });
    const first = node("first", "A long assessment question that needs a wider card");
    const second = node("second", "Another long assessment question that starts in the same position");
    const resolved = resolveBlueprintNodeOverlaps(
      [first, second],
      {
        first: { x: 100, y: 200 },
        second: { x: 100, y: 200 },
      },
    );
    const firstDimensions = blueprintNodeDimensions(first);

    expect(resolved.first).toEqual({ x: 100, y: 200 });
    expect(resolved.second.x).toBeGreaterThanOrEqual(
      resolved.first.x + firstDimensions.width + 32,
    );
    expect(resolved.second.y).toBe(200);
  });

  it("compacts disconnected Blueprint hierarchy groups without changing their internal layout", () => {
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
    const nodes = [
      node("topic-a", "topic", 0),
      node("concept-a", "concept", 0),
      node("clip-a", "clip", 0),
      node("topic-b", "topic", 1),
      node("concept-b", "concept", 1),
      node("question-b", "question", 1),
      node("topic-c", "topic", 2),
      node("concept-c", "concept", 2),
      node("clip-c", "clip", 2),
    ];
    const edges = [
      { id: "a-contains", source_id: "topic-a", target_id: "concept-a", semantic_edge_id: "a-contains" },
      { id: "a-teaches", source_id: "concept-a", target_id: "clip-a", semantic_edge_id: "a-teaches" },
      { id: "b-contains", source_id: "topic-b", target_id: "concept-b", semantic_edge_id: "b-contains" },
      { id: "b-assesses", source_id: "concept-b", target_id: "question-b", semantic_edge_id: "b-assesses" },
      { id: "c-contains", source_id: "topic-c", target_id: "concept-c", semantic_edge_id: "c-contains" },
      { id: "c-teaches", source_id: "concept-c", target_id: "clip-c", semantic_edge_id: "c-teaches" },
    ];
    const positions: Record<string, { x: number; y: number }> = {
      "topic-a": { x: 0, y: 0 },
      "concept-a": { x: 20, y: 210 },
      "clip-a": { x: 30, y: 420 },
      "topic-b": { x: 4200, y: 2600 },
      "concept-b": { x: 4220, y: 2810 },
      "question-b": { x: 4230, y: 3020 },
      "topic-c": { x: 8200, y: 0 },
      "concept-c": { x: 8220, y: 210 },
      "clip-c": { x: 8230, y: 420 },
    };

    const packed = packBlueprintHierarchyComponents(nodes, edges, positions);
    expect(packed).not.toBe(positions);
    expect(packed["concept-b"].x - packed["topic-b"].x).toBe(20);
    expect(packed["concept-b"].y - packed["topic-b"].y).toBe(210);
    expect(packed["question-b"].y - packed["concept-b"].y).toBe(210);

    const originalWidth = Math.max(...nodes.map((item) => (
      positions[item.id].x + blueprintNodeDimensions(item).width
    ))) - Math.min(...nodes.map((item) => positions[item.id].x));
    const packedWidth = Math.max(...nodes.map((item) => (
      packed[item.id].x + blueprintNodeDimensions(item).width
    ))) - Math.min(...nodes.map((item) => packed[item.id].x));
    expect(packedWidth).toBeLessThan(originalWidth / 2);

    const rectangles = nodes.map((item) => ({
      ...blueprintNodeDimensions(item),
      ...packed[item.id],
    }));
    rectangles.forEach((left, leftIndex) => {
      rectangles.slice(leftIndex + 1).forEach((right) => {
        expect(
          left.x < right.x + right.width
          && left.x + left.width > right.x
          && left.y < right.y + right.height
          && left.y + left.height > right.y,
        ).toBe(false);
      });
    });
  });

  it("offers only meaningful Blueprint relationships and valid typed targets", () => {
    const node = (
      id: string,
      kind: BlueprintNode["kind"],
    ): BlueprintNode => ({
      id,
      logical_id: `logical-${id}`,
      kind,
      title: id,
      status: "accepted",
      parent_id: null,
      metadata: {},
    });
    const topic = node("topic", "topic");
    const concept = node("concept", "concept");
    const conceptTwo = node("concept-two", "concept");
    const clip = node("clip", "clip");
    const question = node("question", "question");
    const source = node("source", "source");

    expect(availableBlueprintRelationshipKinds(topic)).toEqual(["contains", "cites"]);
    expect(availableBlueprintRelationshipKinds(concept)).toEqual([
      "requires",
      "teaches",
      "assesses",
      "cites",
    ]);
    expect(availableBlueprintRelationshipKinds(source)).toEqual([]);
    expect(isValidBlueprintRelationshipTarget(topic, concept, "contains")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(concept, conceptTwo, "requires")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(concept, clip, "teaches")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(concept, question, "assesses")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(question, clip, "remediates_to")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(question, concept, "remediates_to")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(concept, source, "cites")).toBe(true);
    expect(isValidBlueprintRelationshipTarget(concept, concept, "requires")).toBe(false);
    expect(isValidBlueprintRelationshipTarget(question, topic, "remediates_to")).toBe(false);
    expect(isValidBlueprintRelationshipTarget(source, concept, "cites")).toBe(false);
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
    expect(generationPhaseLabel("review_bundles")).toBe("Finalizing your editable draft");
    expect(generationPhaseLabel("draft_ready")).toBe("Your editable private draft is ready");
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

  it("opens a completed generated lecture through its private Design revision", () => {
    const flow = {
      course_id: course.id,
      revision_id: "working-revision",
      revision_kind: "working" as const,
      modules: [],
      units: [
        {
          id: "lecture-1",
          logical_id: "lecture-1",
          module_logical_id: null,
          kind: "lecture" as const,
          title: "Existing lecture",
          summary: "",
          instructions: "",
          video_id: "video-1",
          sequence_rank: 0,
          status: "accepted",
          topic_count: 2,
          concept_count: 3,
          question_count: 2,
          source_count: 1,
          concept_logical_ids: [],
          x: null,
          y: null,
        },
        {
          id: "lecture-2",
          logical_id: "lecture-2",
          module_logical_id: null,
          kind: "lecture" as const,
          title: "New lecture",
          summary: "",
          instructions: "",
          video_id: "video-2",
          sequence_rank: 1,
          status: "accepted",
          topic_count: 4,
          concept_count: 6,
          question_count: 4,
          source_count: 1,
          concept_logical_ids: [],
          x: null,
          y: null,
        },
      ],
      edges: [],
    };

    expect(resolveGeneratedLectureHandoff(flow, "video-2")).toEqual({
      videoId: "video-2",
      mode: "design",
    });
    expect(resolveGeneratedLectureHandoff(flow, "missing-video")).toEqual({
      videoId: "video-2",
      mode: "design",
    });
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
