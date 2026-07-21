"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle } from "lucide-react";

import { ProviderVideo } from "../../../ProviderVideo";
import { readDevelopmentSession, type DevelopmentSession } from "../../../developmentSession";
import { LearnerSidebar } from "../../learner-sidebar";
import {
  nextTopicId,
  topicForDecision,
  type LearnerCourseExperience,
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
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [preferredClipId, setPreferredClipId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decision, setDecision] = useState<LearnerRouteDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProgress = useCallback(async (identity: DevelopmentSession) => {
    const response = await fetch(
      `${pipelineBase}/learners/${identity.id}/courses/${courseId}/progress`,
    );
    if (!response.ok) throw new Error("Could not load your mastery progress.");
    return (await response.json()) as LearnerProgress[];
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
      const [courseResponse, nextProgress] = await Promise.all([
        fetch(`${pipelineBase}/learners/me/courses/${courseId}`, {
          headers: { "X-User-ID": identity.id },
        }),
        loadProgress(identity),
      ]);
      if (courseResponse.status === 403) {
        router.replace("/learn");
        return;
      }
      if (!courseResponse.ok) throw new Error("Could not open this course.");
      const nextCourse = (await courseResponse.json()) as LearnerCourseExperience;
      setCourse(nextCourse);
      setProgress(nextProgress);
      setActiveTopicId((current) => current ?? nextTopicId(nextCourse, nextProgress));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this course.");
    } finally {
      setLoading(false);
    }
  }, [courseId, loadProgress, router]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setAnswer("");
    setConfidence(null);
    setFeedback(null);
    setDecision(null);
    setPreferredClipId(null);
  }, [activeTopicId]);

  const activeTopic = course?.topics.find((topic) => topic.id === activeTopicId) ?? course?.topics[0] ?? null;
  const activeClip = useMemo(() => {
    if (!course || !activeTopic) return null;
    return course.clips.find((clip) => clip.id === preferredClipId)
      ?? course.clips.find((clip) => clip.topic_id === activeTopic.id)
      ?? null;
  }, [activeTopic, course, preferredClipId]);
  const question = course?.questions.find((item) => item.topic_id === activeTopic?.id) ?? null;
  const mastered = progress.filter((item) => item.state === "mastered").length;

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
      const nextProgress = await loadProgress(session);
      setProgress(nextProgress);
      setFeedback(grade.feedback ?? (grade.is_correct ? "Correct." : "Review the focused clip and try again."));
      setDecision(nextDecision);
      setPreferredClipId(nextDecision.target_clip_id);
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

  if (!session || loading) return <div className={styles.fullLoader}><LoaderCircle /><span>Preparing your course</span></div>;
  if (error && !course) return <div className={styles.fullLoader}><span>{error}</span></div>;
  if (!course || !activeTopic) return <div className={styles.fullLoader}><span>This course has no reviewed learner topics yet.</span></div>;

  return (
    <div className={styles.courseShell}>
      <LearnerSidebar active="course" session={session} />
      <main className={styles.courseMain}>
        <header className={styles.courseTopbar}>
          <Link aria-label="Back to learner dashboard" href="/learn"><ArrowLeft /></Link>
          <div><small>Adaptive course</small><strong>{course.title}</strong></div>
        </header>

        <div className={styles.courseLayout}>
          <section className={styles.lesson}>
            <div className={styles.lessonInner}>
              <header className={styles.lessonHeader}>
                <div><small>Current teaching moment</small><h1>{activeTopic.title}</h1><p>{activeTopic.summary || "Watch the focused explanation, then check your understanding."}</p></div>
                <span className={styles.duration}>{mastered} of {progress.length} concepts mastered</span>
              </header>

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

              <div className={styles.routeNotice} data-tone={decisionTone(decision)}>
                <strong>{decision ? routeTitle(decision) : "Why this is next"}</strong>
                {decision?.why ?? "This is the next eligible concept in your reviewed course path. Watch the focused clip before answering the check-in."}
              </div>

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
            <header><small>Your path</small><h2 id="course-outline-title">Course outline</h2></header>
            <nav aria-label="Course topics">{course.topics.map((topic, index) => {
              const state = topicState(topic.id, progress);
              return <button aria-current={topic.id === activeTopic.id ? "true" : undefined} key={topic.id} onClick={() => setActiveTopicId(topic.id)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><span><strong>{topic.title}</strong><em>{state.replace("_", " ")}</em></span></button>;
            })}</nav>
          </aside>
        </div>
      </main>
    </div>
  );
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

function routeTitle(decision: LearnerRouteDecision) {
  if (decision.action === "advance") return "You’re ready to move forward";
  if (decision.action === "complete") return "Course path complete";
  if (decision.action === "flag_instructor") return "Your instructor has been notified";
  return "A focused review will help";
}
