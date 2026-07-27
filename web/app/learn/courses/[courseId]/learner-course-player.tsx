"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
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
  BookOpen,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Compass,
  Download,
  FileText,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Play,
  RotateCcw,
  Route,
  Send,
  ArrowUp,
  X,
} from "lucide-react";

import { AssistantMorph } from "../../../assistant-morph";
import {
  pageEntranceMotion,
  sectionCascadeVariants,
  sectionItemVariants,
} from "../../../interface-motion";
import { ProviderVideo } from "../../../ProviderVideo";
import {
  readRuntimeConversation,
  writeRuntimeConversation,
} from "../../../runtime-conversations";
import {
  readDevelopmentSession,
  type DevelopmentSession,
} from "../../../developmentSession";
import { LearnerSidebar } from "../../learner-sidebar";
import { LearnerMasteryMap } from "../../learner-mastery-map";
import {
  activeTranscriptWordIndex,
  type LearnerCourseExperience,
  type LearnerGuideMessage,
  type LearnerPath,
  type LearnerPathItem,
  type LearnerModeKey,
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
  const reducedMotion = useReducedMotion();
  const [identity, setIdentity] = useState<DevelopmentSession | null>(null);
  const [course, setCourse] = useState<LearnerCourseExperience | null>(null);
  const [path, setPath] = useState<LearnerPath | null>(null);
  const [workspace, setWorkspace] = useState<LearnerWorkspace | null>(null);
  const [studySession, setStudySession] = useState<LearnerStudySession | null>(null);
  const [completedSession, setCompletedSession] =
    useState<LearnerStudySession | null>(null);
  const [selectedMode, setSelectedMode] =
    useState<LearnerModeKey>("continue_path");
  const [modeChooserOpen, setModeChooserOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AnswerResponse | null>(null);
  const playbackSecondsRef = useRef(0);
  const activeTranscriptIndexRef = useRef(-1);
  const [activeTranscriptIndex, setActiveTranscriptIndex] = useState(-1);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideResult, setGuideResult] = useState<GuideResult | null>(null);
  const [guideMessages, setGuideMessages] = useState<LearnerGuideMessage[]>([]);
  const [conversationHydrated, setConversationHydrated] = useState(false);
  const [guideComposer, setGuideComposer] = useState("");
  const [guideSending, setGuideSending] = useState(false);
  const guideMessageListRef = useRef<HTMLDivElement | null>(null);
  const conversationScopeRef = useRef<string | null>(null);
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
    conversationScopeRef.current = null;
    setIdentity(nextIdentity);
    setConversationHydrated(false);
    setLoading(true);
    setError(null);
    try {
      const requestHeaders = { "X-User-ID": nextIdentity.id };
      const [courseResponse, pathResponse, workspaceResponse] =
        await Promise.all([
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
      if (
        !courseResponse.ok
        || !pathResponse.ok
        || !workspaceResponse.ok
      ) {
        throw new Error("Could not prepare this course workspace.");
      }
      const nextCourse =
        (await courseResponse.json()) as LearnerCourseExperience;
      const nextPath = (await pathResponse.json()) as LearnerPath;
      const nextWorkspace = (await workspaceResponse.json()) as LearnerWorkspace;
      setCourse(nextCourse);
      setPath(nextPath);
      setWorkspace(nextWorkspace);
      setGuideMessages(
        readRuntimeConversation<LearnerGuideMessage>(
          "learning-assistant",
          nextIdentity.id,
          courseId,
        ),
      );
      conversationScopeRef.current = `${nextIdentity.id}:${courseId}`;
      setConversationHydrated(true);
      setStudySession(nextWorkspace.session);
      setSelectedMode(
        nextWorkspace.session?.mode
          ?? nextWorkspace.modes.find((mode) => mode.recommended)?.key
          ?? "continue_path",
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

  useEffect(() => {
    if (
      !identity
      || !conversationHydrated
      || conversationScopeRef.current !== `${identity.id}:${courseId}`
    ) return;
    writeRuntimeConversation(
      "learning-assistant",
      identity.id,
      courseId,
      guideMessages,
    );
  }, [conversationHydrated, courseId, guideMessages, identity]);

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
  const updateTranscriptPlayback = useCallback(
    (seconds: number) => {
      playbackSecondsRef.current = seconds;
      const nextIndex = activeTranscriptWordIndex(transcript?.words ?? [], seconds);
      if (nextIndex === activeTranscriptIndexRef.current) return;
      activeTranscriptIndexRef.current = nextIndex;
      setActiveTranscriptIndex(nextIndex);
    },
    [transcript?.words],
  );

  useEffect(() => {
    playbackSecondsRef.current = 0;
    activeTranscriptIndexRef.current = -1;
    setActiveTranscriptIndex(-1);
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
      .then((nextTranscript) => {
        setTranscript(nextTranscript);
        const nextIndex = activeTranscriptWordIndex(
          nextTranscript.words,
          playbackSecondsRef.current,
        );
        activeTranscriptIndexRef.current = nextIndex;
        setActiveTranscriptIndex(nextIndex);
      })
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

  useEffect(() => {
    if (!guideOpen) return;
    const list = guideMessageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [guideMessages, guideOpen, guideResult, helpPreview]);

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

  async function createPlan(
    conceptId?: string,
    mode: LearnerModeKey = selectedMode,
  ) {
    setBusy(true);
    setError(null);
    try {
      const nextSession = await mutate<LearnerStudySession>(
        `/learn/courses/${courseId}/sessions`,
        "POST",
        {
          mode,
          idempotency_key: `session:${identity?.id}:${courseId}:${Date.now()}`,
          concept_id: conceptId ?? null,
        },
      );
      setStudySession(nextSession);
      setSelectedMode(nextSession.mode);
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

  async function adjustPlan(
    mode: LearnerModeKey = studySession?.mode ?? selectedMode,
    conceptId?: string,
  ) {
    setSelectedMode(mode);
    if (!studySession) return;
    setBusy(true);
    setError(null);
    try {
      setStudySession(
        await mutate<LearnerStudySession>(
          `/learn/courses/${courseId}/sessions/${studySession.id}/plan`,
          "PUT",
          { mode, concept_id: conceptId ?? null },
        ),
      );
      setModeChooserOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plan could not adjust.");
    } finally {
      setBusy(false);
    }
  }

  async function finishSession() {
    if (!studySession) return;
    setBusy(true);
    setError(null);
    try {
      setStudySession(
        await mutate<LearnerStudySession>(
          `/learn/courses/${courseId}/sessions/${studySession.id}/finish`,
          "POST",
        ),
      );
      setGuideOpen(false);
      setModeChooserOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Session could not finish.");
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
      if (!next.session) {
        setSelectedMode(
          next.modes.find((mode) => mode.recommended)?.key ?? "continue_path",
        );
      }
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
    if (action === "finish_session") {
      await finishSession();
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
      if (result.kind === "modes") {
        setGuideOpen(false);
        setModeChooserOpen(true);
        return;
      }
      if (
        ["clip", "question", "concept"].includes(result.kind)
        && result.concept_id
        && result.eligible !== false
      ) {
        if (studySession) {
          await adjustPlan(studySession.mode, result.concept_id);
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

  async function sendGuideMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitGuideContent(guideComposer);
  }

  async function submitGuideContent(value: string) {
    const content = value.trim();
    if (!content || guideSending) return;
    const optimistic: LearnerGuideMessage = {
      id: `optimistic-${Date.now()}`,
      role: "learner",
      content,
      intent: null,
      action: null,
      created_at: new Date().toISOString(),
    };
    setGuideComposer("");
    setGuideResult(null);
    setHelpPreview(null);
    setGuideMessages((current) => [...current, optimistic]);
    setGuideSending(true);
    try {
      const exchange = await mutate<LearnerGuideMessage[]>(
        `/learn/courses/${courseId}/guide/messages`,
        "POST",
        { content },
      );
      setGuideMessages((current) => [
        ...current.filter((message) => message.id !== optimistic.id),
        ...exchange,
      ]);
    } catch (caught) {
      setGuideMessages((current) =>
        current.filter((message) => message.id !== optimistic.id),
      );
      setGuideComposer(content);
      setError(
        caught instanceof Error
          ? caught.message
          : "The Learning Assistant could not answer that.",
      );
    } finally {
      setGuideSending(false);
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
              <BookOpen />
              Mastery
            </button>
          </nav>
        </header>

        <motion.div
          className={styles.learnerCourseMotionStage}
          data-motion-scope="page-enter"
          {...pageEntranceMotion(reducedMotion)}
        >
        {!workspace.orientation.completed ? (
          <Orientation
            busy={busy}
            courseTitle={course.title}
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
              const recommended =
                workspace.modes.find((mode) => mode.recommended)?.key
                ?? "continue_path";
              void createPlan(undefined, recommended);
            }}
            session={completedSession}
          />
        ) : !studySession ? (
          <SessionPlanner
            busy={busy}
            contentMessage={
              placement?.status === "unavailable"
                ? placement.unavailable_reason
                : workspace.content_message
            }
            modes={workspace.modes}
            onCreate={(mode) => void createPlan(undefined, mode)}
            onSelect={setSelectedMode}
            path={path}
            selectedMode={selectedMode}
          />
        ) : studySession.status === "planned" ? (
          <SessionPlan
            busy={busy}
            onChangeMode={() => setModeChooserOpen(true)}
            onStart={() => void startPlan()}
            session={studySession}
          />
        ) : (
          <motion.div
            animate="visible"
            className={styles.learningWorkspace}
            data-motion-scope="section-cascade"
            initial={reducedMotion ? false : "hidden"}
            variants={sectionCascadeVariants(reducedMotion)}
          >
            <motion.section
              className={styles.sessionActivity}
              variants={sectionItemVariants}
            >
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
                  onPlayback={updateTranscriptPlayback}
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
            </motion.section>

            <SessionRail
              busy={busy}
              feedback={feedback}
              onChangeMode={() => setModeChooserOpen(true)}
              onFinish={() => void finishSession()}
              session={studySession}
            />
          </motion.div>
        )}
        </motion.div>

        {masteryOpen ? (
          <MasteryDrawer
            inspectedConceptId={inspectedConceptId}
            mastery={workspace.mastery}
            onClose={() => {
              setInspectedConceptId(null);
              setMasteryOpen(false);
            }}
            onInspect={setInspectedConceptId}
            onSelect={(conceptId) => {
              const item = path.items.find(
                (candidate) => candidate.concept_id === conceptId,
              );
              if (!item?.eligible || item.actionable === false) return;
              setMasteryOpen(false);
              if (studySession) {
                void adjustPlan(studySession.mode, conceptId);
              } else {
                void createPlan(conceptId);
              }
            }}
            path={path}
          />
        ) : null}

        <AssistantMorph
          closeButtonClassName={styles.guideDockClose}
          icon={<MessageSquareText />}
          label="Learning Assistant"
          launcherClassName={styles.guideLauncher}
          launcherIdentityClassName={styles.guideLauncherIdentity}
          onOpenChange={(open) => {
            setGuideOpen(open);
            if (!open) {
              setGuideResult(null);
              setHelpPreview(null);
            }
          }}
          open={guideOpen}
          panelClassName={styles.guideDock}
          panelContentClassName={styles.guideMorphContent}
          panelHeaderClassName={styles.guideDockHeader}
          panelIdentityClassName={styles.guideDockIdentity}
          subtitle="Course-aware support"
          surfaceId="learning-assistant-shell"
        >
          <LearningGuideDock
            actions={workspace.guide_actions}
            busy={busy}
            composer={guideComposer}
            guideResult={guideResult}
            helpNote={helpNote}
            helpPreview={helpPreview}
            helpSent={helpSent}
            messages={guideMessages}
            messageListRef={guideMessageListRef}
            onAction={(action) => void runGuideAction(action)}
            onComposer={setGuideComposer}
            onHelpNote={setHelpNote}
            onPrompt={(prompt) => void submitGuideContent(prompt)}
            onSendHelp={() => void sendHelp()}
            onSubmit={sendGuideMessage}
            path={path}
            sending={guideSending}
          />
        </AssistantMorph>

        {modeChooserOpen ? (
          <ModeChooser
            busy={busy}
            modes={workspace.modes}
            onChoose={(mode) => {
              if (studySession) {
                void adjustPlan(mode);
              } else {
                setSelectedMode(mode);
                setModeChooserOpen(false);
              }
            }}
            onClose={() => setModeChooserOpen(false)}
            selectedMode={studySession?.mode ?? selectedMode}
          />
        ) : null}
      </main>
    </div>
  );
}

function Orientation({
  busy,
  courseTitle,
  onChoose,
}: {
  busy: boolean;
  courseTitle: string;
  onChoose: (choice: "recommended" | "placement" | "foundations") => void;
}) {
  return (
    <section className={styles.orientation}>
      <span className={styles.guideIdentity}>
        Learning Assistant
      </span>
      <h1>Start {courseTitle} with the right path.</h1>
      <p>
        I’ll use only instructor-reviewed lessons and questions, then explain every
        adjustment I make.
      </p>
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

function ModeCards({
  modes,
  onChoose,
  selectedMode,
}: {
  modes: LearnerWorkspace["modes"];
  onChoose: (mode: LearnerModeKey) => void;
  selectedMode: LearnerModeKey;
}) {
  return (
    <div aria-label="Learning modes" className={styles.modeGrid} role="group">
      {modes.map((mode) => (
        <button
          aria-pressed={selectedMode === mode.key}
          className={styles.modeCard}
          data-recommended={mode.recommended || undefined}
          disabled={!mode.available}
          key={mode.key}
          onClick={() => onChoose(mode.key)}
          type="button"
        >
          <span>
            {modeIcon(mode.key)}
            {mode.recommended ? <small>Recommended</small> : null}
          </span>
          <strong>{mode.title}</strong>
          <p>{mode.available ? mode.description : mode.disabled_reason}</p>
          {mode.recommended && mode.reason ? <em>{mode.reason}</em> : null}
        </button>
      ))}
    </div>
  );
}

function ModeChooser({
  busy,
  modes,
  onChoose,
  onClose,
  selectedMode,
}: {
  busy: boolean;
  modes: LearnerWorkspace["modes"];
  onChoose: (mode: LearnerModeKey) => void;
  onClose: () => void;
  selectedMode: LearnerModeKey;
}) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose}>
      <section
        aria-label="Change learning mode"
        className={styles.modeChooser}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>Choose how you want to learn</h2>
          <button aria-label="Close mode chooser" onClick={onClose} type="button">
            <X />
          </button>
        </header>
        <ModeCards
          modes={modes}
          onChoose={(mode) => {
            if (!busy) onChoose(mode);
          }}
          selectedMode={selectedMode}
        />
      </section>
    </div>
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
  busy,
  contentMessage,
  modes,
  onCreate,
  onSelect,
  path,
  selectedMode,
}: {
  busy: boolean;
  contentMessage: string | null;
  modes: LearnerWorkspace["modes"];
  onCreate: (mode: LearnerModeKey) => void;
  onSelect: (mode: LearnerModeKey) => void;
  path: LearnerPath;
  selectedMode: LearnerModeKey;
}) {
  const current = path.items.find((item) => item.current);
  const selected = modes.find((mode) => mode.key === selectedMode);
  return (
    <section className={styles.sessionPlanner}>
      <span className={styles.guideIdentity}>
        Learning Assistant
      </span>
      <h1>How would you like to learn?</h1>
      <p>
        Manifold recommends one mode from your course evidence. You stay in control
        and can choose any mode that is ready.
      </p>
      <ModeCards modes={modes} onChoose={onSelect} selectedMode={selectedMode} />
      <div className={styles.plannerCard}>
        <div>
          <small>{selected?.recommended ? "Recommended by Manifold" : "Selected mode"}</small>
          <strong>{selected?.title ?? "Reviewed course path"}</strong>
          <p>{selected?.reason ?? selected?.description ?? contentMessage}</p>
          {current ? <span>Current focus: {current.name}</span> : null}
        </div>
        <button
          className={styles.primaryAction}
          disabled={busy || !selected?.available}
          onClick={() => onCreate(selectedMode)}
          type="button"
        >
          {busy ? <LoaderCircle className={styles.spin} /> : <ArrowRight />}
          Prepare this learning loop
        </button>
      </div>
    </section>
  );
}

function SessionPlan({
  busy,
  onChangeMode,
  onStart,
  session,
}: {
  busy: boolean;
  onChangeMode: () => void;
  onStart: () => void;
  session: LearnerStudySession;
}) {
  return (
    <section className={styles.planStage}>
      <header>
        <h1>{modeTitle(session.mode)}</h1>
        <p>
          One focused evidence loop using only reviewed course material. Each step
          changes what Manifold recommends next.
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
          </li>
        ))}
      </ol>
      <footer>
        <button disabled={busy} onClick={onChangeMode} type="button">
          Choose another mode
        </button>
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
        <span>{modeTitle(session.mode)}</span>
      </div>
      <h1>{activeStep?.concept_name ?? activeTopic}</h1>
      <p>{activeStep?.reason}</p>
    </header>
  );
}

function SessionRail({
  busy,
  feedback,
  onChangeMode,
  onFinish,
  session,
}: {
  busy: boolean;
  feedback: AnswerResponse | null;
  onChangeMode: () => void;
  onFinish: () => void;
  session: LearnerStudySession;
}) {
  const activeIndex = session.steps.findIndex(
    (step) => step.status === "active" || step.status === "pending",
  );
  const currentPosition = Math.min(
    session.steps.length,
    Math.max(1, activeIndex >= 0 ? activeIndex + 1 : session.steps.length),
  );
  const progress = session.steps.length
    ? (currentPosition / session.steps.length) * 100
    : 0;

  return (
    <motion.aside
      aria-label="Active study plan"
      className={styles.sessionRail}
      variants={sectionItemVariants}
    >
      <header>
        <div className={styles.sessionRailHeading}>
          <span>{modeTitle(session.mode)}</span>
          <strong>Step {currentPosition} of {session.steps.length}</strong>
        </div>
        <div
          aria-label="Session progress"
          aria-valuemax={session.steps.length}
          aria-valuemin={0}
          aria-valuenow={currentPosition}
          className={styles.sessionRailProgress}
          role="progressbar"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <p>One focused evidence loop</p>
      </header>
      <ol>
        {session.steps.map((step, index) => {
          const stateLabel = railStepStateLabel(step, index, activeIndex);
          return (
            <li
              aria-current={step.status === "active" ? "step" : undefined}
              data-status={step.status}
              key={step.id}
            >
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
                <div className={styles.sessionRailStepMeta}>
                  <span>{stageName(step)}</span>
                  <em>{stateLabel}</em>
                </div>
                <strong>{railStepTitle(step)}</strong>
                {step.status === "active" ? <small>{step.reason}</small> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <section
        className={styles.sessionRailAdaptive}
        data-updated={feedback ? "true" : "false"}
      >
        <Route />
        <div>
          <strong>
            {feedback ? "Plan updated from your evidence" : "This plan adapts as you learn"}
          </strong>
          <p>
            {feedback?.route.why
              ?? "Your approved check and confidence determine the next reviewed step."}
          </p>
        </div>
      </section>
      <div className={styles.sessionRailActions}>
        <button disabled={busy} onClick={onChangeMode} type="button">
          <RotateCcw />
          Change learning mode
        </button>
        <button disabled={busy} onClick={onFinish} type="button">
          <CheckCircle2 />
          Finish this session
        </button>
      </div>
    </motion.aside>
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
  const inspectedItem = path.items.find(
    (item) => item.concept_id === inspectedConceptId,
  );
  const inspectedEvidence = mastery.concepts.find(
    (concept) => concept.concept_id === inspectedConceptId,
  );
  const inspectedRoute = mastery.recent_routes.find(
    (route) => (
      route.target_concept_id === inspectedConceptId
      || route.concept_id === inspectedConceptId
    ),
  );
  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose}>
      <aside
        aria-label="Course mastery and review"
        className={styles.masteryDrawer}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>
            <BookOpen />
            Mastery Map
          </h2>
          <button aria-label="Close mastery" onClick={onClose} type="button">
            <X />
          </button>
        </header>
        <div className={styles.masteryMapStage}>
          <LearnerMasteryMap
            inspectedConceptId={inspectedConceptId}
            mastery={mastery}
            onInspect={(conceptId) =>
              onInspect(inspectedConceptId === conceptId ? null : conceptId)
            }
            path={path}
          />
          {!inspectedItem ? (
            <p className={styles.masteryMapHint}>
              Select a concept to inspect its evidence and available next action.
            </p>
          ) : null}
        </div>
        {inspectedItem ? (
          <section className={styles.masteryMapInspector}>
            <div>
              <small>Selected concept</small>
              <strong>{inspectedItem.name}</strong>
              <p>{masteryExplanation(inspectedItem, inspectedEvidence)}</p>
              {inspectedRoute ? (
                <aside
                  className={styles.masteryRouteChange}
                  data-action={inspectedRoute.action}
                >
                  <small>Why this route changed</small>
                  <strong>{friendlyRoute(inspectedRoute.action)}</strong>
                  <p>{inspectedRoute.explanation}</p>
                  {inspectedRoute.mastery_before !== inspectedRoute.mastery_after ? (
                    <span>
                      Evidence moved from{" "}
                      {friendlyMasteryState(inspectedRoute.mastery_before)} to{" "}
                      {friendlyMasteryState(inspectedRoute.mastery_after)}.
                    </span>
                  ) : null}
                </aside>
              ) : null}
            </div>
            <div>
              {inspectedEvidence?.mismatch ? (
                <span>{inspectedEvidence.mismatch}</span>
              ) : null}
              {inspectedEvidence?.due_at ? (
                <span>
                  Review due{" "}
                  {new Date(inspectedEvidence.due_at).toLocaleDateString()}
                </span>
              ) : null}
              {inspectedItem.eligible && inspectedItem.actionable !== false ? (
                <button
                  onClick={() => onSelect(inspectedItem.concept_id)}
                  type="button"
                >
                  Choose this concept
                  <ArrowRight />
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function LearningGuideDock({
  actions,
  busy,
  composer,
  guideResult,
  helpNote,
  helpPreview,
  helpSent,
  messages,
  messageListRef,
  onAction,
  onComposer,
  onHelpNote,
  onPrompt,
  onSendHelp,
  onSubmit,
  path,
  sending,
}: {
  actions: string[];
  busy: boolean;
  composer: string;
  guideResult: GuideResult | null;
  helpNote: string;
  helpPreview: Record<string, unknown> | null;
  helpSent: boolean;
  messages: LearnerGuideMessage[];
  messageListRef: { current: HTMLDivElement | null };
  onAction: (action: string) => void;
  onComposer: (value: string) => void;
  onHelpNote: (note: string) => void;
  onPrompt: (prompt: string) => void;
  onSendHelp: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  path: LearnerPath;
  sending: boolean;
}) {
  const current = path.items.find((item) => item.current);
  const quickPrompts = [
    "What should I do next?",
    "How am I doing?",
    "Why is this my next lesson?",
    "How does mastery work?",
  ];
  return (
    <section aria-label="Learning Assistant conversation" className={styles.guideConversation}>
        <div className={styles.guideStatus}>
          <strong>
            <span>Right now:</span>{" "}
            {current?.name ?? "No actionable concept"}
          </strong>
        </div>

        <div className={styles.guideMessageList} ref={messageListRef}>
          {!messages.length ? (
            <div className={styles.guideWelcome}>
              <article className={styles.guideMessage} data-role="guide">
                <i aria-hidden="true"><MessageSquareText /></i>
                <div>
                  <span>Learning Assistant</span>
                  <p>
                    Welcome back. {current
                      ? `You’re currently working on ${current.name}. `
                      : "I’m ready when your next reviewed concept is available. "}
                    Ask about your progress, what comes next, or how Manifold works.
                  </p>
                </div>
              </article>
              <div className={styles.guideWelcomePrompts}>
                {quickPrompts.map((prompt) => (
                  <button
                    disabled={sending}
                    key={prompt}
                    onClick={() => onPrompt(prompt)}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <article
              className={styles.guideMessage}
              data-role={message.role}
              key={message.id}
            >
              {message.role === "guide" ? (
                <i aria-hidden="true"><MessageSquareText /></i>
              ) : null}
              <div>
                <span>
                  {message.role === "guide" ? "Learning Assistant" : "You"}
                </span>
                <p>{message.content}</p>
                {message.role === "guide" && message.action ? (
                  <button
                    disabled={busy || !actions.includes(message.action)}
                    onClick={() => onAction(message.action as string)}
                    type="button"
                  >
                    {guideActionLabel(message.action)}
                    <ArrowRight />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {sending ? (
            <div className={styles.guideThinking} aria-live="polite">
              <span>Reading your course evidence</span>
              <i />
              <i />
              <i />
            </div>
          ) : null}
          {guideResult ? (
            <article className={styles.guideResult}>
              <small>Grounded in this course</small>
              <h3>{guideResult.title ?? "Learning Assistant result"}</h3>
              <p>{guideResult.message ?? guideResult.excerpt}</p>
              {guideResult.page_number ? <span>Page {guideResult.page_number}</span> : null}
            </article>
          ) : null}
          {helpPreview ? (
            <section className={styles.helpRequest}>
              {helpSent ? (
                <>
                  <CheckCircle2 />
                  <h3>Your course team has been notified in Manifold.</h3>
                  <p>
                    While you wait, ask me to replay the reviewed explanation or open
                    a prerequisite.
                  </p>
                </>
              ) : (
                <>
                  <h3>Here’s what will be shared</h3>
                  <p>
                    Your current course, concept, active activity, three recent
                    attempts, and three recent route decisions. Instructor-only data
                    is never shown or shared from your workspace.
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
        </div>

        <form className={styles.guideComposer} onSubmit={onSubmit}>
          <textarea
            aria-label="Message Learning Assistant"
            onChange={(event) => onComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask about your progress, path, or course help…"
            rows={2}
            value={composer}
          />
          <div>
            <span>Enter to send · Shift + Enter for a new line</span>
            <button
              aria-label="Send message"
              disabled={!composer.trim() || sending}
              type="submit"
            >
              {sending ? <LoaderCircle className={styles.spin} /> : <ArrowUp />}
            </button>
          </div>
        </form>
    </section>
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

function railStepTitle(step: LearnerSessionStep) {
  if (step.kind === "reflect") return "What changed?";
  return step.concept_name ?? step.title;
}

function railStepStateLabel(
  step: LearnerSessionStep,
  index: number,
  activeIndex: number,
) {
  if (step.status === "completed") return "Done";
  if (step.status === "active") return "Now";
  if (step.status === "skipped") return "Skipped";
  if (step.status === "replaced") return "Updated";
  if (step.status === "unavailable") return "Unavailable";
  return index === activeIndex ? "Up next" : "Later";
}

function modeTitle(mode: LearnerModeKey) {
  return {
    continue_path: "Continue my path",
    learn_new: "Learn something new",
    strengthen_weak_areas: "Strengthen weak areas",
    review_learned: "Review what I learned",
  }[mode];
}

function modeIcon(mode: LearnerModeKey) {
  return {
    continue_path: <Route />,
    learn_new: <BookOpenText />,
    strengthen_weak_areas: <RotateCcw />,
    review_learned: <ListChecks />,
  }[mode];
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
    content_unavailable: "Reviewed content became unavailable",
  }[action] ?? "Path updated";
}

function friendlyMasteryState(state: string) {
  return state.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function guideActionLabel(action: string) {
  return {
    replay: "Open reviewed explanation",
    prerequisite: "Open prerequisite",
    approved_source: "Open approved source",
    approved_hint: "Show approved hint",
    quiz: "Open approved check",
    change_mode: "Choose learning mode",
    finish_session: "Finish session",
    stuck: "Review help request",
  }[action] ?? "Open";
}
