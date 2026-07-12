import { z } from "zod";

export const healthResponseSchema = z.object({
  service: z.string(),
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const conceptEdgeSchema = z.object({
  fromConceptId: z.string().uuid(),
  toConceptId: z.string().uuid(),
  relationship: z.literal("requires"),
});

export type ConceptEdge = z.infer<typeof conceptEdgeSchema>;
