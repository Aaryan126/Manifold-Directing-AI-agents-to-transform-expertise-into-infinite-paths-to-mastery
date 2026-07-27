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
const lectureVideoId = "12121212-1212-4212-8212-121212121212";

function oneLectureCourseFlow(courseId: string, revisionId: string, revisionKind: "active" | "working") {
  return {
    course_id: courseId,
    revision_id: revisionId,
    revision_kind: revisionKind,
    modules: [],
    units: [{
      id: "lecture-unit-1",
      logical_id: "lecture-unit-logical-1",
      module_logical_id: null,
      kind: "lecture",
      title: "Forces lecture",
      summary: "A complete lecture Blueprint.",
      instructions: "",
      video_id: lectureVideoId,
      sequence_rank: 0,
      status: "accepted",
      topic_count: 2,
      concept_count: 3,
      question_count: 1,
      source_count: 1,
      concept_logical_ids: ["concept-logical"],
      x: null,
      y: null,
    }],
    edges: [],
  };
}

async function mockCourseOS(page: Page) {
  await setInstructorSession(page);
  let deleted = false;
  const courseMessages = [{
    id: "55555555-5555-4555-8555-555555555555",
    role: "manifold",
    content: "Your complete private draft is ready for review.",
    blocks: [],
    created_at: "2026-07-21T00:00:00Z",
  }];
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
    if (path.endsWith("/messages/stream") && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { content: string };
      courseMessages.push(
        {
          id: "streamed-instructor-message",
          role: "instructor",
          content: body.content,
          blocks: [],
          created_at: "2026-07-21T00:01:00Z",
        },
        {
          id: "streamed-director-message",
          role: "manifold",
          content: "### Course update\n\n- **Vector addition** is covered.\n- One review decision remains.",
          blocks: [],
          created_at: "2026-07-21T00:01:01Z",
        },
      );
      await route.fulfill({
        body: [
          'event: status\ndata: {"message":"Inspecting the Blueprint…"}',
          'event: delta\ndata: {"content":"### Course update\\n\\n"}',
          'event: delta\ndata: {"content":"- **Vector addition** is covered.\\n- One review decision remains."}',
          'event: done\ndata: {"message_id":"streamed-director-message"}',
          "",
        ].join("\n\n"),
        contentType: "text/event-stream",
      });
      return;
    }
    if (path.endsWith("/messages")) {
      await route.fulfill({ json: courseMessages });
      return;
    }
    if (path.endsWith("/blueprint/evidence")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/course-flow")) {
      await route.fulfill({
        json: oneLectureCourseFlow(
          course.id,
          course.working_revision_id,
          "working",
        ),
      });
      return;
    }
    if (path.endsWith("/blueprint")) {
      await route.fulfill({
        json: {
          course_id: course.id,
          revision_id: course.working_revision_id,
          revision_kind: "working",
          nodes: [
            { id: "topic-1", logical_id: "topic-logical", kind: "topic", title: "Net force", status: "accepted", parent_id: null, metadata: { video_id: lectureVideoId } },
            { id: "concept-1", logical_id: "concept-logical", kind: "concept", title: "Vector addition", status: "accepted", parent_id: "topic-1", metadata: { sequence_rank: 1 } },
          ],
          edges: [{ id: "contains-1", source_id: "topic-1", target_id: "concept-1", kind: "contains", status: "accepted" }],
          uncovered_concept_ids: ["concept-1"],
        },
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
  let savedLayout: { positions?: Array<{ logical_artifact_id?: string; x?: number; y?: number }> } | null = null;
  const proposalDecisions: Array<{ proposal_id: string; decision: string }> = [];
  let editedConcept: { name?: string; description?: string } | null = null;
  let savedSequence: string[] = [];
  let savedTopicIds: string[] = [];
  const createdRelationships: Array<{
    relationship?: string;
    source_logical_id?: string;
    target_logical_id?: string;
  }> = [];
  const cleanupRequests: Array<Record<string, unknown>> = [];
  let workingRevisionOpen = false;
  const workingRevisionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
    if (path.endsWith("/studio")) return route.fulfill({
      json: {
        ...published,
        working_revision_id: workingRevisionOpen ? workingRevisionId : null,
        revision_status: workingRevisionOpen ? "working" : "published",
      },
    });
    if (path.endsWith("/messages") || path.endsWith("/review-bundles")) return route.fulfill({ json: [] });
    if (path.endsWith("/course-flow")) {
      const working = new URL(route.request().url()).searchParams.get("revision") === "working";
      return route.fulfill({
        json: oneLectureCourseFlow(
          published.id,
          working ? workingRevisionId : published.active_revision_id,
          working ? "working" : "active",
        ),
      });
    }
    if (path.endsWith("/map/layout") && route.request().method() === "PUT") {
      savedLayout = JSON.parse(route.request().postData() ?? "{}") as typeof savedLayout;
      workingRevisionOpen = true;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path.endsWith("/blueprint/relationships") && route.request().method() === "POST") {
      const relationship = JSON.parse(route.request().postData() ?? "{}") as {
        relationship?: string;
        source_logical_id?: string;
        target_logical_id?: string;
      };
      createdRelationships.push(relationship);
      workingRevisionOpen = true;
      return route.fulfill({ json: publishedBlueprint(editedConcept, "working") });
    }
    if (path.endsWith("/blueprint/relationships") && route.request().method() === "DELETE") {
      const relationship = JSON.parse(route.request().postData() ?? "{}") as {
        relationship?: string;
        source_logical_id?: string;
        target_logical_id?: string;
      };
      const match = createdRelationships.findIndex((item) => (
        item.relationship === relationship.relationship
        && item.source_logical_id === relationship.source_logical_id
        && item.target_logical_id === relationship.target_logical_id
      ));
      if (match >= 0) createdRelationships.splice(match, 1);
      return route.fulfill({ json: publishedBlueprint(editedConcept, "working") });
    }
    if (path.endsWith("/blueprint/sequence") && route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { concept_ids?: string[] };
      savedSequence = body.concept_ids ?? [];
      workingRevisionOpen = true;
      return route.fulfill({ json: publishedBlueprint(editedConcept, "working") });
    }
    if (path.includes("/blueprint/concepts/") && route.request().method() === "PATCH") {
      editedConcept = JSON.parse(route.request().postData() ?? "{}") as typeof editedConcept;
      workingRevisionOpen = true;
      return route.fulfill({ json: publishedBlueprint(editedConcept, "working") });
    }
    if (path.includes("/blueprint/concepts/") && path.endsWith("/topics") && route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { topic_logical_ids?: string[] };
      savedTopicIds = body.topic_logical_ids ?? [];
      workingRevisionOpen = true;
      return route.fulfill({ json: publishedBlueprint(editedConcept, "working") });
    }
    if (
      path.endsWith("/blueprint/artifacts/concept/concept-logical/impact")
      && route.request().method() === "GET"
    ) {
      return route.fulfill({
        json: {
          artifact_kind: "concept",
          logical_artifact_id: "concept-logical",
          title: editedConcept?.name ?? "Net force",
          affected_topics: ["Force systems"],
          affected_concepts: ["Net force"],
          affected_clips: ["Vector direction"],
          affected_questions: ["What determines the direction of net force?"],
          affected_relationships: 1,
          learner_records_preserved: true,
          warnings: ["Questions and clips shared with other concepts will be preserved."],
        },
      });
    }
    if (path.includes("/proposals/") && path.endsWith("/resolve")) {
      const body = JSON.parse(route.request().postData() ?? "{}") as { decision?: string };
      proposalDecisions.push({
        proposal_id: path.split("/").at(-2) ?? "",
        decision: body.decision ?? "",
      });
      if (body.decision !== "dismissed") workingRevisionOpen = true;
      return route.fulfill({ json: { status: body.decision } });
    }
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
    if (path.endsWith("/agent-tasks/task-1")) return route.fulfill({
      json: {
        task: {
          id: "task-1",
          specialist_role: "learning_analyst",
          task_type: "prepare_improvement",
          target_artifact_type: "concept",
          target_logical_artifact_id: "concept-logical",
          request_context: { instruction: "Clarify vector addition." },
          evidence_snapshot: { incorrect_attempts: 4 },
          status: "waiting_review",
          result: { summary: "A coordinated recovery pack is ready." },
          proposal_ids: ["proposal-1", "proposal-2", "proposal-3"],
          error_message: null,
          created_at: "2026-07-21T00:00:00Z",
          updated_at: "2026-07-21T00:00:00Z",
        },
        proposals: [
          { id: "proposal-1", task_id: "task-1", proposal_type: "artifact_update", artifact_type: "concept", target_logical_artifact_id: "concept-logical", before_state: { description: "Combine forces." }, proposed_state: { description: "Combine force vectors by magnitude and direction." }, rationale: "Clarify the misconception.", citations: [{ source_id: "source-1", section: 2 }], status: "proposed" },
          { id: "proposal-2", task_id: "task-1", proposal_type: "artifact_update", artifact_type: "question", target_logical_artifact_id: "question-logical", before_state: { body: "What is net force?" }, proposed_state: { body: "How do vector directions determine net force?" }, rationale: "Check vector direction explicitly.", citations: [], status: "proposed" },
          { id: "proposal-3", task_id: "task-1", proposal_type: "artifact_update", artifact_type: "clip", target_logical_artifact_id: "clip-logical", before_state: { end_seconds: 60 }, proposed_state: { end_seconds: 48 }, rationale: "Focus the recovery clip.", citations: [], status: "proposed" },
        ],
      },
    });
    if (path.endsWith("/agent-tasks") && route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      cleanupRequests.push(body);
      return route.fulfill({
        status: 201,
        json: {
          id: "cleanup-task",
          specialist_role: body.specialist_role,
          task_type: body.task_type,
          target_artifact_type: body.target_artifact_type,
          target_logical_artifact_id: body.target_logical_artifact_id,
          request_context: { instruction: body.instruction },
          evidence_snapshot: body.evidence,
          status: "queued",
          result: null,
          proposal_ids: [],
          error_message: null,
          created_at: "2026-07-21T00:00:00Z",
          updated_at: "2026-07-21T00:00:00Z",
        },
      });
    }
    if (path.endsWith("/agent-tasks")) return route.fulfill({
      json: [{
        id: "task-1",
        specialist_role: "learning_analyst",
        task_type: "prepare_improvement",
        target_artifact_type: "concept",
        target_logical_artifact_id: "concept-logical",
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
    if (path.endsWith("/blueprint/evidence")) return route.fulfill({
      json: [{
        concept_id: "concept-1",
        attempts: 8,
        touched_learners: 4,
        correct_percent: 50,
        confident_percent: 75,
        confident_incorrect: 2,
        mastery: { mastered: 2, practiced: 1, struggling: 1 },
        route_actions: { remediate: 3, advance: 2 },
      }],
    });
    if (path.endsWith("/blueprint")) {
      const revision = new URL(route.request().url()).searchParams.get("revision") === "working"
        ? "working"
        : "active";
      return route.fulfill({ json: publishedBlueprint(editedConcept, revision) });
    }
    if (path.endsWith("/revision-diff")) return route.fulfill({
      json: {
        active_revision_id: published.active_revision_id,
        working_revision_id: workingRevisionId,
        changes: workingRevisionOpen ? [{
          artifact_type: "concept",
          logical_artifact_id: "concept-logical",
          change_type: "changed",
          before_state: { name: "Net force" },
          after_state: { name: editedConcept?.name ?? "Net force" },
        }] : [],
      },
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
          id: "clip-working",
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
          primary_concept_id: "concept-1",
          concept_ids: ["concept-1"],
          type: "short_answer",
          correct_answer: { answer: "vector sum" },
          confidence_prompt: "How confident are you?",
          review_status: "accepted",
          remediation_rules: [{ id: "rule-1", wrong_answer_pattern: "Adds magnitudes only", target_clip_id: "clip-working", target_concept_id: "concept-1" }],
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
  function publishedBlueprint(
    conceptEdit: typeof editedConcept,
    revisionKind: "active" | "working" = "active",
  ) {
    const working = revisionKind === "working";
    const topicId = working ? "topic-working" : "topic-1";
    const topicTwoId = working ? "topic-working-2" : "topic-2";
    const conceptId = working ? "concept-working" : "concept-1";
    const conceptTwoId = working ? "concept-working-2" : "concept-2";
    const clipId = working ? "clip-working" : "clip-1";
    const questionId = working ? "question-working" : "question-1";
    const sourceId = working ? "source-working" : "source-1";
    const nodeIdsByLogicalId: Record<string, string> = {
      "topic-logical": topicId,
      "topic-logical-2": topicTwoId,
      "concept-logical": conceptId,
      "concept-logical-2": conceptTwoId,
      "clip-logical": clipId,
      "question-logical": questionId,
      "source-logical": sourceId,
    };
    return {
      course_id: published.id,
      revision_id: working ? workingRevisionId : published.active_revision_id,
      revision_kind: revisionKind,
      nodes: [
        { id: topicId, logical_id: "topic-logical", kind: "topic", title: "Force systems", status: "accepted", parent_id: null, metadata: { video_id: lectureVideoId } },
        { id: topicTwoId, logical_id: "topic-logical-2", kind: "topic", title: "Balanced systems", status: "accepted", parent_id: null, metadata: { sequence_rank: 2 } },
        { id: conceptId, logical_id: "concept-logical", kind: "concept", title: conceptEdit?.name ?? "Net force", status: "accepted", parent_id: topicId, metadata: { sequence_rank: 1, description: conceptEdit?.description ?? "Combine force vectors." } },
        { id: conceptTwoId, logical_id: "concept-logical-2", kind: "concept", title: "Balanced forces", status: "accepted", parent_id: topicId, metadata: { sequence_rank: 2, description: "Recognize equilibrium." } },
        { id: clipId, logical_id: "clip-logical", kind: "clip", title: "Vector direction", status: "accepted", parent_id: topicId, metadata: { duration_seconds: 60, start_seconds: 0, end_seconds: 60 } },
        { id: questionId, logical_id: "question-logical", kind: "question", title: "In the ukulele example, why did the speaker focus on learning only a small set of chords before performing?", status: "accepted", parent_id: topicId, metadata: { type: "short_answer" } },
        { id: sourceId, logical_id: "source-logical", kind: "source", title: "Force diagrams.pdf", status: "accepted", parent_id: null, metadata: { source_type: "pdf" } },
      ],
      edges: [
        { id: "contains-1", source_id: topicId, target_id: conceptId, kind: "contains", status: "accepted" },
        { id: "contains-2", source_id: topicTwoId, target_id: conceptTwoId, kind: "contains", status: "accepted" },
        { id: "next-1", source_id: conceptId, target_id: conceptTwoId, kind: "next", status: "accepted" },
        { id: "teaches-1", source_id: clipId, target_id: conceptId, kind: "teaches", status: "accepted" },
        { id: "assesses-1", source_id: questionId, target_id: conceptId, kind: "assesses", status: "accepted" },
        { id: "cites-1", source_id: sourceId, target_id: conceptId, kind: "cites", status: "accepted" },
        ...createdRelationships.map((relationship, index) => ({
          id: `manual-${index}-${relationship.relationship}`,
          source_id: nodeIdsByLogicalId[relationship.source_logical_id ?? ""] ?? "",
          target_id: nodeIdsByLogicalId[relationship.target_logical_id ?? ""] ?? "",
          kind: relationship.relationship,
          status: "accepted",
        })),
      ],
      uncovered_concept_ids: [conceptTwoId],
    };
  }
  return {
    cleanupRequests,
    createdRelationships,
    published,
    proposalDecisions,
    savedLayout: () => savedLayout,
    editedConcept: () => editedConcept,
    savedSequence: () => savedSequence,
    savedTopicIds: () => savedTopicIds,
  };
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
  await page.getByRole("button", { name: "New course" }).click();
    await expect(page.getByRole("dialog", { name: "Name the course" })).toBeVisible();
  await expect(page.getByLabel("Course title")).toBeVisible();
  await expect(page.getByText(/add lectures and build their Blueprints/i)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Needs your judgment", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learner activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course radar" })).toHaveCount(0);
  const activityChart = page.getByRole("img", { name: /Daily active learners over the last seven days/ });
  await expect(activityChart).toBeVisible();
  await expect(activityChart.locator("[data-value]")).toHaveCount(7);
  await expect(page.getByText("enrolled learners", { exact: true })).toBeVisible();
  await expect(page.getByText("new this week", { exact: true })).toBeVisible();
  const priorityPanel = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Needs your judgment", exact: true }),
  });
  const learnerActivityPanel = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Learner activity", exact: true }),
  });
  const priorityBounds = await priorityPanel.boundingBox();
  const activityBounds = await learnerActivityPanel.boundingBox();
  expect(priorityBounds).not.toBeNull();
  expect(activityBounds).not.toBeNull();
  expect(Math.abs(priorityBounds!.y - activityBounds!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(priorityBounds!.width - activityBounds!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(priorityBounds!.height - activityBounds!.height)).toBeLessThanOrEqual(1);
  expect(priorityBounds!.x).toBeLessThan(activityBounds!.x);
  const intelligenceHeadline = page.getByRole("heading", { name: /2 of 2 open issues/i });
  await expect(intelligenceHeadline).toBeVisible();
  expect(await intelligenceHeadline.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText("Portfolio summary", { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask Manifold anything…")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Forces and motion", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Course views" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assessments" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Course Director" })).toBeVisible();
  await page.getByRole("button", { name: "Open Course Director" }).click();
  await expect(page.getByText("Your complete private draft is ready for review.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Course Director" })).toBeVisible();
  const directorTitle = page.locator("#conversation-title");
  const directorHeaderBounds = await directorTitle.locator("xpath=../../..").boundingBox();
  const directorIdentityBounds = await directorTitle.locator("..").boundingBox();
  expect(directorHeaderBounds).not.toBeNull();
  expect(directorIdentityBounds).not.toBeNull();
  const directorHeaderTopGap = directorIdentityBounds!.y - directorHeaderBounds!.y;
  const directorHeaderBottomGap = directorHeaderBounds!.y
    + directorHeaderBounds!.height
    - directorIdentityBounds!.y
    - directorIdentityBounds!.height;
  expect(Math.abs(directorHeaderTopGap - directorHeaderBottomGap)).toBeLessThanOrEqual(1);
  expect(directorHeaderTopGap).toBeGreaterThanOrEqual(16);
  await page.getByLabel("Message Course Director").fill("Summarize this Blueprint");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Course update", level: 3 })).toBeVisible();
  expect(await page.getByText("Vector addition", { exact: true }).evaluate((element) => element.tagName)).toBe("STRONG");
  await expect(page.getByRole("listitem").filter({ hasText: "One review decision remains." })).toBeVisible();
  await page.getByRole("button", { name: "Close Course Director" }).click();
  await expect(page.getByText("Your complete private draft is ready for review.")).toHaveCount(0);
});

test("new course retries reuse one idempotency key", async ({ page }) => {
  await mockCourseOS(page);
  const requestKeys: string[] = [];
  let attempts = 0;
  await page.route("http://localhost:8000/courses", async (route) => {
    attempts += 1;
    requestKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Please retry." }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        ...course,
        id: "99999999-9999-4999-8999-999999999999",
        title: "Mechanics",
      },
    });
  });
  await page.goto("/app");

  await page.getByRole("button", { name: "New course" }).click();
  await page.getByLabel("Course title").fill("Mechanics");
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByText("Please retry.")).toBeVisible();
  await page.getByRole("button", { name: "Create course" }).click();

  await expect(page).toHaveURL(/\/app\/courses\/99999999-9999-4999-8999-999999999999$/);
  expect(requestKeys).toHaveLength(2);
  expect(requestKeys[0]).not.toBe("");
  expect(requestKeys[1]).toBe(requestKeys[0]);
});

test("course studio exposes Blueprint, review decisions, and a mobile-safe layout", async ({ page }) => {
  await mockCourseOS(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/courses/${course.id}`);

  const openLecture = page.getByRole("button", { name: "Open Blueprint for Forces lecture" });
  await openLecture.focus();
  await openLecture.press("Enter");
  await expect(page.getByRole("heading", { name: "Forces lecture", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Blueprint", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assessments", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Review/ })).toHaveCount(0);
  await expect(page.getByText("Lecture Blueprint", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Blueprint", exact: true }).click();
  await expect(page.getByText("Private design")).toBeVisible();
  await page.getByRole("button", { name: "Net force 1 concepts" }).click();
  await expect(page.getByRole("button", { name: "Vector addition", exact: true })).toBeVisible();
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

test("Blueprint uses the detailed free-form graph and atomic proposal workflow", async ({ page }) => {
  test.setTimeout(60_000);
  const state = await mockPublishedCourseOS(page);
  const { published } = state;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/app/courses/${published.id}`);

  await expect(page.getByRole("button", { name: "Assessments" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Course settings" })).toBeVisible();
  await page.getByRole("button", { name: "New lecture" }).click();
  await expect(page.getByPlaceholder("What lecture would you like to add? Paste a lecture link or add a file…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Course Flow" })).toBeVisible();
  await page.getByRole("button", { name: "Course Flow" }).click();
  await page.getByText("Forces lecture", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Blueprint", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Old Blueprint" })).toHaveCount(0);
  await expect(page.getByText("Private design")).toBeVisible();
  const blueprintSummary = page.getByRole("group", { name: "Blueprint status and metrics" });
  await expect(blueprintSummary.getByText("50%")).toBeVisible();
  await expect(blueprintSummary.getByText("8 attempts")).toBeVisible();
  const blueprintSummaryBounds = await blueprintSummary.boundingBox();
  expect(blueprintSummaryBounds).not.toBeNull();
  expect(blueprintSummaryBounds!.height).toBeLessThanOrEqual(44);
  expect(blueprintSummaryBounds!.width).toBeGreaterThan(560);
  expect(blueprintSummaryBounds!.width).toBeLessThan(820);
  await expect(page.getByText("Blueprint status")).toHaveCount(0);
  await expect(page.getByText("Learner-facing course")).toHaveCount(0);
  await expect(page.getByText("Adaptive course system")).toHaveCount(0);
  await expect(page.getByText("Published course", { exact: true })).toHaveCount(0);
  const courseViews = page.getByRole("navigation", { name: "Course views" });
  expect(await courseViews.evaluate((element) => element.parentElement?.className.includes("studioHeader")))
    .toBe(true);
  await expect(courseViews.getByRole("button")).toHaveCount(3);
  await expect(courseViews.getByRole("button", { name: "Course Flow" })).toHaveCount(0);
  await expect(page.getByText("Lecture Blueprint", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Forces lecture", level: 1 })).toBeVisible();
  expect(await page.getByRole("button", { name: "Sources" }).evaluate(
    (element) => element.closest("header")?.className.includes("studioHeader"),
  )).toBe(true);
  await expect(page.getByText(/concepts are missing a reviewed assessment or teaching artifact/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
  const blueprintMode = page.getByRole("navigation", { name: "Blueprint mode" });
  expect(await blueprintMode.evaluate((element) => element.parentElement?.className.includes("blueprintCommandActions")))
    .toBe(true);
  await expect(page.getByRole("button", { name: "Core" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Auto arrange" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /artifact inspector/ })).toHaveCount(0);
  const conceptNode = page.getByTestId("rf__node-concept-1");
  const clipNode = page.getByTestId("rf__node-clip-1");
  const sourceNode = page.getByTestId("rf__node-source-1");
  await expect(conceptNode).toBeInViewport();
  await expect(sourceNode).toBeInViewport();
  await expect(conceptNode.locator("article[data-kind='concept']")).toBeVisible();
  await expect(sourceNode.locator("article[data-kind='source']")).toBeVisible();
  await expect(conceptNode.locator("article[data-kind='concept']")).toHaveCSS("background-color", "rgb(227, 237, 242)");
  await expect(clipNode.locator("article[data-kind='clip']")).toHaveCSS("background-color", "rgb(226, 240, 223)");
  await expect(sourceNode.locator("article[data-kind='source']")).toHaveCSS("background-color", "rgb(238, 234, 226)");
  await clipNode.click();
  await expect(page.getByRole("heading", { name: "Vector direction" })).toBeVisible();
  await expect(page.getByLabel("Force systems clip")).toBeVisible();
  await page.getByRole("button", { name: "Close artifact inspector" }).click();
  const blueprintFlow = page.locator(".react-flow").filter({ has: conceptNode });
  await expect(blueprintFlow.getByRole("button", { name: /zoom in/i })).toBeVisible();
  await expect(blueprintFlow.getByRole("button", { name: /zoom out/i })).toBeVisible();
  await expect(blueprintFlow.getByRole("button", { name: /fit view/i })).toBeVisible();
  const blueprintBounds = await blueprintFlow.boundingBox();
  const controlBounds = await blueprintFlow.locator(".react-flow__controls").boundingBox();
  expect(blueprintBounds).not.toBeNull();
  expect(controlBounds).not.toBeNull();
  expect(Math.abs((blueprintBounds!.y + blueprintBounds!.height) - 960)).toBeLessThan(3);
  expect(controlBounds!.x - blueprintBounds!.x).toBeLessThan(32);
  expect((blueprintBounds!.y + blueprintBounds!.height) - (controlBounds!.y + controlBounds!.height)).toBeLessThan(40);
  expect(await blueprintFlow.locator("article[class*='blueprintTypedNode']").evaluateAll((nodes) => nodes.every((node) => {
    const title = node.querySelector("strong");
    const footer = node.querySelector("footer");
    if (!title || !footer) return false;
    const nodeBounds = node.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    return titleBounds.bottom <= footerBounds.top + 1
      && footerBounds.bottom <= nodeBounds.bottom + 1;
  }))).toBe(true);
  const citationEdge = page.getByTestId("rf__edge-cites-1").locator(".react-flow__edge-path");
  await expect(citationEdge).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "All" }).click();
  await expect(citationEdge).toHaveCSS("opacity", "0.62");
  await page.getByRole("button", { name: "Core" }).click();
  await expect.poll(() => page.locator(".react-flow__node").evaluateAll((nodes) => {
    const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (!canvas || !nodes.length) return false;
    return nodes.every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= canvas.left - 1
        && rect.right <= canvas.right + 1
        && rect.top >= canvas.top - 1
        && rect.bottom <= canvas.bottom + 1;
    });
  })).toBe(true);
  await conceptNode.click();
  await expect(citationEdge).toHaveCSS("opacity", "1");
  const conceptInspector = page.getByRole("dialog", { name: "Net force artifact inspector" });
  await expect(conceptInspector.getByRole("heading", { name: "Net force" })).toBeVisible();
  await expect(conceptInspector.getByText("50%", { exact: true })).toBeVisible();
  await expect(page.getByText("Private proposal pack")).toBeVisible();
  await expect(page.getByText("3 decisions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: /accept all/i })).toHaveCount(0);
  const pack = page.locator('section[class*="proposalPack"]');
  const conceptProposal = pack.locator("article").filter({ hasText: "Clarify the misconception." });
  const questionProposal = pack.locator("article").filter({ hasText: "Check vector direction explicitly." });
  const clipProposal = pack.locator("article").filter({ hasText: "Focus the recovery clip." });
  await conceptProposal.getByRole("button", { name: "Accept" }).click();
  await clipProposal.getByRole("button", { name: "Dismiss" }).click();
  await questionProposal.getByRole("button", { name: "Edit" }).click();
  await questionProposal.getByLabel("Edit proposed artifact JSON").fill('{"body":"Which direction does the vector sum point?"}');
  await questionProposal.getByRole("button", { name: "Save edit" }).click();
  await expect.poll(() => state.proposalDecisions.map((item) => item.decision).sort())
    .toEqual(["accepted", "dismissed", "edited"]);
  await expect(pack.getByText("0 decisions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Close artifact inspector" })).toBeVisible();
  await page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog", { name: /artifact inspector/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Design" }).click();
  await page.getByRole("button", { name: "Auto arrange" }).click();
  const designConceptNode = page.getByTestId("rf__node-concept-working");
  await expect(designConceptNode).toBeVisible();
  await designConceptNode.click();
  await expect(page.getByRole("heading", { name: "Net force" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit concept fields" })).toBeVisible();
  await expect(designConceptNode).toHaveClass(/draggable/);
  await expect(page.getByTestId("rf__node-source-working")).not.toHaveClass(/connectable/);
  await page.getByRole("button", { name: "Edit concept fields" }).click();
  await page.getByLabel("Name").fill("Net force vectors");
  await page.getByLabel("Description").fill("Combine vectors by magnitude and direction.");
  await page.getByRole("button", { name: "Save private edit" }).click();
  await expect.poll(() => state.editedConcept()?.name).toBe("Net force vectors");
  await expect(designConceptNode).toBeVisible();
  await expect(page.getByRole("button", { name: "Add node" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Topic", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Concept", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add node" }).click();
  await page.getByRole("menuitem", { name: /Topic/ }).click();
  await expect(page.getByRole("heading", { name: "New topic" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add node" }).click();
  await page.getByRole("menuitem", { name: /Concept/ }).click();
  await expect(page.getByRole("heading", { name: "New concept" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Close artifact inspector" }).click();
  await expect(designConceptNode).toBeInViewport();
  await page.waitForTimeout(350);
  const designConceptBounds = await designConceptNode.boundingBox();
  expect(designConceptBounds).not.toBeNull();
  await page.mouse.move(
    designConceptBounds!.x + designConceptBounds!.width / 2,
    designConceptBounds!.y + designConceptBounds!.height / 2,
  );
  const relationshipPorts = designConceptNode.locator(
    '[aria-label="Create a relationship from Net force vectors"]',
  );
  await expect(relationshipPorts.locator("button")).toHaveCount(4);
  await relationshipPorts.locator(
    'button[aria-label="Create relationship from the right of Net force vectors"]',
  ).dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "What should this connection mean?" })).toBeVisible();
  await page.getByRole("button", { name: /Prerequisite/ }).click();
  await page.getByTestId("rf__node-concept-working-2").dispatchEvent("click");
  await expect.poll(() => state.createdRelationships.at(-1)).toEqual({
    relationship: "requires",
    source_logical_id: "concept-logical",
    target_logical_id: "concept-logical-2",
  });
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect(designConceptNode).toBeInViewport();
  await page.getByRole("button", { name: "Undo Add prerequisite connection" }).click();
  await expect.poll(() => state.createdRelationships.length).toBe(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect(designConceptNode).toBeInViewport();
  await page.waitForTimeout(350);
  const restoredConceptBounds = await designConceptNode.boundingBox();
  expect(restoredConceptBounds).not.toBeNull();
  await page.mouse.move(
    restoredConceptBounds!.x + restoredConceptBounds!.width / 2,
    restoredConceptBounds!.y + restoredConceptBounds!.height / 2,
  );
  await relationshipPorts.locator(
    'button[aria-label="Create relationship from the right of Net force vectors"]',
  ).dispatchEvent("click");
  await page.getByRole("button", { name: /Prerequisite/ }).click();
  await page.getByTestId("rf__node-concept-working-2").dispatchEvent("click");
  await expect.poll(() => state.createdRelationships.length).toBe(1);
  await expect(page.getByRole("button", { name: "Undo Add prerequisite connection" })).toBeEnabled();
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "z",
      metaKey: true,
    }));
  });
  await expect.poll(() => state.createdRelationships.length).toBe(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect(designConceptNode).toBeInViewport();
  await expect(page.getByText("Saved privately")).toBeVisible();
  await page.getByRole("button", { name: "Learning order" }).click();
  await expect(page.getByRole("heading", { name: "Learning order" })).toBeVisible();
  await page.getByRole("button", { name: "Move Net force vectors later" }).click();
  await page.getByRole("button", { name: "Save learning order" }).click();
  await expect.poll(() => state.savedSequence()).toEqual(["concept-logical-2", "concept-logical"]);
  await expect(page.getByText("Private edit saved")).toBeVisible();
  await page.getByRole("button", { name: "Prepare AI cleanup" }).click();
  await expect.poll(() => state.cleanupRequests.at(-1)?.task_type).toBe("cleanup_blueprint");
  await expect.poll(() => state.cleanupRequests.at(-1)?.target_logical_artifact_id)
    .toBe("concept-logical");
  await page.getByRole("button", { name: "Remove concept" }).click();
  await expect(page.getByRole("heading", { name: /Remove “Net force vectors”/ })).toBeVisible();
  await expect(page.getByText("Learner history and evidence records are preserved.")).toBeVisible();
  await page.getByRole("button", { name: "Keep artifact" }).click();
  await expect(page.getByRole("button", { name: "Learner path" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revision" })).toHaveCount(0);
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.getByRole("heading", { name: "Net force" })).toBeVisible();
  await expect(page.getByText(/to review/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish updates" })).toBeEnabled();
  await page.getByRole("button", { name: /sources.*1/i }).click();
  await expect(page.getByRole("heading", { name: "Sources & materials" })).toBeVisible();
  await expect(page.getByLabel("Course sources", { exact: true }).getByText("Force diagrams.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Close course sources" }).click();
  const overviewAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(overviewAccessibility.violations).toEqual([]);
  await expect(page.getByRole("button", { name: "Insights" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit course" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Changes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
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

  await page.getByRole("button", { name: "Course settings" }).click();
  await expect(page.getByText("Routing settings")).toBeVisible();
  await page.getByRole("button", { name: "Edit course default" }).click();
  await expect(page.getByRole("heading", { name: "Edit course default" })).toBeVisible();
});

test("saving a dragged Blueprint node keeps the graph mounted", async ({ page }) => {
  const state = await mockPublishedCourseOS(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/app/courses/${state.published.id}`);
  await page.getByText("Forces lecture", { exact: true }).click();
  await page.getByRole("button", { name: "Design" }).click();
  await page.getByRole("button", { name: "Auto arrange" }).click();

  const conceptNode = page.getByTestId("rf__node-concept-1");
  await expect(conceptNode).toBeVisible();
  const bounds = await conceptNode.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2 + 80,
    bounds!.y + bounds!.height / 2 + 48,
    { steps: 10 },
  );
  await page.mouse.up();

  await expect.poll(() => state.savedLayout()?.positions?.[0]?.logical_artifact_id)
    .toBe("concept-logical");
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect(page.getByTestId("rf__node-concept-working")).toBeVisible();
});
