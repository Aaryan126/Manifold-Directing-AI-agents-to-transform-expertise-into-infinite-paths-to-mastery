# PRD: Manifold — Video-Native Adaptive Learning Platform

**Status:** Draft v1.0
**Owner:** [You]
**Last updated:** 2026-07-28
**Companion docs:** `plan.md` (implementation phases), `implementation.md` (live build status), `AGENTS.md` (agent operating instructions)

---

## 1. Vision

**Product:** **Manifold** — *Directing AI agents to transform expertise into infinite paths to master.*

Turn any instructor's existing lecture recordings into a mastery-based, personalized course — without a curriculum team, instructional designers, or a content-authoring pipeline. The instructor supplies expertise and judgment; the system (AI agents under instructor supervision) does the structuring, sequencing, assessment, and adaptation work that would normally require a full learning-design team.

**One-line pitch:** *One expert + AI agents = an adaptive course platform that used to require an institution.*

**Core design tenet:** AI builds the editable private draft; the instructor directs what is published. Initial lecture generation automatically finalizes its segmentation, concept graph, clip selection, assessments, remediation, routing defaults, and Course Flow placement into a private working revision so the instructor is not forced through a clerical approval queue. Original AI proposals and the automatic-finalization event remain auditable, every artifact stays directly editable, and nothing reaches learners until the instructor explicitly publishes. Later evidence-driven or conversational AI changes remain visible private proposals unless the instructor directly requested an ordinary deterministic edit.

---

## 2. Problem Statement

- Long-form lecture video is passive and one-size-fits-all: every learner watches the same content in the same order regardless of prior knowledge.
- Turning raw lecture footage into a structured, adaptive course today requires instructional designers, video editors, and assessment writers — a cost and workflow only institutions can afford.
- Independent experts, tutors, corporate trainers, and small teams have valuable recorded content (or the ability to create it) but no practical way to make it adaptive.
- Fully AI-generated "AI tutor" products discard the instructor's actual material and expertise, which undermines trust, accuracy, and pedagogical intent — and doesn't help instructors monetize or scale *their own* teaching.

## 3. Target Users

### Primary: The Instructor / Subject-Matter Expert ("the operator")
A solo expert, tutor, corporate trainer, or small teaching team with existing or newly recorded lecture video, who wants to offer an adaptive, mastery-based course without hiring a team. This is the "One Person Company" persona — this product is the team they don't have to hire.

### Secondary: The Learner
A student taking the course, who wants to reach mastery efficiently, skip what they already know, and get targeted help on what they don't.

*(Note: multi-instructor org accounts, billing, and learner self-signup/marketplace flows are explicitly out of scope for this phase — see Section 11.)*

---

## 4. Core User Journeys

### 4.1 Instructor: Course Creation
1. Instructor enters the Teacher Command Center, chooses `New course`, supplies a course title, and arrives in that named course's empty Course Flow. A named empty container is intentional, visible, and resumable; opening the dialog without confirming creates nothing.
2. From Course Flow the instructor chooses `New lecture`. A focused full-width Course Director intake accepts a lecture file or link and remains primary while a durable server-side agent run transcribes that source and prepares a complete private lecture draft: a Course Flow lecture unit, topics, concept graph, clips, assessments, remediation, routing recommendations, and quality checks. The instructor may leave and resume later, and adding later lectures never changes the established course title.
3. When generation completes, Manifold automatically finalizes the generated artifacts into an editable private draft and yields to the full-width artifact workspace. There is no mandatory per-artifact review queue; the instructor can inspect or modify any part of the draft and nothing is learner-visible yet.
4. The instructor reviews the course-level Course Flow of optional module swimlanes containing lecture, standalone quiz, and assignment units. Opening a lecture reveals its detailed Blueprint; a Whole course option preserves shared concepts and cross-lecture prerequisites. Course Director remains available from both levels for questions and typed change proposals; upstream edits explicitly mark affected descendants stale and selectively regenerate them.
5. The instructor previews and explicitly publishes the private revision; only then can learners enroll.
6. Later edits begin from the artifact's own pencil/add/remove control and accumulate in a private working revision. There is no global `Edit course` mode or separate Changes workspace: instructors review the edited records in context, Overview reports the unpublished-change count, and `Publish updates` preserves completed learner work while applying the new revision to future routing.

### 4.2 Learner: Adaptive Learning
1. Learner starts the course; optionally takes a placement check to skip known material.
2. Learner watches a topic, answers the comprehension question, and rates their confidence.
3. System routes: correct + confident → advance; correct + unsure → reinforcement clip; incorrect → prerequisite clip, alternate explanation, or misconception-specific correction.
4. Learner's mastery state per concept is tracked continuously.
5. Learner reaches course mastery faster than linear playback would allow.

### 4.3 Instructor: Ongoing Oversight (Dashboard Loop)
1. Instructor opens the dashboard and sees aggregate signals: where cohorts get stuck, which clips/questions underperform, where real learner data contradicts the AI's original graph/assumptions.
2. Each signal is presented as a problem card with an AI diagnosis and explicit **Acknowledge / Dismiss / Prepare improvement** actions. Acknowledgment is evidence triage only and never mutates a course artifact.
3. `Prepare improvement` briefs the relevant specialist to create an exact private proposal. The instructor then uses the standard **Accept AI suggestion / Edit manually / Dismiss** artifact checkpoint before the working revision changes.
4. Changes apply going forward to new learner paths (not retroactively, by default — see Section 6.6).

This closes the loop: the instructor's judgment isn't just applied once at setup, it continuously corrects the AI's model based on real-world outcomes — the mechanism that makes this feel like "one person running an institution" rather than a static course.

---

## 5. Instructor Control & Publication Boundary (cross-cutting requirement)

This is not a single feature — it is the safety and usability contract for every feature below:

- **Initial generation becomes an editable private draft automatically.** The system records each original AI proposal and an `auto_accept_private_draft` audit transition, but does not ask the instructor to approve dozens of artifacts one by one.
- **Explicit publication is the learner-facing checkpoint.** No draft topic, graph relation, clip, question, remediation rule, routing default, or Course Flow unit reaches learners until the instructor chooses `Publish course`.
- **Every artifact remains directly inspectable and editable before publication.** The instructor can correct the generated structure in Blueprint Design, focused assessment editing, Course Flow, and settings without first clearing a review queue.
- **Every AI action taken from downstream learner evidence remains visible and controlled.** Dashboard-driven improvements and unsolicited specialist changes are persisted as private proposals using `Accept AI suggestion / Edit manually / Dismiss`; deterministic per-learner routing remains autonomous within the published instructor-editable policy.
- **AI-authored content remains auditable.** Original proposals, evidence, automatic private-draft finalization, later instructor edits, proposal decisions, and publication events are persisted even though initial clerical review is removed.

### 5.1 Product Interface Direction

- The production interface uses one shared visual system with distinct instructor and learner workspaces; it must not remain a single long document containing every workflow.
- The primary instructor entry is a Teacher Command Center with course portfolio, durable generation/review state, learner health, and one unified `Needs your judgment` queue. It uses a light, collapsible, viewport-fixed desktop navigation rail whose navigation, identity, and collapse controls remain visible without page scrolling; readable operational type; and a logo-derived orange/brown/grey semantic system across every instructor and learner surface. Orange identifies active, attention, and interactive states; brown identifies healthy, complete, mastered, and saved states; graphite/grey identifies neutral, waiting, structural, and unavailable states. Labels, icons, and shapes preserve meaning without relying on color alone, and the warm light backgrounds remain. The primary `New course` action is vertically centered against the greeting headline on desktop and remains full width below the greeting copy on mobile. The top operating surface is a minimal, evidence-derived portfolio situation summary plus an unlabeled but accessibly named global Manifold command composer whose visible prompt is `Ask Manifold anything…`, not decorative labels or duplicate counters. Four concise suggested commands remain on one desktop row. Each question retrieves the most relevant persisted portfolio/course signals before GPT-5.4 synthesizes a conclusion-first answer with restrained, safely rendered Markdown and without exposing internal identifiers; exact saved references remain available through a collapsed `Evidence used` disclosure rather than competing with the answer. Missing measurements are stated rather than inferred. The primary operating row pairs a half-width `Needs your judgment` queue with an equal-width seven-day learner-activity line chart derived from distinct learners completing saved assessment checks, plus real enrolled/new-learner counts. Learner-insight rows omit a redundant `Insight` pill because the icon and copy already identify the signal, while review/build/retry states retain explicit labels. The chart renders only persisted activity as a smooth orange curve with a subtle area wash and load animation; reduced-motion users receive the complete static chart immediately, and zero activity remains an honest flat line. Course-level accuracy, confidence, clip completion/drop-off, mastery movement, open issues, and specialist status remain available in each course's evidence workspace and to the grounded dashboard assistant instead of occupying a full-width comparison table. Requested changes use the same evidence analysis to choose a target but create only private `Accept / Edit / Dismiss` proposals and never silently mutate reviewed or learner-facing content. An empty instructor sees a direct file/link creation action rather than fabricated analytics.
- The instructor navigation rail uses Manifold orange in expanded, collapsed, and mobile-bottom-navigation states. Dark-ink controls, a translucent cream active/hover surface, and a cream identity chip containing a neutral person silhouette instead of name initials preserve contrast. Its three-bar Manifold mark sits inside a compact non-rotating white tile while retaining the logo's black/orange/grey colors. Learner-insight speech bubbles in `Needs your judgment` use orange line art on a transparent tile rather than another filled card nested inside each queue item.
- The Teacher Command Center extends the logo palette into the course portfolio through stronger geometric orange/clay/brown/grey cover fields, a compact palette marker, and a coordinated neutral search treatment. The intelligence brief, suggested commands, `Needs your judgment`, and learner-activity panel retain neutral white surfaces so evidence remains the visual priority. The canvas remains light, and instructional graphs retain their intentional multicolor semantic exception.
- Dense instructional visualizations are the intentional exception to the chrome palette. Instructor Course Flow/Blueprint graphs and learner mastery/prerequisite maps retain a broader semantic palette for artifact kinds, topic groupings, mastery states, and route actions; Blueprint topics use bright lemon yellow so the hierarchy's major sections separate immediately from neutral sources and blue concepts. Typed nodes use clean full-surface color and a single outline without decorative top stripes. Every meaning is also exposed through labels, icons, edge patterns, and accessible names so the graph never relies on color alone.
- Dashboard course creation is a compact title-first action that creates a named course container and opens its empty Course Flow. The create request is idempotent across retries or repeated responses: one instructor request key resolves to one course container, while separate requests may intentionally use the same visible title. Full source collection is deliberately a lecture-level action: `New lecture` opens an edge-to-edge white, focused Course Director intake while the source is collected and durable specialist tasks run. The pristine lecture state omits a redundant panel header and instructional upload stack, instead presenting a compact personalized greeting and elevated lecture prompt. After submission the prompt moves smoothly to the bottom working position and agent tasks render top-to-bottom in dependency order. Once the private lecture draft is ready, its full-width Blueprint becomes primary and the conversation is available on demand in a docked panel that retains its Course Director identity header. The bottom-right Course Director capsule and expanded dock are two projected states of one Motion for React surface: opening expands from the launcher anchor, closing reverses into it, panel content follows the shell, Escape/focus behavior remains correct, and reduced-motion users receive an immediate state change. Chat is the command layer; structured artifacts remain the source of truth.
- Untitled placeholder shells are persistence details and never appear in `Your courses`; explicitly named empty course containers do appear because they are valid resumable course homes. Submitted in-progress lecture work remains resumable through operational attention. Course cards support permanent deletion through a discoverable keyboard-accessible action and a separate confirmation step that clearly states the destructive scope.
- Agents prepare the complete unpublished draft before the instructor needs to inspect it. Provisional artifacts may feed downstream generation inside a building revision; the final durable generation step automatically marks the coherent result usable inside the private working revision. Only an explicitly published revision satisfies learner access.
- Published course structure and evidence meet in one **Blueprint** workspace rather than separate Overview and Course Map destinations. Its primary surface is a hierarchical React Flow system map containing topics, concepts, clips, questions, remediation, sources, and typed relations. The automatic tree spine is always source → topic → concept → teaching clip/check; prerequisites, course sequence, remediation, and citations remain visible typed cross-links but never distort those semantic ranks. Every artifact kind has a distinct accessible visual identity; widths grow modestly within type-specific caps while heights retain greater freedom to show complete titles, and ELK consumes those final dimensions before routing. Stable sequence-aware sibling order, saved-position collision resolution, and fixed relation-specific ports prevent node overlap and feed orthogonal routes so instructional direction is immediately readable. The whole-course default shows the instructional core while citations and remediation are revealed by selection or explicit relationship filters. In Live, clicking any node creates a transient first-degree focus: only the focal artifact, every directly connected artifact, and their non-dismissed incident relationships are freshly hierarchy-arranged and fitted beside the inspector. The clicked artifact—not the neutral neighborhood bounds—anchors the target camera near the center of the usable graph area left of the measured inspector; zoom fits the complete direct neighborhood and translation clamps only as needed to keep every relative visible with a safe gutter. Incident edges stay visible even when their type is filtered out, selecting a visible neighbor moves the focus and camera anchor, and either the inspector close control or an empty-canvas click restores the complete lecture. One React Flow canvas remains mounted throughout each transient focus. While ELK prepares the target projection, the current painted frame stays visible; then one interruptible Motion spring interpolates retained-node graph coordinates, entering/exiting node and SVG-edge opacity, dynamic edge routes, and the React Flow viewport together. A new focus starts from the current painted frame, the latest request wins, and a completed focus never triggers a second fit. The blocking layout loader never replaces the map for this transient focus, stale layout work is discarded, and reduced-motion users receive the final frame immediately. This projection is never persisted and never applies in Design, where the complete authoring context and saved positions remain visible. On initial load, Live/Design changes, topic focus, and Auto arrange, the graph remains concealed until ELK’s final positions and React Flow’s measured custom nodes agree; one authoritative fit then precedes a short stable-map fade, so no fallback arrangement or second camera snap reaches the instructor. Design preserves deliberate instructor-saved positions after resolving collisions, while Auto arrange restores the hierarchy and topic focus reduces the visible neighborhood. The synchronized topic/concept outline remains a readable, keyboard-operable alternative to the canvas but opens on demand through `Jump to` instead of permanently reducing graph width. Course and lecture entry default to Live; for an unpublished course with no active revision, Live presents the private working draft read-only rather than an empty canvas. Design is entered only through an explicit edit action and shows the private working revision. Inside a selected lecture, Blueprint is implicit rather than a selected destination tab. One slim title header holds revision/publication state, actionable course health, Sources, publication, and an overflow for focused assessment review, learner preview, and course settings. The graph begins immediately beneath it; Live/Design and mode-aware navigation, relationship, evidence, layout, add, order, and undo controls float over the canvas rather than consuming persistent metric and relationship rows. Individual artifacts and controls do not cascade on entry.
- The default and sole course-level structural workspace is a revision-aware **Course Flow**. Its visible graph contains only lecture, standalone quiz, and assignment units; ungrouped one/few-unit courses use a compact sequence, while optional neutral module/week swimlanes appear only when they communicate real grouping. The default camera eases into a close readable fit for one unit, a comfortable standard fit for two-to-four, and an overview fit for five-plus; this initial policy never reduces the instructor’s subsequent manual zoom range. Opening a course stages only the Course Flow header, contextual authoring strip, and graph region. The header vertically centers its right action group against the complete left title/copy block, preserves balanced outer insets, and gives the primary action plus Live/Design control a consistent 48px minimum target. `next`, `requires`, and `assesses` relationships define learner progression and coverage without exposing lecture-internal topics, concepts, clips, or questions. `New lecture` is persistently discoverable and opens the full lecture source intake before durable lecture-scoped generation begins. Course Flow relationship creation uses contextual four-side node `+` controls, an explicit relationship-meaning choice, and valid-target selection—matching detailed Blueprint authoring rather than exposing a generic graph toolbar action. Because Course Flow is the only course-level destination, it does not consume header space with a redundant selected tab. Selecting a lecture replaces the compact header title with that lecture through a short persistent-header crossfade and hands Course Flow directly into the implicit full-height Blueprint through one subtle directional presence transition. The lecture header does not add Blueprint/Assessments/Preview tabs; focused assessment review, `View as learner`, and course settings open from its overflow and provide an explicit return to the map. The header back control returns to Course Flow without a second breadcrumb row. Routing Settings remain course-wide. A secondary `Cross-lecture concept map` appears only for multi-lecture courses where shared concepts and cross-lecture prerequisites are distinct. Selecting a quiz or assignment opens the same underlying reviewed artifact in its focused editor. All Course Flow/Blueprint spatial motion and camera interpolation are removed under the user's reduced-motion preference. Course Flow and Blueprint share Live/Design semantics, undo, typed relationship validation, private revision persistence, and atomic publication. Course Director streams progress and Markdown answers into a course-scoped runtime transcript for the current login; close/reopen and client-side navigation retain it, while login, logout, full reload, or a container-driven reload starts clean. Any later Course Director-generated learner-facing mutation still enters the durable independent `Accept / Edit / Dismiss` review contract.
- Live mode is a decision cockpit, not a wall of metrics: a compact summary, at most five ranked priorities, persisted specialist activity, synchronized evidence inspection, and performance/coverage overlays on the actual course structure. `Acknowledge`/`Dismiss` resolve diagnoses without editing the course. `Prepare improvement` creates a coordinated private proposal pack; every contained artifact still uses the standard `Accept AI suggestion / Edit manually / Dismiss` checkpoint and no accept-all action exists.
- Design mode is a type-aware course authoring surface rather than a generic graph editor. Selecting a topic, concept, clip, question, source, or relationship exposes only valid contextual actions; one compact `Add node` menu, four prominent external hover/focus `+` controls joined to the node by short directional stems, an explicit relationship-meaning step, valid-target highlighting, edge reconnect/remove, safe removal impact previews, and equivalent `Jump to`/inspector controls make add/edit/remove discoverable without relying on raw connector handles. Learner-facing course order is edited in a scoped sequence surface with neighboring concepts and keyboard controls, while canvas drag and auto-arrange are presentation-only and canvas-position nudges do not clutter artifact details. Direct teacher edits are audited and automatically saved to a private working revision; a labeled toolbar action and `Cmd/Ctrl+Z` apply the inverse of the latest supported persisted graph edit, while `Publish updates` remains the only learner-facing commit. Revision or topology changes use revision-aware graph identity and an explicit bounded arranging state before mounting the complete replacement layout; title/content edits preserve the current graph identity. Mutation success never settles into an empty workspace.
- After a direct structural change, an instructor may optionally request **AI cleanup**. Manifold reasons over the current private Blueprint, source context, artifact coverage, remediation, and learner evidence to prepare adjacent connection/content repairs, but applies nothing automatically: every cleanup artifact is a private proposal with its own `Accept AI suggestion / Edit manually / Dismiss` checkpoint and still requires publication before learners see it. Clip inspectors play the exact bounded teaching moment so an instructor can verify the artifact without leaving graph context. Assessments, Learner Preview, and Settings remain focused bulk/deep editors reachable from the lecture header overflow or contextual artifact actions rather than independent product silos or permanent tabs.
- Course Director is the conversational interface to the same validated Blueprint mutation vocabulary used by Design mode. It can answer from evidence or prepare a bounded ordered plan for supported node add/edit/remove—including concept-grounded assessment creation—and relationship add/reconnect/remove operations against exact current artifacts. A created assessment includes a reviewed prompt, answer, confidence check, explicit concept coverage, and remediation fallback. Course Director provides a concise systematic account of the plan and does not claim changes were applied prematurely. Its planning context distinguishes the private working Blueprint from published-only artifacts already absent from that revision; a repeated removal request explains that the artifact is removed in Design but remains visible in Live until publication instead of guessing a different target. Every AI-authored operation remains independently `Accept / Edit / Dismiss` reviewable in the private revision; ambiguous or unsupported requests ask for clarification, accepting a structural proposal opens Design and refreshes the shared Blueprint without a blank-canvas transition, and publication remains the only learner-facing gate.
- Course Director has course-wide retrieval and context-aware defaults across Course Flow and Blueprint. On Course Flow it defaults to modules, units, sequencing, and cross-lecture evidence; inside a lecture it defaults to that lecture’s detailed artifacts while remaining able to answer or propose course-wide changes. A fresh runtime transcript must not present an unexplained empty panel: the dock renders a short course-specific welcome as presentation-only orientation until the instructor sends the first real turn, without a separate workspace-context label. That welcome is never stored as chat history. Manual and conversational actions invoke the same validated services. Ambiguous targets require clarification, and every AI-authored high- or low-level operation remains independently `Accept / Edit / Dismiss` reviewable.
- The previous `/manifold` guided studio is retained temporarily as a rollback path during parallel implementation, not as a permanent alternate mode.
- Instructor surfaces use a calm, information-dense operational shell with persistent navigation and one primary working surface. Review queues must make status and Accept/Edit/Dismiss actions easy to scan; contextual rationale is shown where it materially supports the decision rather than occupying every review surface. Stage navigation may guide sequence but must only hard-block genuine pipeline prerequisites.
- The concept graph is a full-canvas working surface with contextual concept/edge review tools rather than a graph embedded inside a decorative panel. Node positioning, concept creation/removal, and prerequisite connection/reconnection happen directly on that surface; removal preserves review history rather than physically deleting instructor decisions.
- Learner surfaces prioritize a concept-driven prerequisite/current/next path and exactly one current learning activity. A teaching clip and its comprehension check are sequential steps rather than simultaneous page sections: the learner watches the clip, may expand its playback-synchronized word-level transcript, then explicitly continues into the assessment without scrolling past one activity to find the other. Transparent route rationale remains available through a compact optional disclosure, and assessed routing waits for the learner to continue or review rather than navigating away automatically. Prerequisites are hard eligibility constraints, instructor sequence breaks eligible ties, and persisted answer/confidence/mastery evidence controls remediation or reinforcement. Clips, questions, and explicitly published learner aids are presented in the active concept context rather than as disconnected lists.
- The Phase 10 application-workspace redesign targets desktop and laptop web. Tablet and mobile layouts remain outside the instructor/learner workspace redesign scope; the public marketing landing page is a separate responsive surface and must remain usable from mobile through wide desktop.
- Full execution stages, visual thesis, non-regression rules, and approval gates are maintained in `ui-redesign-plan.md`.

---

## 6. Feature Requirements

### 6.1 Video Ingestion & Transcription
- Accept video upload (mp4, mov) or a video URL (e.g. YouTube link) for ingestion.
- Provide a one-click Manifold demo source using a repository-bundled video and its real cached timestamped transcript. The demo must reuse its completed record, avoid repeated ASR/provider spend, avoid consuming Mux storage, and then enter the same editable-private-draft pipeline as a normal upload.
- Generate a time-aligned transcript (word- or phrase-level timestamps required for downstream clipping).
- Handle lectures up to at least 3 hours; process asynchronously with progress status.
- Extract slide/screen-share text via OCR when visually present (improves segmentation and concept extraction quality) — stretch goal, not launch-blocking.

### 6.2 Topic Segmentation
- AI proposes topic boundaries (target 10–20 min per topic) based on transcript semantics (topic shift detection), not just fixed time windows.
- Each proposed topic has: title, time range, one-paragraph AI-generated summary.
- The generated outline is finalized automatically into the private revision. An instructor-facing timeline/outline remains available for optional merge, split, rename, boundary, delete, and add corrections.

### 6.3 Clip Extraction & Tagging
- From each topic, extract reusable sub-clips tagged by type: `definition`, `worked_example`, `explanation`, `misconception_correction`, `prerequisite_recap`.
- Each clip tagged with: source topic, concept(s) covered, difficulty level, type.
- Clips must be independently playable (clean in/out points, no mid-sentence cuts) — this is a hard quality bar, since janky cuts undermine trust in the whole product.
- With the local video provider, reviewed clip boundaries are materialized into zero-based MP4 assets using FFmpeg so the player timeline and media duration represent the clip itself. Source-range playback is retained only as a compatibility/failure fallback; Mux remains available behind the provider abstraction.
- Once a generated topic has generated concept coverage, clip extraction starts automatically. Generation is pipeline work, not an instructor decision; failures expose an explicit retry without blocking other topics.
- Clips enter the private draft as active teaching moments without a duplicate approval queue. In-context playback makes optional spot-checking practical; if quality is wrong, the instructor regenerates or edits the affected teaching moment while historical media remains audit-only and excluded from routing.
- Topic boundary, dismissal, split, merge, or concept-coverage changes must invalidate affected generated clips. Stale media is excluded from learner routing until regenerated.

### 6.4 Concept & Prerequisite Graph
- AI extracts one to three independently assessable, routable concepts per topic and infers a directed prerequisite graph (`requires` edges) across the whole course. Repeated or near-duplicate concepts should be represented once and linked to every relevant topic.
- Graph must support: multiple prerequisites per concept, concepts spanning multiple topics, and cross-topic prerequisite links (not just linear topic order).
- Prerequisite inference is deliberately sparse: an edge exists only when mastery of the source is genuinely necessary before the target. Chronology, adjacency, and conceptual association alone are not prerequisite evidence. Low-confidence edges are omitted rather than presented as structure the instructor must clean up.
- Regeneration preserves instructor-edited, dismissed, and merged decisions and cannot silently reset or resurrect them.
- The generated graph is finalized automatically into the private revision. The visual graph editor lets the instructor optionally position nodes, add concepts, remove concepts through traceable dismissal, add/remove/re-link edges, merge duplicates, rename nodes, and repair topic links. Instructor domain knowledge can improve personalization without becoming a mandatory approval chore.
- The editor defaults to active concepts grouped in topic order and provides a topic focus that retains immediate prerequisite/dependent context. Dismissed history remains explicitly available for traceability without cluttering the primary canvas.
- Graph must be queryable at runtime (given a learner's mastered-concept set, compute eligible next concepts) with low latency, since this is called on every learner interaction.

### 6.5 Assessment Generation
- Every active concept needs explicit assessment coverage: at least one usable comprehension-check question (MCQ, short answer, or worked-problem style depending on subject) plus a confidence self-rating prompt (e.g. 1–4 scale). A question has one primary concept and may intentionally cover additional concepts. Existing published revisions remain valid; Blueprint flags uncovered concepts as design debt until the relevant working revision is complete and published.
- Per question: a remediation map — for each plausible wrong answer (or wrong-answer *category*, e.g. "sign error" in math), which clip/concept to route the learner to.
- Assessments are generated automatically when a topic has concept coverage and usable clips. A question, its answer key, confidence prompt, hint ladder, and remediation rules enter the editable private draft automatically.
- A focused assessment editor keeps prompts, answers, choices, confidence prompts, hints, and remediation directly inspectable and editable. Publication—not per-question approval—is the boundary before any question reaches learners.

### 6.6 Adaptive Learning Path Engine
- Runs **autonomously per learner in real time** (this is the one part of the pipeline intentionally not gated by human review per-instance — see Section 5).
- Inputs per interaction: current concept, answer correctness, confidence rating, learner's mastery history.
- Eligibility and ordering are deterministic before evidence-based routing: all reviewed prerequisites are hard constraints, then the instructor's explicit revisioned concept sequence breaks ties among eligible concepts. Bayesian Knowledge Tracing is intentionally deferred until real calibration data exists.
- Routing logic (instructor-configurable policy, not hardcoded):
  - Correct + high confidence → advance to next eligible concept per graph.
  - Correct + low confidence → reinforcement (a second example clip on the same concept) before advancing.
  - Incorrect → route to: prerequisite clip (if a prerequisite gap is likely), alternate explanation clip (if it's a first miss), or misconception-specific correction clip (if the wrong answer matches a known misconception pattern).
- Maintain a per-learner mastery state (per concept: not-started / struggling / practiced / mastered), used both for routing and for dashboard analytics.
- Persist an immutable route event for every assessed transition, including the attempt, mastery before/after, action, target, explanation, evidence snapshot, and course revision.
- Support an optional placement/diagnostic check at course start to skip already-known material.
- Instructor-configurable policy knobs: mastery threshold definition, "allow advancing with partial understanding" vs. "require mastery" per concept, max remediation attempts before flagging to instructor. The normal interface presents graph-informed Foundation, Standard, and Applied-practice groups and a single bulk confirmation; concept-level controls remain collapsed for exceptional cases. Confirmed policy coverage is required before publishing.

### 6.7 Learner Experience (Player)
- Learners enroll in a course once, not in individual lectures. The learner home communicates each course's lecture and course-level activity composition; opening it shows the published Course Flow as one ordered learning journey. A lecture unit opens its adaptive topic/concept path in context, while standalone quizzes and assignments remain course units rather than fabricated lectures.
- On desktop, concept navigation uses one primary adaptive mastery trail rather than repeating the same order above the video and in a sidebar. The minimal fixed rail visually separates the single recommended next concept, other prerequisite-eligible alternatives, inspectable blocked concepts with named requirements, reviewable mastered concepts, and the concept currently being viewed; course-unit navigation and resources remain collapsed until requested. Route rationale is available once through a compact `Why this lesson?` disclosure instead of a second recommendation card. Mobile-specific mastery-trail redesign is deferred.
- Video player with topic/clip navigation, progress indicator per concept (not just % video watched), and an optional transcript disclosure whose current word follows playback for source-range, materialized-local, and Mux clips.
- A comprehension check + confidence prompt follows each topic as a separate learning step. Video and assessment never render simultaneously, and assessed remediation/advancement presents an explicit next action.
- Clear "why am I seeing this" messaging when routed to a remediation/prerequisite clip (transparency builds trust — this should never feel like a punishment or a black box).
- Learner-facing mastery map (which concepts mastered, which in progress) — motivational and orienting.

### 6.7.1 Agentic In-Course Learning Assistant
- On first course open, the learner receives a short in-course orientation with three choices: continue with the recommended reviewed path, take a reviewed placement check, or review foundations. Placement is resumable, idempotent, policy-driven, and may use only accepted/edited primary questions from the learner's pinned published revision.
- The learner starts or resumes a bounded study session through one of four intent modes: `Continue my path`, `Learn something new`, `Strengthen weak areas`, or `Review what I learned`. Manifold recommends one available mode from persisted prerequisites, attempts, confidence, route history, review schedule, and mastery, explains the evidence behind that recommendation, and keeps other valid modes selectable. Unavailable modes remain visible with an honest reason. Sessions contain one meaningful evidence loop followed by reflection; no learner-facing time budget or activity estimate is shown.
- The opened course uses one continuous `Plan → Learn → Practice → Reflect` loop. The active activity remains primary; at supported desktop/laptop heights the full-width 16:9 Watch stage keeps its collapsed transcript and explicit next action visible without page scrolling. A compact right-hand Learn → Practice → Reflect timeline visualizes only real persisted step progress, current/up-next/later/done states, and the saved adaptive route reason after evidence changes; it does not expose fake analytics or nonfunctional step navigation. The timeline and mastery trail orient the learner without duplicating the recommendation or producing a three-column wall.
- `Learning Assistant` is an on-demand, Course Director-style conversational copilot inside the opened course—not a global learner chat or unrestricted generative tutor. Its launcher and dock use the same Motion for React shared-layout capsule morph as Course Director, including reverse-close, connected identity movement, staged body reveal, Escape/focus support, and a reduced-motion fallback. Its learner/course-scoped transcript exists only in runtime memory for the current login: close/reopen and client-side navigation retain it, while login, logout, full reload, or a container-driven reload starts clean. A clean transcript renders a presentation-only welcome that names the current concept so the learner sees where they are and what bounded help is available before typing, without a separate context label; this welcome is not persisted and yields to the first real turn. Assistant messages align left and learner messages align right. GPT-5.4 may classify free text into an allowlisted intent, but learner-visible replies are deterministically rendered from persisted evidence and reviewed artifacts. Offered actions must navigate to a reviewed artifact, reveal an accepted hint, quote an accepted learner-visible source, explain deterministic persisted evidence, update a learner-owned session/goal/reflection, or create a structured help request.
- No learner-runtime model may generate explanations, examples, questions, hints, remediation, or unsupported claims. Hint ladders are revisioned assessment-support proposals with their own instructor `Accept / Edit / Dismiss` checkpoint and publication gate.
- Concept readiness is explicit. An actionable concept requires satisfied prerequisites, at least one active clip explicitly linked to that concept, and at least one accepted/edited primary question explicitly linked to it in the pinned revision. The learner runtime never substitutes an unrelated topic-level artifact.
- Session close reports what was practiced, what persisted evidence changed, remaining uncertainty, next recommendation, and review timing. Learner reflection is stored but never inferred as mastery.
- An in-course `Mastery Map` exposes mastered, practiced, struggling, ready, blocked, and due concepts; true prerequisite branches and merges; confidence/correctness mismatches; persisted route changes; and reviewed review actions without streaks, points, badges, confetti, or punitive wording. It is a read-only React Flow graph that opens at a readable current/recommended neighborhood of roughly three to five nodes in a compact desktop drawer; learners may pan or zoom out to inspect the full course. Solid links express prerequisites, subtle dashed links provide course-sequence orientation only where no prerequisite link exists, and persisted remediation/reinforcement/advancement events decorate their affected node and adaptive transition edge. Selecting a node reveals its evidence, saved route reason, mastery transition, and valid actions; clicking empty canvas clears selection. The learner UI does not invent added/deleted concepts when no structural revision event exists, and content-unavailable concepts remain visible and inspectable. An always-visible legend and detached route-history accordion are omitted so the map remains primary.
- `I’m stuck` previews the exact evidence to be shared, creates a structured learner help request, and surfaces it in the instructor's existing attention/evidence workflow. Any resulting AI-authored course change remains private and independently reviewable before publication.

### 6.8 Instructor Dashboard
- **Cohort analytics:** fourteen-day attempt/active-learner activity, course-wide mastery-state distribution, and concept reach/struggle aggregated from persisted attempts, enrollments, and learner-concept mastery.
- **Content performance:** answer-outcome distribution, question-level incorrect/uncertain demand, and per-clip remediation demand derived from real learner events. Do not display unsupported correlation or skip-rate claims until those events are explicitly instrumented.
- **Model-drift signals:** flags where real learner behavior contradicts the AI's original graph/assumptions (e.g. "learners who struggle here didn't struggle with the listed prerequisite, but did struggle with concept X, which isn't linked").
- **Problem-card interaction pattern** (used consistently across all three signal types above):
  - Signal (what's wrong) → AI diagnosis (why, per AI) → evidence-triage actions: `Acknowledge` / `Dismiss`, plus `Prepare improvement`.
  - `Prepare improvement` → exact private typed proposal → artifact actions: `Accept AI suggestion` / `Edit manually` / `Dismiss`.
  - Resolving a diagnosis never mutates course content or policy by itself, and an unchanged resolved evidence fingerprint must not reopen on refresh.
- **Direct edit actions**, reachable from a problem card or standalone:
  - Graph: add/remove/re-link prerequisite edges (opens the same graph editor as 6.4, with a data overlay).
  - Clips: regenerate the affected topic's learner clips; replaced/flagged historical records stay audit-only and cannot route to learners.
  - Questions: inline edit, regenerate (AI proposes variants), or edit the remediation mapping (which wrong answer routes to which clip).
  - Routing policy: adjust per-concept mastery/advancement policy (6.6); manually override an individual stuck learner's path.
- Changes from the dashboard apply to future learner interactions by default; a "reprocess in-progress learners" option should exist but require explicit instructor confirmation, since it affects people mid-course.
- Blueprint Live mode separates course-design health (coverage, structure, source alignment, assessment/clip readiness) from learner-evidence health (reach, correctness, confidence, mastery, remediation, and trends), so a new course remains useful without fabricated learner data.
- Blueprint Design mode uses the same selected structure as Live mode for persisted graph/sequence manipulation, avoiding a separate diagnostic map that drifts from its editor. Every canvas operation has an accessible outline/inspector equivalent. Add/edit/remove and relationship actions are type-aware, state their learner/course impact before consequential changes, and never silently ignore an invalid target.
- Blueprint Live mode provides an on-demand decision-lineage projection over the persisted course system: source moment → reviewed concept → teaching clip → assessment → learner evidence → deterministic route event → dashboard signal → signal-linked private proposed revision. It must distinguish an exact persisted link from an absent stage, never infer a proposal-to-signal relationship from proximity alone, and remain an overlay so the graph is still the primary workspace.

### 6.9 Publishing, Enrollment & Development Identity
- Courses have an explicit draft/published state. Learners cannot enroll in or access learner content for draft courses.
- Enrollment records uniquely link learner-role users to published courses—not lecture units—and pin access to a published course revision. The enrolled learner receives every reviewed unit in that revision's Course Flow while progress remains attributable to its lecture/quiz/assignment unit and underlying concepts.
- The current project uses an explicit development login gate backed by persisted instructor and learner identities so complete role-specific journeys can be tested. Fixed demonstration credentials route David to the instructor Course OS and Brian to the learner Course OS, but the API still uses the development `X-User-ID` context. This is not production authentication: secure password storage, signed sessions, account recovery, account administration, and security hardening remain future work.

### 6.10 Agent Runs, Editable Drafts & Course Revisions
- Agent work is persisted as resumable course-generation runs and scoped tasks with dependencies, leases, retry state, progress, and structured failures. Work continues without an open browser and resumes safely after service restart.
- Each durable generation task persists measured wall time plus in-scope provider operation, provider/model, latency, and provider-returned token/audio usage when available. Evaluation tooling calculates cost only from those records and a dated explicit price table; missing usage remains unpriced rather than estimated.
- A new course accepts one initial source; instructors can add further sources later through a new working revision.
- The initial source remains an audio/video lecture. Supplemental PDF and PPTX sources may be added to a revision as private AI context, reviewed learner resources, or both. Native text, speaker notes, page/slide visuals, and exact citations are extracted asynchronously; no supplemental source becomes learner-visible without review and publication.
- Post-generation specialist work is persisted with the same durable status/retry expectations as generation. A specialist task may prepare multiple atomic proposals, but each proposal is independently reviewable and failure cannot leave partially applied artifacts.
- The final generation task creates routing defaults, automatically accepts the coherent generated artifacts into the private working revision, records the transition in the audit log, and finishes in `draft_ready`. It does not create a Course Structure/Learner Experience/Publish Setup approval queue.
- Assistant chat transcripts are ephemeral login-runtime state and are never required for auditability. Course Director may read durable course and learner evidence, but any mutation must become a persisted auditable typed proposal; proposal rationale, evidence, review decisions, specialist tasks, learner sessions, reflections, and help requests remain durable even after the chat transcript resets.
- Courses keep an active published revision and at most one working revision. Artifacts have stable logical identities across revisions so diffs and mastery migration are deterministic.
- Publishing an update preserves immutable attempts and completed work, maps mastery for unchanged concepts, retains removed artifacts as history, initializes new concepts as not started, and applies the new revision to future learner routing.

---

## 7. Non-Goals / Out of Scope (this phase)

Explicitly deferred — documented here so scope doesn't silently creep, and so `plan.md` can propose them as a clearly-separated future phase if/when priorities change:

- Multi-tenant SaaS account management (orgs, teams, roles beyond instructor/learner).
- Billing, payments, subscription management.
- Public course marketplace / discovery.
- Native mobile apps (responsive web is in scope; native iOS/Android is not).
- Live/synchronous teaching features (this is an asynchronous, pre-recorded-video product).
- Fully AI-generated (non-instructor-sourced) lecture content — out of scope by design, not just by phase, since it conflicts with the core value proposition (reusing real instructor content + judgment).

---

## 8. Ideal Tech Stack (recommendation, chosen on merit — not sponsor-constrained)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **Next.js (React) + TypeScript**, Tailwind CSS, shadcn/ui | Best-in-class DX for a content- and interaction-heavy app; SSR/streaming helps with video-heavy pages; large ecosystem for video players and graph visualization (e.g. React Flow for the concept graph editor). |
| Backend (app API) | **Node.js/TypeScript**, tRPC or a typed REST layer | Type-sharing with the Next.js frontend end-to-end; good fit for the interactive dashboard/editor CRUD surface. |
| AI/video pipeline service | **Python** (FastAPI), separate service | Python has the strongest ecosystem for transcription, ffmpeg orchestration, and ML tooling; keeping this as its own service also lets it scale/queue independently from the interactive web app. |
| Orchestration | **Temporal** (or a simpler queue like BullMQ/Celery if complexity doesn't warrant Temporal) | The ingestion pipeline is a multi-step, long-running, retry-prone workflow (transcribe → segment → extract clips → build graph → generate assessments); a durable workflow engine avoids fragile ad-hoc job chains. |
| LLM (reasoning: segmentation, graph-building, assessment generation, dashboard diagnosis) | **OpenAI GPT-5.4** | Long-context, strong structured-output and instruction-following performance are the key requirements here (feeding full transcripts + generating structured JSON graphs/questions). Use GPT-5.4 consistently for all LLM-powered agents unless a later architecture decision explicitly changes this. |
| Transcription | **Whisper-class ASR** (open-weight, self-hostable, or a hosted equivalent) | Mature, accurate, word-level timestamps, cost-effective at scale. |
| Relational data | **PostgreSQL** | Users, videos, topics, clips, questions, attempts, mastery state — standard relational shape. |
| Graph data (concept/prerequisite graph) | **Neo4j** (or Postgres + a graph-query layer if avoiding a second datastore) | Prerequisite traversal (given mastered concepts, compute eligible next concepts) is a native graph query; a real graph DB makes this fast and the queries legible. For a leaner build, an adjacency-table-in-Postgres approach is an acceptable fallback — documented as a phase 0 decision to make explicitly, not default into. |
| Object storage | **S3-compatible storage** | Video files, extracted clips. |
| Video delivery | **Mux available behind the provider abstraction; local delivery active for development and the public demo** | Mux provides adaptive streaming and remains implemented with its 10-video safeguard, while the current public Render demo uses bundled/local delivery by explicit user decision. |
| Auth / identity | **Development login gate + persisted role context** for the current project; Auth.js/Clerk remains a production option | Fixed demonstration credentials provide clear instructor/learner entry and local session routing, but the underlying `X-User-ID` context and browser storage are explicitly not production-ready authentication. |
| Interaction motion | **Motion for React** | Shared-layout projection powers the instructor and learner assistant capsule-to-dock transition. Blueprint Live deliberately uses Motion's numeric spring over one continuously mounted React Flow instead, because React Flow's CSS-transformed viewport is not a reliable ancestor for screen-space shared-layout measurement. The same small motion vocabulary drives graph-space node/edge/viewport interpolation, page settles, major-section cascades, skeleton-to-content handoffs, the keyed Course Flow-to-Blueprint presence transition, and stable-map reveals; React Flow remains responsible for viewport application, ELK positions, and initial/mode/topic/Auto-arrange authoritative fits. All paths share a user reduced-motion fallback instead of bespoke animation systems. |
| Testing | **Vitest/Jest** (frontend/Node), **Pytest** (Python pipeline), **Playwright** (e2e) | Standard, well-supported per-layer. |
| Infra | **Docker containers**, deployable to any cloud (AWS, Fly.io, Render) | Keep infra cloud-agnostic at the architecture level even if a specific cloud is chosen for deployment. |

The current public demo uses Render Free for the web and pipeline services and an isolated database in the user's existing Neon Free project. This is a demonstration environment, not a production-reliability commitment: Render's free services can cold-start after idling. Provider and database credentials remain deployment secrets and are never committed.

This is a recommendation, not a mandate — `implementation.md` should record the *actual* stack decisions made as the project proceeds, since real choices may reasonably diverge (e.g. choosing a hosted ASR API over self-hosted Whisper for speed of build). If the stack changes, update `implementation.md` first; `AGENTS.md` instructs the agent to keep this PRD in sync (see that file).

---

## 9. Data Model (high-level entities)

- **User** (role: instructor | learner)
- **Course** → has many **Video**s
- **Video** → transcript, duration, source metadata
- **Topic** (belongs to Video/Course; time range; title; summary)
- **Concept** (belongs to Course; name; description)
- **ConceptEdge** (from_concept, to_concept, relationship = `requires`)
- **Clip** (belongs to Topic; time range within source video; type; tagged concept(s); difficulty)
- **Question** (belongs to Topic; body; type; correct answer; confidence prompt; explicitly covers one primary and optionally additional Concepts)
- **RemediationRule** (belongs to Question; wrong_answer_pattern → target Clip/Concept)
- **Enrollment** (Learner ↔ Course)
- **LearnerConceptMastery** (Learner, Concept, state: not_started/struggling/practiced/mastered, updated_at)
- **Attempt** (Learner, Question, answer, correctness, confidence, timestamp)
- **DashboardSignal** (type: stuck_cohort | underperforming_content | graph_drift; related entity; AI diagnosis; status: open/accepted/edited/dismissed)
- **RoutingPolicy** (per Concept or per Course: mastery threshold rules, advancement rules)
- **CourseSource / RevisionSource** (immutable PDF/PPTX/video source plus revision purpose, review state, and learner visibility)
- **SourceSection / SourceCitation** (page/slide text, notes, visual summary, and exact artifact/proposal provenance)
- **CourseAgentTask** (revision-scoped specialist work, evidence snapshot, durable status, result, and linked typed proposals)
- **LearnerRouteEvent** (immutable Attempt-linked mastery transition, selected action/target, rationale, evidence snapshot, and revision)

---

## 10. Success Criteria

### Product-level
- An instructor can go from raw lecture upload to an editable adaptive private draft without clerical review work, then inspect or modify only what they choose and explicitly publish it.
- The system records sufficient watch-time, routing, attempt, and mastery data to support a future controlled comparison of adaptive learning against linear playback. Demonstrating fewer watched minutes with a real learner cohort is a deferred product-validation study, not a Phase 10 engineering completion gate.
- At least one full instructor "dashboard correction loop" (signal → accept/edit/dismiss → applied change → visible effect on subsequent learner data) is demonstrably functional end-to-end.

### Technical / quality bars
- Clip boundaries: no mid-sentence or mid-thought cuts in >95% of generated clips (human-rated sample).
- Concept graph: optional instructor edit rate and later learner evidence are quality signals for the generated starting point; zero edits is acceptable when the instructor judges the draft useful.
- Time from generation completion to an instructor understanding the course decomposition well enough to publish or make a targeted edit is a tracked usability metric.
- Assessment quality: >90% of generated questions should require no edit or only a light edit in normal cases, tracked through optional edits and learner evidence rather than a mandatory approval queue.
- Dashboard signal precision: manually-sampled dashboard flags should reflect real, actionable issues (not noise) at a rate the instructor finds worth their time — track dismiss-rate as an inverse quality signal.
- A repository-owned competition harness can reproduce automated verification, warm application latency, one optional disposable real-provider generation, per-task/provider usage, calculated model cost, current course/trace completeness, and explicit quality gates as JSON plus Markdown. Measured, calculated, vendor-claimed, and unmeasured values must remain visibly distinct.

### Instructor-control-specific
- Every initially generated artifact type is auditable and directly editable inside a private revision without requiring a per-artifact approval action.
- No generated content reaches learners until the instructor explicitly publishes the private revision.
- Later learner-evidence-driven AI improvements remain visible private proposals with working `Accept / Edit / Dismiss` controls before they change the working revision.

---

## 11. Testing Strategy

Full detail lives in `plan.md` (per-phase breakdown). Overall strategy:

- **Unit tests** (automated, coding agent responsibility): pipeline functions (segmentation boundary logic, graph edge computation, routing policy evaluation, remediation mapping resolution), isolated from LLM calls where possible (mock/stub AI outputs for deterministic logic tests).
- **Integration tests** (automated): full pipeline stages against fixture video/transcript data — e.g. "given this transcript, does segmentation produce topics within the target length range."
- **AI-output quality tests** (semi-automated + human-reviewed): since LLM outputs aren't strictly deterministic, these use a rubric-based human review (or an LLM-as-judge pass as a first filter, human-verified) rather than exact-match assertions. Tracked as part of Section 10's quality bars.
- **End-to-end tests** (automated, Playwright): critical user journeys (4.1, 4.2, 4.3) run against a test environment with fixture data.
- **Human tests** (manual, after each implementation phase — see `plan.md`): a checklist the user runs personally to sanity-check what automated tests can't (does the segmentation *feel* right, is the graph *pedagogically* sensible, does the dashboard suggestion *actually* make sense).

---

## 12. Risks & Open Questions

- **Video licensing/rights** for any non-instructor-owned demo content — must be clearly disclosed, not a product concern but a demo/legal one (see prior discussion).
- **Cold-start problem**: a new course has no learner data yet, so the dashboard's data-driven signals (6.8) have nothing to work with until there's a real cohort — early-course dashboard should clearly communicate "not enough data yet" rather than show false signals.
- **Clip quality at scale**: extraction quality depends heavily on transcript/ASR accuracy and source video audio quality — worth defining a minimum input quality bar or a "low confidence, please review manually" flag.
- **Graph complexity ceiling**: the implemented Live selection focus isolates any artifact and its first-degree relationships, while topic focus retains its broader selected-topic neighborhood and density limits keep generation to one to three concepts per topic. Real larger-course testing must still validate whether first-degree focus is sufficient for high-degree hub nodes or needs grouped/collapsed neighbor controls.
- **Open question**: should retroactive reprocessing (applying a dashboard-driven fix to already-in-progress learners) be a v1 feature or explicitly deferred? Current recommendation (Section 6.8): defer to explicit instructor opt-in, don't auto-apply.
- **Deferred validation study:** whether adaptive learners reach the same mastery with fewer watched minutes than linear-playback learners requires a real cohort, comparison protocol, and analysis plan. Phase 10 provides the instrumentation, but the outcome must not be claimed from synthetic E2E/load data.

---

## 13. Future Roadmap (post-core-product)

Documented for context, not being built now (Section 7):

- Multi-tenant SaaS layer: org accounts, billing, learner marketplace/discovery.
- Cross-course concept graph reuse (shared concept libraries across an instructor's multiple courses).
- Peer-teaching signals (learners who've mastered a concept help explain it to others).
- Mobile-native apps.
- Marketplace of instructor-published courses (the actual "One Person Company" monetization layer).
- Controlled learner-cohort evaluation comparing adaptive-path watched minutes and mastery outcomes against linear playback.
