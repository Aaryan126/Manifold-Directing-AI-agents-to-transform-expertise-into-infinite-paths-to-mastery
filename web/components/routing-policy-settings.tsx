"use client";

import { useState } from "react";
import { Check, ChevronDown, RotateCcw, Route, Sparkles } from "lucide-react";

import type { Concept, ConceptEdge } from "@/app/graphModel";
import {
  policyLabel,
  recommendedRoutingPolicy,
  recommendedRoutingProfile,
  routingPolicyForProfile,
  routingPolicyProfileLabels,
  routingProfileForPolicy,
  type RoutingPolicyDraft,
  type RoutingPolicyProfile,
} from "@/app/routingPolicy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RoutingPolicySettingsProps = {
  concepts: Concept[];
  drafts: Record<string, RoutingPolicyDraft>;
  edges: ConceptEdge[];
  isConfirmed: boolean;
  isSaving: boolean;
  onConfirm: () => void;
  onDraftChange: (conceptId: string, draft: RoutingPolicyDraft) => void;
};

const profiles: RoutingPolicyProfile[] = ["foundation", "standard", "applied"];
const profileDescriptions: Record<RoutingPolicyProfile, string> = {
  foundation: "Core prerequisites · stronger evidence",
  standard: "Most concepts · balanced progression",
  applied: "Examples and practice · flexible progression",
};

function policiesMatch(first: RoutingPolicyDraft, second: RoutingPolicyDraft) {
  return first.confidence_threshold === second.confidence_threshold &&
    first.correct_attempts_for_mastery === second.correct_attempts_for_mastery &&
    first.advancement_mode === second.advancement_mode &&
    first.max_remediation_attempts === second.max_remediation_attempts;
}

export function RoutingPolicySettings({
  concepts,
  drafts,
  edges,
  isConfirmed,
  isSaving,
  onConfirm,
  onDraftChange,
}: RoutingPolicySettingsProps) {
  const activeConcepts = concepts.filter(
    (concept) => concept.review_status === "accepted" || concept.review_status === "edited",
  );
  const [selectedConceptId, setSelectedConceptId] = useState("");
  const selectedConcept = activeConcepts.find((concept) => concept.id === selectedConceptId) ?? activeConcepts[0];
  const policyFor = (concept: Concept) => drafts[concept.id] ?? recommendedRoutingPolicy(concept, edges);
  const recommendationCounts = Object.fromEntries(
    profiles.map((profile) => [
      profile,
      activeConcepts.filter((concept) => recommendedRoutingProfile(concept, edges) === profile).length,
    ]),
  ) as Record<RoutingPolicyProfile, number>;
  const exceptionCount = activeConcepts.filter(
    (concept) => !policiesMatch(policyFor(concept), recommendedRoutingPolicy(concept, edges)),
  ).length;
  const selectedDraft = selectedConcept ? policyFor(selectedConcept) : null;
  const selectedProfile = selectedDraft ? routingProfileForPolicy(selectedDraft) : "standard";
  const selectedRecommendation = selectedConcept
    ? recommendedRoutingProfile(selectedConcept, edges)
    : "standard";

  function applyRecommendations() {
    activeConcepts.forEach((concept) => {
      onDraftChange(concept.id, recommendedRoutingPolicy(concept, edges));
    });
  }

  return (
    <section className="border-t border-border pt-6" id="routing-settings">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Route aria-hidden="true" className="size-4.5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Adaptive routing</h3>
              <Badge variant={isConfirmed ? "secondary" : "outline"}>
                {isConfirmed ? "Configured" : "Review required"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Review Manifold&apos;s evidence levels, then save once for the course.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!activeConcepts.length || isSaving} onClick={applyRecommendations} type="button" variant="outline">
            <Sparkles data-icon="inline-start" /> Use recommended mix
          </Button>
          <Button disabled={!activeConcepts.length || isSaving} onClick={onConfirm} type="button">
            {isSaving ? <Sparkles className="animate-pulse motion-reduce:animate-none" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
            {isSaving ? "Saving" : "Save routing"}
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Recommended mix</p>
          {exceptionCount ? <Badge variant="outline">{exceptionCount} changed</Badge> : <span className="text-xs text-muted-foreground">No exceptions</span>}
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <div className="rounded-lg border border-border bg-muted/15 px-4 py-3" key={profile}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{routingPolicyProfileLabels[profile]}</p>
                <Badge variant="secondary">{recommendationCounts[profile]}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{profileDescriptions[profile]}</p>
            </div>
          ))}
        </div>
      </div>

      {selectedConcept && selectedDraft ? (
        <details className="group mt-5 rounded-lg border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium">
            <span>Fine-tune a concept</span>
            <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              Optional
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="border-t border-border p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px]">
              <label className="grid min-w-0 gap-1.5 text-xs font-medium">Concept
                <select className="h-10 min-w-0 truncate rounded-lg border border-input bg-background px-3 text-sm" onChange={(event) => setSelectedConceptId(event.target.value)} value={selectedConcept.id}>
                  {activeConcepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium">Evidence level
                <select
                  aria-label={`Routing profile for ${selectedConcept.name}`}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  onChange={(event) => onDraftChange(selectedConcept.id, routingPolicyForProfile(event.target.value as RoutingPolicyProfile))}
                  value={selectedProfile}
                >
                  {selectedProfile === "custom" ? <option disabled value="custom">Custom</option> : null}
                  {profiles.map((profile) => <option key={profile} value={profile}>{routingPolicyProfileLabels[profile]}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Recommended: <span className="font-medium text-foreground">{routingPolicyProfileLabels[selectedRecommendation]}</span>
                <span className="mx-1.5">·</span>{policyLabel(selectedDraft)}
              </p>
              {!policiesMatch(selectedDraft, recommendedRoutingPolicy(selectedConcept, edges)) ? (
                <Button onClick={() => onDraftChange(selectedConcept.id, recommendedRoutingPolicy(selectedConcept, edges))} size="sm" type="button" variant="ghost"><RotateCcw data-icon="inline-start" /> Reset</Button>
              ) : null}
            </div>

            <details className="group/advanced mt-3 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground">
                <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open/advanced:rotate-180" />
                Advanced thresholds
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="grid gap-1 text-xs font-medium">Confidence
                  <Input max="4" min="1" type="number" value={selectedDraft.confidence_threshold} onChange={(event) => onDraftChange(selectedConcept.id, { ...selectedDraft, confidence_threshold: Number(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs font-medium">Correct attempts
                  <Input min="1" type="number" value={selectedDraft.correct_attempts_for_mastery} onChange={(event) => onDraftChange(selectedConcept.id, { ...selectedDraft, correct_attempts_for_mastery: Number(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs font-medium">Retry limit
                  <Input min="0" type="number" value={selectedDraft.max_remediation_attempts} onChange={(event) => onDraftChange(selectedConcept.id, { ...selectedDraft, max_remediation_attempts: Number(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs font-medium">Advancement
                  <select className="h-8 rounded-lg border border-input bg-background px-2 text-sm" value={selectedDraft.advancement_mode} onChange={(event) => onDraftChange(selectedConcept.id, { ...selectedDraft, advancement_mode: event.target.value as RoutingPolicyDraft["advancement_mode"] })}>
                    <option value="require_mastery">Require mastery</option>
                    <option value="allow_partial_understanding">Allow partial</option>
                  </select>
                </label>
              </div>
            </details>
          </div>
        </details>
      ) : null}
    </section>
  );
}
