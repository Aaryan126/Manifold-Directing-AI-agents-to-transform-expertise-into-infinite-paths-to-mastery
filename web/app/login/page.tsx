"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, GraduationCap, LoaderCircle, School } from "lucide-react";

import { BrandMark } from "../../components/brand-mark";
import {
  developmentDestination,
  readDevelopmentSession,
  saveDevelopmentSession,
  type DevelopmentSession,
} from "../developmentSession";
import styles from "./login.module.css";

const pipelineBase = process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<DevelopmentSession["role"]>("instructor");
  const [username, setUsername] = useState("David");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = readDevelopmentSession(window.localStorage);
    if (session) router.replace(developmentDestination(session.role));
  }, [router]);

  function chooseRole(nextRole: DevelopmentSession["role"]) {
    setRole(nextRole);
    setUsername(nextRole === "instructor" ? "David" : "Brian");
    setPassword("");
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${pipelineBase}/development/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json().catch(() => null)) as
        | (DevelopmentSession & { detail?: string })
        | null;
      if (!response.ok || !body?.id || !body.role) {
        throw new Error(body?.detail ?? "Could not sign in.");
      }
      if (body.role !== role) {
        throw new Error(`Those credentials belong to the ${body.role} workspace.`);
      }
      saveDevelopmentSession(window.localStorage, body);
      router.replace(developmentDestination(body.role));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" aria-label="Back to Manifold home"><ArrowLeft /><span>Back</span></Link>
        <Link className={styles.brand} href="/" aria-label="Manifold home"><BrandMark />Manifold</Link>
      </header>

      <section className={styles.loginPanel} aria-label="Sign in to Manifold">
        <div className={styles.roleSwitch} aria-label="Choose a workspace" role="group">
          <button aria-pressed={role === "instructor"} onClick={() => chooseRole("instructor")} type="button">
            <School aria-hidden="true" />
            <span><strong>Instructor</strong><small>Build and review courses</small></span>
          </button>
          <button aria-pressed={role === "learner"} onClick={() => chooseRole("learner")} type="button">
            <GraduationCap aria-hidden="true" />
            <span><strong>Student</strong><small>Learn through adaptive paths</small></span>
          </button>
        </div>

        <form onSubmit={submit}>
          <label>
            <span>Username</span>
            <input autoComplete="username" name="username" onChange={(event) => setUsername(event.target.value)} required value={username} />
          </label>
          <label>
            <span>Password</span>
            <input autoComplete="current-password" name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button className={styles.submit} disabled={submitting} type="submit">
            {submitting ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
            <span>{submitting ? "Signing in" : "Sign in"}</span>
          </button>
        </form>

        <p className={styles.notice}>This local access gate is for product development and demonstration. It is not production authentication.</p>
      </section>
    </main>
  );
}
