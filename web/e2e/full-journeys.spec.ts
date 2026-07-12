import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const pipeline = "http://localhost:8000";
const instructorId = "10000000-0000-4000-8000-000000000001";
const learnerId = "10000000-0000-4000-8000-000000000002";
const courseId = "20000000-0000-4000-8000-000000000001";
const videoId = "30000000-0000-4000-8000-000000000001";

async function routeDevelopmentContext(page: Page) {
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

async function routeReviewedCourse(
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
    route.fulfill({ contentType: "application/json", body: "[]" }),
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
  await page.getByRole("button", { name: "Refresh" }).first().click();

  await expect(page.getByRole("button", { name: "Publish course" })).toBeEnabled();
  await expect(page.getByText("At least one reviewed topic is required.")).toBeHidden();
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
  await page.getByRole("button", { name: "Refresh" }).first().click();

  await expect(page.getByText("Course status:")).toContainText("draft");
  await page.getByRole("button", { name: "Publish course" }).click();
  await expect(page.getByText("Course status:")).toContainText("published");

  const dashboard = page.locator("#insights");
  await expect(
    dashboard.getByText("Possible missing prerequisite", { exact: true }),
  ).toBeVisible();
  await dashboard.getByRole("button", { name: "Accept AI suggestion" }).click();
  await expect(page.getByText(/Applied dashboard signal/)).toBeVisible();

  await page.getByLabel("Development identity").selectOption(learnerId);
  await expect(page.getByRole("heading", { name: "Topic Outline" })).toBeHidden();
  await page.getByRole("button", { name: "Enroll and start" }).click();
  await expect(page.getByText("Enrolled in the published course.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learner Experience" })).toBeVisible();
});

test("instructor and learner surfaces have no WCAG 2.2 A/AA axe violations", async ({ page }) => {
  await routeDevelopmentContext(page);
  await routeReviewedCourse(page);
  await page.goto("/");

  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByLabel("Development identity").selectOption(learnerId);
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
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
