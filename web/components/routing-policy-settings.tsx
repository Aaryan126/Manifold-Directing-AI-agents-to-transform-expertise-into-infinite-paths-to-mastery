import { Check, ChevronDown, Route, Sparkles } from "lucide-react";

import type { Concept, ConceptEdge } from "@/app/graphModel";
import {
  policyLabel,
  recommendedRoutingPolicy,
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
  const policyFor = (concept: Concept) =>
    drafts[concept.id] ?? recommendedRoutingPolicy(concept, edges);
  const profileCounts = Object.fromEntries(
    profiles.map((profile) => [
      profile,
      activeConcepts.filter((concept) => {
        const selected = routingProfileForPolicy(policyFor(concept));
        return selected === profile;
      }).length,
    ]),
  ) as Record<RoutingPolicyProfile, number>;
  const customCount = activeConcepts.filter(
    (concept) => routingProfileForPolicy(policyFor(concept)) === "custom",
  ).length;

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
                {isConfirmed ? "Confirmed" : "Review required"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Manifold groups concepts by how much evidence learners should show before advancing.
            </p>
          </div>
        </div>
        <Button disabled={!activeConcepts.length || isSaving} onClick={onConfirm} type="button">
          {isSaving ? <Sparkles className="animate-pulse motion-reduce:animate-none" data-icon="inline-start" /> : isConfirmed ? <Check data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          {isSaving ? "Saving" : isConfirmed ? "Save settings" : "Confirm recommendations"}
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-3 divide-x divide-border border-y border-border">
        {profiles.map((profile) => (
          <div className="px-4 py-3 first:pl-0 last:pr-0" key={profile}>
            <p className="text-sm font-medium">{routingPolicyProfileLabels[profile]}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {profileCounts[profile]} concept{profileCounts[profile] === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>

      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          Customize by concept
          {customCount ? <span className="font-normal text-muted-foreground">({customCount} custom)</span> : null}
        </summary>
        <div className="mt-3 divide-y divide-border border-y border-border">
          {activeConcepts.map((concept) => {
            const draft = policyFor(concept);
            const profile = routingProfileForPolicy(draft);
            return (
              <details className="group/concept py-3" key={concept.id}>
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_180px_20px] items-center gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{concept.name}</span>
                  <select
                    aria-label={`Routing profile for ${concept.name}`}
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const next = event.target.value as RoutingPolicyProfile;
                      onDraftChange(concept.id, routingPolicyForProfile(next));
                    }}
                    value={profile}
                  >
                    {profile === "custom" ? <option disabled value="custom">Custom</option> : null}
                    {profiles.map((item) => (
                      <option key={item} value={item}>{routingPolicyProfileLabels[item]}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/concept:rotate-180" />
                </summary>
                <div className="mt-3 grid grid-cols-4 gap-3 rounded-md bg-muted/40 p-3">
                  <label className="grid gap-1 text-xs font-medium">Confidence
                    <Input max="4" min="1" type="number" value={draft.confidence_threshold} onChange={(event) => onDraftChange(concept.id, { ...draft, confidence_threshold: Number(event.target.value) })} />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">Correct attempts
                    <Input min="1" type="number" value={draft.correct_attempts_for_mastery} onChange={(event) => onDraftChange(concept.id, { ...draft, correct_attempts_for_mastery: Number(event.target.value) })} />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">Retry limit
                    <Input min="0" type="number" value={draft.max_remediation_attempts} onChange={(event) => onDraftChange(concept.id, { ...draft, max_remediation_attempts: Number(event.target.value) })} />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">Advancement
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={draft.advancement_mode} onChange={(event) => onDraftChange(concept.id, { ...draft, advancement_mode: event.target.value as RoutingPolicyDraft["advancement_mode"] })}>
                      <option value="require_mastery">Require mastery</option>
                      <option value="allow_partial_understanding">Allow partial</option>
                    </select>
                  </label>
                  <p className="col-span-4 text-xs text-muted-foreground">{policyLabel(draft)}</p>
                </div>
              </details>
            );
          })}
        </div>
      </details>
    </section>
  );
}
