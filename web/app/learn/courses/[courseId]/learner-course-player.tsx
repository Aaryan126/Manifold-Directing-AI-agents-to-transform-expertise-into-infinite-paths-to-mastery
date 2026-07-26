"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenText, CheckCircle2, ChevronDown, ClipboardCheck, Download, FilePenLine, FileText, LockKeyhole, LoaderCircle, PlayCircle, Route } from "lucide-react";

import { ProviderVideo } from "../../../ProviderVideo";
import { readDevelopmentSession, type DevelopmentSession } from "../../../developmentSession";
import { LearnerSidebar } from "../../learner-sidebar";
import {
  activeTranscriptWordIndex,
  clipTranscriptWords,
  learnerPathVisualState,
  nextTopicId,
  topicForDecision,
  type LearnerCourseExperience,
  type LearnerPath,
  type LearnerPathItem,
  type LearnerPathVisualState,
  type LearnerProgress,
  type LearnerRouteDecision,
  type LearnerTranscriptWord,
} from "../../learner-course";
import styles from "../../learner.module.css";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";

type LearningStep = "clip" | "assessment";

type TranscriptResponse = {
  text: string;
  words: LearnerTranscriptWord[];
};

export function LearnerCoursePlayer({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<DevelopmentSession | null>(null);
  const [course, setCourse] = useState<LearnerCourseExperience | null>(null);
  const [progress, setProgress] = useState<LearnerProgress[]>([]);
  const [path, setPath] = useState<LearnerPath | null>(null);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [preferredClipId, setPreferredClipId] = useState<string | null>(null);
  const [learningStep, setLearningStep] = useState<LearningStep>("clip");
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decision, setDecision] = useState<LearnerRouteDecision | null>(null);
  const [routedTopicId, setRoutedTopicId] = useState<string | null>(null);
  const [inspectedConceptId, setInspectedConceptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProgress = useCallback(async (identity: DevelopmentSession) => {
    const response = await fetch(
      `${pipelineBase}/learners/${identity.id}/courses/${courseId}/progress`,
    );
    if (!response.ok) throw new Error("Could not load your mastery progress.");
    return (await response.json()) as LearnerProgress[];
  }, [courseId]);

  const loadPath = useCallback(async (identity: DevelopmentSession) => {
    const response = await fetch(`${pipelineBase}/learners/me/courses/${courseId}/path`, {
      headers: { "X-User-ID": identity.id },
    });
    if (!response.ok) throw new Error("Could not load your adaptive path.");
    return (await response.json()) as LearnerPath;
  }, [courseId]);

  const load = useCallback(async () => {
    const identity = readDevelopmentSession(window.localStorage);
    if (!identity || identity.role !== "learner") {
      router.replace("/login");
      return;
    }
    setSession(identity);
    setLoading(true);
    setError(null);
    try {
      const [courseResponse, nextProgress, nextPath] = await Promise.all([
        fetch(`${pipelineBase}/learners/me/courses/${courseId}`, {
          headers: { "X-User-ID": identity.id },
        }),
        loadProgress(identity),
        loadPath(identity),
      ]);
      if (courseResponse.status === 403) {
        router.replace("/learn");
        return;
      }
      if (!courseResponse.ok) throw new Error("Could not open this course.");
      const nextCourse = (await courseResponse.json()) as LearnerCourseExperience;
      setCourse(nextCourse);
      setProgress(nextProgress);
      setPath(nextPath);
      const currentPathItem = nextPath.items.find((item) => item.current)
        ?? nextPath.items.find((item) => item.concept_id === nextPath.current_concept_id);
      setActiveTopicId((current) => current ?? currentPathItem?.topic_id ?? nextTopicId(nextCourse, nextProgress));
      setInspectedConceptId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this course.");
    } finally {
      setLoading(false);
    }
  }, [courseId, loadPath, loadProgress, router]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setLearningStep("clip");
    setPlaybackSeconds(0);
    setAnswer("");
    setConfidence(null);
    setFeedback(null);
    setDecision(null);
    setRoutedTopicId(null);
    setPreferredClipId(null);
  }, [activeTopicId]);

  const activeTopic = course?.topics.find((topic) => topic.id === activeTopicId) ?? course?.topics[0] ?? null;
  const activePathItem = path?.items.find((item) => item.current && item.topic_id === activeTopic?.id)
    ?? path?.items.find((item) => item.topic_id === activeTopic?.id && item.state !== "mastered")
    ?? path?.items.find((item) => item.topic_id === activeTopic?.id)
    ?? null;
  const activeClip = useMemo(() => {
    if (!course || !activeTopic) return null;
    return course.clips.find((clip) => clip.id === preferredClipId)
      ?? course.clips.find((clip) => activePathItem?.clip_ids.includes(clip.id))
      ?? course.clips.find((clip) => clip.topic_id === activeTopic.id)
      ?? null;
  }, [activePathItem, activeTopic, course, preferredClipId]);
  const question = course?.questions.find((item) => activePathItem?.question_ids.includes(item.id))
    ?? course?.questions.find((item) => item.topic_id === activeTopic?.id)
    ?? null;
  const activeUnit = course?.units.find((unit) => unit.topic_ids.includes(activeTopic?.id ?? "")) ?? null;
  const activeUnitIndex = activeUnit
    ? course?.units.findIndex((unit) => unit.id === activeUnit.id) ?? -1
    : -1;
  const recommendedConceptId = path?.current_concept_id
    ?? path?.items.find((item) => item.current)?.concept_id
    ?? null;
  const mastered = progress.filter((item) => item.state === "mastered").length;
  const courseMasteryPercent = path?.items.length
    ? Math.round((mastered / path.items.length) * 100)
    : 0;
  const transcriptWords = useMemo(() => (
    activeClip && transcript
      ? clipTranscriptWords(
          transcript.words,
          activeClip.start_seconds,
          activeClip.end_seconds,
        )
      : []
  ), [activeClip, transcript]);
  const activeTranscriptIndex = activeTranscriptWordIndex(
    transcriptWords,
    playbackSeconds,
  );

  useEffect(() => {
    if (!activeClip) {
      setTranscript(null);
      setTranscriptError(null);
      return;
    }
    const controller = new AbortController();
    setTranscript(null);
    setTranscriptError(null);
    setTranscriptLoading(true);
    void fetch(`${pipelineBase}/videos/${activeClip.video_id}/transcript`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Transcript is not available for this clip.");
        return (await response.json()) as TranscriptResponse;
      })
      .then((nextTranscript) => setTranscript(nextTranscript))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setTranscriptError(
          caught instanceof Error ? caught.message : "Transcript is not available for this clip.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTranscriptLoading(false);
      });
    return () => controller.abort();
  }, [activeClip]);

  async function recordWatch(watchedSeconds: number) {
    if (!session || !activeClip) return;
    await fetch(`${pipelineBase}/courses/${courseId}/watch-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-ID": session.id },
      body: JSON.stringify({
        video_id: activeClip.video_id,
        clip_id: activeClip.id,
        path_mode: "adaptive",
        watched_seconds: watchedSeconds,
      }),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !course || !question || !activeTopic || !answer.trim() || confidence === null || submitting) return;
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const gradeResponse = await fetch(`${pipelineBase}/questions/${question.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answer.trim() }),
      });
      const grade = (await gradeResponse.json().catch(() => null)) as {
        is_correct?: boolean;
        feedback?: string;
        wrong_answer_pattern?: string | null;
        detail?: string;
      } | null;
      if (!gradeResponse.ok || typeof grade?.is_correct !== "boolean") {
        throw new Error(grade?.detail ?? "Could not check your answer.");
      }
      const attemptResponse = await fetch(
        `${pipelineBase}/learners/${session.id}/questions/${question.id}/attempt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answer: { answer: answer.trim() },
            correctness: grade.is_correct,
            confidence,
            wrong_answer_pattern: grade.wrong_answer_pattern ?? null,
          }),
        },
      );
      const nextDecision = (await attemptResponse.json().catch(() => null)) as (LearnerRouteDecision & { detail?: string }) | null;
      if (!attemptResponse.ok || !nextDecision?.action) {
        throw new Error(nextDecision?.detail ?? "Could not save your progress.");
      }
      const [nextProgress, nextPath] = await Promise.all([loadProgress(session), loadPath(session)]);
      setProgress(nextProgress);
      setPath(nextPath);
      setFeedback(grade.feedback ?? (grade.is_correct ? "Correct." : "Review the focused clip and try again."));
      setDecision(nextDecision);
      setPreferredClipId(nextDecision.target_clip_id);
      setRoutedTopicId(topicForDecision(nextDecision, course, nextProgress, activeTopic.id));
      setInspectedConceptId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit your answer.");
    } finally {
      setSubmitting(false);
    }
  }

  function continueAfterAssessment() {
    if (!decision || !activeTopic) return;
    if (routedTopicId && routedTopicId !== activeTopic.id) {
      setActiveTopicId(routedTopicId);
      return;
    }
    setLearningStep("clip");
    setPlaybackSeconds(0);
  }

  function openAssessment() {
    if (decision) {
      setDecision(null);
      setRoutedTopicId(null);
      setFeedback(null);
      setAnswer("");
      setConfidence(null);
    }
    setLearningStep("assessment");
  }

  async function downloadResource(resource: LearnerCourseExperience["resources"][number]) {
    if (!session) return;
    const response = await fetch(
      `${pipelineBase}/learners/me/courses/${courseId}/resources/${resource.id}`,
      { headers: { "X-User-ID": session.id } },
    );
    if (!response.ok) {
      setError("This course resource could not be downloaded.");
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = resource.filename;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  if (!session || loading) return <div className={styles.fullLoader}><LoaderCircle /><span>Preparing your course</span></div>;
  if (error && !course) return <div className={styles.fullLoader}><span>{error}</span></div>;
  if (!course || !activeTopic) return <div className={styles.fullLoader}><span>This course has no reviewed learner topics yet.</span></div>;

  return (
    <div className={styles.courseShell}>
      <LearnerSidebar active="course" session={session} />
      <main className={styles.courseMain}>
        <header className={styles.courseTopbar}>
          <Link aria-label="Back to learner dashboard" href="/learn"><ArrowLeft /></Link>
          <div><small>Enrolled course</small><strong>{course.title}</strong></div>
        </header>

        <div className={styles.courseLayout}>
          <section className={styles.lesson}>
            <div className={styles.lessonInner} data-step={learningStep}>
              <header className={styles.lessonHeader}>
                <div className={styles.lessonMeta}>
                  <span>{learningStep === "clip" ? "Watch" : "Practice"}</span>
                  {question ? <span>Step {learningStep === "clip" ? 1 : 2} of 2</span> : null}
                </div>
                <h1>{activeTopic.title}</h1>
                {learningStep === "clip" ? <p>{activeTopic.summary || "Watch the focused explanation, then check your understanding."}</p> : null}
                {learningStep === "clip" && activePathItem ? <details className={styles.routeReason}>
                  <summary><Route />Why this lesson?<ChevronDown /></summary>
                  <p>{decision?.why
                    ?? (activePathItem.concept_id === recommendedConceptId ? path?.last_route_why : null)
                    ?? focusReason(activePathItem, path?.items ?? [])}</p>
                </details> : null}
              </header>

              {learningStep === "clip" ? <>
                <div className={styles.player}>
                  {activeClip ? <ProviderVideo
                    clipId={activeClip.id}
                    clipMaterializationStatus={activeClip.materialization_status}
                    endSeconds={activeClip.end_seconds}
                    onClipComplete={(watchedSeconds) => void recordWatch(watchedSeconds)}
                    onPlaybackTimeUpdate={setPlaybackSeconds}
                    pipelineBaseUrl={pipelineBase}
                    playback={{
                      provider: activeClip.playback_provider,
                      playback_id: activeClip.playback_id,
                      playback_url: activeClip.playback_url,
                      delivery_asset_id: activeClip.delivery_asset_id,
                    }}
                    startSeconds={activeClip.start_seconds}
                    title={activeClip.title}
                    videoId={activeClip.video_id}
                    viewerId={session.id}
                  /> : <div className={styles.noMedia}>No reviewed teaching clip is available for this topic.</div>}
                </div>

                {activeClip ? <SynchronizedTranscript
                  activeWordIndex={activeTranscriptIndex}
                  error={transcriptError}
                  loading={transcriptLoading}
                  words={transcriptWords}
                /> : null}

                {activePathItem?.aids.length ? <details className={styles.lessonExtras}>
                  <summary><FileText />Course materials<ChevronDown /></summary>
                  <div>{activePathItem.aids.map((aid) => <article key={`${aid.source_id}:${aid.page_number}`}><span>{aid.title} · page {aid.page_number}</span><p>{aid.excerpt}</p></article>)}</div>
                </details> : null}

                {question ? <footer className={styles.lessonStepFooter}>
                  <span><small>Up next</small><strong>Check your understanding</strong></span>
                  <button onClick={openAssessment} type="button">{decision ? "Try the check again" : "Continue"}<ArrowRight /></button>
                </footer> : null}
              </> : question ? <section className={styles.assessmentStage}>
                <button className={styles.backToClip} onClick={() => setLearningStep("clip")} type="button"><ArrowLeft />Back to lesson</button>
                <form className={styles.assessment} onSubmit={submit}>
                  <span>Check your understanding</span>
                  <h2>{question.body}</h2>
                  {!decision ? <>
                    {question.choices.length ? <fieldset className={styles.choices}>
                      <legend>Your answer</legend>
                      {question.choices.map((choice) => <label key={choice}><input checked={answer === choice} disabled={submitting} name="answer" onChange={() => setAnswer(choice)} type="radio" /><span>{choice}</span></label>)}
                    </fieldset> : <textarea aria-label="Your answer" className={styles.answerInput} disabled={submitting} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer" value={answer} />}
                    <div className={styles.confidence}><span>{question.confidence_prompt}</span>{[
                      [2, "Unsure"], [3, "Fairly sure"], [4, "Confident"],
                    ].map(([value, label]) => <button aria-pressed={confidence === value} disabled={submitting} key={value} onClick={() => setConfidence(value as number)} type="button">{label}</button>)}</div>
                    <button className={styles.assessmentSubmit} disabled={!answer.trim() || confidence === null || submitting} type="submit">{submitting ? <LoaderCircle className={styles.spin} /> : <CheckCircle2 />}{submitting ? "Checking answer" : "Submit answer"}</button>
                  </> : <div className={styles.assessmentResult} data-tone={decision.action === "advance" || decision.action === "complete" ? "success" : "support"}>
                    <CheckCircle2 />
                    <div><strong>{decision.action === "advance" || decision.action === "complete" ? "Check complete" : "A focused review will help"}</strong><p role="status">{feedback}</p><span>{decision.why}</span></div>
                    <button onClick={continueAfterAssessment} type="button">{routedTopicId && routedTopicId !== activeTopic.id ? "Continue to next lesson" : "Review lesson"}<ArrowRight /></button>
                  </div>}
                  {error ? <p className={styles.feedback} role="alert">{error}</p> : null}
                </form>
              </section> : null}
            </div>
          </section>

          <aside className={styles.outline} aria-labelledby="course-outline-title">
            <header className={styles.pathSidebarHeader}>
              <div><span><small>Course progress</small><strong>{mastered} of {path?.items.length ?? progress.length} mastered</strong></span><b>{courseMasteryPercent}%</b></div>
              <span><i style={{ width: `${courseMasteryPercent}%` }} /></span>
            </header>
            {(course.units ?? []).length && activeUnit ? <details className={styles.unitSwitcher}>
              <summary>
                <span data-kind={activeUnit.kind}>{activeUnit.kind === "lecture" ? <PlayCircle /> : activeUnit.kind === "quiz" ? <ClipboardCheck /> : <FilePenLine />}</span>
                <span><small>Course journey · {activeUnitIndex + 1} of {course.units.length}</small><strong>{activeUnit.title}</strong></span>
                <ChevronDown />
              </summary>
              <nav aria-label="Course learning journey">{course.units.map((unit, index) => {
                const active = unit.id === activeUnit.id;
                const available = unit.kind !== "lecture" || unit.topic_ids.length > 0;
                return <button aria-current={active ? "step" : undefined} disabled={!available} key={unit.id} onClick={() => {
                  const nextTopicId = unit.topic_ids[0];
                  if (nextTopicId) setActiveTopicId(nextTopicId);
                }} type="button">
                  <span data-kind={unit.kind}>{unit.kind === "lecture" ? <PlayCircle /> : unit.kind === "quiz" ? <ClipboardCheck /> : <FilePenLine />}</span>
                  <span><small>{index + 1}. {unit.kind}</small><strong>{unit.title}</strong></span>
                </button>;
              })}</nav>
            </details> : null}
            <div className={styles.masteryHeading}><span><small>Adaptive path</small><em>{path?.items.length ?? 0} concepts</em></span><h2 id="course-outline-title">Learning path</h2></div>
            {path ? <AdaptiveMasteryTrail
              inspectedConceptId={inspectedConceptId}
              items={path.items}
              onSelect={(item, state) => {
                setInspectedConceptId((current) => current === item.concept_id ? null : item.concept_id);
                if (state !== "blocked" && item.topic_id) setActiveTopicId(item.topic_id);
              }}
              recommendedConceptId={recommendedConceptId}
              viewingConceptId={activePathItem?.concept_id ?? null}
            /> : null}
            {course.resources.length ? <details className={styles.courseResources}><summary><BookOpenText />Course resources<ChevronDown /></summary><div>{course.resources.map((resource) => <button key={resource.id} onClick={() => void downloadResource(resource)} type="button"><FileText /><span><strong>{resource.filename}</strong><small>{resource.source_type.toUpperCase()}</small></span><Download /></button>)}</div></details> : null}
          </aside>
        </div>
      </main>
    </div>
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

  return <details className={styles.transcript}>
    <summary><span><BookOpenText /><strong>Transcript</strong></span><span>Follow along<ChevronDown /></span></summary>
    <div className={styles.transcriptBody}>
      {loading ? <p className={styles.transcriptStatus}>Loading transcript…</p> : null}
      {!loading && error ? <p className={styles.transcriptStatus}>{error}</p> : null}
      {!loading && !error && !words.length ? <p className={styles.transcriptStatus}>No timestamped transcript is available for this clip.</p> : null}
      {!loading && !error && words.length ? <p aria-label="Clip transcript">
        {words.map((word, index) => {
          const active = index === activeWordIndex;
          return <span
            aria-current={active ? "true" : undefined}
            data-active={active || undefined}
            key={`${word.start_seconds}:${index}`}
            ref={active ? activeWordRef : undefined}
          >{word.text}{" "}</span>;
        })}
      </p> : null}
    </div>
  </details>;
}

function AdaptiveMasteryTrail({
  inspectedConceptId,
  items,
  onSelect,
  recommendedConceptId,
  viewingConceptId,
}: {
  inspectedConceptId: string | null;
  items: LearnerPath["items"];
  onSelect: (item: LearnerPathItem, state: LearnerPathVisualState) => void;
  recommendedConceptId: string | null;
  viewingConceptId: string | null;
}) {
  return <nav aria-label="Adaptive mastery trail" className={styles.masteryTrail}>
    {items.map((item, index) => {
      const state = learnerPathVisualState(item, recommendedConceptId);
      const expanded = inspectedConceptId === item.concept_id;
      const unmet = unmetPrerequisiteNames(item, items);
      return <article data-expanded={expanded || undefined} data-state={state} key={item.concept_id}>
        <button
          aria-current={item.concept_id === viewingConceptId ? "step" : undefined}
          aria-expanded={expanded}
          onClick={() => onSelect(item, state)}
          type="button"
        >
          <span className={styles.masteryNodeMarker}>{masteryNodeIcon(state, index)}</span>
          <span className={styles.masteryNodeCopy}>
            <small>{masteryStateLabel(state)}</small>
            <strong>{item.name}</strong>
          </span>
        </button>
        {expanded ? <div className={styles.masteryNodeDetail}>
          <strong>{masteryStateSummary(state, unmet)}</strong>
          <p>{masteryNodeExplanation(state, unmet)}</p>
        </div> : null}
      </article>;
    })}
  </nav>;
}

function focusReason(item: LearnerPathItem, items: LearnerPathItem[]) {
  const prerequisites = item.prerequisite_ids
    .map((id) => items.find((candidate) => candidate.concept_id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (prerequisites.length) {
    return `You are ready for this because you completed ${joinNames(prerequisites)}.`;
  }
  return "This is the strongest available next step in your instructor-reviewed course path.";
}

function unmetPrerequisiteNames(item: LearnerPathItem, items: LearnerPathItem[]) {
  return item.prerequisite_ids
    .map((id) => items.find((candidate) => candidate.concept_id === id))
    .filter((candidate): candidate is LearnerPathItem => (
      Boolean(candidate) && candidate?.state !== "mastered"
    ))
    .map((candidate) => candidate.name);
}

function masteryNodeIcon(state: LearnerPathVisualState, index: number) {
  if (state === "mastered") return <CheckCircle2 />;
  if (state === "blocked") return <LockKeyhole />;
  if (state === "recommended" || state === "review") return <Route />;
  return index + 1;
}

function masteryStateLabel(state: LearnerPathVisualState) {
  if (state === "mastered") return "Mastered";
  if (state === "recommended") return "Recommended next";
  if (state === "review") return "Review recommended";
  if (state === "ready") return "Ready";
  return "Coming later";
}

function masteryStateSummary(state: LearnerPathVisualState, unmet: string[]) {
  if (state === "mastered") return "Review anytime";
  if (state === "recommended") return "Your best next step";
  if (state === "review") return "Focused support is ready";
  if (state === "ready") return "Available as an alternative";
  return unmet.length ? `Needs ${joinNames(unmet)}` : "Prerequisites are still in progress";
}

function masteryNodeExplanation(state: LearnerPathVisualState, unmet: string[]) {
  if (state === "mastered") {
    return "You have demonstrated mastery here. Reopen this teaching moment whenever you want a review.";
  }
  if (state === "recommended") {
    return "This is the single next step Manifold recommends. The lesson panel explains why it was selected.";
  }
  if (state === "review") {
    return "A focused review is recommended before you move forward. Your current lesson has the supporting explanation.";
  }
  if (state === "ready") {
    return "This topic is available now. You can choose it, or continue with the recommended step above it.";
  }
  if (unmet.length) {
    return `Complete ${joinNames(unmet)} to unlock this topic.`;
  }
  return "This topic will open when its reviewed prerequisites are complete.";
}

function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? "the required foundation";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
