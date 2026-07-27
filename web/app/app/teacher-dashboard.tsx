"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
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
  Trash2,
} from "lucide-react";

import { BrandMark } from "../../components/brand-mark";
import { clearDevelopmentSession, readDevelopmentSession } from "../developmentSession";

import {
  courseState,
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<CourseSummary | null>(null);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState<DashboardCommandResult | null>(null);
  const [commanding, setCommanding] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const creationRequestId = useRef<string | null>(null);

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

  async function createCourse(title: string) {
    if (!identity || creating || !title.trim()) return;
    const requestId = creationRequestId.current ?? crypto.randomUUID();
    creationRequestId.current = requestId;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`${pipelineBase}/courses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
          "X-User-ID": identity.id,
        },
        body: JSON.stringify({
          title: title.trim(),
          brief: {
            origin: "teacher_command_center",
            creation_mode: "course_container",
          },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? "Could not create the course.");
      }
      const course = (await response.json()) as CourseSummary;
      setCreateDialogOpen(false);
      creationRequestId.current = null;
      router.push(`/app/courses/${course.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the course.");
      setCreating(false);
    }
  }

  function openCreateDialog() {
    creationRequestId.current = crypto.randomUUID();
    setCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    if (creating) return;
    creationRequestId.current = null;
    setCreateDialogOpen(false);
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
          <button className={styles.primaryButton} disabled={creating || loading} onClick={openCreateDialog} type="button">
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
              <LearnerActivity dashboard={dashboard} />
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
                <EmptyPortfolio onCreate={openCreateDialog} creating={creating} />
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
      {createDialogOpen ? (
        <CreateCourseDialog
          creating={creating}
          onCancel={closeCreateDialog}
          onConfirm={(title) => void createCourse(title)}
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

function CreateCourseDialog({
  creating,
  onCancel,
  onConfirm,
}: {
  creating: boolean;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [creating, onCancel]);

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target && !creating) onCancel();
    }}>
      <form
        aria-describedby="create-course-description"
        aria-labelledby="create-course-title"
        aria-modal="true"
        className={styles.createCourseDialog}
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onConfirm(title.trim());
        }}
        role="dialog"
      >
        <small>New course</small>
        <h2 id="create-course-title">Name the course</h2>
        <p id="create-course-description">Create the course home first. You’ll add lectures and build their Blueprints from Course Flow.</p>
        <label>
          Course title
          <input
            autoFocus
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Foundations of Product Design"
            value={title}
          />
        </label>
        <div>
          <button disabled={creating} onClick={onCancel} type="button">Cancel</button>
          <button disabled={creating || !title.trim()} type="submit">
            {creating ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
            Create course
          </button>
        </div>
      </form>
    </div>
  );
}

const suggestedCommands = [
  "What changed since yesterday?",
  "Find confident misconceptions",
  "Improve my weakest topic",
  "Find high-drop-off clips",
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
  const topCourse = [...radar].sort((a, b) => b.open_issues - a.open_issues)[0];
  const totalIssues = radar.reduce((total, course) => total + course.open_issues, 0);
  const latestActivity = dashboard.activity_history.at(-1)?.active_learners ?? 0;
  const previousActivity = dashboard.activity_history.at(-2)?.active_learners ?? 0;
  const activitySummary = latestActivity === previousActivity
    ? `learner activity held at ${latestActivity}`
    : `learner activity ${latestActivity > previousActivity ? "rose" : "fell"} from ${previousActivity} to ${latestActivity}`;
  const headline = topCourse && totalIssues > 0
    ? `${topCourse.title}: ${topCourse.open_issues} of ${totalIssues} open issues; ${activitySummary}.`
    : radar.length
      ? `No open course issues; ${activitySummary}.`
      : "Publish a course to begin monitoring learner evidence.";
  const support = topCourse
    ? `${dashboard.courses_in_review} course${dashboard.courses_in_review === 1 ? " is" : "s are"} awaiting review. Manifold will keep every proposed change private until you approve it.`
    : "Manifold will compare activity, confidence, mastery, and clip completion as evidence arrives.";
  return (
    <section className={styles.intelligenceBrief} aria-labelledby="intelligence-brief-title">
      <div className={styles.briefHeading}>
        <div>
          <h2 id="intelligence-brief-title">{headline}</h2>
          <p>{support}</p>
        </div>
      </div>
      <form className={styles.dashboardCommand} onSubmit={(event) => void onSubmit(event)}>
        <label className={styles.srOnly} htmlFor="dashboard-command">Ask Manifold about your courses or request a private change</label>
        <div>
          <input
            autoComplete="off"
            id="dashboard-command"
            onChange={(event) => onChange(event.target.value)}
            placeholder="Ask Manifold anything…"
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
          <div className={styles.commandResultSummary}>
            <div className={styles.commandResultCopy}>
              <div>
                <strong>{result.kind === "proposal" ? "Private proposal" : "Manifold"}</strong>
                <span>{result.kind === "proposal"
                  ? "Awaiting your review"
                  : `${result.searched_course_count} course${result.searched_course_count === 1 ? "" : "s"} checked`}</span>
              </div>
              <div aria-label="Manifold answer" className={styles.commandMarkdown}>
                <ReactMarkdown>{result.message}</ReactMarkdown>
              </div>
            </div>
            {result.course_id && result.action_label ? (
              <Link href={`/app/courses/${result.course_id}`}>{result.action_label}<ArrowUpRight aria-hidden="true" /></Link>
            ) : null}
          </div>
          {result.evidence?.length ? (
            <details className={styles.commandEvidence}>
              <summary>
                <span>Evidence used</span>
                <small>{result.evidence.length} saved signal{result.evidence.length === 1 ? "" : "s"}</small>
                <ChevronRight aria-hidden="true" />
              </summary>
              <ul aria-label="Evidence used">
                {result.evidence.map((item) => (
                  <li key={item.id}>
                    <span>{item.course_title ?? "Portfolio"}</span>
                    <strong>{item.label}</strong>
                    <small>{item.value}</small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LearnerActivity({ dashboard }: { dashboard: DashboardSnapshot }) {
  const history = dashboard.activity_history;
  const peak = Math.max(1, ...history.map((point) => point.active_learners));
  const chartWidth = 600;
  const chartTop = 18;
  const chartBottom = 128;
  const chartInset = 30;
  const chartPoints = history.map((point, index) => ({
    ...point,
    x: history.length === 1
      ? chartWidth / 2
      : chartInset + (index * (chartWidth - chartInset * 2)) / (history.length - 1),
    y: chartBottom - (point.active_learners / peak) * (chartBottom - chartTop),
  }));
  const chartPath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const latest = history.at(-1)?.active_learners ?? 0;
  const previous = history.at(-2)?.active_learners ?? 0;
  const change = latest - previous;
  const trend = change === 0
    ? `Daily activity held at ${latest}.`
    : `Daily activity ${change > 0 ? "rose" : "fell"} by ${Math.abs(change)} since yesterday.`;
  const chartLabel = history.length
    ? `Daily active learners over the last seven days: ${history.map((point) => `${formatActivityDate(point.date)} ${point.active_learners}`).join(", ")}.`
    : "No daily learner activity recorded in the last seven days.";

  return (
    <article className={styles.learnerActivityPanel} aria-labelledby="learner-activity-title">
      <header>
        <div>
          <h2 id="learner-activity-title">Learner activity</h2>
          <p>Daily learners who completed a knowledge check.</p>
        </div>
        <span>Last 7 days</span>
      </header>
      <div className={styles.learnerActivitySummary}>
        <div><strong>{dashboard.active_learners}</strong><span>enrolled learners</span></div>
        <div><strong>+{dashboard.new_learners}</strong><span>new this week</span></div>
      </div>
      {history.length ? (
        <div className={styles.learnerActivityChart} role="img" aria-label={chartLabel}>
          <svg aria-hidden="true" className={styles.learnerActivityPlot} viewBox={`0 0 ${chartWidth} 150`}>
            <line className={styles.learnerActivityGridLine} x1={chartInset} x2={chartWidth - chartInset} y1="73" y2="73" />
            <line className={styles.learnerActivityGridLine} x1={chartInset} x2={chartWidth - chartInset} y1={chartBottom} y2={chartBottom} />
            <path className={styles.learnerActivityLine} d={chartPath} />
            {chartPoints.map((point) => (
              <g key={point.date}>
                <text className={styles.learnerActivityValue} textAnchor="middle" x={point.x} y={Math.max(12, point.y - 10)}>
                  {point.active_learners}
                </text>
                <circle className={styles.learnerActivityPoint} cx={point.x} cy={point.y} r="5" />
              </g>
            ))}
          </svg>
          <div className={styles.learnerActivityLabels}>
            {history.map((point) => (
              <small data-value={point.active_learners} key={point.date}>{formatActivityDate(point.date)}</small>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.learnerActivityEmpty}>
          <Activity aria-hidden="true" />
          <span><strong>Collecting learner activity</strong><small>Knowledge-check activity will appear after a course is live.</small></span>
        </div>
      )}
      <footer>
        <span><i />Active through assessment evidence</span>
        <p>{trend}</p>
      </footer>
    </article>
  );
}

function formatActivityDate(date: string) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short" })
    .format(new Date(`${date}T00:00:00Z`));
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
