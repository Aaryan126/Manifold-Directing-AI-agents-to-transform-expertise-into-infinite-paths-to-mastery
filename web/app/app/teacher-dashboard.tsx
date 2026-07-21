"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  LayoutDashboard,
  Library,
  LoaderCircle,
  LogOut,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

import { BrandMark } from "../../components/brand-mark";
import { clearDevelopmentSession, readDevelopmentSession } from "../developmentSession";

import {
  courseState,
  type CourseRadarItem,
  type CourseSummary,
  type DashboardCommandResult,
  type DashboardSnapshot,
  type DevelopmentIdentity,
} from "./course-os";
import styles from "./course-os.module.css";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";
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
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState<DashboardCommandResult | null>(null);
  const [commanding, setCommanding] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const selected = readDevelopmentSession(window.localStorage);
      if (!selected || selected.role !== "instructor") {
        router.replace("/login");
        return;
      }
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
  }, [router]);

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

  async function runDashboardCommand(event?: FormEvent) {
    event?.preventDefault();
    if (!identity || commanding || !command.trim()) return;
    setCommanding(true);
    setCommandError(null);
    setCommandResult(null);
    try {
      const response = await fetch(`${pipelineBase}/instructors/me/dashboard/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-ID": identity.id },
        body: JSON.stringify({ content: command.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as DashboardCommandResult | { detail?: string } | null;
      if (!response.ok) throw new Error(payload && "detail" in payload ? payload.detail : "Manifold could not answer that yet.");
      setCommandResult(payload as DashboardCommandResult);
      if ((payload as DashboardCommandResult).kind === "proposal") await loadDashboard();
    } catch (caught) {
      setCommandError(caught instanceof Error ? caught.message : "Manifold could not answer that yet.");
    } finally {
      setCommanding(false);
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
            <IntelligenceBrief
              command={command}
              commanding={commanding}
              dashboard={dashboard}
              error={commandError}
              onChange={setCommand}
              onSubmit={runDashboardCommand}
              result={commandResult}
            />

            <section className={styles.dashboardOperations} aria-label="Teacher priorities">
              <article className={styles.priorityPanel} aria-labelledby="attention-title">
                <header>
                  <div>
                    <h2 id="attention-title">Needs your judgment</h2>
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
            </section>

            <CourseRadar courses={dashboard.course_radar ?? []} />

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
        <BrandMark />
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
        <button
          className={styles.sidebarLogout}
          onClick={() => {
            clearDevelopmentSession(window.localStorage);
            window.location.assign("/login");
          }}
          title={collapsed ? "Log out" : undefined}
          type="button"
        ><LogOut aria-hidden="true" /><span>Log out</span></button>
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

const suggestedCommands = [
  "What changed since yesterday?",
  "Where are learners confident but incorrect?",
  "Prepare improvements for my weakest topic.",
  "Find clips with high drop-off.",
  "Compare confidence across my courses.",
];

function IntelligenceBrief({
  command,
  commanding,
  dashboard,
  error,
  onChange,
  onSubmit,
  result,
}: {
  command: string;
  commanding: boolean;
  dashboard: DashboardSnapshot;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => Promise<void>;
  result: DashboardCommandResult | null;
}) {
  const radar = dashboard.course_radar ?? [];
  const activeAgents = radar.filter((course) => course.agent_status === "working").length;
  const topCourse = [...radar].sort((a, b) => b.open_issues - a.open_issues)[0];
  const headline = dashboard.attention.length
    ? `${dashboard.attention.length} decision${dashboard.attention.length === 1 ? " needs" : "s need"} your judgment.`
    : "Your course team is monitoring the evidence.";
  return (
    <section className={styles.intelligenceBrief} aria-labelledby="intelligence-brief-title">
      <div className={styles.briefHeading}>
        <span><Sparkles aria-hidden="true" /></span>
        <div>
          <small>Manifold intelligence brief</small>
          <h2 id="intelligence-brief-title">{headline}</h2>
          <p>{topCourse
            ? `${topCourse.title} is the current focus with ${topCourse.open_issues} open issue${topCourse.open_issues === 1 ? "" : "s"}. Evidence stays private until you approve a change.`
            : "As learner evidence arrives, Manifold will rank what deserves attention and brief the right specialist."}</p>
        </div>
        <dl>
          <div><dt>Live courses</dt><dd>{dashboard.published_courses}</dd></div>
          <div><dt>Active learners</dt><dd>{dashboard.active_learners}</dd></div>
          <div><dt>Specialists working</dt><dd>{activeAgents}</dd></div>
        </dl>
      </div>
      <form className={styles.dashboardCommand} onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor="dashboard-command">Ask about your courses or request a change…</label>
        <div>
          <input
            autoComplete="off"
            id="dashboard-command"
            onChange={(event) => onChange(event.target.value)}
            placeholder="Ask about your courses or request a change…"
            value={command}
          />
          <button aria-label="Ask Manifold" disabled={commanding || !command.trim()} type="submit">
            {commanding ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Send aria-hidden="true" />}
          </button>
        </div>
        <div className={styles.commandSuggestions} aria-label="Suggested commands">
          {suggestedCommands.map((suggestion) => (
            <button key={suggestion} onClick={() => onChange(suggestion)} type="button">{suggestion}</button>
          ))}
        </div>
      </form>
      {error ? <p className={styles.commandError} role="alert">{error}</p> : null}
      {result ? (
        <div className={styles.commandResult} data-kind={result.kind} role="status">
          <span>{result.kind === "proposal" ? <ClipboardCheck aria-hidden="true" /> : <Activity aria-hidden="true" />}</span>
          <p><strong>{result.kind === "proposal" ? "Private proposal prepared" : "Evidence answer"}</strong>{result.message}</p>
          {result.course_id && result.action_label ? (
            <Link href={`/app/courses/${result.course_id}`}>{result.action_label}<ArrowUpRight aria-hidden="true" /></Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CourseRadar({ courses }: { courses: CourseRadarItem[] }) {
  return (
    <section className={styles.courseRadar} aria-labelledby="course-radar-title">
      <header><div><h2 id="course-radar-title">Course radar</h2><p>Every published course, its learner evidence, and the specialist watching it.</p></div><span>Last 7 days</span></header>
      {courses.length ? (
        <div className={styles.radarScroller}>
          <div className={styles.radarTable} role="table" aria-label="Published course intelligence">
            <div className={styles.radarTableHead} role="row">
              <span role="columnheader">Course</span><span role="columnheader">Activity</span><span role="columnheader">Accuracy</span><span role="columnheader">Confidence</span><span role="columnheader">Clip completion</span><span role="columnheader">Mastery</span><span role="columnheader">Open issues</span><span role="columnheader">Agent</span>
            </div>
            {courses.map((course) => <CourseRadarRow course={course} key={course.course_id} />)}
          </div>
        </div>
      ) : <div className={styles.radarEmpty}><Activity aria-hidden="true" /><p><strong>No published-course evidence yet.</strong> The radar activates when a course is live.</p></div>}
    </section>
  );
}

function CourseRadarRow({ course }: { course: CourseRadarItem }) {
  const peak = Math.max(1, ...course.activity_trend);
  const route = `/app/courses/${course.course_id}`;
  return (
    <div className={styles.radarRow} role="row">
      <Link className={styles.radarCourse} href={`${route}?view=overview`} role="cell"><strong>{course.title}</strong><small>{course.active_learners} peak active learners</small></Link>
      <Link className={styles.radarActivity} href={`${route}?view=overview#learning-patterns`} role="cell" aria-label={`Inspect activity for ${course.title}`}>
        <span role="img" aria-label={`Seven-day learner activity: ${course.activity_trend.join(", ")}`}>
          {course.activity_trend.map((value, index) => <i key={index} style={{ height: `${Math.max(12, (value / peak) * 100)}%` }} />)}
        </span>
      </Link>
      <RadarMetric href={`${route}?view=overview#evidence-inspector`} label="accuracy" value={percent(course.accuracy_percent)} />
      <RadarMetric href={`${route}?view=overview#evidence-inspector`} label="confidence" note={course.confident_incorrect_attempts ? `${course.confident_incorrect_attempts} confident misses` : undefined} value={percent(course.confidence_percent)} />
      <RadarMetric href={`${route}?view=preview`} label="clip completion" note={course.clip_completion_percent === null ? undefined : `${Math.round(100 - course.clip_completion_percent)}% drop-off`} value={percent(course.clip_completion_percent)} />
      <RadarMetric href={`${route}?view=overview#evidence-inspector`} label="mastery" note={`+${course.mastery_movement} this week`} value={percent(course.mastery_percent)} />
      <Link className={styles.radarIssues} data-open={course.open_issues > 0 || undefined} href={`${route}?view=overview#priority-brief`} role="cell"><strong>{course.open_issues}</strong><small>{course.open_issues === 1 ? "issue" : "issues"}</small></Link>
      <Link className={styles.radarAgent} data-status={course.agent_status} href={`${route}?view=overview#course-team`} role="cell"><i /><span><strong>{agentStatus(course.agent_status)}</strong><small>{agentRole(course.agent_role)}</small></span></Link>
    </div>
  );
}

function RadarMetric({ href, label, note, value }: { href: string; label: string; note?: string; value: string }) {
  return <Link aria-label={`Inspect ${label}`} className={styles.radarMetric} href={href} role="cell"><strong>{value}</strong><small>{note ?? (value === "—" ? "Collecting evidence" : label)}</small></Link>;
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
function percent(value: number | null) { return value === null ? "—" : `${Math.round(value)}%`; }
function agentStatus(status: CourseRadarItem["agent_status"]) {
  return { working: "Working", ready_for_review: "Ready for review", needs_attention: "Needs attention", monitoring: "Monitoring" }[status];
}
function agentRole(role: CourseRadarItem["agent_role"]) {
  return role ? { learning_analyst: "Learning analyst", curriculum_architect: "Curriculum architect", clip_editor: "Clip editor", assessment_designer: "Assessment designer" }[role] : "Course team";
}
