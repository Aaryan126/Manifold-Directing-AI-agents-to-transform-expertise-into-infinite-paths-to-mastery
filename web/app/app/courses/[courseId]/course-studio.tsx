"use client";

import {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type EdgeProps,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  ClipboardCheck,
  ClipboardList,
  Eye,
  FileText,
  FilePenLine,
  FileVideo,
  GraduationCap,
  GitFork,
  LoaderCircle,
  MessageCircleMore,
  MessageSquareText,
  Network,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Settings,
  SunMedium,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import { AssistantMorph } from "../../../assistant-morph";
import {
  interfaceEase,
  MotionHandoff,
  pageEntranceMotion,
  sectionCascadeVariants,
  sectionItemVariants,
  workspaceViewMotion,
} from "../../../interface-motion";
import {
  readRuntimeConversation,
  writeRuntimeConversation,
} from "../../../runtime-conversations";
import {
  answerOutcomeSummary,
  availableBlueprintRelationshipKinds,
  blueprintEdgeKinds,
  blueprintNodeLayer,
  blueprintConceptNeighborhoodIds,
  buildBlueprintTopicLanes,
  canPrepareImprovement,
  compareBlueprintSequence,
  coreBlueprintEdgeKinds,
  evidenceTitle,
  findBlueprintClip,
  generationPhaseLabel,
  isValidBlueprintRelationshipTarget,
  orderedGenerationTasks,
  performancePercent,
  masteryStateForConcept,
  shouldHydrateGenerationRun,
  topicLogicalIdsForConcept,
  reorderBlueprintConcepts,
  visibleBlueprintNodeIds,
  visibleBlueprintEdges,
  type CourseMap,
  type CourseAssessment,
  type CourseMessage,
  type CourseAgentTask,
  type AgentTaskPack,
  type AgentTaskProposal,
  type BlueprintConceptEvidence,
  type BlueprintEdge,
  type BlueprintEdgeKind,
  type BlueprintMutationImpact,
  type BlueprintNode,
  type CourseBlueprint,
  type CourseFlow,
  type CourseFlowEdge,
  type CourseFlowUnit,
  type CourseFlowUnitKind,
  type CoursePriority,
  type CourseSource,
  type CourseSummary,
  type DashboardSummary,
  type DevelopmentIdentity,
  type GenerationRun,
  type ReviewBundle,
  type ReviewItem,
  type RevisionDiff,
  type AssessmentWorkspace,
  type AssessmentRule,
  type RoutingPolicy,
  type RoutingWorkspace,
} from "../../course-os";
import styles from "../../course-os.module.css";
import { TeacherSidebar, useTeacherSidebar } from "../../teacher-dashboard";
import { ProviderVideo, type PlaybackInfo } from "../../../ProviderVideo";
import { courseFlowViewportPolicy } from "../../../courseFlowViewport";
import { readDevelopmentSession } from "../../../developmentSession";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";
type CanvasView = "flow" | "blueprint" | "review" | "assessments" | "preview";
type BlueprintMode = "live" | "design";
type Decision = "accepted" | "edited" | "dismissed";
type CourseFlowPortSide = "top" | "right" | "bottom" | "left";
type CourseFlowRelationshipDraft = {
  source: CourseFlowUnit;
  side: CourseFlowPortSide;
  relationship: CourseFlowEdge["relationship"] | null;
};
type EditableBlueprintRelationship = Exclude<BlueprintEdgeKind, "next">;
type BlueprintPortSide = "top" | "right" | "bottom" | "left";
type BlueprintRelationshipSpec = {
  relationship: EditableBlueprintRelationship;
  source_logical_id: string;
  target_logical_id: string;
};
type BlueprintRelationshipDraft = {
  source: BlueprintNode;
  side: BlueprintPortSide;
  kind: EditableBlueprintRelationship | null;
  replacing: BlueprintEdge | null;
};
type BlueprintUndoEntry = {
  id: string;
  label: string;
  run: () => Promise<void>;
};
type AssessmentDraftPayload = {
  topic_id: string;
  primary_concept_id: string;
  concept_ids: string[];
  body: string;
  type: CourseAssessment["type"];
  correct_answer: Record<string, unknown>;
  confidence_prompt: string;
  remediation_rules: Omit<AssessmentRule, "id">[];
};
type CourseFlowDraftPayload = {
  kind: CourseFlowUnitKind;
  title: string;
  summary: string;
  instructions: string;
  module_logical_id: string | null;
  concept_logical_ids: string[];
};
type CourseFlowEdgeDraft = {
  relationship: CourseFlowEdge["relationship"];
  source_unit_logical_id: string;
  target_unit_logical_id: string;
};
type DirectorStream = {
  content: string;
  status: string;
};

const InsightsCharts = dynamic(
  () => import("@/components/insights-charts").then((module) => module.InsightsCharts),
  { ssr: false },
);

export function CourseStudio({ courseId }: { courseId: string }) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const searchParams = useSearchParams();
  const requestedCanvasView = searchParams.get("view");
  const { sidebarCollapsed, toggleSidebar } = useTeacherSidebar();
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const conversationScopeRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState<DevelopmentIdentity | null>(null);
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [conversationHydrated, setConversationHydrated] = useState(false);
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [activeBlueprint, setActiveBlueprint] = useState<CourseBlueprint | null>(null);
  const [workingBlueprint, setWorkingBlueprint] = useState<CourseBlueprint | null>(null);
  const [activeCourseFlow, setActiveCourseFlow] = useState<CourseFlow | null>(null);
  const [workingCourseFlow, setWorkingCourseFlow] = useState<CourseFlow | null>(null);
  const [lectureFocusVideoId, setLectureFocusVideoId] = useState<string | null>(null);
  const [blueprintEvidence, setBlueprintEvidence] = useState<BlueprintConceptEvidence[]>([]);
  const [bundles, setBundles] = useState<ReviewBundle[]>([]);
  const [revisionDiff, setRevisionDiff] = useState<RevisionDiff | null>(null);
  const [assessmentWorkspace, setAssessmentWorkspace] = useState<AssessmentWorkspace | null>(null);
  const [routingWorkspace, setRoutingWorkspace] = useState<RoutingWorkspace | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [sources, setSources] = useState<CourseSource[]>([]);
  const [agentTasks, setAgentTasks] = useState<CourseAgentTask[]>([]);
  const [canvasView, setCanvasView] = useState<CanvasView>("flow");
  const [blueprintMode, setBlueprintMode] = useState<BlueprintMode>("live");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [directorStream, setDirectorStream] = useState<DirectorStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalStates, setProposalStates] = useState<Record<string, string>>({});
  const [directorOpen, setDirectorOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lectureIntakeOpen, setLectureIntakeOpen] = useState(false);
  const [lectureCreationVideoId, setLectureCreationVideoId] = useState<string | null>(null);
  const [blueprintUndoEntries, setBlueprintUndoEntries] = useState<BlueprintUndoEntry[]>([]);
  const [blueprintUndoing, setBlueprintUndoing] = useState(false);

  const isBuilding = Boolean(
    (run && ["queued", "running"].includes(run.status))
    || (course && ["queued", "running"].includes(course.generation_status ?? "")),
  );
  const focusedCreation = lectureIntakeOpen;
  const composerCentered = lectureIntakeOpen && !run && !sourceLabel && !sending;

  const request = useCallback(async <T,>(path: string, user: DevelopmentIdentity, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set("X-User-ID", user.id);
    const response = await fetch(`${pipelineBase}${path}`, { ...init, headers });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(payload?.detail ?? `Request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }, []);

  const latestBlueprintUndo = blueprintUndoEntries.at(-1) ?? null;

  function rememberBlueprintUndo(label: string, run: () => Promise<void>) {
    setBlueprintUndoEntries((current) => [
      ...current.slice(-19),
      {
        id: crypto.randomUUID(),
        label,
        run,
      },
    ]);
  }

  async function undoBlueprintChange() {
    const entry = blueprintUndoEntries.at(-1);
    if (!entry || blueprintUndoing || sending) return;
    setBlueprintUndoEntries((current) => current.filter((item) => item.id !== entry.id));
    setBlueprintUndoing(true);
    setError(null);
    try {
      await entry.run();
    } catch (caught) {
      setBlueprintUndoEntries((current) => [...current, entry]);
      setError(caught instanceof Error ? caught.message : `Could not undo ${entry.label.toLowerCase()}.`);
    } finally {
      setBlueprintUndoing(false);
    }
  }

  const refreshStructuredWorkspace = useCallback(async (
    user: DevelopmentIdentity,
    includeDashboard = true,
  ) => {
    const [assessments, routing] = await Promise.all([
      request<AssessmentWorkspace>(`/courses/${courseId}/assessment-workspace`, user),
      request<RoutingWorkspace>(`/courses/${courseId}/routing-workspace`, user),
    ]);
    setAssessmentWorkspace(assessments);
    setRoutingWorkspace(routing);
    if (includeDashboard) {
      setDashboardSummary(await request<DashboardSummary>(`/courses/${courseId}/dashboard`, user));
    }
  }, [courseId, request]);

  const refreshArtifacts = useCallback(async (user: DevelopmentIdentity) => {
    setBundles(await request<ReviewBundle[]>(`/courses/${courseId}/review-bundles`, user));
  }, [courseId, request]);

  const refreshBlueprint = useCallback(async (
    user: DevelopmentIdentity,
    summary: CourseSummary,
  ) => {
    const active = summary.active_revision_id
      ? request<CourseBlueprint>(`/courses/${courseId}/blueprint?revision=active`, user)
      : Promise.resolve(null);
    const working = summary.working_revision_id
      ? request<CourseBlueprint>(`/courses/${courseId}/blueprint?revision=working`, user)
      : Promise.resolve(null);
    const evidence = summary.active_revision_id
      ? request<BlueprintConceptEvidence[]>(`/courses/${courseId}/blueprint/evidence?revision=active&days=14`, user)
      : Promise.resolve([]);
    const [activeResult, workingResult, evidenceResult] = await Promise.all([active, working, evidence]);
    setActiveBlueprint(activeResult);
    setWorkingBlueprint(workingResult);
    setBlueprintEvidence(evidenceResult);
  }, [courseId, request]);

  const refreshCourseFlow = useCallback(async (
    user: DevelopmentIdentity,
    summary: CourseSummary,
  ) => {
    const active = summary.active_revision_id
      ? request<CourseFlow>(`/courses/${courseId}/course-flow?revision=active`, user)
      : Promise.resolve(null);
    const working = summary.working_revision_id
      ? request<CourseFlow>(`/courses/${courseId}/course-flow?revision=working`, user)
      : Promise.resolve(null);
    const [activeResult, workingResult] = await Promise.all([active, working]);
    setActiveCourseFlow(activeResult);
    setWorkingCourseFlow(workingResult);
  }, [courseId, request]);

  const refreshRevisionDiff = useCallback(async (
    user: DevelopmentIdentity,
    summary: CourseSummary,
  ) => {
    if (!summary.active_revision_id || !summary.working_revision_id) {
      setRevisionDiff(null);
      return;
    }
    setRevisionDiff(await request<RevisionDiff>(`/courses/${courseId}/revision-diff`, user));
  }, [courseId, request]);

  const refreshIntelligence = useCallback(async (user: DevelopmentIdentity) => {
    const [sourceResult, taskResult] = await Promise.all([
      request<CourseSource[]>(`/courses/${courseId}/sources`, user),
      request<CourseAgentTask[]>(`/courses/${courseId}/agent-tasks`, user),
    ]);
    setSources(sourceResult);
    setAgentTasks(taskResult);
  }, [courseId, request]);

  const loadStudio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = readDevelopmentSession(window.localStorage);
      if (!user || user.role !== "instructor") {
        router.replace("/login");
        return;
      }
      conversationScopeRef.current = null;
      setConversationHydrated(false);
      setIdentity(user);
      const courseResult = await request<CourseSummary>(`/courses/${courseId}/studio`, user);
      setCourse(courseResult);
      setBlueprintMode(courseResult.status === "published" ? "live" : "design");
      setMessages(
        readRuntimeConversation<CourseMessage>("course-director", user.id, courseId),
      );
      conversationScopeRef.current = `${user.id}:${courseId}`;
      setConversationHydrated(true);
      if (shouldHydrateGenerationRun(courseResult) && courseResult.generation_run_id) {
        const runResult = await request<GenerationRun>(
          `/courses/${courseId}/generation-runs/${courseResult.generation_run_id}`,
          user,
        );
        setRun(runResult);
        if (["queued", "running"].includes(runResult.status)) setLectureIntakeOpen(true);
      }
      await refreshArtifacts(user);
      if (courseResult.active_revision_id || courseResult.working_revision_id) {
        await Promise.all([
          refreshBlueprint(user, courseResult),
          refreshCourseFlow(user, courseResult),
        ]);
      }
      await refreshRevisionDiff(user, courseResult);
      if (courseResult.active_revision_id || courseResult.working_revision_id) {
        await refreshIntelligence(user);
      }
      if (courseResult.topic_count > 0) {
        await refreshStructuredWorkspace(user, courseResult.status === "published");
      }
      if (courseResult.status === "published") {
        setCanvasView(
          requestedCanvasView && ["flow", "blueprint", "assessments", "preview"].includes(requestedCanvasView)
            ? requestedCanvasView as CanvasView
            : "flow",
        );
      }
      else {
        setCanvasView(
          requestedCanvasView && ["flow", "blueprint", "assessments", "preview", "review"].includes(requestedCanvasView)
            ? requestedCanvasView as CanvasView
            : "flow",
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the course studio.");
    } finally {
      setLoading(false);
    }
  }, [courseId, refreshArtifacts, refreshBlueprint, refreshCourseFlow, refreshIntelligence, refreshStructuredWorkspace, refreshRevisionDiff, request, requestedCanvasView, router]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  useEffect(() => {
    if (
      !identity
      || !conversationHydrated
      || conversationScopeRef.current !== `${identity.id}:${courseId}`
    ) return;
    writeRuntimeConversation("course-director", identity.id, courseId, messages);
  }, [conversationHydrated, courseId, identity, messages]);

  useEffect(() => {
    if (!identity || !run || !["queued", "running"].includes(run.status)) return;
    const interval = window.setInterval(() => {
      void request<GenerationRun>(`/courses/${courseId}/generation-runs/${run.id}`, identity)
        .then(async (nextRun) => {
          setRun(nextRun);
          if (nextRun.status === "waiting_review") {
            const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
            setCourse(nextCourse);
            await refreshArtifacts(identity);
            await refreshStructuredWorkspace(identity, false);
            await refreshBlueprint(identity, nextCourse);
            await refreshCourseFlow(identity, nextCourse);
            await refreshRevisionDiff(identity, nextCourse);
            const nextFlow = await request<CourseFlow>(`/courses/${courseId}/course-flow?revision=working`, identity);
            setWorkingCourseFlow(nextFlow);
            const generatedLecture = nextFlow.units.find(
              (unit) => unit.kind === "lecture" && unit.video_id === lectureCreationVideoId,
            ) ?? [...nextFlow.units]
              .filter((unit) => unit.kind === "lecture")
              .sort((left, right) => right.sequence_rank - left.sequence_rank)[0];
            setLectureFocusVideoId(generatedLecture?.video_id ?? lectureCreationVideoId);
            setBlueprintMode("design");
            setLectureIntakeOpen(false);
            setSourceLabel(null);
            setCanvasView("blueprint");
          }
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not refresh generation."));
    }, 2200);
    return () => window.clearInterval(interval);
  }, [courseId, identity, lectureCreationVideoId, refreshArtifacts, refreshBlueprint, refreshCourseFlow, refreshStructuredWorkspace, refreshRevisionDiff, request, run]);

  useEffect(() => {
    if (!identity || !agentTasks.some((task) => ["queued", "running"].includes(task.status))) return;
    const interval = window.setInterval(() => {
      void refreshIntelligence(identity).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not refresh the course team.");
      });
    }, 2200);
    return () => window.clearInterval(interval);
  }, [agentTasks, identity, refreshIntelligence]);

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!identity || !composer.trim() || sending) return;
    const content = composer.trim();
    setComposer("");
    if (looksLikeUrl(content) && (lectureIntakeOpen || (course?.source_count ?? 0) === 0)) {
      await ingestUrl(content);
      return;
    }
    setSending(true);
    setError(null);
    const optimisticMessage: CourseMessage = {
      id: `optimistic-${Date.now()}`,
      role: "instructor",
      content,
      blocks: [],
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticMessage]);
    setDirectorStream({ content: "", status: "Reading the course structure…" });
    try {
      let completedMessage: CourseMessage | null = null;
      const response = await fetch(`${pipelineBase}/courses/${courseId}/messages/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": identity.id,
        },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        throw new Error(await responseDetail(response, "Could not send the message."));
      }
      await readDirectorStream(response, (streamEvent) => {
        if (streamEvent.event === "status") {
          setDirectorStream((current) => ({
            content: current?.content ?? "",
            status: typeof streamEvent.data.message === "string"
              ? streamEvent.data.message
              : "Course Director is working…",
          }));
          return;
        }
        if (streamEvent.event === "delta" && typeof streamEvent.data.content === "string") {
          setDirectorStream((current) => ({
            content: `${current?.content ?? ""}${streamEvent.data.content}`,
            status: current?.status ?? "Writing the response…",
          }));
          return;
        }
        if (streamEvent.event === "error") {
          throw new Error(
            typeof streamEvent.data.message === "string"
              ? streamEvent.data.message
              : "Course Director could not complete that request.",
          );
        }
        if (
          streamEvent.event === "done"
          && streamEvent.data.message
          && typeof streamEvent.data.message === "object"
        ) {
          completedMessage = streamEvent.data.message as unknown as CourseMessage;
        }
      });
      if (!completedMessage) {
        throw new Error("Course Director completed without a conversation response.");
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      setMessages((current) => [
        ...current,
        completedMessage as CourseMessage,
      ]);
      setDirectorStream(null);
      await refreshArtifacts(identity);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshCourseFlow(identity, nextCourse),
        refreshRevisionDiff(identity, nextCourse),
        refreshStructuredWorkspace(identity, nextCourse.status === "published"),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the message.");
      setDirectorStream(null);
      setMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
      setComposer(content);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!directorOpen && !focusedCreation) return;
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [directorOpen, directorStream, focusedCreation, messages]);

  async function ingestUrl(url: string) {
    if (!identity) return;
    setSending(true);
    setSourceLabel("Connecting to your lecture…");
    setError(null);
    try {
      const response = await fetch(`${pipelineBase}/videos/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, course_id: courseId, defer_processing: true }),
      });
      if (!response.ok) throw new Error(await responseDetail(response, "Could not ingest this lecture link."));
      const job = (await response.json()) as { id: string; video_id: string | null };
      if (!job.video_id) throw new Error("The lecture source did not create a video.");
      await startGeneration(job.video_id, job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this lecture.");
      setSourceLabel(null);
    } finally {
      setSending(false);
    }
  }

  async function ingestFile(file: File) {
    if (!identity) return;
    setSending(true);
    setSourceLabel(`Uploading ${file.name}…`);
    setError(null);
    try {
      const form = new FormData();
      form.set("course_id", courseId);
      form.set("defer_processing", "true");
      form.set("file", file);
      const response = await fetch(`${pipelineBase}/videos/upload`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await responseDetail(response, "Could not upload this lecture."));
      const job = (await response.json()) as { id: string; video_id: string | null };
      if (!job.video_id) throw new Error("The lecture upload did not create a video.");
      await startGeneration(job.video_id, job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload this lecture.");
      setSourceLabel(null);
    } finally {
      setSending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function startGeneration(videoId: string, ingestionJobId: string) {
    if (!identity) return;
    setLectureCreationVideoId(videoId);
    setLectureFocusVideoId(videoId);
    const nextRun = await request<GenerationRun>(`/courses/${courseId}/generation-runs`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, ingestion_job_id: ingestionJobId }),
    });
    setRun(nextRun);
    setSourceLabel("Lecture received. Course Director is building its private Blueprint.");
    setCourse(await request<CourseSummary>(`/courses/${courseId}/studio`, identity));
  }

  async function saveCourseFlowUnit(
    draft: CourseFlowDraftPayload,
    unit?: CourseFlowUnit,
  ) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      const next = await request<CourseFlow>(
        unit
          ? `/courses/${courseId}/course-flow/units/${unit.logical_id}`
          : `/courses/${courseId}/course-flow/units`,
        identity,
        {
          method: unit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...draft,
            module_logical_id: draft.module_logical_id,
          }),
        },
      );
      setWorkingCourseFlow(next);
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      setBlueprintMode("design");
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the course unit.");
    } finally {
      setSending(false);
    }
  }

  async function createCourseFlowModule(title: string, summary: string) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      setWorkingCourseFlow(await request<CourseFlow>(
        `/courses/${courseId}/course-flow/modules`,
        identity,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, summary }),
        },
      ));
      setBlueprintMode("design");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this module.");
    } finally {
      setSending(false);
    }
  }

  async function saveCourseFlowPosition(
    logicalArtifactId: string,
    x: number,
    y: number,
    previous?: { x: number; y: number },
    rememberUndo = true,
  ) {
    if (!identity) return;
    setError(null);
    try {
      setWorkingCourseFlow(await request<CourseFlow>(
        `/courses/${courseId}/course-flow/layout/${logicalArtifactId}`,
        identity,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x, y }),
        },
      ));
      setBlueprintMode("design");
      if (rememberUndo && previous && (previous.x !== x || previous.y !== y)) {
        rememberBlueprintUndo("Move course unit", async () => {
          await saveCourseFlowPosition(
            logicalArtifactId,
            previous.x,
            previous.y,
            { x, y },
            false,
          );
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the Course Flow layout.");
      throw caught;
    }
  }

  async function removeCourseFlowUnit(unit: CourseFlowUnit) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      setWorkingCourseFlow(await request<CourseFlow>(
        `/courses/${courseId}/course-flow/units/${unit.logical_id}`,
        identity,
        { method: "DELETE" },
      ));
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      setBlueprintMode("design");
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the course unit.");
    } finally {
      setSending(false);
    }
  }

  async function reviewCourseFlowArtifact(
    artifactKind: "unit" | "relationship",
    logicalArtifactId: string,
    decision: "accepted" | "edited" | "dismissed",
  ) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      setWorkingCourseFlow(await request<CourseFlow>(
        `/courses/${courseId}/course-flow/review`,
        identity,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifact_kind: artifactKind,
            logical_artifact_id: logicalArtifactId,
            decision,
          }),
        },
      ));
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await refreshRevisionDiff(identity, nextCourse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not review this Course Flow proposal.");
    } finally {
      setSending(false);
    }
  }

  async function mutateCourseFlowEdge(
    draft: CourseFlowEdgeDraft,
    action: "create" | "delete",
    rememberUndo = true,
  ) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      setWorkingCourseFlow(await request<CourseFlow>(
        `/courses/${courseId}/course-flow/relationships`,
        identity,
        {
          method: action === "create" ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      ));
      setBlueprintMode("design");
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await refreshRevisionDiff(identity, nextCourse);
      if (rememberUndo) {
        rememberBlueprintUndo(
          `${action === "create" ? "Add" : "Remove"} course relationship`,
          async () => {
            await mutateCourseFlowEdge(
              draft,
              action === "create" ? "delete" : "create",
              false,
            );
          },
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change this Course Flow relationship.");
    } finally {
      setSending(false);
    }
  }

  async function resolveProposal(
    proposalId: string,
    decision: Decision,
    instructorRevision?: Record<string, unknown>,
  ) {
    if (!identity) return;
    setProposalStates((current) => ({ ...current, [proposalId]: "saving" }));
    try {
      const payload = await request<{ status: string }>(
        `/courses/${courseId}/proposals/${proposalId}/resolve`,
        identity,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            instructor_revision: instructorRevision ?? null,
          }),
        },
      );
      setProposalStates((current) => ({ ...current, [proposalId]: payload.status }));
      setMessages((current) => current.map((message) => ({
        ...message,
        blocks: message.blocks.map((block) => (
          block.type === "proposal" && block.proposal_id === proposalId
            ? { ...block, status: payload.status }
            : block
        )),
      })));
      if (decision !== "dismissed" && course) {
        const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
        setCourse(nextCourse);
        setBlueprintMode("design");
        await Promise.all([
          refreshBlueprint(identity, nextCourse),
          refreshCourseFlow(identity, nextCourse),
          refreshRevisionDiff(identity, nextCourse),
          refreshStructuredWorkspace(identity, nextCourse.status === "published"),
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resolve the proposal.");
      setProposalStates((current) => ({ ...current, [proposalId]: "proposed" }));
    }
  }

  async function retryGeneration() {
    if (!identity || !run) return;
    try {
      setRun(await request<GenerationRun>(`/courses/${courseId}/generation-runs/${run.id}/retry`, identity, { method: "POST" }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry generation.");
    }
  }

  async function publishRevision() {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      const nextCourse = await request<CourseSummary>(
        `/courses/${courseId}/publish-revision`,
        identity,
        { method: "POST" },
      );
      setCourse(nextCourse);
      setRun(null);
      setRevisionDiff(null);
      setBlueprintUndoEntries([]);
      await refreshArtifacts(identity);
      await refreshStructuredWorkspace(identity);
      await refreshBlueprint(identity, nextCourse);
      await refreshCourseFlow(identity, nextCourse);
      setCanvasView("flow");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not publish this revision.");
    } finally {
      setSending(false);
    }
  }

  async function decideItem(item: ReviewItem, decision: Decision, revision?: Record<string, unknown>) {
    if (!identity) return;
    try {
      await request(`/courses/${courseId}/review-items/${item.id}/resolve`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, instructor_revision: revision ?? null }),
      });
      await refreshArtifacts(identity);
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await refreshRevisionDiff(identity, nextCourse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this review decision.");
    }
  }

  async function decideBundle(bundle: ReviewBundle) {
    if (!identity) return;
    try {
      await request(`/courses/${courseId}/review-bundles/${bundle.id}/resolve-remaining`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "accepted" }),
      });
      await refreshArtifacts(identity);
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await refreshRevisionDiff(identity, nextCourse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not approve this review bundle.");
    }
  }

  async function refreshAfterStructuredEdit() {
    if (!identity) return;
    const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
    setCourse(nextCourse);
    await Promise.all([
      refreshArtifacts(identity),
      refreshStructuredWorkspace(identity),
      refreshBlueprint(identity, nextCourse),
      refreshCourseFlow(identity, nextCourse),
      refreshRevisionDiff(identity, nextCourse),
    ]);
  }

  async function saveAssessment(
    draft: AssessmentDraftPayload,
    question?: CourseAssessment,
  ) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      await request(
        question
          ? `/courses/${courseId}/assessments/${question.id}`
          : `/courses/${courseId}/assessments`,
        identity,
        {
          method: question ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      await refreshAfterStructuredEdit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the assessment.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function removeAssessment(question: CourseAssessment) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      await request(`/courses/${courseId}/assessments/${question.id}`, identity, {
        method: "DELETE",
      });
      await refreshAfterStructuredEdit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the assessment.");
    } finally {
      setSending(false);
    }
  }

  async function saveRoutingPolicy(conceptId: string | null, policy: RoutingPolicy) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      await request(
        `/courses/${courseId}/routing-workspace/${conceptId ?? "default"}`,
        identity,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(policy),
        },
      );
      await refreshAfterStructuredEdit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the routing policy.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function removeRoutingPolicy(conceptId: string) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      await request(`/courses/${courseId}/routing-workspace/${conceptId}`, identity, {
        method: "DELETE",
      });
      await refreshAfterStructuredEdit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the policy override.");
    } finally {
      setSending(false);
    }
  }

  async function uploadSupplementalSource(file: File, purpose: CourseSource["purpose"]) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", purpose);
      const response = await fetch(`${pipelineBase}/courses/${courseId}/sources`, {
        method: "POST",
        headers: { "X-User-ID": identity.id },
        body: form,
      });
      if (!response.ok) throw new Error(await responseDetail(response, "Could not add this source."));
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshIntelligence(identity),
        refreshArtifacts(identity),
        refreshStructuredWorkspace(identity),
        refreshBlueprint(identity, nextCourse),
        refreshRevisionDiff(identity, nextCourse),
      ]);
      setSourcesOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this source.");
    } finally {
      setSending(false);
      if (sourceInput.current) sourceInput.current.value = "";
    }
  }

  async function updateSupplementalSource(
    source: CourseSource,
    update: Partial<Pick<CourseSource, "purpose" | "review_status" | "learner_visible">>,
  ) {
    if (!identity) return;
    setSending(true);
    try {
      await request(`/courses/${courseId}/sources/${source.id}`, identity, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: update.purpose ?? source.purpose,
          review_status: update.review_status ?? source.review_status,
          learner_visible: update.learner_visible ?? source.learner_visible,
        }),
      });
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshIntelligence(identity),
        refreshArtifacts(identity),
        refreshStructuredWorkspace(identity),
        refreshBlueprint(identity, nextCourse),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this source.");
    } finally {
      setSending(false);
    }
  }

  async function retrySupplementalSource(source: CourseSource) {
    if (!identity) return;
    try {
      await request(`/courses/${courseId}/sources/${source.id}/retry`, identity, { method: "POST" });
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshIntelligence(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry source analysis.");
    }
  }

  async function updateBlueprintSequence(conceptIds: string[], rememberUndo = true) {
    if (!identity) return;
    const previousConceptIds = (workingBlueprint?.nodes ?? [])
      .filter((node) => node.kind === "concept")
      .sort(compareBlueprintSequence)
      .map((node) => node.logical_id);
    setSending(true);
    try {
      const next = await request<CourseBlueprint>(`/courses/${courseId}/blueprint/sequence`, identity, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept_ids: conceptIds }),
      });
      setWorkingBlueprint(next);
      if (
        rememberUndo
        && previousConceptIds.length
        && previousConceptIds.join(":") !== conceptIds.join(":")
      ) {
        rememberBlueprintUndo("Change learning order", async () => {
          await updateBlueprintSequence(previousConceptIds, false);
        });
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the learner sequence.");
    } finally {
      setSending(false);
    }
  }

  async function mutateBlueprintRelationship(
    method: "POST" | "DELETE" | "PATCH",
    body: BlueprintRelationshipSpec | {
      previous: BlueprintRelationshipSpec;
      replacement: BlueprintRelationshipSpec;
    },
    rememberUndo = true,
  ) {
    if (!identity) return null;
    setSending(true);
    setError(null);
    try {
      const next = await request<CourseBlueprint>(
        `/courses/${courseId}/blueprint/relationships`,
        identity,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      setWorkingBlueprint(next);
      if (rememberUndo) {
        if (method === "POST") {
          const relationship = body as BlueprintRelationshipSpec;
          rememberBlueprintUndo(
            `Add ${blueprintRelationshipLabels[relationship.relationship].toLowerCase()} connection`,
            async () => {
              await mutateBlueprintRelationship("DELETE", relationship, false);
            },
          );
        } else if (method === "DELETE") {
          const relationship = body as BlueprintRelationshipSpec;
          rememberBlueprintUndo(
            `Remove ${blueprintRelationshipLabels[relationship.relationship].toLowerCase()} connection`,
            async () => {
              await mutateBlueprintRelationship("POST", relationship, false);
            },
          );
        } else {
          const reconnect = body as {
            previous: BlueprintRelationshipSpec;
            replacement: BlueprintRelationshipSpec;
          };
          rememberBlueprintUndo(
            `Change ${blueprintRelationshipLabels[reconnect.replacement.relationship].toLowerCase()} connection`,
            async () => {
              await mutateBlueprintRelationship("PATCH", {
                previous: reconnect.replacement,
                replacement: reconnect.previous,
              }, false);
            },
          );
        }
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshArtifacts(identity),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that relationship.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function createBlueprintTopic(draft: {
    title: string;
    summary: string;
    start_seconds: number;
    end_seconds: number;
  }) {
    if (!identity) return null;
    const previousLogicalIds = new Set(workingBlueprint?.nodes.map((node) => node.logical_id) ?? []);
    setSending(true);
    try {
      const next = await request<CourseBlueprint>(`/courses/${courseId}/blueprint/topics`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setWorkingBlueprint(next);
      const created = next.nodes.find((node) => node.kind === "topic" && !previousLogicalIds.has(node.logical_id));
      if (created) {
        rememberBlueprintUndo(`Add ${created.title}`, async () => {
          await removeBlueprintArtifact(created, true);
        });
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add that topic.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function updateBlueprintTopic(node: BlueprintNode, draft: {
    title: string;
    summary: string;
    start_seconds: number;
    end_seconds: number;
  }, rememberUndo = true) {
    if (!identity) return null;
    setSending(true);
    try {
      const next = await request<CourseBlueprint>(
        `/courses/${courseId}/blueprint/topics/${node.logical_id}`,
        identity,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      setWorkingBlueprint(next);
      if (rememberUndo) {
        const previousDraft = {
          title: node.title,
          summary: String(node.metadata.summary ?? ""),
          start_seconds: Number(node.metadata.start_seconds ?? 0),
          end_seconds: Number(node.metadata.end_seconds ?? 0),
        };
        rememberBlueprintUndo(`Edit ${node.title}`, async () => {
          await updateBlueprintTopic(node, previousDraft, false);
        });
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that topic.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function createBlueprintConcept(draft: {
    name: string;
    description: string;
    topic_logical_ids: string[];
    sequence_after_id: string | null;
  }) {
    if (!identity) return null;
    const previousLogicalIds = new Set(workingBlueprint?.nodes.map((node) => node.logical_id) ?? []);
    setSending(true);
    try {
      const next = await request<CourseBlueprint>(
        `/courses/${courseId}/blueprint/concepts`,
        identity,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      setWorkingBlueprint(next);
      const created = next.nodes.find((node) => node.kind === "concept" && !previousLogicalIds.has(node.logical_id));
      if (created) {
        rememberBlueprintUndo(`Add ${created.title}`, async () => {
          await removeBlueprintArtifact(created, true);
        });
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add that concept.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function updateBlueprintConcept(
    node: BlueprintNode,
    name: string,
    description: string,
    rememberUndo = true,
  ) {
    if (!identity) return;
    setSending(true);
    try {
      const next = await request<CourseBlueprint>(`/courses/${courseId}/blueprint/concepts/${node.logical_id}`, identity, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      setWorkingBlueprint(next);
      if (rememberUndo) {
        rememberBlueprintUndo(`Edit ${node.title}`, async () => {
          await updateBlueprintConcept(
            node,
            node.title,
            String(node.metadata.description ?? ""),
            false,
          );
        });
      }
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that concept.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function inspectBlueprintRemoval(node: BlueprintNode) {
    if (!identity || !["topic", "concept", "clip", "question"].includes(node.kind)) return null;
    return request<BlueprintMutationImpact>(
      `/courses/${courseId}/blueprint/artifacts/${node.kind}/${node.logical_id}/impact`,
      identity,
    );
  }

  async function removeBlueprintArtifact(node: BlueprintNode, preserveUndoHistory = false) {
    if (!identity || !["topic", "concept", "clip", "question"].includes(node.kind)) return null;
    setSending(true);
    try {
      const next = await request<CourseBlueprint>(
        `/courses/${courseId}/blueprint/artifacts/${node.kind}/${node.logical_id}`,
        identity,
        { method: "DELETE" },
      );
      setWorkingBlueprint(next);
      if (!preserveUndoHistory) setBlueprintUndoEntries([]);
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshBlueprint(identity, nextCourse),
        refreshStructuredWorkspace(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove that artifact.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function saveBlueprintPosition(
    node: BlueprintNode,
    x: number,
    y: number,
    previousPosition?: { x: number; y: number } | null,
    rememberUndo = true,
  ) {
    if (!identity) return;
    const hadWorkingBlueprint = Boolean(workingBlueprint);
    try {
      await request(`/courses/${courseId}/map/layout`, identity, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: [{ logical_artifact_id: node.logical_id, x, y }],
        }),
      });
      if (rememberUndo && previousPosition) {
        rememberBlueprintUndo(`Move ${node.title}`, async () => {
          await saveBlueprintPosition(
            node,
            previousPosition.x,
            previousPosition.y,
            { x, y },
            false,
          );
        });
      }
      setWorkingBlueprint((current) => current ? {
        ...current,
        nodes: current.nodes.map((item) => item.logical_id === node.logical_id
          ? {
            ...item,
            metadata: {
              ...item.metadata,
              layout: { x, y },
            },
          }
          : item),
      } : current);
      if (!hadWorkingBlueprint) {
        const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
        setCourse(nextCourse);
        await Promise.all([
          refreshBlueprint(identity, nextCourse),
          refreshRevisionDiff(identity, nextCourse),
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the Blueprint position.");
      throw caught;
    }
  }

  async function resolvePrerequisite(edge: BlueprintEdge, decision: "accepted" | "dismissed") {
    if (!identity || !edge.id.startsWith("requires:")) return;
    setSending(true);
    try {
      const edgeId = edge.id.slice("requires:".length);
      await request(`/courses/graph/edges/${edgeId}/${decision === "accepted" ? "accept" : "dismiss"}`, identity, {
        method: "POST",
      });
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([refreshBlueprint(identity, nextCourse), refreshArtifacts(identity)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not review that relationship.");
    } finally {
      setSending(false);
    }
  }

  async function requestBlueprintImprovement(node: BlueprintNode, neighboringNodes: BlueprintNode[]) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      await request(`/courses/${courseId}/agent-tasks`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specialist_role: node.kind === "clip" ? "clip_editor" : node.kind === "question" ? "assessment_designer" : "curriculum_architect",
          task_type: "prepare_improvement",
          target_artifact_type: node.kind,
          target_logical_artifact_id: node.logical_id,
          instruction: `Prepare a misconception-recovery improvement pack for ${node.title}. Keep every artifact independently reviewable.`,
          evidence: {
            pack_targets: neighboringNodes.slice(0, 5).map((item) => ({
              artifact_type: item.kind,
              logical_artifact_id: item.logical_id,
              title: item.title,
            })),
          },
        }),
      });
      await refreshIntelligence(identity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not brief the course team.");
    } finally {
      setSending(false);
    }
  }

  async function requestBlueprintCleanup(
    node: BlueprintNode,
    neighboringNodes: BlueprintNode[],
    suggestedPrerequisite: {
      from_concept_logical_id: string;
      to_concept_logical_id: string;
    } | null,
  ) {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      await request(`/courses/${courseId}/agent-tasks`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specialist_role: "curriculum_architect",
          task_type: "cleanup_blueprint",
          target_artifact_type: node.kind,
          target_logical_artifact_id: node.logical_id,
          instruction: (
            `Review the recent instructor edit around “${node.title}”. `
            + "Only propose adjacent cleanup that improves coherence, coverage, prerequisites, or remediation."
          ),
          evidence: {
            mutation_anchor: {
              artifact_type: node.kind,
              logical_artifact_id: node.logical_id,
              title: node.title,
            },
            pack_targets: neighboringNodes.slice(0, 4).map((item) => ({
              artifact_type: item.kind,
              logical_artifact_id: item.logical_id,
              title: item.title,
            })),
            suggested_prerequisite: suggestedPrerequisite,
          },
        }),
      });
      await refreshIntelligence(identity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run Blueprint cleanup.");
      throw caught;
    } finally {
      setSending(false);
    }
  }

  async function loadAgentTaskPack(taskId: string) {
    if (!identity) throw new Error("Sign in as an instructor to inspect this proposal pack.");
    return request<AgentTaskPack>(`/courses/${courseId}/agent-tasks/${taskId}`, identity);
  }

  async function resolvePackProposal(
    proposal: AgentTaskProposal,
    decision: Decision,
    instructorRevision?: Record<string, unknown>,
  ) {
    await resolveProposal(proposal.id, decision, instructorRevision);
    if (!identity) return;
    const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
    setCourse(nextCourse);
    await Promise.all([
      refreshBlueprint(identity, nextCourse),
      refreshIntelligence(identity),
      refreshRevisionDiff(identity, nextCourse),
    ]);
  }

  async function leaveStudio() {
    const disposablePlaceholder = course?.title.trim().toLowerCase() === "untitled course";
    if (identity && course?.status === "draft" && course.source_count === 0 && disposablePlaceholder) {
      setSending(true);
      setError(null);
      try {
        const response = await fetch(`${pipelineBase}/courses/${courseId}`, {
          method: "DELETE",
          headers: { "X-User-ID": identity.id },
        });
        if (!response.ok) {
          throw new Error(await responseDetail(response, "Could not discard the empty course."));
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not discard the empty course.");
        setSending(false);
        return;
      }
    }
    router.push("/app");
  }

  const editingLocked = course?.status === "published" && !course.working_revision_id;
  const hasUnpublishedChanges = Boolean(revisionDiff?.changes.length);
  const canPublish = Boolean(
    course?.working_revision_id
    && course.topic_count > 0
    && !isBuilding
    && (
      course.status === "published"
        ? hasUnpublishedChanges
        : course.pending_review_count === 0
          && bundles.length >= 3
          && bundles.every((bundle) => bundle.status === "complete")
    )
  );

  const focusedActiveBlueprint = useMemo(
    () => filterBlueprintForLecture(activeBlueprint, lectureFocusVideoId),
    [activeBlueprint, lectureFocusVideoId],
  );
  const focusedWorkingBlueprint = useMemo(
    () => filterBlueprintForLecture(workingBlueprint, lectureFocusVideoId),
    [workingBlueprint, lectureFocusVideoId],
  );
  const focusedAssessmentWorkspace = useMemo(
    () => filterAssessmentWorkspaceForBlueprint(
      assessmentWorkspace,
      focusedWorkingBlueprint ?? focusedActiveBlueprint,
      lectureFocusVideoId,
    ),
    [assessmentWorkspace, focusedActiveBlueprint, focusedWorkingBlueprint, lectureFocusVideoId],
  );
  const focusedLectureUnit = useMemo(
    () => (workingCourseFlow?.units ?? activeCourseFlow?.units ?? []).find(
      (unit) => unit.kind === "lecture" && unit.video_id === lectureFocusVideoId,
    ) ?? null,
    [activeCourseFlow, lectureFocusVideoId, workingCourseFlow],
  );
  const directorContext = focusedLectureUnit
    ? `${focusedLectureUnit.title} · ${courseDirectorViewLabel(canvasView)}`
    : canvasView === "blueprint"
      ? "Cross-lecture concept map"
      : `${course?.title ?? "Course"} · Course Flow`;

  const courseDirector = (
    <section
      className={`${styles.conversationPanel} ${focusedCreation ? styles.creationConversation : styles.dockedConversation}`}
      data-composer-centered={composerCentered || undefined}
      aria-label={focusedCreation ? "Course Director" : undefined}
      aria-labelledby={focusedCreation ? undefined : "conversation-title"}
    >
      {composerCentered ? (
        <div className={styles.creationGreeting}>
          <SunMedium aria-hidden="true" />
          <h2>Good {greetingTime()}, {teacherFirstName(identity?.display_name)}.</h2>
        </div>
      ) : null}
      <div className={styles.messageList} ref={messageListRef}>
        {!focusedCreation ? (
          <div className={styles.directorContextStatus}>
            <span>Right now:</span>
            <strong>{directorContext}</strong>
          </div>
        ) : null}
        {!focusedCreation && !messages.length && !directorStream ? (
          <DirectorWelcome
            courseTitle={course?.title ?? "this course"}
            teacherName={teacherFirstName(identity?.display_name)}
          />
        ) : null}
        {!focusedCreation ? messages.filter((message) => message.role !== "system").map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            proposalStates={proposalStates}
            onResolve={resolveProposal}
          />
        )) : null}
        {!focusedCreation && directorStream ? <StreamingMessageBubble stream={directorStream} /> : null}

        {!focusedCreation && (course?.source_count ?? 0) === 0 ? (
          <SourceRequest onChoose={() => fileInput.current?.click()} />
        ) : null}

        {run ? (
          <GenerationActivity run={run} sourceLabel={sourceLabel} onRetry={retryGeneration} />
        ) : sourceLabel ? <GenerationActivityLabel label={sourceLabel} /> : null}
      </div>

      <form className={styles.composer} onSubmit={submitMessage}>
        <input
          accept="audio/*,video/*"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void ingestFile(file);
          }}
          ref={fileInput}
          type="file"
        />
        <textarea
          aria-label="Message Course Director"
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={editingLocked && !lectureIntakeOpen
            ? "Ask about learner evidence, or request a private course change…"
            : lectureIntakeOpen
              ? "What lecture would you like to add? Paste a lecture link or add a file…"
              : (course?.source_count ?? 0) === 0
                ? "Ask about or change this course…"
              : "Ask about or change this course…"}
          rows={focusedCreation ? 4 : 3}
          value={composer}
        />
        <div>
          <button aria-label="Attach lecture" disabled={editingLocked && !lectureIntakeOpen} onClick={() => fileInput.current?.click()} type="button">{composerCentered ? <Plus /> : <Paperclip />}</button>
          <span>{composerCentered ? null : "Enter to send · Shift + Enter for a new line"}</span>
          <button aria-label="Send message" className={styles.sendButton} disabled={!composer.trim() || sending} type="submit">
            {sending ? <LoaderCircle className={styles.spin} /> : <ArrowUp />}
          </button>
        </div>
      </form>
    </section>
  );

  return (
    <div className={`${styles.appShell} ${styles.studioApp} ${sidebarCollapsed ? styles.sidebarCollapsedShell : ""}`}>
      <TeacherSidebar collapsed={sidebarCollapsed} compact identity={identity} onToggle={toggleSidebar} />
      <motion.main
        className={styles.studioMain}
        data-motion-scope="page-enter"
        {...pageEntranceMotion(reducedMotion)}
      >
        <input
          accept="application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.pptx"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadSupplementalSource(file, "ai_context");
          }}
          ref={sourceInput}
          type="file"
        />
        <header className={styles.studioHeader}>
          <div className={styles.studioTitle}>
            <button
              aria-label={lectureFocusVideoId ? "Back to Course Flow" : "Back to courses"}
              disabled={sending}
              onClick={() => {
                if (lectureFocusVideoId) {
                  setLectureFocusVideoId(null);
                  setCanvasView("flow");
                  return;
                }
                void leaveStudio();
              }}
              type="button"
            ><ArrowLeft /></button>
            <AnimatePresence initial={false} mode="wait">
              <motion.h1
                animate={{ opacity: 1, y: 0 }}
                data-motion-scope="studio-context-title"
                exit={reducedMotion ? undefined : { opacity: 0, y: -3 }}
                initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                key={focusedLectureUnit?.logical_id ?? course?.id ?? "course-studio"}
                transition={reducedMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: interfaceEase }}
              >
                {focusedLectureUnit?.title ?? course?.title ?? "Course studio"}
              </motion.h1>
            </AnimatePresence>
          </div>
          {!focusedCreation && lectureFocusVideoId ? (
            <motion.nav
              animate={{ opacity: 1, x: 0 }}
              aria-label="Course views"
              className={styles.studioViewTabs}
              initial={reducedMotion ? false : { opacity: 0, x: 8 }}
              transition={reducedMotion
                ? { duration: 0 }
                : { delay: 0.06, duration: 0.24, ease: interfaceEase }}
            >
              <CanvasTab active={canvasView === "blueprint"} icon={<GitFork />} label="Blueprint" onClick={() => setCanvasView("blueprint")} />
              <CanvasTab active={canvasView === "assessments"} icon={<Check />} label="Assessments" onClick={() => setCanvasView("assessments")} />
              <CanvasTab active={canvasView === "preview"} icon={<Eye />} label="Preview" onClick={() => setCanvasView("preview")} />
            </motion.nav>
          ) : <span className={styles.studioHeaderSpacer} />}
          <div className={styles.studioHeaderActions}>
            {focusedCreation ? (
              <button className={styles.studioIntakeBack} disabled={sending && Boolean(run)} onClick={() => {
                setLectureIntakeOpen(false);
                setSourceLabel(null);
                setComposer("");
                setCanvasView("flow");
              }} type="button"><ArrowLeft />Course Flow</button>
            ) : null}
            {!focusedCreation ? (
              <>
                <div className={styles.studioSettingsMenu}>
                  <button aria-expanded={settingsOpen} aria-label="Course settings" className={styles.studioSettingsButton} onClick={() => setSettingsOpen((current) => !current)} type="button"><Settings /></button>
                  {settingsOpen ? <CourseSettingsPopover disabled={sending} onClose={() => setSettingsOpen(false)} onRemove={removeRoutingPolicy} onSave={saveRoutingPolicy} workspace={routingWorkspace} /> : null}
                </div>
                <button className={styles.studioSourceButton} onClick={() => setSourcesOpen(true)} type="button">
                  <FileText /><span>Sources</span><i>{sources.length}</i>
                </button>
              </>
            ) : null}
            <div className={styles.studioStatus}>
              {isBuilding ? <span data-tone="building"><LoaderCircle className={styles.spin} />{Math.round(run?.progress ?? course?.generation_progress ?? 0)}% building</span>
                : course?.status !== "published" && course?.pending_review_count ? <span data-tone="review"><ClipboardCheck />{course.pending_review_count} to review</span>
                  : course?.status !== "published" ? <span><Activity />Private</span>
                    : null}
              {!editingLocked && (course?.status !== "published" || hasUnpublishedChanges) ? (
                <button disabled={!canPublish || sending} onClick={() => void publishRevision()} type="button">
                  {course?.status === "published" ? "Publish updates" : "Publish course"}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {error ? <div className={styles.studioError} role="alert"><CircleAlert /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div> : null}

        <MotionHandoff
          className={styles.studioMotionStage}
          loading={loading}
          skeleton={<StudioSkeleton />}
        >
          {focusedCreation ? (
            <div className={styles.creationStage}>{courseDirector}</div>
          ) : (
            <div className={styles.workspaceStage}>
              <section className={styles.canvasPanel} aria-label="Course workspace canvas">
              <div className={styles.canvasBody}>
                <AnimatePresence mode="wait">
                  <motion.div
                    className={styles.workspaceViewMotion}
                    data-motion-view={canvasView}
                    key={`${canvasView}:${lectureFocusVideoId ?? "course"}`}
                    {...workspaceViewMotion(reducedMotion)}
                  >
                {canvasView === "flow" ? (
                  <CourseFlowWorkspace
                    activeFlow={activeCourseFlow}
                    concepts={(workingBlueprint ?? activeBlueprint)?.nodes.filter((node) => node.kind === "concept") ?? []}
                    disabled={sending}
                    mode={blueprintMode}
                    onAddLecture={() => {
                      setRun(null);
                      setSourceLabel(null);
                      setComposer("");
                      setLectureCreationVideoId(null);
                      setLectureIntakeOpen(true);
                    }}
                    onAddModule={(title, summary) => void createCourseFlowModule(title, summary)}
                    onModeChange={setBlueprintMode}
                    onOpenLecture={(unit) => {
                      setLectureFocusVideoId(unit.video_id);
                      setCanvasView("blueprint");
                    }}
                    onOpenWholeCourse={() => {
                      setLectureFocusVideoId(null);
                      setCanvasView("blueprint");
                    }}
                    onLayout={saveCourseFlowPosition}
                    onRelationship={mutateCourseFlowEdge}
                    onRemove={(unit) => void removeCourseFlowUnit(unit)}
                    onReview={reviewCourseFlowArtifact}
                    onSave={(draft, unit) => void saveCourseFlowUnit(draft, unit)}
                    onUndo={undoBlueprintChange}
                    undoLabel={latestBlueprintUndo?.label ?? null}
                    undoing={blueprintUndoing}
                    workingFlow={workingCourseFlow}
                  />
                ) : null}
                {canvasView === "blueprint" ? (
                  <BlueprintWorkspace
                    activeBlueprint={focusedActiveBlueprint}
                    agentTasks={agentTasks}
                    blueprintEvidence={blueprintEvidence}
                    contextTitle={focusedLectureUnit?.title ?? "Cross-lecture concept map"}
                    dashboard={dashboardSummary}
                    disabled={sending}
                    mode={blueprintMode}
                    onAddConcept={createBlueprintConcept}
                    onAddTopic={createBlueprintTopic}
                    onAskDirector={(node) => {
                      setComposer(`Help me improve “${node.title}”. Trace the learner evidence and propose the smallest effective private change.`);
                      setDirectorOpen(true);
                    }}
                    onLoadPack={loadAgentTaskPack}
                    onLayout={saveBlueprintPosition}
                    onPrepare={requestBlueprintImprovement}
                    onCleanup={requestBlueprintCleanup}
                    onCreateRelationship={(relationship) => mutateBlueprintRelationship("POST", relationship)}
                    onInspectRemoval={inspectBlueprintRemoval}
                    onReconnectRelationship={(previous, replacement) => mutateBlueprintRelationship("PATCH", { previous, replacement })}
                    onRemoveArtifact={removeBlueprintArtifact}
                    onRemoveRelationship={(relationship) => mutateBlueprintRelationship("DELETE", relationship)}
                    onResolvePrerequisite={resolvePrerequisite}
                    onResolveProposal={resolvePackProposal}
                    onSequence={updateBlueprintSequence}
                    onUndo={undoBlueprintChange}
                    onUpdateConcept={updateBlueprintConcept}
                    onUpdateTopic={updateBlueprintTopic}
                    onOpenAssessments={() => setCanvasView("assessments")}
                    onOpenSources={() => setSourcesOpen(true)}
                    onBackToCourseFlow={() => {
                      setLectureFocusVideoId(null);
                      setCanvasView("flow");
                    }}
                    onModeChange={setBlueprintMode}
                    clips={assessmentWorkspace?.clips ?? []}
                    undoing={blueprintUndoing}
                    undoLabel={latestBlueprintUndo?.label ?? null}
                    workingBlueprint={focusedWorkingBlueprint}
                  />
                ) : null}
                {canvasView === "review" && course?.status !== "published" ? <ReviewCanvas bundles={bundles} onBundle={decideBundle} onItem={decideItem} /> : null}
                {canvasView === "assessments" ? <AssessmentsCanvas courseFlow={null} disabled={sending} onRemove={removeAssessment} onSave={saveAssessment} workspace={focusedAssessmentWorkspace} /> : null}
                {canvasView === "preview" ? <PreviewCanvas course={course} courseFlow={null} workspace={focusedAssessmentWorkspace} /> : null}
                  </motion.div>
                </AnimatePresence>
              </div>
              </section>
              <AssistantMorph
                closeButtonClassName={styles.directorDockClose}
                icon={<MessageSquareText />}
                label="Course Director"
                launcherClassName={styles.directorLauncher}
                launcherIdentityClassName={styles.directorLauncherIdentity}
                onOpenChange={setDirectorOpen}
                open={directorOpen}
                panelClassName={styles.directorDock}
                panelContentClassName={styles.directorMorphContent}
                panelHeaderClassName={styles.panelHeader}
                panelIdentityClassName={styles.directorIdentity}
                surfaceId="course-director-shell"
                titleId="conversation-title"
              >
                {courseDirector}
              </AssistantMorph>
              {sourcesOpen ? (
                <SourcesDrawer
                  disabled={sending}
                  onClose={() => setSourcesOpen(false)}
                  onRetry={retrySupplementalSource}
                  onUpdate={updateSupplementalSource}
                  onUpload={() => sourceInput.current?.click()}
                  sources={sources}
                />
              ) : null}
            </div>
          )}
        </MotionHandoff>
      </motion.main>
    </div>
  );
}

function DirectorWelcome({
  courseTitle,
  teacherName,
}: {
  courseTitle: string;
  teacherName: string;
}) {
  return (
    <article
      className={`${styles.messageBubble} ${styles.directorWelcomeMessage}`}
      data-role="manifold"
    >
      <span className={styles.agentAvatar}><MessageSquareText /></span>
      <div>
        <small>Course Director</small>
        <p>
          Welcome back, {teacherName}. I’m ready to help with {courseTitle}. Ask me
          to inspect this workspace, explain learner evidence, or prepare a private
          change for your review.
        </p>
      </div>
    </article>
  );
}

function StreamingMessageBubble({ stream }: { stream: DirectorStream }) {
  return (
    <article className={`${styles.messageBubble} ${styles.streamingMessage}`} data-role="manifold" aria-live="polite">
      <span className={styles.agentAvatar}><MessageSquareText /></span>
      <div>
        <small>Course Director</small>
        {stream.content ? (
          <div className={styles.directorMarkdown}><ReactMarkdown>{stream.content}</ReactMarkdown></div>
        ) : (
          <div className={styles.directorThinking}>
            <span>{stream.status}</span>
            <i /><i /><i />
          </div>
        )}
      </div>
    </article>
  );
}

function courseDirectorViewLabel(view: CanvasView) {
  if (view === "blueprint") return "Blueprint";
  if (view === "assessments") return "Assessments";
  if (view === "preview") return "Preview";
  if (view === "review") return "Review";
  return "Course Flow";
}

function MessageBubble({ message, proposalStates, onResolve }: {
  message: CourseMessage;
  proposalStates: Record<string, string>;
  onResolve: (
    id: string,
    decision: Decision,
    instructorRevision?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [proposalDraft, setProposalDraft] = useState("");
  return (
    <article className={styles.messageBubble} data-role={message.role}>
      {message.role === "manifold" ? <span className={styles.agentAvatar}><MessageSquareText /></span> : null}
      <div>
        <small>{message.role === "manifold" ? "Course Director" : "You"}</small>
        {message.role === "manifold"
          ? <div className={styles.directorMarkdown}><ReactMarkdown>{message.content}</ReactMarkdown></div>
          : <p>{message.content}</p>}
        {message.blocks.map((block, index) => {
          if (block.type === "evidence") {
            const evidence = Object.entries(block)
              .filter(([key, value]) => key !== "type" && typeof value === "number")
              .slice(0, 5);
            return (
              <dl className={styles.evidenceCard} key={`evidence-${index}`}>
                {evidence.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            );
          }
          if (block.type !== "proposal" || typeof block.proposal_id !== "string") return null;
          const proposalId = block.proposal_id;
          const state = proposalStates[proposalId] ?? (typeof block.status === "string" ? block.status : "proposed");
          const proposed = isRecord(block.proposed_state) ? block.proposed_state : {};
          const before = isRecord(block.before_state) ? block.before_state : null;
          const artifactType = typeof block.artifact_type === "string" ? block.artifact_type : "course";
          const proposalType = typeof block.proposal_type === "string" ? block.proposal_type : "change";
          const proposalSummary = typeof proposed.summary === "string"
            ? proposed.summary
            : typeof proposed.instruction === "string"
              ? proposed.instruction
              : `${proposalType.replaceAll("_", " ")} ${artifactType.replaceAll("_", " ")}`;
          if (state !== "proposed" && state !== "saving") {
            return (
              <div className={styles.proposalCard} data-resolved key={`${proposalId}-${index}`}>
                <strong><Check />Proposal {state}</strong>
              </div>
            );
          }
          return (
            <div className={styles.proposalCard} key={`${proposalId}-${index}`}>
              <span><FilePenLine />Private {proposalType.replaceAll("_", " ")} proposal</span>
              <p><strong>{proposalSummary}</strong></p>
              <dl className={styles.proposalChangeSummary}>
                <div><dt>Artifact</dt><dd>{artifactType.replaceAll("_", " ")}</dd></div>
                {before?.title ? <div><dt>Current</dt><dd>{String(before.title)}</dd></div> : null}
                {typeof block.rationale === "string" ? <div><dt>Why</dt><dd>{block.rationale}</dd></div> : null}
              </dl>
              {editingProposalId === proposalId ? (
                <div className={styles.proposalEdit}>
                  <label>
                    Revise the proposed directive
                    <textarea
                      aria-label="Revised course directive"
                      disabled={state === "saving"}
                      onChange={(event) => setProposalDraft(event.target.value)}
                      rows={6}
                      value={proposalDraft}
                    />
                  </label>
                  <div>
                    <button
                      disabled={state === "saving"}
                      onClick={() => setEditingProposalId(null)}
                      type="button"
                    >Cancel</button>
                    <button
                      disabled={state === "saving" || !safeJson(proposalDraft)}
                      onClick={() => {
                        const revision = safeJson(proposalDraft);
                        if (!revision) return;
                        void onResolve(proposalId, "edited", revision).then(() => {
                          setEditingProposalId(null);
                          setProposalDraft("");
                        });
                      }}
                      type="button"
                    ><Check />Save edit</button>
                  </div>
                </div>
              ) : state === "proposed" || state === "saving" ? (
                <div>
                  <button disabled={state === "saving"} onClick={() => onResolve(proposalId, "accepted")} type="button"><Check />Accept</button>
                  <button
                    disabled={state === "saving"}
                    onClick={() => {
                      setEditingProposalId(proposalId);
                      setProposalDraft(JSON.stringify(proposed, null, 2));
                    }}
                    type="button"
                  ><Pencil />Edit</button>
                  <button disabled={state === "saving"} onClick={() => onResolve(proposalId, "dismissed")} type="button"><X />Dismiss</button>
                </div>
              ) : <strong><Check />{state}</strong>}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function SourceRequest({ onChoose }: { onChoose: () => void }) {
  return (
    <button className={styles.sourceRequest} onClick={onChoose} type="button">
      <span><FileVideo /></span>
      <div><strong>Drop in one lecture</strong><small>Video or audio · up to your provider limit</small></div>
      <Paperclip />
    </button>
  );
}

function GenerationActivity({ run, sourceLabel, onRetry }: { run: GenerationRun; sourceLabel: string | null; onRetry: () => void }) {
  const failed = run.status === "failed";
  const cancelled = run.status === "cancelled";
  const ready = run.status === "waiting_review" || run.status === "complete";
  const active = run.status === "queued" || run.status === "running";
  return (
    <article className={styles.generationActivity} data-failed={failed || undefined}>
      <div>
        <span>{failed ? <CircleAlert /> : cancelled ? <X /> : ready ? <Check /> : <LoaderCircle className={styles.spin} />}</span>
        <div>
          <strong>{failed ? "I hit a problem" : cancelled ? "Generation stopped" : generationPhaseLabel(run.phase)}</strong>
          <small>{failed ? run.error_summary : cancelled ? "No agent work is running." : run.status === "complete" ? "This course has been published." : run.status === "waiting_review" ? "The complete private draft is waiting for your review." : sourceLabel ?? "Your work is safe. You can leave and return at any time."}</small>
        </div>
      </div>
      {active ? <div className={styles.runProgress}><i style={{ width: `${run.progress}%` }} /></div> : null}
      <ul>
        {orderedGenerationTasks(run.tasks).map((task) => <li data-status={task.status} key={task.id}><i />{generationPhaseLabel(task.task_type)}<span>{task.status}</span></li>)}
      </ul>
      {failed ? <button onClick={onRetry} type="button"><RotateCcw />Retry failed step</button> : null}
    </article>
  );
}

function GenerationActivityLabel({ label }: { label: string }) {
  return <article className={styles.generationActivity}><div><span><LoaderCircle className={styles.spin} /></span><div><strong>{label}</strong><small>This will continue if you leave.</small></div></div></article>;
}

function greetingTime() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function teacherFirstName(name: string | undefined) {
  return name?.trim().split(/\s+/)[0] || "Teacher";
}

function filterBlueprintForLecture(
  blueprint: CourseBlueprint | null,
  videoId: string | null,
): CourseBlueprint | null {
  if (!blueprint || !videoId) return blueprint;
  const lectureTopicIds = new Set(
    blueprint.nodes
      .filter((node) => node.kind === "topic" && node.metadata.video_id === videoId)
      .map((node) => node.id),
  );
  const visibleIds = new Set<string>();
  for (const node of blueprint.nodes) {
    if (node.kind === "source") visibleIds.add(node.id);
    else if (node.kind === "topic" && lectureTopicIds.has(node.id)) visibleIds.add(node.id);
    else if (
      node.kind === "concept"
      && (
        (node.parent_id != null && lectureTopicIds.has(node.parent_id))
        || (
          Array.isArray(node.metadata.topic_ids)
          && node.metadata.topic_ids.some((topicId) => lectureTopicIds.has(String(topicId)))
        )
      )
    ) visibleIds.add(node.id);
    else if (
      (node.kind === "clip" || node.kind === "question")
      && node.parent_id
      && lectureTopicIds.has(node.parent_id)
    ) visibleIds.add(node.id);
  }
  return {
    ...blueprint,
    nodes: blueprint.nodes.filter((node) => visibleIds.has(node.id)),
    edges: blueprint.edges.filter(
      (edge) => visibleIds.has(edge.source_id) && visibleIds.has(edge.target_id),
    ),
    uncovered_concept_ids: blueprint.uncovered_concept_ids.filter((id) => visibleIds.has(id)),
  };
}

function filterAssessmentWorkspaceForBlueprint(
  workspace: AssessmentWorkspace | null,
  blueprint: CourseBlueprint | null,
  videoId: string | null,
): AssessmentWorkspace | null {
  if (!workspace || !videoId || !blueprint) return workspace;
  const topicIds = new Set(
    blueprint.nodes.filter((node) => node.kind === "topic").map((node) => node.id),
  );
  const conceptIds = new Set(
    blueprint.nodes.filter((node) => node.kind === "concept").map((node) => node.id),
  );
  const questionIds = new Set(
    blueprint.nodes.filter((node) => node.kind === "question").map((node) => node.id),
  );
  const questionLogicalIds = new Set(
    blueprint.nodes
      .filter((node) => node.kind === "question")
      .map((node) => node.logical_id),
  );
  const clipIds = new Set(
    blueprint.nodes.filter((node) => node.kind === "clip").map((node) => node.id),
  );
  const topics = workspace.topics ?? [];
  const concepts = workspace.concepts ?? [];
  const questions = workspace.questions ?? [];
  const clips = workspace.clips ?? [];
  // The structured workspace can still describe the active revision while the
  // Blueprint is showing a private working revision. Video-linked clips give us
  // the stable lecture boundary without comparing revision-specific topic IDs.
  clips
    .filter((clip) => clip.video_id === videoId)
    .forEach((clip) => topicIds.add(clip.topic_id));
  return {
    ...workspace,
    topics: topics.filter((topic) => topicIds.has(topic.id)),
    concepts: concepts.filter(
      (concept) => conceptIds.has(concept.id) || (concept.topic_ids ?? []).some((topicId) => topicIds.has(topicId)),
    ),
    questions: questions.filter(
      (question) => questionIds.has(question.id)
        || questionLogicalIds.has(question.logical_id)
        || topicIds.has(question.topic_id),
    ),
    clips: clips.filter(
      (clip) => clip.video_id === videoId || clipIds.has(clip.id) || topicIds.has(clip.topic_id),
    ),
  };
}

function CanvasTab({ active, badge, icon, label, onClick }: { active: boolean; badge?: number; icon: ReactNode; label: string; onClick: () => void }) {
  return <button aria-label={label} aria-pressed={active} onClick={onClick} type="button">{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>;
}

const blueprintModes: Array<{ id: BlueprintMode; label: string }> = [
  { id: "live", label: "Live" },
  { id: "design", label: "Design" },
];

type BlueprintGraphNodeData = {
  artifact: BlueprintNode;
  conceptCount: number | null;
  evidence: BlueprintConceptEvidence | null;
  designMode?: boolean;
  muted: boolean;
  onStartRelationship?: (node: BlueprintNode, side: BlueprintPortSide) => void;
  relationshipTargetState?: "valid" | "invalid" | null;
  risk: number | null;
  selected: boolean;
};
type BlueprintGraphNode = Node<BlueprintGraphNodeData, "blueprintArtifact">;
type BlueprintGraphEdgeData = {
  emphasized: boolean;
  kind: BlueprintEdgeKind;
  points: Array<{ x: number; y: number }> | null;
  visible: boolean;
};
type BlueprintGraphEdge = Edge<BlueprintGraphEdgeData, "blueprintRelation">;

const blueprintRelationshipLabels: Record<BlueprintEdgeKind, string> = {
  contains: "Structure",
  next: "Sequence",
  requires: "Prerequisite",
  teaches: "Teaching",
  assesses: "Assessment",
  remediates_to: "Remediation",
  cites: "Citation",
};

const blueprintRelationshipDescriptions: Record<EditableBlueprintRelationship, string> = {
  contains: "Place a concept inside this topic.",
  requires: "Make another concept a prerequisite.",
  teaches: "Use a clip to teach this concept.",
  assesses: "Use a question to check this concept.",
  remediates_to: "Route an incorrect answer to a concept or clip.",
  cites: "Ground this artifact in a course source.",
};

function relationshipSpec(
  blueprint: CourseBlueprint,
  edge: BlueprintEdge,
): BlueprintRelationshipSpec | null {
  if (edge.kind === "next") return null;
  const source = blueprint.nodes.find((node) => node.id === edge.source_id);
  const target = blueprint.nodes.find((node) => node.id === edge.target_id);
  if (!source || !target) return null;
  return {
    relationship: edge.kind,
    source_logical_id: source.logical_id,
    target_logical_id: target.logical_id,
  };
}

function blueprintNodeDimensions(node: BlueprintNode) {
  if (node.kind === "topic") return { width: 260, height: 108 };
  if (node.kind === "concept") return { width: 232, height: 118 };
  if (node.kind === "source") return { width: 210, height: 88 };
  return { width: 210, height: 98 };
}

function BlueprintArtifactNode({ data }: NodeProps<BlueprintGraphNode>) {
  const {
    artifact,
    conceptCount,
    designMode,
    evidence,
    muted,
    onStartRelationship,
    relationshipTargetState,
    risk,
    selected,
  } = data;
  const metadata = artifact.kind === "concept"
    ? evidence?.attempts
      ? `${Math.round(evidence.correct_percent ?? 0)}% correct · ${evidence.confident_incorrect} misconceptions`
      : "Awaiting learner evidence"
    : coverageLabel(artifact);
  const count = artifact.kind === "topic" && conceptCount != null
    ? `${conceptCount} ${conceptCount === 1 ? "concept" : "concepts"}`
    : null;
  return (
    <article
      className={styles.blueprintTypedNode}
      data-kind={artifact.kind}
      data-muted={muted}
      data-relationship-target={relationshipTargetState ?? undefined}
      data-risk={risk != null && risk >= 40}
      data-selected={selected}
    >
      <Handle className={styles.blueprintFlowHandle} id="flow-in" position={Position.Top} type="target" />
      <Handle className={styles.blueprintFlowHandle} id="flow-out" position={Position.Bottom} type="source" />
      <Handle className={styles.blueprintSideHandle} id="relation-in" position={Position.Left} type="target" />
      <Handle className={styles.blueprintSideHandle} id="relation-out" position={Position.Right} type="source" />
      <header>
        <span>{blueprintKindIcon(artifact.kind)}</span>
        <small>{artifact.kind}</small>
        <em data-status={artifact.status}>{artifact.status}</em>
      </header>
      <strong title={artifact.title}>{artifact.title}</strong>
      <footer>
        <span>{count ?? metadata}</span>
        {artifact.kind === "concept" && evidence?.attempts ? <b>{evidence.attempts} attempts</b> : null}
      </footer>
      {designMode && availableBlueprintRelationshipKinds(artifact).length ? (
        <div
          aria-label={`Create a relationship from ${artifact.title}`}
          className={styles.blueprintConnectionPorts}
          role="group"
        >
          {(["top", "right", "bottom", "left"] as BlueprintPortSide[]).map((side) => (
            <button
              aria-label={`Create relationship from the ${side} of ${artifact.title}`}
              data-side={side}
              key={side}
              onClick={(event) => {
                event.stopPropagation();
                onStartRelationship?.(artifact, side);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              <Plus />
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function BlueprintRelationEdge({
  data,
  id,
  markerEnd,
  sourceX,
  sourceY,
  style,
  targetX,
  targetY,
}: EdgeProps<BlueprintGraphEdge>) {
  const points = data?.points?.length
    ? data.points
    : [
      { x: sourceX, y: sourceY },
      { x: sourceX, y: sourceY + (targetY - sourceY) / 2 },
      { x: targetX, y: sourceY + (targetY - sourceY) / 2 },
      { x: targetX, y: targetY },
    ];
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const labelPoint = points[Math.floor(points.length / 2)] ?? { x: sourceX, y: sourceY };
  const kind = data?.kind ?? "contains";
  return (
    <>
      <BaseEdge id={id} interactionWidth={18} markerEnd={markerEnd} path={path} style={style} />
      {data?.visible ? (
        <text
          className={styles.blueprintEdgeLabel}
          data-emphasized={data.emphasized}
          textAnchor="middle"
          x={labelPoint.x}
          y={labelPoint.y - 7}
        >
          {blueprintRelationshipLabels[kind]}
        </text>
      ) : null}
    </>
  );
}

const blueprintNodeTypes = { blueprintArtifact: BlueprintArtifactNode };
const blueprintEdgeTypes = { blueprintRelation: BlueprintRelationEdge };

type StructuredBlueprintLens = "course" | "focus" | "dependencies";
type PendingConceptPlacement = {
  concept: BlueprintNode;
  originTopic: BlueprintNode;
  destinationTopic: BlueprintNode;
  targetLogicalId: string | null;
};

export function DeprecatedStructuredBlueprintWorkspace({
  activeBlueprint,
  agentTasks,
  blueprintEvidence,
  course,
  dashboard,
  disabled,
  onAddPrerequisite,
  onAskDirector,
  onLoadPack,
  onPrepare,
  onResolvePrerequisite,
  onResolveProposal,
  onSequence,
  onUpdateConcept,
  onUpdateConceptTopics,
  revisionDiff,
  workingBlueprint,
}: {
  activeBlueprint: CourseBlueprint | null;
  agentTasks: CourseAgentTask[];
  blueprintEvidence: BlueprintConceptEvidence[];
  course: CourseSummary | null;
  dashboard: DashboardSummary | null;
  disabled: boolean;
  onAddPrerequisite: (fromConceptId: string, toConceptId: string) => Promise<void>;
  onAskDirector: (node: BlueprintNode) => void;
  onLoadPack: (taskId: string) => Promise<AgentTaskPack>;
  onPrepare: (node: BlueprintNode, neighbors: BlueprintNode[]) => Promise<void>;
  onResolvePrerequisite: (edge: BlueprintEdge, decision: "accepted" | "dismissed") => Promise<void>;
  onResolveProposal: (proposal: AgentTaskProposal, decision: Decision, revision?: Record<string, unknown>) => Promise<void>;
  onSequence: (conceptIds: string[]) => Promise<void>;
  onUpdateConcept: (node: BlueprintNode, name: string, description: string) => Promise<void>;
  onUpdateConceptTopics: (node: BlueprintNode, topicLogicalIds: string[]) => Promise<void>;
  revisionDiff: RevisionDiff | null;
  workingBlueprint: CourseBlueprint | null;
}) {
  const [editing, setEditing] = useState(course?.status !== "published");
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [lens, setLens] = useState<StructuredBlueprintLens>("course");
  const [selectedLogicalId, setSelectedLogicalId] = useState<string | null>(null);
  const [focusTopicLogicalId, setFocusTopicLogicalId] = useState<string | null>(null);
  const [draggedOccurrenceId, setDraggedOccurrenceId] = useState<string | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingConceptPlacement | null>(null);
  const designMode = editing;
  const mode: BlueprintMode = editing ? "design" : "live";
  const blueprint = editing
    ? (workingBlueprint ?? activeBlueprint)
    : (activeBlueprint ?? workingBlueprint);
  const topics = useMemo(
    () => blueprint?.nodes.filter((node) => node.kind === "topic").sort(compareBlueprintSequence) ?? [],
    [blueprint],
  );
  const concepts = useMemo(
    () => blueprint?.nodes.filter((node) => node.kind === "concept").sort(compareBlueprintSequence) ?? [],
    [blueprint],
  );
  const lanes = useMemo(
    () => blueprint ? buildBlueprintTopicLanes(blueprint, blueprintEvidence) : [],
    [blueprint, blueprintEvidence],
  );
  const occurrences = useMemo(
    () => lanes.flatMap((lane) => lane.concepts),
    [lanes],
  );
  const selected = blueprint?.nodes.find((node) => node.logical_id === selectedLogicalId) ?? null;
  const selectedEvidence = selected?.kind === "concept"
    ? blueprintEvidence.find((item) => item.concept_id === selected.id) ?? null
    : null;
  const neighbors = selected && blueprint
    ? blueprint.edges
      .filter((edge) => edge.source_id === selected.id || edge.target_id === selected.id)
      .map((edge) => blueprint.nodes.find((node) => node.id === (edge.source_id === selected.id ? edge.target_id : edge.source_id)))
      .filter((node): node is BlueprintNode => Boolean(node))
    : [];
  const pendingEdges = blueprint?.edges.filter((edge) => edge.kind === "requires" && edge.status === "proposed") ?? [];
  const coverageGaps = blueprint?.uncovered_concept_ids.length ?? 0;
  const privateChangeCount = revisionDiff?.changes.length ?? 0;
  const selectedTask = selected
    ? agentTasks.find((task) => task.target_logical_artifact_id === selected.logical_id && task.task_type === "prepare_improvement")
    : null;
  const draggedOccurrence = occurrences.find((occurrence) => occurrence.id === draggedOccurrenceId) ?? null;

  useEffect(() => {
    if (selectedLogicalId && !blueprint?.nodes.some((node) => node.logical_id === selectedLogicalId)) {
      setSelectedLogicalId(null);
    }
  }, [blueprint, selectedLogicalId]);

  useEffect(() => {
    if (!journeyOpen && !revisionOpen) return;
    function closeDialog(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setJourneyOpen(false);
      setRevisionOpen(false);
    }
    document.addEventListener("keydown", closeDialog);
    return () => document.removeEventListener("keydown", closeDialog);
  }, [journeyOpen, revisionOpen]);

  useEffect(() => {
    if (!privateChangeCount) setRevisionOpen(false);
  }, [privateChangeCount]);

  if (!blueprint) {
    return <div className={styles.canvasEmpty}><LoaderCircle className={styles.spin} /><h2>Loading the course Blueprint</h2><p>The structure, learning evidence, and adaptive routes are being assembled.</p></div>;
  }

  const focusNodeIds = lens === "focus"
    ? selected?.kind === "concept"
      ? blueprintConceptNeighborhoodIds(blueprint, selected.id)
      : visibleBlueprintNodeIds(blueprint, focusTopicLogicalId)
    : null;
  const dependencyBlueprint = lens === "dependencies"
    ? {
      ...blueprint,
      nodes: blueprint.nodes.filter((node) => node.kind === "concept"),
      edges: blueprint.edges.filter((edge) => edge.kind === "requires"),
    }
    : blueprint;
  const dependencyNodeIds = lens === "dependencies"
    ? new Set(dependencyBlueprint.nodes.map((node) => node.id))
    : focusNodeIds;

  async function dropConcept(
    destinationTopic: BlueprintNode,
    targetLogicalId: string | null,
  ) {
    if (!designMode || disabled || !draggedOccurrence) return;
    setDraggedOccurrenceId(null);
    if (draggedOccurrence.topic.logical_id === destinationTopic.logical_id) {
      if (targetLogicalId !== draggedOccurrence.concept.logical_id) {
        await onSequence(
          reorderBlueprintConcepts(
            concepts,
            draggedOccurrence.concept.logical_id,
            targetLogicalId,
          ),
        );
      }
      return;
    }
    setPendingPlacement({
      concept: draggedOccurrence.concept,
      originTopic: draggedOccurrence.topic,
      destinationTopic,
      targetLogicalId,
    });
  }

  async function confirmPlacement(action: "link" | "move") {
    if (!pendingPlacement || !blueprint) return;
    const existing = topicLogicalIdsForConcept(blueprint, pendingPlacement.concept.id);
    const nextTopics = action === "link"
      ? Array.from(new Set([...existing, pendingPlacement.destinationTopic.logical_id]))
      : Array.from(new Set([
        ...existing.filter((topicId) => topicId !== pendingPlacement.originTopic.logical_id),
        pendingPlacement.destinationTopic.logical_id,
      ]));
    const placement = pendingPlacement;
    setPendingPlacement(null);
    await onUpdateConceptTopics(placement.concept, nextTopics);
    if (placement.targetLogicalId !== placement.concept.logical_id) {
      await onSequence(
        reorderBlueprintConcepts(
          concepts,
          placement.concept.logical_id,
          placement.targetLogicalId,
        ),
      );
    }
  }

  return (
    <div className={styles.structuredBlueprint} data-design={designMode} data-mode={mode}>
      <header className={styles.structuredBlueprintHeader}>
        <div>
          <h2>Course Blueprint</h2>
          <p>See how every concept is taught, checked, and adapted—then reshape the private revision directly.</p>
        </div>
        <div className={styles.blueprintHealthSummary}>
          <span data-tone={coverageGaps ? "warning" : "healthy"}><strong>{coverageGaps || "Complete"}</strong> {coverageGaps ? "coverage gaps" : "coverage"}</span>
          <span><strong>{dashboard?.attempt_count ?? 0}</strong> learner attempts</span>
          <span><strong>{revisionDiff?.changes.length ?? 0}</strong> private changes</span>
        </div>
      </header>

      {coverageGaps || pendingEdges.length ? (
        <div className={styles.blueprintNotice}>
          <CircleAlert />
          <p><strong>{coverageGaps ? `${coverageGaps} concepts need a teaching artifact or assessment.` : `${pendingEdges.length} prerequisite relationships need review.`}</strong> Everything remains private until you confirm it.</p>
        </div>
      ) : null}

      <section className={styles.structuredBlueprintToolbar}>
        <div>
          <small>{editing ? "Private workspace" : "Current course"}</small>
          <strong>{editing ? "Editing a private revision" : "Published structure and learner evidence"}</strong>
        </div>
        <nav aria-label="Blueprint lens">
          <button aria-pressed={lens === "course"} onClick={() => { setLens("course"); setFocusTopicLogicalId(null); }} type="button"><BookOpenCheck />Course</button>
          <button aria-pressed={lens === "dependencies"} onClick={() => setLens("dependencies")} type="button"><GitFork />Dependencies</button>
          {lens === "focus" ? <button aria-pressed="true" type="button"><Search />Focused</button> : null}
        </nav>
        <nav aria-label="Blueprint actions" className={styles.blueprintActionNav}>
          <button onClick={() => setJourneyOpen(true)} type="button"><Eye />Preview learner journey</button>
          {privateChangeCount ? <button className={styles.reviewChangesAction} onClick={() => setRevisionOpen(true)} type="button"><FilePenLine />Review changes <span>{privateChangeCount}</span></button> : null}
          <button
            aria-pressed={editing}
            className={styles.blueprintDesignToggle}
            onClick={() => {
              setEditing((current) => !current);
              if (!editing) {
                setLens("course");
                setFocusTopicLogicalId(null);
              }
            }}
            type="button"
          >
            {editing ? <Check /> : <Pencil />}
            {editing ? "Done editing" : "Edit Blueprint"}
          </button>
        </nav>
      </section>

      <div className={styles.structuredBlueprintBody}>
        <nav className={styles.structuredBlueprintOutline} aria-label="Blueprint topics">
          <button aria-current={lens === "course" ? "page" : undefined} onClick={() => { setLens("course"); setFocusTopicLogicalId(null); setSelectedLogicalId(null); }} type="button"><BookOpenCheck /><span><strong>Whole course</strong><small>{topics.length} topics · {concepts.length} concepts</small></span></button>
          {lanes.map((lane, index) => (
            <button aria-current={focusTopicLogicalId === lane.topic.logical_id ? "page" : undefined} key={lane.topic.id} onClick={() => { setFocusTopicLogicalId(lane.topic.logical_id); setSelectedLogicalId(lane.topic.logical_id); setLens("focus"); }} type="button"><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{lane.topic.title}</strong><small>{lane.concepts.length} concepts</small></span></button>
          ))}
        </nav>

        <section className={styles.structuredBlueprintCanvas} onClick={() => setSelectedLogicalId(null)}>
          {lens === "course" ? (
            <div className={styles.topicLaneBoard}>
              <div className={styles.blueprintLegend} aria-label="Blueprint status legend">
                <span><i data-tone="healthy" />Healthy</span><span><i data-tone="attention" />Needs attention</span><span><i data-tone="waiting" />Awaiting evidence</span><span><i data-tone="private" />Private change</span>
                {designMode ? <em>Drag cards to reorder. Drop into another topic to move or link.</em> : null}
              </div>
              {lanes.map((lane, laneIndex) => (
                <article
                  className={styles.topicLane}
                  data-drop-target={draggedOccurrence ? "true" : undefined}
                  data-testid={`topic-lane-${lane.topic.logical_id}`}
                  key={lane.topic.id}
                  onDragOver={(event) => { if (designMode) event.preventDefault(); }}
                  onDrop={(event) => { event.preventDefault(); void dropConcept(lane.topic, null); }}
                >
                  <header onClick={(event) => { event.stopPropagation(); setFocusTopicLogicalId(lane.topic.logical_id); setSelectedLogicalId(lane.topic.logical_id); }}>
                    <span>{String(laneIndex + 1).padStart(2, "0")}</span>
                    <div><h3>{lane.topic.title}</h3><p>{lane.concepts.length} concepts · {lane.concepts.reduce((total, item) => total + item.clipCount, 0)} clips · {lane.concepts.reduce((total, item) => total + item.questionCount, 0)} checks</p></div>
                    <button aria-label={`Focus ${lane.topic.title}`} onClick={(event) => { event.stopPropagation(); setFocusTopicLogicalId(lane.topic.logical_id); setSelectedLogicalId(lane.topic.logical_id); setLens("focus"); }} type="button"><Search /></button>
                  </header>
                  <div className={styles.topicLaneConcepts}>
                    {lane.concepts.map((occurrence, conceptIndex) => {
                      const evidence = occurrence.evidence;
                      const tone = blueprintConceptTone(occurrence.concept, evidence, blueprint.uncovered_concept_ids);
                      return (
                        <button
                          className={styles.conceptBundleCard}
                          data-selected={selectedLogicalId === occurrence.concept.logical_id}
                          data-tone={tone}
                          data-testid={`concept-occurrence-${lane.topic.logical_id}-${occurrence.concept.logical_id}`}
                          draggable={designMode && !disabled}
                          key={occurrence.id}
                          onClick={(event) => { event.stopPropagation(); setSelectedLogicalId(occurrence.concept.logical_id); }}
                          onDoubleClick={(event) => { event.stopPropagation(); setSelectedLogicalId(occurrence.concept.logical_id); setLens("focus"); }}
                          onDragStart={(event) => { setDraggedOccurrenceId(occurrence.id); event.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => setDraggedOccurrenceId(null)}
                          onDragOver={(event) => { if (designMode) event.preventDefault(); }}
                          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void dropConcept(lane.topic, occurrence.concept.logical_id); }}
                          type="button"
                        >
                          <i>{conceptIndex + 1}</i>
                          <span className={styles.conceptBundleContent}>
                            <strong>{occurrence.concept.title}</strong>
                            <small>{evidence?.attempts ? `${Math.round(evidence.correct_percent ?? 0)}% correct · ${evidence.touched_learners} learners` : "Awaiting learner evidence"}</small>
                          </span>
                          <span className={styles.conceptBundleArtifacts}>
                            <em><Play />{occurrence.clipCount}</em><em><ClipboardCheck />{occurrence.questionCount}</em>
                            {occurrence.sharedTopicCount > 1 ? <em title="Shared across topics"><GitFork />{occurrence.sharedTopicCount}</em> : null}
                          </span>
                        </button>
                      );
                    })}
                    {!lane.concepts.length ? <p className={styles.emptyTopicLane}>No concepts are assigned to this topic.</p> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StructuredBlueprintFlow
              blueprint={dependencyBlueprint}
              connectable={designMode && lens === "dependencies"}
              evidence={blueprintEvidence}
              onConnect={onAddPrerequisite}
              onSelect={(node) => setSelectedLogicalId(node?.logical_id ?? null)}
              selectedId={selected?.id ?? null}
              visibleNodeIds={dependencyNodeIds}
            />
          )}

          {selected ? (
            <aside aria-label={`${selected.title} artifact inspector`} className={`${styles.blueprintInspector} ${styles.structuredBlueprintInspector}`} onClick={(event) => event.stopPropagation()} role="dialog">
              <header><span data-kind={selected.kind}>{blueprintKindIcon(selected.kind)}</span><div><small>{selected.kind}</small><h3>{selected.title}</h3><em data-status={selected.status}>{selected.status}</em></div><button aria-label="Close artifact inspector" className={styles.inspectorClose} onClick={() => setSelectedLogicalId(null)} type="button"><X /></button></header>
              {selected.kind === "concept" ? <ConceptEvidencePanel evidence={selectedEvidence} /> : <ArtifactCoveragePanel clip={null} node={selected} neighbors={neighbors} />}
              {designMode && selected.kind === "concept" ? <><ConceptInspectorEditor disabled={disabled} node={selected} onSave={onUpdateConcept} /><SequenceControls concepts={concepts} disabled={disabled} onChange={onSequence} selected={selected} /></> : null}
              {selected.kind === "concept" ? <button className={styles.inspectorFocusButton} onClick={() => setLens("focus")} type="button"><Search />Focus this concept and its connections</button> : null}
              {pendingEdges.filter((edge) => edge.source_id === selected.id || edge.target_id === selected.id).map((edge) => {
                const other = blueprint.nodes.find((node) => node.id === (edge.source_id === selected.id ? edge.target_id : edge.source_id));
                return <article className={styles.relationshipReview} key={edge.id}><small>Proposed prerequisite</small><strong>{edge.source_id === selected.id ? `${selected.title} → ${other?.title}` : `${other?.title} → ${selected.title}`}</strong><div><button disabled={disabled} onClick={() => void onResolvePrerequisite(edge, "dismissed")} type="button"><X />Dismiss</button><button disabled={disabled} onClick={() => void onResolvePrerequisite(edge, "accepted")} type="button"><Check />Accept</button></div></article>;
              })}
              <div className={styles.blueprintActions}>
                <button onClick={() => onAskDirector(selected)} type="button"><MessageCircleMore />Ask Director</button>
                <button disabled={disabled || Boolean(selectedTask && ["queued", "running"].includes(selectedTask.status))} onClick={() => void onPrepare(selected, neighbors)} type="button"><Wand2 />{selectedTask?.status === "waiting_review" ? "Review improvement" : "Prepare improvement"}</button>
              </div>
              {selectedTask ? <ProposalPack task={selectedTask} load={onLoadPack} onResolve={onResolveProposal} /> : null}
            </aside>
          ) : null}
        </section>
      </div>

      {pendingPlacement ? (
        <div className={styles.blueprintPlacementOverlay} onClick={() => setPendingPlacement(null)} role="presentation">
          <section aria-labelledby="concept-placement-title" aria-modal="true" className={styles.blueprintPlacementDialog} onClick={(event) => event.stopPropagation()} role="dialog">
            <span><GitFork /></span>
            <h3 id="concept-placement-title">Place “{pendingPlacement.concept.title}” in {pendingPlacement.destinationTopic.title}?</h3>
            <p>This is a structural change to the private revision. Choose whether the concept should remain in its current topic too.</p>
            <div><button onClick={() => setPendingPlacement(null)} type="button">Cancel</button><button disabled={disabled} onClick={() => void confirmPlacement("link")} type="button">Also link here</button><button disabled={disabled} onClick={() => void confirmPlacement("move")} type="button">Move here</button></div>
          </section>
        </div>
      ) : null}
      {journeyOpen ? (
        <LearnerJourneyPreview
          blueprint={activeBlueprint ?? blueprint}
          evidence={blueprintEvidence}
          onClose={() => setJourneyOpen(false)}
          onInspect={(logicalId) => {
            setSelectedLogicalId(logicalId);
            setLens("focus");
            setJourneyOpen(false);
          }}
        />
      ) : null}
      {revisionOpen && revisionDiff?.changes.length ? (
        <RevisionReviewDialog
          active={activeBlueprint}
          diff={revisionDiff}
          onClose={() => setRevisionOpen(false)}
          working={workingBlueprint}
        />
      ) : null}
    </div>
  );
}

function blueprintConceptTone(
  concept: BlueprintNode,
  evidence: BlueprintConceptEvidence | null,
  uncoveredConceptIds: string[],
) {
  if (concept.status === "edited" || concept.status === "proposed") return "private";
  if (uncoveredConceptIds.includes(concept.id) || evidence?.confident_incorrect) return "attention";
  if (!evidence?.attempts) return "waiting";
  if ((evidence.correct_percent ?? 0) >= 70) return "healthy";
  return "attention";
}

function StructuredBlueprintFlow({
  blueprint,
  connectable,
  evidence,
  onConnect,
  onSelect,
  selectedId,
  visibleNodeIds,
}: {
  blueprint: CourseBlueprint;
  connectable: boolean;
  evidence: BlueprintConceptEvidence[];
  onConnect: (fromConceptId: string, toConceptId: string) => Promise<void>;
  onSelect: (node: BlueprintNode | null) => void;
  selectedId: string | null;
  visibleNodeIds: Set<string> | null;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const flow = useBlueprintFlow(
    blueprint,
    evidence,
    "live",
    visibleNodeIds,
    selectedId,
    coreBlueprintEdgeKinds,
    false,
  );
  const fitKey = `${blueprint.revision_id}:${Array.from(visibleNodeIds ?? []).sort().join(":")}`;
  useEffect(() => {
    if (!instance || !flow.layoutReady || !flow.nodes.length) return;
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({ duration: 360, maxZoom: 1.05, padding: 0.18 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitKey, flow.layoutReady, flow.nodes.length, instance]);
  return (
    <div className={styles.structuredFlowCanvas}>
      {!flow.layoutReady ? <div className={styles.blueprintLayoutLoading}><LoaderCircle className={styles.spin} />Arranging the learning system…</div> : null}
      <ReactFlow
        edgeTypes={blueprintEdgeTypes}
        edges={flow.edges}
        fitView
        nodeTypes={blueprintNodeTypes}
        nodes={flow.nodes}
        nodesConnectable={connectable}
        nodesDraggable={false}
        onConnect={(connection) => {
          if (!connection.source || !connection.target || connection.source === connection.target) return;
          const source = blueprint.nodes.find((node) => node.id === connection.source);
          const target = blueprint.nodes.find((node) => node.id === connection.target);
          if (source?.kind === "concept" && target?.kind === "concept") {
            void onConnect(source.logical_id, target.logical_id);
          }
        }}
        onInit={setInstance}
        onNodeClick={(_, node) => onSelect(blueprint.nodes.find((item) => item.id === node.id) ?? null)}
        onPaneClick={() => onSelect(null)}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2ded6" gap={22} size={1} />
        <Controls orientation="horizontal" position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function CourseFlowWorkspace({
  activeFlow,
  concepts,
  disabled,
  mode,
  onAddLecture,
  onAddModule,
  onModeChange,
  onOpenLecture,
  onOpenWholeCourse,
  onLayout,
  onRelationship,
  onRemove,
  onReview,
  onSave,
  onUndo,
  undoLabel,
  undoing,
  workingFlow,
}: {
  activeFlow: CourseFlow | null;
  concepts: BlueprintNode[];
  disabled: boolean;
  mode: BlueprintMode;
  onAddLecture: () => void;
  onAddModule: (title: string, summary: string) => void;
  onModeChange: (mode: BlueprintMode) => void;
  onOpenLecture: (unit: CourseFlowUnit) => void;
  onOpenWholeCourse: () => void;
  onLayout: (
    logicalArtifactId: string,
    x: number,
    y: number,
    previous?: { x: number; y: number },
  ) => Promise<void>;
  onRelationship: (draft: CourseFlowEdgeDraft, action: "create" | "delete") => Promise<void>;
  onRemove: (unit: CourseFlowUnit) => void;
  onReview: (
    artifactKind: "unit" | "relationship",
    logicalId: string,
    decision: "accepted" | "edited" | "dismissed",
  ) => Promise<void>;
  onSave: (draft: CourseFlowDraftPayload, unit?: CourseFlowUnit) => void;
  onUndo: () => Promise<void>;
  undoLabel: string | null;
  undoing: boolean;
  workingFlow: CourseFlow | null;
}) {
  const reducedMotion = useReducedMotion();
  const [editor, setEditor] = useState<{
    kind: CourseFlowUnitKind;
    unit?: CourseFlowUnit;
  } | null>(null);
  const [relationshipEditorOpen, setRelationshipEditorOpen] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<CourseFlowEdge | null>(null);
  const [relationshipDraft, setRelationshipDraft] = useState<CourseFlowRelationshipDraft | null>(null);
  const [moduleEditorOpen, setModuleEditorOpen] = useState(false);
  const [graphPositions, setGraphPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [graphBusy, setGraphBusy] = useState(false);
  const graphInstance = useRef<ReactFlowInstance | null>(null);
  const flow = mode === "design" ? (workingFlow ?? activeFlow) : activeFlow;
  const units = useMemo(() => [...(flow?.units ?? [])].sort(
    (left, right) => left.sequence_rank - right.sequence_rank,
  ), [flow]);
  const modules = useMemo(() => [...(flow?.modules ?? [])].sort(
    (left, right) => left.sequence_rank - right.sequence_rank,
  ), [flow]);
  const lectureCount = units.filter((unit) => unit.kind === "lecture").length;
  const compactSequence = modules.length === 0 && units.length <= 2;
  const viewportPolicy = useMemo(() => courseFlowViewportPolicy(units.length), [units.length]);
  const groups = useMemo(() => [
    ...modules.map((module) => ({
      id: module.logical_id,
      title: module.title,
      summary: module.summary,
      units: units.filter((unit) => unit.module_logical_id === module.logical_id),
    })),
    {
      id: "unassigned",
      title: modules.length ? "Independent course units" : "Course sequence",
      summary: modules.length ? "Units outside a module" : "The learner-facing course order",
      units: units.filter((unit) => !unit.module_logical_id),
    },
  ].filter((group) => group.units.length || group.id === "unassigned"), [modules, units]);

  const arrangedPositions = useMemo(() => {
    const next: Record<string, { x: number; y: number }> = {};
    if (compactSequence) {
      units.forEach((unit, unitIndex) => {
        next[unit.logical_id] = { x: 70 + unitIndex * 330, y: 72 };
      });
      return next;
    }
    groups.forEach((group, groupIndex) => {
      const laneX = 58 + groupIndex * 360;
      group.units.forEach((unit, unitIndex) => {
        next[unit.logical_id] = {
          x: laneX + 28,
          y: 116 + unitIndex * 154,
        };
      });
    });
    return next;
  }, [compactSequence, groups, units]);

  useEffect(() => {
    if (!flow) return;
    setGraphPositions((current) => {
      const next = { ...current };
      for (const unit of flow.units) {
        if (unit.x !== null && unit.y !== null) {
          next[unit.logical_id] = { x: unit.x, y: unit.y };
        } else if (!next[unit.logical_id] && arrangedPositions[unit.logical_id]) {
          next[unit.logical_id] = arrangedPositions[unit.logical_id];
        }
      }
      return next;
    });
  }, [arrangedPositions, flow]);

  useEffect(() => {
    if (!relationshipDraft) return;
    function cancelRelationship(event: KeyboardEvent) {
      if (event.key === "Escape") setRelationshipDraft(null);
    }
    window.addEventListener("keydown", cancelRelationship);
    return () => window.removeEventListener("keydown", cancelRelationship);
  }, [relationshipDraft]);

  const graphNodes = useMemo<Node[]>(() => {
    const laneNodes: Node[] = compactSequence ? [] : groups.map((group, groupIndex) => {
      const laneX = 58 + groupIndex * 360;
      const laneHeight = Math.max(270, 136 + group.units.length * 154);
      return {
        id: `module:${group.id}`,
        position: { x: laneX, y: 34 },
        data: {
          label: (
            <div className={styles.courseFlowGraphLaneLabel}>
              <small>{group.id === "unassigned" ? "Course lane" : "Module"}</small>
              <strong>{group.title}</strong>
              <span>{group.summary}</span>
              <em>{group.units.length} {group.units.length === 1 ? "unit" : "units"}</em>
            </div>
          ),
        },
        draggable: false,
        selectable: false,
        connectable: false,
        className: styles.courseFlowGraphLane,
        style: { height: laneHeight, width: 320 },
        zIndex: 0,
      };
    });
    const unitNodes: Node[] = units.map((unit) => {
      const isRelationshipSource = relationshipDraft?.source.logical_id === unit.logical_id;
      const isRelationshipTarget = Boolean(
        relationshipDraft?.relationship
        && relationshipDraft.source.logical_id !== unit.logical_id
        && isValidCourseFlowRelationshipTarget(
          relationshipDraft.source,
          unit,
          relationshipDraft.relationship,
        )
      );
      const isInvalidRelationshipTarget = Boolean(
        relationshipDraft?.relationship
        && relationshipDraft.source.logical_id !== unit.logical_id
        && !isRelationshipTarget
      );
      return {
      id: unit.logical_id,
      position: graphPositions[unit.logical_id]
        ?? arrangedPositions[unit.logical_id]
        ?? { x: 86, y: 116 + unit.sequence_rank * 154 },
      data: {
        label: (
          <div
            className={styles.courseFlowGraphUnit}
            data-kind={unit.kind}
            data-relationship-source={isRelationshipSource || undefined}
            data-relationship-target={isRelationshipTarget || undefined}
            data-relationship-invalid={isInvalidRelationshipTarget || undefined}
            data-status={unit.status}
          >
            <span className={styles.courseFlowGraphUnitIcon}>
              {unit.kind === "lecture" ? <FileVideo /> : unit.kind === "quiz" ? <ClipboardCheck /> : <FilePenLine />}
            </span>
            <div>
              <small>{unit.kind}{unit.status === "proposed" ? " · review" : ""}</small>
              <strong>{unit.title}</strong>
              <em>
                {unit.kind === "lecture"
                  ? `${unit.topic_count} topics · ${unit.concept_count} concepts`
                  : unit.kind === "quiz"
                    ? `${unit.question_count} questions · ${unit.concept_count} concepts`
                    : `${unit.concept_count} concepts · ${unit.source_count} resources`}
              </em>
            </div>
            {mode === "design" ? (
              <>
                <div className={styles.courseFlowGraphUnitActions}>
                  {unit.kind === "lecture" ? (
                    <button
                      aria-label={`Open Blueprint for ${unit.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenLecture(unit);
                      }}
                      type="button"
                    >
                      <ArrowRight />Open
                    </button>
                  ) : null}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditor({ kind: unit.kind, unit });
                    }}
                    type="button"
                  >
                    <Pencil />Edit
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(unit);
                    }}
                    type="button"
                  >
                    <Trash2 />Remove
                  </button>
                </div>
                {(["top", "right", "bottom", "left"] as CourseFlowPortSide[]).map((side) => (
                  <button
                    aria-label={`Connect from ${side} of ${unit.title}`}
                    className={styles.courseFlowPortAction}
                    data-side={side}
                    disabled={disabled}
                    key={side}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRelationshipDraft({ source: unit, side, relationship: null });
                    }}
                    title="Add relationship"
                    type="button"
                  >
                    <Plus />
                  </button>
                ))}
              </>
            ) : unit.kind === "lecture" ? (
              <button
                aria-label={`Open Blueprint for ${unit.title}`}
                className={styles.courseFlowGraphOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenLecture(unit);
                }}
                type="button"
              >
                Open Blueprint <ArrowRight />
              </button>
            ) : null}
          </div>
        ),
      },
      draggable: mode === "design" && !disabled && !relationshipDraft,
      connectable: false,
      className: styles.courseFlowGraphNode,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      zIndex: 3,
    };
    });
    return [...laneNodes, ...unitNodes];
  }, [arrangedPositions, compactSequence, disabled, graphPositions, groups, mode, onOpenLecture, onRemove, relationshipDraft, units]);

  const graphEdges = useMemo<Edge[]>(() => (flow?.edges ?? []).map((edge) => ({
    id: edge.logical_id,
    source: edge.source_unit_logical_id,
    target: edge.target_unit_logical_id,
    label: edge.relationship === "next" ? "next" : edge.relationship,
    type: "smoothstep",
    animated: edge.status === "proposed",
    className: styles.courseFlowGraphEdge,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.relationship === "assesses" ? "#c97029" : edge.relationship === "requires" ? "#6c7f99" : "#7a7770",
      height: 16,
      width: 16,
    },
    style: {
      stroke: edge.relationship === "assesses" ? "#c97029" : edge.relationship === "requires" ? "#6c7f99" : "#7a7770",
      strokeDasharray: edge.relationship === "requires" ? "5 4" : undefined,
      strokeWidth: 1.6,
    },
    zIndex: 2,
  })), [flow?.edges]);

  async function autoArrangeCourseFlow() {
    setGraphBusy(true);
    setGraphPositions(arrangedPositions);
    try {
      for (const unit of units) {
        const position = arrangedPositions[unit.logical_id];
        if (position) {
          await onLayout(
            unit.logical_id,
            position.x,
            position.y,
            graphPositions[unit.logical_id],
          );
        }
      }
      window.setTimeout(() => graphInstance.current?.fitView({
        duration: 350,
        maxZoom: viewportPolicy.maxZoom,
        padding: viewportPolicy.padding,
      }), 40);
    } finally {
      setGraphBusy(false);
    }
  }

  function beginNewLecture() {
    if (mode !== "design") onModeChange("design");
    onAddLecture();
  }

  return (
    <motion.section
      animate="visible"
      className={styles.courseFlowWorkspace}
      data-motion-scope="course-flow-enter"
      initial={reducedMotion ? false : "hidden"}
      variants={sectionCascadeVariants(reducedMotion)}
    >
      <motion.header
        className={styles.courseFlowHeader}
        variants={sectionItemVariants}
      >
        <div>
          <small>Course Flow</small>
          <h2>Design the whole learning journey</h2>
          <p>Lectures hold detailed Blueprints. Quizzes and assignments connect them into one coherent course.</p>
        </div>
        <div className={styles.courseFlowActions}>
          <button className={styles.courseFlowPrimaryAction} disabled={disabled} onClick={beginNewLecture} type="button"><Plus />New lecture</button>
          <div className={styles.blueprintModeToggle}>
            <button className={mode === "live" ? styles.activeMode : ""} onClick={() => onModeChange("live")} type="button">Live</button>
            <button className={mode === "design" ? styles.activeMode : ""} onClick={() => onModeChange("design")} type="button">Design</button>
          </div>
          {mode === "design" ? <button className={styles.secondaryAction} disabled={disabled || graphBusy} onClick={() => void autoArrangeCourseFlow()} type="button"><GitFork />Auto arrange</button> : null}
          {mode === "design" ? <button className={styles.secondaryAction} disabled={disabled || undoing || !undoLabel} onClick={() => void onUndo()} title={undoLabel ? `Undo ${undoLabel.toLowerCase()}` : "Nothing to undo"} type="button"><RotateCcw />Undo</button> : null}
          {lectureCount > 1 ? <button className={styles.secondaryAction} onClick={onOpenWholeCourse} type="button"><Network />Cross-lecture map</button> : null}
        </div>
      </motion.header>
      {mode === "design" ? (
        <motion.div
          className={styles.courseFlowAuthoring}
          variants={sectionItemVariants}
        >
          <button disabled={disabled} onClick={() => setModuleEditorOpen(true)} type="button"><Plus /><BookOpenCheck />Module</button>
          <button disabled={disabled} onClick={() => setEditor({ kind: "quiz" })} type="button"><Plus /><ClipboardCheck />Quiz</button>
          <button disabled={disabled} onClick={() => setEditor({ kind: "assignment" })} type="button"><Plus /><FilePenLine />Assignment</button>
          <span>Every change remains private until you publish the revision.</span>
        </motion.div>
      ) : null}
      {!flow ? (
        <motion.div className={styles.courseFlowEmpty} variants={sectionItemVariants}><LoaderCircle className={styles.spin} />Loading Course Flow…</motion.div>
      ) : units.length === 0 ? (
        <motion.div className={styles.courseFlowEmpty} variants={sectionItemVariants}>
          <GraduationCap />
          <h3>Start with a lecture</h3>
          <p>Add the first lecture and Course Director will build its detailed Blueprint.</p>
          <button onClick={beginNewLecture} type="button">Add lecture</button>
        </motion.div>
      ) : (
        <motion.div className={styles.courseFlowCanvas} variants={sectionItemVariants}>
          {flow.edges.some((edge) => edge.status === "proposed") && mode === "design" ? (
            <section className={styles.courseFlowPending}>
              <strong>Relationship proposals</strong>
              {flow.edges.filter((edge) => edge.status === "proposed").map((edge) => {
                const source = units.find((unit) => unit.logical_id === edge.source_unit_logical_id);
                const target = units.find((unit) => unit.logical_id === edge.target_unit_logical_id);
                return <article key={edge.logical_id}><span><small>{edge.relationship}</small>{source?.title ?? "Unit"} → {target?.title ?? "Unit"}</span><div><button onClick={() => onReview("relationship", edge.logical_id, "accepted")} type="button"><Check />Accept</button><button onClick={() => {
                  setEditingRelationship(edge);
                  setRelationshipEditorOpen(true);
                }} type="button"><Pencil />Edit</button><button onClick={() => onReview("relationship", edge.logical_id, "dismissed")} type="button"><X />Dismiss</button></div></article>;
              })}
            </section>
          ) : null}
          <div
            className={styles.courseFlowGraph}
            data-compact={compactSequence || undefined}
            data-viewport-density={viewportPolicy.density}
          >
            <ReactFlow
              colorMode="light"
              edges={graphEdges}
              fitView
              fitViewOptions={{
                duration: reducedMotion ? 0 : 460,
                maxZoom: viewportPolicy.maxZoom,
                padding: viewportPolicy.padding,
              }}
              maxZoom={1.6}
              minZoom={.35}
              nodes={graphNodes}
              nodesConnectable={false}
              nodesDraggable={mode === "design" && !disabled}
              onEdgeClick={(_, edge) => {
                if (mode !== "design") return;
                const found = flow.edges.find((candidate) => candidate.logical_id === edge.id);
                if (!found) return;
                setEditingRelationship(found);
                setRelationshipEditorOpen(true);
              }}
              onInit={(instance) => {
                graphInstance.current = instance;
              }}
              onNodeClick={(_, node) => {
                if (node.id.startsWith("module:")) return;
                const unit = units.find((candidate) => candidate.logical_id === node.id);
                if (!unit) return;
                if (relationshipDraft?.relationship) {
                  if (
                    unit.logical_id !== relationshipDraft.source.logical_id
                    && isValidCourseFlowRelationshipTarget(
                      relationshipDraft.source,
                      unit,
                      relationshipDraft.relationship,
                    )
                  ) {
                    void onRelationship({
                      relationship: relationshipDraft.relationship,
                      source_unit_logical_id: relationshipDraft.source.logical_id,
                      target_unit_logical_id: unit.logical_id,
                    }, "create");
                    setRelationshipDraft(null);
                  }
                  return;
                }
                if (unit.kind === "lecture") onOpenLecture(unit);
                else setEditor({ kind: unit.kind, unit });
              }}
              onNodeDragStop={(_, node) => {
                if (node.id.startsWith("module:")) return;
                const previous = graphPositions[node.id] ?? arrangedPositions[node.id];
                setGraphPositions((current) => ({ ...current, [node.id]: node.position }));
                void onLayout(node.id, node.position.x, node.position.y, previous);
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#dedad2" gap={22} size={1} />
              <Controls orientation="horizontal" position="bottom-left" showInteractive={false} />
            </ReactFlow>
            {compactSequence ? (
              <button className={styles.courseFlowCompactAdd} disabled={disabled} onClick={beginNewLecture} type="button">
                <Plus />Add next lecture
              </button>
            ) : null}
          </div>
          {mode === "design" ? (
            <div className={styles.courseFlowGraphSelection}>
              <span>
                {relationshipDraft?.relationship
                  ? `Choose a destination for the ${relationshipDraft.relationship} relationship. Press Esc to cancel.`
                  : "Select a unit to open it. Hover its edge to connect it. Drag to organize."}
              </span>
              {units.some((unit) => unit.status === "proposed") ? (
                <div>
                  {units.filter((unit) => unit.status === "proposed").map((unit) => (
                    <article key={unit.logical_id}>
                      <strong>{unit.title}</strong>
                      <button onClick={() => onReview("unit", unit.logical_id, "accepted")} type="button"><Check />Accept</button>
                      <button onClick={() => setEditor({ kind: unit.kind, unit })} type="button"><Pencil />Edit</button>
                      <button onClick={() => onReview("unit", unit.logical_id, "dismissed")} type="button"><X />Dismiss</button>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </motion.div>
      )}
      {editor ? (
        <CourseFlowUnitDialog
          concepts={concepts}
          kind={editor.kind}
          modules={modules}
          onClose={() => setEditor(null)}
          onSave={(draft) => {
            onSave(draft, editor.unit);
            setEditor(null);
          }}
          unit={editor.unit}
        />
      ) : null}
      {moduleEditorOpen ? (
        <CourseFlowModuleDialog
          onClose={() => setModuleEditorOpen(false)}
          onSave={(title, summary) => {
            onAddModule(title, summary);
            setModuleEditorOpen(false);
          }}
        />
      ) : null}
      {relationshipEditorOpen ? (
        <CourseFlowRelationshipDialog
          edges={flow?.edges ?? []}
          initialEdge={editingRelationship}
          onClose={() => setRelationshipEditorOpen(false)}
          onSave={async (draft, action) => {
            if (editingRelationship) {
              await onReview("relationship", editingRelationship.logical_id, "dismissed");
            }
            await onRelationship(draft, action);
            setRelationshipEditorOpen(false);
            setEditingRelationship(null);
          }}
          units={units}
        />
      ) : null}
      {relationshipDraft && !relationshipDraft.relationship ? (
        <CourseFlowRelationshipKindDialog
          onChoose={(relationship) => setRelationshipDraft((current) => current ? { ...current, relationship } : null)}
          onClose={() => setRelationshipDraft(null)}
          source={relationshipDraft.source}
        />
      ) : null}
    </motion.section>
  );
}

function isValidCourseFlowRelationshipTarget(
  source: CourseFlowUnit,
  target: CourseFlowUnit,
  relationship: CourseFlowEdge["relationship"],
): boolean {
  if (source.logical_id === target.logical_id) return false;
  if (relationship === "assesses") {
    return source.kind === "lecture" && ["quiz", "assignment"].includes(target.kind);
  }
  return true;
}

function CourseFlowRelationshipKindDialog({
  onChoose,
  onClose,
  source,
}: {
  onChoose: (relationship: CourseFlowEdge["relationship"]) => void;
  onClose: () => void;
  source: CourseFlowUnit;
}) {
  const options: Array<{
    relationship: CourseFlowEdge["relationship"];
    title: string;
    detail: string;
  }> = [
    { relationship: "next", title: "Learning order", detail: "Learners continue from this unit to the selected unit." },
    { relationship: "requires", title: "Prerequisite", detail: "The selected unit depends on this unit." },
    { relationship: "assesses", title: "Assessment", detail: "Connect this lecture to a quiz or assignment that checks it." },
  ];
  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }} role="presentation">
      <section className={styles.courseFlowRelationshipPicker} role="dialog" aria-modal="true">
        <header>
          <div><small>Connect from</small><h3>{source.title}</h3></div>
          <button aria-label="Close" onClick={onClose} type="button"><X /></button>
        </header>
        <p>What should this connection mean?</p>
        <div>
          {options.map((option) => (
            <button
              disabled={option.relationship === "assesses" && source.kind !== "lecture"}
              key={option.relationship}
              onClick={() => onChoose(option.relationship)}
              type="button"
            >
              <strong>{option.title}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CourseFlowModuleDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (title: string, summary: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  return <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}><form className={styles.courseFlowDialog} onSubmit={(event) => {
    event.preventDefault();
    if (title.trim()) onSave(title.trim(), summary.trim());
  }}><header><div><small>Course structure</small><h3>New module</h3></div><button aria-label="Close" onClick={onClose} type="button"><X /></button></header><label>Title<input autoFocus onChange={(event) => setTitle(event.target.value)} value={title} /></label><label>Purpose<textarea onChange={(event) => setSummary(event.target.value)} rows={3} value={summary} /></label><footer><button onClick={onClose} type="button">Cancel</button><button disabled={!title.trim()} type="submit">Add module</button></footer></form></div>;
}

function CourseFlowRelationshipDialog({
  edges,
  initialEdge,
  onClose,
  onSave,
  units,
}: {
  edges: CourseFlowEdge[];
  initialEdge: CourseFlowEdge | null;
  onClose: () => void;
  onSave: (draft: CourseFlowEdgeDraft, action: "create" | "delete") => Promise<void>;
  units: CourseFlowUnit[];
}) {
  const [action, setAction] = useState<"create" | "delete">("create");
  const [relationship, setRelationship] = useState<CourseFlowEdge["relationship"]>(initialEdge?.relationship ?? "next");
  const [source, setSource] = useState(initialEdge?.source_unit_logical_id ?? units[0]?.logical_id ?? "");
  const [target, setTarget] = useState(initialEdge?.target_unit_logical_id ?? units[1]?.logical_id ?? "");
  const matchingEdge = edges.find((edge) => (
    edge.relationship === relationship
    && edge.source_unit_logical_id === source
    && edge.target_unit_logical_id === target
  ));
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <form className={styles.courseFlowDialog} onSubmit={async (event) => {
        event.preventDefault();
        if (!source || !target || source === target || (action === "delete" && !matchingEdge)) return;
        await onSave({
          relationship,
          source_unit_logical_id: source,
          target_unit_logical_id: target,
        }, action);
      }}>
        <header>
          <div><small>Course relationship</small><h3>Connect learning units</h3></div>
          <button aria-label="Close" onClick={onClose} type="button"><X /></button>
        </header>
        {!initialEdge ? <label>Action<select onChange={(event) => setAction(event.target.value as "create" | "delete")} value={action}><option value="create">Add relationship</option><option value="delete">Remove relationship</option></select></label> : null}
        <label>Relationship<select onChange={(event) => setRelationship(event.target.value as CourseFlowEdge["relationship"])} value={relationship}><option value="next">Next in sequence</option><option value="requires">Requires first</option><option value="assesses">Assesses lecture</option></select></label>
        <label>From<select onChange={(event) => setSource(event.target.value)} value={source}>{units.map((unit) => <option key={unit.logical_id} value={unit.logical_id}>{unit.title} · {unit.kind}</option>)}</select></label>
        <label>To<select onChange={(event) => setTarget(event.target.value)} value={target}>{units.map((unit) => <option key={unit.logical_id} value={unit.logical_id}>{unit.title} · {unit.kind}</option>)}</select></label>
        <p className={styles.courseFlowRelationshipHint}>{relationship === "next" ? "Learners encounter the destination after the source." : relationship === "requires" ? "The destination stays dependent on completing the source." : "Use a lecture as the source and a quiz or assignment as the destination."}</p>
        <footer>
          <button onClick={onClose} type="button">Cancel</button>
          <button disabled={!source || !target || source === target || (action === "delete" && !matchingEdge)} type="submit">{initialEdge ? "Save relationship" : action === "create" ? "Add relationship" : "Remove relationship"}</button>
        </footer>
      </form>
    </div>
  );
}

function CourseFlowUnitDialog({
  concepts,
  kind,
  modules,
  onClose,
  onSave,
  unit,
}: {
  concepts: BlueprintNode[];
  kind: CourseFlowUnitKind;
  modules: CourseFlow["modules"];
  onClose: () => void;
  onSave: (draft: CourseFlowDraftPayload) => void;
  unit?: CourseFlowUnit;
}) {
  const [title, setTitle] = useState(unit?.title ?? "");
  const [summary, setSummary] = useState(unit?.summary ?? "");
  const [instructions, setInstructions] = useState(unit?.instructions ?? "");
  const [conceptIds, setConceptIds] = useState<string[]>(unit?.concept_logical_ids ?? []);
  const [moduleId, setModuleId] = useState(unit?.module_logical_id ?? "");
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <form className={styles.courseFlowDialog} onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || (kind !== "lecture" && conceptIds.length === 0)) return;
        onSave({
          kind,
          title: title.trim(),
          summary: summary.trim(),
          instructions: instructions.trim(),
          module_logical_id: moduleId || null,
          concept_logical_ids: conceptIds,
        });
      }}>
        <header>
          <div><small>{unit ? "Edit" : "Add"} {kind}</small><h3>{unit?.title ?? `New ${kind}`}</h3></div>
          <button aria-label="Close" onClick={onClose} type="button"><X /></button>
        </header>
        <label>Title<input autoFocus maxLength={240} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
        <label>Purpose<textarea onChange={(event) => setSummary(event.target.value)} rows={2} value={summary} /></label>
        <label>{kind === "assignment" ? "Learner instructions" : "Quiz guidance"}<textarea onChange={(event) => setInstructions(event.target.value)} rows={4} value={instructions} /></label>
        <label>Module<select onChange={(event) => setModuleId(event.target.value)} value={moduleId}><option value="">Independent course unit</option>{modules.map((module) => <option key={module.logical_id} value={module.logical_id}>{module.title}</option>)}</select></label>
        {kind !== "lecture" ? <fieldset>
          <legend>Concept coverage <small>Select at least one concept</small></legend>
          <div className={styles.courseFlowConceptList}>
            {concepts.map((concept) => (
              <label key={concept.logical_id}>
                <input
                  checked={conceptIds.includes(concept.logical_id)}
                  onChange={(event) => setConceptIds((current) => event.target.checked
                    ? [...current, concept.logical_id]
                    : current.filter((id) => id !== concept.logical_id))}
                  type="checkbox"
                />
                <span>{concept.title}</span>
              </label>
            ))}
          </div>
        </fieldset> : null}
        <footer>
          <button onClick={onClose} type="button">Cancel</button>
          <button disabled={!title.trim() || (kind !== "lecture" && conceptIds.length === 0)} type="submit">{unit ? "Save changes" : `Add ${kind}`}</button>
        </footer>
      </form>
    </div>
  );
}

function BlueprintWorkspace({
  activeBlueprint,
  agentTasks,
  blueprintEvidence,
  contextTitle,
  dashboard,
  disabled,
  mode,
  onAddConcept,
  onAddTopic,
  onAskDirector,
  onCleanup,
  onCreateRelationship,
  onInspectRemoval,
  onLoadPack,
  onLayout,
  onOpenAssessments,
  onBackToCourseFlow,
  onOpenSources,
  onModeChange,
  onPrepare,
  onReconnectRelationship,
  onRemoveArtifact,
  onRemoveRelationship,
  onResolvePrerequisite,
  onResolveProposal,
  onSequence,
  onUndo,
  onUpdateConcept,
  onUpdateTopic,
  clips,
  undoing,
  undoLabel,
  workingBlueprint,
}: {
  activeBlueprint: CourseBlueprint | null;
  agentTasks: CourseAgentTask[];
  blueprintEvidence: BlueprintConceptEvidence[];
  contextTitle: string;
  dashboard: DashboardSummary | null;
  disabled: boolean;
  mode: BlueprintMode;
  onAddConcept: (draft: {
    name: string;
    description: string;
    topic_logical_ids: string[];
    sequence_after_id: string | null;
  }) => Promise<CourseBlueprint | null>;
  onAddTopic: (draft: {
    title: string;
    summary: string;
    start_seconds: number;
    end_seconds: number;
  }) => Promise<CourseBlueprint | null>;
  onAskDirector: (node: BlueprintNode) => void;
  onCleanup: (
    node: BlueprintNode,
    neighbors: BlueprintNode[],
    suggestedPrerequisite: {
      from_concept_logical_id: string;
      to_concept_logical_id: string;
    } | null,
  ) => Promise<void>;
  onCreateRelationship: (relationship: BlueprintRelationshipSpec) => Promise<CourseBlueprint | null>;
  onInspectRemoval: (node: BlueprintNode) => Promise<BlueprintMutationImpact | null>;
  onLoadPack: (taskId: string) => Promise<AgentTaskPack>;
  onLayout: (
    node: BlueprintNode,
    x: number,
    y: number,
    previousPosition?: { x: number; y: number } | null,
  ) => Promise<void>;
  onBackToCourseFlow: () => void;
  onOpenAssessments: () => void;
  onOpenSources: () => void;
  onModeChange: (mode: BlueprintMode) => void;
  onPrepare: (node: BlueprintNode, neighbors: BlueprintNode[]) => Promise<void>;
  onReconnectRelationship: (
    previous: BlueprintRelationshipSpec,
    replacement: BlueprintRelationshipSpec,
  ) => Promise<CourseBlueprint | null>;
  onRemoveArtifact: (node: BlueprintNode) => Promise<CourseBlueprint | null>;
  onRemoveRelationship: (relationship: BlueprintRelationshipSpec) => Promise<CourseBlueprint | null>;
  onResolvePrerequisite: (edge: BlueprintEdge, decision: "accepted" | "dismissed") => Promise<void>;
  onResolveProposal: (proposal: AgentTaskProposal, decision: Decision, revision?: Record<string, unknown>) => Promise<void>;
  onSequence: (conceptIds: string[]) => Promise<void>;
  onUndo: () => Promise<void>;
  onUpdateConcept: (node: BlueprintNode, name: string, description: string) => Promise<void>;
  onUpdateTopic: (node: BlueprintNode, draft: {
    title: string;
    summary: string;
    start_seconds: number;
    end_seconds: number;
  }) => Promise<CourseBlueprint | null>;
  clips: AssessmentWorkspace["clips"];
  undoing: boolean;
  undoLabel: string | null;
  workingBlueprint: CourseBlueprint | null;
}) {
  const reducedMotion = useReducedMotion();
  const [selectedLogicalId, setSelectedLogicalId] = useState<string | null>(null);
  const [focusTopicLogicalId, setFocusTopicLogicalId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<BlueprintGraphNode, BlueprintGraphEdge> | null
  >(null);
  const [settledViewportKey, setSettledViewportKey] = useState<string | null>(null);
  const [enabledRelationships, setEnabledRelationships] = useState<Set<BlueprintEdgeKind>>(
    () => new Set(coreBlueprintEdgeKinds),
  );
  const [autoArrangeVersion, setAutoArrangeVersion] = useState(0);
  const [designDialog, setDesignDialog] = useState<"topic" | "concept" | "order" | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [relationshipDraft, setRelationshipDraft] = useState<BlueprintRelationshipDraft | null>(null);
  const [selectedRelationship, setSelectedRelationship] = useState<BlueprintEdge | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{
    node: BlueprintNode;
    impact: BlueprintMutationImpact | null;
    loading: boolean;
  } | null>(null);
  const [cleanupAnchorLogicalId, setCleanupAnchorLogicalId] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const dragStartPositions = useRef<Record<string, { x: number; y: number }>>({});
  const blueprint = mode === "live"
    ? (activeBlueprint ?? workingBlueprint)
    : (workingBlueprint ?? activeBlueprint);
  const selected = blueprint?.nodes.find((node) => node.logical_id === selectedLogicalId) ?? null;
  const selectedClip = selected?.kind === "clip"
    ? findBlueprintClip(selected, clips)
    : null;
  const topics = useMemo(
    () => blueprint?.nodes.filter((node) => node.kind === "topic") ?? [],
    [blueprint],
  );
  const concepts = useMemo(
    () => (blueprint?.nodes.filter((node) => node.kind === "concept") ?? []).sort(compareBlueprintSequence),
    [blueprint],
  );
  const visibleNodeIds = useMemo(
    () => blueprint ? visibleBlueprintNodeIds(blueprint, focusTopicLogicalId) : null,
    [blueprint, focusTopicLogicalId],
  );
  const flow = useBlueprintFlow(
    blueprint,
    blueprintEvidence,
    mode,
    visibleNodeIds,
    selected?.id ?? null,
    enabledRelationships,
    mode === "design" && autoArrangeVersion === 0,
    autoArrangeVersion,
    {
      onStartRelationship: (node, side) => {
        setSelectedLogicalId(null);
        setSelectedRelationship(null);
        setRelationshipError(null);
        setRelationshipDraft({ source: node, side, kind: null, replacing: null });
      },
      relationshipDraft,
    },
  );
  const viewportContextKey = `${mode}:${focusTopicLogicalId ?? "course"}:${autoArrangeVersion}`;
  const viewportFitKey = `${viewportContextKey}:${flow.layoutKey ?? "pending"}`;
  const viewportReady = flow.layoutReady
    && (!flow.nodes.length || settledViewportKey === viewportFitKey);
  const evidence = selected?.kind === "concept"
    ? blueprintEvidence.find((item) => item.concept_id === selected.id) ?? null
    : null;
  const neighbors = selected && blueprint
    ? blueprint.edges
      .filter((edge) => edge.source_id === selected.id || edge.target_id === selected.id)
      .map((edge) => blueprint.nodes.find((node) => node.id === (edge.source_id === selected.id ? edge.target_id : edge.source_id)))
      .filter((node): node is BlueprintNode => Boolean(node))
    : [];
  const pendingEdges = blueprint?.edges.filter((edge) => edge.kind === "requires" && edge.status === "proposed") ?? [];
  const coverageGaps = blueprint?.uncovered_concept_ids.length ?? 0;
  const coveragePercent = concepts.length
    ? Math.max(0, Math.min(100, Math.round(((concepts.length - coverageGaps) / concepts.length) * 100)))
    : 100;
  const activePrivateTasks = agentTasks.filter((task) => (
    ["queued", "running", "waiting_review"].includes(task.status)
  )).length;
  const selectedTask = selected
    ? agentTasks.find((task) => (
      task.target_logical_artifact_id === selected.logical_id
      && ["prepare_improvement", "cleanup_blueprint"].includes(task.task_type)
    ))
    : null;
  const cleanupAnchor = cleanupAnchorLogicalId
    ? blueprint?.nodes.find((node) => node.logical_id === cleanupAnchorLogicalId) ?? null
    : null;

  useEffect(() => {
    if (selectedLogicalId && !blueprint?.nodes.some((node) => node.logical_id === selectedLogicalId)) {
      setSelectedLogicalId(null);
    }
    if (focusTopicLogicalId && !topics.some((topic) => topic.logical_id === focusTopicLogicalId)) {
      setFocusTopicLogicalId(null);
    }
  }, [blueprint, concepts, focusTopicLogicalId, selectedLogicalId, topics]);

  const performUndo = useCallback(async () => {
    setSelectedLogicalId(null);
    setSelectedRelationship(null);
    setRelationshipDraft(null);
    setRelationshipError(null);
    await onUndo();
  }, [onUndo]);

  useEffect(() => {
    function handleUndoShortcut(event: KeyboardEvent) {
      if (
        mode !== "design"
        || !undoLabel
        || undoing
        || disabled
        || event.shiftKey
        || event.key.toLowerCase() !== "z"
        || (!event.metaKey && !event.ctrlKey)
      ) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable)
      ) return;
      event.preventDefault();
      void performUndo();
    }
    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [disabled, mode, performUndo, undoing, undoLabel]);

  useEffect(() => {
    if (!flowInstance || !flow.layoutReady || !flow.nodes.length) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    setSettledViewportKey(null);
    // Keep intermediate ELK positions invisible, let React Flow measure the
    // completed nodes, then perform one authoritative fit before revealing the
    // graph. This prevents the mount fit and completed-layout fit from racing.
    const fitWhenSynchronized = () => {
      if (cancelled) return;
      const renderedNodes = flowInstance.getNodes();
      const nodesReady = renderedNodes.length === flow.nodes.length
        && renderedNodes.every((node) => (
          Boolean(node.measured?.width) && Boolean(node.measured?.height)
        ));
      if (!nodesReady && attempts < 60) {
        attempts += 1;
        frame = window.requestAnimationFrame(fitWhenSynchronized);
        return;
      }
      void flowInstance.fitView({ duration: 0, maxZoom: 1, padding: 0.14 });
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) setSettledViewportKey(viewportFitKey);
      });
    };
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(fitWhenSynchronized);
    }, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [flow.layoutReady, flow.nodes.length, flowInstance, viewportFitKey]);

  const closeArtifactInspector = useCallback(() => {
    setSelectedLogicalId(null);
  }, []);

  async function chooseRelationshipTarget(target: BlueprintNode) {
    if (!relationshipDraft?.kind || !blueprint) return;
    if (!isValidBlueprintRelationshipTarget(
      relationshipDraft.source,
      target,
      relationshipDraft.kind,
    )) {
      setRelationshipError(
        `${blueprintRelationshipLabels[relationshipDraft.kind]} cannot connect `
        + `${relationshipDraft.source.kind} to ${target.kind}. Choose a highlighted artifact.`,
      );
      return;
    }
    const replacement: BlueprintRelationshipSpec = {
      relationship: relationshipDraft.kind,
      source_logical_id: relationshipDraft.source.logical_id,
      target_logical_id: target.logical_id,
    };
    try {
      if (relationshipDraft.replacing) {
        const previous = relationshipSpec(blueprint, relationshipDraft.replacing);
        if (!previous) return;
        await onReconnectRelationship(previous, replacement);
      } else {
        await onCreateRelationship(replacement);
      }
      setEnabledRelationships((current) => new Set([...current, relationshipDraft.kind as BlueprintEdgeKind]));
      recordPrivateMutation(relationshipDraft.source);
      setRelationshipDraft(null);
      setRelationshipError(null);
      setSelectedLogicalId(target.logical_id);
    } catch {
      // The parent request surfaces the server detail in the shared error banner.
    }
  }

  async function deleteSelectedRelationship() {
    if (!selectedRelationship || !blueprint) return;
    const spec = relationshipSpec(blueprint, selectedRelationship);
    if (!spec) return;
    try {
      const source = blueprint.nodes.find((node) => node.id === selectedRelationship.source_id) ?? null;
      await onRemoveRelationship(spec);
      setSelectedRelationship(null);
      recordPrivateMutation(source);
    } catch {
      // The parent request surfaces the server detail in the shared error banner.
    }
  }

  function replaceSelectedRelationship() {
    if (!selectedRelationship || !blueprint || selectedRelationship.kind === "next") return;
    const source = blueprint.nodes.find((node) => node.id === selectedRelationship.source_id);
    if (!source) return;
    setRelationshipDraft({
      source,
      side: "right",
      kind: selectedRelationship.kind,
      replacing: selectedRelationship,
    });
    setSelectedRelationship(null);
    setSelectedLogicalId(null);
    setRelationshipError(null);
  }

  const showCoreRelationships = useCallback(() => {
    setEnabledRelationships(new Set(coreBlueprintEdgeKinds));
  }, []);
  const showAllRelationships = useCallback(() => {
    setEnabledRelationships(new Set(blueprintEdgeKinds));
  }, []);
  const toggleRelationship = useCallback((kind: BlueprintEdgeKind) => {
    setEnabledRelationships((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  function recordPrivateMutation(anchor: BlueprintNode | null) {
    setCleanupAnchorLogicalId(anchor?.logical_id ?? null);
    if (anchor) setSelectedLogicalId(anchor.logical_id);
  }

  async function openRemoval(node: BlueprintNode) {
    setRemoval({ node, impact: null, loading: true });
    try {
      const impact = await onInspectRemoval(node);
      setRemoval({ node, impact, loading: false });
    } catch {
      setRemoval(null);
    }
  }

  async function confirmRemoval() {
    if (!removal) return;
    const deleted = removal.node;
    const survivingAnchor = concepts.find((concept) => concept.id !== deleted.id) ?? topics.find(
      (topic) => topic.id !== deleted.id,
    ) ?? null;
    await onRemoveArtifact(deleted);
    setRemoval(null);
    setSelectedLogicalId(null);
    recordPrivateMutation(survivingAnchor);
  }

  async function runCleanup() {
    if (!cleanupAnchor || !blueprint) return;
    const adjacent = blueprint.edges
      .filter((edge) => edge.source_id === cleanupAnchor.id || edge.target_id === cleanupAnchor.id)
      .map((edge) => blueprint.nodes.find((node) => (
        node.id === (edge.source_id === cleanupAnchor.id ? edge.target_id : edge.source_id)
      )))
      .filter((node): node is BlueprintNode => Boolean(node));
    let suggestedPrerequisite: {
      from_concept_logical_id: string;
      to_concept_logical_id: string;
    } | null = null;
    if (cleanupAnchor.kind === "concept") {
      const index = concepts.findIndex((concept) => concept.id === cleanupAnchor.id);
      const previous = index > 0 ? concepts[index - 1] : null;
      const hasPrerequisite = blueprint.edges.some((edge) => (
        edge.kind === "requires"
        && (edge.source_id === cleanupAnchor.id || edge.target_id === cleanupAnchor.id)
        && edge.status !== "dismissed"
      ));
      if (previous && !hasPrerequisite) {
        suggestedPrerequisite = {
          from_concept_logical_id: cleanupAnchor.logical_id,
          to_concept_logical_id: previous.logical_id,
        };
      }
    }
    setCleanupRunning(true);
    try {
      await onCleanup(cleanupAnchor, adjacent, suggestedPrerequisite);
      setSelectedLogicalId(cleanupAnchor.logical_id);
      setCleanupAnchorLogicalId(null);
    } finally {
      setCleanupRunning(false);
    }
  }

  if (!blueprint) {
    return <div className={styles.canvasEmpty}><LoaderCircle className={styles.spin} /><h2>Loading the course Blueprint</h2><p>The structure, learning evidence, and adaptive routes are being assembled.</p></div>;
  }

  return (
    <motion.div
      animate="visible"
      className={styles.blueprintWorkspace}
      data-mode={mode}
      data-motion-scope="blueprint-enter"
      initial={reducedMotion ? false : "hidden"}
      variants={sectionCascadeVariants(reducedMotion)}
    >
      {contextTitle === "Cross-lecture concept map" ? (
        <motion.div
          className={styles.blueprintContextBar}
          variants={sectionItemVariants}
        >
          <button onClick={onBackToCourseFlow} type="button"><ArrowLeft />Course Flow</button>
          <span aria-hidden="true">/</span>
          <div>
            <strong>{contextTitle}</strong>
            <small>Whole-course structure</small>
          </div>
        </motion.div>
      ) : null}
      <motion.header
        className={styles.blueprintCommandBar}
        variants={sectionItemVariants}
      >
        <div className={styles.blueprintSummaryGroup} role="group" aria-label="Blueprint status and metrics">
          <div className={styles.blueprintStatusSummary}>
            <p>
              <i data-mode={mode} />
              <strong>{mode === "design" ? "Private design" : "Published live"}</strong>
            </p>
          </div>
          <div className={styles.blueprintCompactMetrics}>
            <article title={coverageGaps ? `${coverageGaps} coverage gaps` : "Coverage complete"}>
              <small>Coverage</small>
              <div className={styles.blueprintCoverageValue}>
                <strong>{coveragePercent}%</strong>
                <span aria-hidden="true"><i style={{ width: `${coveragePercent}%` }} /></span>
              </div>
            </article>
            <article>
              <small>Evidence</small>
              <strong>{dashboard?.attempt_count ?? 0} attempts</strong>
            </article>
            <article>
              <small>Private</small>
              <strong>{activePrivateTasks} active</strong>
            </article>
          </div>
        </div>
        <div className={styles.blueprintCommandActions}>
          <nav className={styles.blueprintModeToggle} aria-label="Blueprint mode">
            {blueprintModes.map((item) => (
              <button
                aria-pressed={mode === item.id}
                key={item.id}
                onClick={() => {
                  setAutoArrangeVersion(0);
                  onModeChange(item.id);
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button
            className={styles.blueprintAutoArrange}
            onClick={() => setAutoArrangeVersion((current) => current + 1)}
            type="button"
          >
            <Network />Auto arrange
          </button>
        </div>
      </motion.header>

      {pendingEdges.length ? (
        <div className={styles.blueprintNotice}>
          <CircleAlert />
          <p><strong>{pendingEdges.length} prerequisite relationships need review.</strong> They remain private until you confirm them.</p>
        </div>
      ) : null}

      {cleanupAnchor ? (
        <section className={styles.blueprintCleanupPrompt} aria-live="polite">
          <div>
            <Check />
            <p><strong>Private edit saved</strong><span>Course Director can inspect the surrounding course and prepare optional cleanup.</span></p>
          </div>
          <div>
            <button onClick={() => setCleanupAnchorLogicalId(null)} type="button">Not now</button>
            <button disabled={cleanupRunning || disabled} onClick={() => void runCleanup()} type="button">
              {cleanupRunning ? <LoaderCircle className={styles.spin} /> : <Wand2 />}
              Prepare AI cleanup
            </button>
          </div>
        </section>
      ) : null}

      <motion.section
        aria-label="Blueprint graph controls"
        className={styles.blueprintGraphControls}
        variants={sectionItemVariants}
      >
        <div className={styles.blueprintRelationshipPresets}>
          <span>Relationships</span>
          <button
            aria-pressed={enabledRelationships.size === coreBlueprintEdgeKinds.size
              && [...coreBlueprintEdgeKinds].every((kind) => enabledRelationships.has(kind))}
            onClick={showCoreRelationships}
            type="button"
          >
            Core
          </button>
          <button
            aria-pressed={enabledRelationships.size === blueprintEdgeKinds.length}
            onClick={showAllRelationships}
            type="button"
          >
            All
          </button>
        </div>
        <details className={styles.blueprintRelationshipFilters}>
          <summary>Choose relationships</summary>
          <div>
            {blueprintEdgeKinds.map((kind) => (
              <label key={kind}>
                <input
                  checked={enabledRelationships.has(kind)}
                  onChange={() => toggleRelationship(kind)}
                  type="checkbox"
                />
                <i data-kind={kind} />
                {blueprintRelationshipLabels[kind]}
              </label>
            ))}
          </div>
        </details>
        {mode === "design" ? (
          <div className={styles.blueprintDesignActions}>
            <div className={styles.blueprintAddNode}>
              <button
                aria-expanded={addNodeOpen}
                onClick={() => setAddNodeOpen((current) => !current)}
                type="button"
              >
                <Plus />Add node<ChevronDown />
              </button>
              {addNodeOpen ? (
                <div role="menu">
                  <button onClick={() => { setAddNodeOpen(false); setDesignDialog("topic"); }} role="menuitem" type="button"><BookOpenCheck /><span><strong>Topic</strong><small>Organize part of the lecture</small></span></button>
                  <button onClick={() => { setAddNodeOpen(false); setDesignDialog("concept"); }} role="menuitem" type="button"><BrainCircuit /><span><strong>Concept</strong><small>Add a learning objective</small></span></button>
                  <button onClick={() => { setAddNodeOpen(false); onOpenAssessments(); }} role="menuitem" type="button"><ClipboardList /><span><strong>Assessment</strong><small>Add or edit a knowledge check</small></span></button>
                  <button onClick={() => { setAddNodeOpen(false); onOpenSources(); }} role="menuitem" type="button"><FileText /><span><strong>Source</strong><small>Add supporting course context</small></span></button>
                </div>
              ) : null}
            </div>
            <button onClick={() => setDesignDialog("order")} type="button"><ArrowUp />Learning order</button>
            <button
              aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo last Blueprint change"}
              disabled={!undoLabel || undoing || disabled}
              onClick={() => void performUndo()}
              title={undoLabel ? `Undo ${undoLabel} (⌘Z / Ctrl+Z)` : "Nothing to undo in this session"}
              type="button"
            >
              {undoing ? <LoaderCircle className={styles.spin} /> : <RotateCcw />}
              Undo
            </button>
            <span className={styles.blueprintAutosaveStatus} title="Changes are saved to the private revision. Publish updates is the learner-facing gate.">
              <Check />Saved privately
            </span>
          </div>
        ) : null}
        <div className={styles.blueprintTypeLegend} aria-label="Artifact types">
          {(["source", "topic", "concept", "clip", "question"] as BlueprintNode["kind"][]).map((kind) => (
            <span key={kind}><i data-kind={kind}>{blueprintKindIcon(kind)}</i>{kind}</span>
          ))}
        </div>
      </motion.section>

      <motion.div
        className={styles.blueprintBody}
        variants={sectionItemVariants}
      >
        <nav className={styles.blueprintOutline} aria-label="Course Blueprint outline">
          <button aria-pressed={!focusTopicLogicalId} onClick={() => { setAutoArrangeVersion(0); setFocusTopicLogicalId(null); setSelectedLogicalId(null); }} type="button"><BookOpenCheck /><span><strong>Whole course</strong><small>{topics.length} topics · {concepts.length} concepts</small></span></button>
          {topics.map((topic, topicIndex) => {
            const topicConcepts = concepts.filter((concept) => blueprint.edges.some((edge) => edge.kind === "contains" && edge.source_id === topic.id && edge.target_id === concept.id));
            return (
              <div key={topic.id}>
                <button aria-pressed={focusTopicLogicalId === topic.logical_id} onClick={() => { setAutoArrangeVersion(0); setFocusTopicLogicalId(topic.logical_id); setSelectedLogicalId(topic.logical_id); }} type="button"><span>{String(topicIndex + 1).padStart(2, "0")}</span><span><strong>{topic.title}</strong><small>{topicConcepts.length} concepts</small></span></button>
                {focusTopicLogicalId === topic.logical_id ? topicConcepts.map((concept) => (
                  <button aria-current={selectedLogicalId === concept.logical_id ? "true" : undefined} key={concept.id} onClick={() => setSelectedLogicalId(concept.logical_id)} type="button"><i data-state={masteryStateForConcept(concept.id, blueprintEvidence)} />{concept.title}</button>
                )) : null}
              </div>
            );
          })}
        </nav>

        <div
          className={styles.blueprintCanvas}
          data-viewport-state={viewportReady ? "ready" : "settling"}
        >
          <AnimatePresence>
            {!viewportReady ? (
              <motion.div
                animate={{ opacity: 1 }}
                className={styles.blueprintLayoutLoading}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                initial={reducedMotion ? false : { opacity: 0 }}
                transition={reducedMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: interfaceEase }}
              >
                <LoaderCircle className={styles.spin} />
                <span>Arranging the course system…</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <motion.div
            animate={{ opacity: viewportReady ? 1 : 0 }}
            aria-hidden={!viewportReady}
            className={styles.blueprintGraphStage}
            initial={false}
            transition={reducedMotion
              ? { duration: 0 }
              : { duration: 0.24, ease: interfaceEase }}
          >
            <ReactFlow
              edgeTypes={blueprintEdgeTypes}
              edges={flow.edges}
              key={viewportContextKey}
              nodeTypes={blueprintNodeTypes}
              nodes={flow.nodes}
              nodesConnectable={false}
              nodesDraggable={mode === "design"}
              onInit={(instance) => {
                setFlowInstance(instance);
              }}
              onNodesChange={(changes) => {
                changes.forEach((change) => {
                  if (change.type === "position" && change.position) {
                    flow.setPosition(change.id, change.position);
                  }
                });
              }}
              onNodeDrag={(_, node) => flow.setPosition(node.id, node.position)}
              onNodeDragStart={(_, node) => {
                dragStartPositions.current[node.id] = { ...node.position };
              }}
              onNodeDragStop={(_, node) => {
                const artifact = blueprint.nodes.find((item) => item.id === node.id);
                const previousPosition = dragStartPositions.current[node.id] ?? null;
                delete dragStartPositions.current[node.id];
                if (
                  artifact
                  && previousPosition
                  && (previousPosition.x !== node.position.x || previousPosition.y !== node.position.y)
                ) {
                  void onLayout(artifact, node.position.x, node.position.y, previousPosition);
                }
              }}
              onNodeClick={(_, node) => {
                const selectedNode = blueprint.nodes.find((item) => item.id === node.id);
                if (selectedNode && relationshipDraft?.kind) {
                  void chooseRelationshipTarget(selectedNode);
                  return;
                }
                setSelectedRelationship(null);
                setSelectedLogicalId(selectedNode?.logical_id ?? null);
              }}
              onEdgeClick={(_, edge) => {
                if (mode !== "design") return;
                const relationship = blueprint.edges.find((item) => item.id === edge.id) ?? null;
                if (relationship?.kind === "next") return;
                setSelectedLogicalId(null);
                setRelationshipDraft(null);
                setSelectedRelationship(relationship);
              }}
              onPaneClick={() => {
                setSelectedLogicalId(null);
                setSelectedRelationship(null);
                setRelationshipDraft(null);
                setRelationshipError(null);
              }}
              panOnScroll
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e2ded6" gap={22} size={1} />
              <Controls orientation="horizontal" position="bottom-left" showInteractive={false} />
            </ReactFlow>
          </motion.div>
          {mode === "design" ? <p className={styles.blueprintCanvasHint}><GitFork />Move an artifact, hover a node edge to connect it, or select any relationship to change it.</p> : null}
          {relationshipDraft?.kind ? (
            <section className={styles.blueprintRelationshipGuide} aria-live="polite">
              <div>
                <GitFork />
                <p>
                  <strong>Select the {blueprintRelationshipLabels[relationshipDraft.kind].toLowerCase()} target</strong>
                  <span>Valid artifacts are highlighted. Connecting from “{relationshipDraft.source.title}”.</span>
                </p>
              </div>
              {relationshipError ? <em>{relationshipError}</em> : null}
              <button onClick={() => { setRelationshipDraft(null); setRelationshipError(null); }} type="button">Cancel</button>
            </section>
          ) : null}
          {selected ? (
            <aside aria-label={`${selected.title} artifact inspector`} className={styles.blueprintInspector} role="dialog">
            <>
              <header><span data-kind={selected.kind}>{blueprintKindIcon(selected.kind)}</span><div><small>{selected.kind}</small><h3>{selected.title}</h3><em data-status={selected.status}>{selected.status}</em></div><button aria-label="Close artifact inspector" className={styles.inspectorClose} onClick={closeArtifactInspector} type="button"><X /></button></header>
              {selected.kind === "concept"
                ? <ConceptEvidencePanel evidence={evidence} />
                : <ArtifactCoveragePanel clip={selectedClip} node={selected} neighbors={neighbors} />}
              {mode === "design" && selected.kind === "topic" ? (
                <TopicInspectorEditor
                  disabled={disabled}
                  node={selected}
                  onSave={async (node, draft) => {
                    await onUpdateTopic(node, draft);
                    recordPrivateMutation(node);
                  }}
                />
              ) : null}
              {mode === "design" && selected.kind === "concept" ? (
                <ConceptInspectorEditor
                  disabled={disabled}
                  node={selected}
                  onSave={async (node, name, description) => {
                    await onUpdateConcept(node, name, description);
                    recordPrivateMutation(node);
                  }}
                />
              ) : null}
              {mode === "design" ? (
                <section className={styles.inspectorRelationships}>
                  <h4>Relationships</h4>
                  {blueprint.edges
                    .filter((edge) => (
                      edge.kind !== "next"
                      && edge.status !== "dismissed"
                      && (edge.source_id === selected.id || edge.target_id === selected.id)
                    ))
                    .map((edge) => {
                      const other = blueprint.nodes.find((node) => (
                        node.id === (edge.source_id === selected.id ? edge.target_id : edge.source_id)
                      ));
                      return (
                        <div key={edge.id}>
                          <span>{blueprintRelationshipLabels[edge.kind]} · {edge.source_id === selected.id ? "Outgoing" : "Incoming"}</span>
                          <strong>{other?.title ?? "Unknown concept"}</strong>
                          {edge.status !== "proposed" ? (
                            <button
                              aria-label={`Inspect ${blueprintRelationshipLabels[edge.kind]} relationship with ${other?.title ?? "artifact"}`}
                              disabled={disabled}
                              onClick={() => {
                                setSelectedLogicalId(null);
                                setSelectedRelationship(edge);
                              }}
                              type="button"
                            >
                              <Pencil />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  {!blueprint.edges.some((edge) => (
                    edge.kind !== "next"
                    && edge.status !== "dismissed"
                    && (edge.source_id === selected.id || edge.target_id === selected.id)
                  )) ? <p>No relationships yet. Hover any side of the node and choose + to connect it.</p> : null}
                </section>
              ) : null}
              {pendingEdges.filter((edge) => edge.source_id === selected.id || edge.target_id === selected.id).map((edge) => {
                const other = blueprint.nodes.find((node) => node.id === (edge.source_id === selected.id ? edge.target_id : edge.source_id));
                return <article className={styles.relationshipReview} key={edge.id}><small>Proposed prerequisite</small><strong>{edge.source_id === selected.id ? `${selected.title} → ${other?.title}` : `${other?.title} → ${selected.title}`}</strong><div><button disabled={disabled} onClick={() => void onResolvePrerequisite(edge, "dismissed")} type="button"><X />Dismiss</button><button disabled={disabled} onClick={() => void onResolvePrerequisite(edge, "accepted")} type="button"><Check />Accept</button></div></article>;
              })}
              <div className={styles.blueprintActions}>
                <button onClick={() => onAskDirector(selected)} type="button"><MessageCircleMore />Ask Director</button>
                <button disabled={disabled || Boolean(selectedTask && ["queued", "running"].includes(selectedTask.status))} onClick={() => void onPrepare(selected, neighbors)} type="button"><Wand2 />{selectedTask?.status === "waiting_review" ? "Refresh proposal pack" : "Prepare improvement"}</button>
              </div>
              {mode === "design" && ["topic", "concept", "clip", "question"].includes(selected.kind) ? (
                <button
                  className={styles.inspectorRemoveButton}
                  disabled={disabled}
                  onClick={() => void openRemoval(selected)}
                  type="button"
                >
                  <Trash2 />Remove {selected.kind}
                </button>
              ) : null}
              {selectedTask ? <ProposalPack task={selectedTask} load={onLoadPack} onResolve={onResolveProposal} /> : null}
            </>
            </aside>
          ) : null}
          {selectedRelationship ? (
            <BlueprintRelationshipInspector
              blueprint={blueprint}
              disabled={disabled}
              edge={selectedRelationship}
              onChange={replaceSelectedRelationship}
              onClose={() => setSelectedRelationship(null)}
              onRemove={() => void deleteSelectedRelationship()}
            />
          ) : null}
        </div>
      </motion.div>
      {relationshipDraft && !relationshipDraft.kind ? (
        <BlueprintRelationshipKindDialog
          onChoose={(kind) => setRelationshipDraft((current) => current ? { ...current, kind } : null)}
          onClose={() => setRelationshipDraft(null)}
          source={relationshipDraft.source}
        />
      ) : null}
      {designDialog === "topic" ? (
        <BlueprintAddTopicDialog
          disabled={disabled}
          onClose={() => setDesignDialog(null)}
          onSave={async (draft) => {
            const next = await onAddTopic(draft);
            const created = next?.nodes.find((node) => (
              node.kind === "topic" && node.title.trim().toLowerCase() === draft.title.trim().toLowerCase()
            )) ?? null;
            setDesignDialog(null);
            recordPrivateMutation(created);
          }}
          topics={topics}
        />
      ) : null}
      {designDialog === "concept" ? (
        <BlueprintAddConceptDialog
          concepts={concepts}
          disabled={disabled}
          initialTopicLogicalId={focusTopicLogicalId}
          onClose={() => setDesignDialog(null)}
          onSave={async (draft) => {
            const next = await onAddConcept(draft);
            const created = next?.nodes.find((node) => (
              node.kind === "concept" && node.title.trim().toLowerCase() === draft.name.trim().toLowerCase()
            )) ?? null;
            setDesignDialog(null);
            recordPrivateMutation(created);
          }}
          topics={topics}
        />
      ) : null}
      {designDialog === "order" ? (
        <LearningOrderDialog
          concepts={concepts}
          disabled={disabled}
          onClose={() => setDesignDialog(null)}
          onSave={async (ids) => {
            await onSequence(ids);
            setDesignDialog(null);
            recordPrivateMutation(concepts[0] ?? null);
          }}
        />
      ) : null}
      {removal ? (
        <BlueprintRemovalDialog
          disabled={disabled}
          impact={removal.impact}
          loading={removal.loading}
          node={removal.node}
          onClose={() => setRemoval(null)}
          onConfirm={() => void confirmRemoval()}
        />
      ) : null}
    </motion.div>
  );
}

function BlueprintRelationshipKindDialog({
  onChoose,
  onClose,
  source,
}: {
  onChoose: (kind: EditableBlueprintRelationship) => void;
  onClose: () => void;
  source: BlueprintNode;
}) {
  const kinds = availableBlueprintRelationshipKinds(source);
  return (
    <div className={styles.blueprintDialogOverlay} onClick={onClose} role="presentation">
      <section
        aria-labelledby="relationship-kind-title"
        aria-modal="true"
        className={`${styles.blueprintActionDialog} ${styles.blueprintRelationshipDialog}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span><GitFork /></span>
            <div>
              <small>Connect from {source.kind}</small>
              <h3 id="relationship-kind-title">What should this connection mean?</h3>
              <p>Choose the learning relationship first. Course Director will then highlight valid targets.</p>
            </div>
          </div>
          <button aria-label="Cancel relationship" onClick={onClose} type="button"><X /></button>
        </header>
        <div className={styles.blueprintRelationshipChoices}>
          {kinds.map((kind) => (
            <button key={kind} onClick={() => onChoose(kind)} type="button">
              <i data-kind={kind} />
              <span>
                <strong>{blueprintRelationshipLabels[kind]}</strong>
                <small>{blueprintRelationshipDescriptions[kind]}</small>
              </span>
              <ArrowUp />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function BlueprintRelationshipInspector({
  blueprint,
  disabled,
  edge,
  onChange,
  onClose,
  onRemove,
}: {
  blueprint: CourseBlueprint;
  disabled: boolean;
  edge: BlueprintEdge;
  onChange: () => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const source = blueprint.nodes.find((node) => node.id === edge.source_id);
  const target = blueprint.nodes.find((node) => node.id === edge.target_id);
  return (
    <aside aria-label={`${blueprintRelationshipLabels[edge.kind]} relationship`} className={`${styles.blueprintInspector} ${styles.blueprintRelationshipInspector}`} role="dialog">
      <header>
        <span><GitFork /></span>
        <div>
          <small>Relationship</small>
          <h3>{blueprintRelationshipLabels[edge.kind]}</h3>
          <em data-status={edge.status}>{edge.status}</em>
        </div>
        <button aria-label="Close relationship inspector" className={styles.inspectorClose} onClick={onClose} type="button"><X /></button>
      </header>
      <div className={styles.blueprintRelationshipRoute}>
        <article><small>From</small><strong>{source?.title ?? "Unknown artifact"}</strong><span>{source?.kind}</span></article>
        <ArrowDown />
        <article><small>To</small><strong>{target?.title ?? "Unknown artifact"}</strong><span>{target?.kind}</span></article>
      </div>
      <p>{edge.kind === "next" ? "This relationship controls learner order." : blueprintRelationshipDescriptions[edge.kind]}</p>
      <div className={styles.blueprintActions}>
        <button disabled={disabled || edge.status === "proposed"} onClick={onChange} type="button"><Pencil />Change target</button>
        <button disabled={disabled || edge.status === "proposed"} onClick={onRemove} type="button"><Trash2 />Remove connection</button>
      </div>
      {edge.status === "proposed" ? <small className={styles.relationshipPendingNote}>Review this proposed connection before editing it.</small> : null}
    </aside>
  );
}

function useBlueprintFlow(
  blueprint: CourseBlueprint | null,
  evidence: BlueprintConceptEvidence[],
  mode: BlueprintMode,
  visibleNodeIds: Set<string> | null,
  selectedId: string | null,
  enabledRelationships: ReadonlySet<BlueprintEdgeKind>,
  respectSavedLayout = true,
  layoutVersion = 0,
  interaction?: {
    onStartRelationship: (node: BlueprintNode, side: BlueprintPortSide) => void;
    relationshipDraft: BlueprintRelationshipDraft | null;
  },
) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [edgePoints, setEdgePoints] = useState<Record<string, Array<{ x: number; y: number }> | null>>({});
  const [completedLayoutKey, setCompletedLayoutKey] = useState<string | null>(null);
  const visibleNodes = useMemo(
    () => blueprint?.nodes
      .filter((node) => !visibleNodeIds || visibleNodeIds.has(node.id))
      .sort((left, right) => blueprintNodeLayer(left.kind) - blueprintNodeLayer(right.kind)
        || compareBlueprintSequence(left, right)
        || left.title.localeCompare(right.title)) ?? [],
    [blueprint, visibleNodeIds],
  );
  const layoutEdges = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return blueprint?.edges.filter((edge) => visibleIds.has(edge.source_id) && visibleIds.has(edge.target_id)) ?? [];
  }, [blueprint, visibleNodes]);
  const renderedEdges = useMemo(
    () => visibleBlueprintEdges(layoutEdges, enabledRelationships, selectedId),
    [enabledRelationships, layoutEdges, selectedId],
  );
  const requestedLayoutKey = useMemo(
    () => `${layoutVersion}:${respectSavedLayout ? "saved" : "arranged"}:${visibleNodes.map((node) => node.id).sort().join(":")}:${layoutEdges.map((edge) => edge.id).sort().join(":")}`,
    [layoutEdges, layoutVersion, respectSavedLayout, visibleNodes],
  );

  useEffect(() => {
    if (!visibleNodes.length) {
      setPositions({});
      setEdgePoints({});
      setCompletedLayoutKey(requestedLayoutKey);
      return;
    }
    let cancelled = false;
    const elk = new ELK();
    const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
    const portId = (nodeId: string, handle: "flow-in" | "flow-out" | "relation-in" | "relation-out") => `${nodeId}:${handle}`;
    const normalizedEdges = layoutEdges.map((edge) => {
      const source = nodeById.get(edge.source_id);
      const target = nodeById.get(edge.target_id);
      const reversed = Boolean(
        source
        && target
        && blueprintNodeLayer(source.kind) > blueprintNodeLayer(target.kind),
      );
      const sourceId = reversed ? edge.target_id : edge.source_id;
      const targetId = reversed ? edge.source_id : edge.target_id;
      const relational = edge.kind === "requires" || edge.kind === "remediates_to" || edge.kind === "cites";
      return {
        edge,
        reversed,
        sourceId,
        sourcePort: portId(sourceId, relational ? "relation-out" : "flow-out"),
        targetId,
        targetPort: portId(targetId, relational ? "relation-in" : "flow-in"),
      };
    });
    void elk.layout({
      id: "blueprint",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "42",
        "elk.spacing.edgeEdge": "12",
        "elk.spacing.edgeNode": "18",
        "elk.layered.spacing.nodeNodeBetweenLayers": "70",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.favorStraightEdges": "true",
        "elk.layered.considerModelOrder.strategy": "PREFER_NODES",
        "elk.layered.thoroughness": "30",
      },
      children: visibleNodes.map((node) => ({
        id: node.id,
        ...blueprintNodeDimensions(node),
        layoutOptions: {
          "org.eclipse.elk.portConstraints": "FIXED_ORDER",
        },
        ports: [
          { id: portId(node.id, "flow-in"), layoutOptions: { "org.eclipse.elk.port.side": "NORTH" }, width: 7, height: 7 },
          { id: portId(node.id, "flow-out"), layoutOptions: { "org.eclipse.elk.port.side": "SOUTH" }, width: 7, height: 7 },
          { id: portId(node.id, "relation-in"), layoutOptions: { "org.eclipse.elk.port.side": "WEST" }, width: 7, height: 7 },
          { id: portId(node.id, "relation-out"), layoutOptions: { "org.eclipse.elk.port.side": "EAST" }, width: 7, height: 7 },
        ],
      })),
      edges: normalizedEdges.map(({ edge, sourcePort, targetPort }) => ({
        id: edge.id,
        sources: [sourcePort],
        targets: [targetPort],
      })),
    }).then((layout) => {
      if (cancelled) return;
      const hasSavedPositions = respectSavedLayout && visibleNodes.some((artifact) => {
        const saved = isRecord(artifact.metadata.layout) ? artifact.metadata.layout : null;
        return typeof saved?.x === "number" && typeof saved?.y === "number";
      });
      setPositions(Object.fromEntries((layout.children ?? []).map((node) => {
        const artifact = visibleNodes.find((item) => item.id === node.id);
        const saved = respectSavedLayout && artifact && isRecord(artifact.metadata.layout)
          ? artifact.metadata.layout
          : null;
        return [node.id, {
          x: typeof saved?.x === "number" ? saved.x : node.x ?? 0,
          y: typeof saved?.y === "number" ? saved.y : node.y ?? 0,
        }];
      })));
      setEdgePoints(Object.fromEntries((layout.edges ?? []).map((edge) => {
        const laidOutEdge = edge as typeof edge & {
          sections?: Array<{
            bendPoints?: Array<{ x: number; y: number }>;
            endPoint?: { x: number; y: number };
            startPoint?: { x: number; y: number };
          }>;
        };
        const normalized = normalizedEdges.find((item) => item.edge.id === laidOutEdge.id);
        const section = laidOutEdge.sections?.[0];
        if (hasSavedPositions || normalized?.reversed || !section?.startPoint || !section.endPoint) {
          return [laidOutEdge.id, null];
        }
        return [
          laidOutEdge.id,
          [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ].map((point) => ({ x: point.x, y: point.y })),
        ];
      })));
      setCompletedLayoutKey(requestedLayoutKey);
    }).catch(() => {
      if (cancelled) return;
      setPositions((current) => Object.fromEntries(visibleNodes.map((node, index) => {
        const saved = respectSavedLayout && isRecord(node.metadata.layout)
          ? node.metadata.layout
          : null;
        return [node.id, {
          x: typeof saved?.x === "number" ? saved.x : current[node.id]?.x ?? (index % 4) * 300,
          y: typeof saved?.y === "number" ? saved.y : current[node.id]?.y ?? Math.floor(index / 4) * 190,
        }];
      })));
      setEdgePoints({});
      setCompletedLayoutKey(requestedLayoutKey);
    });
    return () => { cancelled = true; };
  }, [layoutEdges, requestedLayoutKey, respectSavedLayout, visibleNodes]);

  const layoutReady = completedLayoutKey === requestedLayoutKey;
  const evidenceByConcept = new Map(evidence.map((item) => [item.concept_id, item]));
  const selectedNeighbors = selectedId
    ? new Set(layoutEdges.flatMap((edge) => {
      if (edge.source_id === selectedId) return [edge.target_id];
      if (edge.target_id === selectedId) return [edge.source_id];
      return [];
    }))
    : new Set<string>();
  const topicConceptCounts = new Map<string, number>();
  layoutEdges.forEach((edge) => {
    if (edge.kind === "contains") {
      topicConceptCounts.set(edge.source_id, (topicConceptCounts.get(edge.source_id) ?? 0) + 1);
    }
  });
  const nodes: BlueprintGraphNode[] = visibleNodes.map((node, index) => {
    const conceptEvidence = evidenceByConcept.get(node.id) ?? null;
    const risk = conceptEvidence?.correct_percent == null ? null : 100 - conceptEvidence.correct_percent;
    const selected = selectedId === node.id;
    const muted = Boolean(selectedId && !selected && !selectedNeighbors.has(node.id));
    const dimensions = blueprintNodeDimensions(node);
    return {
      id: node.id,
      type: "blueprintArtifact",
      position: positions[node.id] ?? {
        x: (index % 4) * 300,
        y: Math.floor(index / 4) * 190,
      },
      data: {
        artifact: node,
        conceptCount: node.kind === "topic" ? topicConceptCounts.get(node.id) ?? 0 : null,
        designMode: mode === "design",
        evidence: conceptEvidence,
        muted,
        onStartRelationship: interaction?.onStartRelationship,
        relationshipTargetState: interaction?.relationshipDraft?.kind
          ? isValidBlueprintRelationshipTarget(
            interaction.relationshipDraft.source,
            node,
            interaction.relationshipDraft.kind,
          )
            ? "valid"
            : "invalid"
          : null,
        risk,
        selected,
      },
      ariaLabel: `${node.kind}: ${node.title}. ${node.status}. ${node.kind === "concept" && conceptEvidence?.attempts ? `${Math.round(conceptEvidence.correct_percent ?? 0)} percent correct.` : coverageLabel(node)}`,
      connectable: false,
      style: dimensions,
    };
  });
  const relationColor: Record<BlueprintEdgeKind, string> = {
    contains: "#aaa69d",
    next: "#292a2f",
    requires: "#68656d",
    teaches: "#55768f",
    assesses: "#b96a26",
    remediates_to: "#a45652",
    cites: "#858179",
  };
  const relationHandles = (kind: BlueprintEdgeKind) => {
    const relational = kind === "requires" || kind === "remediates_to" || kind === "cites";
    return relational
      ? { sourceHandle: "relation-out", targetHandle: "relation-in" }
      : { sourceHandle: "flow-out", targetHandle: "flow-in" };
  };
  const visibleEdgeIds = new Set(renderedEdges.map((edge) => edge.id));
  const edges: BlueprintGraphEdge[] = layoutEdges.map((edge) => {
    const visible = visibleEdgeIds.has(edge.id);
    const emphasized = Boolean(selectedId && (edge.source_id === selectedId || edge.target_id === selectedId));
    const dimmed = Boolean(selectedId && !emphasized);
    const color = edge.status === "proposed" ? "#d77a25" : relationColor[edge.kind];
    return {
      id: edge.id,
      source: edge.source_id,
      target: edge.target_id,
      type: "blueprintRelation",
      ...relationHandles(edge.kind),
      ariaLabel: `${blueprintRelationshipLabels[edge.kind]} relationship`,
      data: {
        emphasized,
        kind: edge.kind,
        points: edgePoints[edge.id] ?? null,
        visible,
      },
      focusable: visible,
      markerEnd: !visible || edge.kind === "contains" || edge.kind === "cites"
        ? undefined
        : { type: MarkerType.ArrowClosed, color },
      animated: edge.kind === "remediates_to",
      style: {
        opacity: !visible ? 0 : dimmed ? 0.16 : emphasized ? 1 : 0.62,
        pointerEvents: visible ? "auto" : "none",
        stroke: color,
        strokeDasharray: edge.status === "proposed" || edge.kind === "cites" ? "6 5" : undefined,
        strokeWidth: emphasized ? 2.2 : edge.kind === "next" ? 1.8 : 1.35,
      },
    };
  });
  const setPosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setPositions((current) => ({ ...current, [id]: position }));
    },
    [],
  );
  return {
    nodes,
    edges,
    layoutKey: completedLayoutKey,
    layoutReady,
    setPosition,
  };
}

function ConceptEvidencePanel({ evidence }: { evidence: BlueprintConceptEvidence | null }) {
  if (!evidence?.attempts) return <div className={styles.blueprintEmptyEvidence}><Activity /><p><strong>No learner evidence yet</strong>Course Director is monitoring this concept. Structure and coverage checks remain available.</p></div>;
  const masteryTotal = Object.values(evidence.mastery).reduce((total, value) => total + value, 0);
  return <section className={styles.conceptEvidence}><h4>Learning evidence</h4><div><article><strong>{Math.round(evidence.correct_percent ?? 0)}%</strong><span>Correct</span></article><article><strong>{Math.round(evidence.confident_percent ?? 0)}%</strong><span>Confident</span></article><article data-alert={evidence.confident_incorrect > 0}><strong>{evidence.confident_incorrect}</strong><span>Confident + incorrect</span></article></div><dl><div><dt>Learners reached</dt><dd>{evidence.touched_learners}</dd></div><div><dt>Mastered</dt><dd>{evidence.mastery.mastered ?? 0}/{masteryTotal}</dd></div><div><dt>Remediation routes</dt><dd>{evidence.route_actions.remediate ?? 0}</dd></div></dl></section>;
}

function ConceptInspectorEditor({ disabled, node, onSave }: { disabled: boolean; node: BlueprintNode; onSave: (node: BlueprintNode, name: string, description: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.title);
  const [description, setDescription] = useState(String(node.metadata.description ?? ""));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(node.title); setDescription(String(node.metadata.description ?? "")); setEditing(false); }, [node]);
  if (!editing) return <button className={styles.inspectorEditButton} disabled={disabled} onClick={() => setEditing(true)} type="button"><Pencil />Edit concept fields</button>;
  return <form className={styles.inspectorEditor} onSubmit={(event) => { event.preventDefault(); setSaving(true); void onSave(node, name, description).then(() => setEditing(false)).finally(() => setSaving(false)); }}><label>Name<input disabled={saving} onChange={(event) => setName(event.target.value)} required value={name} /></label><label>Description<textarea disabled={saving} onChange={(event) => setDescription(event.target.value)} rows={4} value={description} /></label><div><button disabled={saving} onClick={() => setEditing(false)} type="button">Cancel</button><button disabled={saving || !name.trim()} type="submit">{saving ? <LoaderCircle className={styles.spin} /> : <Check />}Save private edit</button></div></form>;
}

type BlueprintTopicDraft = {
  title: string;
  summary: string;
  start_seconds: number;
  end_seconds: number;
};

function TopicInspectorEditor({
  disabled,
  node,
  onSave,
}: {
  disabled: boolean;
  node: BlueprintNode;
  onSave: (node: BlueprintNode, draft: BlueprintTopicDraft) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(String(node.metadata.summary ?? ""));
  const [start, setStart] = useState(Number(node.metadata.start_seconds ?? 0));
  const [end, setEnd] = useState(Number(node.metadata.end_seconds ?? 1));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(node.title);
    setSummary(String(node.metadata.summary ?? ""));
    setStart(Number(node.metadata.start_seconds ?? 0));
    setEnd(Number(node.metadata.end_seconds ?? 1));
    setEditing(false);
  }, [node]);
  if (!editing) {
    return (
      <button
        className={styles.inspectorEditButton}
        disabled={disabled}
        onClick={() => setEditing(true)}
        type="button"
      >
        <Pencil />Edit topic and lecture range
      </button>
    );
  }
  return (
    <form
      className={styles.inspectorEditor}
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave(node, {
          title,
          summary,
          start_seconds: start,
          end_seconds: end,
        }).then(() => setEditing(false)).finally(() => setSaving(false));
      }}
    >
      <label>Title<input disabled={saving} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
      <label>Summary<textarea disabled={saving} onChange={(event) => setSummary(event.target.value)} rows={4} value={summary} /></label>
      <div className={styles.inspectorTimeFields}>
        <label>Starts at<input disabled={saving} min={0} onChange={(event) => setStart(Number(event.target.value))} step="0.1" type="number" value={start} /></label>
        <label>Ends at<input disabled={saving} min={0.1} onChange={(event) => setEnd(Number(event.target.value))} step="0.1" type="number" value={end} /></label>
      </div>
      <div><button disabled={saving} onClick={() => setEditing(false)} type="button">Cancel</button><button disabled={saving || !title.trim() || end <= start} type="submit">{saving ? <LoaderCircle className={styles.spin} /> : <Check />}Save private edit</button></div>
    </form>
  );
}

function BlueprintAddTopicDialog({
  disabled,
  onClose,
  onSave,
  topics,
}: {
  disabled: boolean;
  onClose: () => void;
  onSave: (draft: BlueprintTopicDraft) => Promise<void>;
  topics: BlueprintNode[];
}) {
  const latestEnd = Math.max(0, ...topics.map((topic) => Number(topic.metadata.end_seconds ?? 0)));
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [start, setStart] = useState(latestEnd);
  const [end, setEnd] = useState(latestEnd + 60);
  const [saving, setSaving] = useState(false);
  return (
    <div className={styles.blueprintDialogOverlay} onClick={onClose} role="presentation">
      <form
        aria-labelledby="add-topic-title"
        aria-modal="true"
        className={styles.blueprintDialog}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void onSave({
            title,
            summary,
            start_seconds: start,
            end_seconds: end,
          }).finally(() => setSaving(false));
        }}
        role="dialog"
      >
        <header><div><small>Add artifact</small><h3 id="add-topic-title">New topic</h3><p>Define a meaningful section of the lecture. This stays in the private revision.</p></div><button aria-label="Close" onClick={onClose} type="button"><X /></button></header>
        <label>Topic title<input autoFocus disabled={saving} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Why deliberate practice works" required value={title} /></label>
        <label>Teaching summary<textarea disabled={saving} onChange={(event) => setSummary(event.target.value)} placeholder="What should learners understand from this section?" rows={4} value={summary} /></label>
        <div className={styles.blueprintDialogFields}><label>Starts at (seconds)<input disabled={saving} min={0} onChange={(event) => setStart(Number(event.target.value))} step="0.1" type="number" value={start} /></label><label>Ends at (seconds)<input disabled={saving} min={0.1} onChange={(event) => setEnd(Number(event.target.value))} step="0.1" type="number" value={end} /></label></div>
        <footer><button disabled={saving} onClick={onClose} type="button">Cancel</button><button disabled={disabled || saving || !title.trim() || end <= start} type="submit">{saving ? <LoaderCircle className={styles.spin} /> : <Plus />}Add topic</button></footer>
      </form>
    </div>
  );
}

function BlueprintAddConceptDialog({
  concepts,
  disabled,
  initialTopicLogicalId,
  onClose,
  onSave,
  topics,
}: {
  concepts: BlueprintNode[];
  disabled: boolean;
  initialTopicLogicalId: string | null;
  onClose: () => void;
  onSave: (draft: {
    name: string;
    description: string;
    topic_logical_ids: string[];
    sequence_after_id: string | null;
  }) => Promise<void>;
  topics: BlueprintNode[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [topicIds, setTopicIds] = useState<string[]>(
    initialTopicLogicalId ? [initialTopicLogicalId] : topics[0] ? [topics[0].logical_id] : [],
  );
  const [afterId, setAfterId] = useState<string>(concepts.at(-1)?.logical_id ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <div className={styles.blueprintDialogOverlay} onClick={onClose} role="presentation">
      <form
        aria-labelledby="add-concept-title"
        aria-modal="true"
        className={styles.blueprintDialog}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void onSave({
            name,
            description,
            topic_logical_ids: topicIds,
            sequence_after_id: afterId || null,
          }).finally(() => setSaving(false));
        }}
        role="dialog"
      >
        <header><div><small>Add artifact</small><h3 id="add-concept-title">New concept</h3><p>Place the idea in its teaching context and learner sequence.</p></div><button aria-label="Close" onClick={onClose} type="button"><X /></button></header>
        <label>Concept name<input autoFocus disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="A capability learners should gain" required value={name} /></label>
        <label>Description<textarea disabled={saving} onChange={(event) => setDescription(event.target.value)} placeholder="Define what mastery of this concept means." rows={4} value={description} /></label>
        <fieldset><legend>Appears in topic</legend>{topics.map((topic) => <label key={topic.id}><input checked={topicIds.includes(topic.logical_id)} disabled={saving} onChange={(event) => setTopicIds((current) => event.target.checked ? [...current, topic.logical_id] : current.filter((id) => id !== topic.logical_id))} type="checkbox" />{topic.title}</label>)}</fieldset>
        <label>Place after<select disabled={saving} onChange={(event) => setAfterId(event.target.value)} value={afterId}><option value="">At the beginning</option>{concepts.map((concept) => <option key={concept.id} value={concept.logical_id}>{concept.title}</option>)}</select></label>
        <footer><button disabled={saving} onClick={onClose} type="button">Cancel</button><button disabled={disabled || saving || !name.trim() || !topicIds.length} type="submit">{saving ? <LoaderCircle className={styles.spin} /> : <Plus />}Add concept</button></footer>
      </form>
    </div>
  );
}

function LearningOrderDialog({
  concepts,
  disabled,
  onClose,
  onSave,
}: {
  concepts: BlueprintNode[];
  disabled: boolean;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [ordered, setOrdered] = useState(concepts);
  const [saving, setSaving] = useState(false);
  function move(index: number, offset: number) {
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    setOrdered(next);
  }
  return (
    <div className={styles.blueprintDialogOverlay} onClick={onClose} role="presentation">
      <section aria-labelledby="learning-order-title" aria-modal="true" className={`${styles.blueprintDialog} ${styles.learningOrderDialog}`} onClick={(event) => event.stopPropagation()} role="dialog">
        <header><div><small>Learner path</small><h3 id="learning-order-title">Learning order</h3><p>Reorder concepts independently from their visual canvas positions.</p></div><button aria-label="Close" onClick={onClose} type="button"><X /></button></header>
        <ol>{ordered.map((concept, index) => <li key={concept.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{concept.title}</strong><div><button aria-label={`Move ${concept.title} earlier`} disabled={index === 0 || saving} onClick={() => move(index, -1)} type="button"><ArrowUp /></button><button aria-label={`Move ${concept.title} later`} disabled={index === ordered.length - 1 || saving} onClick={() => move(index, 1)} type="button"><ArrowDown /></button></div></li>)}</ol>
        <footer><button disabled={saving} onClick={onClose} type="button">Cancel</button><button disabled={disabled || saving} onClick={() => { setSaving(true); void onSave(ordered.map((concept) => concept.logical_id)).finally(() => setSaving(false)); }} type="button">{saving ? <LoaderCircle className={styles.spin} /> : <Check />}Save learning order</button></footer>
      </section>
    </div>
  );
}

function BlueprintRemovalDialog({
  disabled,
  impact,
  loading,
  node,
  onClose,
  onConfirm,
}: {
  disabled: boolean;
  impact: BlueprintMutationImpact | null;
  loading: boolean;
  node: BlueprintNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const affected = impact ? [
    ["Topics", impact.affected_topics.length],
    ["Concepts", impact.affected_concepts.length],
    ["Clips", impact.affected_clips.length],
    ["Questions", impact.affected_questions.length],
    ["Relationships", impact.affected_relationships],
  ].filter(([, count]) => Number(count) > 0) : [];
  return (
    <div className={styles.blueprintDialogOverlay} onClick={onClose} role="presentation">
      <section aria-labelledby="remove-artifact-title" aria-modal="true" className={`${styles.blueprintDialog} ${styles.blueprintRemovalDialog}`} onClick={(event) => event.stopPropagation()} role="dialog">
        <header><div><small>Impact check</small><h3 id="remove-artifact-title">Remove “{node.title}”?</h3><p>This changes only the private revision. Published learners keep their current course until you publish.</p></div><button aria-label="Close" onClick={onClose} type="button"><X /></button></header>
        {loading ? <div className={styles.blueprintImpactLoading}><LoaderCircle className={styles.spin} />Tracing connected artifacts…</div> : (
          <>
            <div className={styles.blueprintImpactGrid}>{affected.length ? affected.map(([label, count]) => <article key={String(label)}><strong>{count}</strong><span>{label}</span></article>) : <p>No dependent course artifacts will be removed.</p>}</div>
            {impact?.warnings.map((warning) => <p className={styles.blueprintImpactWarning} key={warning}><CircleAlert />{warning}</p>)}
            <p className={styles.blueprintLearnerSafety}><Check />Learner history and evidence records are preserved.</p>
          </>
        )}
        <footer><button onClick={onClose} type="button">Keep artifact</button><button className={styles.destructiveButton} disabled={disabled || loading || !impact} onClick={onConfirm} type="button"><Trash2 />Remove from private revision</button></footer>
      </section>
    </div>
  );
}

function ArtifactCoveragePanel({
  clip,
  node,
  neighbors,
}: {
  clip: AssessmentWorkspace["clips"][number] | null;
  node: BlueprintNode;
  neighbors: BlueprintNode[];
}) {
  const grouped = neighbors.reduce<Record<string, number>>((result, item) => ({ ...result, [item.kind]: (result[item.kind] ?? 0) + 1 }), {});
  return (
    <section className={styles.artifactCoverage}>
      {node.kind === "clip" ? (
        <div className={styles.blueprintClipPlayer}>
          <div>
            <span><Play />Teaching moment</span>
            <strong>{clip ? clipTimeRange(clip) : "Preview unavailable"}</strong>
          </div>
          {clip ? <ClipPlayer clip={clip} /> : <p>This clip is not available in the currently loaded revision.</p>}
        </div>
      ) : null}
      <h4>Connected system</h4>
      <p>{String(node.metadata.description ?? node.metadata.summary ?? "This artifact participates in the adaptive learning path.")}</p>
      <dl>{Object.entries(grouped).map(([kind, count]) => <div key={kind}><dt>{kind}</dt><dd>{count}</dd></div>)}</dl>
    </section>
  );
}

function SequenceControls({ concepts, disabled, onChange, selected }: { concepts: BlueprintNode[]; disabled: boolean; onChange: (ids: string[]) => Promise<void>; selected: BlueprintNode }) {
  const index = concepts.findIndex((concept) => concept.id === selected.id);
  function move(offset: number) {
    const next = [...concepts];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    void onChange(next.map((concept) => concept.logical_id));
  }
  return <section className={styles.sequenceControl}><div><small>Learner sequence</small><strong>Step {index + 1} of {concepts.length}</strong></div><div><button aria-label="Move concept earlier" disabled={disabled || index <= 0} onClick={() => move(-1)} type="button"><ArrowUp /></button><button aria-label="Move concept later" disabled={disabled || index < 0 || index >= concepts.length - 1} onClick={() => move(1)} type="button"><ArrowUp /></button></div></section>;
}

function LearnerJourneyPreview({
  blueprint,
  evidence,
  onClose,
  onInspect,
}: {
  blueprint: CourseBlueprint | null;
  evidence: BlueprintConceptEvidence[];
  onClose: () => void;
  onInspect: (logicalId: string) => void;
}) {
  const concepts = blueprint?.nodes
    .filter((node) => node.kind === "concept")
    .sort(compareBlueprintSequence) ?? [];
  const states = concepts.map((concept) => ({
    concept,
    state: masteryStateForConcept(concept.id, evidence),
  }));
  const unresolvedIndex = states.findIndex((item) => item.state !== "mastered");
  const currentIndex = unresolvedIndex >= 0
    ? unresolvedIndex
    : states.length > 0
      ? states.length - 1
      : -1;
  const masteredCount = states.filter((item) => item.state === "mastered").length;
  const strugglingCount = states.filter((item) => item.state === "struggling").length;
  const current = states[currentIndex] ?? null;

  function artifactCount(concept: BlueprintNode, kind: "clip" | "question") {
    if (!blueprint) return 0;
    const nodeKinds = new Map(blueprint.nodes.map((node) => [node.id, node.kind]));
    return blueprint.edges.filter((edge) => {
      if (edge.source_id === concept.id) return nodeKinds.get(edge.target_id) === kind;
      if (edge.target_id === concept.id) return nodeKinds.get(edge.source_id) === kind;
      return false;
    }).length;
  }

  return (
    <div className={styles.blueprintPlacementOverlay} onClick={onClose} role="presentation">
      <section aria-labelledby="learner-journey-title" aria-modal="true" className={`${styles.blueprintActionDialog} ${styles.learnerJourneyDialog}`} onClick={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><span><Eye /></span><div><small>Cohort evidence preview</small><h3 id="learner-journey-title">Learner journey</h3><p>See the reviewed sequence as learners experience it, with current mastery and routing evidence overlaid.</p></div></div>
          <button aria-label="Close learner journey preview" onClick={onClose} type="button"><X /></button>
        </header>
        <div className={styles.journeySummary}>
          <article><strong>{masteredCount}/{states.length}</strong><span>Concepts mastered</span></article>
          <article data-tone={strugglingCount ? "attention" : undefined}><strong>{strugglingCount}</strong><span>Need remediation</span></article>
          <article><strong>{current ? currentIndex + 1 : "—"}</strong><span>Suggested current step</span></article>
        </div>
        {current ? (
          <div className={styles.currentJourneyStep}>
            <small>Current learning decision</small>
            <strong>{current.concept.title}</strong>
            <p>{journeyDecisionExplanation(current.state)}</p>
          </div>
        ) : null}
        <ol className={styles.journeySteps}>
          {states.map(({ concept, state }, index) => {
            const record = evidence.find((item) => item.concept_id === concept.id);
            const clipCount = artifactCount(concept, "clip");
            const questionCount = artifactCount(concept, "question");
            return (
              <li data-current={index === currentIndex || undefined} data-state={state} key={concept.id}>
                <i>{state === "mastered" ? <Check /> : index + 1}</i>
                <div>
                  <span>{journeyStateLabel(state)}{index === currentIndex ? " · Current" : ""}</span>
                  <strong>{concept.title}</strong>
                  <p>{clipCount} {clipCount === 1 ? "clip" : "clips"} · {questionCount} {questionCount === 1 ? "check" : "checks"}{record?.attempts ? ` · ${Math.round(record.correct_percent ?? 0)}% correct` : " · Awaiting evidence"}</p>
                </div>
                <button onClick={() => onInspect(concept.logical_id)} type="button">Inspect</button>
              </li>
            );
          })}
        </ol>
        <footer><p>This preview uses current cohort evidence. The published learner course remains unchanged.</p><button onClick={onClose} type="button">Close preview</button></footer>
      </section>
    </div>
  );
}

function journeyStateLabel(state: ReturnType<typeof masteryStateForConcept>) {
  if (state === "not_started") return "Not started";
  if (state === "mastered") return "Mastered";
  if (state === "struggling") return "Needs support";
  return "Practiced";
}

function journeyDecisionExplanation(state: ReturnType<typeof masteryStateForConcept>) {
  if (state === "struggling") return "Route through the reviewed remediation activity before the next checkpoint.";
  if (state === "practiced") return "Reinforce this concept, then use the next reviewed checkpoint to confirm mastery.";
  if (state === "mastered") return "This concept is mastered; continue to the next prerequisite-eligible step.";
  return "Begin with the reviewed teaching artifact, then collect confidence and correctness evidence.";
}

function RevisionReviewDialog({
  active,
  diff,
  onClose,
  working,
}: {
  active: CourseBlueprint | null;
  diff: RevisionDiff;
  onClose: () => void;
  working: CourseBlueprint | null;
}) {
  const counts = diff.changes.reduce(
    (result, change) => ({ ...result, [change.change_type]: result[change.change_type] + 1 }),
    { added: 0, changed: 0, removed: 0 },
  );
  return (
    <div className={styles.blueprintPlacementOverlay} onClick={onClose} role="presentation">
      <section aria-labelledby="revision-review-title" aria-modal="true" className={`${styles.blueprintActionDialog} ${styles.revisionReviewDialog}`} onClick={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><span><FilePenLine /></span><div><small>Private working revision</small><h3 id="revision-review-title">Review changes</h3><p>Compare the live course with the private workspace before publishing any update.</p></div></div>
          <button aria-label="Close revision review" onClick={onClose} type="button"><X /></button>
        </header>
        <div className={styles.revisionReviewSummary}>
          <article><strong>{diff.changes.length}</strong><span>Total changes</span></article>
          <article><strong>{counts.added}</strong><span>Added</span></article>
          <article><strong>{counts.changed}</strong><span>Changed</span></article>
          <article><strong>{counts.removed}</strong><span>Removed</span></article>
        </div>
        <div className={styles.revisionComparisonHeader}>
          <span>{active?.nodes.length ?? 0} live artifacts</span>
          <i>→</i>
          <span>{working?.nodes.length ?? active?.nodes.length ?? 0} private artifacts</span>
        </div>
        <div className={styles.revisionChangeList}>
          {diff.changes.map((change) => (
            <article data-change={change.change_type} key={`${change.artifact_type}:${change.logical_artifact_id}`}>
              <header><div><small>{change.artifact_type.replaceAll("_", " ")}</small><strong>{revisionArtifactTitle(change.after_state ?? change.before_state)}</strong></div><span>{change.change_type}</span></header>
              <div>
                <section><small>Live</small><p>{revisionStateSummary(change.before_state)}</p></section>
                <i>→</i>
                <section><small>Private revision</small><p>{revisionStateSummary(change.after_state)}</p></section>
              </div>
            </article>
          ))}
        </div>
        <footer><p>AI-authored artifacts still require their individual Accept / Edit / Dismiss decisions. Publishing remains a separate action.</p><button onClick={onClose} type="button">Done reviewing</button></footer>
      </section>
    </div>
  );
}

function revisionArtifactTitle(state: Record<string, unknown> | null) {
  if (!state) return "Removed artifact";
  const candidate = state.title ?? state.name ?? state.body ?? state.label;
  return typeof candidate === "string" && candidate.trim() ? candidate : "Course artifact";
}

function revisionStateSummary(state: Record<string, unknown> | null) {
  if (!state) return "Not present";
  const candidate = state.description
    ?? state.summary
    ?? state.body
    ?? state.title
    ?? state.name
    ?? state.status;
  if (typeof candidate === "string" && candidate.trim()) return candidate;
  const changedFields = Object.keys(state).filter((key) => !["id", "logical_id", "revision_id"].includes(key));
  return changedFields.length ? `${changedFields.slice(0, 3).join(", ")} updated` : "Metadata updated";
}

function ProposalPack({ load, onResolve, task }: { load: (taskId: string) => Promise<AgentTaskPack>; onResolve: (proposal: AgentTaskProposal, decision: Decision, revision?: Record<string, unknown>) => Promise<void>; task: CourseAgentTask }) {
  const [pack, setPack] = useState<AgentTaskPack | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    if (task.status !== "waiting_review") return;
    setLoadingPack(true);
    void loadRef.current(task.id).then(setPack).finally(() => setLoadingPack(false));
  }, [task.id, task.status]);
  const resolvePackItem = useCallback(async (
    proposal: AgentTaskProposal,
    decision: Decision,
    revision?: Record<string, unknown>,
  ) => {
    await onResolve(proposal, decision, revision);
    setPack((current) => current ? {
      ...current,
      proposals: current.proposals.map((item) => item.id === proposal.id
        ? { ...item, status: decision }
        : item),
    } : current);
  }, [onResolve]);
  if (["queued", "running"].includes(task.status)) return <div className={styles.proposalPackStatus}><LoaderCircle className={styles.spin} /><p><strong>The course team is preparing a coordinated pack.</strong>Each artifact will arrive as its own Accept / Edit / Dismiss decision.</p></div>;
  if (loadingPack) return <div className={styles.proposalPackStatus}><LoaderCircle className={styles.spin} /><p>Loading private proposals…</p></div>;
  if (!pack?.proposals.length) return null;
  return <section className={styles.proposalPack}><header><span>Private proposal pack</span><strong>{pack.proposals.filter((proposal) => proposal.status === "proposed").length} decisions</strong></header>{pack.proposals.map((proposal) => <ProposalPackItem key={proposal.id} onResolve={resolvePackItem} proposal={proposal} />)}</section>;
}

function ProposalPackItem({ onResolve, proposal }: { onResolve: (proposal: AgentTaskProposal, decision: Decision, revision?: Record<string, unknown>) => Promise<void>; proposal: AgentTaskProposal }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(proposal.proposed_state, null, 2));
  const [error, setError] = useState<string | null>(null);
  return <article data-status={proposal.status}><div><small>{proposal.artifact_type ?? proposal.proposal_type}</small><strong>{proposal.rationale}</strong>{proposal.citations.length ? <span><FileText />{proposal.citations.length} cited source sections</span> : null}</div>{editing ? <textarea aria-label="Edit proposed artifact JSON" onChange={(event) => setDraft(event.target.value)} rows={7} value={draft} /> : <ProposalDiff after={proposal.proposed_state} before={proposal.before_state} />}{error ? <p role="alert">{error}</p> : null}{proposal.status === "proposed" ? <footer><button onClick={() => void onResolve(proposal, "dismissed")} type="button"><X />Dismiss</button><button onClick={() => setEditing((current) => !current)} type="button"><Pencil />Edit</button><button onClick={() => { if (!editing) { void onResolve(proposal, "accepted"); return; } try { void onResolve(proposal, "edited", JSON.parse(draft) as Record<string, unknown>); } catch { setError("Enter valid JSON before saving."); } }} type="button"><Check />{editing ? "Save edit" : "Accept"}</button></footer> : <em>{proposal.status}</em>}</article>;
}

function coverageLabel(node: BlueprintNode) {
  if (node.kind === "clip") return `${Math.round(Number(node.metadata.duration_seconds ?? 0) / 60)} min teaching moment`;
  if (node.kind === "question") return String(node.metadata.type ?? "assessment").replaceAll("_", " ");
  if (node.kind === "source") return String(node.metadata.source_type ?? "source").toUpperCase();
  return node.status;
}

function blueprintKindIcon(kind: BlueprintNode["kind"]) {
  if (kind === "topic") return <BookOpenCheck />;
  if (kind === "concept") return <BrainCircuit />;
  if (kind === "clip") return <FileVideo />;
  if (kind === "question") return <ClipboardCheck />;
  return <FileText />;
}

export function CourseMapCanvas({ courseMap, onLayout, run }: {
  courseMap: CourseMap | null;
  onLayout: (logicalId: string, x: number, y: number) => Promise<void>;
  run: GenerationRun | null;
}) {
  const [topicId, setTopicId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const graph = useMemo(() => mapToFlow(courseMap, topicId, artifactId), [artifactId, courseMap, topicId]);
  if (!courseMap?.nodes.length) {
    return (
      <div className={styles.canvasEmpty}>
        <span className={styles.mapConstellation}><i /><i /><i /><i /></span>
        <h2>{run ? generationPhaseLabel(run.phase) : "Your course will take shape here"}</h2>
        <p>Topics, concepts, prerequisites, assessments, and learning paths appear as Course Director builds them.</p>
      </div>
    );
  }
  const topics = courseMap.nodes.filter((node) => node.kind === "topic");
  const activeTopic = topics.find((topic) => topic.id === topicId) ?? null;
  const topicConcepts = courseMap.nodes.filter((node) => node.kind === "concept" && node.topic_id === topicId);
  const activeArtifact = courseMap.nodes.find((node) => node.id === artifactId) ?? null;
  function selectNode(nodeId: string) {
    const selected = courseMap?.nodes.find((node) => node.id === nodeId);
    if (!selected) return;
    if (selected.kind === "topic") {
      setTopicId(selected.id);
      setArtifactId(null);
      return;
    }
    setTopicId(selected.topic_id);
    setArtifactId(selected.id);
  }
  return (
    <div className={styles.mapCanvas}>
      <div className={styles.canvasIntro}>
        <div><h2>{activeArtifact?.title ?? activeTopic?.title ?? `${topics.length} topics · ${courseMap.nodes.filter((node) => node.kind === "concept").length} concepts`}</h2></div>
        <div className={styles.zoomTrail} aria-label="Course map zoom level">
          <button aria-current={!topicId ? "page" : undefined} onClick={() => { setTopicId(null); setArtifactId(null); }} type="button">Course</button>
          {activeTopic ? <><span>/</span><button aria-current={!artifactId ? "page" : undefined} onClick={() => setArtifactId(null)} type="button">Topic</button></> : null}
          {activeArtifact ? <><span>/</span><button aria-current="page" type="button">Artifact</button></> : null}
        </div>
      </div>
      <div className={styles.semanticMapBody}>
        <nav className={styles.mapOutline} aria-label="Accessible course map outline">
          <button aria-pressed={!topicId} onClick={() => { setTopicId(null); setArtifactId(null); }} type="button"><strong>Course overview</strong><small>{topics.length} topics</small></button>
          {topics.map((topic) => (
            <div key={topic.id}>
              <button aria-pressed={topic.id === topicId} onClick={() => selectNode(topic.id)} type="button"><strong>{topic.title}</strong><small>{topic.status}</small></button>
              {topic.id === topicId ? <div>{topicConcepts.map((concept) => <button aria-pressed={concept.id === artifactId} key={concept.id} onClick={() => selectNode(concept.id)} type="button">{concept.title}</button>)}</div> : null}
            </div>
          ))}
          {activeArtifact ? <aside><span>{activeArtifact.kind}</span><strong>{activeArtifact.title}</strong><p>{String(activeArtifact.metadata.description ?? activeArtifact.metadata.summary ?? "No description")}</p><small>{activeArtifact.status}</small></aside> : null}
        </nav>
        <div className={styles.flowSurface}>
          <ReactFlow edges={graph.edges} fitView fitViewOptions={{ padding: 0.25 }} nodes={graph.nodes} nodesConnectable={false} nodesDraggable onNodeClick={(_, node) => selectNode(node.id)} onNodeDragStop={(_, node) => {
            const artifact = courseMap.nodes.find((item) => item.id === node.id);
            if (artifact) void onLayout(artifact.logical_id, node.position.x, node.position.y);
          }} panOnScroll proOptions={{ hideAttribution: true }}>
            <Background color="#deddd7" gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

function ReviewCanvas({ bundles, onBundle, onItem }: { bundles: ReviewBundle[]; onBundle: (bundle: ReviewBundle) => void; onItem: (item: ReviewItem, decision: Decision, revision?: Record<string, unknown>) => void }) {
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [revision, setRevision] = useState("");
  const active = bundles.find((bundle) => bundle.id === activeBundleId) ?? bundles[0];
  if (!active) return <div className={styles.canvasEmpty}><ClipboardList /><h2>No review bundle yet</h2><p>Course Director will assemble a small set of high-leverage decisions after the full private draft is built.</p></div>;
  const pending = active.items.filter((item) => item.status === "pending");
  return (
    <div className={styles.reviewCanvas}>
      <div className={styles.reviewBundleNav}>
        {bundles.map((bundle, index) => (
          <button aria-pressed={bundle.id === active.id} key={bundle.id} onClick={() => setActiveBundleId(bundle.id)} type="button">
            <span>{index + 1}</span><div><strong>{bundle.title}</strong><small>{bundle.items.filter((item) => item.status === "pending").length} decisions</small></div>{bundle.status === "complete" ? <Check /> : <ChevronDown />}
          </button>
        ))}
      </div>
      <div className={styles.reviewWorkspace}>
        <header><div><h2>{active.title}</h2><p>{active.summary}</p></div>{pending.length ? <button onClick={() => onBundle(active)} type="button"><Check />Approve remaining {pending.length}</button> : <span><Check />Bundle complete</span>}</header>
        <div className={styles.reviewItems}>
          {active.items.map((item) => (
            <article data-status={item.status} key={item.id}>
              <div className={styles.reviewItemTop}><span>{artifactLabel(item.artifact_type)}</span>{item.risk_level === "high" ? <small><CircleAlert />High-impact decision</small> : null}</div>
              <h3>{evidenceTitle(item)}</h3>
              <EvidenceSummary item={item} />
              {editing?.id === item.id ? (
                <div className={styles.editReview}>
                  <label>Revise this artifact<textarea onChange={(event) => setRevision(event.target.value)} rows={7} value={revision} /></label>
                  <div><button onClick={() => { setEditing(null); setRevision(""); }} type="button">Cancel</button><button onClick={() => { const value = safeJson(revision); if (value) { void onItem(item, "edited", value); setEditing(null); } }} type="button"><Check />Save edit</button></div>
                </div>
              ) : item.status === "pending" ? (
                <div className={styles.reviewActions}>
                  <button onClick={() => void onItem(item, "accepted")} type="button"><Check />Accept</button>
                  <button onClick={() => { setEditing(item); setRevision(JSON.stringify(item.evidence, null, 2)); }} type="button"><Pencil />Edit</button>
                  <button onClick={() => void onItem(item, "dismissed")} type="button"><Trash2 />Dismiss</button>
                </div>
              ) : <strong className={styles.decisionSaved}><Check />{item.status}</strong>}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidenceSummary({ item }: { item: ReviewItem }) {
  const entries = Object.entries(item.evidence).filter(([key, value]) => key !== "ai_proposal" && value !== null && ["string", "number"].includes(typeof value)).slice(0, 4);
  return <dl>{entries.map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl>;
}

export function OverviewCanvas({
  agentTasks,
  course,
  courseMap,
  dashboard,
  onAskDirector,
  onPrepare,
  onResolveProposal,
  onSignal,
  onSources,
  revisionDiff,
  sources,
}: {
  agentTasks: CourseAgentTask[];
  course: CourseSummary | null;
  courseMap: CourseMap | null;
  dashboard: DashboardSummary | null;
  onAskDirector: (priority: CoursePriority) => void;
  onPrepare: (priority: CoursePriority) => Promise<void>;
  onResolveProposal: (
    task: CourseAgentTask,
    decision: Decision,
    instructorRevision?: Record<string, unknown>,
  ) => Promise<void>;
  revisionDiff: RevisionDiff | null;
  onSignal: (signalId: string, decision: Decision, note?: string) => Promise<void>;
  onSources: () => void;
  sources: CourseSource[];
}) {
  const [selectedPriorityId, setSelectedPriorityId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const answerOutcomes = answerOutcomeSummary(dashboard);
  const priorities = dashboard?.priorities ?? [];
  const selectedPriority = priorities.find((item) => item.id === selectedPriorityId)
    ?? priorities[0]
    ?? null;
  const selectedArtifactLogicalId = selectedTopicId
    ?? selectedPriority?.target_logical_artifact_id
    ?? null;
  const selectedArtifactNode = courseMap?.nodes.find((node) => (
    node.logical_id === selectedArtifactLogicalId
  ));
  const selectedTopicNode = selectedArtifactNode?.kind === "topic"
    ? selectedArtifactNode
    : courseMap?.nodes.find((node) => (
      node.kind === "topic" && node.id === selectedArtifactNode?.topic_id
    ));
  const selectedTopic = dashboard?.topic_health?.find((topic) => (
    topic.logical_id === selectedTopicId
    || topic.logical_id === selectedPriority?.target_logical_artifact_id
    || topic.logical_id === selectedTopicNode?.logical_id
  )) ?? null;
  const activeTasks = agentTasks.filter((task) => task.task_type !== "extract_source").slice(0, 8);
  const readySources = sources.filter((source) => source.extraction_status === "ready");
  return (
    <div className={styles.overviewCanvas}>
      <header className={styles.overviewHeader}>
        <div><h2>{course?.title}</h2><p>A live teaching brief: what learners need, what the course team is doing, and what still needs your judgment.</p></div>
        <button onClick={onSources} type="button"><FileText />Course sources<span>{readySources.length}/{sources.length} ready</span></button>
      </header>
      <section className={styles.overviewMetrics}>
        <article><small>Learners</small><strong>{dashboard?.learner_count ?? 0}</strong><p>Enrolled in this published revision</p></article>
        <article><small>Assessment attempts</small><strong>{dashboard?.attempt_count ?? 0}</strong><p>{dashboard?.learner_count ? `${(dashboard.attempt_count / dashboard.learner_count).toFixed(1)} per learner` : "Waiting for learner evidence"}</p></article>
        <article><small>Priority brief</small><strong>{priorities.length}</strong><p>Ranked from persisted learner and design evidence</p></article>
        <article><small>Course team</small><strong>{activeTasks.filter((task) => ["queued", "running", "waiting_review"].includes(task.status)).length}</strong><p>Specialist tasks active or awaiting review</p></article>
        <article><small>Unpublished changes</small><strong>{revisionDiff?.changes.length ?? 0}</strong><p>{revisionDiff ? "Visible in the private revision" : "Live course is unchanged"}</p></article>
      </section>
      {dashboard?.not_enough_data ? <div className={styles.evidenceNotice}><CircleAlert /><p><strong>Early evidence only.</strong> The charts stay honest and will fill in as learners complete assessments.</p></div> : null}

      <div className={styles.intelligenceGrid}>
        <section className={styles.priorityBrief} id="priority-brief">
          <header><div><h3>Priority brief</h3><p>Ranked issues that can change learning, not a generic notification feed.</p></div><span>{priorities.length} open</span></header>
          <div>
            {priorities.map((priority, index) => {
              const matchingTask = agentTasks.find((task) => (
                task.target_logical_artifact_id === priority.target_logical_artifact_id
                && task.task_type === "prepare_improvement"
              ));
              const specialistWorking = matchingTask
                && ["queued", "running"].includes(matchingTask.status);
              const proposalReady = matchingTask?.status === "waiting_review";
              return (
                <article aria-current={selectedPriority?.id === priority.id ? "true" : undefined} key={priority.id}>
                  <button className={styles.priorityEvidenceButton} onClick={() => {
                    setSelectedPriorityId(priority.id);
                    setSelectedTopicId(priority.target_logical_artifact_id);
                  }} type="button">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small><span>{specialistLabel(priority.specialist_role)}</span><span>{priority.severity} priority</span></small>
                      <h4>{priority.title}</h4><p>{priority.summary}</p>
                      <em>{priority.affected_learners ? `${priority.affected_learners} learners affected` : `${priority.evidence_count} design checks`}</em>
                    </div>
                    <BarChart3 />
                  </button>
                  <footer>
                    <button onClick={() => onAskDirector(priority)} type="button"><MessageCircleMore />Ask Director</button>
                    <button
                      disabled={!proposalReady && !canPrepareImprovement(priority, agentTasks)}
                      onClick={() => {
                        if (proposalReady) {
                          document.getElementById("course-team")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        } else {
                          void onPrepare(priority);
                        }
                      }}
                      type="button"
                    >
                      {specialistWorking ? <LoaderCircle className={styles.spin} /> : proposalReady ? <ClipboardCheck /> : <Wand2 />}
                      {specialistWorking ? "Specialist working" : proposalReady ? "Review proposal" : "Prepare improvement"}
                    </button>
                  </footer>
                </article>
              );
            })}
            {!priorities.length ? <div className={styles.inlineEmpty}><Check /><div><strong>No urgent course changes</strong><p>The team will surface a priority when evidence or course coverage crosses a meaningful threshold.</p></div></div> : null}
          </div>
        </section>

        <section className={styles.courseTeam} id="course-team">
          <header><div><h3>Your course team</h3><p>Specialists prepare private work. You decide what enters the course.</p></div><Network /></header>
          <div>
            {activeTasks.map((task) => (
              <article data-status={task.status} key={task.id}>
                <span>{specialistIcon(task.specialist_role)}</span>
                <div><strong>{specialistLabel(task.specialist_role)}</strong><p>{taskDescription(task)}</p><small>{taskStatusLabel(task.status)}</small></div>
                {task.status === "running" || task.status === "queued" ? <LoaderCircle className={styles.spin} /> : task.status === "failed" ? <CircleAlert /> : <Check />}
                {task.status === "waiting_review" ? <SpecialistProposalCard onResolve={onResolveProposal} task={task} /> : null}
              </article>
            ))}
            {!activeTasks.length ? <div className={styles.teamEmpty}><BrainCircuit /><p><strong>No specialist work is in progress.</strong> Choose Prepare improvement to create a private proposal. Nothing enters the live course until you accept or edit it.</p></div> : null}
          </div>
        </section>
      </div>

      <section className={styles.evidenceWorkspace} id="evidence-inspector">
        <header><div><h3>Evidence inspector</h3><p>Trace a recommendation to actual learner behavior and course coverage.</p></div><span>{selectedTopic ? selectedTopic.title : "Choose a priority or topic"}</span></header>
        <div>
          <article>
            <h4>{selectedPriority?.title ?? selectedTopic?.title ?? "No evidence selected"}</h4>
            <p>{selectedPriority?.summary ?? "Select a topic below to inspect its confidence, correctness, mastery, clips, and checks."}</p>
            {selectedPriority ? <dl>{visibleEvidence(selectedPriority.evidence).map(([key, value]) => <div key={key}><dt>{evidenceMetricLabel(key)}</dt><dd>{evidenceMetricValue(key, value)}</dd></div>)}</dl> : null}
            {selectedPriority?.id.startsWith("signal:") ? (
              <div className={styles.evidenceDecision}>
                <p><strong>This is a diagnosis, not a course change.</strong> Acknowledge removes it from your queue. Prepare improvement creates a separate private proposal for your review.</p>
                <div className={styles.evidenceDecisionActions}>
                  <button onClick={() => void onSignal(selectedPriority.id.slice(7), "accepted")} type="button"><Check />Acknowledge</button>
                  <button onClick={() => void onSignal(selectedPriority.id.slice(7), "dismissed")} type="button"><X />Dismiss</button>
                </div>
              </div>
            ) : null}
          </article>
          <article>
            {selectedTopic ? (
              <>
                <h4>{topicHealthLabel(selectedTopic)}</h4>
                <div className={styles.topicPulseBars}>
                  <HealthBar label="Correct" value={performancePercent(selectedTopic.correct_attempts, selectedTopic.attempts)} />
                  <HealthBar label="Confident" value={performancePercent(selectedTopic.confidence_3 + selectedTopic.confidence_4, selectedTopic.attempts)} />
                  <HealthBar label="Mastered" value={performancePercent(selectedTopic.mastered_learners, Math.max(1, dashboard?.learner_count ?? 0))} />
                </div>
                <p>{selectedTopic.active_clips} active clips · {selectedTopic.assessment_count} assessments · {selectedTopic.concept_count} concepts</p>
              </>
            ) : <div className={styles.inspectorEmpty}><Search /><p>No topic is selected yet.</p></div>}
          </article>
        </div>
      </section>

      <section className={styles.overviewMapSection}>
        <header><div><h3>Course structure × performance</h3><p>The live structure with learning risk overlaid. Open Course map for detailed editing.</p></div><span>{course?.topic_count ?? 0} topics · {course?.concept_count ?? 0} concepts</span></header>
        <OverviewCourseMap courseMap={courseMap} dashboard={dashboard} onSelect={setSelectedTopicId} selectedTopicId={selectedTopic?.logical_id ?? null} />
      </section>

      <section className={styles.topicHealthSection}>
        <header><div><h3>Topic health</h3><p>Compare correctness, confidence, mastery, remediation, and course coverage in one scan.</p></div><span>{dashboard?.topic_health?.length ?? 0} topics</span></header>
        <div className={styles.topicHealthTable}>
          <div aria-hidden="true"><span>Topic</span><span>Correct</span><span>Confidence</span><span>Struggling</span><span>Clips</span><span>Checks</span></div>
          {dashboard?.topic_health?.map((topic) => (
            <button aria-current={selectedTopic?.logical_id === topic.logical_id ? "true" : undefined} aria-label={`Inspect ${topic.title} topic evidence`} key={topic.logical_id} onClick={() => setSelectedTopicId(topic.logical_id)} type="button">
              <strong>{topic.title}</strong>
              <span>{performancePercent(topic.correct_attempts, topic.attempts)}%</span>
              <span>{performancePercent(topic.confidence_3 + topic.confidence_4, topic.attempts)}%</span>
              <span>{topic.struggling_learners}</span>
              <span>{topic.active_clips}</span>
              <span>{topic.assessment_count}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.learningHealth} aria-labelledby="learning-health-title" id="learning-patterns">
        <header><div><h3 id="learning-health-title">Learning patterns</h3><p>Supporting trends for the priorities above.</p></div><span>Last 14 days</span></header>
        <InsightsCharts
          activity={dashboard?.activity_history ?? []}
          answerOutcomes={answerOutcomes}
          conceptReach={dashboard?.concept_performance ?? []}
          learnerCount={dashboard?.learner_count ?? 0}
          mastery={dashboard?.mastery_distribution ?? { mastered: 0, practiced: 0, struggling: 0, not_started: 0 }}
          questionRisk={dashboard?.question_performance ?? []}
        />
      </section>
    </div>
  );
}

function SpecialistProposalCard({ task, onResolve }: {
  task: CourseAgentTask;
  onResolve: (task: CourseAgentTask, decision: Decision, revision?: Record<string, unknown>) => Promise<void>;
}) {
  const proposed = task.result?.proposed_state;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(proposed ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.specialistProposal}>
      <p>{String(task.result?.rationale ?? task.result?.summary ?? "A private change is ready for your review.")}</p>
      {editing ? <textarea aria-label="Edit specialist proposal JSON" onChange={(event) => setDraft(event.target.value)} rows={7} value={draft} /> : <ProposalDiff before={task.result?.before_state} after={proposed} />}
      {error ? <small>{error}</small> : null}
      <footer>
        <button onClick={() => void onResolve(task, "dismissed")} type="button"><X />Dismiss</button>
        <button onClick={() => { setEditing((current) => !current); setError(null); }} type="button"><Pencil />{editing ? "Cancel edit" : "Edit"}</button>
        <button onClick={() => {
          if (!editing) { void onResolve(task, "accepted"); return; }
          try {
            const parsed = JSON.parse(draft) as Record<string, unknown>;
            void onResolve(task, "edited", parsed);
          } catch { setError("Enter valid JSON before saving the edit."); }
        }} type="button"><Check />{editing ? "Save edit" : "Accept"}</button>
      </footer>
    </div>
  );
}

function ProposalDiff({ before, after }: { before: unknown; after: unknown }) {
  const previous = isRecord(before) ? before : {};
  const next = isRecord(after) ? after : {};
  const changed = Object.keys(next).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])).slice(0, 5);
  return <dl>{changed.map((key) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd><del>{shortValue(previous[key])}</del><ins>{shortValue(next[key])}</ins></dd></div>)}</dl>;
}

function OverviewCourseMap({ courseMap, dashboard, onSelect, selectedTopicId }: {
  courseMap: CourseMap | null;
  dashboard: DashboardSummary | null;
  onSelect: (logicalId: string) => void;
  selectedTopicId: string | null;
}) {
  const topics = courseMap?.nodes.filter((node) => node.kind === "topic" && node.status !== "dismissed") ?? [];
  const nodes: Node[] = topics.map((topic, index) => {
    const health = dashboard?.topic_health?.find((item) => item.logical_id === topic.logical_id);
    const risk = health && health.attempts ? 100 - performancePercent(health.correct_attempts, health.attempts) : 0;
    const stored = isRecord(topic.metadata.layout) ? topic.metadata.layout : null;
    return {
      id: topic.id,
      position: {
        x: typeof stored?.x === "number" ? stored.x : 40 + (index % 3) * 280,
        y: typeof stored?.y === "number" ? stored.y : 40 + Math.floor(index / 3) * 130,
      },
      data: { label: <div><small>{health?.attempts ?? 0} attempts · {health?.struggling_learners ?? 0} struggling</small><strong>{topic.title}</strong><span>{health?.attempts ? `${100 - risk}% correct` : "Awaiting learner evidence"}</span></div> },
      style: {
        background: selectedTopicId === topic.logical_id ? "#24252b" : risk >= 45 ? "#fff6eb" : "#fff",
        border: selectedTopicId === topic.logical_id ? "1px solid #24252b" : risk >= 45 ? "1px solid #e0aa72" : "1px solid #d8d5ce",
        borderRadius: 10,
        color: selectedTopicId === topic.logical_id ? "#fff" : "#24252b",
        padding: 14,
        width: 230,
      },
    };
  });
  if (!nodes.length) return <div className={styles.inlineEmpty}><Network /><div><strong>No reviewed course structure</strong><p>Topics will appear here when the course map is ready.</p></div></div>;
  return (
    <div className={styles.overviewMap}>
      <ReactFlow
        edges={[]}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        onNodeClick={(_, node) => {
          const topic = topics.find((item) => item.id === node.id);
          if (topic) onSelect(topic.logical_id);
        }}
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      ><Background color="#e6e2da" gap={20} size={1} /></ReactFlow>
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  return <div><span>{label}<strong>{value}%</strong></span><i><b style={{ width: `${value}%` }} /></i></div>;
}

function SourcesDrawer({ disabled, onClose, onRetry, onUpdate, onUpload, sources }: {
  disabled: boolean;
  onClose: () => void;
  onRetry: (source: CourseSource) => Promise<void>;
  onUpdate: (
    source: CourseSource,
    update: Partial<Pick<CourseSource, "purpose" | "review_status" | "learner_visible">>,
  ) => Promise<void>;
  onUpload: () => void;
  sources: CourseSource[];
}) {
  return (
    <aside className={styles.sourcesDrawer} aria-label="Course sources">
      <header><div><FileText /><span><h2>Sources &amp; materials</h2><small>Context for the team and reviewed resources for learners</small></span></div><button aria-label="Close course sources" onClick={onClose} type="button"><X /></button></header>
      <button className={styles.sourceUpload} disabled={disabled} onClick={onUpload} type="button"><Upload /><span><strong>Add PDF or PowerPoint</strong><small>Native text, speaker notes, and visual content are analyzed privately.</small></span></button>
      <div className={styles.sourceList}>
        {sources.map((source) => (
          <article key={source.id}>
            <header><span><FileText /></span><div><strong>{source.filename}</strong><small>{source.source_type.toUpperCase()} · {formatBytes(source.size_bytes)}</small></div><em data-status={source.extraction_status}>{source.extraction_status}</em></header>
            <label>Use this source for
              <select disabled={disabled} onChange={(event) => void onUpdate(source, { purpose: event.target.value as CourseSource["purpose"], learner_visible: event.target.value === "ai_context" ? false : source.learner_visible })} value={source.purpose}>
                <option value="ai_context">AI context only</option>
                <option value="learner_resource">Learner resource</option>
                <option value="both">AI context + learner resource</option>
              </select>
            </label>
            {source.purpose !== "ai_context" ? <label className={styles.sourceVisibility}><input checked={source.learner_visible} disabled={disabled || source.extraction_status !== "ready"} onChange={(event) => void onUpdate(source, { learner_visible: event.target.checked, review_status: event.target.checked ? "edited" : source.review_status })} type="checkbox" /><span>Make available to learners after publish</span></label> : null}
            <p>{source.extraction_status === "ready" ? `${source.section_count} cited ${source.source_type === "pptx" ? "slides" : "pages"} available to the course team.` : source.extraction_status === "failed" ? source.extraction_error : "The Curriculum Architect is extracting this source."}</p>
            <footer>
              {source.extraction_status === "failed" ? <button onClick={() => void onRetry(source)} type="button"><RotateCcw />Retry</button> : null}
              <button onClick={() => void onUpdate(source, { review_status: "dismissed", learner_visible: false })} type="button"><Trash2 />Remove</button>
            </footer>
          </article>
        ))}
        {!sources.length ? <div className={styles.teamEmpty}><BookOpenCheck /><p><strong>No supplemental sources yet.</strong> Add slides or a document to give the team more teaching context.</p></div> : null}
      </div>
      <footer><Check /><p>Sources are private by default. Learners only receive items you explicitly mark visible and then publish.</p></footer>
    </aside>
  );
}

function AssessmentsCanvas({ courseFlow, workspace, disabled, onSave, onRemove }: {
  courseFlow: CourseFlow | null;
  workspace: AssessmentWorkspace | null;
  disabled: boolean;
  onSave: (draft: AssessmentDraftPayload, question?: CourseAssessment) => Promise<void>;
  onRemove: (question: CourseAssessment) => Promise<void>;
}) {
  const [editing, setEditing] = useState<CourseAssessment | "new" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);
  if (!workspace) return <div className={styles.canvasEmpty}><LoaderCircle className={styles.spin} /><h2>Loading assessments</h2></div>;
  const questions = workspace.questions.filter((question) => question.review_status !== "dismissed");
  return (
    <div className={styles.structuredCanvas}>
      <header><div><h2>Assessments</h2><p>Every question in the current course revision, including its answer and remediation route.</p></div><div><button aria-expanded={editing === "new"} aria-controls="assessment-editor" disabled={disabled || !workspace.topics.length} onClick={() => setEditing("new")} type="button"><Plus />Add assessment</button></div></header>
      {courseFlow?.units.some((unit) => unit.kind !== "lecture") ? <section className={styles.courseUnitSummary}><small>Course-level units</small><div>{courseFlow.units.filter((unit) => unit.kind !== "lecture").map((unit) => <article key={unit.logical_id}><span>{unit.kind === "quiz" ? <ClipboardCheck /> : <FilePenLine />}</span><div><strong>{unit.title}</strong><p>{unit.kind === "quiz" ? `${unit.question_count} reviewed questions · ${unit.concept_count} concepts` : `${unit.concept_count} concepts · ${unit.source_count} resources`}</p></div><em>{unit.status}</em></article>)}</div></section> : null}
      {editing ? <div className={styles.editorReveal} id="assessment-editor" ref={editorRef}><AssessmentEditor key={editing === "new" ? "new" : editing.id} question={editing === "new" ? null : editing} workspace={workspace} onCancel={() => setEditing(null)} onSave={async (draft) => { await onSave(draft, editing === "new" ? undefined : editing); setEditing(null); }} /></div> : null}
      <div className={styles.assessmentList}>
        {questions.map((question, index) => {
          const previewClip = workspace.clips.find((clip) => (
            clip.id === previewClipId
            && question.remediation_rules.some((rule) => rule.target_clip_id === clip.id)
          ));
          return (
          <article key={question.id}>
            <div className={styles.assessmentIndex}>{String(index + 1).padStart(2, "0")}</div>
            <div className={styles.assessmentBody}>
              <div><span>{question.topic_title}</span><small>{question.type.replaceAll("_", " ")} · {question.review_status}</small></div>
              <h3>{question.body}</h3>
              <dl><div><dt>Correct answer</dt><dd>{answerLabel(question.correct_answer)}</dd></div><div><dt>Confidence check</dt><dd>{question.confidence_prompt}</dd></div></dl>
              <div className={styles.remediationRoutes}>
                <strong>Remediation routes</strong>
                {question.remediation_rules.map((rule) => {
                  const clip = workspace.clips.find((candidate) => candidate.id === rule.target_clip_id);
                  const concept = workspace.concepts.find((candidate) => candidate.id === rule.target_concept_id);
                  if (clip) {
                    const expanded = previewClipId === clip.id;
                    return (
                      <button
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Close" : "Preview"} remediation clip for ${rule.wrong_answer_pattern}`}
                        className={styles.routeChip}
                        key={rule.id ?? rule.wrong_answer_pattern}
                        onClick={() => setPreviewClipId(expanded ? null : clip.id)}
                        type="button"
                      >
                        <Play />
                        <span>{rule.wrong_answer_pattern}</span>
                        <small>Preview clip</small>
                      </button>
                    );
                  }
                  return (
                    <span className={styles.routeChip} key={rule.id ?? rule.wrong_answer_pattern}>
                      <span>{rule.wrong_answer_pattern}</span>
                      <small>{concept ? `Routes to ${concept.name}` : "Concept route"}</small>
                    </span>
                  );
                })}
              </div>
              {previewClip ? (
                <section className={styles.assessmentClipPreview}>
                  <header>
                    <div><strong>{previewClip.topic_title}</strong><span>{clipTimeRange(previewClip)}</span></div>
                    <button aria-label="Close remediation clip preview" onClick={() => setPreviewClipId(null)} type="button"><X /></button>
                  </header>
                  <ClipPlayer clip={previewClip} />
                </section>
              ) : null}
            </div>
            <div className={styles.assessmentActions}>
              <button aria-controls="assessment-editor" aria-expanded={editing !== "new" && editing?.id === question.id} aria-label={`Edit ${question.body}`} disabled={disabled} onClick={() => setEditing(question)} type="button"><Pencil /></button>
              {confirmRemove === question.id ? <div><span>Remove in private revision?</span><button onClick={() => setConfirmRemove(null)} type="button">Keep</button><button disabled={disabled} onClick={() => void onRemove(question).then(() => setConfirmRemove(null))} type="button">Remove</button></div> : <button aria-label={`Remove ${question.body}`} disabled={disabled} onClick={() => setConfirmRemove(question.id)} type="button"><Trash2 /></button>}
            </div>
          </article>
          );
        })}
        {!questions.length ? <div className={styles.inlineEmpty}><ClipboardCheck /><div><strong>No active assessments</strong><p>Add a teacher-authored check for understanding. It will stay private until the revision is published.</p></div></div> : null}
      </div>
    </div>
  );
}

function AssessmentEditor({ question, workspace, onCancel, onSave }: {
  question: CourseAssessment | null;
  workspace: AssessmentWorkspace;
  onCancel: () => void;
  onSave: (draft: AssessmentDraftPayload) => Promise<void>;
}) {
  const firstTopic = question?.topic_id ?? workspace.topics[0]?.id ?? "";
  const defaultTarget = workspace.concepts.find((concept) => concept.topic_ids.includes(firstTopic))?.id ?? workspace.concepts[0]?.id ?? "";
  const [topicId, setTopicId] = useState(firstTopic);
  const [primaryConceptId, setPrimaryConceptId] = useState(question?.primary_concept_id ?? defaultTarget);
  const [body, setBody] = useState(question?.body ?? "");
  const [type, setType] = useState<CourseAssessment["type"]>(question?.type ?? "short_answer");
  const [answer, setAnswer] = useState(JSON.stringify(question?.correct_answer ?? { answer: "" }, null, 2));
  const [confidencePrompt, setConfidencePrompt] = useState(question?.confidence_prompt ?? "How confident are you in your answer?");
  const [rules, setRules] = useState<Array<{ pattern: string; target: string }>>(
    question?.remediation_rules.map((rule) => ({
      pattern: rule.wrong_answer_pattern,
      target: rule.target_clip_id ? `clip:${rule.target_clip_id}` : `concept:${rule.target_concept_id ?? ""}`,
    })) ?? [{ pattern: "Needs another explanation", target: `concept:${defaultTarget}` }],
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = safeJson(answer);
    if (!parsed) { setFormError("Correct answer must be a valid JSON object."); return; }
    if (rules.some((rule) => !rule.pattern.trim() || !rule.target.split(":")[1])) { setFormError("Every remediation route needs a trigger and target."); return; }
    setSaving(true);
    setFormError(null);
    try {
      await onSave({
        topic_id: topicId,
        primary_concept_id: primaryConceptId,
        concept_ids: [primaryConceptId],
        body,
        type,
        correct_answer: parsed,
        confidence_prompt: confidencePrompt,
        remediation_rules: rules.map((rule) => ({
          wrong_answer_pattern: rule.pattern,
          target_clip_id: rule.target.startsWith("clip:") ? rule.target.slice(5) : null,
          target_concept_id: rule.target.startsWith("concept:") ? rule.target.slice(8) : null,
        })),
      });
    } catch { setSaving(false); }
  }
  return (
    <form className={styles.structuredEditor} onSubmit={submit}>
      <header><div><h3>{question ? "Edit assessment" : "Add assessment"}</h3></div><button aria-label="Close assessment editor" onClick={onCancel} type="button"><X /></button></header>
      <div className={styles.editorGrid}>
        <label>Topic<select onChange={(event) => { const nextTopicId = event.target.value; setTopicId(nextTopicId); setPrimaryConceptId(workspace.concepts.find((concept) => concept.topic_ids.includes(nextTopicId))?.id ?? ""); }} value={topicId}>{workspace.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
        <label>Assessed concept<select onChange={(event) => setPrimaryConceptId(event.target.value)} required value={primaryConceptId}>{workspace.concepts.filter((concept) => concept.topic_ids.includes(topicId)).map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></label>
        <label>Question type<select onChange={(event) => setType(event.target.value as CourseAssessment["type"])} value={type}><option value="mcq">Multiple choice</option><option value="short_answer">Short answer</option><option value="worked_problem">Worked problem</option></select></label>
        <label className={styles.editorWide}>Prompt<textarea onChange={(event) => setBody(event.target.value)} required rows={3} value={body} /></label>
        <label>Correct answer (JSON)<textarea className={styles.monoInput} onChange={(event) => setAnswer(event.target.value)} required rows={5} value={answer} /></label>
        <label>Confidence check<textarea onChange={(event) => setConfidencePrompt(event.target.value)} required rows={5} value={confidencePrompt} /></label>
      </div>
      <fieldset><legend>Remediation routes</legend>{rules.map((rule, index) => <div key={index}><input aria-label={`Trigger pattern ${index + 1}`} onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value } : item))} placeholder="When should this route apply?" value={rule.pattern} /><select aria-label={`Remediation target ${index + 1}`} onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} value={rule.target}><optgroup label="Concepts">{workspace.concepts.map((concept) => <option key={concept.id} value={`concept:${concept.id}`}>{concept.name}</option>)}</optgroup><optgroup label="Clips">{workspace.clips.map((clip) => <option key={clip.id} value={`clip:${clip.id}`}>{clip.label}</option>)}</optgroup></select>{rules.length > 1 ? <button aria-label={`Remove remediation route ${index + 1}`} onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><X /></button> : null}</div>)}<button onClick={() => setRules((current) => [...current, { pattern: "", target: `concept:${defaultTarget}` }])} type="button"><Plus />Add route</button></fieldset>
      {formError ? <p className={styles.formError}>{formError}</p> : null}
      <footer><p>Teacher-authored changes are marked edited and remain private until publish.</p><div><button onClick={onCancel} type="button">Cancel</button><button disabled={saving || !body.trim()} type="submit">{saving ? <LoaderCircle className={styles.spin} /> : <Check />}{question ? "Save assessment" : "Add assessment"}</button></div></footer>
    </form>
  );
}

function CourseSettingsPopover({ workspace, disabled, onSave, onRemove, onClose }: {
  workspace: RoutingWorkspace | null;
  disabled: boolean;
  onSave: (conceptId: string | null, policy: RoutingPolicy) => Promise<void>;
  onRemove: (conceptId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | "default" | "new" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  if (!workspace) return <section className={styles.courseSettingsPopover}><header><div><small>Course-wide</small><strong>Routing settings</strong></div><button aria-label="Close settings" onClick={onClose} type="button"><X /></button></header><p>Add a lecture before configuring mastery and remediation policies.</p></section>;
  const defaultPolicy = workspace.policies.find((item) => item.concept_id === null)!;
  const overrides = workspace.policies.filter((item) => item.concept_id !== null);
  const editingRecord = editing && editing !== "new"
    ? workspace.policies.find((item) => (item.concept_id ?? "default") === editing)
    : null;
  return (
    <section className={styles.courseSettingsPopover}>
      <header><div><small>Course-wide</small><strong>Routing settings</strong></div><button aria-label="Close settings" onClick={onClose} type="button"><X /></button></header>
      <p>Control mastery and remediation across every lecture. Changes stay private until publication.</p>
      {editing ? (
        <PolicyEditor
          key={editing}
          conceptId={editing === "default" ? null : editing === "new" ? undefined : editing}
          concepts={workspace.concepts.filter((concept) => !overrides.some((record) => record.concept_id === concept.id))}
          initial={editingRecord?.policy ?? defaultPolicy.policy}
          onCancel={() => setEditing(null)}
          onSave={async (conceptId, policy) => {
            await onSave(conceptId, policy);
            setEditing(null);
          }}
        />
      ) : (
        <>
          <article className={styles.courseSettingsDefault}>
            <div><small>Course default</small><strong>Mastery policy</strong><PolicySummary policy={defaultPolicy.policy} /></div>
            <button aria-label="Edit course default" disabled={disabled} onClick={() => setEditing("default")} type="button"><Pencil /></button>
          </article>
          <div className={styles.courseSettingsOverrides}>
            <div><strong>Concept overrides</strong><button disabled={disabled || overrides.length >= workspace.concepts.length} onClick={() => setEditing("new")} type="button"><Plus />Add</button></div>
            {overrides.map((record) => (
              <article key={record.concept_id}>
                <div><strong>{record.concept_name}</strong><PolicySummary policy={record.policy} /></div>
                <div><button aria-label={`Edit ${record.concept_name} policy`} disabled={disabled} onClick={() => setEditing(record.concept_id!)} type="button"><Pencil /></button>{confirmRemove === record.concept_id ? <><button onClick={() => setConfirmRemove(null)} type="button">Keep</button><button onClick={() => void onRemove(record.concept_id!).then(() => setConfirmRemove(null))} type="button">Remove</button></> : <button aria-label={`Remove ${record.concept_name} override`} disabled={disabled} onClick={() => setConfirmRemove(record.concept_id)} type="button"><Trash2 /></button>}</div>
              </article>
            ))}
            {!overrides.length ? <p>Every concept inherits the course default.</p> : null}
          </div>
        </>
      )}
    </section>
  );
}

function PolicySummary({ policy }: { policy: RoutingPolicy }) {
  return <p>{policy.correct_attempts_for_mastery} confident correct · confidence ≥ {policy.confidence_threshold} · {policy.max_remediation_attempts} remediation attempts</p>;
}

function PolicyEditor({ conceptId, concepts, initial, onCancel, onSave }: {
  conceptId: string | null | undefined;
  concepts: RoutingWorkspace["concepts"];
  initial: RoutingPolicy;
  onCancel: () => void;
  onSave: (conceptId: string | null, policy: RoutingPolicy) => Promise<void>;
}) {
  const [selectedConcept, setSelectedConcept] = useState(conceptId ?? concepts[0]?.id ?? "");
  const [policy, setPolicy] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <form className={styles.policyEditor} onSubmit={(event) => { event.preventDefault(); setSaving(true); void onSave(conceptId === null ? null : selectedConcept, policy).catch(() => setSaving(false)); }}>
      <header><h4>{conceptId === null ? "Edit course default" : conceptId ? "Edit concept override" : "Add concept override"}</h4><button aria-label="Close policy editor" onClick={onCancel} type="button"><X /></button></header>
      {conceptId === undefined ? <label>Concept<select onChange={(event) => setSelectedConcept(event.target.value)} value={selectedConcept}>{concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></label> : null}
      <div><label>Confidence required<input max="4" min="1" onChange={(event) => setPolicy((current) => ({ ...current, confidence_threshold: Number(event.target.value) }))} type="number" value={policy.confidence_threshold} /></label><label>Correct attempts for mastery<input min="1" onChange={(event) => setPolicy((current) => ({ ...current, correct_attempts_for_mastery: Number(event.target.value) }))} type="number" value={policy.correct_attempts_for_mastery} /></label><label>Remediation attempt limit<input min="0" onChange={(event) => setPolicy((current) => ({ ...current, max_remediation_attempts: Number(event.target.value) }))} type="number" value={policy.max_remediation_attempts} /></label><label>Advancement mode<select onChange={(event) => setPolicy((current) => ({ ...current, advancement_mode: event.target.value as RoutingPolicy["advancement_mode"] }))} value={policy.advancement_mode}><option value="require_mastery">Require mastery</option><option value="allow_partial_understanding">Allow partial understanding</option></select></label></div>
      <footer><button onClick={onCancel} type="button">Cancel</button><button disabled={saving || (conceptId === undefined && !selectedConcept)} type="submit">{saving ? <LoaderCircle className={styles.spin} /> : <Check />}Save policy</button></footer>
    </form>
  );
}

function PreviewCanvas({ course, courseFlow, workspace }: {
  course: CourseSummary | null;
  courseFlow: CourseFlow | null;
  workspace: AssessmentWorkspace | null;
}) {
  const clips = workspace?.clips ?? [];
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null;
  const isWorkingRevision = workspace?.is_working_revision ?? false;
  return (
    <div className={styles.previewCanvas}>
      <header>
        <div><h2>Learner clip preview</h2><p>Review the exact teaching moments in this course revision, in the order learners may encounter them.</p></div>
        <span>{clips.length} {clips.length === 1 ? "clip" : "clips"}</span>
      </header>
      {courseFlow?.units.length ? <section className={styles.previewJourney}><small>Published course sequence</small><div>{courseFlow.units.map((unit, index) => <article data-kind={unit.kind} key={unit.logical_id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{unit.title}</strong><p>{unit.kind} · {unit.kind === "lecture" ? `${unit.topic_count} topics` : `${unit.concept_count} concepts`}</p></div></article>)}</div></section> : null}
      {!workspace ? <div className={styles.canvasEmpty}><LoaderCircle className={styles.spin} /><h2>Loading learner preview</h2></div> : null}
      {workspace && !clips.length ? <div className={styles.inlineEmpty}><FileVideo /><div><strong>No teaching clips in this revision</strong><p>Generate or add clips before publishing so learners have focused teaching moments to revisit.</p></div></div> : null}
      {selectedClip ? (
        <div className={styles.clipPreviewWorkspace}>
          <nav aria-label="Teaching clips">
            {clips.map((clip, index) => (
              <button
                aria-current={selectedClip.id === clip.id ? "true" : undefined}
                key={clip.id}
                onClick={() => setSelectedClipId(clip.id)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{clip.topic_title}</strong><small>{clip.type.replaceAll("_", " ")} · {clipTimeRange(clip)}</small></div>
                <Play />
              </button>
            ))}
          </nav>
          <section className={styles.learnerClipStage}>
            <ClipPlayer clip={selectedClip} />
            <div>
              <div><h3>{selectedClip.topic_title}</h3><p>{selectedClip.type.replaceAll("_", " ")} · {clipTimeRange(selectedClip)}</p></div>
              <dl>
                <div><dt>Purpose</dt><dd>Focused teaching moment</dd></div>
                <div><dt>Difficulty</dt><dd>{selectedClip.difficulty ?? "Not set"}</dd></div>
                <div><dt>Revision</dt><dd>{isWorkingRevision ? "Private working revision" : "Published learner revision"}</dd></div>
              </dl>
            </div>
          </section>
        </div>
      ) : null}
      <footer><Eye /><p>This is an instructor-only playback preview. Watching here never changes learner progress or mastery.</p><span>{course?.title ?? "Course preview"}</span></footer>
    </div>
  );
}

function ClipPlayer({ clip }: { clip: AssessmentWorkspace["clips"][number] }) {
  const playback: PlaybackInfo = {
    provider: clip.playback_provider,
    playback_id: clip.playback_id,
    playback_url: clip.playback_url,
    delivery_asset_id: clip.delivery_asset_id,
  };
  return (
    <ProviderVideo
      clipId={clip.id}
      clipMaterializationStatus={clip.materialization_status}
      endSeconds={clip.end_seconds}
      pipelineBaseUrl={pipelineBase}
      playback={playback}
      startSeconds={clip.start_seconds}
      title={`${clip.topic_title} clip`}
      videoId={clip.video_id}
    />
  );
}

function clipTimeRange(clip: AssessmentWorkspace["clips"][number]): string {
  const duration = Math.max(0, clip.end_seconds - clip.start_seconds);
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  return minutes ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

function StudioSkeleton() { return <div className={styles.studioSkeleton}><i /><i /></div>; }

export function mapToFlow(
  courseMap: CourseMap | null,
  topicId: string | null,
  artifactId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  if (!courseMap) return { nodes: [], edges: [] };
  const allTopics = courseMap.nodes.filter((node) => node.kind === "topic");
  const allConcepts = courseMap.nodes.filter((node) => node.kind === "concept");
  if (!topicId) {
    const topics = allTopics.filter((topic) => topic.status !== "dismissed");
    const concepts = allConcepts.filter((concept) => concept.status !== "dismissed");
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(topics.length))));
    const clusterWidth = 430;
    const rowHeights = new Map<number, number>();
    topics.forEach((topic, index) => {
      const row = Math.floor(index / columns);
      const conceptCount = concepts.filter((concept) => concept.topic_id === topic.id).length;
      const height = 122 + Math.max(1, Math.ceil(conceptCount / 2)) * 82;
      rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, height));
    });
    const rowOffsets = new Map<number, number>();
    let nextOffset = 0;
    for (let row = 0; row <= Math.floor(Math.max(0, topics.length - 1) / columns); row += 1) {
      rowOffsets.set(row, nextOffset);
      nextOffset += (rowHeights.get(row) ?? 210) + 56;
    }
    const nodes: Node[] = [];
    topics.forEach((topic, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const originX = column * clusterWidth;
      const originY = rowOffsets.get(row) ?? 0;
      nodes.push({
        id: topic.id,
        position: mapPosition(topic, { x: originX, y: originY }),
        data: { label: topic.title },
        style: { background: "#202126", border: "0", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 650, lineHeight: 1.35, padding: 15, width: 380 },
      });
      concepts.filter((concept) => concept.topic_id === topic.id).forEach((concept, conceptIndex) => {
        nodes.push({
          id: concept.id,
          position: mapPosition(concept, {
            x: originX + (conceptIndex % 2) * 194,
            y: originY + 104 + Math.floor(conceptIndex / 2) * 82,
          }),
          data: { label: concept.title },
          style: { background: "#fff", border: "1px solid #d6d2c9", borderRadius: 9, color: "#292930", fontSize: 12, lineHeight: 1.35, padding: 12, width: 180 },
        });
      });
    });
    const unlinked = concepts.filter((concept) => !concept.topic_id);
    unlinked.forEach((concept, index) => {
      nodes.push({
        id: concept.id,
        position: mapPosition(concept, { x: (index % columns) * 210, y: nextOffset + Math.floor(index / columns) * 76 }),
        data: { label: concept.title },
        style: { background: "#fff8f0", border: "1px dashed #ce8a4e", borderRadius: 9, color: "#292930", fontSize: 12, padding: 12, width: 190 },
      });
    });
    const visibleConceptIds = new Set(concepts.map((concept) => concept.id));
    const containment: Edge[] = concepts.filter((concept) => concept.topic_id).map((concept) => ({
      id: `topic-${concept.id}`,
      source: concept.topic_id!,
      target: concept.id,
      type: "smoothstep",
      style: { stroke: "#bdb9b1", strokeWidth: 1.25 },
    }));
    const prerequisite: Edge[] = courseMap.edges
      .filter((edge) => visibleConceptIds.has(edge.source_id) && visibleConceptIds.has(edge.target_id) && edge.status !== "dismissed")
      .map((edge) => ({
        id: edge.id,
        source: edge.source_id,
        target: edge.target_id,
        type: "smoothstep",
        animated: edge.status === "proposed",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#c7762d" },
        style: { stroke: "#c7762d", strokeWidth: 1.7 },
      }));
    return {
      nodes,
      edges: [...containment, ...prerequisite],
    };
  }
  const directIds = new Set(allConcepts.filter((concept) => concept.topic_id === topicId).map((concept) => concept.id));
  const focusIds = new Set(directIds);
  for (const edge of courseMap.edges) {
    if (directIds.has(edge.source_id) || directIds.has(edge.target_id)) {
      focusIds.add(edge.source_id);
      focusIds.add(edge.target_id);
    }
  }
  if (artifactId) {
    focusIds.clear();
    focusIds.add(artifactId);
    for (const edge of courseMap.edges) {
      if (edge.source_id === artifactId) focusIds.add(edge.target_id);
      if (edge.target_id === artifactId) focusIds.add(edge.source_id);
    }
  }
  const concepts = allConcepts.filter((concept) => focusIds.has(concept.id));
  const visibleTopicIds = new Set(concepts.map((concept) => concept.topic_id).filter((value): value is string => Boolean(value)));
  visibleTopicIds.add(topicId);
  const topics = allTopics.filter((topic) => visibleTopicIds.has(topic.id));
  const nodes: Node[] = topics.map((topic, index) => ({
    id: topic.id,
    position: mapPosition(topic, { x: 30, y: 40 + index * 170 }),
    data: { label: topic.title },
    style: { background: "#202126", border: "0", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 650, padding: 13, width: 210 },
  }));
  const conceptRows = new Map<string, number>();
  concepts.forEach((concept) => {
    const topicIndex = Math.max(0, topics.findIndex((topic) => topic.id === concept.topic_id));
    const current = conceptRows.get(concept.topic_id ?? "none") ?? 0;
    conceptRows.set(concept.topic_id ?? "none", current + 1);
    nodes.push({
      id: concept.id,
      position: mapPosition(concept, { x: 340 + (current % 2) * 210, y: 28 + topicIndex * 170 + Math.floor(current / 2) * 62 }),
      data: { label: concept.title },
      style: { background: concept.status === "dismissed" ? "#f3f1ed" : "#fff", border: "1px solid #d9d7d0", borderRadius: 9, color: "#292930", fontSize: 12, padding: 11, width: 190 },
    });
  });
  const containment: Edge[] = concepts.filter((concept) => concept.topic_id).map((concept) => ({ id: `topic-${concept.id}`, source: concept.topic_id!, target: concept.id, type: "smoothstep", style: { stroke: "#c5c3bc", strokeWidth: 1 } }));
  const prerequisite: Edge[] = courseMap.edges.filter((edge) => focusIds.has(edge.source_id) && focusIds.has(edge.target_id)).map((edge) => ({ id: edge.id, source: edge.source_id, target: edge.target_id, type: "smoothstep", animated: edge.status === "proposed", markerEnd: { type: MarkerType.ArrowClosed, color: "#c7762d" }, style: { stroke: "#c7762d", strokeWidth: 1.5 } }));
  return { nodes, edges: [...containment, ...prerequisite] };
}

function mapPosition(
  artifact: CourseMap["nodes"][number],
  fallback: { x: number; y: number },
): { x: number; y: number } {
  const layout = isRecord(artifact.metadata.layout) ? artifact.metadata.layout : null;
  return typeof layout?.x === "number" && typeof layout?.y === "number"
    ? { x: layout.x, y: layout.y }
    : fallback;
}

function artifactLabel(value: string) { return value.replaceAll("_", " "); }
function answerLabel(value: Record<string, unknown>) {
  const answer = value.answer ?? value.correct ?? value.value;
  if (typeof answer === "string" || typeof answer === "number" || typeof answer === "boolean") return String(answer);
  return JSON.stringify(value);
}
function specialistLabel(role: CourseAgentTask["specialist_role"]): string {
  return {
    learning_analyst: "Learning Analyst",
    curriculum_architect: "Curriculum Architect",
    clip_editor: "Clip Editor",
    assessment_designer: "Assessment Designer",
  }[role];
}
function specialistIcon(role: CourseAgentTask["specialist_role"]): ReactNode {
  if (role === "learning_analyst") return <BarChart3 />;
  if (role === "curriculum_architect") return <Network />;
  if (role === "clip_editor") return <Scissors />;
  return <ClipboardList />;
}
function taskDescription(task: CourseAgentTask): string {
  if (task.status === "waiting_review") return "Prepared an exact private course change for your review.";
  if (task.status === "failed") return task.error_message ?? "The specialist could not finish this task.";
  const instruction = task.request_context.instruction;
  return typeof instruction === "string" && instruction.trim()
    ? instruction
    : task.task_type.replaceAll("_", " ");
}
function taskStatusLabel(status: CourseAgentTask["status"]): string {
  return {
    queued: "Brief received",
    running: "Working from course evidence",
    waiting_review: "Your review is required",
    complete: "Complete",
    failed: "Needs attention",
    cancelled: "Cancelled",
  }[status];
}
function visibleEvidence(evidence: Record<string, unknown>): [string, unknown][] {
  return Object.entries(evidence)
    .filter(([key]) => !key.endsWith("_id") && key !== "fingerprint")
    .slice(0, 6);
}
function evidenceMetricLabel(key: string): string {
  return key.replaceAll("_", " ");
}
function evidenceMetricValue(key: string, value: unknown): string {
  if (typeof value === "number" && key.endsWith("_rate")) return `${Math.round(value * 100)}%`;
  if (typeof value === "number") return value.toLocaleString();
  return shortValue(value);
}
function topicHealthLabel(topic: DashboardSummary["topic_health"][number]): string {
  if (!topic.attempts) return "Awaiting learner evidence";
  const accuracy = performancePercent(topic.correct_attempts, topic.attempts);
  const confident = performancePercent(topic.confidence_3 + topic.confidence_4, topic.attempts);
  if (accuracy < 55) return "Learners are struggling with this topic";
  if (confident < 60) return "Correct answers still carry uncertainty";
  return "Learners are progressing with confidence";
}
function shortValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function looksLikeUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeJson(value: string): Record<string, unknown> | null { try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : null; } catch { return null; } }
async function responseDetail(response: Response, fallback: string) { const payload = (await response.json().catch(() => null)) as { detail?: string } | null; return payload?.detail ?? fallback; }

async function readDirectorStream(
  response: Response,
  onEvent: (streamEvent: { event: string; data: Record<string, unknown> }) => void,
) {
  if (!response.body) throw new Error("Course Director did not return a response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r", "");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const dataText = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!dataText) continue;
      const data = JSON.parse(dataText) as Record<string, unknown>;
      onEvent({ event, data });
    }
    if (done) break;
  }
}
