import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public landing page leads into the Manifold workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Turn lectures into adaptive learning journeys" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From source recording to responsive course." }),
  ).toHaveCount(0);
  const startBuilding = page.getByRole("link", { name: "Start building" }).first();
  await expect(startBuilding).toHaveAttribute("href", "/manifold");
  await startBuilding.click();
  await expect(page).toHaveURL(/\/manifold$/);
  await expect(page.getByText("Course workspace", { exact: true })).toBeVisible();
});

test("public landing page is responsive and WCAG 2.2 AA clean", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Manifold home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start building" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
