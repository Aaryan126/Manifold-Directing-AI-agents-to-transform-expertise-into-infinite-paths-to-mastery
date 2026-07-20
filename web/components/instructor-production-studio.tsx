import {
  ArrowRight,
  Check,
  LockKeyhole,
  Rocket,
} from "lucide-react";

import {
  creationStageOrder,
  type CreationStageId,
  type WorkflowStage,
  type WorkflowTask,
} from "@/app/instructorWorkflow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type InstructorProductionStudioProps = {
  activeStage: CreationStageId;
  onStageChange: (stage: CreationStageId) => void;
  stages: WorkflowStage[];
};

export function InstructorProductionStudio({
  activeStage,
  onStageChange,
  stages,
}: InstructorProductionStudioProps) {
  const activeStageModel = stages.find((stage) => stage.id === activeStage) ?? stages[0];

  return (
    <section className="instructorOnly border-b border-border bg-background" id="production-studio">
      <div className="flex min-h-12 items-center border-b border-border px-6 py-2 xl:px-7">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Stage {creationStageOrder.indexOf(activeStage) + 1} of 5
          <span className="mx-2 text-border">/</span>
          <span className="text-foreground">{activeStageModel.label}</span>
        </p>
      </div>

      <nav aria-label="Course production stages" className="grid grid-cols-5 border-b border-border px-6 xl:px-7">
        {creationStageOrder.map((stageId, index) => {
          const stage = stages.find((item) => item.id === stageId)!;
          const isActive = stageId === activeStage;
          const isBlocked = stage.state === "blocked";
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "relative flex min-h-14 items-center gap-2.5 border-b-2 border-transparent px-2 text-left hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive && "border-primary text-foreground",
              )}
              data-stage={stageId}
              data-slot="production-stage"
              key={stageId}
              onClick={() => onStageChange(stageId)}
              type="button"
            >
              <span className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground",
                isActive && "bg-primary text-primary-foreground",
                stage.state === "complete" && "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}>
                {stage.state === "complete" ? <Check aria-hidden="true" className="size-3.5" /> : isBlocked ? <LockKeyhole aria-hidden="true" className="size-3" /> : index + 1}
              </span>
              <span className={cn("min-w-0 truncate text-sm font-medium text-muted-foreground", isActive && "font-semibold text-foreground")}>{stage.label}</span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}

type InstructorPublishReviewProps = {
  blockers: string[];
  courseStatus: "draft" | "published" | undefined;
  onOpenTask: (task: WorkflowTask) => void;
  onPublish: () => void;
  publishReady: boolean;
  stages: WorkflowStage[];
  tasks: WorkflowTask[];
};

export function InstructorPublishReview({
  blockers,
  courseStatus,
  onOpenTask,
  onPublish,
  publishReady,
  stages,
  tasks,
}: InstructorPublishReviewProps) {
  const blockerTask = tasks.find((task) => task.id === "resolve-publish-blockers");

  return (
    <section className="instructorOnly scroll-mt-20 border-b border-border bg-background" id="publish-review">
      <header className="min-h-[76px] border-b border-border px-6 py-3.5 xl:px-7">
        <h2 className="text-base font-semibold leading-6">Publish course</h2>
        <p className="mt-0.5 max-w-2xl text-sm leading-5 text-muted-foreground">
          Confirm every required human checkpoint has been completed before learners can enroll.
        </p>
      </header>
      <div className="grid min-h-[420px] grid-cols-[minmax(0,1fr)_304px]">
        <div className="min-w-0 px-6 py-6 xl:px-7">
          {courseStatus === "published" ? (
            <div className="flex items-start gap-4 border-l-2 border-emerald-600 bg-emerald-50 px-5 py-4 text-emerald-950">
              <Check aria-hidden="true" className="mt-0.5 size-5" />
              <div><h3 className="font-semibold">Course published</h3><p className="mt-1 text-sm">Learners can enroll and begin the adaptive course.</p></div>
            </div>
          ) : blockers.length ? (
            <div>
              <h3 className="text-base font-semibold">{blockers.length} blocker{blockers.length === 1 ? "" : "s"} remaining</h3>
              <div className="mt-4 border-t border-border">
                {blockers.map((blocker, index) => (
                  <div className="flex items-start gap-3 border-b border-border py-4" key={blocker}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-800">{index + 1}</span>
                    <p className="min-w-0 flex-1 text-sm leading-6">{blocker}</p>
                  </div>
                ))}
              </div>
              {blockerTask ? <Button className="mt-5" onClick={() => onOpenTask(blockerTask)} type="button" variant="outline">Open first blocker <ArrowRight data-icon="inline-end" /></Button> : null}
            </div>
          ) : (
            <div className="flex items-start gap-4 border-l-2 border-primary bg-primary/5 px-5 py-4">
              <Rocket aria-hidden="true" className="mt-0.5 size-5 text-primary" />
              <div><h3 className="font-semibold">Ready to publish</h3><p className="mt-1 text-sm text-muted-foreground">All required artifact reviews and learner gates are satisfied.</p></div>
            </div>
          )}
        </div>
        <aside className="border-l border-border bg-muted/20 px-5 py-6" aria-label="Production stage summary">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Stage summary</p>
          <div className="mt-4 space-y-3">
            {stages.map((stage, index) => (
              <div className="flex items-center gap-3" key={stage.id}>
                <span className={cn("flex size-6 items-center justify-center rounded-full border border-border text-xs", stage.state === "complete" && "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                  {stage.state === "complete" ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
                </span>
                <span className="text-sm font-medium">{stage.label}</span>
              </div>
            ))}
          </div>
          <Button className="mt-7 w-full" disabled={!publishReady || courseStatus === "published"} onClick={onPublish} type="button">
            <Rocket data-icon="inline-start" />
            {courseStatus === "published" ? "Published" : "Publish course"}
          </Button>
          {!publishReady && courseStatus !== "published" ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Publishing unlocks automatically when every required checkpoint is reviewed.</p> : null}
        </aside>
      </div>
    </section>
  );
}
