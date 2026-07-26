"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, LoaderCircle, Play } from "lucide-react";

import { readDevelopmentSession, type DevelopmentSession } from "../developmentSession";
import shellStyles from "../app/course-os.module.css";
import {
  courseCompositionLabels,
  courseProgressPercent,
  type LearnerCourseSummary,
} from "./learner-course";
import { LearnerSidebar } from "./learner-sidebar";
import styles from "./learner.module.css";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";

export function LearnerDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<DevelopmentSession | null>(null);
  const [courses, setCourses] = useState<LearnerCourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = readDevelopmentSession(window.localStorage);
    if (!current || current.role !== "learner") {
      router.replace("/login");
      return;
    }
    setSession(current);
    setLoading(true);
    try {
      const response = await fetch(`${pipelineBase}/learners/me/courses`, {
        headers: { "X-User-ID": current.id },
      });
      if (!response.ok) throw new Error("Could not load your learning workspace.");
      setCourses((await response.json()) as LearnerCourseSummary[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your courses.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const enrolled = useMemo(() => courses.filter((course) => course.enrolled), [courses]);
  const available = useMemo(() => courses.filter((course) => !course.enrolled), [courses]);

  async function openCourse(course: LearnerCourseSummary) {
    if (!session || openingId) return;
    setOpeningId(course.id);
    setError(null);
    try {
      if (!course.enrolled) {
        const response = await fetch(`${pipelineBase}/courses/${course.id}/enrollment`, {
          method: "POST",
          headers: { "X-User-ID": session.id },
        });
        if (!response.ok) throw new Error("Could not enroll in this course.");
      }
      router.push(`/learn/courses/${course.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the course.");
      setOpeningId(null);
    }
  }

  if (!session) return <div className={styles.fullLoader}><LoaderCircle /><span>Opening your workspace</span></div>;

  return (
    <div className={shellStyles.appShell}>
      <LearnerSidebar active="home" session={session} />
      <main className={shellStyles.dashboardMain}>
        <header className={shellStyles.dashboardHeader}>
          <div>
            <h1>Good {timeOfDay()}, {session.display_name}.</h1>
            <p>Pick up where you left off, or begin a new adaptive course.</p>
          </div>
        </header>

        {error ? <div className={shellStyles.errorBanner} role="alert"><span>{error}</span><button onClick={() => void load()} type="button">Try again</button></div> : null}

        {loading ? <div className={styles.fullLoader}><LoaderCircle /><span>Loading courses</span></div> : (
          <>
            <section className={styles.courseSection} id="courses" aria-labelledby="continue-title">
              <header><div><h2 id="continue-title">Continue learning</h2><p>Your next teaching moment is ready when you are.</p></div></header>
              {enrolled.length ? <div className={styles.courseGrid}>{enrolled.map((course) => (
                <LearnerCourseCard course={course} key={course.id} loading={openingId === course.id} onOpen={() => void openCourse(course)} />
              ))}</div> : <div className={styles.emptyState}><Play /><h3>Your first course starts below.</h3><p>Choose an available course and Manifold will prepare your path.</p></div>}
            </section>

            {available.length ? <section className={styles.courseSection} aria-labelledby="available-title">
              <header><div><h2 id="available-title">Available courses</h2><p>Enroll once to save mastery and progress.</p></div></header>
              <div className={styles.courseGrid}>{available.map((course) => (
                <LearnerCourseCard course={course} key={course.id} loading={openingId === course.id} onOpen={() => void openCourse(course)} />
              ))}</div>
            </section> : null}
          </>
        )}
      </main>
    </div>
  );
}

function LearnerCourseCard({ course, loading, onOpen }: { course: LearnerCourseSummary; loading: boolean; onOpen: () => void }) {
  const progress = courseProgressPercent(course);
  const composition = courseCompositionLabels(course);
  return <article className={styles.courseCard}>
    <div className={styles.courseCover}><span>{composition[0]}</span><BookOpen /></div>
    <div className={styles.courseBody}>
      <h3>{course.title}</h3>
      <p>{course.description || "A reviewed adaptive course from your instructor."}</p>
      <div className={styles.courseComposition}>
        {composition.map((label, index) => <span key={label}>
          {index ? <i aria-hidden="true" /> : null}
          {label}
        </span>)}
      </div>
      {course.enrolled ? <div className={styles.progress}><span><i style={{ width: `${progress}%` }} /></span><small>{progress}% of course concepts mastered</small></div> : null}
      <button disabled={loading} onClick={onOpen} type="button">
        {loading ? <LoaderCircle className={styles.spin} /> : <Play />}
        <span>{course.enrolled ? "Continue course" : "Enroll in course"}</span><ArrowRight />
      </button>
    </div>
  </article>;
}

function timeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
