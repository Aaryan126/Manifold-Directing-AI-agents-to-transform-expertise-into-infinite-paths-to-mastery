import { describe, expect, it } from "vitest";

import { mapToFlow } from "../app/app/courses/[courseId]/course-studio";
import type { CourseMap } from "../app/app/course-os";

const courseMap: CourseMap = {
  course_id: "course",
  revision_id: "revision",
  nodes: [
    { id: "topic-1", logical_id: "topic-logical-1", kind: "topic", title: "Forces", status: "accepted", topic_id: null, metadata: {} },
    { id: "topic-2", logical_id: "topic-logical-2", kind: "topic", title: "Motion", status: "accepted", topic_id: null, metadata: {} },
    { id: "concept-1", logical_id: "concept-logical-1", kind: "concept", title: "Net force", status: "accepted", topic_id: "topic-1", metadata: {} },
    { id: "concept-2", logical_id: "concept-logical-2", kind: "concept", title: "Vector addition", status: "accepted", topic_id: "topic-1", metadata: {} },
    { id: "concept-3", logical_id: "concept-logical-3", kind: "concept", title: "Acceleration", status: "accepted", topic_id: "topic-2", metadata: {} },
  ],
  edges: [
    { id: "edge-1", logical_id: "edge-logical-1", source_id: "concept-2", target_id: "concept-3", kind: "requires", status: "accepted" },
  ],
};

describe("Course Map overview", () => {
  it("shows every topic and concept with containment and prerequisite detail", () => {
    const graph = mapToFlow(courseMap, null, null);

    expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "topic-1",
      "topic-2",
      "concept-1",
      "concept-2",
      "concept-3",
    ]));
    expect(graph.edges.filter((edge) => edge.id.startsWith("topic-"))).toHaveLength(3);
    expect(graph.edges.some((edge) => edge.id === "edge-1")).toBe(true);
  });
});
