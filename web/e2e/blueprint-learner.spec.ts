import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pipeline = "http://localhost:8000";
const learner = {
  id: "11111111-1111-4111-8111-111111111112",
  display_name: "Brian",
  role: "learner",
};

test("agentic learner loop plans, acts on evidence, adapts, and requests help", async ({
  page,
}) => {
  let orientationComplete = false;
  let phase: "none" | "planned" | "watch" | "question" | "remediation" = "none";
  let masteryState: "not_started" | "struggling" = "not_started";
  let helpCreated = false;

  await page.addInitScript((identity) => {
    window.localStorage.setItem(
      "manifold.development-session",
      JSON.stringify(identity),
    );
    window.localStorage.setItem("manifold.learner-id", identity.id);
  }, learner);

  await page.route(`${pipeline}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/learners/me/courses/course-1") {
      return route.fulfill({
        json: {
          id: "course-1",
          title: "Vector Foundations",
          description: "A reviewed adaptive mechanics course.",
          units: [
            {
              id: "unit-1",
              logical_id: "lecture-1",
              kind: "lecture",
              title: "Vector language",
              summary: "",
              instructions: "",
              video_id: "video-1",
              sequence_rank: 1,
              status: "in_progress",
              topic_ids: ["topic-1"],
              question_count: 1,
            },
          ],
          topics: [
            {
              id: "topic-1",
              video_id: "video-1",
              title: "Vector direction",
              summary: "Use magnitude and direction together.",
            },
          ],
          clips: [
            {
              id: "clip-1",
              topic_id: "topic-1",
              video_id: "video-1",
              title: "Vector direction",
              start_seconds: 10,
              end_seconds: 42,
              type: "explanation",
              difficulty: "introductory",
              playback_provider: "local",
              playback_id: null,
              playback_url: "/videos/video-1/media",
              delivery_asset_id: null,
              materialization_status: "source_reference",
            },
          ],
          questions: [
            {
              id: "question-1",
              topic_id: "topic-1",
              body: "What makes a vector different from a scalar?",
              type: "short_answer",
              choices: [],
              confidence_prompt: "How confident are you?",
            },
          ],
          resources: [
            {
              id: "resource-1",
              filename: "Vector notes.pdf",
              source_type: "pdf",
              size_bytes: 2400,
            },
          ],
        },
      });
    }
    if (path === "/learners/me/courses/course-1/path") {
      return route.fulfill({ json: learnerPath(masteryState) });
    }
    if (path === "/learn/courses/course-1/workspace") {
      return route.fulfill({
        json: workspace(orientationComplete, phase, masteryState),
      });
    }
    if (path === "/learn/courses/course-1/orientation") {
      orientationComplete = true;
      return route.fulfill({
        json: {
          completed: true,
          entry_choice: "recommended",
        },
      });
    }
    if (path === "/learn/courses/course-1/sessions") {
      phase = "planned";
      return route.fulfill({ json: studySession("planned", "pending") });
    }
    if (path === "/learn/courses/course-1/sessions/session-1/start") {
      phase = "watch";
      return route.fulfill({ json: studySession("active", "watch") });
    }
    if (path === "/learn/courses/course-1/sessions/session-1/plan") {
      const request = route.request().postDataJSON() as { mode?: string };
      return route.fulfill({
        json: remediationSession(
          request.mode === "strengthen_weak_areas"
            ? "strengthen_weak_areas"
            : "continue_path",
        ),
      });
    }
    if (path.endsWith("/steps/watch-1/watch")) {
      phase = "question";
      return route.fulfill({ json: studySession("active", "question") });
    }
    if (path.endsWith("/steps/question-1/answer")) {
      phase = "remediation";
      masteryState = "struggling";
      return route.fulfill({
        json: {
          session: remediationSession(),
          correct: false,
          feedback: "Direction is essential.",
          route: {
            action: "remediate",
            mastery_state: "struggling",
            why: "The answer missed direction, so a reviewed recovery clip is next.",
            target_concept_id: "concept-1",
            target_clip_id: "clip-1",
          },
        },
      });
    }
    if (path === "/learn/courses/course-1/clips/clip-1/transcript") {
      return route.fulfill({
        json: {
          clip_id: "clip-1",
          duration_seconds: 32,
          timing_basis: "clip_relative",
          words: [
            { text: "Vector", start_seconds: 0, end_seconds: 0.8 },
            { text: "direction", start_seconds: 0.8, end_seconds: 1.7 },
            { text: "combines", start_seconds: 1.7, end_seconds: 2.4 },
            { text: "magnitude", start_seconds: 2.4, end_seconds: 3.2 },
          ],
        },
      });
    }
    if (path === "/learn/courses/course-1/guide/why_next") {
      return route.fulfill({
        json: {
          kind: "evidence",
          title: "Why this lesson?",
          message:
            "Vector direction is ready because its prerequisites and reviewed coverage are complete.",
        },
      });
    }
    if (path === "/learn/courses/course-1/help/preview") {
      return route.fulfill({
        json: {
          course: "Vector Foundations",
          concept: "Vector direction",
          current_activity: {
            kind: "watch",
            title: "Vector direction",
          },
          recent_attempts: [
            {
              question: "What makes a vector different from a scalar?",
              correct: false,
              confidence: 2,
            },
          ],
          recent_routes: [
            {
              action: "remediate",
              reason: "A reviewed recovery clip is next.",
            },
          ],
        },
      });
    }
    if (path === "/learn/courses/course-1/help") {
      helpCreated = true;
      return route.fulfill({
        json: {
          id: "help-1",
          status: "open",
          learner_note: "Direction still feels unclear.",
          evidence: {},
          created_at: "2026-07-26T00:00:00Z",
        },
      });
    }
    if (path.endsWith("/watch-events")) {
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 404, json: { detail: "Not mocked" } });
  });

  await page.goto("/learn/courses/course-1");
  await expect(
    page.getByRole("heading", {
      name: "Start Vector Foundations with the right path.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Continue with the recommended path/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "How would you like to learn?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Review what I learned/ }),
  ).toBeDisabled();
  await expect(page.getByText(/available after you have practiced/)).toBeVisible();
  await expect(page.getByText(/minute/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Learn something new/ }).click();
  await expect(
    page.getByRole("button", { name: /Learn something new/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Continue my path/ }).click();
  await page.getByRole("button", { name: "Prepare this learning loop" }).click();
  await expect(
    page.getByRole("heading", { name: "Continue my path" }),
  ).toBeVisible();
  await expect(page.getByText("Learn: Vector direction")).toBeVisible();
  await expect(page.getByText("Practice: Vector direction")).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();

  await expect(
    page.getByRole("heading", { name: "Vector direction", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.getByText("Practice with an approved question")).toBeVisible();

  await page.getByRole("button", { name: "Learning Guide" }).click();
  await page
    .getByRole("button", { name: /Why is this my next lesson/ })
    .click();
  await expect(page.getByText("prerequisites and reviewed coverage")).toBeVisible();
  await page.getByRole("button", { name: "Close Learning Guide" }).click();

  await page.getByText("Transcript", { exact: true }).click();
  await expect(page.getByLabel("Clip transcript")).toContainText(
    "Vector direction combines magnitude",
  );
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 10.4,
    });
    video.dispatchEvent(new Event("timeupdate"));
  });
  await expect(
    page.getByLabel("Clip transcript").locator("[data-active]"),
  ).toHaveText("Vector");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "What makes a vector different from a scalar?",
    }),
  ).toBeVisible();
  await page.getByLabel("Your answer").fill("It has magnitude");
  await page.getByRole("button", { name: "Unsure" }).click();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Your plan adjusted")).toBeVisible();
  await expect(
    page.getByText(
      "The answer missed direction, so a reviewed recovery clip is next.",
    ),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  await page.getByRole("button", { name: "Change learning mode" }).click();
  const modeChooser = page.getByLabel("Change learning mode");
  await expect(
    modeChooser.getByRole("button", { name: /Strengthen weak areas/ }),
  ).toBeEnabled();
  await modeChooser
    .getByRole("button", { name: /Strengthen weak areas/ })
    .click();
  await expect(
    page.getByLabel("Active study plan").getByText("Strengthen weak areas"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Mastery" }).click();
  const mastery = page.getByLabel("Course mastery and review");
  await expect(
    mastery.getByRole("button", { name: /Review recommended.*Vector direction/ }),
  ).toBeVisible();
  const blocked = mastery.getByRole("button", {
    name: /Blocked.*Net force/,
  });
  await blocked.click();
  await expect(
    mastery.getByText(/will not substitute another topic’s content/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close mastery" }).click();

  await page.getByRole("button", { name: "Learning Guide" }).click();
  await page.getByRole("button", { name: "I’m stuck" }).click();
  await expect(page.getByText("Here’s what will be shared")).toBeVisible();
  await page
    .getByLabel("Optional note for your course team")
    .fill("Direction still feels unclear.");
  await page.getByRole("button", { name: "Send to course team" }).click();
  await expect(
    page.getByText("Your course team has been notified in Manifold."),
  ).toBeVisible();
  expect(helpCreated).toBe(true);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

function learnerPath(state: "not_started" | "struggling") {
  return {
    course_id: "course-1",
    revision_id: "revision-1",
    current_concept_id: "concept-1",
    last_route_action: state === "struggling" ? "remediate" : null,
    last_route_why:
      state === "struggling"
        ? "The answer missed direction, so a reviewed recovery clip is next."
        : null,
    items: [
      {
        concept_id: "concept-1",
        name: "Vector direction",
        description: "Magnitude plus direction",
        sequence_rank: 1,
        state,
        topic_id: "topic-1",
        topic_title: "Vector direction",
        prerequisite_ids: [],
        clip_ids: ["clip-1"],
        question_ids: ["question-1"],
        aids: [
          {
            source_id: "source-1",
            title: "Vector notes",
            page_number: 2,
            excerpt: "Direction is part of the vector definition.",
          },
        ],
        eligible: true,
        actionable: true,
        coverage_state: "complete",
        current: true,
      },
      {
        concept_id: "concept-2",
        name: "Net force",
        description: "Combine vectors",
        sequence_rank: 2,
        state: "not_started",
        topic_id: "topic-1",
        topic_title: "Vector direction",
        prerequisite_ids: ["concept-1"],
        clip_ids: [],
        question_ids: [],
        aids: [],
        eligible: false,
        actionable: false,
        coverage_state: "missing_both",
        current: false,
      },
    ],
  };
}

function workspace(
  oriented: boolean,
  currentPhase: string,
  state: "not_started" | "struggling",
) {
  return {
    revision_id: "revision-1",
    orientation: {
      completed: oriented,
      entry_choice: oriented ? "recommended" : null,
    },
    modes: learningModes(state),
    session:
      currentPhase === "none"
        ? null
        : currentPhase === "planned"
          ? studySession("planned", "pending")
          : currentPhase === "watch"
            ? studySession("active", "watch")
            : currentPhase === "question"
              ? studySession("active", "question")
              : remediationSession(),
    placement: null,
    mastery: {
      concepts: [
        {
          concept_id: "concept-1",
          name: "Vector direction",
          state,
          access_state: "ready",
          coverage_state: "complete",
          due_at: null,
          mismatch: state === "struggling" ? "Confident answer needs review" : null,
        },
        {
          concept_id: "concept-2",
          name: "Net force",
          state: "not_started",
          access_state: "blocked",
          coverage_state: "missing_both",
          due_at: null,
          mismatch: null,
        },
      ],
      recent_routes:
        state === "struggling"
          ? [
              {
                action: "remediate",
                explanation: "A reviewed recovery clip is next.",
                created_at: "2026-07-26T00:00:00Z",
              },
            ]
          : [],
    },
    guide_actions: [
      "why_next",
      "replay",
      "approved_source",
      "quiz",
      "stuck",
      "change_mode",
      "finish_session",
    ],
    content_message: null,
  };
}

function learningModes(state: "not_started" | "struggling") {
  return [
    {
      key: "continue_path",
      title: "Continue my path",
      description: "Resume Manifold’s strongest reviewed next step.",
      available: true,
      recommended: state === "not_started",
      reason:
        state === "not_started"
          ? "This is the strongest reviewed next step in your path."
          : null,
      disabled_reason: null,
    },
    {
      key: "learn_new",
      title: "Learn something new",
      description: "Begin an eligible concept you have not studied yet.",
      available: true,
      recommended: false,
      reason: null,
      disabled_reason: null,
    },
    {
      key: "strengthen_weak_areas",
      title: "Strengthen weak areas",
      description: "Repair uncertainty or recent difficulty.",
      available: state === "struggling",
      recommended: state === "struggling",
      reason:
        state === "struggling"
          ? "Recent correctness, confidence, or routing evidence shows uncertainty."
          : null,
      disabled_reason:
        state === "struggling"
          ? null
          : "This becomes available when attempts show difficulty.",
    },
    {
      key: "review_learned",
      title: "Review what I learned",
      description: "Retrieve practiced material.",
      available: false,
      recommended: false,
      reason: null,
      disabled_reason:
        "This becomes available after you have practiced reviewed course material.",
    },
  ];
}

function studySession(status: "planned" | "active", active: "pending" | "watch" | "question") {
  return {
    id: "session-1",
    course_id: "course-1",
    revision_id: "revision-1",
    status,
    mode: "continue_path",
    finish_requested: false,
    plan_version: 1,
    steps: [
      sessionStep("watch-1", 0, "watch", active === "watch" ? "active" : active === "question" ? "completed" : "pending"),
      sessionStep("question-1", 1, "question", active === "question" ? "active" : "pending"),
      sessionStep("reflect-1", 2, "reflect", "pending"),
    ],
  };
}

function remediationSession(
  mode: "continue_path" | "strengthen_weak_areas" = "continue_path",
) {
  return {
    id: "session-1",
    course_id: "course-1",
    revision_id: "revision-1",
    status: "active",
    mode,
    finish_requested: false,
    plan_version: 2,
    steps: [
      {
        ...sessionStep("watch-2", 0, "watch", "active"),
        purpose: "remediation",
        reason:
          "Repair the reviewed foundation for Vector direction.",
      },
      {
        ...sessionStep("question-2", 1, "question", "pending"),
        purpose: "remediation",
      },
      sessionStep("reflect-2", 2, "reflect", "pending"),
    ],
  };
}

function sessionStep(
  id: string,
  ordinal: number,
  kind: "watch" | "question" | "reflect",
  status: "pending" | "active" | "completed",
) {
  return {
    id,
    ordinal,
    kind,
    purpose: kind === "watch" ? "learn" : kind === "question" ? "practice" : "reflect",
    concept_id: "concept-1",
    concept_name: "Vector direction",
    clip_id: kind === "watch" ? "clip-1" : null,
    question_id: kind === "question" ? "question-1" : null,
    source_id: null,
    title:
      kind === "watch"
        ? "Vector direction"
        : kind === "question"
          ? "What makes a vector different from a scalar?"
          : "Reflect on this session",
    reason_code:
      kind === "watch"
        ? "recommended_current"
        : kind === "question"
          ? "practice_after_watch"
          : "session_reflection",
    reason:
      kind === "watch"
        ? "Continue with Vector direction, your strongest reviewed next step."
        : kind === "question"
          ? "Check your understanding with an approved question."
          : "Capture what feels clear and what still needs support.",
    status,
  };
}
