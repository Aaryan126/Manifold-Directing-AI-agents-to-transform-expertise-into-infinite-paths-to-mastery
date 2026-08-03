# Manifold — LaunchPad submission write-up

## 1. Problem

Recorded expertise is abundant, but a lecture is still one linear path for every
learner. Turning it into an adaptive course normally divides work among an
instructional designer, video editor, assessment writer, analyst, and platform
engineer. Independent instructors and small training teams rarely have that
stack.

AI authoring tools can draft content, while adaptive platforms can personalize
delivery. The missing system is the accountable loop between them: preserve what
the instructor actually taught, model its concepts and prerequisites, route from
learner evidence, diagnose failures, and improve the course without silently
letting an AI draft reach learners.

We defined success before building: convert a two-hour lecture in under 60
minutes of active instructor work; keep generated work private and auditable
until publication; keep later AI changes reviewable; explain every learner route;
and demonstrate a complete evidence-to-revision loop. The time target still
needs a matched study and is not claimed as achieved.

## 2. Approach

Manifold is a human-governed adaptive course compiler, not a generic generator or
free-form tutor. A durable pipeline converts an instructor-owned recording into
timestamped topics, a sparse prerequisite graph, reusable clips,
concept-grounded questions, confidence checks, and remediation routes. The
coherent result enters an editable private revision automatically; only the
instructor can publish it. Later AI-authored changes use the stricter independent
`Accept / Edit / Dismiss` proposal gate.

We deliberately use different intelligence for different kinds of authority:

- **OpenAI GPT-5.4 compiles the source into a course.** Segmentation, graph,
  clip, assessment, and enrichment tasks need long-context structured reasoning.
  GPT-5.4 supports a 1.05M-token context and structured outputs; errors here
  affect every learner's course.
- **Agnes 2.5 Flash powers interactive instructor agents.** Course Director
  returns closed-schema edit plans, while the dashboard may synthesize only
  retrieved evidence. These frequent interactions are bounded, latency-sensitive,
  and cost-sensitive.
- **Agnes 2.5 Flash interprets Learning Assistant requests.** It returns one
  allowlisted intent. Visible replies use persisted evidence and reviewed
  artifacts, never newly generated teaching.
- **Deterministic code owns routing and publication.** Prerequisites, correctness,
  confidence, mastery transitions, and publication are policy and safety
  boundaries, not prompts.

This is not a cosmetic integration. All-GPT would spend frontier-model capacity
on narrow interactions; moving the unbenchmarked compiler to Agnes would risk
the highest-consequence artifacts. One unrestricted agent would be harder to
audit. Agnes therefore handles bounded interaction while GPT-5.4 handles the
quality-critical compiler.

Agnes uses its documented OpenAI-compatible `/v1/chat/completions` interface.
Responses are Pydantic-validated, use temperature zero, receive at most three
repair attempts, and record provider/model/token/latency telemetry. Course
Director plans are validated against the real graph before becoming proposals.
Provider fallback cannot bypass review or publication. The split follows Agnes's
2.5 Flash agent-workflow guidance ([catalog](https://github.com/AgnesAI-Labs/AgnesAI-Models/blob/main/MODEL_CATALOG.md)) and GPT-5.4's documented long-context structured outputs ([model page](https://developers.openai.com/api/docs/models/gpt-5.4)).

PostgreSQL adjacency tables keep graphs transactionally consistent with
revisions, attempts, and audits. Its durable queue also lets compilation survive
navigation, retries, and service restarts.

## 3. Evidence

The verified suite passes: 236 backend tests, 112 web tests, one shared test,
Ruff, strict mypy, ESLint, TypeScript, and the production build. Twelve
Agnes-specific contracts cover request shape, invalid-output rejection, schema
repair, provider wiring, telemetry, graph validation, evidence filtering,
allowlisted intents, and fallback isolation.

A real no-fallback integration test exercised all three Agnes functions. Course
Director returned the exact requested relationship removal while retaining the
alternate placement; dashboard synthesis selected only saved evidence IDs; the
Learning Assistant returned the allowlisted `why_next` intent; and all calls
recorded Agnes 2.5 Flash telemetry. The public Render deployment then completed a
real grounded dashboard request successfully with Agnes enabled.

For the recorded cost benchmark, our reproducible harness cloned one
transcript-backed lecture
into a disposable course, ran the complete GPT-5.4 generation pipeline, captured
usage returned by the provider for every call, evaluated the output, and deleted
the course. In 213.91 seconds, 17 GPT-5.4 calls produced 5 topics, 4 concepts, 5
clips, and 5 questions with zero coverage gaps. Those calls reported 44,163 input
tokens, including 16,896 cached input tokens, plus 8,183 output tokens. Applying
OpenAI's documented GPT-5.4 rates of $2.50 per million input tokens, $0.25 per
million cached-input tokens, and $15 per million output tokens gives $0.1951 in
model-token cost. A persisted clip-validation failure retried and recovered on
attempt two, exercising durability rather than merely describing it.

The judge-facing `Trace decision` view now shows a complete eight-stage persisted
chain: source moment → concept → teaching clip → assessment → labelled simulated
learner evidence → deterministic route event → dashboard signal → signal-linked
private proposed revision. Missing evidence is shown explicitly; causality is
never inferred from proximity.

## 4. Constraints

The $0.1951 above measures only GPT-5.4 tokens used after loading an already
available transcript. It is not the total cost of creating or operating a course:
the benchmark excludes instructor labor, hosting, storage, video delivery, ASR,
and Agnes interactions. Agnes's lower-cost operating model motivates the
interactive boundary, but we do not claim a measured saving until equivalent
work has provider-returned usage and billing data.

Render has cold starts; development login is not production authentication;
provider availability can vary; model output can still be malformed; and
pedagogical quality needs instructor judgment. Validation, bounded retries,
evidence allowlists, revision isolation, and publication gates reduce—not
eliminate—these risks. Fallback never changes evidence, review, or publication
authority.

## 5. Honesty & Trajectory

This is evidence that the system compiles, validates, routes, traces, and proposes
revisions—not evidence that it improves learning outcomes. The current learner
history is explicitly labelled simulation data, not a controlled cohort. The
under-60-minute active-instructor target still needs timing, and generated graph,
clip, and assessment quality still needs structured human evaluation.

Next, we will compare the same licensed source in Manifold and a matched
manual/H5P workflow; measure time, corrections, and itemized provider costs; and
test substitutions only where quality gates hold. A real-learner study can then
compare adaptive and linear delivery. Production authentication, security
hardening, and concurrent Agnes availability testing precede institutional use.
