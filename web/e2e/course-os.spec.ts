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
  await setInstructorSession(page);
  let deleted = false;
  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/development/identities") {
      await route.fulfill({ json: [instructor] });
      return;
    }
    if (path === "/instructors/me/dashboard/command") {
      await route.fulfill({
        json: {
          kind: "evidence",
          message: "**Forces and motion** has 2 confident-but-incorrect attempts.",
          course_id: course.id,
          course_title: course.title,
          action_label: "Inspect evidence",
          searched_course_count: 1,
          evidence: [{
            id: `course:${course.id}:confident-incorrect`,
            label: "Confident but incorrect",
            value: "2",
            metric: "confident-incorrect",
            course_id: course.id,
            course_title: course.title,
          }],
        },
      });
      return;
    }
    if (path === "/instructors/me/dashboard") {
      await route.fulfill({
        json: {
          courses: deleted ? [] : [course],
          attention: deleted ? [] : [{
            id: `review:${course.id}`,
            course_id: course.id,
            kind: "review_ready",
            title: "Forces and motion is ready for review",
            detail: "2 decisions remain across the review bundles.",
            urgency: "normal",
          }],
          total_courses: deleted ? 0 : 1,
          published_courses: 0,
          courses_in_review: deleted ? 0 : 1,
          active_learners: 0,
          new_learners: 0,
          activity_history: [
            { date: "2026-07-15", active_learners: 0 },
            { date: "2026-07-16", active_learners: 1 },
            { date: "2026-07-17", active_learners: 0 },
            { date: "2026-07-18", active_learners: 2 },
            { date: "2026-07-19", active_learners: 1 },
            { date: "2026-07-20", active_learners: 3 },
            { date: "2026-07-21", active_learners: 1 },
          ],
          course_radar: deleted ? [] : [{
            course_id: course.id,
            title: course.title,
            activity_trend: [0, 1, 0, 2, 1, 3, 1],
            active_learners: 3,
            accuracy_percent: 62.5,
            confidence_percent: 75,
            confident_incorrect_attempts: 2,
            clip_completion_percent: 68,
            mastery_percent: 40,
            mastery_movement: 1,
            open_issues: 2,
            agent_status: "working",
            agent_role: "learning_analyst",
          }],
        },
      });
      return;
    }
    if (path === `/courses/${course.id}` && route.request().method() === "DELETE") {
      deleted = true;
      await route.fulfill({ status: 204, body: "" });
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
    if (path.endsWith("/sources") || path.endsWith("/agent-tasks")) {
      await route.fulfill({ json: [] });
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
  return { deleted: () => deleted };
}

async function mockPublishedCourseOS(page: Page) {
  await setInstructorSession(page);
  const published = {
    ...course,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Applied mechanics",
    status: "published",
    active_revision_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    working_revision_id: null,
    revision_status: "published",
    generation_run_id: null,
    generation_status: "complete",
    generation_phase: "complete",
    pending_review_count: 64,
    open_signal_count: 1,
  };
  await page.route("http://localhost:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/development/identities") return route.fulfill({ json: [instructor] });
    if (path.endsWith("/studio")) return route.fulfill({ json: published });
    if (path.endsWith("/messages") || path.endsWith("/review-bundles")) return route.fulfill({ json: [] });
    if (path.endsWith("/sources")) return route.fulfill({
      json: [{
        id: "source-1",
        logical_id: "source-logical",
        filename: "Force diagrams.pdf",
        source_type: "pdf",
        mime_type: "application/pdf",
        size_bytes: 12000,
        extraction_status: "ready",
        extraction_error: null,
        purpose: "ai_context",
        review_status: "accepted",
        learner_visible: false,
        section_count: 6,
        created_at: "2026-07-21T00:00:00Z",
        updated_at: "2026-07-21T00:00:00Z",
      }],
    });
    if (path.endsWith("/agent-tasks")) return route.fulfill({
      json: [{
        id: "task-1",
        specialist_role: "learning_analyst",
        task_type: "prepare_improvement",
        target_artifact_type: "topic",
        target_logical_artifact_id: "topic-logical",
        request_context: { instruction: "Clarify vector addition." },
        evidence_snapshot: { incorrect_attempts: 4 },
        status: "waiting_review",
        result: {
          rationale: "Learner uncertainty is concentrated in vector direction.",
          before_state: { summary: "Combine forces." },
          proposed_state: { summary: "Combine force vectors by magnitude and direction." },
        },
        proposal_ids: ["proposal-1"],
        error_message: null,
        created_at: "2026-07-21T00:00:00Z",
        updated_at: "2026-07-21T00:00:00Z",
      }],
    });
    if (path.endsWith("/map")) return route.fulfill({
      json: {
        course_id: published.id,
        revision_id: published.active_revision_id,
        nodes: [
          { id: "topic-1", logical_id: "topic-logical", kind: "topic", title: "Force systems", status: "accepted", topic_id: null, metadata: {} },
          { id: "concept-1", logical_id: "concept-logical", kind: "concept", title: "Net force", status: "accepted", topic_id: "topic-1", metadata: {} },
        ],
        edges: [],
      },
    });
    if (path.endsWith("/assessment-workspace")) return route.fulfill({
      json: {
        revision_id: published.active_revision_id,
        is_working_revision: false,
        topics: [{ id: "topic-1", title: "Force systems" }],
        concepts: [{ id: "concept-1", name: "Net force", topic_ids: ["topic-1"] }],
        clips: [{
          id: "clip-1",
          topic_id: "topic-1",
          topic_title: "Force systems",
          video_id: "video-1",
          label: "Force systems · explanation · 0–60s",
          start_seconds: 0,
          end_seconds: 60,
          type: "explanation",
          difficulty: "introductory",
          status: "active",
          playback_provider: "local",
          playback_id: null,
          playback_url: "/videos/video-1/media",
          delivery_asset_id: null,
          materialization_status: "source_reference",
        }],
        questions: [{
          id: "question-1",
          logical_id: "question-logical",
          topic_id: "topic-1",
          topic_title: "Force systems",
          body: "What determines the direction of net force?",
          type: "short_answer",
          correct_answer: { answer: "vector sum" },
          confidence_prompt: "How confident are you?",
          review_status: "accepted",
          remediation_rules: [{ id: "rule-1", wrong_answer_pattern: "Adds magnitudes only", target_clip_id: "clip-1", target_concept_id: "concept-1" }],
        }],
      },
    });
    if (path.endsWith("/routing-workspace")) return route.fulfill({
      json: {
        revision_id: published.active_revision_id,
        is_working_revision: false,
        concepts: [{ id: "concept-1", name: "Net force", topic_ids: ["topic-1"] }],
        policies: [{
          id: "policy-1",
          concept_id: null,
          concept_name: null,
          policy: { confidence_threshold: 3, correct_attempts_for_mastery: 1, advancement_mode: "require_mastery", max_remediation_attempts: 2 },
        }],
      },
    });
    if (path.endsWith("/dashboard")) return route.fulfill({
      json: {
        course_id: published.id,
        learner_count: 4,
        attempt_count: 8,
        not_enough_data: false,
        signals: [{ id: "signal-1", type: "stuck_cohort", status: "open", ai_diagnosis: { title: "Net force needs attention", summary: "Two learners exhausted remediation." } }],
        concept_performance: [{ concept_id: "concept-1", concept_name: "Net force", touched_learners: 4, struggling_learners: 2 }],
        question_performance: [{ question_id: "question-1", prompt: "What determines the direction of net force?", attempts: 8, incorrect_attempts: 2, low_confidence_correct_attempts: 1 }],
        clip_performance: [],
        activity_history: [{ date: "2026-07-21", attempts: 8, active_learners: 4 }],
        mastery_distribution: { mastered: 2, practiced: 1, struggling: 1, not_started: 0 },
        topic_health: [{
          topic_id: "topic-1",
          logical_id: "topic-logical",
          title: "Force systems",
          learner_reach: 4,
          attempts: 8,
          correct_attempts: 4,
          confidence_1: 1,
          confidence_2: 3,
          confidence_3: 2,
          confidence_4: 2,
          mastered_learners: 2,
          practiced_learners: 1,
          struggling_learners: 1,
          remediation_attempts: 3,
          active_clips: 1,
          clip_duration_seconds: 60,
          assessment_count: 1,
          concept_count: 1,
        }],
        priorities: [{
          id: "learning:topic-logical",
          title: "Learners need support in Force systems",
          summary: "Four of eight attempts were incorrect and four carried low confidence.",
          severity: "high",
          score: 98,
          specialist_role: "learning_analyst",
          target_artifact_type: "topic",
          target_artifact_id: "topic-1",
          target_logical_artifact_id: "topic-logical",
          affected_learners: 4,
          evidence_count: 8,
          evidence: { attempts: 8, incorrect_attempts: 4, low_confidence_attempts: 4 },
          recommended_action: "Clarify vector addition.",
        }],
      },
    });
    return route.fulfill({ json: {} });
  });
  return published;
}

async function setInstructorSession(page: Page) {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("manifold.development-session", JSON.stringify(identity));
    window.localStorage.setItem("manifold.teacher-id", identity.id);
  }, instructor);
}

test("teacher dashboard prioritizes review work and opens the studio", async ({ page }) => {
  await mockCourseOS(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app");

  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening), Ada\./ }),
  ).toBeVisible();
  const greetingBlock = await page.getByRole("heading", { name: /Good (morning|afternoon|evening), Ada\./ }).locator("..").boundingBox();
  const newCourseButton = await page.getByRole("button", { name: "New course" }).boundingBox();
  expect(greetingBlock).not.toBeNull();
  expect(newCourseButton).not.toBeNull();
  expect(Math.abs(
    (greetingBlock!.y + greetingBlock!.height / 2)
      - (newCourseButton!.y + newCourseButton!.height / 2),
  )).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "Needs your judgment", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course radar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /carries 2 of 2 open issues/i })).toBeVisible();
  await expect(page.getByText("Portfolio summary", { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask Manifold anything…")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Clip completion" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Agent" })).toHaveCSS("text-align", "center");
  await expect(page.getByLabel("Suggested commands").getByRole("button")).toHaveCount(4);
  await page.getByRole("button", { name: "Find confident misconceptions" }).click();
  await page.getByRole("button", { name: "Ask Manifold" }).click();
  await expect(page.getByText("Forces and motion has 2 confident-but-incorrect attempts.")).toBeVisible();
  await expect(
    page.getByLabel("Manifold answer").getByText("Forces and motion", { exact: true }),
  ).toHaveCSS("font-weight", "700");
  await page.getByText("Evidence used", { exact: true }).click();
  await expect(page.getByRole("list", { name: "Evidence used" })).toContainText("Confident but incorrect");
  const dashboardAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(dashboardAccessibility.violations).toEqual([]);
  await expect(page.getByRole("heading", { name: "Forces and motion", exact: true })).toBeVisible();
  await expect(page.getByText("Ready to review", { exact: true })).toBeVisible();

  await page.getByRole("heading", { name: "Forces and motion", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Vector addition", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(page.getByRole("heading", { name: "Course structure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("course deletion requires a separate destructive confirmation", async ({ page }) => {
  const state = await mockCourseOS(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app");

  const deleteButton = page.getByRole("button", { name: "Delete Forces and motion" });
  await page.getByRole("heading", { name: "Forces and motion", exact: true }).hover();
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete “Forces and motion”?" })).toBeVisible();
  expect(state.deleted()).toBe(false);

  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("heading", { name: "Bring the lecture. Manifold will build the draft." })).toBeVisible();
  expect(state.deleted()).toBe(true);
});

test("published course combines insights with overview and exposes durable assessment and policy workspaces", async ({ page }) => {
  const published = await mockPublishedCourseOS(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/app/courses/${published.id}`);

  await expect(page.getByRole("heading", { name: "Priority brief" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your course team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence inspector" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course structure × performance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topic health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning patterns" })).toBeVisible();
  await expect(page.getByText(/to review/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish updates" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review proposal" })).toBeEnabled();
  await expect(page.getByText("Learner uncertainty is concentrated in vector direction.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await page.getByRole("button", { name: /Course sources/ }).click();
  await expect(page.getByRole("heading", { name: "Sources & materials" })).toBeVisible();
  await expect(page.getByText("Force diagrams.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Close course sources" }).click();
  const overviewAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(overviewAccessibility.violations).toEqual([]);
  await expect(page.getByRole("button", { name: "Insights" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit course" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Changes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  await expect(page.getByText("Live revision", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Human checkpoint", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Assessments" }).click();
  await expect(page.getByRole("heading", { name: "Assessments" })).toBeVisible();
  await expect(page.getByText("What determines the direction of net force?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add assessment" })).toBeVisible();
  await page.getByRole("button", { name: "Preview remediation clip for Adds magnitudes only" }).click();
  await expect(page.getByLabel("Force systems clip")).toBeVisible();
  await page.getByRole("button", { name: "Close remediation clip preview" }).click();
  await page.getByRole("button", { name: "Edit What determines the direction of net force?" }).click();
  await expect(page.getByRole("heading", { name: "Edit assessment" })).toBeVisible();
  await expect(page.getByText("Editing private revision", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Learner clip preview" })).toBeVisible();
  await expect(page.getByLabel("Force systems clip")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings & policies" })).toBeVisible();
  await page.getByRole("button", { name: "Edit default policy" }).click();
  await expect(page.getByRole("heading", { name: "Edit course default" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview routing behavior" })).toBeVisible();
  await expect(page.getByText("Predicted route")).toBeVisible();
});
