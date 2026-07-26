"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Download,
  FileText,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  MessageCircleQuestion,
  Play,
  RotateCcw,
  Route,
  Send,
  Sparkles,
  X,
} from "lucide-react";

import { ProviderVideo } from "../../../ProviderVideo";
import {
  readDevelopmentSession,
  type DevelopmentSession,
} from "../../../developmentSession";
import { LearnerSidebar } from "../../learner-sidebar";
import {
  activeTranscriptWordIndex,
  learnerPathVisualState,
  type LearnerCourseExperience,
  type LearnerPath,
  type LearnerPathItem,
  type LearnerPathVisualState,
  type LearnerPlacement,
  type LearnerSessionStep,
  type LearnerStudySession,
  type LearnerTranscriptWord,
  type LearnerWorkspace,
} from "../../learner-course";
import styles from "../../learner.module.css";

const pipelineBase =
  process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";

type TranscriptResponse = {
  clip_id: string;
  duration_seconds: number;
  timing_basis: "clip_relative";
  words: LearnerTranscriptWord[];
};

type AnswerResponse = {
  session: LearnerStudySession;
  correct: boolean;
  feedback: string;
  route: {
    action: string;
    mastery_state: string;
    why: string;
    target_concept_id: string | null;
    target_clip_id: string | null;
  };
};

type GuideResult = {
  kind: string;
  title?: string;
  message?: string;
  excerpt?: string;
  page_number?: number;
  concept_id?: string;
  clip_id?: string;
  question_id?: string;
  eligible?: boolean;
};

export function LearnerCoursePlayer({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [identity, setIdentity] = useState<DevelopmentSession | null>(null);
  const [course, setCourse] = useState<LearnerCourseExperience | null>(null);
  const [path, setPath] = useState<LearnerPath | null>(null);
  const [workspace, setWorkspace] = useState<LearnerWorkspace | null>(null);
  const [studySession, setStudySession] = useState<LearnerStudySession | null>(null);
  const [completedSession, setCompletedSession] =
    useState<LearnerStudySession | null>(null);
  const [budget, setBudget] = useState(20);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AnswerResponse | null>(null);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideResult, setGuideResult] = useState<GuideResult | null>(null);
  const [masteryOpen, setMasteryOpen] = useState(false);
  const [inspectedConceptId, setInspectedConceptId] = useState<string | null>(null);
  const [helpPreview, setHelpPreview] =
    useState<Record<string, unknown> | null>(null);
  const [helpNote, setHelpNote] = useState("");
  const [helpSent, setHelpSent] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflectionNote, setReflectionNote] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "X-User-ID": identity?.id ?? "",
    }),
    [identity?.id],
  );

  const load = useCallback(async () => {
    const nextIdentity = readDevelopmentSession(window.localStorage);
    if (!nextIdentity || nextIdentity.role !== "learner") {
      router.replace("/login");
      return;
    }
    setIdentity(nextIdentity);
    setLoading(true);
    setError(null);
    try {
      const requestHeaders = { "X-User-ID": nextIdentity.id };
      const [courseResponse, pathResponse, workspaceResponse] = await Promise.all([
        fetch(`${pipelineBase}/learners/me/courses/${courseId}`, {
          headers: requestHeaders,
        }),
        fetch(`${pipelineBase}/learners/me/courses/${courseId}/path`, {
          headers: requestHeaders,
        }),
        fetch(`${pipelineBase}/learn/courses/${courseId}/workspace`, {
          headers: requestHeaders,
        }),
      ]);
      if ([courseResponse, pathResponse, workspaceResponse].some(
        (response) => response.status === 403,
      )) {
        router.replace("/learn");
        return;
      }
      if (!courseResponse.ok || !pathResponse.ok || !workspaceResponse.ok) {
        throw new Error("Could not prepare this course workspace.");
      }
      const nextCourse =
        (await courseResponse.json()) as LearnerCourseExperience;
      const nextPath = (await pathResponse.json()) as LearnerPath;
      const nextWorkspace = (await workspaceResponse.json()) as LearnerWorkspace;
      setCourse(nextCourse);
      setPath(nextPath);
      setWorkspace(nextWorkspace);
      setStudySession(nextWorkspace.session);
      setBudget(
        nextWorkspace.session?.budget_minutes ??
          nextWorkspace.orientation.default_time_budget_minutes ??
          20,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not prepare this course workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [courseId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeStep = studySession?.steps.find((step) => step.status === "active")
    ?? studySession?.steps.find((step) => step.status === "pending")
    ?? null;
  const activeConcept = path?.items.find(
    (item) => item.concept_id === activeStep?.concept_id,
  ) ?? path?.items.find((item) => item.current) ?? null;
  const activeClip = activeStep?.clip_id
    ? course?.clips.find((clip) => clip.id === activeStep.clip_id) ?? null
    : null;
  const activeQuestion = activeStep?.question_id
    ? course?.questions.find((question) => question.id === activeStep.question_id)
      ?? null
    : null;
  const activeTopic = activeConcept?.topic_id
    ? course?.topics.find((topic) => topic.id === activeConcept.topic_id) ?? null
    : null;
  const completedSteps =
    studySession?.steps.filter((step) => step.status === "completed").length ?? 0;
  const totalMinutes =
    studySession?.steps.reduce((sum, step) => sum + step.estimated_minutes, 0) ?? 0;
  const activeTranscriptIndex = activeTranscriptWordIndex(
    transcript?.words ?? [],
    playbackSeconds,
  );

  useEffect(() => {
    setPlaybackSeconds(0);
    setTranscript(null);
    setTranscriptError(null);
    if (!identity || !activeClip) return;
    const controller = new AbortController();
    setTranscriptLoading(true);
    void fetch(
      `${pipelineBase}/learn/courses/${courseId}/clips/${activeClip.id}/transcript`,
      {
        headers: { "X-User-ID": identity.id },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Transcript is unavailable for this clip.");
        return (await response.json()) as TranscriptResponse;
      })
      .then(setTranscript)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setTranscriptError(
          caught instanceof Error
            ? caught.message
            : "Transcript is unavailable for this clip.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTranscriptLoading(false);
      });
    return () => controller.abort();
  }, [activeClip, courseId, identity]);

  async function mutate<T>(url: string, method: string, body?: object): Promise<T> {
    const response = await fetch(`${pipelineBase}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { detail?: string })
      | null;
    if (!response.ok || !payload) {
      throw new Error(payload?.detail ?? "Manifold could not complete that action.");
    }
    return payload;
  }

  async function completeOrientation(
    choice: "recommended" | "placement" | "foundations",
  ) {
    setBusy(true);
    setError(null);
    try {
      await mutate(
        `/learn/courses/${courseId}/orientation`,
        "PUT",
        {
          entry_choice: choice,
          time_budget_minutes: budget,
          immediate_goal:
            choice === "foundations"
              ? "Review foundations before advancing"
              : "Continue efficiently",
        },
      );
      if (choice === "placement") {
        const placement = await mutate<LearnerPlacement>(
          `/learn/courses/${courseId}/placement`,
          "POST",
          { idempotency_key: `placement:${identity?.id}:${courseId}` },
        );
        setWorkspace((current) =>
          current
            ? {
                ...current,
                orientation: {
                  ...current.orientation,
                  completed: true,
                  entry_choice: choice,
                },
                placement,
              }
            : current,
        );
      } else {
        setWorkspace((current) =>
          current
            ? {
                ...current,
                orientation: {
                  ...current.orientation,
                  completed: true,
                  entry_choice: choice,
                },
              }
            : current,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Orientation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function answerPlacement(
    event: FormEvent<HTMLFormElement>,
    placement: LearnerPlacement,
    itemId: string,
  ) {
    event.preventDefault();
    if (!answer || confidence === null) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await mutate<LearnerPlacement>(
        `/learn/courses/${courseId}/placement/${placement.id}/items/${itemId}/answer`,
        "POST",
        { answer, confidence },
      );
      setWorkspace((current) =>
        current ? { ...current, placement: updated } : current,
      );
      setAnswer("");
      setConfidence(null);
      if (updated.status === "completed") await refreshEvidence();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Placement answer failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(conceptId?: string) {
    setBusy(true);
    setError(null);
    try {
      const nextSession = await mutate<LearnerStudySession>(
        `/learn/courses/${courseId}/sessions`,
        "POST",
        {
          goal:
            workspace?.orientation.entry_choice === "foundations"
              ? "review"
              : "continue",
          budget_minutes: budget,
          idempotency_key: `session:${identity?.id}:${courseId}:${Date.now()}`,
          concept_id: conceptId ?? null,
        },
      );
      setStudySession(nextSession);
      setCompletedSession(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plan could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function startPlan() {
    if (!studySession) return;
    setBusy(true);
    setError(null);
    try {
      setStudySession(
        await mutate<LearnerStudySession>(
          `/learn/courses/${courseId}/sessions/${studySession.id}/start`,
          "POST",
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Session could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function adjustPlan(nextBudget: number, conceptId?: string) {
    setBudget(nextBudget);
    if (!studySession) return;
    setBusy(true);
    setError(null);
    try {
      setStudySession(
        await mutate<LearnerStudySession>(
          `/learn/courses/${courseId}/sessions/${studySession.id}/budget`,
          "PUT",
          { budget_minutes: nextBudget, concept_id: conceptId ?? null },
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plan could not adjust.");
    } finally {
      setBusy(false);
    }
  }

  async function recordWatch(watchedSeconds: number) {
    if (!identity || !activeClip) return;
    await fetch(`${pipelineBase}/courses/${courseId}/watch-events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        video_id: activeClip.video_id,
        clip_id: activeClip.id,
        path_mode: "adaptive",
        watched_seconds: watchedSeconds,
      }),
    });
  }

  async function continueFromWatch() {
    if (!studySession || !activeStep) return;
    setBusy(true);
    setError(null);
    try {
      setStudySession(
        await mutate<LearnerStudySession>(
          `/learn/courses/${courseId}/sessions/${studySession.id}/steps/${activeStep.id}/watch`,
          "POST",
        ),
      );
      setFeedback(null);
      setHint(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Session could not continue.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studySession || !activeStep || !answer.trim() || confidence === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mutate<AnswerResponse>(
        `/learn/courses/${courseId}/sessions/${studySession.id}/steps/${activeStep.id}/answer`,
        "POST",
        { answer: answer.trim(), confidence },
      );
      setStudySession(result.session);
      setFeedback(result);
      setAnswer("");
      setConfidence(null);
      setHint(null);
      await refreshEvidence();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Answer could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReflection() {
    if (!studySession || !reflection) return;
    setBusy(true);
    setError(null);
    try {
      const finished = await mutate<LearnerStudySession>(
        `/learn/courses/${courseId}/sessions/${studySession.id}/reflection`,
        "POST",
        {
          self_report: reflection,
          note: reflectionNote,
          concept_id: activeConcept?.concept_id ?? null,
        },
      );
      setCompletedSession(finished);
      setStudySession(null);
      setReflection(null);
      setReflectionNote("");
      await refreshEvidence();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Reflection could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshEvidence() {
    if (!identity) return;
    const [pathResponse, workspaceResponse] = await Promise.all([
      fetch(`${pipelineBase}/learners/me/courses/${courseId}/path`, {
        headers: { "X-User-ID": identity.id },
      }),
      fetch(`${pipelineBase}/learn/courses/${courseId}/workspace`, {
        headers: { "X-User-ID": identity.id },
      }),
    ]);
    if (pathResponse.ok) setPath((await pathResponse.json()) as LearnerPath);
    if (workspaceResponse.ok) {
      const next = (await workspaceResponse.json()) as LearnerWorkspace;
      setWorkspace(next);
    }
  }

  async function runGuideAction(action: string) {
    setGuideOpen(true);
    setGuideResult(null);
    setError(null);
    if (action === "stuck") {
      await previewHelp();
      return;
    }
    if (action === "approved_hint" && studySession && activeStep) {
      setBusy(true);
      try {
        const result = await mutate<{ hint: string }>(
          `/learn/courses/${courseId}/sessions/${studySession.id}/steps/${activeStep.id}/hint`,
          "POST",
        );
        setHint(result.hint);
        setGuideResult({
          kind: "hint",
          title: "Instructor-approved hint",
          message: result.hint,
        });
      } catch (caught) {
        setGuideResult({
          kind: "unavailable",
          title: "No approved hint available",
          message:
            caught instanceof Error ? caught.message : "No approved hint is available.",
        });
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const result = await mutate<GuideResult>(
        `/learn/courses/${courseId}/guide/${action}`,
        "POST",
      );
      if (
        ["clip", "question", "concept"].includes(result.kind)
        && result.concept_id
        && result.eligible !== false
      ) {
        if (studySession) {
          await adjustPlan(studySession.budget_minutes, result.concept_id);
        } else {
          await createPlan(result.concept_id);
        }
        setGuideOpen(false);
        setGuideResult(null);
      } else {
        setGuideResult(result);
      }
    } catch (caught) {
      setGuideResult({
        kind: "unavailable",
        title: "Action unavailable",
        message: caught instanceof Error ? caught.message : "This action is unavailable.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function previewHelp() {
    setBusy(true);
    try {
      setHelpPreview(
        await mutate<Record<string, unknown>>(
          `/learn/courses/${courseId}/help/preview`,
          "POST",
          {
            session_id: studySession?.id ?? null,
            concept_id: activeConcept?.concept_id ?? null,
          },
        ),
      );
      setHelpSent(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Help preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendHelp() {
    setBusy(true);
    try {
      await mutate(
        `/learn/courses/${courseId}/help`,
        "POST",
        {
          session_id: studySession?.id ?? null,
          concept_id: activeConcept?.concept_id ?? null,
          learner_note: helpNote,
        },
      );
      setHelpSent(true);
      setHelpNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Help request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadResource(
    resource: LearnerCourseExperience["resources"][number],
  ) {
    if (!identity) return;
    const response = await fetch(
      `${pipelineBase}/learners/me/courses/${courseId}/resources/${resource.id}`,
      { headers: { "X-User-ID": identity.id } },
    );
    if (!response.ok) {
      setError("This approved course resource could not be downloaded.");
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = resource.filename;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  if (!identity || loading) {
    return (
      <div className={styles.fullLoader}>
        <LoaderCircle />
        <span>Preparing your learning session</span>
      </div>
    );
  }
  if (!course || !path || !workspace) {
    return (
      <div className={styles.fullLoader}>
        <span>{error ?? "This reviewed course is not available."}</span>
      </div>
    );
  }

  const placement = workspace.placement;
  const pendingPlacement = placement?.items.find((item) => item.status === "pending");
  const showPlacement =
    workspace.orientation.entry_choice === "placement"
    && placement
    && placement.status === "in_progress";

  return (
    <div className={styles.courseShell}>
      <LearnerSidebar active="course" session={identity} />
      <main className={styles.courseMain}>
        <header className={styles.courseTopbar}>
          <Link aria-label="Back to learner dashboard" href="/learn">
            <ArrowLeft />
          </Link>
          <div>
            <small>Enrolled course</small>
            <strong>{course.title}</strong>
          </div>
          <nav aria-label="Course tools" className={styles.learnerTools}>
            {course.resources.length ? (
              <details>
                <summary>
                  <FileText />
                  Resources
                </summary>
                <div>
                  {course.resources.map((resource) => (
                    <button
                      key={resource.id}
                      onClick={() => void downloadResource(resource)}
                      type="button"
                    >
                      <span>{resource.filename}</span>
                      <Download />
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
            <button onClick={() => setMasteryOpen((open) => !open)} type="button">
              <ListChecks />
              Mastery
            </button>
            <button onClick={() => setGuideOpen(true)} type="button">
              <Sparkles />
              Learning Guide
            </button>
          </nav>
        </header>

        {!workspace.orientation.completed ? (
          <Orientation
            budget={budget}
            busy={busy}
            courseTitle={course.title}
            onBudget={setBudget}
            onChoose={(choice) => void completeOrientation(choice)}
          />
        ) : showPlacement ? (
          <PlacementStage
            answer={answer}
            busy={busy}
            confidence={confidence}
            error={error}
            onAnswer={setAnswer}
            onConfidence={setConfidence}
            onSubmit={(event) => {
              if (pendingPlacement) {
                void answerPlacement(event, placement, pendingPlacement.id);
              }
            }}
            placement={placement}
          />
        ) : completedSession ? (
          <SessionClose
            mastery={workspace.mastery}
            onNext={() => {
              setCompletedSession(null);
              void createPlan();
            }}
            session={completedSession}
          />
        ) : !studySession ? (
          <SessionPlanner
            budget={budget}
            busy={busy}
            contentMessage={
              placement?.status === "unavailable"
                ? placement.unavailable_reason
                : workspace.content_message
            }
            onBudget={setBudget}
            onCreate={() => void createPlan()}
            path={path}
          />
        ) : studySession.status === "planned" ? (
          <SessionPlan
            budget={budget}
            busy={busy}
            onAdjust={(minutes) => void adjustPlan(minutes)}
            onStart={() => void startPlan()}
            session={studySession}
          />
        ) : (
          <div className={styles.learningWorkspace}>
            <section className={styles.sessionActivity}>
              <SessionHeader
                activeStep={activeStep}
                activeTopic={activeTopic?.title ?? activeConcept?.name ?? "Learning session"}
                completed={completedSteps}
                session={studySession}
              />
              {feedback ? (
                <div
                  className={styles.routeUpdate}
                  data-tone={feedback.correct ? "success" : "support"}
                  role="status"
                >
                  <strong>
                    {feedback.correct ? "Evidence updated" : "Your plan adjusted"}
                  </strong>
                  <p>{feedback.feedback}</p>
                  <span>{feedback.route.why}</span>
                </div>
              ) : null}
              {activeStep?.kind === "watch" ? (
                <WatchStage
                  clip={activeClip}
                  error={transcriptError}
                  identity={identity}
                  loading={transcriptLoading}
                  onContinue={() => void continueFromWatch()}
                  onPlayback={setPlaybackSeconds}
                  onWatch={recordWatch}
                  transcript={transcript}
                  transcriptIndex={activeTranscriptIndex}
                />
              ) : activeStep?.kind === "question" ? (
                <PracticeStage
                  answer={answer}
                  busy={busy}
                  confidence={confidence}
                  hint={hint}
                  onAnswer={setAnswer}
                  onConfidence={setConfidence}
                  onHint={() => void runGuideAction("approved_hint")}
                  onSubmit={(event) => void submitAnswer(event)}
                  question={activeQuestion}
                  step={activeStep}
                />
              ) : activeStep?.kind === "reflect"
                || studySession.status === "reflecting" ? (
                <ReflectStage
                  busy={busy}
                  note={reflectionNote}
                  onNote={setReflectionNote}
                  onSelect={setReflection}
                  onSubmit={() => void submitReflection()}
                  selected={reflection}
                />
              ) : (
                <HonestUnavailable message="This session step is no longer available in the reviewed course revision." />
              )}
              {error ? (
                <p className={styles.feedback} role="alert">
                  {error}
                </p>
              ) : null}
            </section>

            <aside aria-label="Active study plan" className={styles.sessionRail}>
              <header>
                <span>
                  <Clock3 />
                  {studySession.budget_minutes} minute session
                </span>
                <strong>{totalMinutes} min of reviewed work</strong>
              </header>
              <ol>
                {studySession.steps.map((step) => (
                  <li data-status={step.status} key={step.id}>
                    <span>
                      {step.status === "completed" ? (
                        <Check />
                      ) : step.status === "active" ? (
                        <Play />
                      ) : (
                        step.ordinal + 1
                      )}
                    </span>
                    <div>
                      <strong>{stepLabel(step)}</strong>
                      <small>{step.estimated_minutes} min · {step.reason}</small>
                    </div>
                  </li>
                ))}
              </ol>
              <details>
                <summary>
                  Adjust remaining time
                  <ChevronDown />
                </summary>
                <div>
                  {[10, 20, 30].map((minutes) => (
                    <button
                      disabled={busy}
                      key={minutes}
                      onClick={() => void adjustPlan(minutes)}
                      type="button"
                    >
                      {minutes} min
                    </button>
                  ))}
                </div>
              </details>
            </aside>
          </div>
        )}

        {masteryOpen ? (
          <MasteryDrawer
            inspectedConceptId={inspectedConceptId}
            mastery={workspace.mastery}
            onClose={() => setMasteryOpen(false)}
            onInspect={setInspectedConceptId}
            onSelect={(conceptId) => {
              const item = path.items.find(
                (candidate) => candidate.concept_id === conceptId,
              );
              if (!item?.eligible || item.actionable === false) return;
              setMasteryOpen(false);
              if (studySession) {
                void adjustPlan(studySession.budget_minutes, conceptId);
              } else {
                void createPlan(conceptId);
              }
            }}
            path={path}
          />
        ) : null}

        {guideOpen ? (
          <GuideDrawer
            actions={workspace.guide_actions}
            busy={busy}
            guideResult={guideResult}
            helpNote={helpNote}
            helpPreview={helpPreview}
            helpSent={helpSent}
            onAction={(action) => void runGuideAction(action)}
            onClose={() => {
              setGuideOpen(false);
              setGuideResult(null);
              setHelpPreview(null);
            }}
            onHelpNote={setHelpNote}
            onSendHelp={() => void sendHelp()}
          />
        ) : null}
      </main>
    </div>
  );
}

function Orientation({
  budget,
  busy,
  courseTitle,
  onBudget,
  onChoose,
}: {
  budget: number;
  busy: boolean;
  courseTitle: string;
  onBudget: (minutes: number) => void;
  onChoose: (choice: "recommended" | "placement" | "foundations") => void;
}) {
  return (
    <section className={styles.orientation}>
      <span className={styles.guideIdentity}>
        <Sparkles />
        Manifold Learning Guide
      </span>
      <h1>Start {courseTitle} without wasting time.</h1>
      <p>
        I’ll use only instructor-reviewed lessons and questions, then explain every
        adjustment I make.
      </p>
      <div className={styles.timeChoice}>
        <strong>How much time do you have today?</strong>
        <div>
          {[10, 20, 30].map((minutes) => (
            <button
              aria-pressed={budget === minutes}
              key={minutes}
              onClick={() => onBudget(minutes)}
              type="button"
            >
              {minutes} minutes
            </button>
          ))}
        </div>
      </div>
      <div className={styles.orientationChoices}>
        <button disabled={busy} onClick={() => onChoose("recommended")} type="button">
          <Route />
          <span>
            <strong>Continue with the recommended path</strong>
            <small>Start from the strongest ready concept.</small>
          </span>
          <ArrowRight />
        </button>
        <button disabled={busy} onClick={() => onChoose("placement")} type="button">
          <Compass />
          <span>
            <strong>Show what I already know</strong>
            <small>Use reviewed questions to avoid repeating mastered material.</small>
          </span>
          <ArrowRight />
        </button>
        <button disabled={busy} onClick={() => onChoose("foundations")} type="button">
          <RotateCcw />
          <span>
            <strong>Review foundations first</strong>
            <small>Begin with a short confidence-building review.</small>
          </span>
          <ArrowRight />
        </button>
      </div>
    </section>
  );
}

function PlacementStage({
  answer,
  busy,
  confidence,
  error,
  onAnswer,
  onConfidence,
  onSubmit,
  placement,
}: {
  answer: string;
  busy: boolean;
  confidence: number | null;
  error: string | null;
  onAnswer: (answer: string) => void;
  onConfidence: (confidence: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  placement: LearnerPlacement;
}) {
  if (placement.status === "unavailable") {
    return (
      <section className={styles.centerStage}>
        <HonestUnavailable message={placement.unavailable_reason ?? "Placement is unavailable."} />
      </section>
    );
  }
  const item = placement.items.find((candidate) => candidate.status === "pending");
  if (!item) return null;
  const completed = placement.items.filter(
    (candidate) => candidate.status === "answered",
  ).length;
  return (
    <section className={styles.placementStage}>
      <header>
        <span>Placement check · {completed + 1} of {placement.items.length}</span>
        <h1>Show what you already know</h1>
        <p>
          This uses only instructor-reviewed questions. It may shorten your path; it
          will never invent a confidence score.
        </p>
      </header>
      <form className={styles.assessment} onSubmit={onSubmit}>
        <span>{item.concept_name}</span>
        <h2>{item.question_body}</h2>
        <AnswerFields
          answer={answer}
          busy={busy}
          choices={item.choices}
          confidence={confidence}
          confidencePrompt={item.confidence_prompt}
          onAnswer={onAnswer}
          onConfidence={onConfidence}
        />
        <button
          className={styles.assessmentSubmit}
          disabled={!answer || confidence === null || busy}
          type="submit"
        >
          {busy ? <LoaderCircle className={styles.spin} /> : <CheckCircle2 />}
          Check and continue
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

function SessionPlanner({
  budget,
  busy,
  contentMessage,
  onBudget,
  onCreate,
  path,
}: {
  budget: number;
  busy: boolean;
  contentMessage: string | null;
  onBudget: (minutes: number) => void;
  onCreate: () => void;
  path: LearnerPath;
}) {
  const current = path.items.find((item) => item.current);
  return (
    <section className={styles.sessionPlanner}>
      <span className={styles.guideIdentity}>
        <Sparkles />
        Manifold Learning Guide
      </span>
      <h1>Let’s make this session count.</h1>
      <p>
        I’ll assemble one complete learning loop from reviewed course material and
        adjust it when your evidence changes.
      </p>
      <div className={styles.plannerCard}>
        <div>
          <small>Recommended focus</small>
          <strong>{current?.name ?? "Reviewed course path"}</strong>
          <p>
            {current
              ? "Ready now, with reviewed teaching and a concept-linked check."
              : contentMessage}
          </p>
        </div>
        <div className={styles.timeChoice}>
          <strong>Available time</strong>
          <div>
            {[10, 20, 30].map((minutes) => (
              <button
                aria-pressed={budget === minutes}
                key={minutes}
                onClick={() => onBudget(minutes)}
                type="button"
              >
                {minutes} min
              </button>
            ))}
          </div>
        </div>
        <button
          className={styles.primaryAction}
          disabled={busy || !current}
          onClick={onCreate}
          type="button"
        >
          {busy ? <LoaderCircle className={styles.spin} /> : <Sparkles />}
          Prepare my session
        </button>
      </div>
    </section>
  );
}

function SessionPlan({
  budget,
  busy,
  onAdjust,
  onStart,
  session,
}: {
  budget: number;
  busy: boolean;
  onAdjust: (minutes: number) => void;
  onStart: () => void;
  session: LearnerStudySession;
}) {
  const estimate = session.steps.reduce(
    (sum, step) => sum + step.estimated_minutes,
    0,
  );
  return (
    <section className={styles.planStage}>
      <header>
        <span className={styles.guideIdentity}>
          <Sparkles />
          Manifold Learning Guide
        </span>
        <h1>Your {budget}-minute study session</h1>
        <p>
          {estimate} minutes of reviewed activity. Your time budget is a soft guide,
          so I’ll preserve one complete Learn → Practice → Reflect loop.
        </p>
      </header>
      <ol className={styles.planSteps}>
        {session.steps.map((step, index) => (
          <li key={step.id}>
            <span>{index + 1}</span>
            <div>
              <small>{step.kind}</small>
              <strong>{stepLabel(step)}</strong>
              <p>{step.reason}</p>
            </div>
            <em>{step.estimated_minutes} min</em>
          </li>
        ))}
      </ol>
      <footer>
        <div className={styles.timeChoice}>
          <strong>Adjust time</strong>
          <div>
            {[10, 20, 30].map((minutes) => (
              <button
                aria-pressed={budget === minutes}
                disabled={busy}
                key={minutes}
                onClick={() => onAdjust(minutes)}
                type="button"
              >
                {minutes} min
              </button>
            ))}
          </div>
        </div>
        <button className={styles.primaryAction} disabled={busy} onClick={onStart}>
          {busy ? <LoaderCircle className={styles.spin} /> : <Play />}
          Start session
        </button>
      </footer>
    </section>
  );
}

function SessionHeader({
  activeStep,
  activeTopic,
  completed,
  session,
}: {
  activeStep: LearnerSessionStep | null;
  activeTopic: string;
  completed: number;
  session: LearnerStudySession;
}) {
  return (
    <header className={styles.sessionHeader}>
      <div>
        <span>{activeStep ? stageName(activeStep) : "Session"}</span>
        <span>{completed + 1} of {session.steps.length}</span>
        {activeStep ? <span>{activeStep.estimated_minutes} min</span> : null}
      </div>
      <h1>{activeStep?.concept_name ?? activeTopic}</h1>
      <p>{activeStep?.reason}</p>
    </header>
  );
}

function WatchStage({
  clip,
  error,
  identity,
  loading,
  onContinue,
  onPlayback,
  onWatch,
  transcript,
  transcriptIndex,
}: {
  clip: LearnerCourseExperience["clips"][number] | null;
  error: string | null;
  identity: DevelopmentSession;
  loading: boolean;
  onContinue: () => void;
  onPlayback: (seconds: number) => void;
  onWatch: (seconds: number) => Promise<void>;
  transcript: TranscriptResponse | null;
  transcriptIndex: number;
}) {
  if (!clip) {
    return (
      <HonestUnavailable message="The reviewed clip for this concept is no longer available." />
    );
  }
  return (
    <>
      <div className={styles.player}>
        <ProviderVideo
          clipId={clip.id}
          clipMaterializationStatus={clip.materialization_status}
          endSeconds={clip.end_seconds}
          onClipComplete={(seconds) => void onWatch(seconds)}
          onPlaybackTimeUpdate={onPlayback}
          pipelineBaseUrl={pipelineBase}
          playback={{
            provider: clip.playback_provider,
            playback_id: clip.playback_id,
            playback_url: clip.playback_url,
            delivery_asset_id: clip.delivery_asset_id,
          }}
          startSeconds={clip.start_seconds}
          title={clip.title}
          videoId={clip.video_id}
          viewerId={identity.id}
        />
      </div>
      <SynchronizedTranscript
        activeWordIndex={transcriptIndex}
        error={error}
        loading={loading}
        words={transcript?.words ?? []}
      />
      <footer className={styles.activityFooter}>
        <span>
          <small>Up next</small>
          <strong>Practice with an approved question</strong>
        </span>
        <button onClick={onContinue} type="button">
          Continue
          <ArrowRight />
        </button>
      </footer>
    </>
  );
}

function PracticeStage({
  answer,
  busy,
  confidence,
  hint,
  onAnswer,
  onConfidence,
  onHint,
  onSubmit,
  question,
  step,
}: {
  answer: string;
  busy: boolean;
  confidence: number | null;
  hint: string | null;
  onAnswer: (value: string) => void;
  onConfidence: (value: number) => void;
  onHint: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  question: LearnerCourseExperience["questions"][number] | null;
  step: LearnerSessionStep;
}) {
  if (!question) {
    return (
      <HonestUnavailable message="The reviewed question for this concept is no longer available." />
    );
  }
  return (
    <form className={styles.assessment} onSubmit={onSubmit}>
      <span>{stageName(step)}</span>
      <h2>{question.body}</h2>
      <AnswerFields
        answer={answer}
        busy={busy}
        choices={question.choices}
        confidence={confidence}
        confidencePrompt={question.confidence_prompt}
        onAnswer={onAnswer}
        onConfidence={onConfidence}
      />
      {hint ? (
        <aside className={styles.approvedHint}>
          <Lightbulb />
          <div>
            <strong>Instructor-approved hint</strong>
            <p>{hint}</p>
          </div>
        </aside>
      ) : null}
      <div className={styles.assessmentActions}>
        <button className={styles.secondaryAction} onClick={onHint} type="button">
          <Lightbulb />
          Approved hint
        </button>
        <button
          className={styles.assessmentSubmit}
          disabled={!answer.trim() || confidence === null || busy}
          type="submit"
        >
          {busy ? <LoaderCircle className={styles.spin} /> : <CheckCircle2 />}
          Submit answer
        </button>
      </div>
    </form>
  );
}

function AnswerFields({
  answer,
  busy,
  choices,
  confidence,
  confidencePrompt,
  onAnswer,
  onConfidence,
}: {
  answer: string;
  busy: boolean;
  choices: string[];
  confidence: number | null;
  confidencePrompt: string;
  onAnswer: (value: string) => void;
  onConfidence: (value: number) => void;
}) {
  return (
    <>
      {choices.length ? (
        <fieldset className={styles.choices}>
          <legend>Your answer</legend>
          {choices.map((choice) => (
            <label key={choice}>
              <input
                checked={answer === choice}
                disabled={busy}
                name="answer"
                onChange={() => onAnswer(choice)}
                type="radio"
              />
              <span>{choice}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <textarea
          aria-label="Your answer"
          className={styles.answerInput}
          disabled={busy}
          onChange={(event) => onAnswer(event.target.value)}
          placeholder="Write your answer"
          value={answer}
        />
      )}
      <div className={styles.confidence}>
        <span>{confidencePrompt}</span>
        {[
          [1, "Guessing"],
          [2, "Unsure"],
          [3, "Fairly sure"],
          [4, "Confident"],
        ].map(([value, label]) => (
          <button
            aria-pressed={confidence === value}
            disabled={busy}
            key={value}
            onClick={() => onConfidence(value as number)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function ReflectStage({
  busy,
  note,
  onNote,
  onSelect,
  onSubmit,
  selected,
}: {
  busy: boolean;
  note: string;
  onNote: (note: string) => void;
  onSelect: (value: string) => void;
  onSubmit: () => void;
  selected: string | null;
}) {
  const options = [
    ["can_explain", "I can explain this"],
    ["with_example", "I understand it with an example"],
    ["still_unsure", "I’m still unsure"],
  ];
  return (
    <section className={styles.reflectStage}>
      <span className={styles.guideIdentity}>
        <Sparkles />
        Session reflection
      </span>
      <h2>What feels true right now?</h2>
      <p>
        Your reflection helps plan the next session. It does not change mastery
        without assessment evidence.
      </p>
      <div>
        {options.map(([value, label]) => (
          <button
            aria-pressed={selected === value}
            key={value}
            onClick={() => onSelect(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Optional reflection note"
        onChange={(event) => onNote(event.target.value)}
        placeholder="Optional note"
        value={note}
      />
      <button
        className={styles.primaryAction}
        disabled={!selected || busy}
        onClick={onSubmit}
        type="button"
      >
        {busy ? <LoaderCircle className={styles.spin} /> : <Check />}
        Finish session
      </button>
    </section>
  );
}

function SessionClose({
  mastery,
  onNext,
  session,
}: {
  mastery: LearnerWorkspace["mastery"];
  onNext: () => void;
  session: LearnerStudySession;
}) {
  const completed = session.steps.filter((step) => step.status === "completed");
  const uncertain = mastery.concepts.filter(
    (concept) => concept.mismatch || concept.state === "struggling",
  );
  return (
    <section className={styles.sessionClose}>
      <CheckCircle2 />
      <span>Session complete</span>
      <h1>You finished a full learning loop.</h1>
      <div>
        <article>
          <small>Practiced</small>
          <strong>
            {[...new Set(completed.map((step) => step.concept_name).filter(Boolean))]
              .join(", ") || "Reviewed course material"}
          </strong>
        </article>
        <article>
          <small>Evidence changed</small>
          <strong>{completed.length} reviewed activities completed</strong>
        </article>
        <article>
          <small>Still worth watching</small>
          <strong>{uncertain[0]?.name ?? "No immediate uncertainty flagged"}</strong>
        </article>
      </div>
      <button className={styles.primaryAction} onClick={onNext} type="button">
        Plan another session
        <ArrowRight />
      </button>
    </section>
  );
}

function SynchronizedTranscript({
  activeWordIndex,
  error,
  loading,
  words,
}: {
  activeWordIndex: number;
  error: string | null;
  loading: boolean;
  words: LearnerTranscriptWord[];
}) {
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    activeWordRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeWordIndex]);
  return (
    <details className={styles.transcript}>
      <summary>
        <span>
          <BookOpenText />
          <strong>Transcript</strong>
        </span>
        <span>
          Follow along
          <ChevronDown />
        </span>
      </summary>
      <div className={styles.transcriptBody}>
        {loading ? <p className={styles.transcriptStatus}>Loading transcript…</p> : null}
        {!loading && error ? (
          <p className={styles.transcriptStatus}>{error}</p>
        ) : null}
        {!loading && !error && !words.length ? (
          <p className={styles.transcriptStatus}>
            No timestamped transcript is available for this clip.
          </p>
        ) : null}
        {!loading && !error && words.length ? (
          <p aria-label="Clip transcript">
            {words.map((word, index) => {
              const active = index === activeWordIndex;
              return (
                <span
                  aria-current={active ? "true" : undefined}
                  data-active={active || undefined}
                  key={`${word.start_seconds}:${index}`}
                  ref={active ? activeWordRef : undefined}
                >
                  {word.text}{" "}
                </span>
              );
            })}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function MasteryDrawer({
  inspectedConceptId,
  mastery,
  onClose,
  onInspect,
  onSelect,
  path,
}: {
  inspectedConceptId: string | null;
  mastery: LearnerWorkspace["mastery"];
  onClose: () => void;
  onInspect: (conceptId: string | null) => void;
  onSelect: (conceptId: string) => void;
  path: LearnerPath;
}) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose}>
      <aside
        aria-label="Course mastery and review"
        className={styles.masteryDrawer}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>Adaptive course map</small>
            <h2>Mastery & review</h2>
          </div>
          <button aria-label="Close mastery" onClick={onClose} type="button">
            <X />
          </button>
        </header>
        <nav aria-label="Adaptive mastery trail" className={styles.masteryTrail}>
          {path.items.map((item, index) => {
            const state = learnerPathVisualState(item, path.current_concept_id);
            const evidence = mastery.concepts.find(
              (concept) => concept.concept_id === item.concept_id,
            );
            const expanded = inspectedConceptId === item.concept_id;
            return (
              <article data-expanded={expanded || undefined} data-state={state} key={item.concept_id}>
                <button
                  aria-expanded={expanded}
                  onClick={() =>
                    onInspect(expanded ? null : item.concept_id)
                  }
                  type="button"
                >
                  <span className={styles.masteryNodeMarker}>
                    {masteryNodeIcon(state, index)}
                  </span>
                  <span className={styles.masteryNodeCopy}>
                    <small>{masteryStateLabel(state, evidence?.access_state)}</small>
                    <strong>{item.name}</strong>
                  </span>
                </button>
                {expanded ? (
                  <div className={styles.masteryNodeDetail}>
                    <p>{masteryExplanation(item, evidence)}</p>
                    {evidence?.mismatch ? <strong>{evidence.mismatch}</strong> : null}
                    {evidence?.due_at ? (
                      <small>
                        Review due {new Date(evidence.due_at).toLocaleDateString()}
                      </small>
                    ) : null}
                    {item.eligible && item.actionable !== false ? (
                      <button onClick={() => onSelect(item.concept_id)} type="button">
                        Choose this concept
                        <ArrowRight />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </nav>
        {mastery.recent_routes.length ? (
          <details className={styles.routeHistory}>
            <summary>
              Recent path changes
              <ChevronDown />
            </summary>
            <ol>
              {mastery.recent_routes.map((route) => (
                <li key={`${route.created_at}:${route.action}`}>
                  <strong>{friendlyRoute(route.action)}</strong>
                  <p>{route.explanation}</p>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </aside>
    </div>
  );
}

function GuideDrawer({
  actions,
  busy,
  guideResult,
  helpNote,
  helpPreview,
  helpSent,
  onAction,
  onClose,
  onHelpNote,
  onSendHelp,
}: {
  actions: string[];
  busy: boolean;
  guideResult: GuideResult | null;
  helpNote: string;
  helpPreview: Record<string, unknown> | null;
  helpSent: boolean;
  onAction: (action: string) => void;
  onClose: () => void;
  onHelpNote: (note: string) => void;
  onSendHelp: () => void;
}) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose}>
      <aside
        aria-label="Manifold Learning Guide"
        className={styles.guideDrawer}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>
              <Sparkles />
            </span>
            <div>
              <small>Course-aware support</small>
              <h2>Manifold Learning Guide</h2>
            </div>
          </div>
          <button aria-label="Close Learning Guide" onClick={onClose} type="button">
            <X />
          </button>
        </header>
        <p>
          I can act on reviewed course material and your persisted evidence. I won’t
          invent an explanation or question.
        </p>
        {!helpPreview && !guideResult ? (
          <div className={styles.guideActions}>
            {actions.map((action) => (
              <button disabled={busy} key={action} onClick={() => onAction(action)}>
                {guideIcon(action)}
                <span>{guideLabel(action)}</span>
                <ArrowRight />
              </button>
            ))}
          </div>
        ) : null}
        {guideResult ? (
          <article className={styles.guideResult}>
            <small>Grounded in this course</small>
            <h3>{guideResult.title ?? "Learning Guide result"}</h3>
            <p>{guideResult.message ?? guideResult.excerpt}</p>
            {guideResult.page_number ? <span>Page {guideResult.page_number}</span> : null}
            <button onClick={() => onAction("why_next")} type="button">
              Back to actions
            </button>
          </article>
        ) : null}
        {helpPreview ? (
          <section className={styles.helpRequest}>
            {helpSent ? (
              <>
                <CheckCircle2 />
                <h3>Your course team has been notified in Manifold.</h3>
                <p>
                  While you wait, you can replay the approved explanation or review
                  the prerequisite from this Guide.
                </p>
              </>
            ) : (
              <>
                <h3>Here’s what will be shared</h3>
                <p>
                  Your current course, concept, active activity, three recent
                  attempts, and three recent route decisions. Instructor-only data is
                  never shown or shared from your workspace.
                </p>
                <pre>{JSON.stringify(helpPreview, null, 2)}</pre>
                <textarea
                  aria-label="Optional note for your course team"
                  onChange={(event) => onHelpNote(event.target.value)}
                  placeholder="What feels stuck? (optional)"
                  value={helpNote}
                />
                <button
                  className={styles.primaryAction}
                  disabled={busy}
                  onClick={onSendHelp}
                  type="button"
                >
                  <Send />
                  Send to course team
                </button>
              </>
            )}
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function HonestUnavailable({ message }: { message: string }) {
  return (
    <section className={styles.honestUnavailable}>
      <CircleHelp />
      <div>
        <strong>Reviewed content unavailable</strong>
        <p>{message}</p>
      </div>
    </section>
  );
}

function stepLabel(step: LearnerSessionStep) {
  if (step.kind === "watch") return `Learn: ${step.concept_name ?? step.title}`;
  if (step.kind === "question") return `Practice: ${step.concept_name ?? step.title}`;
  if (step.kind === "reflect") return "Reflect on what changed";
  return step.title;
}

function stageName(step: LearnerSessionStep) {
  if (step.kind === "watch") return "Learn";
  if (step.kind === "question") return "Practice";
  if (step.kind === "reflect") return "Reflect";
  return "Review";
}

function masteryNodeIcon(state: LearnerPathVisualState, index: number) {
  if (state === "mastered") return <CheckCircle2 />;
  if (state === "blocked") return <LockKeyhole />;
  if (state === "recommended" || state === "review") return <Route />;
  return index + 1;
}

function masteryStateLabel(
  state: LearnerPathVisualState,
  accessState?: string,
) {
  if (accessState === "content_unavailable") return "Needs reviewed content";
  if (state === "mastered") return "Mastered";
  if (state === "recommended") return "Recommended next";
  if (state === "review") return "Review recommended";
  if (state === "ready") return "Ready";
  return "Blocked";
}

function masteryExplanation(
  item: LearnerPathItem,
  evidence: LearnerWorkspace["mastery"]["concepts"][number] | undefined,
) {
  if (item.actionable === false) {
    return `This concept is not actionable because its reviewed coverage is ${(item.coverage_state ?? "incomplete").replaceAll("_", " ")}. Manifold will not substitute another topic’s content.`;
  }
  if (!item.eligible) {
    return "A reviewed prerequisite is not yet mastered. You can inspect this concept, but cannot open it as an eligible lesson.";
  }
  if (evidence?.state === "mastered") {
    return "Assessment evidence currently supports mastery. You can still choose it for review.";
  }
  return "This concept is eligible and has reviewed teaching plus a concept-linked question.";
}

function friendlyRoute(action: string) {
  return {
    advance: "Advanced",
    reinforce: "Reinforcement added",
    remediate: "Foundation repair added",
    flag_instructor: "Course team help suggested",
    complete: "Course path completed",
    placement_skip: "Placement shortened the path",
    placement_retain: "Concept retained after placement",
  }[action] ?? "Path updated";
}

function guideLabel(action: string) {
  return {
    why_next: "Why is this my next lesson?",
    replay: "Replay the relevant explanation",
    prerequisite: "Review the prerequisite",
    approved_source: "Show the instructor-approved source",
    approved_hint: "Give me an approved hint",
    quiz: "Quiz me with an approved question",
    stuck: "I’m stuck",
  }[action] ?? action;
}

function guideIcon(action: string) {
  if (action === "stuck") return <MessageCircleQuestion />;
  if (action === "approved_hint") return <Lightbulb />;
  if (action === "replay") return <RotateCcw />;
  if (action === "approved_source") return <FileText />;
  if (action === "quiz") return <ListChecks />;
  return <Compass />;
}
