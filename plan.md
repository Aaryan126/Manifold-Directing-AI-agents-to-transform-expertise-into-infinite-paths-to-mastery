# Implementation Plan

**Companion docs:** `prd.md` (what/why), `implementation.md` (live status — update after every phase), `AGENTS.md` (agent operating instructions)

**How to use this document:** Phases are ordered by dependency, not by time pressure — there is no deadline constraint on this build (see `AGENTS.md`). Each phase has: goal, deliverables, automated tests (the coding agent writes and runs these as part of the phase, not after), and a human test checklist (the coding agent presents this to the user at the end of the phase; the agent does not mark a phase "done" in `implementation.md` until the user confirms the human tests passed).

A phase is only complete when: (1) its deliverables exist, (2) its automated tests pass, (3) the user has run and confirmed the human test checklist, (4) `implementation.md` has been updated to reflect it.

---

## Phase 0 — Project Scaffolding & Architecture Decisions

**Goal:** Stand up the repo structure, tooling, and make/record the concrete stack decisions that `prd.md` Section 8 leaves as recommendations.

**Deliverables:**
- Replace the guided wizard as the primary instructor model with the Agent-led Course OS defined in `ui-redesign-plan.md`: Teacher Command Center, conversational Course Studio, complete private-draft generation, review bundles, semantic Course Map, published-course workspace, and versioned `Publish updates`.
- Add durable Postgres-backed generation runs/tasks owned by the pipeline service so transcription through quality review continues without an open browser, survives restart, retries safely, and exposes isolated failures.
- Add active/working course revisions and stable logical artifact identities. Existing courses are backfilled without losing audit history; published updates preserve completed learner work and apply new content to future routing.
- Add instructor course-list/attention APIs, persisted course conversations, typed change proposals, review bundles, and evidence-grounded course/insights copilot behavior.
- Build the new product in parallel under `/app`, retain `/manifold` as rollback until parity and human approval, then switch landing CTAs and remove the legacy mode after the rollback window.
- Monorepo structure: `/web` (Next.js app), `/pipeline` (Python AI/video service), `/shared` (shared types/schemas if applicable).
- Postgres schema migration tooling set up (matching `prd.md` Section 9 entities, minus anything decided against in this phase).
- Decision recorded (in `implementation.md`, not just verbally): graph storage approach (dedicated graph DB vs. Postgres adjacency tables), LLM provider/model, ASR provider, video delivery approach.
- Local dev environment (Docker Compose) that runs web + pipeline + Postgres together.
- CI pipeline skeleton (lint, typecheck, unit test runner) even if minimal at this stage.

**Automated tests:**
- CI runs successfully on an empty/scaffold commit (lint + typecheck pass).
- Docker Compose brings up all services and a health-check endpoint on each responds 200.

**Human test checklist:**
- [ ] Clone repo fresh, run the documented setup command, confirm it works without undocumented manual steps.
- [ ] Confirm the stack decisions recorded in `implementation.md` match what you expected/agreed; flag anything to reconsider now rather than later.

---

## Phase 1 — Video Ingestion & Transcription

**Goal:** Upload/link a video, get a time-aligned transcript, stored and retrievable.

**Deliverables:**
- Upload endpoint (file) + URL-ingest endpoint (e.g. YouTube link) in `/pipeline`.
- Async job handling (Temporal or chosen queue) with a status endpoint the frontend can poll.
- ASR integration producing word/phrase-level timestamped transcript, stored against the Video entity.
- Minimal frontend: upload screen + processing status view.

**Automated tests:**
- Unit: job state transitions (queued → processing → complete/failed).
- Integration: fixture short video (~1–2 min, checked into test fixtures or fetched from a stable public source) produces a transcript with timestamps within expected tolerance.
- Failure-path test: corrupt/unsupported file produces a clear failed state, not a silent hang.

**Human test checklist:**
- [ ] Upload a real lecture video (5–20 min) end to end; confirm status updates are accurate and the final transcript is reasonably accurate against what you actually hear.
- [ ] Try a YouTube link ingest (if in scope for this phase) and confirm equivalent behavior.
- [ ] Try an intentionally bad input (e.g. an audio-only file, or a very short clip) and confirm the failure is clear, not confusing.

---

## Phase 2 — Topic Segmentation + Editable Outline (first HITL checkpoint)

**Goal:** AI proposes topic boundaries; instructor can review and edit them before anything downstream happens.

**Deliverables:**
- Segmentation agent using OpenAI GPT-5.4: transcript → proposed topics (title, time range, summary) targeting 10–20 min chunks based on semantic shifts, not fixed windows.
- Editable outline UI: merge/split/rename/re-time/delete/add topics, backed by the Topic entity.
- Persisting instructor edits distinctly from the original AI proposal (for traceability, per `prd.md` Section 5).

**Automated tests:**
- Unit: boundary-merge/split logic, time-range validation (no overlaps, no gaps beyond a defined tolerance).
- Integration: fixture transcript → segmentation produces topics within the target length range for a "well-behaved" lecture structure.
- Regression: instructor edits persist correctly and are distinguishable from AI-original proposals in the data layer.

**Human test checklist:**
- [ ] Run segmentation on a real lecture; time how long a full review/edit pass takes (target: well under 10 min for a 2-hour lecture — flag if this is unrealistic once you've tried it).
- [ ] Deliberately test the edit interactions (merge two topics, split one, rename, drag a boundary) — confirm each feels fast and doesn't lose data.
- [ ] Judge subjectively: do the AI's proposed boundaries make pedagogical sense, or does it default to naive time-slicing?

---

## Phase 3 — Concept & Prerequisite Graph + Graph Editor (second HITL checkpoint)

**Goal:** AI proposes a cross-topic concept graph; instructor can visually review/edit it. This is called out in `prd.md` as the single most important review step — treat UI quality here as a first-class concern, not an afterthought.

**Deliverables:**
- Graph-building agent using OpenAI GPT-5.4: topics + transcript → Concept nodes + ConceptEdge (`requires`) relationships, spanning the whole course (not just within-topic).
- Sparse graph policy: one to three independently assessable concepts per topic, at most two direct prerequisites per concept, and no edge inferred from chronology/adjacency alone.
- Regeneration reconciliation preserves accepted, edited, dismissed, and merged instructor decisions while replacing only unreviewed proposals and suppressing near-duplicate resurrection.
- Graph storage per the Phase 0 decision (dedicated graph DB or Postgres adjacency).
- Visual graph editor (e.g. React Flow-based): active-by-default topic-grouped canvas, topic-plus-neighbor focus view, explicit dismissed history, direct node positioning, instructor-authored concept creation, traceable node removal, add/remove/re-link edges, merge duplicate concepts, rename nodes, and repair concept-to-topic links that gate downstream clip and assessment generation.
- Runtime query capability: given a set of mastered concepts, compute eligible next concepts efficiently (needed by Phase 6).

**Automated tests:**
- Unit: cycle detection (a prerequisite graph must be a DAG — reject/flag edges that would create cycles), edge CRUD operations.
- Integration: fixture course → graph-building produces a sparse, acyclic graph with one to three concepts covering every reviewed topic; regeneration preserves all instructor-reviewed graph decisions.
- Performance: "eligible next concepts" query returns within an acceptable latency bound (define the bound in `implementation.md` once real data volumes are known) since this is called on every learner interaction later.

**Human test checklist:**
- [ ] Review a real generated graph for a real lecture — does the prerequisite structure match your actual understanding of how the material builds? Note specific wrong/missing edges.
- [ ] Test editing interactions (add edge, remove edge, merge nodes) for correctness and usability.
- [ ] For a large course, compare the topic-grouped full graph with topic focus; confirm the focused topic plus immediate prerequisite/dependent context remains understandable.

---

## Phase 4 — Clip Extraction & Tagging

**Goal:** Cut each topic into reusable, independently-playable sub-clips, tagged by type and concept.

**Deliverables:**
- Clip extraction agent using OpenAI GPT-5.4: topic + transcript + concept tags → clip boundaries (clean in/out points) and type classification (`definition`, `worked_example`, `explanation`, `misconception_correction`, `prerequisite_recap`).
- Clip storage behind the delivery abstraction: local-provider clips are materialized as accurate, zero-based MP4 files with FFmpeg and served independently; source timestamp references remain a fallback for existing/failed/non-local assets, while Mux delivery remains optional.
- Automatic proposal preparation: once topic review and reviewed concept coverage are valid, clip generation starts without an instructor command; failures remain isolated and explicitly retryable.
- Lightweight clip review embedded in the topic-production workspace: spot-check independently playable learner media directly beneath its approved topic (not full per-clip approval, per `prd.md` 6.3). A single topic-level regenerate action is the correction path; historical flag/re-cut records remain in the audit backend but are not exposed as a second editing workflow. Boundary, split/merge/dismiss, and concept-link changes invalidate affected clips until regeneration.

**Automated tests:**
- Unit: boundary-cleanliness heuristic (no cuts mid-word per transcript timestamps).
- Integration: fixture topic → clips generated cover the full topic duration without excessive gaps/overlaps, each tagged with at least one concept and a type.

**Human test checklist:**
- [ ] Watch a sample of generated clips (aim for a meaningful spot-check, not exhaustive) — confirm the "no mid-sentence cuts" quality bar from `prd.md` Section 10 (>95% target) holds up on real content.
- [ ] Regenerate a deliberately bad topic clip and confirm the active learner clip is replaced while historical media remains excluded from learner routing.

---

## Phase 5 — Assessment Generation + Approve/Edit UI (third HITL checkpoint)

**Goal:** Generate a comprehension check + confidence prompt per topic, plus a remediation map, all instructor-approved before going live.

**Deliverables:**
- Assessment generation agent using OpenAI GPT-5.4: topic + concepts → question (MCQ/short-answer/worked-problem as appropriate), confidence prompt, and a remediation map (wrong-answer pattern → target clip/concept).
- Automatic proposal preparation after reviewed clips become usable; dismissed questions are not silently recreated.
- Focused two-column Approve/Edit/Regenerate/Dismiss UI. The primary editor shows the learner-facing question, answer, and choices; confidence/remediation and AI context are collapsed until needed.
- "Unapproved question" state that blocks a topic from being learner-visible.

**Automated tests:**
- Unit: remediation map completeness (every plausible wrong-answer pattern maps to a valid target).
- Integration: fixture topic → generated question + remediation map validates against schema; regeneration produces a genuinely different variant, not a near-duplicate.

**Human test checklist:**
- [ ] Review generated questions for several real topics — track how many need only light edits vs. full rewrites (compare against the >90% light-edit target in `prd.md` Section 10).
- [ ] Test the regenerate flow — are the alternate variants actually meaningfully different and still correct?
- [ ] Confirm an unapproved question genuinely blocks learner access to that topic (not just a UI warning).

---

## Phase 6 — Adaptive Learning Path Engine

**Goal:** Real-time, autonomous per-learner routing based on instructor-set policy (the one pipeline stage intentionally not gated per-instance by human review — see `prd.md` Section 5).

**Deliverables:**
- Routing engine consuming: current concept, answer correctness, confidence rating, learner mastery history, graph eligibility, instructor-configured policy (mastery thresholds, advancement rules).
- Per-learner mastery state tracking (not_started/struggling/practiced/mastered per concept).
- Optional placement/diagnostic check flow.
- Instructor-facing policy configuration UI (per-concept "require mastery" vs. "allow partial understanding," max remediation attempts before flagging to instructor).

**Automated tests:**
- Unit: routing decision logic for each branch (correct+confident, correct+unsure, incorrect with each remediation type) against fixed input scenarios.
- Integration: simulated learner sessions (scripted answer sequences) produce expected mastery-state trajectories.
- Edge cases: learner stuck in a remediation loop beyond the configured max-attempts threshold correctly triggers an instructor-visible flag rather than looping forever.

**Human test checklist:**
- [ ] Role-play as a learner through a real course end to end — deliberately answer correctly, incorrectly, and with varying confidence, and confirm routing feels sensible and transparent (per the "why am I seeing this" requirement in `prd.md` 6.7).
- [ ] Adjust a policy knob (e.g. mastery threshold) and confirm it visibly changes routing behavior.

---

## Phase 7 — Learner Experience (Player)

**Goal:** The actual learner-facing UI: video/clip playback, progress, comprehension checks, transparency messaging, mastery map.

**Deliverables:**
- Video/clip player with topic navigation and per-concept progress indicator.
- In-line comprehension check + confidence prompt UI, wired to Phase 6's engine.
- "Why am I seeing this" messaging on remediation routing.
- Learner mastery map view.

**Automated tests:**
- E2E (Playwright): a full learner journey (4.2 in `prd.md`) from course start through at least one remediation branch and one advancement branch.
- Accessibility basics: keyboard navigation and screen-reader labeling on core player controls (not exhaustive a11y audit at this phase, but not skipped either).

**Human test checklist:**
- [ ] Take an entire real course as a learner, on both desktop and a mobile-width browser window — note anything that feels confusing, slow, or opaque.
- [ ] Specifically judge whether remediation routing feels helpful or punitive — this is a genuine product-quality question, not just a functional one.

---

## Phase 8 — Instructor Dashboard (cohort analytics + correction loop)

**Goal:** The feature that makes this "one person running an institution" — aggregate signals plus direct edit actions, closing the loop back into Phases 2–6.

**Deliverables:**
- Cohort analytics: real fourteen-day attempt/active-learner activity, mastery-state distribution, concept reach/struggle, answer outcomes, question risk, and per-clip remediation demand.
- Model-drift detection: signals where real learner behavior contradicts the original graph/assumptions.
- Dashboard diagnosis agent using OpenAI GPT-5.4: learner behavior signals → instructor-facing diagnosis and proposed correction for each problem card.
- Problem-card UI reusing the `Accept / Edit / Dismiss` pattern (built generically in Phase 5), applied to: graph edges, clip decisions, question edits/remediation mapping, routing policy overrides.
- Manual per-learner override (skip ahead / send back).
- "Not enough data yet" state for new courses (per `prd.md` Section 12 risk).
- Explicit-opt-in "reprocess in-progress learners" action for changes that would otherwise only apply going forward.

**Automated tests:**
- Unit: signal-generation logic (what data pattern produces a "stuck cohort," "underperforming content," or "graph drift" flag) against fixture learner-attempt data.
- Integration: accepting/editing/dismissing a problem card correctly mutates the underlying graph/clip/question/policy entity, and correctly does *not* affect it when dismissed.
- Regression: dismissing a signal doesn't suppress a genuinely new occurrence of the same underlying issue later (i.e. dismissal is scoped, not a permanent mute).

**Human test checklist:**
- [ ] With real (or realistically simulated) multi-learner data, review the dashboard signals — do they surface things you'd actually want to know as an instructor, or noise? Track your own dismiss rate as the quality signal `prd.md` Section 10 calls for.
- [ ] Run at least one full correction loop end to end: see a signal → accept or edit → confirm the change is reflected in the graph/clip/question editors from earlier phases → confirm new learner sessions reflect the change.
- [ ] Test the manual per-learner override.

---

## Phase 9 — Feedback Loop Hardening & Traceability

**Goal:** Make the "AI proposes, human decides, system remembers why" principle fully auditable, and make sure dashboard-driven changes propagate correctly and only where intended.

**Deliverables:**
- Full audit trail: every AI-generated artifact and every instructor edit/accept/dismiss action is logged with what triggered it and when.
- Persist proposal evidence and instructor actions for every AI artifact. Surface "Why did the AI suggest this" on graph, clip, question, and dashboard proposals; Topic Outline is the explicit compact-review exception and relies on title, summary, and timing as its review context.
- Verification that dashboard-driven changes correctly distinguish "applies going forward" vs. "applies retroactively" per learner, and that this is never ambiguous to the instructor.

**Automated tests:**
- Integration: audit log completeness check across a full simulated instructor + learner session covering every phase's checkpoint.
- Regression: a dashboard-driven edit that should only affect future learners does not silently alter in-progress learner state.

**Human test checklist:**
- [ ] Pick a few AI-generated artifacts at random and confirm you can trace "why" through the UI without needing to inspect the database directly.
- [ ] Confirm you can tell, at a glance, whether a given dashboard action applied going-forward-only or retroactively.

---

## Phase 10 — Polish, Performance, Accessibility Hardening

**Goal:** Bring the whole system up to a genuinely presentable/usable quality bar — not scoped tightly here since this is intentionally the "no time constraint, do it right" phase.

**Deliverables:**
- Full WCAG 2.2 AA accessibility pass, not just the basics from Phase 7, combining automated checks with keyboard and screen-reader review.
- Real Mux on-demand upload and adaptive-streaming delivery behind the existing video-provider abstraction, with local fallback and a visible/blocking 10-stored-video Free Plan capacity safeguard.
- Persisted course publish state, learner enrollment, instructor/learner role distinction, and an explicitly non-production development login/session context so all Section 4 journeys can run end to end without implying production authentication is complete. The public landing page routes through this gate; the fixed David/Brian demonstration accounts land in separate instructor and learner Course OS workspaces.
- Performance pass on graph eligibility, learner routing, dashboard aggregation, and Mux video delivery using the documented solo-instructor scale profile: one course, up to 10 videos, 60 topics, 300 concepts, 450 edges, 600 clips, 60 questions, 100 learners, 20,000 attempts, 30,000 mastery rows, 500 signals, 20 concurrent learner interactions, and 3 concurrent instructor requests.
- UI polish pass across all editor surfaces (segmentation outline, graph editor, clip review, question approval, dashboard).
- Refine the Agent-led Course OS based on human visual testing: light collapsible icon rail, larger Command Center typography, neutral/orange icon and state language, a full-width Course Director creation/generation state, full-width post-generation artifact workspaces with an on-demand docked Course Director, a reviewable content-derived draft title, and a course-overview map containing all topic/concept/prerequisite detail.
- Harden the Course OS shell and portfolio lifecycle: keep desktop navigation controls and the aligned development identity visible without page scrolling; exclude source-less placeholder shells from the portfolio; keep submitted generation resumable without presenting it as a finished course; admit only named completed drafts and published courses to `Your courses`; provide a keyboard-accessible hover/focus delete action with a second destructive confirmation; and center the pristine Course Director composer before smoothly docking it after first submission.
- Refine Course OS operating density: remove the redundant pristine Course Director header and initial upload callout in favor of a compact personalized greeting and elevated prompt; show generation tasks in strict dependency order; replace passive portfolio counters and decorative brief chrome with one specific evidence-derived situation summary plus an accessibly named global Manifold composer prompted as `Ask Manifold anything…`; keep four concise suggested commands on one desktop row; align the primary New course action with the greeting block; rename the action queue `Needs your judgment`; and replace the aggregate activity chart with a compact per-published-course radar covering activity, accuracy, confidence, clip completion/drop-off, mastery movement, open issues, and visible specialist status. Radar headings use one centered alignment rule. Dashboard questions must retrieve relevant persisted signals and use GPT-5.4 to synthesize only from that evidence; the primary answer is conclusion-first, uses restrained safely rendered Markdown, and omits database/internal identifiers. Exact citations remain available through a collapsed `Evidence used` disclosure so auditability does not overwhelm the answer. Radar metrics must deep-link to the relevant evidence, preview, priority, or course-team surface. Evidence questions are non-mutating; requested changes create a private reviewable Course Director directive and may never alter learner-facing artifacts directly. Keep the Course Director identity header in its post-generation dock.
- Consolidate published operations around focused workspaces: Overview merges the former Insights surface with persisted activity/mastery/answer/concept/question evidence. Diagnosis `Acknowledge`/`Dismiss` actions only resolve the evidence item; `Prepare improvement` creates a private typed proposal that then uses the standard Accept/Edit/Dismiss artifact checkpoint. Assessments always lists current-revision questions, supports audited teacher add/edit/remove, and previews clip-target remediation routes inline; Learner Preview lists and plays the actual current-revision teaching clips in learner order; Settings always lists durable default/per-concept routing policy records with add/edit/remove plus a side-effect-free routing preview. The three generated Review bundles are a first-publication checkpoint only: published working revisions neither regenerate nor count them, and `Publish updates` appears only for a real revision diff. Contextual artifact controls replace the global Edit button and separate Changes page; all first saves to a live course open a private working revision automatically.
- Rebuild published Overview as an intelligence cockpit: deterministic ranked priorities, course-design and learner-evidence health, persisted Course Director specialist activity, topic/concept matrix, synchronized evidence inspector, meaningful accessible charts, and a compact read-only Course Map overlay. Contextual actions prepare typed private proposals for clip, assessment, graph, topic/concept, remediation, and routing changes; each atomic proposal still requires Accept/Edit/Dismiss.
- Add revision-aware supplemental sources. PDF/PPTX extraction covers native text, PowerPoint notes, rendered-page/slide visual analysis, PostgreSQL full-text retrieval, exact citations, explicit AI-context versus learner-resource purpose, asynchronous failure/retry, and a Sources & materials drawer. Learner payloads include only accepted resources from the active published revision.
- Complete the staged production UI/UX redesign defined in `ui-redesign-plan.md`: visual concepts and design system; shared application shell; instructor onboarding/course builder; instructor review workspaces; graph/routing workspace; instructor insights; learner player/path/mastery experience; and final hardening. Desktop and laptop web are in scope for the application workspace; tablet and mobile remain excluded there by user decision. The separate public landing page must be responsive from mobile through wide desktop and route its primary CTA into the working Manifold application. During Stages 2-7, run lint/typecheck/focused unit/build checks plus targeted desktop visual checks; run paired full-Playwright gates after Stages 4+5 and 6+7, then the final axe/visual-regression batch in Stage 8 before human sign-off.
- Retain the previous four-stage guided production studio only at `/manifold` as a tested rollback baseline while `/app` is the primary Agent-led Course OS. Do not use its separate Insights workspace or Publish-stage policy layout as requirements for the Course OS; preserve its question/content HITL behavior and deterministic routing backend contract until parity and human confirmation allow deliberate retirement.
- Error-state and empty-state review across the whole product.
- Demo-readiness path: public Manifold branding, fixed David/Brian development login credentials with role-aware destinations, and a one-click reusable pre-transcribed sample course that avoids repeated provider calls while preserving the normal upload workflow.
- Public demo deployment with provider secrets supplied out-of-repository, production CORS, bundled demo media, database migrations, and live verification of the one-click demo path. Render free-service cold starts must be documented rather than represented as production reliability; persistent demo data uses an isolated Neon Free database.
- Watch-time and mastery instrumentation required for a future controlled adaptive-versus-linear learner study; the cohort study itself is deferred because it requires real learners and a research protocol.

**Automated tests:**
- Migration/backfill, orchestration dependency/retry/lease/restart/idempotency, revision diff/publish/mastery mapping, course ownership, typed proposal, and provisional-content learner-gate coverage.
- Topic/concept confidence/accuracy/mastery/remediation aggregation, deterministic priority ranking, low-sample suppression, specialist task lifecycle, typed proposal execution, document extraction/citation, source visibility, and source-revision isolation coverage.
- E2E coverage for empty dashboard, file/URL/demo creation, leave-and-resume complete-draft generation, bundle review, semantic map, first publish, conversational revision, Publish updates, and preserved learner progress.
- Full E2E suite covering all journeys in `prd.md` Section 4 green.
- Load/performance tests on a documented warm-service environment against: graph eligibility p50/p95/p99 <= 50/150/300 ms; learner routing <= 150/400/800 ms; dashboard aggregation <= 250/750/1500 ms; and Mux playback startup <= 1.5/3/5 seconds on stable broadband with <1% post-startup rebuffer time.

**Human test checklist:**
- [ ] Enter from the landing page as a new teacher, submit one lecture, leave during generation, return to a complete private draft, and confirm no pipeline knowledge is required.
- [ ] Review the Course Structure, Learner Experience, and Publish Setup bundles; confirm chat requests always produce visible proposals and every learner-facing artifact still has a real human decision.
- [ ] Use Course Map at course, topic, and artifact levels on a realistic course; confirm it remains understandable and every canvas action has an accessible non-canvas equivalent.
- [ ] Publish, edit an artifact in place or request a course change conversationally, confirm Overview reports the unpublished change and the edited record remains reviewable in context, publish the update, and confirm an in-progress learner keeps completed work while future routing uses the new revision.
- [ ] Confirm the Teacher Command Center attention queue and the course copilot's insight answers are grounded in real course/learner data rather than fabricated metrics.
- [ ] Open a populated course Overview and confirm it communicates what needs attention, why, and the next action within a few seconds; verify specialist activity feels coordinated rather than like competing chatbots.
- [ ] Prepare and review one clip, assessment, and graph improvement from Overview; verify the exact before/after diff, Accept/Edit/Dismiss behavior, private-revision isolation, and future-only default scope.
- [ ] Upload a PDF and PPTX, verify page/slide citations and visual extraction, keep one private as AI context, publish one as a learner resource, and confirm Brian sees only the published resource.
- [ ] Full run-through of every journey in `prd.md` Section 4 as if demoing to a skeptical outside reviewer.
- [ ] Confirm the product meets (or explicitly falls short of, with notes) every bullet in `prd.md` Section 10 Success Criteria.

---

## Phase 11 — Unified Adaptive Blueprint

**Goal:** Make the course feel like one living adaptive system instead of separate graphs, clips, questions, analytics, and agent panels. Give instructors one evidence-aware Blueprint for understanding and changing that system, while learners follow a transparent concept-driven path assembled from the same reviewed artifacts.

**Deliverables:**
- Replace the separate published Overview and Course Map destinations with one detailed free-form Blueprint workspace and two purposeful modes: **Live** for the published structure and its evidence, and **Design** for direct private editing of the working revision. Keep learner experience in the dedicated Preview/learner workspace and exact live-versus-working comparison in the publication/revision review flow rather than duplicating those tasks as canvas modes. Retain Assessments, Preview, and Settings as focused bulk/deep editors reachable from Blueprint.
- Render the complete typed course system in React Flow: topics, concepts, clips, questions, remediation, sources, and typed relations share one inspectable graph. Fit the visible graph on initial load, preserve instructor-saved positions, allow topic-neighborhood focus, and provide a synchronized outline so instructors can understand and operate the same system without relying only on a free-form canvas.
- Give the free-form graph a consistent visual grammar: distinct accessible node components for every artifact kind, deterministic top-to-bottom semantic layers, fixed relation-specific ports, ELK orthogonal edge routes, sequence-aware crossing minimization, and a compact legend. Show the instructional core by default; reveal citations and remediation contextually or through explicit relationship filters. Design mode keeps saved manual positions and offers a presentation-only auto-arrange action.
- Add a synchronized inspector and contextual node/edge toolbar for topic/concept/clip/question/source/relationship records. Clip inspectors play the exact bounded teaching moment in context. In **Design** mode instructors can add, update, connect/reconnect, reposition, and safely remove supported artifacts through type-aware direct controls and an accessible outline equivalent. One consolidated `Add node` action reveals the supported artifact kinds without permanently occupying the graph toolbar. Hovering or keyboard-focusing a connectable node reveals four prominent external `+` controls, each joined to one side by a short directional stem; choosing one asks for the relationship meaning, then turns the canvas into a valid-target picker with clear cancellation and invalid-target explanations. Edge selection exposes relation meaning, endpoints, reconnect, and traceable removal.
- Separate learner-facing course order from presentation-only canvas position. A scoped, readable learning-order editor shows neighboring concepts and supports drag/reorder plus keyboard actions; cross-topic moves explicitly ask whether to move or additionally link the concept. Canvas drag and auto-arrange remain clearly labeled as layout-only, while presentation-only nudge controls stay out of artifact details; the synchronized outline and inspector provide the accessible non-canvas operation path.
- Before a structural removal, reconnection, or cross-topic move, show a deterministic impact preview covering affected topics, concepts, clips, questions, remediation routes, sources, and existing learner records. Instructor-authored changes remain audited private-revision mutations. AI-authored changes remain typed proposals with `Accept AI suggestion / Edit manually / Dismiss`; direct teacher edits open a private working revision on first save.
- After a direct add/edit/remove/reconnect action, offer optional **AI cleanup**. Manifold uses the current private Blueprint, source context, assessment coverage, remediation, and learner evidence to prepare only adjacent repair/enrichment proposals (for example a missing prerequisite, teaching link, assessment, or remediation route). Cleanup is never automatic, creates no accept-all action, and every proposed artifact remains independently reviewable before publication.
- Give Course Director parity with the validated manual Design vocabulary. It may answer questions or prepare an ordered, bounded change plan containing supported node add/edit/remove—including a concept-grounded question with its confidence check and remediation fallback—and relationship add/reconnect/remove operations against exact current Blueprint identities. The response gives a concise systematic account of every proposed operation and its rationale. Each AI operation remains an independent private proposal with `Accept / Edit / Dismiss`; accepting invokes the same server-side validation/audit path as the equivalent manual action, and unsupported or ambiguous requests produce clarification rather than an invented mutation. Accepting a structural proposal reloads the Blueprint and focused workspaces without unmounting the existing graph while layout is recalculated.
- Add revisioned explicit concept sequencing and question-to-concept coverage. Prerequisites are hard eligibility constraints; explicit instructor sequence breaks ties; answer/confidence/mastery evidence selects remediation or reinforcement. Existing published revisions remain usable, while missing assessment coverage becomes a visible design issue until the relevant update is reviewed and published.
- Persist immutable learner route events containing the attempt, selected action/target, explanation, mastery transition, and evidence snapshot. Expose revision-aware Blueprint and evidence APIs plus an instructor-safe learner-path preview and the learner's own path API.
- Extend Course Director specialist tasks to prepare coordinated proposal packs of one to six atomic artifact changes for the misconception-recovery loop (for example a prerequisite correction, focused clip adjustment, assessment edit, and remediation update). Each proposal is independently reviewable; partial failure is explicit; there is no accept-all action.
- Redesign the learner course as a concept-driven path: compact prerequisite/current/next strip, one current learning activity, embedded assessment checkpoint, route explanation, optional mastery map, and cited learner aids. The active published revision and existing enrollment/privacy gates remain authoritative.
- Allow supplemental PDF/PPTX sections to participate as cited private evidence and, only after explicit resource review plus publication, as learner aids linked to the relevant concept.

**Automated tests:**
- Migration/backfill tests for sequence ranks, explicit question-concept mappings, route events, working-revision cloning, and rollback-safe constraints/indexes.
- Repository/service/API tests for typed Blueprint nodes/edges, revision isolation, ownership/privacy, evidence overlays, sequence editing, working-revision-safe multi-topic concept links, type-aware add/edit/remove, edge reconnect/remove, deterministic impact previews, learner-path preview, and single-task proposal-pack retrieval.
- Routing tests proving prerequisite-first eligibility, sequence tie-breaking, explicit question coverage, misconception remediation, reinforcement, route-event atomicity, and stable behavior for existing published revisions.
- Specialist and Course Director tests proving one evidence brief, optional post-edit cleanup request, or conversational Blueprint command can create a one-to-six ordered proposal pack; every proposal has an exact typed before/after diff and citation/evidence provenance; unsupported/ambiguous operations are rejected; partial failure is visible; and no learner-facing record changes before an atomic Accept/Edit action plus publication.
- Frontend unit/integration tests for complete typed graph construction, artifact-to-node/port mapping, the consolidated Add node menu, four-sided hover ports, relationship-kind choice, valid-target selection/cancellation, contextual node/edge actions, guided add/remove, deterministic impact preview, scoped learning order, core/all/contextual relation visibility, ELK bend-point consumption, deterministic semantic ordering, saved-position layout, initial fit-to-view, Live/Design switching, topic focus, outline/canvas parity, node movement, in-context clip playback, inspector editing, relationship manipulation, optional AI cleanup, typed Course Director plans, proposal review, and empty/loading/error states.
- Real-browser instructor and learner journeys covering one misconception-recovery loop end to end, keyboard navigation, WCAG 2.2 A/AA axe checks, persistent layout, and no horizontal overflow at supported desktop widths.
- Scale checks on a 60-topic/300-concept graph ensuring visible-subgraph layout and Blueprint evidence aggregation remain inside the existing Phase 10 warm-service latency targets.

**Human test checklist:**
- [ ] Open a realistic published course and move between Live and Design without losing the selected topic/concept; confirm the graph makes clips, questions, sources, sequence, evidence, and routing feel like parts of one course system rather than separate tools. Open Preview and the publish/revision review flow separately and confirm learner playback and live-versus-working comparison remain clear.
- [ ] In Design mode, add or reconnect a prerequisite, reposition an artifact, reorder two concepts, edit one inspector field, and confirm each direct edit is audited in a private working revision while the active learner course remains unchanged.
- [ ] In Design mode, use the contextual toolbar to add one topic/concept/assessment or source, inspect the deterministic impact before removing or reconnecting an artifact, and confirm valid actions differ clearly by artifact type. Repeat the operations without relying on the canvas and confirm the outline/inspector path is equivalent.
- [ ] Hover each side of a topic, concept, question, and clip; create Structure, Prerequisite, Teaching, Assessment, and Remediation connections through the relationship picker; deliberately choose an invalid target; then inspect, reconnect, and remove an edge. Confirm the interaction explains direction/meaning, never relies on tiny unlabeled handles, and preserves learner history in the private revision.
- [ ] Ask Course Director to add and edit a node, remove a node, add a remediation connection, and reconnect an existing relationship. Confirm its response lists the exact ordered plan, unsupported ambiguity is surfaced instead of guessed, every operation has its own `Accept / Edit / Dismiss`, and accepted operations match the equivalent manual Design actions without changing the published learner course.
- [ ] Complete a direct structural edit, request optional AI cleanup, and confirm Manifold proposes only adjacent course repairs/enrichments. Accept one cleanup artifact, Edit one, and Dismiss one; confirm there is no accept-all action and the published learner course remains unchanged until `Publish updates`.
- [ ] Select a struggling concept in Live mode, inspect the learner evidence and cited source/clip/question coverage, ask the course team to prepare a misconception-recovery improvement, and confirm the resulting coordinated pack is coherent.
- [ ] Review that proposal pack artifact by artifact; Accept one, Edit one, and Dismiss one. Confirm there is no accept-all action, every before/after diff is understandable, and nothing reaches Brian before `Publish updates`.
- [ ] Confirm missing assessment coverage is visible at concept level, add or approve a question for that concept, and verify the coverage relation appears in both Blueprint and the learner path after publication.
- [ ] As Brian, complete a concept checkpoint with both a misconception case and a confident-correct case; confirm the prerequisite/current/next strip, remediation or reinforcement activity, route explanation, and mastery map all agree with the instructor Blueprint.
- [ ] Add a PDF or PPTX section as private AI context, use its citation in an instructor proposal, then separately review and publish it as a learner aid; confirm Brian never sees the private-only state and sees the published aid in the correct concept context.
- [ ] Navigate the complete Blueprint and learner preview with keyboard only, verify the outline offers equivalent non-canvas operations, and confirm labels/statuses remain understandable with a screen reader.
- [ ] On a large seeded course, use course/topic/concept zoom and auto-layout; confirm interaction remains responsive, saved manual positions are preserved, and the view does not become an unreadable all-node wall.
- [ ] In the whole-course Blueprint, confirm the complete graph fits into view on first load; then use topic focus, outline selection, pan/zoom, and saved positions to inspect a dense course without losing context.
- [ ] In Design mode, drag a node and confirm its position persists after reload. Use the keyboard-operable sequence controls and the outline/inspector path for the same semantic edits; confirm presentation-only movement does not change the published learner path and structural edits remain in the private working revision.
- [ ] In the whole-course Blueprint, distinguish source, topic, concept, clip, and question nodes without relying on color; follow one prerequisite, teaching, and assessment path end to end; then select an artifact and confirm its contextual citation/remediation links appear without returning the graph to an unreadable all-edge wall.
- [ ] Switch between Core and All relationships, use the individual relationship filters, and run Auto arrange. Confirm the layout remains sequence-aware, orthogonal routes are easy to follow, selection is preserved, and Auto arrange changes presentation only rather than learner-facing course content.

---

## Notes on sequencing flexibility

Phases 2–5 (segmentation → graph → clips → assessments) are pipeline stages with real dependencies and should stay in this order. Phase 6 depends on Phases 3 and 5 (needs the graph and the assessments/remediation maps). Phase 7 can be built in parallel with late Phase 6 once the engine's interface is stable. Phase 8 depends on real usage data existing, so it necessarily comes after Phase 7 is usable enough to generate that data (even if from test/simulated learners). Phase 9 and 10 are cross-cutting hardening passes. Phase 11 is a deliberate product-integration phase built on their persisted evidence, revision, and agent foundations; it does not imply Phase 10's separate human gate has passed.

If direction changes significantly (e.g. a phase turns out to need splitting, or scope changes per a decision recorded in `implementation.md`), update this document accordingly — see `AGENTS.md` for the process.
