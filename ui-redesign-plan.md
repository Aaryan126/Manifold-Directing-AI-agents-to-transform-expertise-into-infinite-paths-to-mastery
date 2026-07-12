# CourseFoundry UI/UX Redesign Plan

**Status:** Automated tests passing; awaiting human confirmation
**Current stage:** Stage 8 - Human validation pending
**Last updated:** 2026-07-12
**Scope:** Desktop and laptop web only. Tablet, mobile, and native-app layouts are not part of this redesign.

This is the ground-truth execution document for the Phase 10 production UI/UX redesign. Update it whenever a stage starts, a deliverable is completed, a design decision is approved, or a blocker is found. Do not silently skip stages or change the approved visual direction.

## Product Constraint

The redesign changes information architecture, presentation, component structure, and interaction ergonomics. It must not change backend contracts, pipeline behavior, review semantics, routing policy, enrollment, publishing rules, dashboard decisions, or learner mastery logic.

## Visual Thesis

CourseFoundry is a calm instructional operating system: precise and information-dense for instructors, focused and confidence-building for learners, with course structure and mastery always visible.

### Visual system direction

- Warm-white and graphite foundation, with neutral surfaces that keep working content dominant.
- One cobalt or blue-green product accent. Emerald, amber, and red are reserved for semantic states.
- Restrained 4-8px radii, subtle separators, and minimal elevation.
- Dense instructor workspaces; calmer and more spacious learner surfaces.
- Proposed typography: Instrument Sans for operational UI and Source Serif 4 for course titles, learner explanations, and orientation moments. Final font choice is confirmed during Stage 1.
- Motion is limited to workspace transitions, inspector appearance, review-state changes, and mastery progression, with reduced-motion support.
- No decorative gradients, nested cards, floating dashboard mosaics, oversized marketing composition, or ornamental UI.

## Information Architecture

### Instructor workspace

`Overview -> Course setup -> Outline -> Concept graph -> Clips -> Assessments -> Routing -> Learner preview -> Insights`

The instructor experience uses a subdued left navigation rail, a compact course header, one primary working surface, and a contextual right inspector. Review work is organized as queues and focused editors instead of one long page.

### Learner workspace

`Current lesson -> Course path -> Mastery -> Course outline`

The learner experience prioritizes the current lesson, the next recommended action, transparent routing rationale, and a professional concept-mastery path.

## Stage Tracker

| Stage | Status | Deliverable | Approval gate |
|---|---|---|---|
| 1. Design concepts and system | Complete | Complete desktop concepts, tokens, typography, density, states, and interaction thesis | User approved continuing with the generated instructor concepts and textual learner specification on 2026-07-12 |
| 2. Shared foundation and application shell | Complete | Tailwind/shadcn foundation, tokens, app shell, component extraction, workspace navigation | Production build, 26 unit tests, 4 local E2E/WCAG tests, and 1600x1000 plus 1280x800 visual review passed on 2026-07-12 |
| 3. Instructor onboarding and course builder | Implementation complete; paired E2E pending | Source ingestion, processing, readiness, publishing, and course-production stepper | Fast checks and desktop/laptop visual review pass; workflow E2E will run with the Stage 4+5 paired gate |
| 4. Instructor review workspaces | Automated paired gate passed; final visual regression Stage 8 | Outline, clip, and assessment review queues with contextual inspectors | Lint, typecheck, 26 unit tests, production build, and the Stage 4+5 Playwright/WCAG gate pass |
| 5. Graph and routing workspace | Automated paired gate passed; final visual regression Stage 8 | Full-canvas graph, review filters, concept/edge inspector, routing tools, simulator | Graph/routing implementation compiles; Stage 4+5 Playwright/WCAG gate passes after fixing learner status visibility |
| 6. Instructor insights | Automated paired gate passed; final visual regression Stage 8 | Summary, signal queue, problem inspector, dashboard actions, learner override | Dashboard correction journey and WCAG scan pass in the Stage 6+7 paired gate |
| 7. Learner experience | Automated paired gate passed; final visual regression Stage 8 | Focused player, comprehension flow, route explanation, course path, mastery map | Production build and learner remediation/advancement plus role-switch Playwright journeys pass |
| 8. Desktop/laptop hardening and rollout | Automated tests passing; awaiting human confirmation | WCAG 2.2 AA, desktop/laptop responsive constraints, loading/error/empty states, visual regression, performance | Automated suite passes; user must complete the Phase 10 human checklist before this stage or phase is marked complete |

## Stage 1 - Design Concepts and System

### Required concept screens

- Shared instructor shell and course overview. Concept generated and direction accepted.
- Instructor course builder/review workspace. Outline-review concept generated and direction accepted.
- Full-canvas concept graph and inspector. Concept generated and direction accepted.
- Instructor insights/dashboard and problem-review state. Concept generated and direction accepted.
- Learner player/comprehension state. Defined textually below; image generation intentionally cancelled by user.
- Learner course path/mastery map. Defined textually below; image generation intentionally cancelled by user.

### Concept artifacts

- `design/concepts/01-instructor-overview.png` - initial shell and course-production overview direction. The shell, hierarchy, density, production sequence, and readiness rail are candidates for approval. Placeholder counts and the illustrative recent-activity feed do not authorize new product functionality.
- `design/concepts/02-outline-review.png` - review queue, focused editor, evidence rail, boundary controls, and persistent Accept/Edit/Dismiss action area.
- `design/concepts/03-concept-graph.png` - full-canvas graph, compact floating controls, stateful nodes, and contextual concept/routing inspector.
- `design/concepts/04-instructor-insights.png` - summary band, signal queue, evidence-focused detail area, and correction actions using existing dashboard data.

### Learner screen specification

- **Player/comprehension:** compact learner top bar; large 16:9 player; current topic and clip context; professional course-outline rail; comprehension question and confidence control adjacent to the learning flow; neutral `Why this is next` explanation; clear reinforcement/advance message; no instructor sidebar.
- **Course path/mastery:** unit-grouped prerequisite path using refined concept nodes and connectors; mastered, current, available, reinforcement, and locked states; selected-concept inspector with mastery, prerequisite status, related topic, routing explanation, and Continue lesson action; no characters, points, streaks, rewards, or decorative game objects.
- Both learner screens reuse the instructor system's warm-white, graphite, cobalt, and semantic colors with more whitespace and a restrained Source Serif 4 orientation/title moment.

### Interaction thesis

- Workspace changes use a short, restrained content transition while global navigation remains stable.
- Selecting a review artifact or graph node opens a contextual inspector without navigating away from the working surface.
- Accept/Edit/Dismiss produces immediate, accessible state feedback and advances the review queue when appropriate.
- Learner progression animates only the changed mastery node and next-action marker.

### Concept review criteria

- The product reads as one system across instructor and learner roles.
- Instructor surfaces feel dense and operational, not like a stack of forms or cards.
- Learner surfaces feel focused and motivating without gamified characters, rewards, or childish styling.
- All visible controls map to functionality that already exists.
- No concept invents unsupported analytics, collaboration, billing, authentication, or marketplace features.

## Implementation Architecture

- Keep Next.js, React, TypeScript, React Flow, Mux Player, Playwright, and axe.
- Introduce Tailwind CSS and shadcn/ui only after Stage 1 approval.
- Use Lucide icons through shadcn conventions.
- Preserve current backend endpoints and request/response models.
- Split the current monolithic page into feature components and shared UI primitives without rewriting domain logic at the same time.
- Keep the selectable development identity, but move it into a compact development-only account control.
- Use current dashboard data only. Richer charts require a separately approved backend/product scope change.

## Stage 2 Implementation Record

- Tailwind CSS v4 and shadcn/ui Nova were initialized in the existing Next.js workspace.
- Self-hosted Instrument Sans Variable and Source Serif 4 Variable replace browser-default typography without build-time font downloads.
- Shared semantic OKLCH tokens define warm-neutral surfaces, cobalt product actions, subdued navigation, borders, focus, and status roles.
- `CourseFoundryShell` provides persistent role-aware navigation, compact course status/header actions, collapsible desktop sidebar, and the existing selectable development identity.
- Existing workspaces remain inside a scoped legacy container while Stages 3-7 replace them incrementally; domain requests and state transitions were not rewritten.
- Existing identity selection remains a styled native select to preserve keyboard/browser behavior and the tested `selectOption` interaction.

## Non-Regression Rules

- Preserve every existing API call and persisted state transition unless a separately approved defect requires a change.
- Preserve the standard AI review states and Accept/Edit/Dismiss semantics.
- Preserve AI rationale, instructor revision, status, and audit traceability.
- Preserve draft/publish and learner-enrollment gates.
- Preserve Mux capacity warnings and local provider fallback.
- Preserve keyboard operation, focus visibility, semantic labels, reduced motion, and WCAG 2.2 AA.
- Run lint, typecheck, focused unit tests, and production build checks during implementation stages.
- Run full Playwright gates after Stages 4+5 and after Stages 6+7, then run the final axe and visual-regression batch in Stage 8. Use targeted desktop/laptop visual checks during implementation to catch layout regressions quickly.

## Tooling

- OpenAI `build-web-apps` plugin: installed; provides frontend app design, React, shadcn, and browser QA skills.
- shadcn MCP server: configured globally for registry/component discovery.
- Figma plugin: available if a collaborative editable design artifact is needed.
- Image generation: used for complete concept screens before code.
- Browser plugin and Playwright: used for implementation fidelity and interaction QA.

## Decisions Log

- 2026-07-12: User approved a staged production-grade redesign split across shared foundations, instructor workflows, learner workflows, and hardening.
- 2026-07-12: Desktop and laptop web are the only responsive targets for this redesign; tablet and mobile are explicitly excluded.
- 2026-07-12: Linear is the primary reference for hierarchy, navigation, review queues, and dashboard restraint; Miro informs the graph canvas; Coursera informs learner orientation; Duolingo informs path sequencing only, without playful character styling.
- 2026-07-12: Product functionality and backend contracts are frozen during the redesign unless the user separately approves a functional change.
- 2026-07-12: User approved continuing from the four completed instructor concepts and requested no further image generation because of latency. Learner screens will follow the textual specification in this document.
- 2026-07-12: Stage 2 shared foundation/application shell completed. Tailwind v4, shadcn Nova, Lucide, self-hosted fonts, semantic tokens, and the role-aware app shell are implemented; existing unit/E2E/WCAG behavior remains green at desktop/laptop viewports.
- 2026-07-12: Stage 3 course builder implemented with unified source ingestion, processing progress/error state, seven-step production readiness rail, publishing blockers, Mux capacity state, and development-identity disclosure. Lint, typecheck, 26 unit tests, production build, and targeted 1600x1000/1280x800 visual checks pass without horizontal overflow. At user request, full Playwright runs use paired gates after Stages 4+5 and 6+7 rather than running after every stage.
- 2026-07-12: Stage 4 instructor review workspaces implemented. Outline, clip, and assessment surfaces now use a shared three-pane queue/focused-editor/evidence-inspector pattern; existing topic boundary, generation prerequisite, media preview, JSON editing, traceability, and Accept/Edit/Dismiss/Regenerate/flag/re-cut actions are preserved. Lint, typecheck, all 26 unit tests, and production build pass. Populated-state visual and behavior verification is intentionally paired with Stage 5.
- 2026-07-12: Stage 5 graph/routing workspace implemented. The concept graph is now a 700px primary canvas with status filters, node/edge selection, artifact inspector, review controls, traceability, duplicate merge, and edge creation. Routing uses a concept queue, focused policy editor, safeguards inspector, and a three-pane learner simulator. The Stage 4+5 gate passes 4 local Playwright journey/WCAG tests with 1 credential-dependent Mux test skipped. The gate found and fixed learner enrollment feedback hidden inside the instructor-only setup surface. Final visual-regression capture remains in Stage 8.
- 2026-07-12: Stage 6 instructor insights implemented with a compact real-data summary band, signal queue, focused diagnosis/action editor, related-entity and traceability inspector, and existing manual learner override. No new metrics or synthetic charts were added. Lint, typecheck, and 26 unit tests pass; dashboard correction E2E is paired with Stage 7.
- 2026-07-12: Stage 7 learner experience implemented with a focused player, adjacent route rationale, comprehension flow, compact course-outline rail, and professional concept mastery path. Enrollment, watch tracking, answer outcomes, remediation/advancement, and topic navigation are unchanged. The Stage 6+7 gate passes the production build and 4 local Playwright journey/WCAG tests with 1 credential-dependent Mux test skipped. One obsolete dashboard `.panel` test hook was updated to the stable `#insights` workspace ID; behavior assertions were unchanged.
- 2026-07-12: Stage 8 automated hardening completed and is awaiting human confirmation. Five populated-state visual baselines now cover course setup, outline, concept graph, insights, and learner laptop views; explicit 1280px overflow checks cover all major workspaces. Baseline review found and fixed legacy black-button/full-size-checkbox leakage and a React Flow node-dimension defect that left graph nodes hidden. Final results: frontend/shared lint, typecheck, 27 unit tests, production build, 75 backend tests, Ruff, MyPy, 6 local Playwright journey/WCAG/visual tests passed, 1 credential-dependent Mux test skipped, and all Docker services plus health endpoints are healthy. Phase 10 remains incomplete pending the user's human checklist confirmation.

## Completion Rule

Stage 8 does not complete Phase 10 automatically. After all automated checks pass, present the Phase 10 human checklist from `plan.md` verbatim and wait for user confirmation.
