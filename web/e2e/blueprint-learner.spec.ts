import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pipeline = "http://localhost:8000";
const learner = {
  id: "11111111-1111-4111-8111-111111111112",
  display_name: "Brian",
  role: "learner",
};

test("learner Blueprint path explains remediation, advancement, and locked prerequisites", async ({ page }) => {
  let firstState: "not_started" | "struggling" | "mastered" = "not_started";
  let secondCurrent = false;
  let enrollmentRequests = 0;

  await page.addInitScript((identity) => {
    window.localStorage.setItem("manifold.development-session", JSON.stringify(identity));
    window.localStorage.setItem("manifold.learner-id", identity.id);
  }, learner);

  await page.route(`${pipeline}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/courses/course-1/enrollment") {
      enrollmentRequests += 1;
      return route.fulfill({ json: { enrolled: true } });
    }
    if (path === "/learners/me/courses/course-1") {
      return route.fulfill({ json: {
        id: "course-1",
        title: "Vector Foundations",
        description: "A reviewed adaptive mechanics course.",
        units: [
          { id: "unit-1", logical_id: "lecture-1", kind: "lecture", title: "Vector language", summary: "", instructions: "", video_id: "video-1", sequence_rank: 1, status: "in_progress", topic_ids: ["topic-1"], question_count: 1 },
          { id: "unit-2", logical_id: "lecture-2", kind: "lecture", title: "Forces in motion", summary: "", instructions: "", video_id: "video-1", sequence_rank: 2, status: "not_started", topic_ids: ["topic-2"], question_count: 1 },
        ],
        topics: [
          { id: "topic-1", title: "Vector direction", summary: "Use magnitude and direction together." },
          { id: "topic-2", title: "Net force", summary: "Combine reviewed vector ideas." },
        ],
        clips: [
          { id: "clip-1", topic_id: "topic-1", video_id: "video-1", title: "Vector direction", start_seconds: 10, end_seconds: 42, type: "explanation", difficulty: "introductory", playback_provider: "local", playback_id: null, playback_url: "/videos/video-1/media", delivery_asset_id: null, materialization_status: "source_reference" },
          { id: "clip-2", topic_id: "topic-2", video_id: "video-1", title: "Net force", start_seconds: 43, end_seconds: 74, type: "worked_example", difficulty: "intermediate", playback_provider: "local", playback_id: null, playback_url: "/videos/video-1/media", delivery_asset_id: null, materialization_status: "source_reference" },
        ],
        questions: [
          { id: "question-1", topic_id: "topic-1", body: "What makes a vector different from a scalar?", type: "short_answer", choices: [], confidence_prompt: "How confident are you?" },
          { id: "question-2", topic_id: "topic-2", body: "How is net force calculated?", type: "short_answer", choices: [], confidence_prompt: "How confident are you?" },
        ],
        resources: [{ id: "resource-1", filename: "Vector notes.pdf", source_type: "pdf", size_bytes: 2400 }],
      } });
    }
    if (path === "/videos/video-1/transcript") {
      return route.fulfill({ json: {
        text: "Vector direction combines magnitude with direction.",
        words: [
          { text: "Vector", start_seconds: 10, end_seconds: 10.8 },
          { text: "direction", start_seconds: 10.8, end_seconds: 11.7 },
          { text: "combines", start_seconds: 11.7, end_seconds: 12.4 },
          { text: "magnitude", start_seconds: 12.4, end_seconds: 13.2 },
          { text: "with", start_seconds: 13.2, end_seconds: 13.6 },
          { text: "direction.", start_seconds: 13.6, end_seconds: 14.5 },
        ],
      } });
    }
    if (path === `/learners/${learner.id}/courses/course-1/progress`) {
      return route.fulfill({ json: [
        { concept_id: "concept-1", name: "Vector direction", state: firstState, topic_id: "topic-1" },
        { concept_id: "concept-2", name: "Net force", state: "not_started", topic_id: "topic-2" },
        { concept_id: "concept-3", name: "Vector components", state: "not_started", topic_id: "topic-2" },
      ] });
    }
    if (path === "/learners/me/courses/course-1/path") {
      return route.fulfill({ json: {
        course_id: "course-1",
        revision_id: "revision-1",
        current_concept_id: secondCurrent ? "concept-2" : "concept-1",
        last_route_action: firstState === "struggling" ? "remediate" : secondCurrent ? "advance" : null,
        last_route_why: firstState === "struggling"
          ? "The answer missed direction, so the reviewed recovery clip is next."
          : secondCurrent ? "Vector direction is mastered; net force is now eligible." : null,
        items: [
          { concept_id: "concept-1", name: "Vector direction", description: "Magnitude plus direction", sequence_rank: 1, state: firstState, topic_id: "topic-1", topic_title: "Vector direction", prerequisite_ids: [], clip_ids: ["clip-1"], question_ids: ["question-1"], aids: [{ source_id: "source-1", title: "Vector notes", page_number: 2, excerpt: "Direction is part of the vector definition." }], eligible: true, current: !secondCurrent },
          { concept_id: "concept-2", name: "Net force", description: "Combine vectors", sequence_rank: 2, state: "not_started", topic_id: "topic-2", topic_title: "Net force", prerequisite_ids: ["concept-1"], clip_ids: ["clip-2"], question_ids: ["question-2"], aids: [], eligible: secondCurrent, current: secondCurrent },
          { concept_id: "concept-3", name: "Vector components", description: "Resolve a vector into components", sequence_rank: 3, state: "not_started", topic_id: "topic-2", topic_title: "Net force", prerequisite_ids: [], clip_ids: ["clip-2"], question_ids: ["question-2"], aids: [], eligible: true, current: false },
        ],
      } });
    }
    if (path === "/questions/question-1/grade") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { answer?: string };
      const correct = body.answer === "It has direction";
      return route.fulfill({ json: { is_correct: correct, feedback: correct ? "Correct." : "Direction is essential.", wrong_answer_pattern: correct ? null : "omits direction" } });
    }
    if (path === `/learners/${learner.id}/questions/question-1/attempt`) {
      const body = JSON.parse(route.request().postData() ?? "{}") as { correctness?: boolean };
      if (body.correctness) {
        firstState = "mastered";
        secondCurrent = true;
        return route.fulfill({ json: { action: "advance", mastery_state: "mastered", why: "Correct and confident; net force is now the next eligible concept.", target_concept_id: "concept-2", target_clip_id: null, dashboard_signal_id: null, route_event_id: "route-2" } });
      }
      firstState = "struggling";
      return route.fulfill({ json: { action: "remediate", mastery_state: "struggling", why: "The answer missed direction, so the reviewed recovery clip is next.", target_concept_id: "concept-1", target_clip_id: "clip-1", dashboard_signal_id: null, route_event_id: "route-1" } });
    }
    if (path.endsWith("/watch-events")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 404, json: { detail: "Not mocked" } });
  });

  await page.goto("/learn/courses/course-1");
  await expect(page.getByRole("heading", { name: "Vector direction", level: 1 })).toBeVisible();
  await expect(page.getByText("Lecture 1 of 2 · Vector language")).toHaveCount(0);
  await expect(page.getByText("Current lesson", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Course learning journey")).toContainText("Vector language");
  await expect(page.getByLabel("Course learning journey")).toContainText("Forces in motion");
  await expect(page.getByText("Recommended next", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Adaptive learning path")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Learning path" })).toBeVisible();
  const masteryTrail = page.getByLabel("Adaptive mastery trail");
  await expect(masteryTrail.getByRole("button", { name: /Recommended next.*Vector direction/ })).toBeVisible();
  await expect(masteryTrail.getByRole("button", { name: /Ready.*Vector components/ })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const lockedNetForce = masteryTrail.getByRole("button", { name: /Coming later.*Net force/ });
  await expect(lockedNetForce).toBeEnabled();
  await lockedNetForce.click();
  await expect(masteryTrail.getByText("Complete Vector direction to unlock this topic.")).toBeVisible();
  await page.getByText("Course materials", { exact: true }).click();
  await expect(page.getByText("Vector notes · page 2")).toBeVisible();

  await expect(page.getByRole("heading", { name: "What makes a vector different from a scalar?" })).toHaveCount(0);
  await page.getByText("Transcript", { exact: true }).click();
  await expect(page.getByLabel("Clip transcript")).toContainText("Vector direction combines");
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "currentTime", { configurable: true, value: 10.4 });
    video.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.getByLabel("Clip transcript").locator("[data-active]")).toHaveText("Vector");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What makes a vector different from a scalar?" })).toBeVisible();
  const assessmentViewport = await page.evaluate(() => ({
    innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(assessmentViewport.scrollHeight).toBeLessThanOrEqual(assessmentViewport.innerHeight);
  await page.getByLabel("Your answer").fill("It has magnitude");
  await page.getByRole("button", { name: "Unsure" }).click();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.locator("form").getByText("The answer missed direction, so the reviewed recovery clip is next.")).toBeVisible();
  await expect(masteryTrail.getByRole("button", { name: /Review recommended.*Vector direction/ })).toBeVisible();

  await page.getByRole("button", { name: "Review lesson" }).click();
  await expect(page.locator("video")).toBeVisible();
  await page.getByRole("button", { name: "Try the check again" }).click();
  await page.getByLabel("Your answer").fill("It has direction");
  await page.getByRole("button", { name: "Confident" }).click();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.locator("form").getByText(
    "Correct and confident; net force is now the next eligible concept.",
  )).toBeVisible();
  await page.getByRole("button", { name: "Continue to next lesson" }).click();
  await expect(page.getByRole("heading", { name: "Net force", level: 1 })).toBeVisible();
  await expect(page.getByText("Lecture 2 of 2 · Forces in motion")).toHaveCount(0);
  await expect(masteryTrail.getByRole("button", { name: /Mastered.*Vector direction/ })).toBeEnabled();
  await expect(masteryTrail.getByRole("button", { name: /Recommended next.*Net force/ })).toBeVisible();
  expect(enrollmentRequests).toBe(0);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
