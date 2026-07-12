# CourseFoundry UI/UX Redesign Plan

**Status:** Active
**Current stage:** Stage 1 - Design concepts and system
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
| 1. Design concepts and system | In progress | Complete desktop concepts, tokens, typography, density, states, and interaction thesis | User approves visual direction before UI implementation |
| 2. Shared foundation and application shell | Not started | Tailwind/shadcn foundation, tokens, app shell, component extraction, workspace navigation | Instructor and learner shells render correctly with existing data |
| 3. Instructor onboarding and course builder | Not started | Source ingestion, processing, readiness, publishing, and course-production stepper | Existing ingestion-to-publish flow passes E2E and visual review |
| 4. Instructor review workspaces | Not started | Outline, clip, and assessment review queues with contextual inspectors | All Accept/Edit/Dismiss paths retain behavior and traceability |
| 5. Graph and routing workspace | Not started | Full-canvas graph, review filters, concept/edge inspector, routing tools, simulator | Graph editing and routing branches pass E2E and visual review |
| 6. Instructor insights | Not started | Summary, signal queue, problem inspector, dashboard actions, learner override | Dashboard correction loop passes without invented data |
| 7. Learner experience | Not started | Focused player, comprehension flow, route explanation, course path, mastery map | Learner remediation/advancement journey passes E2E and visual review |
| 8. Desktop/laptop hardening and rollout | Not started | WCAG 2.2 AA, desktop/laptop responsive constraints, loading/error/empty states, visual regression, performance | Automated suite passes and user completes Phase 10 human checklist |

## Stage 1 - Design Concepts and System

### Required concept screens

- Shared instructor shell and course overview.
- Instructor course builder/review workspace.
- Full-canvas concept graph and inspector.
- Instructor insights/dashboard and problem-review state.
- Learner player/comprehension state.
- Learner course path/mastery map.

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

## Non-Regression Rules

- Preserve every existing API call and persisted state transition unless a separately approved defect requires a change.
- Preserve the standard AI review states and Accept/Edit/Dismiss semantics.
- Preserve AI rationale, instructor revision, status, and audit traceability.
- Preserve draft/publish and learner-enrollment gates.
- Preserve Mux capacity warnings and local provider fallback.
- Preserve keyboard operation, focus visibility, semantic labels, reduced motion, and WCAG 2.2 AA.
- Run existing unit, build, Playwright, and axe checks after every implementation stage.
- Add desktop visual-regression screenshots for every major workspace and important empty/error/reviewed state.

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

## Completion Rule

Stage 8 does not complete Phase 10 automatically. After all automated checks pass, present the Phase 10 human checklist from `plan.md` verbatim and wait for user confirmation.
