import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public landing page leads through role-aware development login", async ({ page }) => {
  await page.route("http://localhost:8000/development/login", async (route) => {
    await route.fulfill({ json: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "dev-instructor@coursefoundry.local",
      display_name: "David",
      role: "instructor",
    } });
  });
  await page.route("http://localhost:8000/instructors/me/dashboard", async (route) => {
    await route.fulfill({ json: {
      courses: [],
      attention: [],
      total_courses: 0,
      published_courses: 0,
      courses_in_review: 0,
      active_learners: 0,
      new_learners: 0,
      activity_history: [],
    } });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Turn lectures into adaptive learning journeys" }),
  ).toBeVisible();
  await expect(page.getByLabel("Manifold home").locator(".manifoldBrandMark")).toBeVisible();
  const startBuilding = page.getByRole("link", { name: "Start building" }).first();
  await expect(startBuilding).toHaveAttribute("href", "/login");
  await startBuilding.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome to Manifold." })).toBeVisible();
  await page.getByLabel("Password").fill("David1");
  await page.getByRole("button", { name: "Continue as David" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: "New course" })).toBeVisible();
});

test("student credentials open Brian's dedicated learner Course OS", async ({ page }) => {
  await page.route("http://localhost:8000/development/login", async (route) => {
    await route.fulfill({ json: {
      id: "22222222-2222-4222-8222-222222222222",
      email: "dev-learner@coursefoundry.local",
      display_name: "Brian",
      role: "learner",
    } });
  });
  await page.route("http://localhost:8000/learners/me/courses", async (route) => {
    await route.fulfill({ json: [{
      id: "33333333-3333-4333-8333-333333333333",
      title: "Learn Anything in 20 Hours",
      description: "A reviewed adaptive course.",
      enrolled: true,
      topic_count: 6,
      concept_count: 14,
      mastered_concept_count: 2,
    }] });
  });

  await page.goto("/login");
  await page.getByRole("button", { name: /Student/ }).click();
  await expect(page.getByLabel("Username")).toHaveValue("Brian");
  await page.getByLabel("Password").fill("Brian1");
  await page.getByRole("button", { name: "Continue as Brian" }).click();

  await expect(page).toHaveURL(/\/learn$/);
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening), Brian\./ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue learning" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learn Anything in 20 Hours" })).toBeVisible();
});

test("public landing page is responsive and WCAG 2.2 AA clean", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Manifold home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start building" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
