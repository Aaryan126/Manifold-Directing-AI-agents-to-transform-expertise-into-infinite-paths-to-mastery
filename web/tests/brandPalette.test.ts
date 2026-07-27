import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const chromePaletteSurfaces = [
  "app/globals.css",
  "app/landing.module.css",
  "app/login/login.module.css",
  "components/coursefoundry-shell.tsx",
  "components/instructor-production-studio.tsx",
  "components/insights-charts.tsx",
  "components/review-workspace.tsx",
  "components/ui/button.tsx",
];

const retiredGreenAccents = [
  "#4e7735",
  "#5f8f49",
  "#6f965a",
  "#7fa36b",
  "#82a56d",
  "#91ac7e",
  "#9cbd8b",
  "#b9d8a8",
  "#dcead4",
  "#e8f1e4",
  "#eef5ea",
  "#f0f6ec",
  "#23866a",
  "#356f5a",
  "#256d4e",
  "#25855b",
  "#2c6e49",
  "#2c7a52",
  "#267348",
  "#2f7b53",
  "#2d6b4f",
  "#2f7655",
];

describe("Manifold brand palette", () => {
  it("defines the shared orange, brown, and grey tokens", () => {
    const globals = readFileSync(resolve("app/globals.css"), "utf8");

    expect(globals).toContain("--manifold-orange:");
    expect(globals).toContain("--manifold-brown:");
    expect(globals).toContain("--manifold-grey:");
  });

  it("does not restore the retired green accent palette", () => {
    const source = chromePaletteSurfaces
      .map((file) => readFileSync(resolve(file), "utf8").toLowerCase())
      .join("\n");

    for (const accent of retiredGreenAccents) {
      expect(source).not.toContain(accent);
    }
    expect(source).not.toMatch(/colors\.(green|mint)/);
    expect(source).not.toMatch(
      /(emerald|green|teal|cyan|blue|indigo|violet|purple|red|rose|amber|yellow|lime)-[0-9]/,
    );
  });

  it("keeps instructional flowcharts intentionally multicolor", () => {
    const instructorGraph = readFileSync(resolve("app/app/course-os.module.css"), "utf8");
    const learnerGraph = readFileSync(resolve("app/learn/learner.module.css"), "utf8");
    const legacyGraph = readFileSync(resolve("app/workspace.tsx"), "utf8");

    expect(instructorGraph).toContain("background: #e3edf2");
    expect(instructorGraph).toContain("background: #e2f0df");
    expect(instructorGraph).toContain("background: #fff1e3");
    expect(learnerGraph).toContain("--mastery-route-color: #26778a");
    expect(learnerGraph).toContain("--mastery-route-color: #8556a3");
    expect(legacyGraph).toContain('background: "#eff6ff"');
    expect(legacyGraph).toContain('background: "#ecfdf5"');
  });
});
