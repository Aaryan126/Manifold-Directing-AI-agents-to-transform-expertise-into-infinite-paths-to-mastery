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
      <header className="flex min-h-24 items-center justify-between gap-6 border-b border-border px-6 py-5 xl:px-8">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {toolbar ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function ReviewWorkspaceGrid({
  editor,
  inspector,
  queue,
}: {
  editor: ReactNode;
  inspector: ReactNode;
  queue: ReactNode;
}) {
  return (
    <div className="grid min-h-[620px] grid-cols-[220px_minmax(0,1fr)_260px] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      <aside className="border-r border-border bg-muted/20" aria-label="Review queue">{queue}</aside>
      <div className="min-w-0 px-6 py-6">{editor}</div>
      <aside className="border-l border-border bg-muted/20 px-5 py-6" aria-label="Review evidence">{inspector}</aside>
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
    <div className="border-b border-border px-4 py-4">
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
      className={cn(
        "flex w-full items-start gap-2.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
