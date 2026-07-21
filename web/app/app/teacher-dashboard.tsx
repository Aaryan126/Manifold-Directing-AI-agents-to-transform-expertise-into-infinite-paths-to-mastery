"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  LayoutDashboard,
  Library,
  LoaderCircle,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Trash2,
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
const sidebarStorageKey = "manifold.sidebar-collapsed";

export function TeacherDashboard() {
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar } = useTeacherSidebar();
  const [identity, setIdentity] = useState<DevelopmentIdentity | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<CourseSummary | null>(null);
  const [showAllAttention, setShowAllAttention] = useState(false);
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

  async function deleteCourse() {
    if (!identity || !deleteCandidate || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`${pipelineBase}/courses/${deleteCandidate.id}`, {
        method: "DELETE",
        headers: { "X-User-ID": identity.id },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? "Could not delete the course.");
      }
      setDeleteCandidate(null);
      await loadDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the course.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={`${styles.appShell} ${sidebarCollapsed ? styles.sidebarCollapsedShell : ""}`}>
      <TeacherSidebar collapsed={sidebarCollapsed} identity={identity} onToggle={toggleSidebar} />
      <main className={styles.dashboardMain}>
        <header className={styles.dashboardHeader}>
          <div>
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
            <section className={styles.dashboardSummaryCard} aria-label="Portfolio summary">
              <Metric label="Courses" value={dashboard.total_courses} detail={`${dashboard.published_courses} live`} icon={<BookOpen />} />
              <Metric label="In review" value={dashboard.courses_in_review} detail="Needs approval" icon={<ClipboardCheck />} />
              <Metric label="Active learners" value={dashboard.active_learners} detail="Across published courses" icon={<Users />} />
            </section>

            <section className={styles.dashboardOperations} aria-label="Teacher priorities and course health">
              <article className={styles.priorityPanel} aria-labelledby="attention-title">
                <header>
                  <div>
                    <h2 id="attention-title">Priority inbox</h2>
                    <p>Where your judgment creates the most impact.</p>
                  </div>
                  {dashboard.attention.length > 3 ? (
                    <button onClick={() => setShowAllAttention((current) => !current)} type="button">
                      {showAllAttention ? "Show less" : "View all"}<ChevronRight aria-hidden="true" />
                    </button>
                  ) : <span>{dashboard.attention.length} open</span>}
                </header>
                <div className={styles.priorityList}>
                  {dashboard.attention.length ? (showAllAttention ? dashboard.attention : dashboard.attention.slice(0, 3)).map((item) => (
                    <Link className={styles.priorityItem} data-kind={item.kind} href={`/app/courses/${item.course_id}`} key={item.id}>
                      <span className={styles.priorityIcon}>{attentionIcon(item.kind)}</span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <em>{attentionAction(item.kind)}</em>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  )) : (
                    <div className={styles.priorityEmpty}>
                      <ClipboardCheck aria-hidden="true" />
                      <span><strong>You’re all caught up</strong><small>New review decisions and learner signals will appear here.</small></span>
                    </div>
                  )}
                </div>
              </article>
              <CourseHealth dashboard={dashboard} />
            </section>

            <section className={styles.coursesSection} aria-labelledby="courses-title">
              <div className={styles.sectionHeading}>
                <div>
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
                  {visibleCourses.map((course) => (
                    <CourseCard course={course} key={course.id} onDelete={() => setDeleteCandidate(course)} />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
      {deleteCandidate ? (
        <ConfirmDeleteDialog
          course={deleteCandidate}
          deleting={deleting}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void deleteCourse()}
        />
      ) : null}
    </div>
  );
}

export function TeacherSidebar({
  collapsed,
  compact = false,
  identity,
  onToggle,
}: {
  collapsed: boolean;
  compact?: boolean;
  identity: DevelopmentIdentity | null;
  onToggle: () => void;
}) {
  return (
    <aside className={compact ? styles.studioSidebar : styles.dashboardSidebar} data-collapsed={collapsed || undefined}>
      <Link className={styles.wordmark} href="/app" aria-label="Manifold teacher dashboard">
        <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
        <span>Manifold</span>
      </Link>
      <nav aria-label="Teacher workspace">
        <p>Workspace</p>
        <Link className={styles.activeNav} href="/app" title={collapsed ? "Overview" : undefined}><LayoutDashboard aria-hidden="true" /><span>Overview</span></Link>
        <Link href="/app#courses-title" title={collapsed ? "Courses" : undefined}><Library aria-hidden="true" /><span>Courses</span></Link>
        <span aria-disabled="true" title={collapsed ? "Insights — per course" : undefined}><BarChart3 aria-hidden="true" /><span>Insights<small>per course</small></span></span>
      </nav>
      <div className={styles.sidebarFooter}>
        <Link href="/manifold" title={collapsed ? "Legacy studio" : undefined}><CircleHelp aria-hidden="true" /><span>Legacy studio</span></Link>
        <div className={styles.profileChip}>
          <span>{initials(identity?.display_name ?? "Teacher")}</span>
          <div><strong>{identity?.display_name ?? "Teacher"}</strong><small>Instructor</small></div>
        </div>
        <button className={styles.sidebarToggle} onClick={onToggle} title={collapsed ? "Expand navigation" : "Collapse navigation"} type="button">
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span>{collapsed ? "Expand navigation" : "Collapse navigation"}</span>
        </button>
      </div>
    </aside>
  );
}

export function useTeacherSidebar() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(sidebarStorageKey) === "true");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarStorageKey, String(next));
      return next;
    });
  }, []);

  return { sidebarCollapsed, toggleSidebar };
}

function CourseCard({ course, onDelete }: { course: CourseSummary; onDelete: () => void }) {
  const state = courseState(course);
  return (
    <article className={styles.courseCard}>
      <Link className={styles.courseCardLink} href={`/app/courses/${course.id}`}>
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
      <button className={styles.courseDeleteButton} onClick={onDelete} type="button" aria-label={`Delete ${course.title}`}>
        <Trash2 aria-hidden="true" />
      </button>
    </article>
  );
}

function ConfirmDeleteDialog({
  course,
  deleting,
  onCancel,
  onConfirm,
}: {
  course: CourseSummary;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleting, onCancel]);

  return (
    <div className={styles.dialogBackdrop}>
      <section aria-describedby="delete-course-description" aria-labelledby="delete-course-title" aria-modal="true" className={styles.confirmDialog} role="dialog">
        <span><Trash2 aria-hidden="true" /></span>
        <h2 id="delete-course-title">Delete “{course.title}”?</h2>
        <p id="delete-course-description">This permanently removes the course, generated artifacts, and learner records. This cannot be undone.</p>
        <div>
          <button disabled={deleting} onClick={onCancel} ref={cancelButton} type="button">Keep course</button>
          <button disabled={deleting} onClick={onConfirm} type="button">
            {deleting ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            Delete permanently
          </button>
        </div>
      </section>
    </div>
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

function CourseHealth({ dashboard }: { dashboard: DashboardSnapshot }) {
  const highestActivity = Math.max(1, ...dashboard.activity_history.map((point) => point.active_learners));
  const weeklyActive = Math.max(0, ...dashboard.activity_history.map((point) => point.active_learners));
  return (
    <article className={styles.courseHealth} aria-labelledby="course-health-title">
      <header>
        <div><h2 id="course-health-title">Course health</h2><p>Learner activity across published courses</p></div>
        <span>This week<ChevronDown aria-hidden="true" /></span>
      </header>
      <div className={styles.healthLegend}>
        <span><i />Peak daily learners <strong>{weeklyActive}</strong></span>
        <span><i />New learners <strong>{dashboard.new_learners}</strong></span>
      </div>
      <div
        aria-label={`Active learners over the last seven days. Peak ${weeklyActive}.`}
        className={styles.healthChart}
        role="img"
      >
        {dashboard.activity_history.map((point) => (
          <div key={point.date}>
            <span><i style={{ height: point.active_learners ? `${Math.max(12, (point.active_learners / highestActivity) * 100)}%` : "3px" }}><b /></i></span>
            <small>{weekday(point.date)}</small>
          </div>
        ))}
      </div>
      <Link href="/app#courses-title">Open a course to view analytics<ArrowRight aria-hidden="true" /></Link>
    </article>
  );
}

function attentionIcon(kind: DashboardSnapshot["attention"][number]["kind"]) {
  if (kind === "generation_active") return <LoaderCircle className={styles.spin} aria-hidden="true" />;
  if (kind === "generation_failed") return <CircleAlert aria-hidden="true" />;
  if (kind === "learner_insight") return <MessageCircle aria-hidden="true" />;
  return <ClipboardCheck aria-hidden="true" />;
}

function attentionAction(kind: DashboardSnapshot["attention"][number]["kind"]) {
  if (kind === "generation_active") return "Building";
  if (kind === "generation_failed") return "Retry";
  if (kind === "learner_insight") return "Insight";
  return "Review";
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
function weekday(date: string) {
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
