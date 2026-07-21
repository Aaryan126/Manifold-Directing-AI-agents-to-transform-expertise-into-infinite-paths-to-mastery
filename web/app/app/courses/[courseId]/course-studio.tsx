"use client";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
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
  GitFork,
  LoaderCircle,
  Map as MapIcon,
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
  Settings2,
  SunMedium,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import {
  answerOutcomeSummary,
  canPrepareImprovement,
  evidenceTitle,
  generationPhaseLabel,
  orderedGenerationTasks,
  performancePercent,
  shouldHydrateGenerationRun,
  shouldCenterCreationComposer,
  studioPresentationMode,
  type CourseMap,
  type CourseAssessment,
  type CourseMessage,
  type CourseAgentTask,
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
import { readDevelopmentSession } from "../../../developmentSession";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";
type CanvasView = "overview" | "map" | "review" | "assessments" | "preview" | "settings";
type Decision = "accepted" | "edited" | "dismissed";
type AssessmentDraftPayload = {
  topic_id: string;
  body: string;
  type: CourseAssessment["type"];
  correct_answer: Record<string, unknown>;
  confidence_prompt: string;
  remediation_rules: Omit<AssessmentRule, "id">[];
};

const InsightsCharts = dynamic(
  () => import("@/components/insights-charts").then((module) => module.InsightsCharts),
  { ssr: false },
);

export function CourseStudio({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar } = useTeacherSidebar();
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState<DevelopmentIdentity | null>(null);
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMap | null>(null);
  const [bundles, setBundles] = useState<ReviewBundle[]>([]);
  const [revisionDiff, setRevisionDiff] = useState<RevisionDiff | null>(null);
  const [assessmentWorkspace, setAssessmentWorkspace] = useState<AssessmentWorkspace | null>(null);
  const [routingWorkspace, setRoutingWorkspace] = useState<RoutingWorkspace | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [sources, setSources] = useState<CourseSource[]>([]);
  const [agentTasks, setAgentTasks] = useState<CourseAgentTask[]>([]);
  const [canvasView, setCanvasView] = useState<CanvasView>("map");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalStates, setProposalStates] = useState<Record<string, string>>({});
  const [directorOpen, setDirectorOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const isBuilding = Boolean(
    (run && ["queued", "running"].includes(run.status))
    || (course && ["queued", "running"].includes(course.generation_status ?? "")),
  );
  const focusedCreation = studioPresentationMode(course) === "creation";
  const composerCentered = shouldCenterCreationComposer(
    course,
    messages.some((message) => message.role === "instructor"),
    Boolean(run),
    Boolean(sourceLabel),
    sending,
  );

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
    const [mapResult, bundleResult] = await Promise.all([
      request<CourseMap>(`/courses/${courseId}/map`, user),
      request<ReviewBundle[]>(`/courses/${courseId}/review-bundles`, user),
    ]);
    setCourseMap(mapResult);
    setBundles(bundleResult);
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
      setIdentity(user);
      const [courseResult, messageResult] = await Promise.all([
        request<CourseSummary>(`/courses/${courseId}/studio`, user),
        request<CourseMessage[]>(`/courses/${courseId}/messages`, user),
      ]);
      setCourse(courseResult);
      setMessages(messageResult);
      if (shouldHydrateGenerationRun(courseResult) && courseResult.generation_run_id) {
        const runResult = await request<GenerationRun>(
          `/courses/${courseId}/generation-runs/${courseResult.generation_run_id}`,
          user,
        );
        setRun(runResult);
      }
      await refreshArtifacts(user);
      await refreshRevisionDiff(user, courseResult);
      if (courseResult.active_revision_id || courseResult.working_revision_id) {
        await refreshIntelligence(user);
      }
      if (courseResult.topic_count > 0) {
        await refreshStructuredWorkspace(user, courseResult.status === "published");
      }
      if (courseResult.status === "published") setCanvasView("overview");
      else if (courseResult.pending_review_count > 0) setCanvasView("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the course studio.");
    } finally {
      setLoading(false);
    }
  }, [courseId, refreshArtifacts, refreshIntelligence, refreshStructuredWorkspace, refreshRevisionDiff, request, router]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

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
            await refreshRevisionDiff(identity, nextCourse);
            setCanvasView("review");
          }
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not refresh generation."));
    }, 2200);
    return () => window.clearInterval(interval);
  }, [courseId, identity, refreshArtifacts, refreshStructuredWorkspace, refreshRevisionDiff, request, run]);

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
    if (looksLikeUrl(content) && (course?.source_count ?? 0) === 0) {
      await ingestUrl(content);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await request(`/courses/${courseId}/messages`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      setMessages(await request<CourseMessage[]>(`/courses/${courseId}/messages`, identity));
      await refreshArtifacts(identity);
      await refreshRevisionDiff(identity, nextCourse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the message.");
      setComposer(content);
    } finally {
      setSending(false);
    }
  }

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
    const nextRun = await request<GenerationRun>(`/courses/${courseId}/generation-runs`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, ingestion_job_id: ingestionJobId }),
    });
    setRun(nextRun);
    setSourceLabel("Lecture received. Manifold is building your private draft.");
    setCourse(await request<CourseSummary>(`/courses/${courseId}/studio`, identity));
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
      if (decision !== "dismissed" && course) {
        await refreshRevisionDiff(identity, course);
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
      await refreshArtifacts(identity);
      await refreshStructuredWorkspace(identity);
      setCanvasView("overview");
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

  async function resolveDashboardSignal(
    signalId: string,
    decision: Decision,
    note?: string,
  ) {
    if (!identity) return;
    const path = decision === "accepted"
      ? `/dashboard/signals/${signalId}/accept`
      : decision === "dismissed"
        ? `/dashboard/signals/${signalId}/dismiss`
        : `/dashboard/signals/${signalId}`;
    try {
      await request(path, identity, {
        method: decision === "edited" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: decision === "edited" ? "manual_edit" : `${decision}_ai_suggestion`,
          note: note ?? null,
          retroactive: false,
        }),
      });
      setDashboardSummary(await request<DashboardSummary>(`/courses/${courseId}/dashboard`, identity));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the insight decision.");
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

  async function requestSpecialist(priority: CoursePriority) {
    if (!identity || !priority.target_artifact_type || !priority.target_logical_artifact_id) return;
    setSending(true);
    setError(null);
    try {
      await request(`/courses/${courseId}/agent-tasks`, identity, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specialist_role: priority.specialist_role,
          task_type: "prepare_improvement",
          target_artifact_type: priority.target_artifact_type,
          target_logical_artifact_id: priority.target_logical_artifact_id,
          instruction: priority.recommended_action,
          evidence: priority.evidence,
        }),
      });
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshIntelligence(identity),
        refreshArtifacts(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not brief the specialist.");
    } finally {
      setSending(false);
    }
  }

  function askDirectorAbout(priority: CoursePriority) {
    setComposer(
      `Help me evaluate “${priority.title}”. Use the evidence (${priority.evidence_count} observations) and recommend the smallest effective private course change.`,
    );
    setDirectorOpen(true);
  }

  async function resolveSpecialistProposal(
    task: CourseAgentTask,
    decision: Decision,
    instructorRevision?: Record<string, unknown>,
  ) {
    const proposalId = task.proposal_ids[0];
    if (!proposalId || !identity) return;
    await resolveProposal(proposalId, decision, instructorRevision);
    await Promise.all([
      refreshIntelligence(identity),
      refreshArtifacts(identity),
      refreshStructuredWorkspace(identity),
    ]);
    const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
    setCourse(nextCourse);
    await refreshRevisionDiff(identity, nextCourse);
  }

  async function saveCourseMapPosition(logicalId: string, x: number, y: number) {
    if (!identity) return;
    try {
      await request(`/courses/${courseId}/map/layout`, identity, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: [{ logical_artifact_id: logicalId, x, y }] }),
      });
      const nextCourse = await request<CourseSummary>(`/courses/${courseId}/studio`, identity);
      setCourse(nextCourse);
      await Promise.all([
        refreshArtifacts(identity),
        refreshRevisionDiff(identity, nextCourse),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the course map layout.");
    }
  }

  async function leaveStudio() {
    if (identity && course?.status === "draft" && course.source_count === 0) {
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
  const canPublish = Boolean(
    course?.working_revision_id
    && course.topic_count > 0
    && course.pending_review_count === 0
    && bundles.length >= 3
    && bundles.every((bundle) => bundle.status === "complete")
    && !isBuilding,
  );

  const courseDirector = (
    <section
      className={`${styles.conversationPanel} ${focusedCreation ? styles.creationConversation : styles.dockedConversation}`}
      data-composer-centered={composerCentered || undefined}
      aria-label={focusedCreation ? "Course Director" : undefined}
      aria-labelledby={focusedCreation ? undefined : "conversation-title"}
    >
      {!focusedCreation ? (
        <div className={styles.panelHeader}>
          <div className={styles.directorIdentity}><MessageSquareText /><span><strong id="conversation-title">Course Director</strong><small>Manifold</small></span></div>
          <div className={styles.panelHeaderActions}>
            <button aria-label="Close Course Director" onClick={() => setDirectorOpen(false)} type="button"><X /></button>
          </div>
        </div>
      ) : null}
      {composerCentered ? (
        <div className={styles.creationGreeting}>
          <SunMedium aria-hidden="true" />
          <h2>Good {greetingTime()}, {teacherFirstName(identity?.display_name)}.</h2>
        </div>
      ) : null}
      <div className={styles.messageList}>
        {!composerCentered ? messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            proposalStates={proposalStates}
            onResolve={resolveProposal}
          />
        )) : null}

        {!composerCentered && (course?.source_count ?? 0) === 0 ? (
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
          aria-label="Message Manifold"
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={editingLocked
            ? "Ask about learner evidence, or request a private course change…"
            : (course?.source_count ?? 0) === 0
              ? (composerCentered ? "What would you like to teach? Paste a lecture link or add a file…" : "Paste a lecture link, or tell Manifold about the course…")
              : "Ask about or change this course…"}
          rows={focusedCreation ? 4 : 3}
          value={composer}
        />
        <div>
          <button aria-label="Attach lecture" disabled={editingLocked} onClick={() => fileInput.current?.click()} type="button">{composerCentered ? <Plus /> : <Paperclip />}</button>
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
      <main className={styles.studioMain}>
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
            <button aria-label="Back to courses" disabled={sending} onClick={() => void leaveStudio()} type="button"><ArrowLeft /></button>
            <div>
              <span>{course?.status === "published" ? "Published course" : "Private course draft"}</span>
              <h1>{course?.title ?? "Course studio"}</h1>
            </div>
          </div>
          <div className={styles.studioStatus}>
            {isBuilding ? <span data-tone="building"><LoaderCircle className={styles.spin} />{Math.round(run?.progress ?? course?.generation_progress ?? 0)}% building</span>
              : course?.pending_review_count ? <span data-tone="review"><ClipboardCheck />{course.pending_review_count} to review</span>
                : course?.status === "published" ? <span data-tone="live"><Check />Live</span>
                  : <span><Activity />Private</span>}
            {!editingLocked ? (
              <button disabled={!canPublish || sending} onClick={() => void publishRevision()} type="button">
                {course?.status === "published" ? "Publish updates" : "Publish course"}
              </button>
            ) : null}
          </div>
        </header>

        {error ? <div className={styles.studioError} role="alert"><CircleAlert /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div> : null}

        {loading ? <StudioSkeleton /> : (
          focusedCreation ? (
            <div className={styles.creationStage}>{courseDirector}</div>
          ) : (
            <div className={styles.workspaceStage}>
              <section className={styles.canvasPanel} aria-label="Course workspace canvas">
              <nav className={styles.canvasTabs} aria-label="Course views">
                {course?.status === "published" ? <CanvasTab active={canvasView === "overview"} icon={<Activity />} label="Overview" onClick={() => setCanvasView("overview")} /> : null}
                <CanvasTab active={canvasView === "map"} icon={<MapIcon />} label="Course map" onClick={() => setCanvasView("map")} />
                {course?.status !== "published" ? <CanvasTab active={canvasView === "review"} badge={course?.pending_review_count || undefined} icon={<ClipboardCheck />} label="Review" onClick={() => setCanvasView("review")} /> : null}
                {course?.status === "published" ? <CanvasTab active={canvasView === "assessments"} icon={<Check />} label="Assessments" onClick={() => setCanvasView("assessments")} /> : null}
                <CanvasTab active={canvasView === "preview"} icon={<Eye />} label="Preview" onClick={() => setCanvasView("preview")} />
                {course?.status === "published" ? <CanvasTab active={canvasView === "settings"} icon={<Settings2 />} label="Settings" onClick={() => setCanvasView("settings")} /> : null}
                {course?.status === "published" ? (
                  <button className={styles.sourceLibraryButton} onClick={() => setSourcesOpen(true)} type="button">
                    <FileText />Sources<span>{sources.length}</span>
                  </button>
                ) : null}
              </nav>
              <div className={styles.canvasBody}>
                {canvasView === "overview" ? (
                  <OverviewCanvas
                    agentTasks={agentTasks}
                    course={course}
                    courseMap={courseMap}
                    dashboard={dashboardSummary}
                    onAskDirector={askDirectorAbout}
                    onPrepare={requestSpecialist}
                    onResolveProposal={resolveSpecialistProposal}
                    onSignal={resolveDashboardSignal}
                    onSources={() => setSourcesOpen(true)}
                    revisionDiff={revisionDiff}
                    sources={sources}
                  />
                ) : null}
                {canvasView === "map" ? <CourseMapCanvas courseMap={courseMap} onLayout={saveCourseMapPosition} run={run} /> : null}
                {canvasView === "review" && course?.status !== "published" ? <ReviewCanvas bundles={bundles} onBundle={decideBundle} onItem={decideItem} /> : null}
                {canvasView === "assessments" ? <AssessmentsCanvas disabled={sending} onRemove={removeAssessment} onSave={saveAssessment} workspace={assessmentWorkspace} /> : null}
                {canvasView === "preview" ? <PreviewCanvas course={course} workspace={assessmentWorkspace} /> : null}
                {canvasView === "settings" ? <SettingsCanvas disabled={sending} onRemove={removeRoutingPolicy} onSave={saveRoutingPolicy} workspace={routingWorkspace} /> : null}
              </div>
              </section>
              <button aria-expanded={directorOpen} aria-label="Open Course Director" className={styles.directorLauncher} onClick={() => setDirectorOpen((current) => !current)} type="button">
                <MessageCircleMore />
                <span>Course Director</span>
              </button>
              {directorOpen ? <aside className={styles.directorDock}>{courseDirector}</aside> : null}
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
          )
        )}
      </main>
    </div>
  );
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
      {message.role === "manifold" ? <span className={styles.agentAvatar}><GitFork /></span> : null}
      <div>
        <small>{message.role === "manifold" ? "Manifold" : "You"}</small>
        <p>{message.content}</p>
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
          return (
            <div className={styles.proposalCard} key={`${proposalId}-${index}`}>
              <span><FilePenLine />Proposed course directive</span>
              <p>{typeof proposed.instruction === "string" ? proposed.instruction : "Update the course brief."}</p>
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

function CanvasTab({ active, badge, icon, label, onClick }: { active: boolean; badge?: number; icon: ReactNode; label: string; onClick: () => void }) {
  return <button aria-pressed={active} onClick={onClick} type="button">{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>;
}

function CourseMapCanvas({ courseMap, onLayout, run }: {
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
        <p>Topics, concepts, prerequisites, assessments, and learning paths appear as Manifold builds them.</p>
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
  if (!active) return <div className={styles.canvasEmpty}><ClipboardList /><h2>No review bundle yet</h2><p>Manifold will assemble a small set of high-leverage decisions after the full private draft is built.</p></div>;
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

function OverviewCanvas({
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
  const selectedTopic = dashboard?.topic_health?.find((topic) => (
    topic.logical_id === selectedTopicId
    || topic.logical_id === selectedPriority?.target_logical_artifact_id
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
        <section className={styles.priorityBrief}>
          <header><div><h3>Priority brief</h3><p>Ranked issues that can change learning, not a generic notification feed.</p></div><span>{priorities.length} open</span></header>
          <div>
            {priorities.map((priority, index) => {
              const matchingTask = agentTasks.find((task) => (
                task.target_logical_artifact_id === priority.target_logical_artifact_id
                && task.task_type === "prepare_improvement"
              ));
              return (
                <article aria-current={selectedPriority?.id === priority.id ? "true" : undefined} key={priority.id}>
                  <button className={styles.priorityEvidenceButton} onClick={() => {
                    setSelectedPriorityId(priority.id);
                    setSelectedTopicId(priority.target_logical_artifact_id);
                  }} type="button">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><small>{specialistLabel(priority.specialist_role)} · {priority.severity} priority</small><h4>{priority.title}</h4><p>{priority.summary}</p><em>{priority.affected_learners ? `${priority.affected_learners} learners` : `${priority.evidence_count} design checks`}</em></div>
                    <BarChart3 />
                  </button>
                  <footer>
                    <button onClick={() => onAskDirector(priority)} type="button"><MessageCircleMore />Ask Director</button>
                    <button disabled={!canPrepareImprovement(priority, agentTasks)} onClick={() => void onPrepare(priority)} type="button">
                      {matchingTask && ["queued", "running"].includes(matchingTask.status) ? <LoaderCircle className={styles.spin} /> : <Wand2 />}
                      {matchingTask && ["queued", "running"].includes(matchingTask.status) ? "Specialist working" : "Prepare improvement"}
                    </button>
                  </footer>
                </article>
              );
            })}
            {!priorities.length ? <div className={styles.inlineEmpty}><Check /><div><strong>No urgent course changes</strong><p>The team will surface a priority when evidence or course coverage crosses a meaningful threshold.</p></div></div> : null}
          </div>
        </section>

        <section className={styles.courseTeam}>
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
            {!activeTasks.length ? <div className={styles.teamEmpty}><BrainCircuit /><p><strong>The team is listening.</strong> Choose Prepare improvement on a priority to brief the right specialist.</p></div> : null}
          </div>
        </section>
      </div>

      <section className={styles.evidenceWorkspace}>
        <header><div><h3>Evidence inspector</h3><p>Trace a recommendation to actual learner behavior and course coverage.</p></div><span>{selectedTopic ? selectedTopic.title : "Choose a priority or topic"}</span></header>
        <div>
          <article>
            <small>Selected evidence</small>
            <h4>{selectedPriority?.title ?? selectedTopic?.title ?? "No evidence selected"}</h4>
            <p>{selectedPriority?.summary ?? "Select a topic below to inspect its confidence, correctness, mastery, clips, and checks."}</p>
            {selectedPriority ? <dl>{Object.entries(selectedPriority.evidence).slice(0, 6).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl> : null}
            {selectedPriority?.id.startsWith("signal:") ? (
              <div className={styles.evidenceDecisionActions}>
                <button onClick={() => void onSignal(selectedPriority.id.slice(7), "accepted")} type="button"><Check />Accept diagnosis</button>
                <button onClick={() => void onSignal(selectedPriority.id.slice(7), "dismissed")} type="button"><X />Dismiss</button>
              </div>
            ) : null}
          </article>
          <article>
            <small>Topic pulse</small>
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

      <section className={styles.learningHealth} aria-labelledby="learning-health-title">
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

function AssessmentsCanvas({ workspace, disabled, onSave, onRemove }: {
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
        <label>Topic<select onChange={(event) => setTopicId(event.target.value)} value={topicId}>{workspace.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
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

function SettingsCanvas({ workspace, disabled, onSave, onRemove }: {
  workspace: RoutingWorkspace | null;
  disabled: boolean;
  onSave: (conceptId: string | null, policy: RoutingPolicy) => Promise<void>;
  onRemove: (conceptId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | "default" | "new" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [testPolicyId, setTestPolicyId] = useState("default");
  const [correct, setCorrect] = useState(true);
  const [confidence, setConfidence] = useState(3);
  const [priorCorrect, setPriorCorrect] = useState(0);
  const [remediationAttempts, setRemediationAttempts] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);
  if (!workspace) return <div className={styles.canvasEmpty}><LoaderCircle className={styles.spin} /><h2>Loading course settings</h2></div>;
  const defaultPolicy = workspace.policies.find((item) => item.concept_id === null)!;
  const overrides = workspace.policies.filter((item) => item.concept_id !== null);
  const testRecord = workspace.policies.find((item) => (item.concept_id ?? "default") === testPolicyId) ?? defaultPolicy;
  const testResult = simulatePolicy(testRecord.policy, correct, confidence, priorCorrect, remediationAttempts);
  const editingRecord = editing && editing !== "new"
    ? workspace.policies.find((item) => (item.concept_id ?? "default") === editing)
    : null;
  return (
    <div className={styles.settingsCanvas}>
      <header><div><h2>Settings & policies</h2><p>Control how learners advance, revisit concepts, and receive remediation.</p></div></header>
      <div className={styles.settingsGrid}>
        <section className={styles.policySection}>
          <header><div><h3>Learner routing</h3><p>The default applies everywhere unless a concept override is present.</p></div><button aria-controls="policy-editor" aria-expanded={editing === "new"} disabled={disabled || overrides.length >= workspace.concepts.length} onClick={() => setEditing("new")} type="button"><Plus />Add override</button></header>
          {editing ? <div className={styles.editorReveal} id="policy-editor" ref={editorRef}><PolicyEditor key={editing} conceptId={editing === "default" ? null : editing === "new" ? undefined : editing} concepts={workspace.concepts.filter((concept) => !overrides.some((record) => record.concept_id === concept.id))} initial={editingRecord?.policy ?? defaultPolicy.policy} onCancel={() => setEditing(null)} onSave={async (conceptId, policy) => { await onSave(conceptId, policy); setEditing(null); }} /></div> : null}
          <article className={styles.defaultPolicy}><div><span>Course default</span><h4>Default mastery policy</h4><PolicySummary policy={defaultPolicy.policy} /></div><button aria-controls="policy-editor" aria-expanded={editing === "default"} aria-label="Edit default policy" disabled={disabled} onClick={() => setEditing("default")} type="button"><Pencil /></button></article>
          <div className={styles.policyOverrides}>
            {overrides.map((record) => <article key={record.concept_id}><div><span>Concept override</span><h4>{record.concept_name}</h4><PolicySummary policy={record.policy} /></div><div><button aria-controls="policy-editor" aria-expanded={editing === record.concept_id} aria-label={`Edit ${record.concept_name} policy`} disabled={disabled} onClick={() => setEditing(record.concept_id!)} type="button"><Pencil /></button>{confirmRemove === record.concept_id ? <div><button onClick={() => setConfirmRemove(null)} type="button">Keep</button><button onClick={() => void onRemove(record.concept_id!).then(() => setConfirmRemove(null))} type="button">Remove</button></div> : <button aria-label={`Remove ${record.concept_name} override`} disabled={disabled} onClick={() => setConfirmRemove(record.concept_id)} type="button"><Trash2 /></button>}</div></article>)}
            {!overrides.length ? <div className={styles.inlineEmpty}><GitFork /><div><strong>No concept overrides</strong><p>Every concept currently inherits the course default.</p></div></div> : null}
          </div>
        </section>
        <section className={styles.policyTester}>
          <header><div><h3>Preview routing behavior</h3><p>Try a hypothetical learner outcome against a saved policy. This preview never changes learner progress.</p></div></header>
          <div className={styles.policyTesterGrid}>
            <label>Policy<select onChange={(event) => setTestPolicyId(event.target.value)} value={testPolicyId}><option value="default">Course default</option>{overrides.map((record) => <option key={record.concept_id} value={record.concept_id!}>{record.concept_name}</option>)}</select></label>
            <label className={styles.toggleField}><input checked={correct} onChange={(event) => setCorrect(event.target.checked)} type="checkbox" /><span>Answer is correct</span></label>
            <label>Confidence <strong>{confidence}/4</strong><input max="4" min="1" onChange={(event) => setConfidence(Number(event.target.value))} type="range" value={confidence} /></label>
            <label>Prior confident correct attempts<input min="0" onChange={(event) => setPriorCorrect(Number(event.target.value))} type="number" value={priorCorrect} /></label>
            <label>Remediation attempts used<input min="0" onChange={(event) => setRemediationAttempts(Number(event.target.value))} type="number" value={remediationAttempts} /></label>
            <div className={styles.testResult} data-action={testResult.action}><span>Predicted route</span><strong>{testResult.action.replaceAll("_", " ")}</strong><p>{testResult.why}</p></div>
          </div>
        </section>
      </div>
      <section className={styles.releaseSettings}><div><h3>Changes do not reach learners automatically</h3><p>Assessment and routing edits accumulate privately until you choose Publish updates in the course header.</p></div><Check /></section>
    </div>
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

function PreviewCanvas({ course, workspace }: {
  course: CourseSummary | null;
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
function simulatePolicy(
  policy: RoutingPolicy,
  correct: boolean,
  confidence: number,
  priorCorrect: number,
  remediationAttempts: number,
) {
  if (correct && confidence >= policy.confidence_threshold
    && priorCorrect + 1 >= policy.correct_attempts_for_mastery) {
    return { action: "advance", why: "The learner met both the correctness and confidence threshold for mastery." };
  }
  if (correct && policy.advancement_mode === "allow_partial_understanding") {
    return { action: "advance", why: "The answer is correct and this policy allows partial-understanding advancement." };
  }
  if (correct) {
    return { action: "reinforce", why: "The answer is correct, but this policy requires more confidence or repeated evidence." };
  }
  if (remediationAttempts < policy.max_remediation_attempts) {
    return { action: "remediate", why: "The learner is routed to the reviewed remediation target before trying again." };
  }
  return { action: "flag_instructor", why: "The remediation limit is reached, so the learner is surfaced for teacher attention." };
}
function looksLikeUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeJson(value: string): Record<string, unknown> | null { try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : null; } catch { return null; } }
async function responseDetail(response: Response, fallback: string) { const payload = (await response.json().catch(() => null)) as { detail?: string } | null; return payload?.detail ?? fallback; }
