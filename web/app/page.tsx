"use client";

import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";
import styles from "./landing.module.css";

const geometricCells = [
  "signal", "signal", "ember", "crimson", "signal", "gold", "signal", "signal",
  "signal", "gold", "ember", "crimson", "crimson", "signal", "signal", "signal",
  "signal", "signal", "crimson", "ember", "crimson", "signal", "ember", "signal",
  "crimson", "signal", "crimson", "crimson", "signal", "ember", "crimson", "signal",
] as const;

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.navbar}>
        <Link className={styles.brand} href="/" aria-label="Manifold home">
          Manifold
        </Link>

        <div className={styles.navActions}>
          <Link className={styles.startButton} href="/app">
            Start building
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroMain}>
          <h1 id="landing-title">
            <span>Turn lectures</span>
            <span>into adaptive</span>
            <span>learning journeys</span>
          </h1>
        </div>
        <div className={styles.heroAside}>
          <p>
            Transform existing lectures into personalized learning paths and
            mastery-based progression.
          </p>
          <Link href="/app">
            Build from a lecture
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className={styles.visualBand} aria-label="Manifold learning system">
        <div className={styles.geometricField}>
          <div className={styles.fieldGrid} aria-hidden="true">
            {geometricCells.map((cell, index) => (
              <span className={styles[cell]} key={`${cell}-${index}`} />
            ))}
          </div>
          <span className={styles.fieldLabelTop}>Instructor judgment</span>
          <span className={styles.fieldLabelLeft}>Source expertise</span>
          <span className={styles.fieldLabelBottom}>Infinite paths to master</span>
          <span className={styles.diamondOne} aria-hidden="true" />
          <span className={styles.diamondTwo} aria-hidden="true" />
          <span className={styles.fieldBrand} aria-hidden="true">
            <GitBranch />
          </span>
        </div>

        <aside className={styles.newsRail}>
          <div className={styles.featuredNews}>
            <p>Featured</p>
            <Link href="/app">
              <span>
                <strong>See a lecture become a course.</strong>
                <small>Open the prepared Manifold demo</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </section>
    </main>
  );
}
