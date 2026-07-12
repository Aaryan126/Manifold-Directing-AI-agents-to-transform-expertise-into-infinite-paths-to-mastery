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

export function graphNodeModels(concepts: Concept[]): GraphNodeModel[] {
  return concepts.map((concept, index) => ({
    id: concept.id,
    label: concept.name,
    description: concept.description ?? "",
    muted: concept.review_status === "dismissed",
    status: concept.review_status,
    x: (index % 3) * 260,
    y: Math.floor(index / 3) * 150,
  }));
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
