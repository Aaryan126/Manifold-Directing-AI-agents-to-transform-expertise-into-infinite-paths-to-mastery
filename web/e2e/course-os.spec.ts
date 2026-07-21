import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const instructor = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "Ada Teacher",
  role: "instructor",
};

const course = {
  id: "22222222-2222-4222-8222-222222222222",
  instructor_id: instructor.id,
  title: "Forces and motion",
  description: "A practical mechanics course.",
  status: "draft",
  active_revision_id: null,
  working_revision_id: "33333333-3333-4333-8333-333333333333",
  revision_status: "review",
  generation_run_id: "44444444-4444-4444-8444-444444444444",
  generation_status: "waiting_review",
  generation_phase: "review",
  generation_progress: 100,
  source_count: 1,
  topic_count: 2,
  concept_count: 3,
  pending_review_count: 2,
  open_signal_count: 0,
  updated_at: "2026-07-21T00:00:00Z",
};

async function mockCourseOS(page: Page) {
  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/development/identities") {
      await route.fulfill({ json: [instructor] });
      return;
    }
    if (path === "/instructors/me/dashboard") {
      await route.fulfill({
        json: {
          courses: [course],
          attention: [{
            id: `review:${course.id}`,
            course_id: course.id,
            kind: "review_ready",
            title: "Forces and motion is ready for review",
            detail: "2 decisions remain across the review bundles.",
            urgency: "normal",
          }],
          total_courses: 1,
          published_courses: 0,
          courses_in_review: 1,
          active_learners: 0,
        },
      });
      return;
    }
    if (path.endsWith("/studio")) {
      await route.fulfill({ json: course });
      return;
    }
    if (path.endsWith("/messages")) {
      await route.fulfill({
        json: [{
          id: "55555555-5555-4555-8555-555555555555",
          role: "manifold",
          content: "Your complete private draft is ready for review.",
          blocks: [],
          created_at: "2026-07-21T00:00:00Z",
        }],
      });
      return;
    }
    if (path.endsWith("/map")) {
      await route.fulfill({
        json: {
          course_id: course.id,
          revision_id: course.working_revision_id,
          nodes: [
            { id: "topic-1", logical_id: "topic-logical", kind: "topic", title: "Net force", status: "accepted", topic_id: null, metadata: {} },
            { id: "concept-1", logical_id: "concept-logical", kind: "concept", title: "Vector addition", status: "accepted", topic_id: "topic-1", metadata: {} },
          ],
          edges: [],
        },
      });
      return;
    }
    if (path.endsWith("/review-bundles")) {
      await route.fulfill({
        json: [{
          id: "66666666-6666-4666-8666-666666666666",
          kind: "course_structure",
          title: "Course structure",
          summary: "Review the outline and concepts.",
          status: "in_review",
          items: [{
            id: "77777777-7777-4777-8777-777777777777",
            artifact_type: "topic",
            artifact_id: "88888888-8888-4888-8888-888888888888",
            logical_artifact_id: "99999999-9999-4999-8999-999999999999",
            status: "pending",
            risk_level: "normal",
            evidence: { title: "Net force", summary: "Combine forces as vectors." },
          }],
        }],
      });
      return;
    }
    if (path.includes("/generation-runs/")) {
      await route.fulfill({
        json: {
          id: course.generation_run_id,
          course_id: course.id,
          revision_id: course.working_revision_id,
          status: "waiting_review",
          phase: "review",
          progress: 100,
          error_summary: null,
          created_at: "2026-07-21T00:00:00Z",
          updated_at: "2026-07-21T00:00:00Z",
          tasks: [],
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("teacher dashboard prioritizes review work and opens the studio", async ({ page }) => {
  await mockCourseOS(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app");

  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening), Ada\./ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worth your judgment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Forces and motion" })).toBeVisible();
  await expect(page.getByText("Ready to review", { exact: true })).toBeVisible();

  await page.getByRole("heading", { name: "Forces and motion" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/courses/${course.id}$`));
  await expect(page.getByRole("heading", { name: "Forces and motion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Course Director" })).toBeVisible();
  await page.getByRole("button", { name: "Open Course Director" }).click();
  await expect(page.getByText("Your complete private draft is ready for review.")).toBeVisible();
});

test("course studio exposes map, review decisions, and a mobile-safe layout", async ({ page }) => {
  await mockCourseOS(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/courses/${course.id}`);

  await expect(page.getByRole("button", { name: "Course map" })).toBeVisible();
  await page.getByRole("button", { name: "Course map" }).click();
  await page.getByRole("button", { name: /Net force accepted/ }).click();
  await expect(page.getByText("Vector addition", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Course structure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
