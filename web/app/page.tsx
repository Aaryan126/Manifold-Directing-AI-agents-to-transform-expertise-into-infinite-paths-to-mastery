"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  GitBranch,
  Menu,
  Play,
  X,
} from "lucide-react";
import { useState } from "react";
import styles from "./landing.module.css";

const navigation = [
  { label: "Products", href: "#platform" },
  { label: "Solutions", href: "#workflow" },
  { label: "Models", href: "#intelligence" },
  { label: "Developers", href: "#developers" },
  { label: "Blog", href: "#notes" },
  { label: "Customers", href: "#for-teams" },
  { label: "Company", href: "#company" },
];

const geometricCells = [
  "signal", "signal", "ember", "crimson", "signal", "gold", "signal", "signal",
  "signal", "gold", "ember", "crimson", "crimson", "signal", "signal", "signal",
  "signal", "signal", "crimson", "ember", "crimson", "signal", "ember", "signal",
  "crimson", "signal", "crimson", "crimson", "signal", "ember", "crimson", "signal",
] as const;

const capabilities = [
  {
    id: "workflow",
    index: "01",
    title: "Structure the source",
    copy: "Turn a lecture into reviewed topics, concepts, prerequisites, and clean learner clips.",
  },
  {
    id: "intelligence",
    index: "02",
    title: "Keep judgment in the loop",
    copy: "AI proposes every artifact. Instructors approve the material and policy that reach learners.",
  },
  {
    id: "for-teams",
    index: "03",
    title: "Adapt with evidence",
    copy: "Route each learner by correctness, confidence, prerequisites, and demonstrated mastery.",
  },
];

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
            <ChevronDown aria-hidden="true" />
          </Link>
          <a
            className={styles.contactButton}
            href="mailto:hello@manifold.education?subject=Manifold%20course%20platform"
          >
            Contact sales
            <ArrowRight aria-hidden="true" />
          </a>
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
          <p className={styles.eyebrow}>Adaptive course infrastructure</p>
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
          <div className={styles.scrollCue} aria-hidden="true">
            <ArrowDown />
            <ArrowDown />
            <ArrowDown />
          </div>
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

      <section className={styles.platform} id="platform">
        <header>
          <p>One system, accountable at every step</p>
          <h2>From source recording to responsive course.</h2>
        </header>
        <div className={styles.capabilityGrid}>
          {capabilities.map((capability) => (
            <article id={capability.id} key={capability.id}>
              <span>{capability.index}</span>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.developerBand} id="developers">
        <p>Built for real teaching material, not synthetic courseware.</p>
        <Link href="/manifold">
          Explore the working product
          <ArrowRight aria-hidden="true" />
        </Link>
      </section>

      <footer className={styles.footer} id="company">
        <div>
          <span className={styles.footerMark} aria-hidden="true"><GitBranch /></span>
          <strong>Manifold</strong>
        </div>
        <p id="notes">Directing AI agents to transform expertise into infinite paths to master.</p>
        <a href="mailto:hello@manifold.education">hello@manifold.education</a>
      </footer>
    </main>
  );
}
