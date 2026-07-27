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
  const guideMessages: Array<Record<string, unknown>> = [];

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
    if (path === "/learn/courses/course-1/guide/messages") {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: guideMessages });
      }
      const request = route.request().postDataJSON() as { content: string };
      const createdAt = "2026-07-26T00:00:00Z";
      const learnerMessage = {
        id: `guide-${guideMessages.length + 1}`,
        role: "learner",
        content: request.content,
        intent: null,
        action: null,
        created_at: createdAt,
      };
      const stuck = request.content.toLowerCase().includes("stuck");
      const guideMessage = {
        id: `guide-${guideMessages.length + 2}`,
        role: "guide",
        content: stuck
          ? "I can prepare an evidence-backed help request for your course team."
          : "Vector direction is recommended because its prerequisites and reviewed coverage are complete.",
        intent: stuck ? "stuck" : "why_next",
        action: stuck ? "stuck" : null,
        created_at: createdAt,
      };
      guideMessages.push(learnerMessage, guideMessage);
      return route.fulfill({ json: [learnerMessage, guideMessage] });
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
      const request = route.request().postDataJSON() as Record<string, unknown>;
      expect(request.mode).toBe("continue_path");
      expect(request).not.toHaveProperty("budget_minutes");
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
  await expect(
    page.locator("[class*='planStage']").getByText("Learning Assistant", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Learn: Vector direction")).toBeVisible();
  await expect(page.getByText("Practice: Vector direction")).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();

  await expect(
    page.getByRole("heading", { name: "Vector direction", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  const sessionHeaderBounds = await page
    .locator("[class*='sessionHeader']")
    .boundingBox();
  const playerBounds = await page.locator("[class*='player']").boundingBox();
  expect(sessionHeaderBounds).not.toBeNull();
  expect(playerBounds).not.toBeNull();
  expect(Math.abs(sessionHeaderBounds!.width - playerBounds!.width)).toBeLessThanOrEqual(2);
  const mediaBounds = await page
    .locator("[class*='player'] > .clipPreview")
    .boundingBox();
  expect(mediaBounds).not.toBeNull();
  expect(Math.abs(mediaBounds!.height - playerBounds!.height)).toBeLessThanOrEqual(2);
  expect(mediaBounds!.width / mediaBounds!.height).toBeCloseTo(16 / 9, 2);
  expect(mediaBounds!.height).toBeGreaterThan(mediaBounds!.width / 2);
  await expect(page.getByText("Practice with an approved question")).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeInViewport();
  const continueBounds = await continueButton.boundingBox();
  expect(continueBounds).not.toBeNull();
  expect(continueBounds!.y + continueBounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  const sessionRail = page.getByLabel("Active study plan");
  await expect(sessionRail.getByRole("progressbar", { name: "Session progress" }))
    .toHaveAttribute("aria-valuenow", "1");
  await expect(sessionRail.getByRole("progressbar", { name: "Session progress" }))
    .toHaveAttribute("aria-valuemax", "3");
  await expect(sessionRail.locator("[aria-current='step']")).toContainText("Learn");
  await expect(sessionRail.locator("[aria-current='step']")).toContainText("Now");
  await expect(sessionRail.getByText("This plan adapts as you learn")).toBeVisible();

  await expect(page.locator(".lucide-sparkles")).toHaveCount(0);
  await page.getByRole("button", { name: "Open Learning Assistant" }).click();
  const assistant = page.getByLabel("Learning Assistant");
  await expect(assistant.getByText("Right now:")).toBeVisible();
  await expect(assistant.getByText("Vector direction")).toBeVisible();
  const statusBounds = await assistant.locator("[class*='guideStatus']").boundingBox();
  expect(statusBounds?.height).toBeLessThanOrEqual(48);
  await expect(assistant.getByText("Learning Guide", { exact: false })).toHaveCount(0);
  await page
    .getByRole("button", { name: /Why is this my next lesson/ })
    .click();
  await expect(page.getByText("prerequisites and reviewed coverage")).toBeVisible();
  const learnerMessageBounds = await assistant
    .locator("[data-role='learner']")
    .last()
    .locator("> div")
    .boundingBox();
  const assistantMessageBounds = await assistant
    .locator("[data-role='guide']")
    .last()
    .locator("> div")
    .boundingBox();
  expect(learnerMessageBounds).not.toBeNull();
  expect(assistantMessageBounds).not.toBeNull();
  expect(learnerMessageBounds!.x).toBeGreaterThan(assistantMessageBounds!.x);
  await page.getByRole("button", { name: "Close Learning Assistant" }).click();

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
  await expect(sessionRail.getByRole("progressbar", { name: "Session progress" }))
    .toHaveAttribute("aria-valuenow", "2");
  await expect(sessionRail.locator("[aria-current='step']")).toContainText("Practice");
  await expect(sessionRail.locator("[aria-current='step']")).toContainText("Now");
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
    page.getByRole("status").getByText(
      "The answer missed direction, so a reviewed recovery clip is next.",
    ),
  ).toBeVisible();
  await expect(sessionRail.getByText("Plan updated from your evidence")).toBeVisible();
  await expect(sessionRail).toContainText(
    "The answer missed direction, so a reviewed recovery clip is next.",
  );
  await expect(page.locator("video")).toBeVisible();
  await page.getByRole("button", { name: "Change learning mode" }).click();
  const modeChooser = page.getByLabel("Change learning mode");
  await expect(
    modeChooser.getByRole("button", { name: /Strengthen weak areas/ }),
  ).toBeEnabled();
  await expect(
    modeChooser.getByText("Learning Assistant", { exact: true }),
  ).toHaveCount(0);
  await modeChooser
    .getByRole("button", { name: /Strengthen weak areas/ })
    .click();
  await expect(
    page.getByLabel("Active study plan").getByText("Strengthen weak areas"),
  ).toBeVisible();

  const masteryButton = page.getByRole("button", { name: "Mastery" });
  await expect(masteryButton.locator(".lucide-book-open")).toBeVisible();
  await masteryButton.click();
  const mastery = page.getByLabel("Course mastery and review");
  await expect(
    mastery.getByRole("heading", { name: "Mastery Map", exact: true }),
  ).toBeVisible();
  await expect(mastery.getByText("Recommended", { exact: true })).toHaveCount(0);
  await expect(mastery.getByText("Solid = prerequisite")).toHaveCount(0);
  await expect(mastery.getByText("Recent path changes")).toHaveCount(0);
  await expect(mastery.locator("header .lucide-book-open")).toBeVisible();
  const masteryBounds = await mastery.boundingBox();
  expect(masteryBounds).not.toBeNull();
  expect(masteryBounds!.width / page.viewportSize()!.width).toBeLessThanOrEqual(0.6);
  await expect(mastery.getByTestId("mastery-map")).toBeVisible();
  await expect(mastery.locator(".react-flow__node")).toHaveCount(4);
  await expect(mastery.locator(".react-flow__edge")).toHaveCount(5);
  await expect(
    mastery.locator(".react-flow__edge").filter({ hasText: "Support route" }),
  ).toHaveCount(1);
  await expect.poll(async () => {
    const canvasBounds = await mastery.getByTestId("mastery-map").boundingBox();
    const nodeBounds = await mastery.locator(".react-flow__node").evaluateAll(
      (nodes) => nodes.map((node) => {
        const bounds = node.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        };
      }),
    );
    if (!canvasBounds) return 0;
    return nodeBounds.filter((bounds) => (
      bounds.right > canvasBounds.x
      && bounds.left < canvasBounds.x + canvasBounds.width
      && bounds.bottom > canvasBounds.y
      && bounds.top < canvasBounds.y + canvasBounds.height
    )).length;
  }).toBeGreaterThanOrEqual(3);
  await expect(
    mastery.getByRole("button", { name: /Review recommended.*Vector direction/ }),
  ).toBeInViewport();
  await expect(
    mastery.getByRole("button", { name: /Review recommended.*Vector direction/ }),
  ).toBeVisible();
  await mastery.getByRole("button", {
    name: /Review recommended.*Vector direction.*Route changed.*Support route/,
  }).click();
  await expect(mastery.getByText("Why this route changed")).toBeVisible();
  await expect(mastery.getByText("A reviewed recovery clip is next.")).toBeVisible();
  await expect(
    mastery.getByText("Evidence moved from Practiced to Struggling."),
  ).toBeVisible();
  await mastery.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await expect(mastery.getByText("Why this route changed")).toHaveCount(0);
  await expect(
    mastery.getByText(
      "Select a concept to inspect its evidence and available next action.",
    ),
  ).toBeVisible();
  const mapHintBounds = await mastery.getByText(
    "Select a concept to inspect its evidence and available next action.",
  ).boundingBox();
  const mapCanvasBounds = await mastery.getByTestId("mastery-map").boundingBox();
  expect(mapHintBounds).not.toBeNull();
  expect(mapCanvasBounds).not.toBeNull();
  expect(mapHintBounds!.y + mapHintBounds!.height).toBeLessThanOrEqual(
    mapCanvasBounds!.y + mapCanvasBounds!.height,
  );
  const blocked = mastery.getByRole("button", {
    name: /Blocked.*Net force/,
  });
  await blocked.click();
  await expect(
    mastery.getByText(/will not substitute another topic’s content/),
  ).toBeVisible();
  const blockedNode = blocked.locator("xpath=ancestor::article");
  await expect(blockedNode).toHaveAttribute("data-selected", "true");
  expect(await blockedNode.evaluate((node) => getComputedStyle(node).boxShadow))
    .not.toBe("none");
  await mastery.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await expect(
    mastery.getByText(/will not substitute another topic’s content/),
  ).toHaveCount(0);
  const masteryAccessibility = await new AxeBuilder({ page })
    .include("[aria-label='Course mastery and review']")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(masteryAccessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Close mastery" }).click();

  await page.getByRole("button", { name: "Open Learning Assistant" }).click();
  await page.getByLabel("Message Learning Assistant").fill("I’m stuck.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Review help request" }).click();
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
      {
        concept_id: "concept-3",
        name: "Vector components",
        description: "Resolve vectors across axes",
        sequence_rank: 3,
        state: "not_started",
        topic_id: "topic-1",
        topic_title: "Vector direction",
        prerequisite_ids: ["concept-1"],
        clip_ids: ["clip-1"],
        question_ids: ["question-1"],
        aids: [],
        eligible: true,
        actionable: true,
        coverage_state: "complete",
        current: false,
      },
      {
        concept_id: "concept-4",
        name: "Resultant motion",
        description: "Combine force and component evidence",
        sequence_rank: 4,
        state: "not_started",
        topic_id: "topic-1",
        topic_title: "Vector direction",
        prerequisite_ids: ["concept-2", "concept-3"],
        clip_ids: ["clip-1"],
        question_ids: ["question-1"],
        aids: [],
        eligible: false,
        actionable: true,
        coverage_state: "complete",
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
        {
          concept_id: "concept-3",
          name: "Vector components",
          state: "not_started",
          access_state: "ready",
          coverage_state: "complete",
          due_at: null,
          mismatch: null,
        },
        {
          concept_id: "concept-4",
          name: "Resultant motion",
          state: "not_started",
          access_state: "blocked",
          coverage_state: "complete",
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
                concept_id: "concept-3",
                target_concept_id: "concept-1",
                mastery_before: "practiced",
                mastery_after: "struggling",
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
