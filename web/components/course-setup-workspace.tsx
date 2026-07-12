"use client";

import type { FormEvent } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  Database,
  Link2,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Progress,
  ProgressLabel,
} from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type CourseSetupWorkspaceProps = {
  course: { title: string; status: "draft" | "published" } | null;
  deliveryCapacity: {
    provider: "local" | "mux";
    stored_count: number;
    max_stored: number | null;
    remaining: number | null;
    can_upload: boolean;
  } | null;
  isSubmitting: boolean;
  job: {
    id: string;
    status: "queued" | "processing" | "complete" | "failed";
    progress: number;
    error_message: string | null;
  } | null;
  message: string | null;
  onFileChange: (file: File | null) => void;
  onRefresh: () => void;
  onSubmitFile: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void;
  publishBlockers: string[];
  publishReady: boolean;
  reviewedConceptCount: number;
  reviewedQuestionCount: number;
  reviewedTopicCount: number;
  routingPolicyCount: number;
  totalClipCount: number;
  totalConceptCount: number;
  totalQuestionCount: number;
  totalTopicCount: number;
  url: string;
  onUrlChange: (value: string) => void;
};

type ProductionStep = {
  label: string;
  detail: string;
  state: "complete" | "active" | "pending";
};

function StepIcon({ state }: { state: ProductionStep["state"] }) {
  if (state === "complete") {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Check aria-hidden="true" className="size-3.5" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex size-6 items-center justify-center rounded-full border-2 border-primary bg-primary/10 text-primary">
        <Circle aria-hidden="true" className="size-2 fill-current" />
      </span>
    );
  }
  return (
    <span className="flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
      <Circle aria-hidden="true" className="size-2" />
    </span>
  );
}

export function CourseSetupWorkspace({
  course,
  deliveryCapacity,
  isSubmitting,
  job,
  message,
  onFileChange,
  onRefresh,
  onSubmitFile,
  onSubmitUrl,
  publishBlockers,
  publishReady,
  reviewedConceptCount,
  reviewedQuestionCount,
  reviewedTopicCount,
  routingPolicyCount,
  totalClipCount,
  totalConceptCount,
  totalQuestionCount,
  totalTopicCount,
  url,
  onUrlChange,
}: CourseSetupWorkspaceProps) {
  const stepData = [
    {
      label: "Source",
      detail: job ? (job.status === "complete" ? "Processed" : `${job.progress}% processed`) : "Not added",
      done: job?.status === "complete",
    },
    {
      label: "Outline",
      detail: totalTopicCount ? `${reviewedTopicCount}/${totalTopicCount} reviewed` : "Not generated",
      done: totalTopicCount > 0 && reviewedTopicCount === totalTopicCount,
    },
    {
      label: "Graph",
      detail: totalConceptCount ? `${reviewedConceptCount}/${totalConceptCount} reviewed` : "Not generated",
      done: totalConceptCount > 0 && reviewedConceptCount === totalConceptCount,
    },
    {
      label: "Clips",
      detail: totalClipCount ? `${totalClipCount} extracted` : "Not generated",
      done: totalClipCount > 0,
    },
    {
      label: "Assessments",
      detail: totalQuestionCount ? `${reviewedQuestionCount}/${totalQuestionCount} reviewed` : "Not generated",
      done: totalQuestionCount > 0 && reviewedQuestionCount === totalQuestionCount,
    },
    {
      label: "Routing",
      detail: routingPolicyCount ? `${routingPolicyCount} policies` : "Not configured",
      done: routingPolicyCount > 0,
    },
    {
      label: "Publish",
      detail: course?.status === "published"
        ? "Live"
        : publishBlockers.length
          ? `${publishBlockers.length} blockers`
          : publishReady
            ? "Ready"
            : "Waiting for course",
      done: course?.status === "published",
    },
  ];
  const activeIndex = Math.max(0, stepData.findIndex((step) => !step.done));
  const productionSteps: ProductionStep[] = stepData.map((step, index) => ({
    label: step.label,
    detail: step.detail,
    state: step.done ? "complete" : index === activeIndex ? "active" : "pending",
  }));

  return (
    <section className="instructorOnly border-b border-border bg-background" id="course-setup">
      <div className="border-b border-border px-6 py-6 xl:px-8">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Course production</p>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Build your course</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Add source material, monitor processing, and move each generated artifact through instructor review.
          </p>
        </div>
      </div>

      <div className="grid min-h-[560px] grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 px-6 py-7 xl:px-8">
          <div className="max-w-3xl space-y-8">
            <div>
              <div className="mb-4 flex items-start justify-between gap-6">
                <div>
                  <h2 className="text-base font-semibold">Source material</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Upload a recording or ingest a direct media URL.</p>
                </div>
                {job ? (
                  <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
                    {job.status}
                  </Badge>
                ) : null}
              </div>

              <FieldGroup className="grid grid-cols-2 gap-4">
                <form className="rounded-lg border border-border p-4" onSubmit={onSubmitFile}>
                  <Field>
                    <FieldLabel htmlFor="video-file">
                      <Upload aria-hidden="true" className="size-4 text-muted-foreground" />
                      Video or audio file
                    </FieldLabel>
                    <Input
                      accept="audio/*,video/*"
                      className="h-11 file:mr-2"
                      id="video-file"
                      onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                    <FieldDescription>Choose a locally stored source recording.</FieldDescription>
                  </Field>
                  <Button className="mt-4 h-10" disabled={isSubmitting} type="submit">
                    <Upload data-icon="inline-start" />
                    Upload
                  </Button>
                </form>

                <form className="rounded-lg border border-border p-4" onSubmit={onSubmitUrl}>
                  <Field>
                    <FieldLabel htmlFor="video-url">
                      <Link2 aria-hidden="true" className="size-4 text-muted-foreground" />
                      Direct audio/video URL
                    </FieldLabel>
                    <Input
                      className="h-11"
                      id="video-url"
                      onChange={(event) => onUrlChange(event.target.value)}
                      placeholder="https://example.com/lecture.mp4"
                      type="url"
                      value={url}
                    />
                    <FieldDescription>Use a URL that resolves directly to media.</FieldDescription>
                  </Field>
                  <Button className="mt-4 h-10" disabled={isSubmitting || !url} type="submit">
                    <Link2 data-icon="inline-start" />
                    Ingest URL
                  </Button>
                </form>
              </FieldGroup>
            </div>

            {job ? (
              <div className="border-t border-border pt-7">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold">Processing status</h2>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">Job {job.id}</p>
                  </div>
                  <Button className="h-9" onClick={onRefresh} type="button" variant="outline">
                    <RefreshCw data-icon="inline-start" />
                    Refresh
                  </Button>
                </div>
                <Progress value={job.progress}>
                  <ProgressLabel className="capitalize">{job.status}</ProgressLabel>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">{job.progress}%</span>
                </Progress>
                {job.status === "processing" || job.status === "queued" ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    Preparing the transcript and source metadata.
                  </p>
                ) : null}
                {job.error_message ? (
                  <Alert className="mt-4" variant="destructive">
                    <AlertCircle aria-hidden="true" />
                    <AlertTitle>Ingestion failed</AlertTitle>
                    <AlertDescription>{job.error_message}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : (
              <div className="border-t border-border pt-7">
                <h2 className="text-base font-semibold">What happens next</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Processing creates a timestamped transcript. You then review the outline, concept graph, clips,
                  assessments, and routing policy before publishing.
                </p>
              </div>
            )}

            {message ? (
              <Alert role="status">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>Course update</AlertTitle>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>

        <aside className="border-l border-border bg-muted/25 px-5 py-7" aria-label="Course readiness">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Readiness</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{course?.title ?? "New course"}</p>
              <Badge className="capitalize" variant="outline">{course?.status ?? "setup"}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Course status: <span className="font-medium text-foreground">{course?.status ?? "setup"}</span>
            </p>
          </div>

          <ol className="space-y-0" aria-label="Course production steps">
            {productionSteps.map((step, index) => (
              <li className="relative flex gap-3 pb-5 last:pb-0" key={step.label}>
                {index < productionSteps.length - 1 ? (
                  <span className="absolute bottom-0 left-[11px] top-6 w-px bg-border" aria-hidden="true" />
                ) : null}
                <StepIcon state={step.state} />
                <div className="min-w-0 pt-0.5">
                  <p className={cn("text-sm font-medium", step.state === "pending" && "text-muted-foreground")}>
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          {course?.status === "draft" && publishBlockers.length ? (
            <Alert className="mt-7 border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>Publishing checklist</AlertTitle>
              <AlertDescription className="text-amber-900">
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {publishBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {deliveryCapacity?.provider === "mux" ? (
            <Alert
              className={cn(
                "mt-4",
                !deliveryCapacity.can_upload && "border-destructive/40 bg-destructive/5",
              )}
            >
              <Database aria-hidden="true" />
              <AlertTitle>Mux storage</AlertTitle>
              <AlertDescription>
                {deliveryCapacity.stored_count} of {deliveryCapacity.max_stored} stored videos used.
                {deliveryCapacity.can_upload
                  ? ` ${deliveryCapacity.remaining} slot(s) remain.`
                  : " New ingestion is blocked; no existing asset will be overwritten."}
              </AlertDescription>
            </Alert>
          ) : null}

          <p className="mt-6 text-xs leading-5 text-muted-foreground" role="note">
            Development identity only. Credentials and secure sessions are not implemented.
          </p>
        </aside>
      </div>
    </section>
  );
}
