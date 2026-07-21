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
  ClipboardCheck,
  ClipboardList,
  Eye,
  FilePenLine,
  FileVideo,
  GitFork,
  Lightbulb,
  LoaderCircle,
  Map as MapIcon,
  MessageCircleMore,
  MessageSquareText,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import {
  evidenceTitle,
  generationPhaseLabel,
  shouldHydrateGenerationRun,
  shouldCenterCreationComposer,
  studioPresentationMode,
  type CourseMap,
  type CourseMessage,
  type CourseSummary,
  type DevelopmentIdentity,
  type GenerationRun,
  type ReviewBundle,
  type ReviewItem,
  type RevisionDiff,
} from "../../course-os";
import styles from "../../course-os.module.css";
import { TeacherSidebar, useTeacherSidebar } from "../../teacher-dashboard";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";
const instructorStorageKey = "manifold.teacher-id";
type CanvasView = "overview" | "map" | "review" | "assessments" | "insights" | "preview" | "settings" | "changes";
type Decision = "accepted" | "edited" | "dismissed";

export function CourseStudio({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar } = useTeacherSidebar();
  const fileInput = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState<DevelopmentIdentity | null>(null);
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [messages, setMessages] = useState<CourseMessage[]>([]);
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMap | null>(null);
  const [bundles, setBundles] = useState<ReviewBundle[]>([]);
  const [revisionDiff, setRevisionDiff] = useState<RevisionDiff | null>(null);
  const [canvasView, setCanvasView] = useState<CanvasView>("map");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalStates, setProposalStates] = useState<Record<string, string>>({});
  const [directorOpen, setDirectorOpen] = useState(false);

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
    return (await response.json()) as T;
  }, []);

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

  const loadStudio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const identitiesResponse = await fetch(`${pipelineBase}/development/identities`);
      if (!identitiesResponse.ok) throw new Error("Could not load your teacher identity.");
      const identities = (await identitiesResponse.json()) as DevelopmentIdentity[];
      const instructors = identities.filter((candidate) => candidate.role === "instructor");
      const remembered = window.localStorage.getItem(instructorStorageKey);
      const user = instructors.find((candidate) => candidate.id === remembered) ?? instructors[0];
      if (!user) throw new Error("No instructor identity is available.");
      window.localStorage.setItem(instructorStorageKey, user.id);
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
      if (courseResult.pending_review_count > 0) setCanvasView("review");
      else if (courseResult.status === "published") setCanvasView("overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the course studio.");
    } finally {
      setLoading(false);
    }
  }, [courseId, refreshArtifacts, refreshRevisionDiff, request]);

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
            await refreshRevisionDiff(identity, nextCourse);
            setCanvasView("review");
          }
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not refresh generation."));
    }, 2200);
    return () => window.clearInterval(interval);
  }, [courseId, identity, refreshArtifacts, refreshRevisionDiff, request, run]);

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

  async function openWorkingRevision() {
    if (!identity) return;
    setSending(true);
    setError(null);
    try {
      const nextCourse = await request<CourseSummary>(
        `/courses/${courseId}/working-revision`,
        identity,
        { method: "POST" },
      );
      setCourse(nextCourse);
      setMessages(await request<CourseMessage[]>(`/courses/${courseId}/messages`, identity));
      await refreshArtifacts(identity);
      await refreshRevisionDiff(identity, nextCourse);
      setCanvasView("changes");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open an update revision.");
    } finally {
      setSending(false);
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
      aria-labelledby="conversation-title"
    >
      <div className={styles.panelHeader}>
        <div className={styles.directorIdentity}><MessageSquareText /><span><strong id="conversation-title">Course Director</strong><small>Manifold</small></span></div>
        {!focusedCreation ? (
          <div className={styles.panelHeaderActions}>
            <button aria-label="Close Course Director" onClick={() => setDirectorOpen(false)} type="button"><X /></button>
          </div>
        ) : null}
      </div>
      <div className={styles.messageList}>
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            proposalStates={proposalStates}
            onResolve={resolveProposal}
          />
        ))}

        {(course?.source_count ?? 0) === 0 ? (
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
              ? "Paste a lecture link, or tell Manifold about the course…"
              : "Ask about or change this course…"}
          rows={focusedCreation ? 4 : 3}
          value={composer}
        />
        <div>
          <button aria-label="Attach lecture" disabled={editingLocked} onClick={() => fileInput.current?.click()} type="button"><Paperclip /></button>
          <span>Enter to send · Shift + Enter for a new line</span>
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
            {editingLocked ? (
              <button disabled={sending} onClick={() => void openWorkingRevision()} type="button">Edit course</button>
            ) : (
              <button disabled={!canPublish || sending} onClick={() => void publishRevision()} type="button">
                {course?.status === "published" ? "Publish updates" : "Publish course"}
              </button>
            )}
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
                {course?.status !== "published" || course.working_revision_id ? <CanvasTab active={canvasView === "review"} badge={course?.pending_review_count || undefined} icon={<ClipboardCheck />} label="Review" onClick={() => setCanvasView("review")} /> : null}
                {course?.status === "published" ? <CanvasTab active={canvasView === "assessments"} icon={<Check />} label="Assessments" onClick={() => setCanvasView("assessments")} /> : null}
                <CanvasTab active={canvasView === "insights"} badge={course?.open_signal_count || undefined} icon={<Lightbulb />} label="Insights" onClick={() => setCanvasView("insights")} />
                <CanvasTab active={canvasView === "preview"} icon={<Eye />} label="Preview" onClick={() => setCanvasView("preview")} />
                {course?.status === "published" ? <CanvasTab active={canvasView === "settings"} icon={<GitFork />} label="Settings" onClick={() => setCanvasView("settings")} /> : null}
                {course?.active_revision_id && course.working_revision_id ? <CanvasTab active={canvasView === "changes"} badge={revisionDiff?.changes.length || undefined} icon={<Pencil />} label="Changes" onClick={() => setCanvasView("changes")} /> : null}
              </nav>
              <div className={styles.canvasBody}>
                {canvasView === "overview" ? <OverviewCanvas course={course} revisionDiff={revisionDiff} /> : null}
                {canvasView === "map" ? <CourseMapCanvas courseMap={courseMap} run={run} /> : null}
                {canvasView === "review" ? <ReviewCanvas bundles={bundles} onBundle={decideBundle} onItem={decideItem} /> : null}
                {canvasView === "assessments" ? <FocusedBundleCanvas artifactTypes={["question"]} bundles={bundles} empty="No assessment decisions are available." onItem={decideItem} /> : null}
                {canvasView === "insights" ? <InsightsCanvas course={course} /> : null}
                {canvasView === "preview" ? <PreviewCanvas course={course} /> : null}
                {canvasView === "settings" ? <FocusedBundleCanvas artifactTypes={["routing_policy"]} bundles={bundles} empty="No routing settings are available." onItem={decideItem} /> : null}
                {canvasView === "changes" ? <ChangesCanvas revisionDiff={revisionDiff} /> : null}
              </div>
              </section>
              <button aria-expanded={directorOpen} aria-label="Open Course Director" className={styles.directorLauncher} onClick={() => setDirectorOpen((current) => !current)} type="button">
                <MessageCircleMore />
                <span>Course Director</span>
              </button>
              {directorOpen ? <aside className={styles.directorDock}>{courseDirector}</aside> : null}
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
        {run.tasks.map((task) => <li data-status={task.status} key={task.id}><i />{generationPhaseLabel(task.task_type)}<span>{task.status}</span></li>)}
      </ul>
      {failed ? <button onClick={onRetry} type="button"><RotateCcw />Retry failed step</button> : null}
    </article>
  );
}

function GenerationActivityLabel({ label }: { label: string }) {
  return <article className={styles.generationActivity}><div><span><LoaderCircle className={styles.spin} /></span><div><strong>{label}</strong><small>This will continue if you leave.</small></div></div></article>;
}

function CanvasTab({ active, badge, icon, label, onClick }: { active: boolean; badge?: number; icon: ReactNode; label: string; onClick: () => void }) {
  return <button aria-pressed={active} onClick={onClick} type="button">{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>;
}

function CourseMapCanvas({ courseMap, run }: { courseMap: CourseMap | null; run: GenerationRun | null }) {
  const [topicId, setTopicId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const graph = useMemo(() => mapToFlow(courseMap, topicId, artifactId), [artifactId, courseMap, topicId]);
  if (!courseMap?.nodes.length) {
    return (
      <div className={styles.canvasEmpty}>
        <span className={styles.mapConstellation}><i /><i /><i /><i /></span>
        <p className={styles.eyebrow}>Live artifact canvas</p>
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
        <div><p className={styles.eyebrow}>Semantic course map</p><h2>{activeArtifact?.title ?? activeTopic?.title ?? `${topics.length} topics · ${courseMap.nodes.filter((node) => node.kind === "concept").length} concepts`}</h2></div>
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
          <ReactFlow edges={graph.edges} fitView fitViewOptions={{ padding: 0.25 }} nodes={graph.nodes} nodesConnectable={false} nodesDraggable onNodeClick={(_, node) => selectNode(node.id)} panOnScroll proOptions={{ hideAttribution: true }}>
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
  if (!active) return <div className={styles.canvasEmpty}><ClipboardList /><p className={styles.eyebrow}>Human review</p><h2>No review bundle yet</h2><p>Manifold will assemble a small set of high-leverage decisions after the full private draft is built.</p></div>;
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
        <header><div><p className={styles.eyebrow}>Review bundle</p><h2>{active.title}</h2><p>{active.summary}</p></div>{pending.length ? <button onClick={() => onBundle(active)} type="button"><Check />Approve remaining {pending.length}</button> : <span><Check />Bundle complete</span>}</header>
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

function OverviewCanvas({ course, revisionDiff }: {
  course: CourseSummary | null;
  revisionDiff: RevisionDiff | null;
}) {
  return (
    <div className={styles.overviewCanvas}>
      <div>
        <p className={styles.eyebrow}>Published course workspace</p>
        <h2>{course?.title}</h2>
        <p>The live revision stays stable while Manifold and your edits accumulate privately.</p>
      </div>
      <section>
        <article><small>Course structure</small><strong>{course?.topic_count ?? 0} topics</strong><p>{course?.concept_count ?? 0} mapped concepts</p></article>
        <article><small>Learner evidence</small><strong>{course?.open_signal_count ?? 0} open insights</strong><p>Only evidence-backed teaching decisions appear here.</p></article>
        <article><small>Revision state</small><strong>{course?.working_revision_id ? "Private update" : "Live"}</strong><p>{revisionDiff ? `${revisionDiff.changes.length} visible changes before publish` : "No unpublished changes"}</p></article>
      </section>
    </div>
  );
}

function FocusedBundleCanvas({ artifactTypes, bundles, empty, onItem }: {
  artifactTypes: string[];
  bundles: ReviewBundle[];
  empty: string;
  onItem: (item: ReviewItem, decision: Decision, revision?: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [revision, setRevision] = useState("");
  const items = bundles.flatMap((bundle) => bundle.items).filter((item) => artifactTypes.includes(item.artifact_type));
  if (!items.length) return <div className={styles.canvasEmpty}><Check /><p className={styles.eyebrow}>Reviewed workspace</p><h2>{empty}</h2><p>Open a working revision before changing live course artifacts.</p></div>;
  return (
    <div className={styles.focusedCanvas}>
      <header><p className={styles.eyebrow}>Structured artifacts</p><h2>{artifactTypes.includes("question") ? "Assessments" : "Adaptive settings"}</h2><p>Structured records remain authoritative; AI-originated changes keep the same Accept, Edit, or Dismiss checkpoint.</p></header>
      <div>
        {items.map((item) => (
          <article data-status={item.status} key={item.id}>
            <span>{artifactLabel(item.artifact_type)}</span>
            <h3>{evidenceTitle(item)}</h3>
            <EvidenceSummary item={item} />
            {editing?.id === item.id ? (
              <div className={styles.editReview}>
                <label>Revise this artifact<textarea onChange={(event) => setRevision(event.target.value)} rows={8} value={revision} /></label>
                <div><button onClick={() => setEditing(null)} type="button">Cancel</button><button disabled={!safeJson(revision)} onClick={() => { const value = safeJson(revision); if (value) { void onItem(item, "edited", value); setEditing(null); } }} type="button"><Check />Save edit</button></div>
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
  );
}

function ChangesCanvas({ revisionDiff }: { revisionDiff: RevisionDiff | null }) {
  if (!revisionDiff) return <div className={styles.canvasEmpty}><Pencil /><p className={styles.eyebrow}>Versioned updates</p><h2>No private update is open</h2><p>Open an update revision to change the live course without disrupting current learners.</p></div>;
  return (
    <div className={styles.changesCanvas}>
      <header><div><p className={styles.eyebrow}>Working revision diff</p><h2>{revisionDiff.changes.length} unpublished changes</h2><p>The active learner revision remains untouched until you choose Publish updates.</p></div></header>
      {revisionDiff.changes.length ? (
        <div>{revisionDiff.changes.map((change) => (
          <article data-change={change.change_type} key={`${change.artifact_type}-${change.logical_artifact_id}`}>
            <span>{change.change_type}</span><strong>{artifactLabel(change.artifact_type)}</strong>
            <small>{change.logical_artifact_id.slice(0, 8)}</small>
            <details><summary>Inspect before and after</summary><div><pre>{JSON.stringify(change.before_state, null, 2)}</pre><pre>{JSON.stringify(change.after_state, null, 2)}</pre></div></details>
          </article>
        ))}</div>
      ) : <div className={styles.canvasEmpty}><Check /><h2>No content changes yet</h2><p>Accepted chat directives and structured edits will appear here before publishing.</p></div>}
    </div>
  );
}

function InsightsCanvas({ course }: { course: CourseSummary | null }) {
  return <div className={styles.insightsCanvas}><div><p className={styles.eyebrow}>Evidence, not noise</p><h2>Teaching insights</h2><p>Manifold surfaces issues only when learner evidence supports a useful intervention.</p></div><section><article><small>Open insights</small><strong>{course?.open_signal_count ?? 0}</strong><p>{course?.status === "published" ? "Evidence-backed proposals awaiting your judgment." : "Insights begin after learners use the published course."}</p></article><article><small>Review principle</small><strong>Accept · Edit · Dismiss</strong><p>No diagnosis changes a live course without your decision.</p></article></section></div>;
}

function PreviewCanvas({ course }: { course: CourseSummary | null }) {
  return <div className={styles.previewCanvas}><div className={styles.previewFrame}><span>MANIFOLD · LEARNER PREVIEW</span><h2>{course?.title ?? "Your course"}</h2><p>The learner path will adapt here from reviewed concepts, questions, and remediation clips.</p><button disabled type="button"><Send />Begin course</button></div><aside><p className={styles.eyebrow}>Preview is safe</p><h3>See what learners will see</h3><p>Preview uses the private working revision and never exposes unreviewed material to enrolled learners.</p></aside></div>;
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
        position: { x: originX, y: originY },
        data: { label: topic.title },
        style: { background: "#202126", border: "0", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 650, lineHeight: 1.35, padding: 15, width: 380 },
      });
      concepts.filter((concept) => concept.topic_id === topic.id).forEach((concept, conceptIndex) => {
        nodes.push({
          id: concept.id,
          position: {
            x: originX + (conceptIndex % 2) * 194,
            y: originY + 104 + Math.floor(conceptIndex / 2) * 82,
          },
          data: { label: concept.title },
          style: { background: "#fff", border: "1px solid #d6d2c9", borderRadius: 9, color: "#292930", fontSize: 12, lineHeight: 1.35, padding: 12, width: 180 },
        });
      });
    });
    const unlinked = concepts.filter((concept) => !concept.topic_id);
    unlinked.forEach((concept, index) => {
      nodes.push({
        id: concept.id,
        position: { x: (index % columns) * 210, y: nextOffset + Math.floor(index / columns) * 76 },
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
    position: { x: 30, y: 40 + index * 170 },
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
      position: { x: 340 + (current % 2) * 210, y: 28 + topicIndex * 170 + Math.floor(current / 2) * 62 },
      data: { label: concept.title },
      style: { background: concept.status === "dismissed" ? "#f3f1ed" : "#fff", border: "1px solid #d9d7d0", borderRadius: 9, color: "#292930", fontSize: 12, padding: 11, width: 190 },
    });
  });
  const containment: Edge[] = concepts.filter((concept) => concept.topic_id).map((concept) => ({ id: `topic-${concept.id}`, source: concept.topic_id!, target: concept.id, type: "smoothstep", style: { stroke: "#c5c3bc", strokeWidth: 1 } }));
  const prerequisite: Edge[] = courseMap.edges.filter((edge) => focusIds.has(edge.source_id) && focusIds.has(edge.target_id)).map((edge) => ({ id: edge.id, source: edge.source_id, target: edge.target_id, type: "smoothstep", animated: edge.status === "proposed", markerEnd: { type: MarkerType.ArrowClosed, color: "#c7762d" }, style: { stroke: "#c7762d", strokeWidth: 1.5 } }));
  return { nodes, edges: [...containment, ...prerequisite] };
}

function artifactLabel(value: string) { return value.replaceAll("_", " "); }
function looksLikeUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeJson(value: string): Record<string, unknown> | null { try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : null; } catch { return null; } }
async function responseDetail(response: Response, fallback: string) { const payload = (await response.json().catch(() => null)) as { detail?: string } | null; return payload?.detail ?? fallback; }
