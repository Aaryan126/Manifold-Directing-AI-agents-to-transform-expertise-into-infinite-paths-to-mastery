"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BarChart3Icon,
  BookOpenCheckIcon,
  EyeIcon,
  GraduationCapIcon,
  GitBranchIcon,
  PlayCircleIcon,
  RouteIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type IdentityOption = {
  id: string;
  display_name: string;
  role: "instructor" | "learner";
};

type CourseFoundryShellProps = {
  activeInstructorView: "build" | "insights";
  children: ReactNode;
  courseStatus?: "draft" | "published";
  courseTitle?: string;
  identities: IdentityOption[];
  isLearner: boolean;
  onIdentityChange: (identityId: string) => void;
  onInstructorViewChange: (view: "build" | "insights") => void;
  onPublish: () => void;
  publishDisabled: boolean;
  selectedIdentityId: string;
};

const instructorNavigation = [
  { label: "Build course", view: "build", icon: BookOpenCheckIcon },
  { label: "Insights", view: "insights", icon: BarChart3Icon },
] as const;

const learnerNavigation = [
  { label: "Current lesson", target: "learner-preview", icon: PlayCircleIcon },
  { label: "Course path", target: "mastery-map", icon: RouteIcon },
  { label: "Mastery", target: "mastery-map", icon: GraduationCapIcon },
  { label: "Course outline", target: "learner-topics", icon: BookOpenCheckIcon },
] as const;

export function CourseFoundryShell({
  activeInstructorView,
  children,
  courseStatus = "draft",
  courseTitle = "Course workspace",
  identities,
  isLearner,
  onIdentityChange,
  onInstructorViewChange,
  onPublish,
  publishDisabled,
  selectedIdentityId,
}: CourseFoundryShellProps) {
  const [activeLearnerItem, setActiveLearnerItem] = useState<string>(learnerNavigation[0].label);

  useEffect(() => {
    setActiveLearnerItem(learnerNavigation[0].label);
  }, [isLearner]);

  function navigateTo(target: string, label?: string) {
    if (label) setActiveLearnerItem(label);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function previewCourse() {
    const learner = identities.find((identity) => identity.role === "learner");
    if (learner) onIdentityChange(learner.id);
  }

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "15.25rem" } as CSSProperties}
    >
      <Sidebar collapsible="icon" className="border-sidebar-border/80">
        <SidebarHeader className="h-16 justify-center border-b border-sidebar-border/70 px-3 group-data-[collapsible=icon]:px-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label="Manifold"
                className="h-10 font-semibold tracking-[-0.01em] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
                onClick={() => isLearner
                  ? navigateTo("learner-preview", learnerNavigation[0].label)
                  : onInstructorViewChange("build")}
                tooltip="Manifold"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <GitBranchIcon aria-hidden="true" className="size-4" />
                </span>
                <span>Manifold</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="px-2 py-3">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {(isLearner ? learnerNavigation : instructorNavigation).map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      aria-label={item.label}
                      className="h-10"
                      isActive={isLearner
                        ? activeLearnerItem === item.label
                        : activeInstructorView === ("view" in item ? item.view : "build")}
                      onClick={() => {
                        if (isLearner && "target" in item) navigateTo(item.target, item.label);
                        if (!isLearner && "view" in item) onInstructorViewChange(item.view);
                      }}
                      tooltip={item.label}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-5 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <SidebarTrigger aria-label="Collapse or expand navigation" className="shrink-0" title="Collapse or expand navigation" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="truncate text-sm font-semibold">{courseTitle}</strong>
              <Badge
                aria-label="Course status"
                className="capitalize data-[status=draft]:border-amber-300 data-[status=draft]:bg-amber-50 data-[status=draft]:text-amber-800 data-[status=published]:border-emerald-300 data-[status=published]:bg-emerald-50 data-[status=published]:text-emerald-800"
                data-status={courseStatus}
                variant="outline"
              >
                {courseStatus}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {isLearner ? "Adaptive learning workspace" : "Course production workspace"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div aria-label="Workspace view" className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5" role="group">
              {identities.map((identity) => (
                <Button
                  aria-pressed={identity.id === selectedIdentityId}
                  className="h-8 px-3 capitalize"
                  key={identity.id}
                  onClick={() => onIdentityChange(identity.id)}
                  size="sm"
                  type="button"
                  variant={identity.id === selectedIdentityId ? "secondary" : "ghost"}
                >
                  {identity.role}
                </Button>
              ))}
            </div>
            {!isLearner ? (
              <>
              <Button variant="outline" onClick={previewCourse}>
                <EyeIcon data-icon="inline-start" />
                Preview course
              </Button>
              <Button disabled={publishDisabled} onClick={onPublish}>
                {courseStatus === "published" ? "Published" : "Publish course"}
              </Button>
              </>
            ) : null}
          </div>
        </header>
        <div className="cf-workspace">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
