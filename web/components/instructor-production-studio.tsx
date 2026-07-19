"use client";

import { useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  GitBranch,
  ListChecks,
  LockKeyhole,
  Map,
  PanelsTopLeft,
  PlayCircle,
  Rocket,
  Route,
  Upload,
} from "lucide-react";

import {
  creationStageOrder,
  topicReadinessLabel,
  type CreationStageId,
  type TopicReadiness,
  type WorkflowStage,
  type WorkflowTask,
} from "@/app/instructorWorkflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const stageIcons = {
  source: Upload,
  structure: GitBranch,
  learning: BookOpenCheck,
  adapt: Route,
  publish: Rocket,
} satisfies Record<CreationStageId, typeof Upload>;

type InstructorProductionStudioProps = {
  activeStage: CreationStageId;
  advancedMode: boolean;
  onOpenTask: (task: WorkflowTask) => void;
  onOpenTopic: (topic: TopicReadiness) => void;
  onStageChange: (stage: CreationStageId) => void;
  onToggleAdvancedMode: () => void;
  stages: WorkflowStage[];
  tasks: WorkflowTask[];
  topics: TopicReadiness[];
};

export function InstructorProductionStudio({
  activeStage,
  advancedMode,
  onOpenTask,
  onOpenTopic,
  onStageChange,
  onToggleAdvancedMode,
  stages,
  tasks,
  topics,
}: InstructorProductionStudioProps) {
  const [courseMapOpen, setCourseMapOpen] = useState(false);
  const activeStageModel = stages.find((stage) => stage.id === activeStage) ?? stages[0];
  const activeTasks = tasks.filter((task) => task.stage === activeStage);
  const completedStages = stages.filter((stage) => stage.state === "complete").length;
  const firstTask = activeTasks[0];

  return (
    <section className="instructorOnly border-b border-border bg-background" id="production-studio">
      <div className="border-b border-border px-6 py-4 xl:px-7">
        <div className="flex min-h-12 items-center justify-between gap-8">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase leading-4 text-muted-foreground">Guided production</p>
            <div className="mt-0.5 flex items-baseline gap-3">
              <h1 className="font-serif text-2xl font-semibold leading-8">{activeStageModel.label}</h1>
              <span className="text-xs tabular-nums text-muted-foreground">Stage {creationStageOrder.indexOf(activeStage) + 1} of 5</span>
            </div>
            <p className="mt-0.5 max-w-2xl text-sm leading-5 text-muted-foreground">
              {activeStageModel.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Sheet open={courseMapOpen} onOpenChange={setCourseMapOpen}>
              <SheetTrigger render={<Button type="button" variant="outline" />}>
                <Map data-icon="inline-start" />
                Course map
              </SheetTrigger>
              <SheetContent className="w-[420px] sm:max-w-[420px]">
                <SheetHeader className="border-b border-border px-5 py-5">
                  <SheetTitle>Course map</SheetTitle>
                  <SheetDescription>
                    Open the next repair point for any topic without searching across workspaces.
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {topics.length ? topics.map((topic, index) => {
                    const label = topicReadinessLabel(topic);
                    return (
                      <button
                        className="flex w-full items-start gap-3 border-b border-border px-5 py-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        data-slot="course-map-topic"
                        key={topic.id}
                        onClick={() => {
                          setCourseMapOpen(false);
                          onOpenTopic(topic);
                        }}
                        type="button"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-5">{topic.title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {topic.reviewedConcepts} concepts · {topic.clips} clips · {topic.approvedQuestions} approved checks
                          </span>
                        </span>
                        <Badge variant={label === "Ready" ? "secondary" : "outline"}>{label}</Badge>
                      </button>
                    );
                  }) : (
                    <div className="px-5 py-10 text-center">
                      <p className="text-sm font-medium">No topics yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">The course map appears after source processing.</p>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
            <Button
              aria-pressed={advancedMode}
              onClick={onToggleAdvancedMode}
              type="button"
              variant={advancedMode ? "secondary" : "outline"}
            >
              <PanelsTopLeft data-icon="inline-start" />
              {advancedMode ? "Guided view" : "All workspaces"}
            </Button>
          </div>
        </div>
      </div>

      <nav aria-label="Course production stages" className="grid grid-cols-5 border-b border-border">
        {creationStageOrder.map((stageId, index) => {
          const stage = stages.find((item) => item.id === stageId)!;
          const Icon = stageIcons[stageId];
          const isActive = stageId === activeStage;
          const isBlocked = stage.state === "blocked";
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "relative flex min-h-[68px] items-center gap-2.5 border-r border-border px-4 text-left last:border-r-0 hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive && "bg-primary/5 shadow-[inset_0_-3px_0_var(--primary)]",
              )}
              data-stage={stageId}
              data-slot="production-stage"
              key={stageId}
              onClick={() => onStageChange(stageId)}
              type="button"
            >
              <span className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground",
                isActive && "border-primary/30 text-primary",
                stage.state === "complete" && "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}>
                {stage.state === "complete" ? <Check aria-hidden="true" className="size-4" /> : isBlocked ? <LockKeyhole aria-hidden="true" className="size-4" /> : <Icon aria-hidden="true" className="size-4" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-medium leading-4 text-muted-foreground">{index + 1} of 5</span>
                <span className="block truncate text-sm font-semibold leading-5">{stage.label}</span>
              </span>
              {stage.taskCount > 0 && !isBlocked ? (
                <Badge className="ml-auto" variant="outline">{stage.taskCount}</Badge>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)_248px] border-b border-border bg-muted/10">
        <div className="min-w-0 px-6 py-4 xl:px-7">
          <div className="flex items-center gap-2">
            <ListChecks aria-hidden="true" className="size-4 text-primary" />
            <p className="text-xs font-semibold uppercase text-muted-foreground">Review inbox</p>
          </div>
          {activeStageModel.state === "blocked" ? (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><LockKeyhole aria-hidden="true" className="size-4" /></span>
              <div><p className="font-medium">This stage is waiting</p><p className="mt-0.5 text-muted-foreground">Complete the earlier required checkpoint before working here.</p></div>
            </div>
          ) : firstTask ? (
            <div className="mt-2.5 flex items-center justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">{firstTask.title}</h2>
                  {firstTask.count ? <Badge variant="outline">{firstTask.count}</Badge> : null}
                </div>
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{firstTask.detail}</p>
                {activeTasks.length > 1 ? (
                  <p className="mt-2 text-xs text-muted-foreground">{activeTasks.length - 1} more decision{activeTasks.length === 2 ? "" : "s"} in this stage</p>
                ) : null}
              </div>
              <Button className="shrink-0" onClick={() => onOpenTask(firstTask)} type="button">
                Review next <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="flex size-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check aria-hidden="true" className="size-4" /></span>
              <div><p className="font-medium">This stage is clear</p><p className="mt-0.5 text-muted-foreground">No unresolved proposals or blockers are waiting here.</p></div>
            </div>
          )}
        </div>
        <div className="border-l border-border px-5 py-4">
          <div className="flex items-center justify-between text-xs"><span className="font-medium text-muted-foreground">Creation progress</span><strong className="tabular-nums">{completedStages}/5</strong></div>
          <div
            aria-label="Course creation progress"
            aria-valuemax={5}
            aria-valuemin={0}
            aria-valuenow={completedStages}
            className="mt-3 flex gap-1"
            role="progressbar"
          >
            {stages.map((stage) => <span className={cn("h-1.5 flex-1 rounded-full bg-muted", stage.state === "complete" && "bg-emerald-600", stage.state === "active" && "bg-primary")} key={stage.id} />)}
          </div>
          <p className="mt-2.5 flex items-center gap-2 text-xs leading-4 text-muted-foreground">
            {advancedMode ? <PanelsTopLeft aria-hidden="true" className="size-3.5" /> : <PlayCircle aria-hidden="true" className="size-3.5" />}
            {advancedMode ? "Showing every instructor workspace" : "Only the active stage is shown below"}
          </p>
        </div>
      </div>
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
      <header className="border-b border-border px-6 py-4 xl:px-7">
        <p className="text-[11px] font-semibold uppercase leading-4 text-muted-foreground">Final review</p>
        <h2 className="mt-0.5 text-lg font-semibold leading-7">Publish course</h2>
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
