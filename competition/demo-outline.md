# Three-minute competition demo outline

The video makes one argument:

> **Manifold turns one real lecture into an adaptive mastery system, then closes
> the loop from learner evidence back to an instructor-reviewed improvement.**

The demo should feel like one continuous story, not a tour of product features.

## 0:00–0:22 — Problem and gap

Open on a conventional one-hour lecture. Explain the gap in one breath:

- video gives every learner the same linear path;
- turning it into a real course normally requires instructional-design,
  assessment, editing, and analytics work;
- ordinary AI course generators can create content, but cannot show how each
  teaching decision connects to later learner evidence.

Suggested line:

> “A recording can contain excellent teaching and still be a poor learning
> system. Manifold compiles the instructor’s teaching into an adaptive course
> whose decisions remain visible and governable.”

## 0:22–0:58 — Instructor: lecture to mastery course

Sign in as the instructor, open the competition course, and add the clearly
licensed business lecture. Let the generation progress communicate the work
being done.

When generation finishes, let the Blueprint itself make the transformation
visible: the source/topic backbone appears first, concepts unfold beneath it,
then teaching moments and checks resolve into place. Use the fit-all control
once after the brief reveal to show the complete lecture.

The spoken point is that this is more than transcription or summarization:
Manifold identifies topics, concepts, prerequisites, teaching moments, checks
for understanding, and remediation paths.

Suggested voice-over:

> **0:22–0:29 — Add the lecture:** “Here’s how that works. Let’s start with a
> real business lecture—before any lessons, quizzes, or learning map are built
> around it.”
>
> **0:29–0:42 — Generation progress:** “Manifold transcribes the source,
> identifies how the instructor has organized the ideas, and builds the
> learning structure around them.”
>
> **0:42–0:58 — Blueprint reveal and fit-all:** “What appears is more than a
> summary: topics and concepts, their prerequisites, the exact teaching moments
> that explain them, checks for understanding, and alternate paths when a
> learner needs help. The result is a private course draft, ready for the
> instructor to inspect before anything can reach learners.”

## 0:58–1:28 — Instructor: understand the course as a system

Keep the Blueprint in Live mode and scan its hierarchy:

```text
lecture → topics → concepts → teaching moments and assessments
```

Click one concept so only its direct neighborhood remains. Point out the real
prerequisite, the assessment, and the alternate explanation. Close the detail
view to return smoothly to the complete map.

Avoid explaining every relationship. The visual should make the organization
legible before narration adds detail.

Suggested voice-over:

> **0:58–1:08 — Scan the hierarchy:** “This Blueprint shows the lecture as a
> learning system, not just a timeline. The source branches into topics,
> concepts, and the teaching moments and assessments connected to each one.”
>
> **1:08–1:23 — Select one concept:** “Selecting one concept reveals the logic
> around it: the prerequisite a learner needs first, the check that tests
> understanding, and the alternate explanation ready if they struggle.”
>
> **1:23–1:28 — Close the detail view:** “I can inspect one decision, then
> return to the complete course.”

## 1:28–1:52 — Instructor: direct the AI, retain control

Open Course Director and enter:

> “Reconnect ‘Run fundraising as a timed, signal-driven process’ so it requires
> ‘Startup speed and incentive alignment,’ not ‘Venture-backed startup
> outcomes.’ Keep everything else unchanged.”

Keep the Venture-backed outcomes concept's focused Live neighborhood open while
using Course Director. Before acceptance, show the exact existing relationship
highlighted as a proposed reconnection while the rest of the neighborhood stays
visible and unchanged. Briefly show `Accept / Edit / Dismiss`, then accept the
change. In the configured recording demo, the focused neighborhood immediately
projects the accepted working revision under a clearly labelled **Private
preview**; close the detail view to show the same private structure in the whole
Blueprint. The learner-facing published revision remains unchanged.

Suggested voice-over:

> **1:28–1:36 — Introduce Course Director and the edit:** “Course Director lets
> me edit the learning structure in plain language. Here, I’m replacing one
> prerequisite in this learner path.”
>
> **1:36–1:43 — Show the highlighted relationship:** “Before anything changes,
> Manifold highlights the exact relationship it would replace and leaves the
> rest untouched.”
>
> **1:43–1:46 — Show the controls:** “I can accept, edit, or dismiss.”
>
> **1:46–1:52 — Accept and reveal the private preview:** “I’ll accept—the map
> updates immediately as a private preview—but learners see nothing until I
> publish.”

## 1:52–2:22 — Learner: one interpretable adaptation

Run `npm run demo:reset` immediately before filming this clip. Sign in as Brian,
then begin on the learner dashboard with the Business 101 card visible. The
reset has already completed the teaching step and prepared the next screen at
the business-planning misconception check.

Detailed screen recording:

1. **1:52–1:57 — Establish the learner and session.** Begin on the Business 101
   card and immediately click **Continue course**. The prepared session should
   open directly on the question—do not click **Start session** or replay the
   lecture. Hold the workspace long enough to show both the question and the
   right rail: learning complete, check current, reflection ahead.
2. **1:57–2:04 — Submit one misconception.** For **“According to the lecture,
   why should an entrepreneur create a business plan?”**, select the first
   answer, **“To produce a formal document mainly for investors…”**. Select
   **Confident**, then click **Submit answer**. Keep the cursor away from the
   result card once it appears.
3. **2:04–2:13 — Hold on the adaptive decision.** Pause on **Your path
   changed**. Make sure the card visibly shows all three rows:
   **Incorrect answer · high confidence**, the saved **Why**, and the
   **Alternate explanation** selected under **Next**. Let the updated session
   rail remain visible beside it.
4. **2:13–2:22 — Locate the support in the course.** Click **Mastery** once.
   Hold on the default focused Mastery Map; do not switch to **Show whole
   course**. Frame the current concept, its nearby prerequisite, and the purple
   support route. If needed, select the route-changed concept once to expose
   **Why this route changed**, but do not explore other nodes.

Suggested voice-over:

> **1:52–1:57 — Establish the learner:** “Now, one seeded demonstration
> learner—not a real cohort—reaches a quick check.”
>
> **1:57–2:04 — Answer incorrectly with confidence:** “They choose a common
> misconception and answer with high confidence.”
>
> **2:04–2:13 — Show Evidence / Why / Next:** “Manifold combines correctness
> and confidence, explains why the path changed, and selects a reviewed
> alternate explanation next.”
>
> **2:13–2:22 — Open Mastery Map:** “The Mastery Map shows exactly where that
> support fits in the larger prerequisite path.”

Do not demo a second learner journey. The point is one short, legible chain from
learner evidence to a changed next step.

## 2:22–2:48 — Close the loop with Trace decision

Use a separate instructor browser profile or a clean edit between clips so no
login transition appears on screen. After the learner answer, refresh the
instructor Course Studio once so its dashboard aggregation sees the new saved
evidence. In Blueprint Live, use **Jump to…** to select **Entrepreneurial
planning as an iterative venture-design process**, then open **Trace decision**.

Before recording, confirm the trace header. Use the primary script below only
if it says **Complete chain** and both **Dashboard signal** and **Proposed
revision** are available. The current Business 101 published revision does not
yet have a signal-linked proposed revision; if that remains true, use the
honest-gap version instead of claiming a record exists.

Detailed screen recording:

1. **2:22–2:27 — Open the lineage.** Begin on the selected planning concept in
   Blueprint Live. Click **Trace decision** and wait until the loading state has
   completely resolved before moving the cursor.
2. **2:27–2:38 — Scan design into evidence.** Move slowly down the ordered
   chain. Keep **Source moment**, **Concept**, **Teaching clip**, **Assessment**,
   **Learner evidence**, and **Route event** readable. Do not click individual
   stages; the ordered list is the visual.
3. **2:38–2:45 — Pause on the institutional response.** If present, hold
   **Dashboard signal** and **Proposed revision** together in view. This is the
   payoff: the learner route, instructor alert, and proposed course change are
   connected by persisted evidence.
4. **2:45–2:48 — Show the trust boundary.** End the trace shot with either the
   footer—**Missing steps are never inferred**—or a visible **Not yet** stage.
   Do not hide a gap with a crop.

The persisted chain is:

```text
source moment → concept → teaching clip → assessment
→ learner evidence → route event → dashboard signal → proposed revision
```

Suggested voice-over when the complete chain is available:

> **2:22–2:27 — Open Trace decision:** “Back in the instructor view, Trace
> decision reconstructs that route from stored records.”
>
> **2:27–2:38 — Scan source through route:** “It connects the lecture moment and
> teaching design to the learner evidence that changed the path.”
>
> **2:38–2:45 — Hold signal and proposal:** “The same chain shows why the
> instructor was alerted and what evidence supports the proposed revision.”
>
> **2:45–2:48 — End on the trust boundary:** “If a record is missing, Manifold
> says so—nothing is invented.”

Honest-gap replacement for **2:38–2:48** when the final stages show **Not yet**:

> “Here, the learner evidence and route are persisted, but no evidence-linked
> course proposal exists yet. Manifold marks that gap instead of inventing a
> causal story.”

This is the most differentiating part of the demo.

## 2:48–3:00 — Close

Close **Trace decision**, clear the concept focus by clicking the empty canvas,
and end on the fitted Blueprint in Live mode. Keep Course Director closed and
do not publish during this shot. Hold the complete map for the full closing
line; a gentle editorial push-in is fine, but do not move or zoom the graph with
the cursor.

Suggested voice-over:

> “One lecture becomes a structured mastery course. Each learner gets a path
> based on evidence. Every AI-proposed course improvement stays traceable and
> instructor-reviewed.”

If using a final title card, place a small **Manifold** wordmark and the phrase
**Adaptive learning, with every decision traceable** over the held Blueprint.
Use measured build/evaluation figures only as small supporting captions; omit
them entirely if they compete with the three-clause close. Do not add a feature
list, dashboard montage, or second call to action in these final twelve seconds.

## Recording setup

- Run the deterministic competition reset immediately before recording.
- Use the licensed competition course only; hide stale and untitled courses.
- Start the learner immediately before the misconception question.
- Keep the cursor deliberate and avoid navigation, settings, or empty states.
- Keep the graph visible beneath overlays whenever possible.
- Use Live mode except for an explicit manual design edit.
- Do not describe seeded history as a real learner cohort.
- Do not claim learning-outcome improvements until a real study measures them.
- Record one uninterrupted browser path; use editing only to tighten pauses.
