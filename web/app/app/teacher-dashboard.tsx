"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Library,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Users,
} from "lucide-react";

import {
  courseState,
  type CourseSummary,
  type DashboardSnapshot,
  type DevelopmentIdentity,
} from "./course-os";
import styles from "./course-os.module.css";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";
const instructorStorageKey = "manifold.teacher-id";

export function TeacherDashboard() {
  const router = useRouter();
  const [identity, setIdentity] = useState<DevelopmentIdentity | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const identitiesResponse = await fetch(`${pipelineBase}/development/identities`);
      if (!identitiesResponse.ok) throw new Error("Could not load your teacher workspace.");
      const identities = (await identitiesResponse.json()) as DevelopmentIdentity[];
      const instructors = identities.filter((candidate) => candidate.role === "instructor");
      const remembered = window.localStorage.getItem(instructorStorageKey);
      const selected = instructors.find((candidate) => candidate.id === remembered) ?? instructors[0];
      if (!selected) throw new Error("No instructor identity is available.");
      window.localStorage.setItem(instructorStorageKey, selected.id);
      setIdentity(selected);
      const response = await fetch(`${pipelineBase}/instructors/me/dashboard`, {
        headers: { "X-User-ID": selected.id },
      });
      if (!response.ok) throw new Error("Could not load your courses.");
      setDashboard((await response.json()) as DashboardSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const visibleCourses = useMemo(() => {
    if (!dashboard) return [];
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return dashboard.courses;
    return dashboard.courses.filter((course) =>
      `${course.title} ${course.description ?? ""}`.toLocaleLowerCase().includes(normalized),
    );
  }, [dashboard, query]);

  async function createCourse() {
    if (!identity || creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`${pipelineBase}/courses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": identity.id,
        },
        body: JSON.stringify({
          title: "Untitled course",
          brief: { origin: "teacher_command_center" },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? "Could not create the course.");
      }
      const course = (await response.json()) as CourseSummary;
      router.push(`/app/courses/${course.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the course.");
      setCreating(false);
    }
  }

  return (
    <div className={styles.appShell}>
      <TeacherSidebar identity={identity} />
      <main className={styles.dashboardMain}>
        <header className={styles.dashboardHeader}>
          <div>
            <p className={styles.eyebrow}>Teacher command center</p>
            <h1>{identity ? `Good ${timeOfDay()}, ${firstName(identity.display_name)}.` : "Your courses"}</h1>
            <p>Build with Manifold, then focus your judgment where it changes learning.</p>
          </div>
          <button className={styles.primaryButton} disabled={creating || loading} onClick={createCourse} type="button">
            {creating ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
            New course
          </button>
        </header>

        {error ? (
          <div className={styles.errorBanner} role="alert">
            <span>{error}</span>
            <button onClick={() => void loadDashboard()} type="button">Try again</button>
          </div>
        ) : null}

        {loading ? <DashboardSkeleton /> : dashboard ? (
          <>
            <section className={styles.metricRow} aria-label="Portfolio summary">
              <Metric label="Courses" value={dashboard.total_courses} detail={`${dashboard.published_courses} live`} icon={<BookOpen />} />
              <Metric label="Need your review" value={dashboard.courses_in_review} detail="Private until approved" icon={<Sparkles />} />
              <Metric label="Active learners" value={dashboard.active_learners} detail="Across published courses" icon={<Users />} />
            </section>

            {dashboard.attention.length > 0 ? (
              <section className={styles.attentionSection} aria-labelledby="attention-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>Attention</p>
                    <h2 id="attention-title">Worth your judgment</h2>
                  </div>
                  <span>{dashboard.attention.length} open</span>
                </div>
                <div className={styles.attentionGrid}>
                  {dashboard.attention.slice(0, 3).map((item) => (
                    <Link className={styles.attentionCard} data-urgency={item.urgency} href={`/app/courses/${item.course_id}`} key={item.id}>
                      <span className={styles.attentionMarker} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={styles.coursesSection} aria-labelledby="courses-title">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Portfolio</p>
                  <h2 id="courses-title">Your courses</h2>
                </div>
                {dashboard.courses.length > 4 ? (
                  <label className={styles.searchBox}>
                    <Search aria-hidden="true" />
                    <span className={styles.srOnly}>Search courses</span>
                    <input onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" value={query} />
                  </label>
                ) : null}
              </div>

              {dashboard.courses.length === 0 ? (
                <EmptyPortfolio onCreate={createCourse} creating={creating} />
              ) : (
                <div className={styles.courseGrid}>
                  {visibleCourses.map((course) => <CourseCard course={course} key={course.id} />)}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

export function TeacherSidebar({ identity, compact = false }: { identity: DevelopmentIdentity | null; compact?: boolean }) {
  return (
    <aside className={compact ? styles.studioSidebar : styles.dashboardSidebar}>
      <Link className={styles.wordmark} href="/app" aria-label="Manifold teacher dashboard">
        <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
        <span>Manifold</span>
      </Link>
      <nav aria-label="Teacher workspace">
        <p>Workspace</p>
        <Link className={styles.activeNav} href="/app"><LayoutDashboard aria-hidden="true" />Overview</Link>
        <Link href="/app#courses-title"><Library aria-hidden="true" />Courses</Link>
        <span aria-disabled="true"><Sparkles aria-hidden="true" />Insights<small>per course</small></span>
      </nav>
      <div className={styles.sidebarFooter}>
        <Link href="/manifold"><CircleHelp aria-hidden="true" />Legacy studio</Link>
        <div className={styles.profileChip}>
          <span>{initials(identity?.display_name ?? "Teacher")}</span>
          <div><strong>{identity?.display_name ?? "Teacher"}</strong><small>Instructor</small></div>
        </div>
      </div>
    </aside>
  );
}

function CourseCard({ course }: { course: CourseSummary }) {
  const state = courseState(course);
  return (
    <Link className={styles.courseCard} href={`/app/courses/${course.id}`}>
      <div className={styles.courseCover} data-tone={state.tone}>
        <span>{course.topic_count > 0 ? `${course.topic_count} topics` : "New course"}</span>
        {state.tone === "building" ? <div className={styles.miniProgress}><i style={{ width: `${course.generation_progress}%` }} /></div> : null}
      </div>
      <div className={styles.courseCardBody}>
        <div className={styles.courseTitleRow}>
          <h3>{course.title}</h3>
          <ChevronRight aria-hidden="true" />
        </div>
        <p>{course.description || "Manifold is ready to turn your lecture into a private course draft."}</p>
        <div className={styles.courseMeta}>
          <span data-tone={state.tone}><i />{state.label}</span>
          <small>{state.action}</small>
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: ReactNode }) {
  return (
    <article className={styles.metricCard}>
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
    </article>
  );
}

function EmptyPortfolio({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <div className={styles.emptyPortfolio}>
      <span className={styles.emptyOrbit} aria-hidden="true"><i /><i /><i /></span>
      <p className={styles.eyebrow}>Your first course</p>
      <h3>Bring the lecture. Manifold will build the draft.</h3>
      <p>Upload a recording or paste a link. You’ll return when the complete course is ready for your review.</p>
      <button className={styles.primaryButton} disabled={creating} onClick={onCreate} type="button"><Plus />Create a course</button>
    </div>
  );
}

function DashboardSkeleton() {
  return <div className={styles.skeletonGrid} aria-label="Loading dashboard"><i /><i /><i /><i /><i /></div>;
}

function firstName(name: string) { return name.trim().split(/\s+/)[0] || "Teacher"; }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function timeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
