"use client";

import type { FormEvent } from "react";
import {
  AlertCircle,
  Database,
  FileVideo,
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
  completedStageCount: number;
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
  completedStageCount,
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
  const sourceState = !job
    ? "Waiting for source"
    : job.status === "complete"
      ? "Transcript ready"
      : job.status === "failed"
        ? "Needs attention"
        : "Processing";

  return (
    <section className="instructorOnly scroll-mt-20 border-b border-border bg-background" id="course-setup">
      <div className="grid min-h-[540px] grid-cols-[minmax(0,1fr)_288px] xl:grid-cols-[minmax(0,1fr)_304px]">
        <div className="min-w-0 px-6 py-6 xl:px-7">
          <div className="mx-auto max-w-5xl space-y-6">
            <header>
              <h2 className="text-lg font-semibold">Add source material</h2>
              <p className="mt-1 text-sm text-muted-foreground">Upload a file or paste a direct media URL.</p>
            </header>

            <FieldGroup className="grid grid-cols-2 gap-4">
              <form className="grid min-h-[260px] grid-rows-[auto_1fr_auto] rounded-lg border border-border p-5" onSubmit={onSubmitFile}>
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileVideo aria-hidden="true" className="size-5" /></span>
                    <div>
                      <h3 className="text-sm font-semibold">Video or audio file</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">MP4, MOV, MP3, WAV, or M4A.</p>
                    </div>
                  </div>
                  <Field className="mt-6 self-center">
                    <FieldLabel className="sr-only" htmlFor="video-file">
                      File
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
                      className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input bg-muted/20 px-3 text-sm transition-colors hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50"
                      htmlFor="video-file"
                    >
                      <Upload aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className={cn("truncate", !selectedFileName && "text-muted-foreground")}>
                        {selectedFileName ?? "Choose a file"}
                      </span>
                    </label>
                  </Field>
                  <div className="mt-6 grid grid-cols-2 gap-2">
                    <Button className="h-10" disabled={isSubmitting} type="submit">
                      <Upload data-icon="inline-start" />
                      Upload file
                    </Button>
                    <Button className="h-10" disabled={isSubmitting} onClick={onLoadDemo} type="button" variant="outline">
                      <PlayCircle data-icon="inline-start" />
                      Use demo
                    </Button>
                  </div>
              </form>

              <form className="grid min-h-[260px] grid-rows-[auto_1fr_auto] rounded-lg border border-border p-5" onSubmit={onSubmitUrl}>
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Link2 aria-hidden="true" className="size-5" /></span>
                    <div>
                      <h3 className="text-sm font-semibold">Direct media URL</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Public audio or video link.</p>
                    </div>
                  </div>
                  <Field className="mt-6 self-center">
                    <FieldLabel className="sr-only" htmlFor="video-url">
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
                  </Field>
                  <Button className="mt-6 h-10 w-full" disabled={isSubmitting || !url} type="submit">
                    <Link2 data-icon="inline-start" />
                    Ingest URL
                  </Button>
              </form>
            </FieldGroup>

            {job ? (
              <div className="border-t border-border pt-6">
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
            ) : null}

          </div>
        </div>

        <aside className="border-l border-border bg-muted/20 px-5 py-6" aria-label="Source readiness">
          <section className="border-b border-border pb-5">
            <div className="flex items-center justify-between text-xs">
              <p className="font-semibold uppercase text-muted-foreground">Progress</p>
              <strong className="tabular-nums">{completedStageCount}/5</strong>
            </div>
            <div
              aria-label="Course creation progress"
              aria-valuemax={5}
              aria-valuemin={0}
              aria-valuenow={completedStageCount}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <div className="h-full bg-primary" style={{ width: `${completedStageCount * 20}%` }} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Complete each stage to publish.</p>
          </section>

          <section className="border-b border-border py-5">
            <p className="text-[11px] font-semibold uppercase leading-4 text-muted-foreground">Stage status</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{sourceState}</p>
              <Badge className="capitalize" variant="outline">{course?.status ?? "setup"}</Badge>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {!job
                ? "Choose a lecture or load the prepared demo."
                : job.status === "complete"
                  ? "Continue to Structure from the production stages above."
                  : job.status === "failed"
                    ? "Review the error and retry with another source."
                    : "Manifold will update this workspace when processing completes."}
            </p>
          </section>

          <section className="border-b border-border py-5">
            <p className="text-[11px] font-semibold uppercase leading-4 text-muted-foreground">Next checkpoint</p>
            <p className="mt-2 text-sm font-medium">Review the topic outline</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Structure opens automatically when the transcript is ready.</p>
          </section>

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

        </aside>
      </div>
    </section>
  );
}
