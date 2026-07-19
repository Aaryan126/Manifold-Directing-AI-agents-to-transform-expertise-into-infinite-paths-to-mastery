"use client";

import type { ReactNode } from "react";
import { Check, Circle, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ReviewStatus = "proposed" | "accepted" | "edited" | "dismissed" | "active" | "flagged" | "superseded";

export function ReviewWorkspace({
  children,
  description,
  eyebrow,
  title,
  toolbar,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
  toolbar?: ReactNode;
}) {
  return (
    <section className="instructorOnly border-b border-border bg-background">
      <WorkspaceHeader description={description} eyebrow={eyebrow} title={title} toolbar={toolbar} />
      {children}
    </section>
  );
}

export function WorkspaceHeader({
  description,
  eyebrow,
  title,
  toolbar,
}: {
  description: string;
  eyebrow: string;
  title: string;
  toolbar?: ReactNode;
}) {
  return (
    <header
      aria-label={`${eyebrow}: ${title}`}
      className="flex min-h-[76px] flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-border px-6 py-3.5 xl:px-7"
    >
      <div className="min-w-0 max-w-2xl">
        <h2 className="text-base font-semibold leading-6">{title}</h2>
        <p className="mt-0.5 max-w-xl text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      {toolbar ? <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">{toolbar}</div> : null}
    </header>
  );
}

export function ReviewWorkspaceGrid({
  editor,
  inspector,
  queue,
  queueWidth = "default",
}: {
  editor: ReactNode;
  inspector?: ReactNode;
  queue: ReactNode;
  queueWidth?: "default" | "wide";
}) {
  const columns = inspector
    ? "grid-cols-[232px_minmax(0,1fr)_288px] xl:grid-cols-[248px_minmax(0,1fr)_304px]"
    : queueWidth === "wide"
      ? "grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]"
      : "grid-cols-[248px_minmax(0,1fr)]";

  return (
    <div className={cn("grid min-h-[600px]", columns)}>
      <aside className="min-w-0 border-r border-border bg-muted/20" aria-label="Review queue">{queue}</aside>
      <div className="min-w-0 px-6 py-6 xl:px-7">{editor}</div>
      {inspector ? <aside className="min-w-0 border-l border-border bg-muted/20 px-5 py-6" aria-label="Review evidence">{inspector}</aside> : null}
    </div>
  );
}

export function ReviewQueueHeader({
  reviewed,
  total,
}: {
  reviewed: number;
  total: number;
}) {
  return (
    <div className="border-b border-border px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Review queue</p>
        <Badge variant="outline">{reviewed}/{total}</Badge>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${total ? (reviewed / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

export function ReviewQueueItem({
  active,
  detail,
  label,
  onClick,
  status,
}: {
  active: boolean;
  detail: string;
  label: string;
  onClick: () => void;
  status: ReviewStatus;
}) {
  const statusIcon = status === "dismissed" || status === "superseded"
    ? <X aria-hidden="true" className="size-3.5" />
    : status === "proposed" || status === "active"
      ? <Circle aria-hidden="true" className="size-3.5" />
      : <Check aria-hidden="true" className="size-3.5" />;

  return (
    <button
      data-slot="review-queue-item"
      className={cn(
        "flex min-h-[58px] w-full items-start gap-2.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-background shadow-[inset_3px_0_0_var(--primary)]",
        (status === "dismissed" || status === "superseded") && "text-muted-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      <span className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground",
        (status === "accepted" || status === "edited") && "border-emerald-600 bg-emerald-50 text-emerald-700",
      )}>
        {statusIcon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-xs capitalize text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

export function InspectorSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <h3 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
