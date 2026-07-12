"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import {
  type Concept,
  type ConceptEdge,
  graphEdgeModels,
  graphNodeModels,
} from "./graphModel";
import {
  assessmentGenerationBlockReason,
  learnerAccessBlockedReason,
  reviewedConceptCountForAssessment,
  usableClipCountForAssessment,
} from "./assessmentReview";
import {
  clipSpotCheckActionsDisabled,
  reviewedConceptCountForTopic,
  isTopicReviewedForClipGeneration,
  topicClipGenerationBlockReason,
} from "./clipReview";
import { ProviderVideo, type PlaybackInfo } from "./ProviderVideo";
import {
  dashboardActionScopeLabel,
  dashboardColdStartMessage,
  dashboardSignalRecommendedAction,
  dashboardSignalSummary,
  dashboardSignalTitle,
} from "./dashboardReview";
import {
  clipForRoute,
  masterySummary,
  routeTone,
  type LearnerProgress,
} from "./learnerExperience";
import { acceptButtonDisabled, acceptButtonLabel } from "./reviewState";
import {
  defaultRoutingPolicyDraft,
  policyLabel,
  routingPolicyValidationError,
  type RoutingPolicyDraft,
} from "./routingPolicy";
import { detectCoverageGaps } from "./topicCoverage";
import { graphGenerationBlockedReason, reviewedTopicCount } from "./topicReview";
import {
  aiRationale,
  instructorTrace,
  traceabilityStatus,
  type TraceableArtifact,
} from "./traceability";
import { CourseFoundryShell } from "@/components/coursefoundry-shell";

type Job = {
  id: string;
  video_id: string | null;
  course_id: string | null;
  source_kind: string;
  source_uri: string;
  status: "queued" | "processing" | "complete" | "failed";
  progress: number;
  error_message: string | null;
};

type Transcript = {
  text: string;
  words: Array<{
    text: string;
    start_seconds: number;
    end_seconds: number;
  }>;
};

type Topic = {
  id: string;
  course_id: string;
  video_id: string;
  title: string;
  summary: string | null;
  start_seconds: number;
  end_seconds: number;
  review_status: "proposed" | "accepted" | "edited" | "dismissed";
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
  approved_at: string | null;
  dismissed_at: string | null;
};

type GraphResponse = {
  course_id: string;
  concepts: Concept[];
  edges: ConceptEdge[];
  warnings: string[];
};

type Clip = {
  id: string;
  topic_id: string;
  start_seconds: number;
  end_seconds: number;
  type:
    | "definition"
    | "worked_example"
    | "explanation"
    | "misconception_correction"
    | "prerequisite_recap";
  difficulty: string | null;
  status: "active" | "flagged" | "superseded";
  concept_ids: string[];
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
  flagged_at: string | null;
  flag_note: string | null;
  superseded_by_clip_id: string | null;
  source_clip_id: string | null;
  created_at: string | null;
};

type RemediationRule = {
  id: string;
  question_id: string;
  wrong_answer_pattern: string;
  target_clip_id: string | null;
  target_concept_id: string | null;
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
};

type Question = {
  id: string;
  topic_id: string;
  body: string;
  type: "mcq" | "short_answer" | "worked_problem";
  correct_answer: Record<string, unknown>;
  confidence_prompt: string;
  review_status: "proposed" | "accepted" | "edited" | "dismissed";
  ai_proposal: Record<string, unknown> | null;
  instructor_revision: Record<string, unknown> | null;
  approved_at: string | null;
  dismissed_at: string | null;
  remediation_rules: RemediationRule[];
};

type RoutingPolicy = RoutingPolicyDraft & {
  concept_id: string | null;
};

type RouteDecision = {
  action: string;
  mastery_state: string;
  why: string;
  target_concept_id: string | null;
  target_clip_id: string | null;
  dashboard_signal_id: string | null;
};

type DashboardSignal = {
  id: string;
  course_id: string;
  type: "stuck_cohort" | "underperforming_content" | "graph_drift";
  related_entity_type: string;
  related_entity_id: string;
  status: "open" | "accepted" | "edited" | "dismissed";
  ai_diagnosis: Record<string, unknown>;
  instructor_action: Record<string, unknown> | null;
};

type DashboardSummary = {
  course_id: string;
  learner_count: number;
  attempt_count: number;
  not_enough_data: boolean;
  signals: DashboardSignal[];
};

type DevelopmentIdentity = {
  id: string;
  email: string;
  display_name: string;
  role: "instructor" | "learner";
};

type DeliveryCapacity = {
  provider: "local" | "mux";
  stored_count: number;
  max_stored: number | null;
  remaining: number | null;
  can_upload: boolean;
};

type CourseInfo = {
  id: string;
  instructor_id: string;
  title: string;
  description: string | null;
  status: "draft" | "published";
  published_at: string | null;
};

type PublishReadiness = {
  course_id: string;
  ready: boolean;
  blockers: string[];
};

const pipelineBaseUrl =
  process.env.NEXT_PUBLIC_PIPELINE_BASE_URL ?? "http://localhost:8000";

export default function HomePage() {
  const [identities, setIdentities] = useState<DevelopmentIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [deliveryCapacity, setDeliveryCapacity] = useState<DeliveryCapacity | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [routingPolicies, setRoutingPolicies] = useState<RoutingPolicy[]>([]);
  const [clipNotes, setClipNotes] = useState<Record<string, string>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, RoutingPolicyDraft>>({});
  const [demoLearnerId, setDemoLearnerId] = useState<string | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [routeDecision, setRouteDecision] = useState<RouteDecision | null>(null);
  const [learnerProgress, setLearnerProgress] = useState<LearnerProgress[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardNotes, setDashboardNotes] = useState<Record<string, string>>({});
  const [dashboardRetroactive, setDashboardRetroactive] = useState<Record<string, boolean>>({});
  const [overrideLearnerId, setOverrideLearnerId] = useState("");
  const [overrideConceptId, setOverrideConceptId] = useState("");
  const [overrideAction, setOverrideAction] = useState<"skip_ahead" | "send_back">("send_back");
  const [activeLearnerTopicId, setActiveLearnerTopicId] = useState<string | null>(null);
  const [conceptDrafts, setConceptDrafts] = useState<Record<string, ConceptDraft>>({});
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [newEdge, setNewEdge] = useState<EdgeDraft>({
    from_concept_id: "",
    to_concept_id: "",
    rationale: "",
  });
  const [topicDrafts, setTopicDrafts] = useState<Record<string, TopicDraft>>({});
  const [manualTopic, setManualTopic] = useState<TopicDraft>({
    title: "",
    summary: "",
    start_seconds: 0,
    end_seconds: 600,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const selectedIdentity =
    identities.find((identity) => identity.id === selectedIdentityId) ?? null;
  const isLearnerContext = selectedIdentity?.role === "learner";
  const sourceStartSeconds = transcript ? transcriptStartSeconds(transcript) : 0;
  const sourceEndSeconds = transcript ? transcriptEndSeconds(transcript) : 0;
  const coverageGaps =
    transcript && topics.length > 0
      ? detectCoverageGaps(topics, sourceStartSeconds, sourceEndSeconds)
      : [];
  const graphBlockReason = graphGenerationBlockedReason(topics);
  const reviewedTopics = reviewedTopicCount(topics);
  const flowNodes: FlowNode[] = graph
    ? graphNodeModels(graph.concepts).map((node) => ({
        id: node.id,
        position: { x: node.x, y: node.y },
        data: { label: `${node.label}\n${node.status}` },
        className: node.muted ? "graphNode muted" : "graphNode",
      }))
    : [];
  const flowEdges: FlowEdge[] = graph
    ? graphEdgeModels(graph.edges).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: !edge.muted,
        className: edge.muted ? "graphEdge muted" : "graphEdge",
        label: edge.status,
      }))
    : [];
  const learnerQuestions = questions.filter(
    (question) => question.review_status === "accepted" || question.review_status === "edited",
  );
  const activeLearnerQuestion =
    learnerQuestions.find((question) => question.topic_id === activeLearnerTopicId) ??
    learnerQuestions[0] ??
    null;
  const activeLearnerTopic =
    topics.find((topic) => topic.id === activeLearnerQuestion?.topic_id) ?? null;
  const activeLearnerClip = clipForRoute(
    clips,
    routeDecision,
    activeLearnerTopic?.id ?? null,
  );
  const publishReadinessRevision = [
    ...topics.map((topic) => `topic:${topic.id}:${topic.review_status}`),
    ...(graph?.concepts.map(
      (concept) => `concept:${concept.id}:${concept.review_status}`,
    ) ?? []),
    ...(graph?.edges.map((edge) => `edge:${edge.id}:${edge.review_status}`) ?? []),
    ...questions.map((question) => `question:${question.id}:${question.review_status}`),
  ]
    .sort()
    .join("|");

  useEffect(() => {
    async function initializeDevelopmentContext() {
      const [identityResponse, capacityResponse] = await Promise.all([
        fetch(`${pipelineBaseUrl}/development/identities`),
        fetch(`${pipelineBaseUrl}/videos/delivery/capacity`),
      ]);
      if (identityResponse.ok) {
        const nextIdentities = (await identityResponse.json()) as DevelopmentIdentity[];
        setIdentities(nextIdentities);
        setSelectedIdentityId(
          (current) =>
            current ||
            nextIdentities.find((identity) => identity.role === "instructor")?.id ||
            nextIdentities[0]?.id ||
            "",
        );
      }
      if (capacityResponse.ok) {
        setDeliveryCapacity((await capacityResponse.json()) as DeliveryCapacity);
      }
    }

    void initializeDevelopmentContext();
  }, []);

  useEffect(() => {
    const courseId = job?.course_id;
    if (!courseId || selectedIdentity?.role !== "instructor") return;
    const instructorId = selectedIdentity.id;

    let cancelled = false;
    async function refreshReadiness() {
      const response = await fetch(
        `${pipelineBaseUrl}/courses/${courseId}/publish-readiness`,
        { headers: { "X-User-ID": instructorId } },
      );
      if (response.ok && !cancelled) {
        setPublishReadiness((await response.json()) as PublishReadiness);
      }
    }

    void refreshReadiness();
    return () => {
      cancelled = true;
    };
  }, [
    job?.course_id,
    publishReadinessRevision,
    selectedIdentity?.id,
    selectedIdentity?.role,
  ]);

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setMessage("Choose a video or audio file first.");
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    setTranscript(null);
    setTopics([]);
    setGraph(null);
    setClips([]);
    setQuestions([]);
    setRoutingPolicies([]);
    setDemoLearnerId(null);
    setRouteDecision(null);
    setLearnerProgress([]);
    setDashboardSummary(null);
    setActiveLearnerTopicId(null);
    setPlayback(null);
    setCourse(null);
    setPublishReadiness(null);
    setIsEnrolled(false);
    const formData = new FormData();
    formData.append("file", selectedFile);
    await createJob(`${pipelineBaseUrl}/videos/upload`, {
      method: "POST",
      body: formData,
    });
  }

  async function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setTranscript(null);
    setTopics([]);
    setGraph(null);
    setClips([]);
    setQuestions([]);
    setRoutingPolicies([]);
    setDemoLearnerId(null);
    setRouteDecision(null);
    setLearnerProgress([]);
    setDashboardSummary(null);
    setActiveLearnerTopicId(null);
    setPlayback(null);
    setCourse(null);
    setPublishReadiness(null);
    setIsEnrolled(false);
    await createJob(`${pipelineBaseUrl}/videos/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  }

  async function createJob(endpoint: string, init: RequestInit) {
    try {
      const response = await fetch(endpoint, init);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? `Request failed with ${response.status}`);
      }
      setJob((await response.json()) as Job);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshJob() {
    if (!job) return;
    setMessage(null);
    const response = await fetch(`${pipelineBaseUrl}/videos/jobs/${job.id}`);
    if (!response.ok) {
      setMessage(`Job refresh failed with ${response.status}.`);
      return;
    }
    const nextJob = (await response.json()) as Job;
    setJob(nextJob);
    if (nextJob.status === "complete" && nextJob.video_id) {
      const transcriptResponse = await fetch(
        `${pipelineBaseUrl}/videos/${nextJob.video_id}/transcript`,
      );
      if (transcriptResponse.ok) {
        setTranscript((await transcriptResponse.json()) as Transcript);
        await loadTopics(nextJob.video_id);
        await loadClips(nextJob.video_id);
        await loadQuestions(nextJob.video_id);
        if (nextJob.course_id) {
          await loadGraph(nextJob.course_id);
          await loadRoutingPolicies(nextJob.course_id);
          await loadDashboard(nextJob.course_id);
          await loadCourse(nextJob.course_id);
        }
        await loadPlayback(nextJob.video_id);
        await loadDeliveryCapacity();
      }
    }
  }

  async function loadDeliveryCapacity() {
    const response = await fetch(`${pipelineBaseUrl}/videos/delivery/capacity`);
    if (response.ok) {
      setDeliveryCapacity((await response.json()) as DeliveryCapacity);
    }
  }

  async function loadPlayback(videoId: string) {
    const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/playback`);
    if (response.ok) {
      setPlayback((await response.json()) as PlaybackInfo);
    }
  }

  async function loadCourse(courseId: string) {
    const response = await fetch(`${pipelineBaseUrl}/courses/${courseId}`);
    if (!response.ok) return;
    const nextCourse = (await response.json()) as CourseInfo;
    setCourse(nextCourse);
    if (selectedIdentity) {
      if (selectedIdentity.role === "instructor") {
        await loadPublishReadiness(courseId, selectedIdentity.id);
      } else {
        await loadEnrollment(courseId, selectedIdentity.id);
      }
    }
  }

  async function loadPublishReadiness(courseId: string, instructorId: string) {
    const response = await fetch(
      `${pipelineBaseUrl}/courses/${courseId}/publish-readiness`,
      { headers: { "X-User-ID": instructorId } },
    );
    if (response.ok) {
      setPublishReadiness((await response.json()) as PublishReadiness);
    }
  }

  async function publishCourse() {
    if (!job?.course_id || selectedIdentity?.role !== "instructor") return;
    const response = await fetch(`${pipelineBaseUrl}/courses/${job.course_id}/publish`, {
      method: "POST",
      headers: { "X-User-ID": selectedIdentity.id },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(body?.detail ?? `Publish failed with ${response.status}.`);
      await loadPublishReadiness(job.course_id, selectedIdentity.id);
      return;
    }
    setCourse(body as CourseInfo);
    setPublishReadiness({ course_id: job.course_id, ready: true, blockers: [] });
    setMessage("Course published. Learners can now enroll.");
  }

  async function loadEnrollment(courseId: string, learnerId: string) {
    const response = await fetch(`${pipelineBaseUrl}/courses/${courseId}/enrollment`, {
      headers: { "X-User-ID": learnerId },
    });
    if (response.ok) {
      const body = (await response.json()) as { enrolled: boolean };
      setIsEnrolled(body.enrolled);
    }
  }

  async function startEnrolledCourse() {
    if (!job?.course_id || selectedIdentity?.role !== "learner") {
      setMessage("Select the learner development identity to enroll.");
      return;
    }
    const response = await fetch(`${pipelineBaseUrl}/courses/${job.course_id}/enrollment`, {
      method: "POST",
      headers: { "X-User-ID": selectedIdentity.id },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(body?.detail ?? `Enrollment failed with ${response.status}.`);
      return;
    }
    setIsEnrolled(true);
    setDemoLearnerId(selectedIdentity.id);
    setRouteDecision(null);
    await loadLearnerProgress(selectedIdentity.id);
    setMessage("Enrolled in the published course.");
  }

  async function recordWatchEvent(clip: { id: string }, watchedSeconds: number) {
    if (!job?.course_id || !job.video_id || selectedIdentity?.role !== "learner") return;
    await fetch(`${pipelineBaseUrl}/courses/${job.course_id}/watch-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": selectedIdentity.id,
      },
      body: JSON.stringify({
        video_id: job.video_id,
        clip_id: clip.id,
        path_mode: "adaptive",
        watched_seconds: watchedSeconds,
      }),
    });
  }

  async function changeIdentity(identityId: string) {
    setSelectedIdentityId(identityId);
    setDemoLearnerId(null);
    setLearnerProgress([]);
    setRouteDecision(null);
    const identity = identities.find((item) => item.id === identityId);
    if (!job?.course_id || !identity) return;
    if (identity.role === "instructor") {
      setIsEnrolled(false);
      await loadPublishReadiness(job.course_id, identity.id);
    } else {
      setPublishReadiness(null);
      await loadEnrollment(job.course_id, identity.id);
    }
  }

  async function loadTopics(videoId: string) {
    const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/topics`);
    if (!response.ok) {
      setMessage(`Topic refresh failed with ${response.status}.`);
      return;
    }
    const nextTopics = (await response.json()) as Topic[];
    setTopics(nextTopics);
    setTopicDrafts(
      Object.fromEntries(
        nextTopics.map((topic) => [
          topic.id,
          {
            title: topic.title,
            summary: topic.summary ?? "",
            start_seconds: topic.start_seconds,
            end_seconds: topic.end_seconds,
          },
        ]),
      ),
    );
  }

  async function segmentTranscript() {
    if (!job?.video_id) return;
    setIsSegmenting(true);
    setMessage(null);
    try {
      const response = await fetch(`${pipelineBaseUrl}/videos/${job.video_id}/segment`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? `Segmentation failed with ${response.status}`);
      }
      const nextTopics = (await response.json()) as Topic[];
      setTopics(nextTopics);
      setTopicDrafts(
        Object.fromEntries(
          nextTopics.map((topic) => [
            topic.id,
            {
              title: topic.title,
              summary: topic.summary ?? "",
              start_seconds: topic.start_seconds,
              end_seconds: topic.end_seconds,
            },
          ]),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Segmentation failed.");
    } finally {
      setIsSegmenting(false);
    }
  }

  async function updateTopic(topicId: string, draft: TopicDraft) {
    const topic = await topicRequest(`${pipelineBaseUrl}/videos/topics/${topicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (topic) upsertTopic(topic);
  }

  async function acceptTopic(topicId: string) {
    const topic = await topicRequest(`${pipelineBaseUrl}/videos/topics/${topicId}/accept`, {
      method: "POST",
    });
    if (topic) upsertTopic(topic);
  }

  async function dismissTopic(topicId: string) {
    const topic = await topicRequest(`${pipelineBaseUrl}/videos/topics/${topicId}/dismiss`, {
      method: "POST",
    });
    if (topic) {
      setTopics((current) => current.filter((item) => item.id !== topic.id));
    }
  }

  async function mergeTopicWithNext(index: number) {
    const first = topics[index];
    const second = topics[index + 1];
    if (!first || !second) return;
    const topic = await topicRequest(`${pipelineBaseUrl}/videos/topics/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_topic_id: first.id,
        second_topic_id: second.id,
      }),
    });
    if (topic && job?.video_id) await loadTopics(job.video_id);
  }

  async function splitTopic(topic: Topic) {
    const splitSeconds = (topic.start_seconds + topic.end_seconds) / 2;
    const response = await fetch(`${pipelineBaseUrl}/videos/topics/${topic.id}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ split_seconds: splitSeconds }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Split failed with ${response.status}.`);
      return;
    }
    if (job?.video_id) await loadTopics(job.video_id);
  }

  async function addManualTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job?.video_id) return;
    const topic = await topicRequest(`${pipelineBaseUrl}/videos/${job.video_id}/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manualTopic),
    });
    if (topic) {
      upsertTopic(topic);
      setManualTopic({
        title: "",
        summary: "",
        start_seconds: topic.end_seconds,
        end_seconds: topic.end_seconds + 600,
      });
    }
  }

  async function retimeBoundary(index: number, boundary: number) {
    const first = topics[index];
    const second = topics[index + 1];
    if (!first || !second) return;
    const firstDraft = topicDrafts[first.id] ?? topicToDraft(first);
    const secondDraft = topicDrafts[second.id] ?? topicToDraft(second);
    const nextFirst = { ...firstDraft, end_seconds: boundary };
    const nextSecond = { ...secondDraft, start_seconds: boundary };
    setTopicDrafts((current) => ({
      ...current,
      [first.id]: nextFirst,
      [second.id]: nextSecond,
    }));
    await updateTopic(first.id, nextFirst);
    await updateTopic(second.id, nextSecond);
  }

  async function topicRequest(endpoint: string, init: RequestInit) {
    setMessage(null);
    const response = await fetch(endpoint, init);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Topic request failed with ${response.status}.`);
      return null;
    }
    return (await response.json()) as Topic;
  }

  function upsertTopic(topic: Topic) {
    setTopics((current) =>
      [...current.filter((item) => item.id !== topic.id), topic].sort(
        (first, second) => first.start_seconds - second.start_seconds,
      ),
    );
    setTopicDrafts((current) => ({
      ...current,
      [topic.id]: topicToDraft(topic),
    }));
  }

  async function loadGraph(courseId: string) {
    const response = await fetch(`${pipelineBaseUrl}/courses/${courseId}/graph`);
    if (!response.ok) {
      setMessage(`Graph refresh failed with ${response.status}.`);
      return;
    }
    setGraphState((await response.json()) as GraphResponse);
  }

  async function generateGraph() {
    if (!job?.course_id) return;
    setMessage(null);
    const response = await fetch(`${pipelineBaseUrl}/courses/${job.course_id}/graph/generate`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Graph generation failed with ${response.status}.`);
      return;
    }
    setGraphState((await response.json()) as GraphResponse);
  }

  async function graphRequest(endpoint: string, init: RequestInit) {
    setMessage(null);
    const response = await fetch(endpoint, init);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Graph request failed with ${response.status}.`);
      return null;
    }
    return response.json();
  }

  async function updateConcept(conceptId: string, draft: ConceptDraft) {
    const concept = (await graphRequest(`${pipelineBaseUrl}/courses/graph/concepts/${conceptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })) as Concept | null;
    if (concept) upsertConcept(concept);
  }

  async function acceptConcept(conceptId: string) {
    const concept = (await graphRequest(
      `${pipelineBaseUrl}/courses/graph/concepts/${conceptId}/accept`,
      { method: "POST" },
    )) as Concept | null;
    if (concept) upsertConcept(concept);
  }

  async function dismissConcept(conceptId: string) {
    const concept = (await graphRequest(
      `${pipelineBaseUrl}/courses/graph/concepts/${conceptId}/dismiss`,
      { method: "POST" },
    )) as Concept | null;
    if (concept && job?.course_id) await loadGraph(job.course_id);
  }

  async function mergeConcepts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mergeSourceId || !mergeTargetId || !job?.course_id) return;
    const concept = (await graphRequest(`${pipelineBaseUrl}/courses/graph/concepts/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_concept_id: mergeSourceId,
        target_concept_id: mergeTargetId,
      }),
    })) as Concept | null;
    if (concept) await loadGraph(job.course_id);
  }

  async function addGraphEdge(edge: EdgeDraft) {
    if (!job?.course_id || !edge.from_concept_id || !edge.to_concept_id) return;
    const created = (await graphRequest(`${pipelineBaseUrl}/courses/${job.course_id}/graph/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edge),
    })) as ConceptEdge | null;
    if (created) upsertEdge(created);
  }

  async function acceptEdge(edgeId: string) {
    const edge = (await graphRequest(`${pipelineBaseUrl}/courses/graph/edges/${edgeId}/accept`, {
      method: "POST",
    })) as ConceptEdge | null;
    if (edge) upsertEdge(edge);
  }

  async function dismissEdge(edgeId: string) {
    const edge = (await graphRequest(`${pipelineBaseUrl}/courses/graph/edges/${edgeId}/dismiss`, {
      method: "POST",
    })) as ConceptEdge | null;
    if (edge) upsertEdge(edge);
  }

  function setGraphState(nextGraph: GraphResponse) {
    setGraph(nextGraph);
    setConceptDrafts(
      Object.fromEntries(
        nextGraph.concepts.map((concept) => [
          concept.id,
          {
            name: concept.name,
            description: concept.description ?? "",
          },
        ]),
      ),
    );
    setMergeSourceId(nextGraph.concepts[0]?.id ?? "");
    setMergeTargetId(nextGraph.concepts[1]?.id ?? "");
    setOverrideConceptId(
      nextGraph.concepts.find(
        (concept) => concept.review_status === "accepted" || concept.review_status === "edited",
      )?.id ?? "",
    );
    setNewEdge((current) => ({
      ...current,
      from_concept_id: nextGraph.concepts[0]?.id ?? "",
      to_concept_id: nextGraph.concepts[1]?.id ?? "",
    }));
  }

  function upsertConcept(concept: Concept) {
    setGraph((current) =>
      current
        ? {
            ...current,
            concepts: current.concepts.map((item) => (item.id === concept.id ? concept : item)),
          }
        : current,
    );
    setConceptDrafts((current) => ({
      ...current,
      [concept.id]: { name: concept.name, description: concept.description ?? "" },
    }));
  }

  function upsertEdge(edge: ConceptEdge) {
    setGraph((current) =>
      current
        ? {
            ...current,
            edges: [
              ...current.edges.filter((item) => item.id !== edge.id),
              edge,
            ],
          }
        : current,
    );
  }

  async function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    await addGraphEdge({
      from_concept_id: connection.source,
      to_concept_id: connection.target,
      rationale: "Instructor-created edge from graph canvas.",
    });
  }

  async function loadClips(videoId: string) {
    const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/clips`);
    if (!response.ok) {
      setMessage(`Clip refresh failed with ${response.status}.`);
      return;
    }
    setClips((await response.json()) as Clip[]);
  }

  async function generateClipsForTopic(topicId: string) {
    setMessage(null);
    const response = await fetch(`${pipelineBaseUrl}/topics/${topicId}/clips/generate`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Clip generation failed with ${response.status}.`);
      return;
    }
    if (job?.video_id) await loadClips(job.video_id);
  }

  async function flagClip(clipId: string) {
    const note = clipNotes[clipId]?.trim();
    if (!note) {
      setMessage("Add a flag note before flagging a clip.");
      return;
    }
    const clip = await clipRequest(`${pipelineBaseUrl}/clips/${clipId}/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (clip) upsertClip(clip);
  }

  async function recutClip(clipId: string) {
    const note = clipNotes[clipId]?.trim();
    if (!note) {
      setMessage("Add instructor notes before re-cutting a clip.");
      return;
    }
    const clip = await clipRequest(`${pipelineBaseUrl}/clips/${clipId}/recut`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (clip && job?.video_id) {
      setClipNotes((current) => ({ ...current, [clipId]: "" }));
      await loadClips(job.video_id);
    }
  }

  async function clipRequest(endpoint: string, init: RequestInit) {
    setMessage(null);
    const response = await fetch(endpoint, init);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Clip request failed with ${response.status}.`);
      return null;
    }
    return (await response.json()) as Clip;
  }

  function upsertClip(clip: Clip) {
    setClips((current) =>
      [...current.filter((item) => item.id !== clip.id), clip].sort(
        (first, second) => first.start_seconds - second.start_seconds,
      ),
    );
  }

  async function loadQuestions(videoId: string) {
    const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/questions`);
    if (!response.ok) {
      setMessage(`Question refresh failed with ${response.status}.`);
      return;
    }
    setQuestionsState((await response.json()) as Question[]);
  }

  async function generateQuestionForTopic(topicId: string) {
    const question = await questionRequest(
      `${pipelineBaseUrl}/topics/${topicId}/questions/generate`,
      { method: "POST" },
    );
    if (question) upsertQuestion(question);
  }

  async function acceptQuestion(questionId: string) {
    const question = await questionRequest(`${pipelineBaseUrl}/questions/${questionId}/accept`, {
      method: "POST",
    });
    if (question) upsertQuestion(question);
  }

  async function dismissQuestion(questionId: string) {
    const question = await questionRequest(`${pipelineBaseUrl}/questions/${questionId}/dismiss`, {
      method: "POST",
    });
    if (question) upsertQuestion(question);
  }

  async function regenerateQuestion(questionId: string) {
    const question = await questionRequest(
      `${pipelineBaseUrl}/questions/${questionId}/regenerate`,
      { method: "POST" },
    );
    if (question) upsertQuestion(question);
  }

  async function editQuestion(questionId: string) {
    const draft = questionDrafts[questionId];
    if (!draft) return;
    const correctAnswer = parseJsonField(draft.correct_answer_json, "correct answer");
    const remediationRules = parseJsonField(
      draft.remediation_rules_json,
      "remediation rules",
    );
    if (!correctAnswer || !remediationRules) return;
    if (!Array.isArray(remediationRules)) {
      setMessage("Question remediation rules must be a JSON array.");
      return;
    }
    const question = await questionRequest(`${pipelineBaseUrl}/questions/${questionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: draft.body,
        type: draft.type,
        correct_answer: correctAnswer,
        confidence_prompt: draft.confidence_prompt,
        remediation_rules: remediationRules,
      }),
    });
    if (question) upsertQuestion(question);
  }

  async function questionRequest(endpoint: string, init: RequestInit) {
    setMessage(null);
    const response = await fetch(endpoint, init);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Question request failed with ${response.status}.`);
      return null;
    }
    return (await response.json()) as Question;
  }

  function setQuestionsState(nextQuestions: Question[]) {
    setQuestions(nextQuestions);
    setQuestionDrafts(
      Object.fromEntries(
        nextQuestions.map((question) => [question.id, questionToDraft(question)]),
      ),
    );
  }

  function upsertQuestion(question: Question) {
    setQuestions((current) =>
      [...current.filter((item) => item.id !== question.id), question].sort(
        (first, second) => first.topic_id.localeCompare(second.topic_id),
      ),
    );
    setQuestionDrafts((current) => ({
      ...current,
      [question.id]: questionToDraft(question),
    }));
  }

  function parseJsonField(value: string, label: string) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      setMessage(`Question ${label} must be valid JSON.`);
      return null;
    }
  }

  async function loadRoutingPolicies(courseId: string) {
    const response = await fetch(`${pipelineBaseUrl}/courses/${courseId}/routing/policies`);
    if (!response.ok) {
      setMessage(`Routing policy refresh failed with ${response.status}.`);
      return;
    }
    setRoutingPoliciesState((await response.json()) as RoutingPolicy[]);
  }

  async function saveRoutingPolicy(conceptId: string) {
    if (!job?.course_id) return;
    const draft = policyDrafts[conceptId] ?? defaultRoutingPolicyDraft();
    const validationError = routingPolicyValidationError(draft);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setMessage(null);
    const response = await fetch(
      `${pipelineBaseUrl}/courses/${job.course_id}/routing/policies/${conceptId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Routing policy save failed with ${response.status}.`);
      return;
    }
    upsertRoutingPolicy((await response.json()) as RoutingPolicy);
  }

  async function createDemoLearner() {
    if (!job?.course_id) return;
    setMessage(null);
    setRoutingError(null);
    const response = await fetch(
      `${pipelineBaseUrl}/courses/${job.course_id}/routing/demo-learner`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setRoutingError(body?.detail ?? `Demo learner creation failed with ${response.status}.`);
      return;
    }
    const body = (await response.json()) as { learner_id: string };
    setDemoLearnerId(body.learner_id);
    setOverrideLearnerId(body.learner_id);
    setRouteDecision(null);
    await loadLearnerProgress(body.learner_id);
  }

  async function submitLearnerAttempt(
    questionId: string,
    correctness: boolean,
    confidence: number,
    wrongAnswerPattern: string | null = null,
  ) {
    if (!demoLearnerId) {
      setRoutingError("Create a demo learner before submitting attempts.");
      return;
    }
    setRoutingError(null);
    const response = await fetch(
      `${pipelineBaseUrl}/learners/${demoLearnerId}/questions/${questionId}/attempt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer: { answer: correctness ? "demo-correct" : "demo-incorrect" },
          correctness,
          confidence,
          wrong_answer_pattern: wrongAnswerPattern,
        }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setRoutingError(body?.detail ?? `Learner attempt failed with ${response.status}.`);
      return;
    }
    setRouteDecision((await response.json()) as RouteDecision);
    await loadLearnerProgress(demoLearnerId);
    if (job?.course_id) await loadDashboard(job.course_id);
  }

  async function loadLearnerProgress(learnerId: string) {
    if (!job?.course_id) return;
    const response = await fetch(
      `${pipelineBaseUrl}/learners/${learnerId}/courses/${job.course_id}/progress`,
    );
    if (!response.ok) {
      setMessage(`Learner progress refresh failed with ${response.status}.`);
      return;
    }
    setLearnerProgress((await response.json()) as LearnerProgress[]);
  }

  async function loadDashboard(courseId: string) {
    const response = await fetch(`${pipelineBaseUrl}/courses/${courseId}/dashboard`);
    if (!response.ok) {
      setMessage(`Dashboard refresh failed with ${response.status}.`);
      return;
    }
    setDashboardSummary((await response.json()) as DashboardSummary);
  }

  async function resolveDashboardSignal(
    signalId: string,
    action: "accept" | "edit" | "dismiss",
  ) {
    const note = dashboardNotes[signalId]?.trim() || null;
    const retroactive = Boolean(dashboardRetroactive[signalId]);
    const endpoint =
      action === "edit"
        ? `${pipelineBaseUrl}/dashboard/signals/${signalId}`
        : `${pipelineBaseUrl}/dashboard/signals/${signalId}/${action}`;
    const response = await fetch(endpoint, {
      method: action === "edit" ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: action === "accept" ? "accept_ai_suggestion" : action,
        note,
        retroactive,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Dashboard action failed with ${response.status}.`);
      return;
    }
    setMessage(
      `${action === "dismiss" ? "Dismissed" : "Applied"} dashboard signal; ${
        retroactive
          ? "retroactively reprocessed in-progress learners"
          : "applies going forward"
      }.`,
    );
    if (job?.course_id) {
      await loadDashboard(job.course_id);
      await loadGraph(job.course_id);
      await loadRoutingPolicies(job.course_id);
    }
    if (job?.video_id) {
      await loadClips(job.video_id);
      await loadQuestions(job.video_id);
    }
  }

  async function submitLearnerOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job?.course_id || !overrideLearnerId || !overrideConceptId) {
      setMessage("Choose a learner id and reviewed concept before applying an override.");
      return;
    }
    const response = await fetch(
      `${pipelineBaseUrl}/courses/${job.course_id}/dashboard/learner-override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learner_id: overrideLearnerId,
          concept_id: overrideConceptId,
          action: overrideAction,
          note: "Manual instructor dashboard override.",
        }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.detail ?? `Learner override failed with ${response.status}.`);
      return;
    }
    setMessage("Learner override applied to this learner only.");
    await loadLearnerProgress(overrideLearnerId);
  }

  function setRoutingPoliciesState(nextPolicies: RoutingPolicy[]) {
    setRoutingPolicies(nextPolicies);
    setPolicyDrafts((current) => ({
      ...current,
      ...Object.fromEntries(
        nextPolicies
          .filter((policy) => policy.concept_id)
          .map((policy) => [policy.concept_id!, policyToDraft(policy)]),
      ),
    }));
  }

  function upsertRoutingPolicy(policy: RoutingPolicy) {
    setRoutingPolicies((current) => [
      ...current.filter((item) => item.concept_id !== policy.concept_id),
      policy,
    ]);
    if (policy.concept_id) {
      setPolicyDrafts((current) => ({
        ...current,
        [policy.concept_id!]: policyToDraft(policy),
      }));
    }
  }

  return (
    <CourseFoundryShell
      courseStatus={course?.status}
      courseTitle={course?.title ?? "Course workspace"}
      identities={identities}
      isLearner={isLearnerContext}
      onIdentityChange={(identityId) => void changeIdentity(identityId)}
      onPublish={() => void publishCourse()}
      publishDisabled={
        selectedIdentity?.role !== "instructor" ||
        !course ||
        course.status === "published" ||
        publishReadiness?.ready !== true
      }
      selectedIdentityId={selectedIdentityId}
    >
      <main
        id="course-overview"
        className={`shell legacyWorkspace ${
          isLearnerContext ? "learnerContext" : "instructorContext"
        }`}
      >
      <section className="panel" id="course-setup">
        <div className="workspaceHeading">
          <div>
            <p className="workspaceEyebrow">Course production</p>
            <h1>Course setup</h1>
          </div>
          <p>Bring in source material and monitor processing before review begins.</p>
        </div>
        <p className="devIdentityNotice" role="note">
          Development identity only. Credentials and secure sessions are not implemented.
        </p>

        <div className="forms instructorOnly">
          <form onSubmit={uploadFile}>
            <label htmlFor="video-file">Video or audio file</label>
            <input
              id="video-file"
              type="file"
              accept="audio/*,video/*"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <button disabled={isSubmitting} type="submit">
              Upload
            </button>
          </form>

          <form onSubmit={submitUrl}>
            <label htmlFor="video-url">Direct audio/video URL</label>
            <input
              id="video-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/lecture.mp4"
            />
            <button disabled={isSubmitting || !url} type="submit">
              Ingest URL
            </button>
          </form>
        </div>

        {deliveryCapacity?.provider === "mux" ? (
          <div
            className={deliveryCapacity.can_upload ? "capacityNotice" : "coverageWarning"}
            role={deliveryCapacity.can_upload ? "status" : "alert"}
          >
            <strong>Mux storage</strong>
            <p>
              {deliveryCapacity.stored_count} of {deliveryCapacity.max_stored} stored videos used.
              {deliveryCapacity.can_upload
                ? ` ${deliveryCapacity.remaining} slot(s) remain.`
                : " New ingestion is blocked; no existing asset will be overwritten."}
            </p>
          </div>
        ) : null}

        {message ? <p className="message" role="status">{message}</p> : null}
      </section>

      {job ? (
        <section className="panel instructorOnly">
          <div className="jobHeader">
            <h2>Ingestion Status</h2>
            <button type="button" onClick={refreshJob}>
              Refresh
            </button>
          </div>
          <dl>
            <div>
              <dt>Job</dt>
              <dd>{job.id}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{job.status}</dd>
            </div>
            <div>
              <dt>Progress</dt>
              <dd>{job.progress}%</dd>
            </div>
            {job.error_message ? (
              <div>
                <dt>Error</dt>
                <dd>{job.error_message}</dd>
              </div>
            ) : null}
          </dl>

          {course ? (
            <div className="publishBar">
              <div>
                <strong>{course.title}</strong>
                <p>
                  Course status: <span className={`statusBadge ${course.status}`}>{course.status}</span>
                </p>
              </div>
            </div>
          ) : null}
          {course?.status === "draft" && publishReadiness?.blockers.length ? (
            <div className="coverageWarning" role="status">
              <strong>Publishing checklist</strong>
              <ul>
                {publishReadiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {transcript ? (
        <section className="panel instructorOnly">
          <h2>Transcript</h2>
          <p>{transcript.text}</p>
          <p>{transcript.words.length} timestamped words stored.</p>
        </section>
      ) : null}

      {transcript && job?.video_id ? (
        <section className="panel instructorOnly" id="outline">
          <div className="jobHeader">
            <h2>Topic Outline</h2>
            <div className="actions">
              <button type="button" onClick={() => loadTopics(job.video_id!)}>
                Refresh
              </button>
              <button disabled={isSegmenting} type="button" onClick={segmentTranscript}>
                {isSegmenting ? "Segmenting" : "Generate Outline"}
              </button>
            </div>
          </div>

          {coverageGaps.length > 0 ? (
            <div className="coverageWarning" role="alert">
              <strong>Unassigned source video ranges</strong>
              <ul>
                {coverageGaps.map((gap) => (
                  <li key={`${gap.start_seconds}-${gap.end_seconds}`}>
                    {formatDuration(gap.duration_seconds)} of source video not currently assigned
                    to any active topic ({formatTime(gap.start_seconds)} -{" "}
                    {formatTime(gap.end_seconds)}).
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="topicList">
            {topics.length === 0 ? (
              <p className="emptyState">
                No topics yet. Generate an outline to begin instructor review.
              </p>
            ) : null}
            {topics.map((topic, index) => {
              const draft = topicDrafts[topic.id] ?? topicToDraft(topic);
              const nextTopic = topics[index + 1];
              return (
                <article className="topicCard" key={topic.id}>
                  <div className="topicHeader">
                    <strong>{formatTime(topic.start_seconds)} - {formatTime(topic.end_seconds)}</strong>
                    <span>{topic.review_status}</span>
                  </div>
                  <label htmlFor={`title-${topic.id}`}>Title</label>
                  <input
                    id={`title-${topic.id}`}
                    value={draft.title}
                    onChange={(event) =>
                      setTopicDrafts((current) => ({
                        ...current,
                        [topic.id]: { ...draft, title: event.target.value },
                      }))
                    }
                  />
                  <label htmlFor={`summary-${topic.id}`}>Summary</label>
                  <textarea
                    id={`summary-${topic.id}`}
                    value={draft.summary}
                    onChange={(event) =>
                      setTopicDrafts((current) => ({
                        ...current,
                        [topic.id]: { ...draft, summary: event.target.value },
                      }))
                    }
                  />
                  <div className="timeGrid">
                    <label>
                      Start
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draft.start_seconds}
                        onChange={(event) =>
                          setTopicDrafts((current) => ({
                            ...current,
                            [topic.id]: {
                              ...draft,
                              start_seconds: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      End
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draft.end_seconds}
                        onChange={(event) =>
                          setTopicDrafts((current) => ({
                            ...current,
                            [topic.id]: {
                              ...draft,
                              end_seconds: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                  <TraceabilityBlock artifact={topic} />
                  <div className="actions">
                    <button
                      disabled={acceptButtonDisabled(topic.review_status)}
                      type="button"
                      onClick={() => acceptTopic(topic.id)}
                    >
                      {acceptButtonLabel(topic.review_status)}
                    </button>
                    <button type="button" onClick={() => updateTopic(topic.id, draft)}>
                      Edit manually
                    </button>
                    <button type="button" onClick={() => dismissTopic(topic.id)}>
                      Dismiss
                    </button>
                    <button type="button" onClick={() => splitTopic(topic)}>
                      Split
                    </button>
                    <button
                      disabled={!nextTopic}
                      type="button"
                      onClick={() => mergeTopicWithNext(index)}
                    >
                      Merge next
                    </button>
                  </div>
                  {nextTopic ? (
                    <label className="boundary">
                      Boundary
                      <input
                        type="range"
                        min={Math.ceil(topic.start_seconds + 30)}
                        max={Math.floor(nextTopic.end_seconds - 30)}
                        step="1"
                        value={Math.round(draft.end_seconds)}
                        onChange={(event) =>
                          setTopicDrafts((current) => ({
                            ...current,
                            [topic.id]: {
                              ...draft,
                              end_seconds: Number(event.target.value),
                            },
                            [nextTopic.id]: {
                              ...(current[nextTopic.id] ?? topicToDraft(nextTopic)),
                              start_seconds: Number(event.target.value),
                            },
                          }))
                        }
                        onMouseUp={(event) => retimeBoundary(index, Number(event.currentTarget.value))}
                        onTouchEnd={(event) => retimeBoundary(index, Number(event.currentTarget.value))}
                      />
                    </label>
                  ) : null}
                </article>
              );
            })}
          </div>

          <form className="manualTopic" onSubmit={addManualTopic}>
            <h3>Add Topic</h3>
            <input
              aria-label="Manual topic title"
              placeholder="Title"
              value={manualTopic.title}
              onChange={(event) =>
                setManualTopic((current) => ({ ...current, title: event.target.value }))
              }
            />
            <textarea
              aria-label="Manual topic summary"
              placeholder="Summary"
              value={manualTopic.summary}
              onChange={(event) =>
                setManualTopic((current) => ({ ...current, summary: event.target.value }))
              }
            />
            <div className="timeGrid">
              <input
                aria-label="Manual topic start"
                min="0"
                step="1"
                type="number"
                value={manualTopic.start_seconds}
                onChange={(event) =>
                  setManualTopic((current) => ({
                    ...current,
                    start_seconds: Number(event.target.value),
                  }))
                }
              />
              <input
                aria-label="Manual topic end"
                min="0"
                step="1"
                type="number"
                value={manualTopic.end_seconds}
                onChange={(event) =>
                  setManualTopic((current) => ({
                    ...current,
                    end_seconds: Number(event.target.value),
                  }))
                }
              />
            </div>
            <button disabled={!manualTopic.title} type="submit">
              Add
            </button>
          </form>
        </section>
      ) : null}

      {job?.course_id ? (
        <section className="panel instructorOnly" id="concept-graph">
          <div className="jobHeader">
            <h2>Concept Graph</h2>
            <div className="actions">
              <button type="button" onClick={() => loadGraph(job.course_id!)}>
                Refresh
              </button>
              <button disabled={graphBlockReason !== null} type="button" onClick={generateGraph}>
                Generate Graph
              </button>
            </div>
          </div>

          {graphBlockReason ? (
            <div className="coverageWarning" role="alert">
              <strong>Graph generation blocked</strong>
              <p>{graphBlockReason}</p>
              {topics.length > 0 ? (
                <p>
                  Reviewed topics: {reviewedTopics} of {topics.length}. Use Accept AI
                  suggestion or Edit manually in the topic outline first.
                </p>
              ) : null}
            </div>
          ) : null}

          {graph?.warnings.length ? (
            <div className="coverageWarning" role="alert">
              <strong>Graph review warnings</strong>
              <ul>
                {graph.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {graph ? (
            <div className="graphEditor">
              <div className="graphCanvas">
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  fitView
                  onConnect={handleConnect}
                >
                  <Background />
                  <Controls />
                </ReactFlow>
              </div>

              <div className="graphPanels">
                <section>
                  <h3>Concepts</h3>
                  {graph.concepts.length === 0 ? (
                    <p className="emptyState">No concepts have been generated yet.</p>
                  ) : null}
                  <div className="graphList">
                    {graph.concepts.map((concept) => {
                      const draft = conceptDrafts[concept.id] ?? {
                        name: concept.name,
                        description: concept.description ?? "",
                      };
                      return (
                        <article
                          className={
                            concept.review_status === "dismissed"
                              ? "graphReviewItem muted"
                              : "graphReviewItem"
                          }
                          key={concept.id}
                        >
                          <strong>{concept.review_status}</strong>
                          <input
                            aria-label={`Concept name ${concept.name}`}
                            value={draft.name}
                            onChange={(event) =>
                              setConceptDrafts((current) => ({
                                ...current,
                                [concept.id]: { ...draft, name: event.target.value },
                              }))
                            }
                          />
                          <textarea
                            aria-label={`Concept description ${concept.name}`}
                            value={draft.description}
                            onChange={(event) =>
                              setConceptDrafts((current) => ({
                                ...current,
                                [concept.id]: {
                                  ...draft,
                                  description: event.target.value,
                                },
                              }))
                            }
                          />
                          <TraceabilityBlock artifact={concept} />
                          <div className="actions">
                            <button
                              disabled={acceptButtonDisabled(concept.review_status)}
                              type="button"
                              onClick={() => acceptConcept(concept.id)}
                            >
                              {acceptButtonLabel(concept.review_status)}
                            </button>
                            <button
                              type="button"
                              onClick={() => updateConcept(concept.id, draft)}
                            >
                              Edit manually
                            </button>
                            <button type="button" onClick={() => dismissConcept(concept.id)}>
                              Dismiss
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section>
                  <h3>Edges</h3>
                  <div className="graphList">
                    {graph.edges.map((edge) => (
                      <article
                        className={
                          edge.review_status === "dismissed"
                            ? "graphReviewItem muted"
                            : "graphReviewItem"
                        }
                        key={edge.id}
                      >
                        <strong>{edge.review_status}</strong>
                        <p>
                          {conceptName(graph, edge.from_concept_id)} &rarr;{" "}
                          {conceptName(graph, edge.to_concept_id)}
                        </p>
                        <TraceabilityBlock artifact={edge} />
                        <div className="actions">
                          <button
                            disabled={acceptButtonDisabled(edge.review_status)}
                            type="button"
                            onClick={() => acceptEdge(edge.id)}
                          >
                            {acceptButtonLabel(edge.review_status)}
                          </button>
                          <button type="button" onClick={() => dismissEdge(edge.id)}>
                            Dismiss
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <form className="manualTopic" onSubmit={mergeConcepts}>
                  <h3>Merge Concepts</h3>
                  <select
                    value={mergeSourceId}
                    onChange={(event) => setMergeSourceId(event.target.value)}
                  >
                    {graph.concepts.map((concept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mergeTargetId}
                    onChange={(event) => setMergeTargetId(event.target.value)}
                  >
                    {graph.concepts.map((concept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.name}
                      </option>
                    ))}
                  </select>
                  <button disabled={!mergeSourceId || !mergeTargetId} type="submit">
                    Merge duplicate
                  </button>
                </form>

                <form
                  className="manualTopic"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addGraphEdge(newEdge);
                  }}
                >
                  <h3>Add Edge</h3>
                  <select
                    value={newEdge.from_concept_id}
                    onChange={(event) =>
                      setNewEdge((current) => ({
                        ...current,
                        from_concept_id: event.target.value,
                      }))
                    }
                  >
                    {graph.concepts.map((concept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newEdge.to_concept_id}
                    onChange={(event) =>
                      setNewEdge((current) => ({
                        ...current,
                        to_concept_id: event.target.value,
                      }))
                    }
                  >
                    {graph.concepts.map((concept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Edge rationale"
                    placeholder="Rationale"
                    value={newEdge.rationale}
                    onChange={(event) =>
                      setNewEdge((current) => ({
                        ...current,
                        rationale: event.target.value,
                      }))
                    }
                  />
                  <button type="submit">Add edge</button>
                </form>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {job?.video_id && topics.length > 0 ? (
        <section className="panel instructorOnly" id="clips">
          <div className="jobHeader">
            <h2>Clip Spot Check</h2>
            <div className="actions">
              <button type="button" onClick={() => loadClips(job.video_id!)}>
                Refresh
              </button>
            </div>
          </div>

          <div className="topicList">
            {topics
              .filter(isTopicReviewedForClipGeneration)
              .map((topic) => {
                const concepts = graph?.concepts ?? [];
                const blockReason = topicClipGenerationBlockReason(topic, concepts);
                const reviewedConcepts = reviewedConceptCountForTopic(topic.id, concepts);
                return (
                  <article className="topicCard" key={topic.id}>
                    <div className="topicHeader">
                      <strong>{topic.title}</strong>
                      <span>
                        {formatTime(topic.start_seconds)} - {formatTime(topic.end_seconds)}
                      </span>
                    </div>
                    <p>{reviewedConcepts} reviewed linked concept(s)</p>
                    {blockReason ? <p className="message">{blockReason}</p> : null}
                    <button
                      disabled={blockReason !== null}
                      type="button"
                      onClick={() => generateClipsForTopic(topic.id)}
                    >
                      Generate clips for topic
                    </button>
                  </article>
                );
              })}
          </div>

          <div className="clipList">
            {clips.length === 0 ? (
              <p className="emptyState">
                No clips yet. Generate clips from a reviewed topic with linked concepts.
              </p>
            ) : null}
            {clips.map((clip) => (
              <article
                className={clip.status === "superseded" ? "clipCard muted" : "clipCard"}
                key={clip.id}
              >
                <div className="topicHeader">
                  <strong>{formatTime(clip.start_seconds)} - {formatTime(clip.end_seconds)}</strong>
                  <span>{clip.status}</span>
                </div>
                <p>
                  {clip.type.replaceAll("_", " ")}
                  {clip.difficulty ? ` · ${clip.difficulty}` : ""}
                </p>
                <p>{clip.concept_ids.length} concept tag(s)</p>
                <TraceabilityBlock artifact={clip} />
                {clip.flag_note ? <p className="evidence">Flag: {clip.flag_note}</p> : null}
                {clip.source_clip_id ? (
                  <p className="evidence">Re-cut from clip {clip.source_clip_id}</p>
                ) : null}
                {job.video_id && playback ? (
                  <ProviderVideo
                    endSeconds={clip.end_seconds}
                    pipelineBaseUrl={pipelineBaseUrl}
                    playback={playback}
                    startSeconds={clip.start_seconds}
                    title={`Instructor preview: ${clip.type.replaceAll("_", " ")}`}
                    videoId={job.video_id}
                  />
                ) : null}
                <textarea
                  aria-label={`Flag note for clip ${clip.id}`}
                  placeholder="Flag note or re-cut instruction"
                  value={clipNotes[clip.id] ?? ""}
                  onChange={(event) =>
                    setClipNotes((current) => ({ ...current, [clip.id]: event.target.value }))
                  }
                />
                <div className="actions">
                  <button
                    disabled={clipSpotCheckActionsDisabled(clip)}
                    type="button"
                    onClick={() => flagClip(clip.id)}
                  >
                    Flag clip
                  </button>
                  <button
                    disabled={clipSpotCheckActionsDisabled(clip)}
                    type="button"
                    onClick={() => recutClip(clip.id)}
                  >
                    Re-cut with note
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {job?.video_id && topics.length > 0 ? (
        <section className="panel instructorOnly" id="assessments">
          <div className="jobHeader">
            <h2>Assessment Review</h2>
            <div className="actions">
              <button type="button" onClick={() => loadQuestions(job.video_id!)}>
                Refresh
              </button>
            </div>
          </div>

          <div className="topicList">
            {questions.length === 0 ? (
              <p className="emptyState">
                No assessment proposals yet. Generate one after clips are available.
              </p>
            ) : null}
            {topics
              .filter((topic) => topic.review_status === "accepted" || topic.review_status === "edited")
              .map((topic) => {
                const concepts = graph?.concepts ?? [];
                const blockReason = assessmentGenerationBlockReason(topic, concepts, clips);
                const accessBlockReason = learnerAccessBlockedReason(topic.id, questions);
                const topicQuestions = questions.filter(
                  (question) => question.topic_id === topic.id,
                );
                return (
                  <article className="topicCard" key={topic.id}>
                    <div className="topicHeader">
                      <strong>{topic.title}</strong>
                      <span>{accessBlockReason ? "blocked" : "learner ready"}</span>
                    </div>
                    <p>
                      {reviewedConceptCountForAssessment(topic.id, concepts)} reviewed linked
                      concept(s) · {usableClipCountForAssessment(topic.id, clips)} usable clip(s)
                    </p>
                    {accessBlockReason ? (
                      <p className="message">{accessBlockReason}</p>
                    ) : null}
                    {blockReason ? <p className="message">{blockReason}</p> : null}
                    <button
                      disabled={blockReason !== null}
                      type="button"
                      onClick={() => generateQuestionForTopic(topic.id)}
                    >
                      Generate question
                    </button>

                    {topicQuestions.length > 0 ? (
                      <div className="questionList">
                        {topicQuestions.map((question) => {
                          const draft = questionDrafts[question.id] ?? questionToDraft(question);
                          return (
                            <article
                              className={
                                question.review_status === "dismissed"
                                  ? "questionReviewItem muted"
                                  : "questionReviewItem"
                              }
                              key={question.id}
                            >
                              <div className="topicHeader">
                                <strong>{question.review_status}</strong>
                                <span>{question.type.replaceAll("_", " ")}</span>
                              </div>
                              <label htmlFor={`question-body-${question.id}`}>Question</label>
                              <textarea
                                id={`question-body-${question.id}`}
                                value={draft.body}
                                onChange={(event) =>
                                  setQuestionDrafts((current) => ({
                                    ...current,
                                    [question.id]: { ...draft, body: event.target.value },
                                  }))
                                }
                              />
                              <label htmlFor={`question-type-${question.id}`}>Type</label>
                              <select
                                id={`question-type-${question.id}`}
                                value={draft.type}
                                onChange={(event) =>
                                  setQuestionDrafts((current) => ({
                                    ...current,
                                    [question.id]: {
                                      ...draft,
                                      type: event.target.value as Question["type"],
                                    },
                                  }))
                                }
                              >
                                <option value="mcq">Multiple choice</option>
                                <option value="short_answer">Short answer</option>
                                <option value="worked_problem">Worked problem</option>
                              </select>
                              <label htmlFor={`question-answer-${question.id}`}>
                                Correct answer JSON
                              </label>
                              <textarea
                                id={`question-answer-${question.id}`}
                                value={draft.correct_answer_json}
                                onChange={(event) =>
                                  setQuestionDrafts((current) => ({
                                    ...current,
                                    [question.id]: {
                                      ...draft,
                                      correct_answer_json: event.target.value,
                                    },
                                  }))
                                }
                              />
                              <label htmlFor={`question-confidence-${question.id}`}>
                                Confidence prompt
                              </label>
                              <input
                                id={`question-confidence-${question.id}`}
                                value={draft.confidence_prompt}
                                onChange={(event) =>
                                  setQuestionDrafts((current) => ({
                                    ...current,
                                    [question.id]: {
                                      ...draft,
                                      confidence_prompt: event.target.value,
                                    },
                                  }))
                                }
                              />
                              <label htmlFor={`question-remediation-${question.id}`}>
                                Remediation rules JSON
                              </label>
                              <textarea
                                id={`question-remediation-${question.id}`}
                                value={draft.remediation_rules_json}
                                onChange={(event) =>
                                  setQuestionDrafts((current) => ({
                                    ...current,
                                    [question.id]: {
                                      ...draft,
                                      remediation_rules_json: event.target.value,
                                    },
                                  }))
                                }
                              />
                              <TraceabilityBlock artifact={question} />
                              <div className="actions">
                                <button
                                  disabled={acceptButtonDisabled(question.review_status)}
                                  type="button"
                                  onClick={() => acceptQuestion(question.id)}
                                >
                                  {acceptButtonLabel(question.review_status)}
                                </button>
                                <button type="button" onClick={() => editQuestion(question.id)}>
                                  Edit manually
                                </button>
                                <button
                                  type="button"
                                  onClick={() => regenerateQuestion(question.id)}
                                >
                                  Regenerate
                                </button>
                                <button type="button" onClick={() => dismissQuestion(question.id)}>
                                  Dismiss
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
          </div>
        </section>
      ) : null}

      {job?.course_id && graph ? (
        <section className="panel instructorOnly" id="routing">
          <div className="jobHeader">
            <h2>Routing Policy</h2>
            <div className="actions">
              <button type="button" onClick={() => loadRoutingPolicies(job.course_id!)}>
                Refresh
              </button>
            </div>
          </div>

          <div className="topicList">
            {graph.concepts
              .filter(
                (concept) =>
                  concept.review_status === "accepted" || concept.review_status === "edited",
              )
              .map((concept) => {
                const draft = policyDrafts[concept.id] ?? defaultRoutingPolicyDraft();
                const saved =
                  routingPolicies.find((policy) => policy.concept_id === concept.id) ?? null;
                return (
                  <article className="topicCard" key={concept.id}>
                    <div className="topicHeader">
                      <strong>{concept.name}</strong>
                      <span>{saved ? "custom" : "default"}</span>
                    </div>
                    <p>{policyLabel(draft)}</p>
                    <div className="timeGrid">
                      <label>
                        Confidence threshold
                        <input
                          min="1"
                          max="4"
                          step="1"
                          type="number"
                          value={draft.confidence_threshold}
                          onChange={(event) =>
                            setPolicyDrafts((current) => ({
                              ...current,
                              [concept.id]: {
                                ...draft,
                                confidence_threshold: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Correct attempts
                        <input
                          min="1"
                          step="1"
                          type="number"
                          value={draft.correct_attempts_for_mastery}
                          onChange={(event) =>
                            setPolicyDrafts((current) => ({
                              ...current,
                              [concept.id]: {
                                ...draft,
                                correct_attempts_for_mastery: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Max remediation attempts
                        <input
                          min="0"
                          step="1"
                          type="number"
                          value={draft.max_remediation_attempts}
                          onChange={(event) =>
                            setPolicyDrafts((current) => ({
                              ...current,
                              [concept.id]: {
                                ...draft,
                                max_remediation_attempts: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Advancement mode
                      <select
                        value={draft.advancement_mode}
                        onChange={(event) =>
                          setPolicyDrafts((current) => ({
                            ...current,
                            [concept.id]: {
                              ...draft,
                              advancement_mode: event.target.value as RoutingPolicyDraft["advancement_mode"],
                            },
                          }))
                        }
                      >
                        <option value="require_mastery">Require mastery</option>
                        <option value="allow_partial_understanding">
                          Allow partial understanding
                        </option>
                      </select>
                    </label>
                    <button type="button" onClick={() => saveRoutingPolicy(concept.id)}>
                      Save policy
                    </button>
                  </article>
                );
              })}
          </div>
        </section>
      ) : null}

      {questions.some((question) => question.review_status === "accepted" || question.review_status === "edited") ? (
        <section className="panel instructorOnly" id="routing-simulator">
          <div className="jobHeader">
            <h2>Learner Routing Simulator</h2>
            <button type="button" onClick={createDemoLearner}>
              {demoLearnerId ? "Create new learner" : "Create demo learner"}
            </button>
          </div>

          {demoLearnerId ? <p>Demo learner: {demoLearnerId}</p> : null}
          {routingError ? (
            <p className="message" role="alert">
              {routingError}
            </p>
          ) : null}
          {routeDecision ? (
            <div className="coverageWarning" role="status">
              <strong>{routeDecision.action.replaceAll("_", " ")}</strong>
              <p>{routeDecision.why}</p>
              <p>Mastery state: {routeDecision.mastery_state}</p>
              {routeDecision.target_concept_id ? (
                <p>Target concept: {routeDecision.target_concept_id}</p>
              ) : null}
              {routeDecision.target_clip_id ? (
                <p>Target clip: {routeDecision.target_clip_id}</p>
              ) : null}
              {routeDecision.dashboard_signal_id ? (
                <p>Instructor signal: {routeDecision.dashboard_signal_id}</p>
              ) : null}
            </div>
          ) : null}

          <div className="topicList">
            {questions
              .filter(
                (question) =>
                  question.review_status === "accepted" || question.review_status === "edited",
              )
              .map((question) => {
                const topic = topics.find((item) => item.id === question.topic_id);
                const firstPattern =
                  question.remediation_rules[0]?.wrong_answer_pattern ?? "incorrect";
                return (
                  <article className="topicCard" key={question.id}>
                    <div className="topicHeader">
                      <strong>{topic?.title ?? "Untitled topic"}</strong>
                      <span>{question.type.replaceAll("_", " ")}</span>
                    </div>
                    <p>{question.body}</p>
                    <div className="actions">
                      <button
                        disabled={!demoLearnerId}
                        type="button"
                        onClick={() => submitLearnerAttempt(question.id, true, 4)}
                      >
                        Correct + confident
                      </button>
                      <button
                        disabled={!demoLearnerId}
                        type="button"
                        onClick={() => submitLearnerAttempt(question.id, true, 2)}
                      >
                        Correct + unsure
                      </button>
                      <button
                        disabled={!demoLearnerId}
                        type="button"
                        onClick={() =>
                          submitLearnerAttempt(question.id, false, 1, firstPattern)
                        }
                      >
                        Incorrect
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ) : null}

      {learnerQuestions.length > 0 ? (
        <section
          className="panel learnerExperience learnerOnly"
          id="learner-preview"
          aria-labelledby="learner-experience-title"
        >
          <div className="jobHeader">
            <h2 id="learner-experience-title">Learner Experience</h2>
            <button
              disabled={isLearnerContext && course?.status !== "published"}
              type="button"
              onClick={isLearnerContext ? startEnrolledCourse : createDemoLearner}
            >
              {isLearnerContext
                ? isEnrolled
                  ? "Resume course"
                  : "Enroll and start"
                : demoLearnerId
                  ? "Restart as new learner"
                  : "Start course"}
            </button>
          </div>

          <div className="learnerGrid">
            <section aria-labelledby="learner-player-title" className="learnerMain">
              <h3 id="learner-player-title">
                {activeLearnerTopic?.title ?? "Choose a topic"}
              </h3>

              {routeDecision ? (
                <div
                  aria-live="polite"
                  className={`routeMessage ${routeTone(routeDecision.action)}`}
                  role="status"
                >
                  <strong>Why this is next</strong>
                  <p>{routeDecision.why}</p>
                  {routeDecision.action === "flag_instructor" ? (
                    <p>
                      You are not being sent through the same loop again. The instructor
                      has been flagged to review this concept.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="evidence">
                  Start the course, watch the current clip, then answer the check-in.
                </p>
              )}

              {activeLearnerClip && job?.video_id && playback ? (
                <ProviderVideo
                  endSeconds={activeLearnerClip.end_seconds}
                  pipelineBaseUrl={pipelineBaseUrl}
                  playback={playback}
                  startSeconds={activeLearnerClip.start_seconds}
                  title={`Current learning clip for ${activeLearnerTopic?.title ?? "this topic"}`}
                  videoId={job.video_id}
                  viewerId={demoLearnerId}
                  onClipComplete={(watchedSeconds) =>
                    void recordWatchEvent(activeLearnerClip, watchedSeconds)
                  }
                />
              ) : (
                <p className="emptyState">No active learner clip is available for this topic.</p>
              )}

              {activeLearnerQuestion ? (
                <form
                  className="learnerQuestion"
                  onSubmit={(event) => event.preventDefault()}
                >
                  <h3>Comprehension Check</h3>
                  <p>{activeLearnerQuestion.body}</p>
                  <fieldset>
                    <legend>{activeLearnerQuestion.confidence_prompt}</legend>
                    <div className="actions" role="group" aria-label="Answer outcomes">
                      <button
                        disabled={!demoLearnerId}
                        type="button"
                        onClick={() => submitLearnerAttempt(activeLearnerQuestion.id, true, 4)}
                      >
                        I got it and feel confident
                      </button>
                      <button
                        disabled={!demoLearnerId}
                        type="button"
                        onClick={() => submitLearnerAttempt(activeLearnerQuestion.id, true, 2)}
                      >
                        I got it but feel unsure
                      </button>
                      <button
                        disabled={!demoLearnerId}
                        type="button"
                        onClick={() =>
                          submitLearnerAttempt(
                            activeLearnerQuestion.id,
                            false,
                            1,
                            activeLearnerQuestion.remediation_rules[0]?.wrong_answer_pattern ??
                              "incorrect",
                          )
                        }
                      >
                        I missed this
                      </button>
                    </div>
                  </fieldset>
                </form>
              ) : null}
            </section>

            <aside aria-labelledby="mastery-map-title" className="masteryMap" id="mastery-map">
              <h3 id="mastery-map-title">Mastery Map</h3>
              <p>{masterySummary(learnerProgress)}</p>
              <div className="progressList">
                {learnerProgress.map((item) => (
                  <button
                    className={`progressItem ${item.state}`}
                    key={item.concept_id}
                    type="button"
                    onClick={() => setActiveLearnerTopicId(item.topic_id)}
                  >
                    <span>{item.name}</span>
                    <strong>{item.state.replaceAll("_", " ")}</strong>
                  </button>
                ))}
              </div>

              <h3 id="learner-topics">Topics</h3>
              <div className="progressList" role="list" aria-labelledby="learner-topics">
                {topics
                  .filter((topic) => topic.review_status === "accepted" || topic.review_status === "edited")
                  .map((topic) => (
                    <button
                      aria-current={topic.id === activeLearnerTopic?.id ? "true" : undefined}
                      className="progressItem"
                      key={topic.id}
                      type="button"
                      onClick={() => setActiveLearnerTopicId(topic.id)}
                    >
                      <span>{topic.title}</span>
                      <strong>
                        {formatTime(topic.start_seconds)} - {formatTime(topic.end_seconds)}
                      </strong>
                    </button>
                  ))}
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      {job?.course_id ? (
        <section className="panel instructorOnly" id="insights">
          <div className="jobHeader">
            <h2>Instructor Dashboard</h2>
            <button type="button" onClick={() => loadDashboard(job.course_id!)}>
              Refresh signals
            </button>
          </div>

          {dashboardSummary ? (
            <>
              <div className="dashboardMetrics">
                <article>
                  <strong>{dashboardSummary.learner_count}</strong>
                  <span>Learners</span>
                </article>
                <article>
                  <strong>{dashboardSummary.attempt_count}</strong>
                  <span>Attempts</span>
                </article>
                <article>
                  <strong>{dashboardSummary.signals.length}</strong>
                  <span>Open signals</span>
                </article>
              </div>

              {dashboardColdStartMessage(dashboardSummary) ? (
                <div className="coverageWarning" role="status">
                  <strong>Not enough data yet</strong>
                  <p>{dashboardColdStartMessage(dashboardSummary)}</p>
                </div>
              ) : null}

              <div className="topicList">
                {!dashboardSummary.not_enough_data && dashboardSummary.signals.length === 0 ? (
                  <p className="emptyState">
                    No open dashboard problems. Refresh after more learner activity.
                  </p>
                ) : null}
                {dashboardSummary.signals.map((signal) => {
                  const retroactive = Boolean(dashboardRetroactive[signal.id]);
                  return (
                    <article className="topicCard" key={signal.id}>
                      <div className="topicHeader">
                        <strong>{dashboardSignalTitle(signal)}</strong>
                        <span>{signal.type.replaceAll("_", " ")}</span>
                      </div>
                      <p>{dashboardSignalSummary(signal)}</p>
                      <p className="evidence">
                        Recommended: {dashboardSignalRecommendedAction(signal)}
                      </p>
                      <TraceabilityBlock
                        artifact={{
                          status: signal.status,
                          ai_proposal: {
                            rationale: dashboardSignalSummary(signal),
                          },
                          instructor_revision: signal.instructor_action,
                        }}
                      />
                      <dl>
                        <div>
                          <dt>Related entity</dt>
                          <dd>
                            {signal.related_entity_type}: {signal.related_entity_id}
                          </dd>
                        </div>
                      </dl>
                      <label>
                        Instructor note
                        <textarea
                          value={dashboardNotes[signal.id] ?? ""}
                          onChange={(event) =>
                            setDashboardNotes((current) => ({
                              ...current,
                              [signal.id]: event.target.value,
                            }))
                          }
                          placeholder="Optional edit, rationale, or implementation note"
                        />
                      </label>
                      <label className="inlineChoice">
                        <input
                          checked={retroactive}
                          type="checkbox"
                          onChange={(event) =>
                            setDashboardRetroactive((current) => ({
                              ...current,
                              [signal.id]: event.target.checked,
                            }))
                          }
                        />
                        {dashboardActionScopeLabel(retroactive)}
                      </label>
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() => resolveDashboardSignal(signal.id, "accept")}
                        >
                          Accept AI suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveDashboardSignal(signal.id, "edit")}
                        >
                          Edit manually
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveDashboardSignal(signal.id, "dismiss")}
                        >
                          Dismiss
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="evidence">
              Refresh signals to compute cohort, content, graph-drift, and stuck-loop
              dashboard problems from current learner data.
            </p>
          )}

          {graph ? (
            <form className="manualTopic" onSubmit={submitLearnerOverride}>
              <h3>Manual Learner Override</h3>
              <label>
                Learner id
                <input
                  value={overrideLearnerId}
                  onChange={(event) => setOverrideLearnerId(event.target.value)}
                  placeholder="Paste learner UUID"
                />
              </label>
              <label>
                Concept
                <select
                  value={overrideConceptId}
                  onChange={(event) => setOverrideConceptId(event.target.value)}
                >
                  {graph.concepts
                    .filter(
                      (concept) =>
                        concept.review_status === "accepted" ||
                        concept.review_status === "edited",
                    )
                    .map((concept) => (
                      <option key={concept.id} value={concept.id}>
                        {concept.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Override action
                <select
                  value={overrideAction}
                  onChange={(event) =>
                    setOverrideAction(event.target.value as "skip_ahead" | "send_back")
                  }
                >
                  <option value="send_back">Send back for remediation</option>
                  <option value="skip_ahead">Skip ahead / mark mastered</option>
                </select>
              </label>
              <button type="submit">Apply learner override</button>
            </form>
          ) : null}
        </section>
      ) : null}
      </main>
    </CourseFoundryShell>
  );
}

type TopicDraft = {
  title: string;
  summary: string;
  start_seconds: number;
  end_seconds: number;
};

type ConceptDraft = {
  name: string;
  description: string;
};

type EdgeDraft = {
  from_concept_id: string;
  to_concept_id: string;
  rationale: string;
};

type QuestionDraft = {
  body: string;
  type: Question["type"];
  correct_answer_json: string;
  confidence_prompt: string;
  remediation_rules_json: string;
};

function topicToDraft(topic: Topic): TopicDraft {
  return {
    title: topic.title,
    summary: topic.summary ?? "",
    start_seconds: topic.start_seconds,
    end_seconds: topic.end_seconds,
  };
}

function questionToDraft(question: Question): QuestionDraft {
  return {
    body: question.body,
    type: question.type,
    correct_answer_json: JSON.stringify(question.correct_answer, null, 2),
    confidence_prompt: question.confidence_prompt,
    remediation_rules_json: JSON.stringify(
      question.remediation_rules.map(remediationRuleToEditPayload),
      null,
      2,
    ),
  };
}

function policyToDraft(policy: RoutingPolicy): RoutingPolicyDraft {
  return {
    confidence_threshold: policy.confidence_threshold,
    correct_attempts_for_mastery: policy.correct_attempts_for_mastery,
    advancement_mode: policy.advancement_mode,
    max_remediation_attempts: policy.max_remediation_attempts,
  };
}

function remediationRuleToEditPayload(rule: RemediationRule) {
  return {
    wrong_answer_pattern: rule.wrong_answer_pattern,
    target_clip_id: rule.target_clip_id,
    target_concept_id: rule.target_concept_id,
    rationale: String(
      rule.instructor_revision?.rationale ?? rule.ai_proposal?.rationale ?? "",
    ),
  };
}

function TraceabilityBlock({ artifact }: { artifact: TraceableArtifact }) {
  const rationale = aiRationale(artifact);
  const instructor = instructorTrace(artifact);
  if (!rationale && !instructor) return null;
  return (
    <div className="traceability" aria-label="Traceability">
      <strong>Trace</strong>
      <p>Status: {traceabilityStatus(artifact).replaceAll("_", " ")}</p>
      {rationale ? <p>AI rationale: {rationale}</p> : null}
      {instructor ? <p>Instructor action: {instructor}</p> : null}
    </div>
  );
}

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function transcriptStartSeconds(transcript: Transcript) {
  return transcript.words[0]?.start_seconds ?? 0;
}

function transcriptEndSeconds(transcript: Transcript) {
  return transcript.words.at(-1)?.end_seconds ?? 0;
}

function conceptName(graph: GraphResponse, conceptId: string) {
  return graph.concepts.find((concept) => concept.id === conceptId)?.name ?? "Unknown concept";
}
