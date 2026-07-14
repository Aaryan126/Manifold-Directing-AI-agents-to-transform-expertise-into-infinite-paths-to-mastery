"use client";

import type { FormEvent } from "react";
import {
  AlertCircle,
  Database,
  Link2,
  LoaderCircle,
  PlayCircle,
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
  onFileChange: (file: File | null) => void;
  onLoadDemo: () => void;
  onSubmitFile: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void;
  selectedFileName: string | null;
  url: string;
  onUrlChange: (value: string) => void;
};

export function CourseSetupWorkspace({
  course,
  deliveryCapacity,
  isSubmitting,
  job,
  onFileChange,
  onLoadDemo,
  onSubmitFile,
  onSubmitUrl,
  selectedFileName,
  url,
  onUrlChange,
}: CourseSetupWorkspaceProps) {
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
                    <input
                      accept="audio/*,video/*"
                      className="sr-only"
                      data-slot="source-file-input"
                      id="video-file"
                      onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                    <label
                      className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50"
                      htmlFor="video-file"
                    >
                      <Upload aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className={cn("truncate", !selectedFileName && "text-muted-foreground")}>
                        {selectedFileName ?? "Choose a file"}
                      </span>
                    </label>
                    <FieldDescription>Choose a locally stored source recording.</FieldDescription>
                  </Field>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button className="h-10" disabled={isSubmitting} type="submit">
                      <Upload data-icon="inline-start" />
                      Upload
                    </Button>
                    <Button className="h-10" disabled={isSubmitting} onClick={onLoadDemo} type="button" variant="outline">
                      <PlayCircle data-icon="inline-start" />
                      Use demo
                    </Button>
                  </div>
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
                </div>
                {job.status === "complete" || job.status === "failed" ? (
                  <Progress value={job.status === "complete" ? 100 : job.progress}>
                    <ProgressLabel className="capitalize">{job.status}</ProgressLabel>
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">{job.status === "complete" ? "100%" : `${job.progress}%`}</span>
                  </Progress>
                ) : (
                  <div role="progressbar" aria-label="Processing source" aria-valuetext="Processing">
                    <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Processing source</span><span className="text-muted-foreground">Working</span></div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/5 animate-pulse rounded-full bg-primary" /></div>
                  </div>
                )}
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

          <div className="border-y border-border py-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Source state</p>
            <p className="mt-2 text-sm font-medium">
              {!job ? "Waiting for source" : job.status === "complete" ? "Transcript ready" : job.status === "failed" ? "Needs attention" : "Processing"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {!job
                ? "Choose a lecture or load the prepared demo."
                : job.status === "complete"
                  ? "Continue to Structure from the production stages above."
                  : job.status === "failed"
                    ? "Review the error and retry with another source."
                    : "Manifold will update this workspace when processing completes."}
            </p>
          </div>

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
