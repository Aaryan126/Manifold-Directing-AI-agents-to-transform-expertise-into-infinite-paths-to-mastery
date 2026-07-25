"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, ClipboardCheck, Download, FilePenLine, FileText, LockKeyhole, LoaderCircle, PlayCircle, Route } from "lucide-react";

import { ProviderVideo } from "../../../ProviderVideo";
import { readDevelopmentSession, type DevelopmentSession } from "../../../developmentSession";
import { LearnerSidebar } from "../../learner-sidebar";
import {
  learnerPathVisualState,
  nextTopicId,
  topicForDecision,
  type LearnerCourseExperience,
  type LearnerPath,
  type LearnerPathItem,
  type LearnerPathVisualState,
  type LearnerProgress,
  type LearnerRouteDecision,
} from "../../learner-course";
import styles from "../../learner.module.css";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";

export function LearnerCoursePlayer({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<DevelopmentSession | null>(null);
  const [course, setCourse] = useState<LearnerCourseExperience | null>(null);
  const [progress, setProgress] = useState<LearnerProgress[]>([]);
  const [path, setPath] = useState<LearnerPath | null>(null);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [preferredClipId, setPreferredClipId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decision, setDecision] = useState<LearnerRouteDecision | null>(null);
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
      setInspectedConceptId((current) => current ?? currentPathItem?.concept_id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this course.");
    } finally {
      setLoading(false);
    }
  }, [courseId, loadPath, loadProgress, router]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setAnswer("");
    setConfidence(null);
    setFeedback(null);
    setDecision(null);
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
  const lectureUnits = course?.units.filter((unit) => unit.kind === "lecture") ?? [];
  const activeLecture = lectureUnits.find((unit) => unit.topic_ids.includes(activeTopic?.id ?? "")) ?? null;
  const activeLectureIndex = activeLecture
    ? lectureUnits.findIndex((unit) => unit.id === activeLecture.id)
    : -1;
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
      setInspectedConceptId(
        nextPath.items.find((item) => item.current)?.concept_id
          ?? nextPath.current_concept_id
          ?? null,
      );
      const targetTopic = topicForDecision(nextDecision, course, nextProgress, activeTopic.id);
      if (targetTopic !== activeTopic.id) {
        window.setTimeout(() => setActiveTopicId(targetTopic), 900);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit your answer.");
    } finally {
      setSubmitting(false);
    }
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
            <div className={styles.lessonInner}>
              <header className={styles.lessonHeader}>
                <div>
                  <small>{activeLecture
                    ? `Lecture ${activeLectureIndex + 1} of ${lectureUnits.length} · ${activeLecture.title}`
                    : "Current teaching moment"}</small>
                  <h1>{activeTopic.title}</h1>
                  <p>{activeTopic.summary || "Watch the focused explanation, then check your understanding."}</p>
                </div>
              </header>

              {activePathItem ? <section className={styles.adaptiveFocus} data-tone={decisionTone(decision)}>
                <span className={styles.adaptiveFocusIcon}><Route /></span>
                <div>
                  <small>{focusLabel(activePathItem, recommendedConceptId, decision)}</small>
                  <strong>{activePathItem.name}</strong>
                  <p>{decision?.why
                    ?? (activePathItem.concept_id === recommendedConceptId ? path?.last_route_why : null)
                    ?? focusReason(activePathItem, path?.items ?? [])}</p>
                </div>
                <span className={styles.adaptiveFocusStatus}>Current lesson</span>
              </section> : null}

              <div className={styles.player}>
                {activeClip ? <ProviderVideo
                  clipId={activeClip.id}
                  clipMaterializationStatus={activeClip.materialization_status}
                  endSeconds={activeClip.end_seconds}
                  onClipComplete={(watchedSeconds) => void recordWatch(watchedSeconds)}
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

              {activePathItem?.aids.length ? <section className={styles.pathAids}><header><FileText /><div><small>Instructor-approved evidence</small><strong>Helpful course materials</strong></div></header>{activePathItem.aids.map((aid) => <article key={`${aid.source_id}:${aid.page_number}`}><span>{aid.title} · page {aid.page_number}</span><p>{aid.excerpt}</p></article>)}</section> : null}

              {question ? <form className={styles.assessment} onSubmit={submit}>
                <span>Check your understanding</span>
                <h2>{question.body}</h2>
                {question.choices.length ? <fieldset className={styles.choices}>
                  <legend>Your answer</legend>
                  {question.choices.map((choice) => <label key={choice}><input checked={answer === choice} disabled={submitting} name="answer" onChange={() => setAnswer(choice)} type="radio" /><span>{choice}</span></label>)}
                </fieldset> : <textarea aria-label="Your answer" className={styles.answerInput} disabled={submitting} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer" value={answer} />}
                <div className={styles.confidence}><span>{question.confidence_prompt}</span>{[
                  [2, "Unsure"], [3, "Fairly sure"], [4, "Confident"],
                ].map(([value, label]) => <button aria-pressed={confidence === value} disabled={submitting} key={value} onClick={() => setConfidence(value as number)} type="button">{label}</button>)}</div>
                <button className={styles.assessmentSubmit} disabled={!answer.trim() || confidence === null || submitting} type="submit">{submitting ? <LoaderCircle className={styles.spin} /> : <CheckCircle2 />}{submitting ? "Checking answer" : "Submit answer"}</button>
                {feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}
                {error ? <p className={styles.feedback} role="alert">{error}</p> : null}
              </form> : null}
            </div>
          </section>

          <aside className={styles.outline} aria-labelledby="course-outline-title">
            <header className={styles.pathSidebarHeader}>
              <small>Your progress</small>
              <div><h2 id="course-outline-title">{mastered} of {path?.items.length ?? progress.length} mastered</h2><strong>{courseMasteryPercent}%</strong></div>
              <span><i style={{ width: `${courseMasteryPercent}%` }} /></span>
            </header>
            {(course.units ?? []).length && activeUnit ? <details className={styles.unitSwitcher}>
              <summary>
                <span data-kind={activeUnit.kind}>{activeUnit.kind === "lecture" ? <PlayCircle /> : activeUnit.kind === "quiz" ? <ClipboardCheck /> : <FilePenLine />}</span>
                <span><small>{activeUnit.kind} {activeUnitIndex + 1} of {course.units.length}</small><strong>{activeUnit.title}</strong></span>
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
                  <span><small>{String(index + 1).padStart(2, "0")} · {unit.kind}</small><strong>{unit.title}</strong></span>
                </button>;
              })}</nav>
            </details> : null}
            <div className={styles.masteryHeading}><small>Adaptive mastery</small><h3>Your learning path</h3><p>One recommended step, with every alternative and prerequisite explained.</p></div>
            {path ? <AdaptiveMasteryTrail
              inspectedConceptId={inspectedConceptId}
              items={path.items}
              onSelect={(item, state) => {
                setInspectedConceptId(item.concept_id);
                if (state !== "blocked" && item.topic_id) setActiveTopicId(item.topic_id);
              }}
              recommendedConceptId={recommendedConceptId}
              viewingConceptId={activePathItem?.concept_id ?? null}
            /> : null}
            <details className={styles.topicDisclosure}><summary>Lecture outline <ChevronDown /></summary>
            <nav aria-label="Course topics">{course.topics.map((topic, index) => {
              const state = topicState(topic.id, progress);
              return <button aria-current={topic.id === activeTopic.id ? "true" : undefined} key={topic.id} onClick={() => setActiveTopicId(topic.id)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><span><strong>{topic.title}</strong><em>{state.replace("_", " ")}</em></span></button>;
            })}</nav></details>
            {course.resources.length ? <section className={styles.learnerResources}><header><small>From your instructor</small><h3>Course resources</h3></header>{course.resources.map((resource) => <button key={resource.id} onClick={() => void downloadResource(resource)} type="button"><FileText /><span><strong>{resource.filename}</strong><small>{resource.source_type.toUpperCase()}</small></span><Download /></button>)}</section> : null}
          </aside>
        </div>
      </main>
    </div>
  );
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
            <em>{masteryStateSummary(state, unmet)}</em>
          </span>
        </button>
        {expanded ? <div className={styles.masteryNodeDetail}>
          <p>{masteryNodeExplanation(state, unmet)}</p>
          <span>{state === "blocked"
            ? "Select any locked topic to understand its prerequisites."
            : item.concept_id === viewingConceptId ? "Open in the current lesson" : "Select to open this teaching moment"}</span>
        </div> : null}
      </article>;
    })}
  </nav>;
}

function topicState(topicId: string, progress: LearnerProgress[]) {
  const states = progress.filter((item) => item.topic_id === topicId).map((item) => item.state);
  if (states.length && states.every((state) => state === "mastered")) return "mastered";
  if (states.includes("struggling")) return "needs_review";
  if (states.includes("practiced")) return "in_progress";
  return "not_started";
}

function decisionTone(decision: LearnerRouteDecision | null) {
  if (!decision) return "neutral";
  if (decision.action === "advance" || decision.action === "complete") return "advance";
  if (decision.action === "flag_instructor") return "attention";
  return "support";
}

function focusLabel(
  item: LearnerPathItem,
  recommendedConceptId: string | null,
  decision: LearnerRouteDecision | null,
) {
  if (decision?.action === "remediate" || decision?.action === "reinforce") {
    return "Review recommended";
  }
  return item.concept_id === recommendedConceptId ? "Recommended next" : "Ready to learn";
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
  if (state === "ready") return "Ready too";
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
