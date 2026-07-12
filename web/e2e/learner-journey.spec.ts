import { expect, test } from "@playwright/test";

const pipeline = "http://localhost:8000";

test("learner journey covers remediation and advancement branches", async ({ page }) => {
  let progressState = "not_started";
  await page.route(`${pipeline}/development/identities`, async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route(`${pipeline}/videos/delivery/capacity`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: "local",
        stored_count: 0,
        max_stored: null,
        remaining: null,
        can_upload: true,
      }),
    });
  });
  await page.route(`${pipeline}/videos/url`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "job-1",
        video_id: "video-1",
        course_id: "course-1",
        source_kind: "url",
        source_uri: "https://example.com/lecture.mp4",
        status: "complete",
        progress: 100,
        error_message: null,
      }),
    });
  });
  await page.route(`${pipeline}/videos/jobs/job-1`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "job-1",
        video_id: "video-1",
        course_id: "course-1",
        source_kind: "url",
        source_uri: "https://example.com/lecture.mp4",
        status: "complete",
        progress: 100,
        error_message: null,
      }),
    });
  });
  await page.route(`${pipeline}/videos/video-1/transcript`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        text: "A short lesson about vectors.",
        words: [
          { text: "A", start_seconds: 0, end_seconds: 0.5 },
          { text: "lesson", start_seconds: 0.5, end_seconds: 1 },
        ],
      }),
    });
  });
  await page.route(`${pipeline}/videos/video-1/topics`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "topic-1",
          course_id: "course-1",
          video_id: "video-1",
          title: "Vector basics",
          summary: "Introduces vector notation.",
          start_seconds: 0,
          end_seconds: 60,
          review_status: "accepted",
          ai_proposal: {},
          instructor_revision: null,
          approved_at: "2026-07-12T00:00:00Z",
          dismissed_at: null,
        },
      ]),
    });
  });
  await page.route(`${pipeline}/videos/video-1/clips`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "clip-1",
          topic_id: "topic-1",
          start_seconds: 0,
          end_seconds: 30,
          type: "explanation",
          difficulty: "introductory",
          status: "active",
          concept_ids: ["concept-1"],
          ai_proposal: { rationale: "Explains the concept." },
          instructor_revision: null,
          flagged_at: null,
          flag_note: null,
          superseded_by_clip_id: null,
          source_clip_id: null,
          created_at: "2026-07-12T00:00:00Z",
        },
      ]),
    });
  });
  await page.route(`${pipeline}/videos/video-1/questions`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "question-1",
          topic_id: "topic-1",
          body: "What is a vector?",
          type: "mcq",
          correct_answer: { answer: "A quantity with direction." },
          confidence_prompt: "How confident are you?",
          review_status: "accepted",
          ai_proposal: {},
          instructor_revision: null,
          approved_at: "2026-07-12T00:00:00Z",
          dismissed_at: null,
          remediation_rules: [
            {
              id: "rule-1",
              question_id: "question-1",
              wrong_answer_pattern: "confuses scalar",
              target_clip_id: "clip-1",
              target_concept_id: "concept-1",
              ai_proposal: { rationale: "Review vector basics." },
              instructor_revision: null,
            },
          ],
        },
      ]),
    });
  });
  await page.route(`${pipeline}/courses/course-1/graph`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        course_id: "course-1",
        concepts: [
          {
            id: "concept-1",
            course_id: "course-1",
            name: "Vectors",
            description: "Vector basics",
            review_status: "accepted",
            ai_proposal: { topic_ids: ["topic-1"] },
            instructor_revision: null,
            approved_at: "2026-07-12T00:00:00Z",
            dismissed_at: null,
            merged_into_concept_id: null,
          },
        ],
        edges: [],
        warnings: [],
      }),
    });
  });
  await page.route(`${pipeline}/courses/course-1/routing/policies`, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${pipeline}/courses/course-1/dashboard`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        course_id: "course-1",
        learner_count: 1,
        attempt_count: 0,
        not_enough_data: false,
        signals: [],
      }),
    });
  });
  await page.route(`${pipeline}/courses/course-1/routing/demo-learner`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ learner_id: "learner-1" }),
    });
  });
  await page.route(`${pipeline}/learners/learner-1/courses/course-1/progress`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          concept_id: "concept-1",
          name: "Vectors",
          state: progressState,
          topic_id: "topic-1",
        },
      ]),
    });
  });
  await page.route(`${pipeline}/learners/learner-1/questions/question-1/attempt`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { correctness: boolean };
    progressState = body.correctness ? "mastered" : "struggling";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        body.correctness
          ? {
              action: "advance",
              mastery_state: "mastered",
              why: "Correct and confident; advancing to the next eligible concept.",
              target_concept_id: "concept-1",
              target_clip_id: null,
              dashboard_signal_id: null,
            }
          : {
              action: "remediate",
              mastery_state: "struggling",
              why: "Incorrect answer matched a reviewed remediation rule.",
              target_concept_id: "concept-1",
              target_clip_id: "clip-1",
              dashboard_signal_id: null,
            },
      ),
    });
  });

  await page.goto("/");
  await page.getByLabel("Direct audio/video URL").fill("https://example.com/lecture.mp4");
  await page.getByRole("button", { name: "Ingest URL" }).click();
  await page.getByRole("button", { name: "Refresh" }).first().click();

  await page.getByRole("button", { name: "Start course" }).click();
  const learnerPanel = page.getByLabel("Learner Experience");
  await expect(page.getByRole("heading", { name: "Learner Experience" })).toBeVisible();
  await expect(learnerPanel.getByText("0 of 1 concept(s) mastered")).toBeVisible();

  await learnerPanel.getByRole("button", { name: "I missed this" }).click();
  await expect(
    learnerPanel.getByText("Incorrect answer matched a reviewed remediation rule."),
  ).toBeVisible();
  await expect(learnerPanel.getByText("struggling")).toBeVisible();

  await learnerPanel.getByRole("button", { name: "I got it and feel confident" }).click();
  await expect(learnerPanel.getByText("Correct and confident; advancing")).toBeVisible();
  await expect(learnerPanel.getByText("1 of 1 concept(s) mastered")).toBeVisible();
});
