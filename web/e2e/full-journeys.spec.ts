import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const pipeline = "http://localhost:8000";
const instructorId = "10000000-0000-4000-8000-000000000001";
const learnerId = "10000000-0000-4000-8000-000000000002";
const courseId = "20000000-0000-4000-8000-000000000001";
const videoId = "30000000-0000-4000-8000-000000000001";

export async function routeDevelopmentContext(page: Page) {
  await page.route(`${pipeline}/development/identities`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: instructorId,
          email: "dev-instructor@coursefoundry.local",
          display_name: "Dev Instructor",
          role: "instructor",
        },
        {
          id: learnerId,
          email: "dev-learner@coursefoundry.local",
          display_name: "Dev Learner",
          role: "learner",
        },
      ]),
    }),
  );
  await page.route(`${pipeline}/videos/delivery/capacity`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: "mux",
        stored_count: 9,
        max_stored: 10,
        remaining: 1,
        can_upload: true,
      }),
    }),
  );
}

export async function routeReviewedCourse(
  page: Page,
  readinessSequence: Array<{ course_id: string; ready: boolean; blockers: string[] }> = [
    { course_id: courseId, ready: true, blockers: [] },
  ],
) {
  let status: "draft" | "published" = "draft";
  let enrolled = false;
  let signalOpen = true;
  let readinessRequest = 0;

  await page.route(`${pipeline}/videos/url`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "40000000-0000-4000-8000-000000000001",
        video_id: videoId,
        course_id: courseId,
        source_kind: "url",
        source_uri: "https://example.com/lecture.mp4",
        status: "complete",
        progress: 100,
        error_message: null,
      }),
    }),
  );
  await page.route(`${pipeline}/videos/demo`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "40000000-0000-4000-8000-000000000001",
        video_id: videoId,
        course_id: courseId,
        source_kind: "upload",
        source_uri: "/app/demo/test_video.mp4",
        status: "complete",
        progress: 100,
        error_message: null,
      }),
    }),
  );
  await page.route(`${pipeline}/videos/jobs/*`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "40000000-0000-4000-8000-000000000001",
        video_id: videoId,
        course_id: courseId,
        source_kind: "url",
        source_uri: "https://example.com/lecture.mp4",
        status: "complete",
        progress: 100,
        error_message: null,
      }),
    }),
  );
  await page.route(`${pipeline}/videos/${videoId}/transcript`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        text: "Vectors have magnitude and direction.",
        words: [
          { text: "Vectors", start_seconds: 0, end_seconds: 0.5 },
          { text: "have", start_seconds: 0.5, end_seconds: 0.8 },
          { text: "magnitude", start_seconds: 0.8, end_seconds: 1.4 },
          { text: "and", start_seconds: 1.4, end_seconds: 1.6 },
          { text: "direction.", start_seconds: 1.6, end_seconds: 2.2 },
        ],
      }),
    }),
  );
  await page.route(`${pipeline}/videos/${videoId}/topics`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([topic]) }),
  );
  await page.route(`${pipeline}/videos/${videoId}/clips`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([clip]) }),
  );
  await page.route(`${pipeline}/videos/${videoId}/questions`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([question]) }),
  );
  await page.route(`${pipeline}/videos/${videoId}/playback`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: "local",
        playback_id: "lecture.mp4",
        playback_url: `/videos/${videoId}/media`,
        delivery_asset_id: null,
      }),
    }),
  );
  await page.route(`${pipeline}/videos/${videoId}/captions.vtt`, (route) =>
    route.fulfill({
      contentType: "text/vtt",
      body: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.200\nVectors have magnitude and direction.\n",
    }),
  );
  await page.route(`${pipeline}/videos/${videoId}/media`, (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route(`${pipeline}/courses/${courseId}/graph`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(graph) }),
  );
  await page.route(`${pipeline}/courses/${courseId}/routing/policies`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(graph.concepts.map((concept) => ({
        concept_id: concept.id,
        confidence_threshold: 3,
        correct_attempts_for_mastery: 1,
        advancement_mode: "require_mastery",
        max_remediation_attempts: 2,
      }))),
    }),
  );
  await page.route(`${pipeline}/courses/${courseId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: courseId,
        instructor_id: instructorId,
        title: "Vector Foundations",
        description: null,
        status,
        published_at: status === "published" ? "2026-07-12T00:00:00Z" : null,
      }),
    }),
  );
  await page.route(`${pipeline}/courses/${courseId}/publish-readiness`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        readinessSequence[Math.min(readinessRequest++, readinessSequence.length - 1)],
      ),
    }),
  );
  await page.route(`${pipeline}/courses/${courseId}/publish`, (route) => {
    status = "published";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: courseId,
        instructor_id: instructorId,
        title: "Vector Foundations",
        description: null,
        status,
        published_at: "2026-07-12T00:00:00Z",
      }),
    });
  });
  await page.route(`${pipeline}/courses/${courseId}/enrollment`, (route) => {
    if (route.request().method() === "POST") enrolled = true;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ enrolled }),
    });
  });
  await page.route(`${pipeline}/learners/${learnerId}/courses/${courseId}/progress`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { concept_id: graph.concepts[0].id, name: "Vectors", state: "not_started", topic_id: topic.id },
      ]),
    }),
  );
  await page.route(`${pipeline}/learners/${learnerId}/questions/*/attempt`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        action: "advance",
        mastery_state: "practiced",
        why: "Correct and confident; advance to the next eligible concept.",
        target_concept_id: graph.concepts[0].id,
        target_clip_id: null,
        dashboard_signal_id: null,
      }),
    }),
  );
  await page.route(`${pipeline}/questions/*/grade`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ is_correct: true, feedback: "Correct.", wrong_answer_pattern: null }),
    }),
  );
  await page.route(`${pipeline}/courses/${courseId}/watch-events`, (route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "event-1" }) }),
  );
  await page.route(`${pipeline}/courses/${courseId}/dashboard`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        course_id: courseId,
        learner_count: 12,
        attempt_count: 80,
        not_enough_data: false,
        signals: signalOpen ? [dashboardSignal] : [],
        concept_performance: [
          { concept_id: "concept-1", concept_name: "Core model", touched_learners: 10, struggling_learners: 2, mastered_prerequisite_struggling_learners: 0 },
          { concept_id: "concept-2", concept_name: "Applied decision", touched_learners: 7, struggling_learners: 1, mastered_prerequisite_struggling_learners: 0 },
          { concept_id: "concept-3", concept_name: "Advanced transfer", touched_learners: 4, struggling_learners: 2, mastered_prerequisite_struggling_learners: 1 },
        ],
        question_performance: [
          { question_id: "question-1", topic_id: "topic-1", prompt: "Which principle should be applied first?", attempts: 42, incorrect_attempts: 8, low_confidence_correct_attempts: 6 },
          { question_id: "question-2", topic_id: "topic-2", prompt: "How does the example change the decision?", attempts: 25, incorrect_attempts: 3, low_confidence_correct_attempts: 4 },
          { question_id: "question-3", topic_id: "topic-3", prompt: "What evidence supports the final step?", attempts: 13, incorrect_attempts: 1, low_confidence_correct_attempts: 2 },
        ],
        clip_performance: [],
        activity_history: [
          { date: "2026-07-15", attempts: 4, active_learners: 2 },
          { date: "2026-07-16", attempts: 9, active_learners: 4 },
          { date: "2026-07-17", attempts: 6, active_learners: 3 },
          { date: "2026-07-18", attempts: 15, active_learners: 7 },
          { date: "2026-07-19", attempts: 18, active_learners: 8 },
          { date: "2026-07-20", attempts: 28, active_learners: 10 },
        ],
        mastery_distribution: { mastered: 18, practiced: 11, struggling: 5, not_started: 14 },
      }),
    }),
  );
  await page.route(`${pipeline}/dashboard/signals/${dashboardSignal.id}/accept`, (route) => {
    signalOpen = false;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...dashboardSignal, status: "accepted" }),
    });
  });
}

test("publishing checklist refreshes after reviewed artifacts load", async ({ page }) => {
  await routeDevelopmentContext(page);
  await routeReviewedCourse(page, [
    {
      course_id: courseId,
      ready: false,
      blockers: ["At least one reviewed topic is required."],
    },
    { course_id: courseId, ready: true, blockers: [] },
  ]);
  await page.goto("/");

  await page.getByLabel("Direct audio/video URL").fill("https://example.com/lecture.mp4");
  await page.getByRole("button", { name: "Ingest URL" }).click();

  await expect(page.getByRole("button", { name: "Publish course" }).first()).toBeEnabled();
  await expect(page.getByText("At least one reviewed topic is required.")).toBeHidden();
});

test("one-click demo loads the cached source and resumes the next production stage", async ({ page }) => {
  await routeDevelopmentContext(page);
  await routeReviewedCourse(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Use demo" }).click();

  await expect(page.getByText("Loading the pre-processed Manifold demo.")).toHaveClass("sr-only");
  await expect(page.getByText("View processed transcript")).toHaveCount(0);
  await expect(page.locator("#learner-preview")).toHaveCount(0);
  await expect(page.locator('[data-stage="publish"][aria-current="step"]')).toBeVisible();
  await expect(page.locator("#routing-settings")).toBeVisible();
});

test("instructor publishes, learner enrolls, and dashboard correction closes the loop", async ({
  page,
}) => {
  await routeDevelopmentContext(page);
  await routeReviewedCourse(page);
  await page.goto("/");

  await expect(page.getByText("9 of 10 stored videos used")).toBeVisible();
  await page.getByLabel("Direct audio/video URL").fill("https://example.com/lecture.mp4");
  await page.getByRole("button", { name: "Ingest URL" }).click();

  await expect(page.getByLabel("Course status")).toHaveText("draft");
  await page.getByRole("button", { name: "Publish course" }).click();
  await expect(page.getByLabel("Course status")).toHaveText("published");

  await page.getByRole("button", { name: "Insights", exact: true }).click();
  const dashboard = page.locator("#insights");
  await expect(
    dashboard.getByText("Possible missing prerequisite", { exact: true }),
  ).toBeVisible();
  await dashboard.getByRole("button", { name: "Accept AI suggestion" }).click();
  await expect(
    dashboard.getByText("Possible missing prerequisite", { exact: true }),
  ).toBeHidden();

  await page.getByRole("button", { name: "learner", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Topic Outline" })).toBeHidden();
  await page.getByRole("button", { name: "Enroll and start" }).click();
  await expect(page.getByRole("button", { name: "Resume course" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learner Experience" })).toBeVisible();
  const learnerExperience = page.getByLabel("Learner Experience");
  await learnerExperience.getByPlaceholder("Write your answer").fill("Magnitude and direction");
  await learnerExperience.getByRole("button", { name: "Confident" }).click();
  await expect(learnerExperience.getByRole("button", { name: "Submit answer" })).toBeEnabled();
  await learnerExperience.getByRole("button", { name: "Submit answer" }).click();
  await expect(learnerExperience.getByText(/Correct and confident/)).toBeVisible();
});

test("instructor and learner surfaces have no WCAG 2.2 A/AA axe violations", async ({ page }) => {
  await loadReviewedWorkspace(page);

  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.locator('[data-stage="assessments"]').click();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "learner", exact: true }).click();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

async function loadReviewedWorkspace(page: Page) {
  await routeDevelopmentContext(page);
  await routeReviewedCourse(page);
  await page.goto("/");
  await page.getByLabel("Direct audio/video URL").fill("https://example.com/lecture.mp4");
  const ingestButton = page.getByRole("button", { name: "Ingest URL" });
  await expect(ingestButton).toBeEnabled();
  await ingestButton.click();
  await expect(page.locator('[data-stage="publish"][aria-current="step"]')).toBeVisible();
  await page.locator('[data-stage="structure"]').click();
  await expect(page.getByRole("heading", { name: "Topic production", exact: true })).toBeVisible();
}

test("guided production shows exactly one stage at a time", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadReviewedWorkspace(page);

  const sidebar = page.locator('[data-slot="sidebar"]').first();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.getByRole("button", { name: "Collapse or expand navigation" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  const collapsedBrand = page.getByRole("button", { name: "Manifold" });
  await expect(collapsedBrand).toHaveCSS("width", "32px");
  await expect(collapsedBrand).toHaveCSS("height", "32px");
  await expect(collapsedBrand.locator(":scope > span").last()).toBeHidden();
  expect(await collapsedBrand.evaluate((button) => {
    const buttonBounds = button.getBoundingClientRect();
    const logoBounds = button.querySelector("span")?.getBoundingClientRect();
    return Boolean(
      logoBounds &&
      logoBounds.left >= buttonBounds.left &&
      logoBounds.right <= buttonBounds.right &&
      logoBounds.top >= buttonBounds.top &&
      logoBounds.bottom <= buttonBounds.bottom
    );
  })).toBe(true);

  await expect(page.locator('[data-stage="structure"][aria-current="step"]')).toBeVisible();
  await expect(page.locator("#outline")).toBeVisible();
  await expect(page.locator("#concept-graph")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning clips", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topic details", exact: true })).toBeVisible();
  const clipsHeadingBox = await page.getByRole("heading", { name: "Learning clips", exact: true }).boundingBox();
  const topicDetailsBox = await page.getByRole("heading", { name: "Topic details", exact: true }).boundingBox();
  expect(clipsHeadingBox).not.toBeNull();
  expect(topicDetailsBox).not.toBeNull();
  expect(clipsHeadingBox!.y).toBeLessThan(topicDetailsBox!.y);
  const clipPreview = page.locator("#outline video, #outline mux-player").first();
  await expect(clipPreview).toBeVisible();
  expect((await clipPreview.boundingBox())!.width).toBeLessThanOrEqual(560);
  await expect(page.getByText("Why AI suggested this")).toHaveCount(0);
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add to graph" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel adding concept" }).click();
  await expect(page.getByRole("heading", { name: "Add to graph" })).toHaveCount(0);
  await expect(page.getByText("Advanced graph tools")).toHaveCount(0);
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(page.locator("#manual-topic-form")).toBeVisible();
  await page.locator("#manual-topic-form").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#manual-topic-form")).toHaveCount(0);
  await expect(page.locator("#course-setup")).toBeHidden();
  await expect(page.locator("#clips")).toHaveCount(0);

  await page.locator('[data-stage="assessments"]').click();
  await expect(page.locator('[data-stage="assessments"][aria-current="step"]')).toBeVisible();
  await expect(page.locator("#assessments")).toBeVisible();
  await expect(page.locator("#outline")).toBeHidden();

  await expect(page.getByRole("button", { name: "Course map" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All workspaces" })).toHaveCount(0);
  await page.locator('[data-stage="publish"]').click();
  await expect(page.locator("#routing-settings")).toBeVisible();
  await expect(page.locator("#assessments")).toBeHidden();
  await expect(page.locator("#course-setup")).toBeHidden();
});

test("topic production repairs missing concept coverage inline", async ({ page }) => {
  let repairClipGenerated = false;
  let repairQuestionGenerated = false;
  const repairTopic = {
    ...topic,
    id: "50000000-0000-4000-8000-000000000002",
    title: "Vector applications",
    summary: "Applies vectors to a practical problem.",
    start_seconds: 60,
    end_seconds: 120,
  };
  const unlinkedConcept = {
    ...graph.concepts[0],
    id: "70000000-0000-4000-8000-000000000002",
    name: "Vector applications",
    description: "Using vector direction and magnitude in context.",
    ai_proposal: { rationale: "Supported by the application example.", topic_ids: [] },
  };
  const repairClip = {
    ...clip,
    id: "60000000-0000-4000-8000-000000000002",
    topic_id: repairTopic.id,
    start_seconds: 60,
    end_seconds: 90,
    concept_ids: [unlinkedConcept.id],
  };
  const repairQuestion = {
    ...question,
    id: "80000000-0000-4000-8000-000000000002",
    topic_id: repairTopic.id,
    body: "How are vectors applied?",
    review_status: "proposed",
    approved_at: null,
  };

  await routeDevelopmentContext(page);
  await routeReviewedCourse(page);
  await page.route(`${pipeline}/videos/${videoId}/topics`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([topic, repairTopic]) }),
  );
  await page.route(`${pipeline}/courses/${courseId}/graph`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...graph, concepts: [...graph.concepts, unlinkedConcept] }),
    }),
  );
  await page.route(`${pipeline}/videos/${videoId}/clips`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(repairClipGenerated ? [clip, repairClip] : [clip]),
    }),
  );
  await page.route(`${pipeline}/topics/${repairTopic.id}/clips/generate`, (route) => {
    repairClipGenerated = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify([repairClip]) });
  });
  await page.route(`${pipeline}/videos/${videoId}/questions`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(repairQuestionGenerated ? [question, repairQuestion] : [question]),
    }),
  );
  await page.route(`${pipeline}/topics/${repairTopic.id}/questions/generate`, (route) => {
    repairQuestionGenerated = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(repairQuestion) });
  });
  await page.route(`${pipeline}/courses/graph/concepts/${unlinkedConcept.id}/topics`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ topic_ids: [repairTopic.id] });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...unlinkedConcept,
        ai_proposal: { ...unlinkedConcept.ai_proposal, topic_ids: [repairTopic.id] },
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Direct audio/video URL").fill("https://example.com/lecture.mp4");
  await page.getByRole("button", { name: "Ingest URL" }).click();
  await page.locator('[data-stage="structure"]').click();
  await page.getByRole("button", { name: /Vector applications/ }).click();

  await expect(page.getByText("Connect a reviewed concept to generate clips")).toBeVisible();
  await expect(page.getByLabel(`Concept for ${repairTopic.title}`)).toHaveValue(unlinkedConcept.id);
  await page.getByRole("button", { name: "Connect concept", exact: true }).click();
  await expect(page.getByText("Connect a reviewed concept to generate clips")).toHaveCount(0);
  await expect.poll(() => repairClipGenerated).toBe(true);
  await expect(page.getByRole("button", { name: "Regenerate clips", exact: true })).toBeEnabled();
  await expect.poll(() => repairQuestionGenerated).toBe(true);
});

test("instructor workspaces match approved desktop visual system", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loadReviewedWorkspace(page);
  await expect(page.locator("#concept-graph .react-flow__node")).toBeVisible();

  await expect(page.locator("#production-studio")).toHaveScreenshot("production-studio-desktop.png", {
    animations: "disabled",
  });
  await page.locator('[data-stage="structure"]').click();
  for (const id of ["outline", "concept-graph"]) {
    const workspace = page.locator(`#${id}`);
    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveScreenshot(`${id}-desktop.png`, {
      animations: "disabled",
      mask: [page.locator("video, mux-player")],
      maxDiffPixels: id === "concept-graph" ? 500 : 0,
    });
  }
  await page.locator('[data-stage="assessments"]').click();
  await expect(page.locator("#assessments")).toBeVisible();
  await expect(page.locator("#assessments")).toHaveScreenshot("assessments-desktop.png", {
    animations: "disabled",
  });
  await page.locator('[data-stage="publish"]').click();
  await expect(page.locator("#publish-review")).toHaveScreenshot("publish-review-desktop.png", {
    animations: "disabled",
  });
  await page.locator('[data-stage="source"]').click();
  await expect(page.locator("#course-setup")).toHaveScreenshot("course-setup-desktop.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(page.locator("#insights")).toHaveScreenshot("insights-desktop.png", {
    animations: "disabled",
  });
});

test("laptop and learner workspaces do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadReviewedWorkspace(page);

  const viewportOverflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => !element.closest(".react-flow"))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className.toString().slice(0, 120),
          right: Math.round(bounds.right),
          width: Math.round(bounds.width),
        };
      })
      .filter((item) => item.width > 0 && item.right > window.innerWidth + 1)
      .slice(0, 12),
  );
  expect(viewportOverflow).toEqual([]);
  const stageWorkspaces = [
    ["source", ["course-setup"]],
    ["structure", ["outline", "concept-graph"]],
    ["assessments", ["assessments"]],
    ["publish", ["publish-review"]],
  ] as const;
  for (const [stage, ids] of stageWorkspaces) {
    await page.locator(`[data-stage="${stage}"]`).click();
    for (const id of ids) {
      const workspace = page.locator(`#${id}`);
      await expect(workspace).toBeVisible();
      expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  }

  await page.getByRole("button", { name: "Insights", exact: true }).click();
  const insights = page.locator("#insights");
  await expect(insights).toBeVisible();
  expect(await insights.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "learner", exact: true }).click();
  const learner = page.locator("#learner-preview");
  await expect(learner).toBeVisible();
  await expect(learner).toHaveScreenshot("learner-laptop.png", {
    animations: "disabled",
    mask: [page.locator("video, mux-player")],
  });
});

const topic = {
  id: "50000000-0000-4000-8000-000000000001",
  course_id: courseId,
  video_id: videoId,
  title: "Vector basics",
  summary: "Introduces vector notation.",
  start_seconds: 0,
  end_seconds: 60,
  review_status: "accepted",
  ai_proposal: { rationale: "A semantic topic shift begins here." },
  instructor_revision: null,
  approved_at: "2026-07-12T00:00:00Z",
  dismissed_at: null,
};

const clip = {
  id: "60000000-0000-4000-8000-000000000001",
  topic_id: topic.id,
  start_seconds: 0,
  end_seconds: 30,
  type: "explanation",
  difficulty: "introductory",
  status: "active",
  concept_ids: ["70000000-0000-4000-8000-000000000001"],
  ai_proposal: { rationale: "Explains vector notation." },
  instructor_revision: null,
  flagged_at: null,
  flag_note: null,
  superseded_by_clip_id: null,
  source_clip_id: null,
  created_at: "2026-07-12T00:00:00Z",
};

const question = {
  id: "80000000-0000-4000-8000-000000000001",
  topic_id: topic.id,
  body: "What defines a vector?",
  type: "mcq",
  correct_answer: { answer: "Magnitude and direction" },
  confidence_prompt: "How confident are you?",
  review_status: "accepted",
  ai_proposal: { rationale: "Tests the core definition." },
  instructor_revision: null,
  approved_at: "2026-07-12T00:00:00Z",
  dismissed_at: null,
  remediation_rules: [],
};

const graph = {
  course_id: courseId,
  concepts: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      course_id: courseId,
      name: "Vectors",
      description: "Vector basics",
      review_status: "accepted",
      ai_proposal: { rationale: "Repeated throughout the topic.", topic_ids: [topic.id] },
      instructor_revision: null,
      approved_at: "2026-07-12T00:00:00Z",
      dismissed_at: null,
      merged_into_concept_id: null,
    },
  ],
  edges: [],
  warnings: [],
};

const dashboardSignal = {
  id: "90000000-0000-4000-8000-000000000001",
  course_id: courseId,
  type: "graph_drift",
  related_entity_type: "concept",
  related_entity_id: graph.concepts[0].id,
  status: "open",
  ai_diagnosis: {
    summary: "Possible missing prerequisite",
    recommended_action: "Review the prerequisite edge.",
    rationale: "Learner misses correlate with another concept.",
  },
  instructor_action: null,
};
