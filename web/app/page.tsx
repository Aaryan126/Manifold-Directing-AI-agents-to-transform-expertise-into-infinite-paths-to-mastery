"use client";

import Link from "next/link";
import {
  ArrowRight,
  GitBranch,
  Menu,
  Play,
  X,
} from "lucide-react";
import { useState } from "react";
import styles from "./landing.module.css";

const navigation = [
  { label: "Products", href: "/manifold" },
  { label: "Solutions", href: "/manifold" },
  { label: "Models", href: "/manifold" },
  { label: "Developers", href: "/manifold" },
  { label: "Blog", href: "/manifold" },
  { label: "Customers", href: "/manifold" },
  { label: "Company", href: "/manifold" },
];

const geometricCells = [
  "signal", "signal", "ember", "crimson", "signal", "gold", "signal", "signal",
  "signal", "gold", "ember", "crimson", "crimson", "signal", "signal", "signal",
  "signal", "signal", "crimson", "ember", "crimson", "signal", "ember", "signal",
  "crimson", "signal", "crimson", "crimson", "signal", "ember", "crimson", "signal",
] as const;

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className={styles.page}>
      <header className={styles.navbar}>
        <Link className={styles.brand} href="/" aria-label="Manifold home">
          <span className={styles.brandMark} aria-hidden="true">
            <GitBranch />
          </span>
          <span>Manifold</span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Primary navigation">
          {navigation.map((item) => (
            <a key={item.label} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className={styles.navActions}>
          <Link className={styles.startButton} href="/manifold">
            Start building
            <ArrowRight aria-hidden="true" />
          </Link>
          <button
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            className={styles.menuButton}
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>

        {menuOpen ? (
          <nav className={styles.mobileNav} aria-label="Mobile navigation">
            {navigation.map((item) => (
              <a key={item.label} href={item.href} onClick={() => setMenuOpen(false)}>
                {item.label}
                <ArrowRight aria-hidden="true" />
              </a>
            ))}
            <Link href="/manifold" onClick={() => setMenuOpen(false)}>
              Start building
              <ArrowRight aria-hidden="true" />
            </Link>
          </nav>
        ) : null}
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
          <Link href="/manifold">
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
            <Link href="/manifold">
              <span className={styles.newsIcon} aria-hidden="true">
                <Play />
              </span>
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
