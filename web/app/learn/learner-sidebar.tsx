"use client";

import Link from "next/link";
import { BookOpen, GraduationCap, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { BrandMark } from "../../components/brand-mark";
import { clearDevelopmentSession, type DevelopmentSession } from "../developmentSession";
import styles from "../app/course-os.module.css";

const learnerSidebarKey = "manifold.learner-sidebar-collapsed";

export function LearnerSidebar({ session, active }: { session: DevelopmentSession; active: "home" | "course" }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(learnerSidebarKey) === "true");
  }, []);

  return (
    <aside className={styles.dashboardSidebar} data-collapsed={collapsed || undefined}>
      <Link className={styles.wordmark} href="/learn" aria-label="Manifold learner dashboard">
        <BrandMark />
        <span>Manifold</span>
      </Link>
      <nav aria-label="Learner workspace">
        <p>Learn</p>
        <Link className={active === "home" ? styles.activeNav : undefined} href="/learn" title={collapsed ? "Overview" : undefined}>
          <LayoutDashboard aria-hidden="true" /><span>Overview</span>
        </Link>
        <Link className={active === "course" ? styles.activeNav : undefined} href="/learn#courses" title={collapsed ? "My courses" : undefined}>
          <BookOpen aria-hidden="true" /><span>My courses</span>
        </Link>
        <span aria-disabled="true" title={collapsed ? "Mastery — inside each course" : undefined}>
          <GraduationCap aria-hidden="true" /><span>Mastery<small>per course</small></span>
        </span>
      </nav>
      <div className={styles.sidebarFooter}>
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
          <span>{session.display_name.slice(0, 2).toUpperCase()}</span>
          <div><strong>{session.display_name}</strong><small>Student</small></div>
        </div>
        <button
          className={styles.sidebarToggle}
          onClick={() => setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem(learnerSidebarKey, String(next));
            return next;
          })}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          type="button"
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span>{collapsed ? "Expand navigation" : "Collapse navigation"}</span>
        </button>
      </div>
    </aside>
  );
}
