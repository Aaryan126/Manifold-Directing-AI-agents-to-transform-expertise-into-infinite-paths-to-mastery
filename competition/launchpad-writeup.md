# Manifold — LaunchPad submission write-up

## Problem

Recorded expertise is abundant, but a lecture is still one linear path for every
learner. Making it adaptive requires work usually split across an instructional
designer, video editor, assessment writer, analyst, and platform engineer.
Independent instructors and small training teams rarely have that stack.

Existing authoring tools can accelerate course drafts, and adaptive platforms can
personalize delivery, but the hard gap is the complete accountable loop:
preserving the instructor's source, modeling what is taught, routing from learner
evidence, diagnosing failures, and improving the course without letting a private
AI draft silently reach learners.

We defined success before building: a two-hour lecture should become a
publishable adaptive course in under 60 minutes of active instructor work,
excluding asynchronous processing; initial generation must remain private,
editable, and auditable until explicit publication; later AI-proposed changes
must remain human-controlled; runtime routing must be explainable; and at least
one signal-to-revision loop must work end to end. The first target still requires
a matched timed instructor study and is not claimed as achieved.

## Approach

Manifold is a human-governed adaptive course compiler, not a generic course
generator or free-form tutor.

One durable pipeline converts an instructor-owned recording into timestamped
topics, a sparse prerequisite graph, reusable clips, concept-grounded questions,
confidence checks, and remediation routes. The coherent result automatically
becomes an editable private draft, while each artifact retains provenance and
stable identity across revisions. This removes clerical approval work without
giving AI publication authority: the instructor still chooses when the revision
reaches learners.

At learner runtime, deterministic policy combines prerequisites, correctness,
confidence, mastery, and reviewed content availability. Every decision persists
an attempt, mastery transition, route action, target, evidence snapshot, and
rationale. Cohort patterns become dashboard signals. Specialist agents may then
prepare a private revision, but these later evidence-driven changes return to the
Accept/Edit/Dismiss gate.

We chose PostgreSQL adjacency tables and recursive CTEs over a second graph
database because our graph scale is bounded and transactional consistency with
revisions, attempts, and audit records matters more than specialized
infrastructure. We chose a Postgres-backed durable queue over browser-owned jobs
so compilation survives navigation and service restarts. We use task-specific
GPT-5.4 agents rather than one autonomous prompt, with schema validation and
deterministic downstream services limiting each agent's authority.

## Evidence

The repository includes a reproducible evaluation harness that runs tests, starts
the production containers, measures warm endpoints, performs an optional
disposable real-provider compilation, calculates token cost, evaluates quality
gates, and deletes its benchmark course.

The recorded 2026-07-28 run passed 196 Python and 98 web/shared tests. Across 20
warm localhost trials, p95 latency was 17.55 ms for the active Blueprint and
29.43 ms for the new decision trace.

Using a cloned local transcript-backed lecture, the configured pipeline reached
the then-current review-ready private state in 213.91 seconds. It produced 5
topics, 4 concepts, 5
clips, and 5 questions with zero coverage gaps. Seventeen GPT-5.4 calls consumed
44,163 input tokens, 16,896 cached input tokens, and 8,183 output tokens. At
official GPT-5.4 rates, calculated token cost was $0.1951. These totals include a
clip-boundary validation failure that was persisted, retried, and recovered on
attempt two—evidence that durability is exercised, not decorative.

The in-product “Trace decision” view connects eight persisted stages: source
moment, concept, teaching clip, assessment, learner evidence, route event,
dashboard signal, and signal-linked proposed revision. It shows missing stages
explicitly rather than inventing causality. The current dataset exposes six of
eight, making the clean demo dataset requirement measurable.

Articulate is a direct AI-authoring comparison; H5P is a manual interactive-video
comparison; Area9 is a mature adaptive-platform comparison. Their official pages
verify useful overlapping capabilities, but no vendor claim is treated as an
independent speed baseline. ATD notes that traditional development time varies
with content, interactivity, media, expertise, tools, and review cycles, so our
next defensible comparison is a matched manual build using the same source.

## Constraints

The measured $0.1951 is model-token cost only. It excludes instructor labor,
hosting, storage, video delivery, and ASR because the benchmark intentionally
reused a cached transcript. Future reports must itemize those separately.

Compilation is asynchronous; instructor review is the scarce synchronous
resource. We measure pipeline and task wall time today but not active review time.
The dashboard suppresses low-sample claims, and the learner assistant cannot
generate new teaching content at runtime. It can act only through reviewed
artifacts and allowlisted operations.

Reliability comes from leases, idempotency, retries, revision isolation, immutable
attempts, and explicit missing-evidence states. The evaluation run itself found
and drove a fix for a partial-index upsert defect before generation could begin.

## Honesty & Trajectory

This is not yet evidence of improved learning outcomes. Current learner history
is demonstration data, not a controlled cohort. The under-60-minute instructor
target needs a timed review. Clip and graph quality still need human pedagogical
judgment. Development identity is not production authentication. The current
portfolio also contains stale untitled courses and is not suitable for a polished
demo reset.

Next we will curate one licensed, instructor-owned competition course with four to
six concepts, a real prerequisite, misconception, alternate explanation, and
remediation branch; seed a labelled deterministic learner history that yields one
interpretable signal and signal-linked proposal; add a reversible reset command;
time the instructor review; and run the same source through a matched H5P/manual
workflow. After that, a small real-learner study can test adaptive versus linear
delivery without overstating synthetic evidence.
