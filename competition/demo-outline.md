# Three-minute competition demo outline

The video should make one argument: **Manifold turns one instructor's recording
into an adaptive course that can explain and improve itself without removing the
instructor from control.**

## 0:00–0:20 — The gap

Open with the linear-video problem, not the feature list. One recording gives
every learner the same path. Building a responsible adaptive version normally
requires multiple specialist roles, while autonomous AI authoring loses
accountability.

Show the source recording and one sentence:

> “The missing product is not another course generator. It is the governed loop
> from real teaching to learner evidence and back to a reviewed course revision.”

## 0:20–0:55 — Compile the teaching system

Show the measured result from the clean competition course:

- the source becomes four to six concepts;
- one real prerequisite is visible;
- reviewed clips and assessments attach to those concepts;
- the private/review state is obvious.

Use the measured compilation evidence as a brief overlay: review-ready in 213.91
seconds and $0.1951 token cost for the recorded disposable run. Say explicitly
that this is asynchronous wall time, not instructor review time.

## 0:55–1:25 — Human governance

Switch to Design and open one AI proposal. Show `Accept / Edit / Dismiss`, then
show that the change remains private until publication. This is the central trust
mechanism, not administrative chrome.

The spoken point:

> “AI can do substantial work, but it cannot silently become the instructor.”

## 1:25–2:05 — One learner, one interpretable route

Use the seeded learner history:

1. learner answers the misconception-revealing assessment;
2. confidence makes the evidence more informative;
3. a deterministic route sends them to the alternate explanation/remediation;
4. the reason is visible in plain language.

Do not show several learner paths. One crisp route is more persuasive.

## 2:05–2:40 — Trace the closed loop

Open **Trace decision** and scan the complete chain:

```text
source moment → concept → teaching clip → assessment
→ learner evidence → route event → dashboard signal → proposed revision
```

Pause on the dashboard signal and proposed revision. Emphasize that every
available step is a persisted record and missing evidence is shown honestly.

This is the most differentiating 35 seconds of the video.

## 2:40–3:00 — Evidence and trajectory

End with three measured facts:

- 294 reported automated tests passed;
- warm p95 was 29.43 ms for the decision trace;
- the real generation run recovered from a persisted clip failure and still
  reached review-ready state.

Close with the honest next step: time a real instructor review and run a matched
manual-authoring comparison, then validate learning outcomes with real learners.

## Recording rules

- Use one deterministic reset state and one browser path.
- Keep the cursor deliberate; avoid touring navigation or settings.
- Do not describe seeded history as a real cohort.
- Do not claim the under-60-minute instructor target until the timed review exists.
- Leave the graph visible whenever possible; panels should open over it and close
  quickly.
- Use captions for the eight trace stages and measured figures.
