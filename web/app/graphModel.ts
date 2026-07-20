export type ConceptReviewStatus = "proposed" | "accepted" | "edited" | "dismissed";

export type Concept = {
  id: string;
  name: string;
  description: string | null;
  review_status: ConceptReviewStatus;
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
  merged_into_concept_id: string | null;
};

export type ConceptEdge = {
  id: string;
  from_concept_id: string;
  to_concept_id: string;
  review_status: ConceptReviewStatus;
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
};

export type GraphNodeModel = {
  id: string;
  label: string;
  description: string;
  muted: boolean;
  status: ConceptReviewStatus;
  topicLabel: string;
  topicColorIndex: number;
  x: number;
  y: number;
};

export type GraphEdgeModel = {
  id: string;
  source: string;
  target: string;
  muted: boolean;
  status: ConceptReviewStatus;
};

export type GraphTopic = {
  id: string;
  title: string;
};

export function graphNodeModels(
  concepts: Concept[],
  topics: GraphTopic[] = [],
): GraphNodeModel[] {
  const topicIndexes = new Map(topics.map((topic, index) => [topic.id, index]));
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));
  const grouped = concepts
    .map((concept) => {
      const topicIds = conceptTopicIds(concept);
      const primaryTopicId = topicIds
        .filter((topicId) => topicIndexes.has(topicId))
        .sort((first, second) => topicIndexes.get(first)! - topicIndexes.get(second)!)[0];
      return {
        concept,
        groupIndex: primaryTopicId === undefined
          ? topics.length
          : topicIndexes.get(primaryTopicId)!,
        topicLabel: primaryTopicId === undefined
          ? "Unlinked"
          : `${topicTitles.get(primaryTopicId)}${topicIds.length > 1 ? ` +${topicIds.length - 1}` : ""}`,
      };
    })
    .sort((first, second) =>
      first.groupIndex - second.groupIndex || first.concept.name.localeCompare(second.concept.name),
    );
  const visibleGroupIndexes = [...new Set(grouped.map((item) => item.groupIndex))];
  const displayIndexes = new Map(
    visibleGroupIndexes.map((groupIndex, displayIndex) => [groupIndex, displayIndex]),
  );
  const rowsByGroup = new Map<number, number>();
  return grouped.map(({ concept, groupIndex, topicLabel }) => {
    const row = rowsByGroup.get(groupIndex) ?? 0;
    rowsByGroup.set(groupIndex, row + 1);
    return {
      id: concept.id,
      label: concept.name,
      description: concept.description ?? "",
      muted: concept.review_status === "dismissed",
      status: concept.review_status,
      topicLabel,
      topicColorIndex: groupIndex === topics.length ? -1 : groupIndex,
      x: displayIndexes.get(groupIndex)! * 260,
      y: row * 150,
    };
  });
}

export function graphEdgeModels(edges: ConceptEdge[]): GraphEdgeModel[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.from_concept_id,
    target: edge.to_concept_id,
    muted: edge.review_status === "dismissed",
    status: edge.review_status,
  }));
}

export function focusedConceptIds(
  concepts: Concept[],
  edges: ConceptEdge[],
  topicId: string,
): Set<string> {
  if (topicId === "all") return new Set(concepts.map((concept) => concept.id));
  const availableIds = new Set(concepts.map((concept) => concept.id));
  const focusedIds = new Set(
    concepts
      .filter((concept) => conceptTopicIds(concept).includes(topicId))
      .map((concept) => concept.id),
  );
  const originalFocusedIds = new Set(focusedIds);
  for (const edge of edges) {
    if (originalFocusedIds.has(edge.from_concept_id) && availableIds.has(edge.to_concept_id)) {
      focusedIds.add(edge.to_concept_id);
    }
    if (originalFocusedIds.has(edge.to_concept_id) && availableIds.has(edge.from_concept_id)) {
      focusedIds.add(edge.from_concept_id);
    }
  }
  return focusedIds;
}

function conceptTopicIds(concept: Concept): string[] {
  const revisedTopicIds = concept.instructor_revision?.topic_ids;
  const topicIds = Array.isArray(revisedTopicIds)
    ? revisedTopicIds
    : concept.ai_proposal?.topic_ids;
  return Array.isArray(topicIds)
    ? topicIds.filter((topicId): topicId is string => typeof topicId === "string")
    : [];
}
