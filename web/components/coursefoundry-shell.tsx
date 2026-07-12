"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BarChart3Icon,
  BookOpenCheckIcon,
  ClipboardCheckIcon,
  EyeIcon,
  FilmIcon,
  GraduationCapIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  ListTreeIcon,
  NetworkIcon,
  PlayCircleIcon,
  RouteIcon,
  Settings2Icon,
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
  children: ReactNode;
  courseStatus?: "draft" | "published";
  courseTitle?: string;
  identities: IdentityOption[];
  isLearner: boolean;
  onIdentityChange: (identityId: string) => void;
  onPublish: () => void;
  publishDisabled: boolean;
  selectedIdentityId: string;
};

const instructorNavigation = [
  { label: "Overview", target: "course-overview", icon: LayoutDashboardIcon },
  { label: "Course setup", target: "course-setup", icon: Settings2Icon },
  { label: "Outline", target: "outline", icon: ListTreeIcon },
  { label: "Concept graph", target: "concept-graph", icon: NetworkIcon },
  { label: "Clips", target: "clips", icon: FilmIcon },
  { label: "Assessments", target: "assessments", icon: ClipboardCheckIcon },
  { label: "Routing", target: "routing", icon: RouteIcon },
  { label: "Learner preview", target: "routing-simulator", icon: EyeIcon },
  { label: "Insights", target: "insights", icon: BarChart3Icon },
] as const;

const learnerNavigation = [
  { label: "Current lesson", target: "learner-preview", icon: PlayCircleIcon },
  { label: "Course path", target: "mastery-map", icon: RouteIcon },
  { label: "Mastery", target: "mastery-map", icon: GraduationCapIcon },
  { label: "Course outline", target: "learner-topics", icon: BookOpenCheckIcon },
] as const;

export function CourseFoundryShell({
  children,
  courseStatus = "draft",
  courseTitle = "Course workspace",
  identities,
  isLearner,
  onIdentityChange,
  onPublish,
  publishDisabled,
  selectedIdentityId,
}: CourseFoundryShellProps) {
  const navigation = isLearner ? learnerNavigation : instructorNavigation;
  const [activeItem, setActiveItem] = useState<string>(navigation[0].label);

  useEffect(() => {
    setActiveItem(navigation[0].label);
  }, [isLearner, navigation]);

  function navigateTo(target: string, label?: string) {
    if (label) setActiveItem(label);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "15.25rem" } as CSSProperties}
    >
      <Sidebar collapsible="icon" className="border-sidebar-border/80">
        <SidebarHeader className="h-16 justify-center border-b border-sidebar-border/70 px-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-10 font-semibold tracking-[-0.01em]"
                onClick={() => navigateTo(isLearner ? "learner-preview" : "course-overview", navigation[0].label)}
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
                {navigation.map((item) => (
                  <SidebarMenuItem key={`${item.label}-${item.target}`}>
                    <SidebarMenuButton
                      className="h-10"
                      isActive={activeItem === item.label}
                      onClick={() => navigateTo(item.target, item.label)}
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
          <SidebarTrigger className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="truncate text-sm font-semibold">{courseTitle}</strong>
              <Badge
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
              <Button variant="outline" onClick={() => navigateTo("learner-preview")}>
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
