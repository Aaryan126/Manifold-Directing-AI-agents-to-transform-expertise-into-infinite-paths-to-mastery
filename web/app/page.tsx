"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
  correctAnswerPayload,
  questionToAssessmentDraft,
  remediationPayload,
  type AssessmentEditorDraft,
} from "./assessmentEditor";
import {
  clipSpotCheckActionsDisabled,
  conceptTopicIds,
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
import { CourseSetupWorkspace } from "@/components/course-setup-workspace";
import {
  InspectorSection,
  ReviewQueueHeader,
  ReviewQueueItem,
  ReviewWorkspace,
  ReviewWorkspaceGrid,
} from "@/components/review-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LoaderCircle, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";

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
  const [selectedTopicReviewId, setSelectedTopicReviewId] = useState("");
  const [selectedClipReviewId, setSelectedClipReviewId] = useState("");
  const [selectedQuestionReviewId, setSelectedQuestionReviewId] = useState("");
  const [selectedGraphConceptId, setSelectedGraphConceptId] = useState("");
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState("");
  const [graphReviewFilter, setGraphReviewFilter] = useState<"all" | "proposed" | "reviewed" | "dismissed">("all");
  const [selectedRoutingConceptId, setSelectedRoutingConceptId] = useState("");
  const [selectedSimulatorQuestionId, setSelectedSimulatorQuestionId] = useState("");
  const [selectedDashboardSignalId, setSelectedDashboardSignalId] = useState("");
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
  const [conceptTopicDrafts, setConceptTopicDrafts] = useState<Record<string, string[]>>({});
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
  const [bulkAction, setBulkAction] = useState<"clips" | "questions" | "accept-questions" | null>(null);
  const [generationAction, setGenerationAction] = useState<string | null>(null);
  const [isAcceptingGraph, setIsAcceptingGraph] = useState(false);
  const [learnerAnswer, setLearnerAnswer] = useState("");
  const [learnerConfidence, setLearnerConfidence] = useState<number | null>(null);
  const [isGradingAnswer, setIsGradingAnswer] = useState(false);
  const [gradingFeedback, setGradingFeedback] = useState<string | null>(null);
  const hydratedJobs = useRef(new Set<string>());
  const refreshJobRef = useRef<() => Promise<void>>(async () => undefined);
  const hydrateCompletedJobRef = useRef<(nextJob: Job) => Promise<void>>(async () => undefined);
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
  const topicsWithoutReviewedConcepts = topics.filter(
    (topic) =>
      (topic.review_status === "accepted" || topic.review_status === "edited") &&
      reviewedConceptCountForTopic(topic.id, graph?.concepts ?? []) === 0,
  );
  const graphStatusMatches = (status: Concept["review_status"]) =>
    graphReviewFilter === "all" ||
    status === graphReviewFilter ||
    (graphReviewFilter === "reviewed" && (status === "accepted" || status === "edited"));
  const visibleGraphConceptIds = new Set(
    graph?.concepts.filter((concept) => graphStatusMatches(concept.review_status)).map((concept) => concept.id) ?? [],
  );
  const flowNodes: FlowNode[] = graph
    ? graphNodeModels(graph.concepts.filter((concept) => visibleGraphConceptIds.has(concept.id))).map((node) => ({
      id: node.id,
      position: { x: node.x, y: node.y },
      data: { label: `${node.label}\n${node.status}` },
      className: node.muted ? "graphNode muted" : "graphNode",
      width: 190,
      height: 72,
      style: {
        width: 190,
        minHeight: 72,
        borderColor: node.muted ? "var(--border)" : "var(--primary)",
        borderRadius: 6,
        padding: 12,
      },
    }))
    : [];
  const flowEdges: FlowEdge[] = graph
    ? graphEdgeModels(graph.edges.filter((edge) =>
        visibleGraphConceptIds.has(edge.from_concept_id) &&
        visibleGraphConceptIds.has(edge.to_concept_id) &&
        graphStatusMatches(edge.review_status),
      )).map((edge) => ({
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
  const learnerCanAttempt = isLearnerContext ? isEnrolled : Boolean(demoLearnerId);
  const masteryByConcept = new Map(
    learnerProgress.map((item) => [item.concept_id, item]),
  );
  const masteryConcepts = graph?.concepts.filter(
    (concept) => concept.review_status === "accepted" || concept.review_status === "edited",
  ) ?? [];
  const masteryConceptIds = new Set(masteryConcepts.map((concept) => concept.id));
  const masteryFlowNodes: FlowNode[] = graphNodeModels(masteryConcepts).map((node) => {
    const progress = masteryByConcept.get(node.id);
    const state = progress?.state ?? "not_started";
    const borderColor = state === "mastered"
      ? "#059669"
      : state === "struggling"
        ? "#dc2626"
        : state === "practiced"
          ? "#d97706"
          : "var(--border)";
    return {
      id: node.id,
      position: { x: node.x, y: node.y },
      data: { label: `${node.label}\n${state.replaceAll("_", " ")}` },
      width: 190,
      height: 76,
      style: {
        width: 190,
        minHeight: 76,
        borderColor,
        borderRadius: 6,
        padding: 12,
        background: "var(--background)",
        color: "var(--foreground)",
      },
    };
  });
  const masteryFlowEdges: FlowEdge[] = graph
    ? graphEdgeModels(
        graph.edges.filter(
          (edge) =>
            (edge.review_status === "accepted" || edge.review_status === "edited") &&
            masteryConceptIds.has(edge.from_concept_id) &&
            masteryConceptIds.has(edge.to_concept_id),
        ),
      ).map((edge) => ({
        id: `mastery-${edge.id}`,
        source: edge.source,
        target: edge.target,
        animated: false,
        style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5 },
      }))
    : [];
  const signalChartData = [
    ["Stuck cohorts", dashboardSummary?.signals.filter((signal) => signal.type === "stuck_cohort").length ?? 0],
    ["Content", dashboardSummary?.signals.filter((signal) => signal.type === "underperforming_content").length ?? 0],
    ["Graph drift", dashboardSummary?.signals.filter((signal) => signal.type === "graph_drift").length ?? 0],
  ] as const;
  const largestSignalCount = Math.max(1, ...signalChartData.map(([, count]) => count));
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
    setLearnerAnswer("");
    setLearnerConfidence(null);
    setGradingFeedback(null);
  }, [activeLearnerQuestion?.id]);

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

  async function loadDemo() {
    setIsSubmitting(true);
    setMessage("Loading the pre-processed Manifold demo.");
    setSelectedFile(null);
    setUrl("");
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
    hydratedJobs.current.clear();
    await createJob(`${pipelineBaseUrl}/videos/demo`, { method: "POST" });
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
      await hydrateCompletedJob(nextJob);
    }
  }

  async function hydrateCompletedJob(nextJob: Job) {
    if (!nextJob.video_id || hydratedJobs.current.has(nextJob.id)) return;
    hydratedJobs.current.add(nextJob.id);
    try {
      const transcriptResponse = await fetch(
        `${pipelineBaseUrl}/videos/${nextJob.video_id}/transcript`,
      );
      if (transcriptResponse.ok) {
        setTranscript((await transcriptResponse.json()) as Transcript);
        const nextTopics = await loadTopics(nextJob.video_id);
        if (nextTopics.length === 0) {
          setMessage("Transcript ready. Generating the first topic outline now.");
          await segmentTranscript(nextJob.video_id, true);
        }
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
    } catch (error) {
      hydratedJobs.current.delete(nextJob.id);
      setMessage(error instanceof Error ? error.message : "Completed course data failed to load.");
    }
  }

  refreshJobRef.current = refreshJob;
  hydrateCompletedJobRef.current = hydrateCompletedJob;

  useEffect(() => {
    if (!job || job.status === "failed") return;
    if (job.status === "complete") {
      void hydrateCompletedJobRef.current(job);
      return;
    }
    const timer = window.setInterval(() => void refreshJobRef.current(), 2000);
    return () => window.clearInterval(timer);
  }, [job]);

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
      setDemoLearnerId(body.enrolled ? learnerId : null);
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

  async function loadTopics(videoId: string): Promise<Topic[]> {
    const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/topics`);
    if (!response.ok) {
      setMessage(`Topic refresh failed with ${response.status}.`);
      return [];
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
    return nextTopics;
  }

  async function segmentTranscript(videoId = job?.video_id ?? "", automatic = false) {
    if (!videoId) return;
    setIsSegmenting(true);
    setMessage(null);
    try {
      const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/segment`, {
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
      if (automatic) setMessage("Transcript processed and topic outline generated for review.");
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

  async function acceptAllTopics() {
    const proposed = topics.filter((topic) => topic.review_status === "proposed");
    if (!proposed.length || !job?.video_id) return;
    setMessage(null);
    const responses = await Promise.all(
      proposed.map((topic) => fetch(`${pipelineBaseUrl}/videos/topics/${topic.id}/accept`, { method: "POST" })),
    );
    const failed = responses.find((response) => !response.ok);
    if (failed) {
      setMessage(`Accept all topics failed with ${failed.status}.`);
      return;
    }
    await loadTopics(job.video_id);
    setMessage(`${proposed.length} topic proposal(s) accepted.`);
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
    setMessage("Generating a fresh concept graph. This can take up to two minutes on the free deployment.");
    setGenerationAction("graph");
    try {
      const response = await fetch(`${pipelineBaseUrl}/courses/${job.course_id}/graph/generate`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(body?.detail ?? `Graph generation failed with ${response.status}.`);
        return;
      }
      setGraphState((await response.json()) as GraphResponse);
    } finally {
      setGenerationAction(null);
    }
  }

  async function graphRequest(endpoint: string, init: RequestInit) {
    if (generationAction === "graph") {
      setMessage("Wait for graph generation to finish before reviewing its concepts or edges.");
      return null;
    }
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

  async function acceptAllGraphProposals() {
    if (!graph || !job?.course_id || generationAction === "graph" || isAcceptingGraph) return;
    const proposedConcepts = graph.concepts.filter((concept) => concept.review_status === "proposed");
    const proposedEdges = graph.edges.filter((edge) => edge.review_status === "proposed");
    setIsAcceptingGraph(true);
    setMessage("Accepting graph proposals.");
    try {
      const conceptResponses = await Promise.all(
        proposedConcepts.map((concept) => fetch(`${pipelineBaseUrl}/courses/graph/concepts/${concept.id}/accept`, { method: "POST" })),
      );
      const edgeResponses = await Promise.all(
        proposedEdges.map((edge) => fetch(`${pipelineBaseUrl}/courses/graph/edges/${edge.id}/accept`, { method: "POST" })),
      );
      const failed = [...conceptResponses, ...edgeResponses].find((response) => !response.ok);
      if (failed) {
        await loadGraph(job.course_id);
        setMessage(`Accept all graph proposals failed with ${failed.status}. The graph was refreshed; try again.`);
        return;
      }
      await loadGraph(job.course_id);
      setMessage(`${proposedConcepts.length} concept(s) and ${proposedEdges.length} edge(s) accepted.`);
    } finally {
      setIsAcceptingGraph(false);
    }
  }

  async function updateConceptTopicLinks(conceptId: string) {
    const concept = (await graphRequest(
      `${pipelineBaseUrl}/courses/graph/concepts/${conceptId}/topics`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_ids: conceptTopicDrafts[conceptId] ?? [] }),
      },
    )) as Concept | null;
    if (concept) {
      upsertConcept(concept);
      setMessage("Concept topic links updated. Clip and assessment readiness recalculated.");
    }
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
    setConceptTopicDrafts(
      Object.fromEntries(
        nextGraph.concepts.map((concept) => [concept.id, conceptTopicIds(concept)]),
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
    setConceptTopicDrafts((current) => ({
      ...current,
      [concept.id]: conceptTopicIds(concept),
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
    setGenerationAction(`clips:${topicId}`);
    try {
      const response = await fetch(`${pipelineBaseUrl}/topics/${topicId}/clips/generate`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(body?.detail ?? `Clip generation failed with ${response.status}.`);
        return;
      }
      if (job?.video_id) await loadClips(job.video_id);
    } finally {
      setGenerationAction(null);
    }
  }

  async function generateAllMissingClips() {
    if (!job?.video_id || !graph) return;
    const eligible = topics.filter(
      (topic) =>
        isTopicReviewedForClipGeneration(topic) &&
        topicClipGenerationBlockReason(topic, graph.concepts) === null &&
        !clips.some((clip) => clip.topic_id === topic.id && clip.status !== "superseded"),
    );
    if (!eligible.length) {
      setMessage("Every eligible topic already has clips, or still needs reviewed concept links.");
      return;
    }
    setBulkAction("clips");
    setMessage(`Generating clips for ${eligible.length} eligible topic(s).`);
    const failures: string[] = [];
    for (const topic of eligible) {
      const response = await fetch(`${pipelineBaseUrl}/topics/${topic.id}/clips/generate`, { method: "POST" });
      if (!response.ok) failures.push(topic.title);
    }
    await loadClips(job.video_id);
    setBulkAction(null);
    setMessage(failures.length
      ? `Clip generation failed for: ${failures.join(", ")}.`
      : `Generated clips for ${eligible.length} topic(s).`);
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
    setGenerationAction(`question:${topicId}`);
    try {
      const question = await questionRequest(
        `${pipelineBaseUrl}/topics/${topicId}/questions/generate`,
        { method: "POST" },
      );
      if (question) upsertQuestion(question);
    } finally {
      setGenerationAction(null);
    }
  }

  async function generateAllMissingQuestions() {
    if (!job?.video_id || !graph) return;
    const eligible = topics.filter(
      (topic) =>
        (topic.review_status === "accepted" || topic.review_status === "edited") &&
        assessmentGenerationBlockReason(topic, graph.concepts, clips) === null &&
        !questions.some(
          (question) => question.topic_id === topic.id && question.review_status !== "dismissed",
        ),
    );
    if (!eligible.length) {
      setMessage("Every eligible topic already has a question, or still needs reviewed concepts and clips.");
      return;
    }
    setBulkAction("questions");
    setMessage(`Generating questions for ${eligible.length} eligible topic(s).`);
    const failures: string[] = [];
    for (const topic of eligible) {
      const response = await fetch(`${pipelineBaseUrl}/topics/${topic.id}/questions/generate`, { method: "POST" });
      if (!response.ok) failures.push(topic.title);
    }
    await loadQuestions(job.video_id);
    setBulkAction(null);
    setMessage(failures.length
      ? `Question generation failed for: ${failures.join(", ")}.`
      : `Generated questions for ${eligible.length} topic(s).`);
  }

  async function acceptAllQuestions() {
    if (!job?.video_id) return;
    const proposed = questions.filter((question) => question.review_status === "proposed");
    if (!proposed.length) return;
    setBulkAction("accept-questions");
    const responses = await Promise.all(
      proposed.map((question) => fetch(`${pipelineBaseUrl}/questions/${question.id}/accept`, { method: "POST" })),
    );
    const failures = responses.filter((response) => !response.ok).length;
    await loadQuestions(job.video_id);
    setBulkAction(null);
    setMessage(failures
      ? `${failures} question proposal(s) could not be accepted.`
      : `${proposed.length} question proposal(s) accepted.`);
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
    setGenerationAction(`regenerate:${questionId}`);
    try {
      const question = await questionRequest(
        `${pipelineBaseUrl}/questions/${questionId}/regenerate`,
        { method: "POST" },
      );
      if (question) upsertQuestion(question);
    } finally {
      setGenerationAction(null);
    }
  }

  async function editQuestion(questionId: string) {
    const draft = questionDrafts[questionId];
    const originalQuestion = questions.find((item) => item.id === questionId);
    if (!draft || !originalQuestion) return;
    if (!draft.body.trim() || !draft.correct_answer.trim() || !draft.confidence_prompt.trim()) {
      setMessage("Question, correct answer, and confidence prompt are required.");
      return;
    }
    if (draft.remediation_rules.some((rule) => !rule.wrong_answer_pattern.trim())) {
      setMessage("Each remediation rule needs a wrong-answer pattern.");
      return;
    }
    const updatedQuestion = await questionRequest(`${pipelineBaseUrl}/questions/${questionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: draft.body,
        type: draft.type,
        correct_answer: correctAnswerPayload(originalQuestion.correct_answer, draft),
        confidence_prompt: draft.confidence_prompt,
        remediation_rules: remediationPayload(draft),
      }),
    });
    if (updatedQuestion) upsertQuestion(updatedQuestion);
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

  function updateRemediationRule(
    questionId: string,
    ruleIndex: number,
    field: keyof QuestionDraft["remediation_rules"][number],
    value: string,
  ) {
    setQuestionDrafts((current) => {
      const draft = current[questionId];
      if (!draft) return current;
      return {
        ...current,
        [questionId]: {
          ...draft,
          remediation_rules: draft.remediation_rules.map((rule, index) =>
            index === ruleIndex ? { ...rule, [field]: value } : rule,
          ),
        },
      };
    });
  }

  function addRemediationRule(questionId: string) {
    setQuestionDrafts((current) => {
      const draft = current[questionId];
      if (!draft) return current;
      return {
        ...current,
        [questionId]: {
          ...draft,
          remediation_rules: [
            ...draft.remediation_rules,
            { wrong_answer_pattern: "", target_clip_id: "", target_concept_id: "", rationale: "" },
          ],
        },
      };
    });
  }

  function removeRemediationRule(questionId: string, ruleIndex: number) {
    setQuestionDrafts((current) => {
      const draft = current[questionId];
      if (!draft) return current;
      return {
        ...current,
        [questionId]: {
          ...draft,
          remediation_rules: draft.remediation_rules.filter((_, index) => index !== ruleIndex),
        },
      };
    });
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

  async function applyAllRoutingPolicies() {
    if (!job?.course_id || !routingConcepts.length) return;
    setMessage(null);
    const responses = await Promise.all(
      routingConcepts.map((concept) => {
        const draft = policyDrafts[concept.id] ?? defaultRoutingPolicyDraft();
        return fetch(`${pipelineBaseUrl}/courses/${job.course_id}/routing/policies/${concept.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
      }),
    );
    const failed = responses.find((response) => !response.ok);
    if (failed) {
      setMessage(`Apply all routing policies failed with ${failed.status}.`);
      return;
    }
    await loadRoutingPolicies(job.course_id);
    setMessage(`Routing policies applied to ${routingConcepts.length} concept(s).`);
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
    answer = correctness ? "demo-correct" : "demo-incorrect",
  ) {
    const learnerId = isLearnerContext ? selectedIdentity?.id ?? null : demoLearnerId;
    if (!learnerId || (isLearnerContext && !isEnrolled)) {
      setRoutingError(
        isLearnerContext
          ? "Enroll and start the published course before submitting answers."
          : "Create a demo learner before submitting attempts.",
      );
      return;
    }
    setRoutingError(null);
    const response = await fetch(
      `${pipelineBaseUrl}/learners/${learnerId}/questions/${questionId}/attempt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer: { answer },
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
    await loadLearnerProgress(learnerId);
    if (job?.course_id) await loadDashboard(job.course_id);
  }

  async function gradeAndSubmitLearnerAnswer(question: Question) {
    if (!learnerAnswer.trim() || learnerConfidence === null) {
      setRoutingError("Choose or enter an answer and select your confidence before submitting.");
      return;
    }
    setIsGradingAnswer(true);
    setGradingFeedback(null);
    setRoutingError(null);
    try {
      const response = await fetch(`${pipelineBaseUrl}/questions/${question.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: learnerAnswer.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRoutingError(body?.detail ?? `Answer grading failed with ${response.status}.`);
        return;
      }
      const grade = (await response.json()) as {
        is_correct: boolean;
        feedback: string;
        wrong_answer_pattern: string | null;
      };
      setGradingFeedback(grade.feedback);
      await submitLearnerAttempt(
        question.id,
        grade.is_correct,
        learnerConfidence,
        grade.wrong_answer_pattern,
        learnerAnswer.trim(),
      );
    } finally {
      setIsGradingAnswer(false);
    }
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

  const selectedTopicReview =
    topics.find((topic) => topic.id === selectedTopicReviewId) ?? topics[0] ?? null;
  const selectedTopicReviewIndex = selectedTopicReview
    ? topics.findIndex((topic) => topic.id === selectedTopicReview.id)
    : -1;
  const selectedClipReview =
    clips.find((clip) => clip.id === selectedClipReviewId) ?? clips[0] ?? null;
  const selectedQuestionReview =
    questions.find((question) => question.id === selectedQuestionReviewId) ?? questions[0] ?? null;
  const selectedGraphConcept =
    graph?.concepts.find((concept) => concept.id === selectedGraphConceptId) ?? graph?.concepts[0] ?? null;
  const selectedGraphEdge =
    graph?.edges.find((edge) => edge.id === selectedGraphEdgeId) ?? null;
  const routingConcepts = graph?.concepts.filter(
    (concept) => concept.review_status === "accepted" || concept.review_status === "edited",
  ) ?? [];
  const selectedRoutingConcept =
    routingConcepts.find((concept) => concept.id === selectedRoutingConceptId) ?? routingConcepts[0] ?? null;
  const simulatorQuestions = questions.filter(
    (question) => question.review_status === "accepted" || question.review_status === "edited",
  );
  const selectedSimulatorQuestion =
    simulatorQuestions.find((question) => question.id === selectedSimulatorQuestionId) ?? simulatorQuestions[0] ?? null;
  const selectedDashboardSignal =
    dashboardSummary?.signals.find((signal) => signal.id === selectedDashboardSignalId) ?? dashboardSummary?.signals[0] ?? null;

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
      <CourseSetupWorkspace
        course={course}
        deliveryCapacity={deliveryCapacity}
        isSubmitting={isSubmitting}
        job={job}
        message={isLearnerContext ? null : message}
        onFileChange={setSelectedFile}
        onLoadDemo={() => void loadDemo()}
        onSubmitFile={uploadFile}
        onSubmitUrl={submitUrl}
        onUrlChange={setUrl}
        publishBlockers={publishReadiness?.blockers ?? []}
        publishReady={publishReadiness?.ready ?? false}
        reviewedConceptCount={graph?.concepts.filter((concept) => concept.review_status !== "proposed").length ?? 0}
        reviewedQuestionCount={questions.filter((question) => question.review_status !== "proposed").length}
        reviewedTopicCount={topics.filter((topic) => topic.review_status !== "proposed").length}
        routingPolicyCount={routingPolicies.length}
        selectedFileName={selectedFile?.name ?? null}
        totalClipCount={clips.length}
        totalConceptCount={graph?.concepts.length ?? 0}
        totalQuestionCount={questions.length}
        totalTopicCount={topics.length}
        url={url}
      />
      {isLearnerContext && message ? (
        <div className="border-b border-border bg-primary/5 px-8 py-3 text-sm text-foreground" role="status">
          {message}
        </div>
      ) : null}

      {transcript ? (
        <details className="instructorOnly border-b border-border bg-background px-6 py-4 xl:px-8">
          <summary className="cursor-pointer text-sm font-medium">View processed transcript <span className="ml-2 text-xs font-normal text-muted-foreground">{transcript.words.length} timestamped words</span></summary>
          <p className="mt-4 max-w-4xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{transcript.text}</p>
        </details>
      ) : null}

      {transcript && job?.video_id ? (
        <div id="outline">
          <ReviewWorkspace
            description="Confirm topic boundaries, titles, and summaries before graph generation."
            eyebrow="Content review"
            title="Topic outline"
            toolbar={(
              <>
                <Button onClick={() => loadTopics(job.video_id!)} type="button" variant="outline">
                  <RefreshCw data-icon="inline-start" /> Refresh
                </Button>
                <Button
                  disabled={!topics.some((topic) => topic.review_status === "proposed")}
                  onClick={() => void acceptAllTopics()}
                  type="button"
                  variant="outline"
                >
                  Accept all
                </Button>
                <Button disabled={isSegmenting} onClick={() => void segmentTranscript()} type="button">
                  <Sparkles data-icon="inline-start" />
                  {isSegmenting ? "Segmenting" : "Generate Outline"}
                </Button>
              </>
            )}
          >
            {topics.length === 0 ? (
              <div className="px-8 py-16 text-center" role={isSegmenting ? "status" : undefined}>
                <p className="text-sm font-medium">{isSegmenting ? "Generating topic outline" : "No topics yet"}</p>
                <p className="mt-1 text-sm text-muted-foreground">{isSegmenting ? "The transcript is ready. AI is identifying topic boundaries and summaries." : "Generate an outline to begin instructor review."}</p>
              </div>
            ) : selectedTopicReview ? (() => {
              const topic = selectedTopicReview;
              const index = selectedTopicReviewIndex;
              const draft = topicDrafts[topic.id] ?? topicToDraft(topic);
              const nextTopic = topics[index + 1];
              return (
                <ReviewWorkspaceGrid
                  queue={(
                    <>
                      <ReviewQueueHeader reviewed={reviewedTopics} total={topics.length} />
                      <nav aria-label="Topics">
                        {topics.map((item) => (
                          <ReviewQueueItem
                            active={item.id === topic.id}
                            detail={`${formatTime(item.start_seconds)}–${formatTime(item.end_seconds)} · ${item.review_status}`}
                            key={item.id}
                            label={item.title}
                            onClick={() => setSelectedTopicReviewId(item.id)}
                            status={item.review_status}
                          />
                        ))}
                      </nav>
                    </>
                  )}
                  editor={(
                    <div className="mx-auto max-w-2xl">
                      <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Topic {index + 1} of {topics.length}</p>
                          <h3 className="mt-1 text-lg font-semibold">Review topic</h3>
                        </div>
                        <Badge className="capitalize" variant="outline">{topic.review_status}</Badge>
                      </div>
                      <div className="space-y-5">
                        <label className="grid gap-2 text-sm font-medium" htmlFor={`title-${topic.id}`}>
                          Title
                          <Input
                            className="h-10"
                            id={`title-${topic.id}`}
                            value={draft.title}
                            onChange={(event) => setTopicDrafts((current) => ({
                              ...current, [topic.id]: { ...draft, title: event.target.value },
                            }))}
                          />
                        </label>
                        <label className="grid gap-2 text-sm font-medium" htmlFor={`summary-${topic.id}`}>
                          Summary
                          <Textarea
                            className="min-h-36"
                            id={`summary-${topic.id}`}
                            value={draft.summary}
                            onChange={(event) => setTopicDrafts((current) => ({
                              ...current, [topic.id]: { ...draft, summary: event.target.value },
                            }))}
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                          <label className="grid gap-2 text-sm font-medium">Start
                            <Input min="0" step="1" type="number" value={draft.start_seconds} onChange={(event) =>
                              setTopicDrafts((current) => ({ ...current, [topic.id]: { ...draft, start_seconds: Number(event.target.value) } }))
                            } />
                          </label>
                          <label className="grid gap-2 text-sm font-medium">End
                            <Input min="0" step="1" type="number" value={draft.end_seconds} onChange={(event) =>
                              setTopicDrafts((current) => ({ ...current, [topic.id]: { ...draft, end_seconds: Number(event.target.value) } }))
                            } />
                          </label>
                        </div>
                      </div>
                      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-5">
                        <Button disabled={acceptButtonDisabled(topic.review_status)} onClick={() => acceptTopic(topic.id)} type="button">
                          {acceptButtonLabel(topic.review_status)}
                        </Button>
                        <Button onClick={() => updateTopic(topic.id, draft)} type="button" variant="outline">Edit manually</Button>
                        <Button onClick={() => dismissTopic(topic.id)} type="button" variant="destructive">Dismiss</Button>
                        <Button onClick={() => splitTopic(topic)} type="button" variant="ghost">Split</Button>
                        <Button disabled={!nextTopic} onClick={() => mergeTopicWithNext(index)} type="button" variant="ghost">Merge next</Button>
                      </div>
                      <details className="mt-8 border-t border-border pt-5">
                        <summary className="cursor-pointer text-sm font-medium">Add a topic manually</summary>
                        <form className="mt-4 grid gap-3" onSubmit={addManualTopic}>
                          <Input aria-label="Manual topic title" placeholder="Title" value={manualTopic.title} onChange={(event) => setManualTopic((current) => ({ ...current, title: event.target.value }))} />
                          <Textarea aria-label="Manual topic summary" placeholder="Summary" value={manualTopic.summary} onChange={(event) => setManualTopic((current) => ({ ...current, summary: event.target.value }))} />
                          <div className="grid grid-cols-2 gap-3">
                            <Input aria-label="Manual topic start" min="0" step="1" type="number" value={manualTopic.start_seconds} onChange={(event) => setManualTopic((current) => ({ ...current, start_seconds: Number(event.target.value) }))} />
                            <Input aria-label="Manual topic end" min="0" step="1" type="number" value={manualTopic.end_seconds} onChange={(event) => setManualTopic((current) => ({ ...current, end_seconds: Number(event.target.value) }))} />
                          </div>
                          <Button className="w-fit" disabled={!manualTopic.title} type="submit">Add topic</Button>
                        </form>
                      </details>
                    </div>
                  )}
                  inspector={(
                    <>
                      <InspectorSection title="Source range">
                        <p className="text-sm font-medium">{formatTime(draft.start_seconds)}–{formatTime(draft.end_seconds)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDuration(draft.end_seconds - draft.start_seconds)} duration</p>
                        {nextTopic ? (
                          <label className="mt-4 grid gap-2 text-xs font-medium">Boundary with next topic
                            <input
                              className="accent-primary"
                              max={Math.floor(nextTopic.end_seconds - 30)}
                              min={Math.ceil(topic.start_seconds + 30)}
                              onChange={(event) => setTopicDrafts((current) => ({
                                ...current,
                                [topic.id]: { ...draft, end_seconds: Number(event.target.value) },
                                [nextTopic.id]: { ...(current[nextTopic.id] ?? topicToDraft(nextTopic)), start_seconds: Number(event.target.value) },
                              }))}
                              onMouseUp={(event) => retimeBoundary(index, Number(event.currentTarget.value))}
                              onTouchEnd={(event) => retimeBoundary(index, Number(event.currentTarget.value))}
                              step="1"
                              type="range"
                              value={Math.round(draft.end_seconds)}
                            />
                          </label>
                        ) : null}
                      </InspectorSection>
                      {coverageGaps.length ? (
                        <InspectorSection title="Coverage warnings">
                          <ul className="space-y-2 text-xs leading-5 text-amber-800">
                            {coverageGaps.map((gap) => <li key={`${gap.start_seconds}-${gap.end_seconds}`}>{formatDuration(gap.duration_seconds)} unassigned at {formatTime(gap.start_seconds)}–{formatTime(gap.end_seconds)}</li>)}
                          </ul>
                        </InspectorSection>
                      ) : null}
                      <InspectorSection title="Traceability"><TraceabilityBlock artifact={topic} /></InspectorSection>
                    </>
                  )}
                />
              );
            })() : null}
          </ReviewWorkspace>
        </div>
      ) : null}

      {job?.course_id ? (
        <section className="instructorOnly border-b border-border bg-background" id="concept-graph">
          <header className="flex min-h-24 flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5 xl:px-8">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Knowledge structure</p>
              <h2 className="mt-1 text-xl font-semibold">Concept graph</h2>
              <p className="mt-1 text-sm text-muted-foreground">Review prerequisite structure and inspect each AI-proposed relationship.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <select
                aria-label="Graph review filter"
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                data-slot="graph-filter"
                onChange={(event) => setGraphReviewFilter(event.target.value as typeof graphReviewFilter)}
                value={graphReviewFilter}
              >
                <option value="all">All artifacts</option><option value="proposed">Proposed</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option>
              </select>
              <Button disabled={generationAction === "graph" || isAcceptingGraph} onClick={() => loadGraph(job.course_id!)} type="button" variant="outline"><RefreshCw data-icon="inline-start" /> Refresh</Button>
              <Button
                disabled={generationAction === "graph" || isAcceptingGraph || !graph || ![...graph.concepts, ...graph.edges].some((artifact) => artifact.review_status === "proposed")}
                onClick={() => void acceptAllGraphProposals()}
                type="button"
                variant="outline"
              >
                {isAcceptingGraph ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                {isAcceptingGraph ? "Accepting" : "Accept all"}
              </Button>
              <Button disabled={graphBlockReason !== null || generationAction !== null} onClick={generateGraph} type="button">
                {generationAction === "graph" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                {generationAction === "graph" ? "Generating graph" : "Generate graph"}
              </Button>
            </div>
          </header>

          {graphBlockReason ? (
            <div className="border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900" role="alert">
              <strong>Graph generation blocked.</strong> {graphBlockReason} Reviewed topics: {reviewedTopics} of {topics.length}.
            </div>
          ) : null}
          {generationAction === "graph" ? (
            <div aria-live="polite" className="border-b border-primary/20 bg-primary/5 px-8 py-3 text-sm" role="status">
              <strong>Generating a fresh graph.</strong> Review actions are paused until the replacement is complete. This can take up to two minutes on the free deployment.
            </div>
          ) : null}
          {graph?.warnings.length ? (
            <div className="border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900" role="alert">
              <strong>Review warnings:</strong> {graph.warnings.join(" ")}
            </div>
          ) : null}
          {graph && topicsWithoutReviewedConcepts.length ? (
            <div className="border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900" role="alert">
              <strong>{topicsWithoutReviewedConcepts.length} reviewed topic(s) have no reviewed concept link.</strong>{" "}
              Select a concept, check its relevant topics under Linked topics, and save the links before generating clips.
            </div>
          ) : null}

          {graph ? (
            <div className="grid grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="relative min-w-0 bg-muted/15">
                <div className="absolute left-5 top-5 z-10 flex gap-2 rounded-lg border border-border bg-background p-2 shadow-sm">
                  <Badge variant="outline">{flowNodes.length} concepts</Badge>
                  <Badge variant="outline">{flowEdges.length} edges</Badge>
                </div>
                <div className="h-[700px] min-w-0">
                  <ReactFlow
                    edges={flowEdges}
                    fitView
                    nodes={flowNodes}
                    onConnect={handleConnect}
                    onEdgeClick={(_, edge) => { setSelectedGraphEdgeId(edge.id); setSelectedGraphConceptId(""); }}
                    onNodeClick={(_, node) => { setSelectedGraphConceptId(node.id); setSelectedGraphEdgeId(""); }}
                  >
                    <Background gap={24} size={1} />
                    <Controls />
                  </ReactFlow>
                </div>
              </div>

              <aside className="max-h-[700px] overflow-y-auto border-l border-border bg-background px-5 py-6" aria-label="Graph inspector">
                {selectedGraphEdge ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-xs font-semibold uppercase text-muted-foreground">Prerequisite edge</p><h3 className="mt-2 text-base font-semibold">{conceptName(graph, selectedGraphEdge.from_concept_id)} → {conceptName(graph, selectedGraphEdge.to_concept_id)}</h3></div>
                      <Badge className="capitalize" variant="outline">{selectedGraphEdge.review_status}</Badge>
                    </div>
                    <div className="mt-5 flex gap-2 border-b border-border pb-5">
                      <Button disabled={acceptButtonDisabled(selectedGraphEdge.review_status)} onClick={() => acceptEdge(selectedGraphEdge.id)} size="sm" type="button">{acceptButtonLabel(selectedGraphEdge.review_status)}</Button>
                      <Button onClick={() => dismissEdge(selectedGraphEdge.id)} size="sm" type="button" variant="destructive">Dismiss</Button>
                    </div>
                    <InspectorSection title="Traceability"><TraceabilityBlock artifact={selectedGraphEdge} /></InspectorSection>
                  </>
                ) : selectedGraphConcept ? (() => {
                  const concept = selectedGraphConcept;
                  const draft = conceptDrafts[concept.id] ?? { name: concept.name, description: concept.description ?? "" };
                  return (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-xs font-semibold uppercase text-muted-foreground">Concept</p><h3 className="mt-2 text-base font-semibold">{concept.name}</h3></div>
                        <Badge className="capitalize" variant="outline">{concept.review_status}</Badge>
                      </div>
                      <div className="mt-5 space-y-4">
                        <label className="grid gap-2 text-sm font-medium">Name<Input aria-label={`Concept name ${concept.name}`} value={draft.name} onChange={(event) => setConceptDrafts((current) => ({ ...current, [concept.id]: { ...draft, name: event.target.value } }))} /></label>
                        <label className="grid gap-2 text-sm font-medium">Description<Textarea aria-label={`Concept description ${concept.name}`} className="min-h-28" value={draft.description} onChange={(event) => setConceptDrafts((current) => ({ ...current, [concept.id]: { ...draft, description: event.target.value } }))} /></label>
                        <fieldset className="grid gap-2 border-0 p-0" data-slot="concept-topic-links">
                          <legend className="text-sm font-medium">Linked topics</legend>
                          <p className="text-xs leading-5 text-muted-foreground">Every topic needs at least one reviewed concept link before clips can be generated.</p>
                          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                            {topics.map((topic) => {
                              const checked = (conceptTopicDrafts[concept.id] ?? []).includes(topic.id);
                              return (
                                <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted" key={topic.id}>
                                  <input
                                    checked={checked}
                                    className="mt-0.5 size-3.5 accent-primary"
                                    data-slot="concept-topic-checkbox"
                                    onChange={(event) => setConceptTopicDrafts((current) => {
                                      const existing = current[concept.id] ?? [];
                                      return {
                                        ...current,
                                        [concept.id]: event.target.checked
                                          ? [...existing, topic.id]
                                          : existing.filter((topicId) => topicId !== topic.id),
                                      };
                                    })}
                                    type="checkbox"
                                  />
                                  <span className="leading-5">{topic.title}</span>
                                </label>
                              );
                            })}
                          </div>
                          <Button onClick={() => void updateConceptTopicLinks(concept.id)} size="sm" type="button" variant="outline">Save topic links</Button>
                        </fieldset>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2 border-b border-border pb-5">
                        <Button disabled={acceptButtonDisabled(concept.review_status)} onClick={() => acceptConcept(concept.id)} size="sm" type="button">{acceptButtonLabel(concept.review_status)}</Button>
                        <Button onClick={() => updateConcept(concept.id, draft)} size="sm" type="button" variant="outline">Edit manually</Button>
                        <Button onClick={() => dismissConcept(concept.id)} size="sm" type="button" variant="destructive">Dismiss</Button>
                      </div>
                      <InspectorSection title="Traceability"><TraceabilityBlock artifact={concept} /></InspectorSection>
                    </>
                  );
                })() : <p className="text-sm text-muted-foreground">Select a concept or edge to inspect it.</p>}

                <InspectorSection title="Browse artifacts">
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {graph.concepts.map((concept) => <button className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted" data-slot="graph-artifact" key={concept.id} onClick={() => { setSelectedGraphConceptId(concept.id); setSelectedGraphEdgeId(""); }} type="button"><span className="truncate">{concept.name}</span><span className="text-xs capitalize text-muted-foreground">{concept.review_status}</span></button>)}
                    {graph.edges.map((edge) => <button className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted" data-slot="graph-artifact" key={edge.id} onClick={() => { setSelectedGraphEdgeId(edge.id); setSelectedGraphConceptId(""); }} type="button"><span className="truncate">{conceptName(graph, edge.from_concept_id)} → {conceptName(graph, edge.to_concept_id)}</span><span className="text-xs capitalize text-muted-foreground">{edge.review_status}</span></button>)}
                  </div>
                </InspectorSection>

                <details className="border-b border-border py-4">
                  <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">Merge duplicate concepts</summary>
                  <form className="mt-3 grid gap-2" onSubmit={mergeConcepts}>
                    <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" data-slot="merge-concept-source" value={mergeSourceId} onChange={(event) => setMergeSourceId(event.target.value)}>{graph.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select>
                    <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" data-slot="merge-concept-target" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>{graph.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select>
                    <Button disabled={!mergeSourceId || !mergeTargetId} size="sm" type="submit">Merge duplicate</Button>
                  </form>
                </details>
                <details className="py-4">
                  <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">Add prerequisite edge</summary>
                  <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); addGraphEdge(newEdge); }}>
                    <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" data-slot="edge-source" value={newEdge.from_concept_id} onChange={(event) => setNewEdge((current) => ({ ...current, from_concept_id: event.target.value }))}>{graph.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select>
                    <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" data-slot="edge-target" value={newEdge.to_concept_id} onChange={(event) => setNewEdge((current) => ({ ...current, to_concept_id: event.target.value }))}>{graph.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select>
                    <Input aria-label="Edge rationale" placeholder="Rationale" value={newEdge.rationale} onChange={(event) => setNewEdge((current) => ({ ...current, rationale: event.target.value }))} />
                    <Button size="sm" type="submit">Add edge</Button>
                  </form>
                </details>
              </aside>
            </div>
          ) : (
            <div className="px-8 py-16 text-center"><p className="text-sm font-medium">No graph generated</p><p className="mt-1 text-sm text-muted-foreground">Review at least one topic, then generate the concept graph.</p></div>
          )}
        </section>
      ) : null}

      {job?.video_id && topics.length > 0 ? (
        <div id="clips">
          <ReviewWorkspace
            description="Preview source boundaries and flag only clips that need a corrected cut."
            eyebrow="Media review"
            title="Clip spot check"
            toolbar={(
              <>
                <Button onClick={() => loadClips(job.video_id!)} type="button" variant="outline">
                  <RefreshCw data-icon="inline-start" /> Refresh
                </Button>
                <Button disabled={bulkAction !== null || generationAction !== null} onClick={() => void generateAllMissingClips()} type="button">
                  {bulkAction === "clips" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />} {bulkAction === "clips" ? "Generating clips" : "Generate all missing clips"}
                </Button>
              </>
            )}
          >
            <ReviewWorkspaceGrid
              queue={(
                <>
                  <ReviewQueueHeader reviewed={clips.filter((clip) => clip.status !== "active").length} total={clips.length} />
                  {clips.length ? (
                    <nav aria-label="Clips">
                      {clips.map((clip, index) => (
                        <ReviewQueueItem
                          active={clip.id === selectedClipReview?.id}
                          detail={`${formatTime(clip.start_seconds)}–${formatTime(clip.end_seconds)} · ${clip.status}`}
                          key={clip.id}
                          label={`Clip ${index + 1}: ${clip.type.replaceAll("_", " ")}`}
                          onClick={() => setSelectedClipReviewId(clip.id)}
                          status={clip.status}
                        />
                      ))}
                    </nav>
                  ) : <p className="px-4 py-6 text-sm text-muted-foreground">No clips generated yet.</p>}
                </>
              )}
              editor={selectedClipReview ? (
                <div className="mx-auto max-w-3xl">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase text-muted-foreground">{selectedClipReview.type.replaceAll("_", " ")}</p>
                      <h3 className="mt-1 text-lg font-semibold">{formatTime(selectedClipReview.start_seconds)}–{formatTime(selectedClipReview.end_seconds)}</h3>
                    </div>
                    <Badge className="capitalize" variant="outline">{selectedClipReview.status}</Badge>
                  </div>
                  {job.video_id && playback ? (
                    <ProviderVideo
                      endSeconds={selectedClipReview.end_seconds}
                      pipelineBaseUrl={pipelineBaseUrl}
                      playback={playback}
                      startSeconds={selectedClipReview.start_seconds}
                      title={`Instructor preview: ${selectedClipReview.type.replaceAll("_", " ")}`}
                      videoId={job.video_id}
                    />
                  ) : <div className="flex aspect-video items-center justify-center bg-black text-sm text-white/70">Preview unavailable</div>}
                  <div className="mt-5 grid grid-cols-3 gap-4 border-b border-border pb-5 text-sm">
                    <div><p className="text-xs text-muted-foreground">Duration</p><p className="mt-1 font-medium">{formatDuration(selectedClipReview.end_seconds - selectedClipReview.start_seconds)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Difficulty</p><p className="mt-1 font-medium capitalize">{selectedClipReview.difficulty ?? "Not set"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Concept tags</p><p className="mt-1 font-medium">{selectedClipReview.concept_ids.length}</p></div>
                  </div>
                  <label className="mt-5 grid gap-2 text-sm font-medium">
                    Review note
                    <Textarea
                      aria-label={`Flag note for clip ${selectedClipReview.id}`}
                      className="min-h-24"
                      placeholder="Describe the boundary issue or re-cut instruction"
                      value={clipNotes[selectedClipReview.id] ?? ""}
                      onChange={(event) => setClipNotes((current) => ({ ...current, [selectedClipReview.id]: event.target.value }))}
                    />
                  </label>
                  <div className="mt-5 flex gap-2">
                    <Button disabled={clipSpotCheckActionsDisabled(selectedClipReview)} onClick={() => flagClip(selectedClipReview.id)} type="button" variant="destructive">Flag clip</Button>
                    <Button disabled={clipSpotCheckActionsDisabled(selectedClipReview)} onClick={() => recutClip(selectedClipReview.id)} type="button" variant="outline">Re-cut with note</Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-96 items-center justify-center text-center">
                  <div><p className="text-sm font-medium">No clip selected</p><p className="mt-1 text-sm text-muted-foreground">Generate clips from a reviewed topic to begin spot checks.</p></div>
                </div>
              )}
              inspector={(
                <>
                  <InspectorSection title="Generate by topic">
                    <div className="space-y-3">
                      {topics.filter(isTopicReviewedForClipGeneration).map((topic) => {
                        const concepts = graph?.concepts ?? [];
                        const blockReason = topicClipGenerationBlockReason(topic, concepts);
                        return (
                          <div className="border-b border-border pb-3 last:border-0" key={topic.id}>
                            <p className="truncate text-sm font-medium">{topic.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{reviewedConceptCountForTopic(topic.id, concepts)} reviewed concepts</p>
                            {blockReason ? <p className="mt-1 text-xs leading-5 text-amber-700">{blockReason}</p> : null}
                            <Button className="mt-2" disabled={blockReason !== null || generationAction !== null || bulkAction !== null} onClick={() => generateClipsForTopic(topic.id)} size="sm" type="button" variant="outline">
                              {generationAction === `clips:${topic.id}` ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                              {generationAction === `clips:${topic.id}` ? "Generating clips" : "Generate clips"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </InspectorSection>
                  {selectedClipReview ? (
                    <>
                      {selectedClipReview.flag_note ? <InspectorSection title="Existing flag"><p className="text-sm leading-6">{selectedClipReview.flag_note}</p></InspectorSection> : null}
                      {selectedClipReview.source_clip_id ? <InspectorSection title="Source"><p className="break-all text-xs text-muted-foreground">Re-cut from {selectedClipReview.source_clip_id}</p></InspectorSection> : null}
                      <InspectorSection title="Traceability"><TraceabilityBlock artifact={selectedClipReview} /></InspectorSection>
                    </>
                  ) : null}
                </>
              )}
            />
          </ReviewWorkspace>
        </div>
      ) : null}

      {job?.video_id && topics.length > 0 ? (
        <div id="assessments">
          <ReviewWorkspace
            description="Approve learner-facing checks and verify that remediation maps to reviewed content."
            eyebrow="Assessment review"
            title="Comprehension checks"
            toolbar={(
              <>
                <Button onClick={() => loadQuestions(job.video_id!)} type="button" variant="outline">
                  <RefreshCw data-icon="inline-start" /> Refresh
                </Button>
                <Button disabled={bulkAction !== null || generationAction !== null} onClick={() => void generateAllMissingQuestions()} type="button" variant="outline">
                  {bulkAction === "questions" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />} {bulkAction === "questions" ? "Generating questions" : "Generate all missing"}
                </Button>
                <Button
                  disabled={bulkAction !== null || generationAction !== null || !questions.some((question) => question.review_status === "proposed")}
                  onClick={() => void acceptAllQuestions()}
                  type="button"
                >
                  {bulkAction === "accept-questions" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                  {bulkAction === "accept-questions" ? "Accepting proposals" : "Accept all proposals"}
                </Button>
              </>
            )}
          >
            <ReviewWorkspaceGrid
              queue={(
                <>
                  <ReviewQueueHeader
                    reviewed={questions.filter((question) => question.review_status !== "proposed").length}
                    total={questions.length}
                  />
                  {questions.length ? (
                    <nav aria-label="Assessment questions">
                      {questions.map((question) => (
                        <ReviewQueueItem
                          active={question.id === selectedQuestionReview?.id}
                          detail={`${question.type.replaceAll("_", " ")} · ${question.review_status}`}
                          key={question.id}
                          label={topics.find((topic) => topic.id === question.topic_id)?.title ?? question.body}
                          onClick={() => setSelectedQuestionReviewId(question.id)}
                          status={question.review_status}
                        />
                      ))}
                    </nav>
                  ) : <p className="px-4 py-6 text-sm text-muted-foreground">No assessment proposals yet.</p>}
                </>
              )}
              editor={selectedQuestionReview ? (() => {
                const question = selectedQuestionReview;
                const draft = questionDrafts[question.id] ?? questionToDraft(question);
                return (
                  <div className="mx-auto max-w-2xl">
                    <div className="mb-6 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{topics.find((topic) => topic.id === question.topic_id)?.title ?? "Untitled topic"}</p>
                        <h3 className="mt-1 text-lg font-semibold">Review question</h3>
                      </div>
                      <Badge className="capitalize" variant="outline">{question.review_status}</Badge>
                    </div>
                    <div className="space-y-4">
                      <label className="grid gap-2 text-sm font-medium" htmlFor={`question-body-${question.id}`}>Question
                        <Textarea className="min-h-28" id={`question-body-${question.id}`} value={draft.body} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, body: event.target.value } }))} />
                      </label>
                      <label className="grid gap-2 text-sm font-medium" htmlFor={`question-type-${question.id}`}>Type
                        <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" data-slot="question-type" id={`question-type-${question.id}`} value={draft.type} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, type: event.target.value as Question["type"] } }))}>
                          <option value="mcq">Multiple choice</option><option value="short_answer">Short answer</option><option value="worked_problem">Worked problem</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm font-medium" htmlFor={`question-answer-${question.id}`}>Correct answer
                        <Textarea className="min-h-20" id={`question-answer-${question.id}`} value={draft.correct_answer} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, correct_answer: event.target.value } }))} />
                      </label>
                      {draft.type === "mcq" ? (
                        <label className="grid gap-2 text-sm font-medium" htmlFor={`question-choices-${question.id}`}>Answer choices <span className="font-normal text-muted-foreground">One choice per line</span>
                          <Textarea className="min-h-28" id={`question-choices-${question.id}`} value={draft.answer_choices} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, answer_choices: event.target.value } }))} />
                        </label>
                      ) : null}
                      <label className="grid gap-2 text-sm font-medium" htmlFor={`question-confidence-${question.id}`}>Confidence prompt
                        <Input id={`question-confidence-${question.id}`} value={draft.confidence_prompt} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, confidence_prompt: event.target.value } }))} />
                      </label>
                      <fieldset className="space-y-3 border-t border-border pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <legend className="text-sm font-medium">Remediation rules</legend>
                          <Button onClick={() => addRemediationRule(question.id)} size="sm" type="button" variant="outline"><Plus data-icon="inline-start" /> Add rule</Button>
                        </div>
                        {draft.remediation_rules.length ? draft.remediation_rules.map((rule, ruleIndex) => (
                          <div className="space-y-3 border border-border bg-muted/20 p-4" key={`${question.id}-rule-${ruleIndex}`}>
                            <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Rule {ruleIndex + 1}</p><Button aria-label={`Remove remediation rule ${ruleIndex + 1}`} onClick={() => removeRemediationRule(question.id, ruleIndex)} size="icon-sm" type="button" variant="ghost"><Trash2 /></Button></div>
                            <label className="grid gap-1.5 text-xs font-medium">When the learner answers like this<Input value={rule.wrong_answer_pattern} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "wrong_answer_pattern", event.target.value)} /></label>
                            <div className="grid grid-cols-2 gap-3">
                              <label className="grid min-w-0 gap-1.5 text-xs font-medium">Send to clip<select className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm" value={rule.target_clip_id} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "target_clip_id", event.target.value)}><option value="">No specific clip</option>{clips.filter((clip) => clip.status !== "superseded").map((clip, index) => <option key={clip.id} value={clip.id}>Clip {index + 1}: {clip.type.replaceAll("_", " ")}</option>)}</select></label>
                              <label className="grid min-w-0 gap-1.5 text-xs font-medium">Reinforce concept<select className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm" value={rule.target_concept_id} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "target_concept_id", event.target.value)}><option value="">No specific concept</option>{graph?.concepts.filter((concept) => concept.review_status === "accepted" || concept.review_status === "edited").map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></label>
                            </div>
                            <label className="grid gap-1.5 text-xs font-medium">Why this remediation helps<Textarea className="min-h-20" value={rule.rationale} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "rationale", event.target.value)} /></label>
                          </div>
                        )) : <p className="text-sm text-muted-foreground">No targeted remediation rules. Add one to route a recognizable wrong answer to a clip or concept.</p>}
                      </fieldset>
                    </div>
                    <div className="mt-7 flex flex-wrap gap-2 border-t border-border pt-5">
                      <Button disabled={acceptButtonDisabled(question.review_status)} onClick={() => acceptQuestion(question.id)} type="button">{acceptButtonLabel(question.review_status)}</Button>
                      <Button onClick={() => editQuestion(question.id)} type="button" variant="outline">Edit manually</Button>
                      <Button disabled={generationAction !== null} onClick={() => regenerateQuestion(question.id)} type="button" variant="outline">
                        {generationAction === `regenerate:${question.id}` ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                        {generationAction === `regenerate:${question.id}` ? "Regenerating" : "Regenerate"}
                      </Button>
                      <Button onClick={() => dismissQuestion(question.id)} type="button" variant="destructive">Dismiss</Button>
                    </div>
                  </div>
                );
              })() : (
                <div className="flex min-h-96 items-center justify-center text-center">
                  <div><p className="text-sm font-medium">No question selected</p><p className="mt-1 text-sm text-muted-foreground">Generate a question after reviewed concepts and clips are available.</p></div>
                </div>
              )}
              inspector={(
                <>
                  <InspectorSection title="Generate by topic">
                    <div className="space-y-3">
                      {topics.filter((topic) => topic.review_status === "accepted" || topic.review_status === "edited").map((topic) => {
                        const concepts = graph?.concepts ?? [];
                        const blockReason = assessmentGenerationBlockReason(topic, concepts, clips);
                        const accessBlockReason = learnerAccessBlockedReason(topic.id, questions);
                        return (
                          <div className="border-b border-border pb-3 last:border-0" key={topic.id}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-sm font-medium">{topic.title}</p>
                              <Badge variant={accessBlockReason ? "outline" : "secondary"}>{accessBlockReason ? "blocked" : "ready"}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{reviewedConceptCountForAssessment(topic.id, concepts)} concepts · {usableClipCountForAssessment(topic.id, clips)} clips</p>
                            {blockReason ? <p className="mt-1 text-xs leading-5 text-amber-700">{blockReason}</p> : null}
                            <Button className="mt-2" disabled={blockReason !== null || generationAction !== null || bulkAction !== null} onClick={() => generateQuestionForTopic(topic.id)} size="sm" type="button" variant="outline">
                              {generationAction === `question:${topic.id}` ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                              {generationAction === `question:${topic.id}` ? "Generating question" : "Generate question"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </InspectorSection>
                  {selectedQuestionReview ? (
                    <>
                      <InspectorSection title="Learner gate">
                        <p className="text-sm leading-6">{learnerAccessBlockedReason(selectedQuestionReview.topic_id, questions) ?? "Topic is ready for learner access."}</p>
                      </InspectorSection>
                      <InspectorSection title="Traceability"><TraceabilityBlock artifact={selectedQuestionReview} /></InspectorSection>
                    </>
                  ) : null}
                </>
              )}
            />
          </ReviewWorkspace>
        </div>
      ) : null}

      {job?.course_id && graph ? (
        <div id="routing">
          <ReviewWorkspace
            description="Tune mastery and remediation thresholds for each reviewed concept."
            eyebrow="Adaptive learning"
            title="Routing policy"
            toolbar={<><Button onClick={() => loadRoutingPolicies(job.course_id!)} type="button" variant="outline"><RefreshCw data-icon="inline-start" /> Refresh</Button><Button disabled={!routingConcepts.length} onClick={() => void applyAllRoutingPolicies()} type="button" variant="outline">Apply all policies</Button></>}
          >
            <ReviewWorkspaceGrid
              queue={(
                <>
                  <ReviewQueueHeader reviewed={routingPolicies.length} total={routingConcepts.length} />
                  <nav aria-label="Routing concepts">
                    {routingConcepts.map((concept) => {
                      const saved = routingPolicies.some((policy) => policy.concept_id === concept.id);
                      return <ReviewQueueItem active={concept.id === selectedRoutingConcept?.id} detail={saved ? "custom policy" : "default policy"} key={concept.id} label={concept.name} onClick={() => setSelectedRoutingConceptId(concept.id)} status={concept.review_status} />;
                    })}
                  </nav>
                </>
              )}
              editor={selectedRoutingConcept ? (() => {
                const concept = selectedRoutingConcept;
                const draft = policyDrafts[concept.id] ?? defaultRoutingPolicyDraft();
                const saved = routingPolicies.find((policy) => policy.concept_id === concept.id) ?? null;
                return (
                  <div className="mx-auto max-w-2xl">
                    <div className="flex items-start justify-between gap-4">
                      <div><p className="text-xs font-medium text-muted-foreground">Concept policy</p><h3 className="mt-1 text-lg font-semibold">{concept.name}</h3></div>
                      <Badge variant={saved ? "secondary" : "outline"}>{saved ? "custom" : "default"}</Badge>
                    </div>
                    <p className="mt-4 border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm leading-6">{policyLabel(draft)}</p>
                    <div className="mt-6 grid grid-cols-2 gap-5">
                      <label className="grid gap-2 text-sm font-medium">Confidence threshold<Input max="4" min="1" step="1" type="number" value={draft.confidence_threshold} onChange={(event) => setPolicyDrafts((current) => ({ ...current, [concept.id]: { ...draft, confidence_threshold: Number(event.target.value) } }))} /></label>
                      <label className="grid gap-2 text-sm font-medium">Correct attempts for mastery<Input min="1" step="1" type="number" value={draft.correct_attempts_for_mastery} onChange={(event) => setPolicyDrafts((current) => ({ ...current, [concept.id]: { ...draft, correct_attempts_for_mastery: Number(event.target.value) } }))} /></label>
                      <label className="grid gap-2 text-sm font-medium">Max remediation attempts<Input min="0" step="1" type="number" value={draft.max_remediation_attempts} onChange={(event) => setPolicyDrafts((current) => ({ ...current, [concept.id]: { ...draft, max_remediation_attempts: Number(event.target.value) } }))} /></label>
                      <label className="grid gap-2 text-sm font-medium">Advancement mode
                        <select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" data-slot="advancement-mode" value={draft.advancement_mode} onChange={(event) => setPolicyDrafts((current) => ({ ...current, [concept.id]: { ...draft, advancement_mode: event.target.value as RoutingPolicyDraft["advancement_mode"] } }))}>
                          <option value="require_mastery">Require mastery</option><option value="allow_partial_understanding">Allow partial understanding</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-7 border-t border-border pt-5"><Button onClick={() => saveRoutingPolicy(concept.id)} type="button">Save policy</Button></div>
                  </div>
                );
              })() : <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">Review concepts before configuring routing.</div>}
              inspector={(
                <>
                  <InspectorSection title="Policy effect"><p className="text-sm leading-6">Confidence and correctness determine whether the learner advances, reinforces this concept, or receives targeted remediation.</p></InspectorSection>
                  <InspectorSection title="Safeguard"><p className="text-sm leading-6">When remediation attempts reach the configured limit, routing flags the instructor instead of repeating the same loop.</p></InspectorSection>
                  <InspectorSection title="Coverage"><p className="text-sm"><strong>{routingPolicies.length}</strong> custom policies across <strong>{routingConcepts.length}</strong> reviewed concepts.</p></InspectorSection>
                </>
              )}
            />
          </ReviewWorkspace>
        </div>
      ) : null}

      {questions.some((question) => question.review_status === "accepted" || question.review_status === "edited") ? (
        <section className="instructorOnly border-b border-border bg-background" id="routing-simulator">
          <header className="flex items-center justify-between gap-6 border-b border-border px-6 py-5 xl:px-8">
            <div><p className="text-xs font-semibold uppercase text-muted-foreground">Policy validation</p><h2 className="mt-1 text-xl font-semibold">Learner routing simulator</h2><p className="mt-1 text-sm text-muted-foreground">Test deterministic outcomes before publishing.</p></div>
            <Button onClick={createDemoLearner} type="button">
              {demoLearnerId ? "Create new learner" : "Create demo learner"}
            </Button>
          </header>
          <div className="grid grid-cols-[240px_minmax(0,1fr)_300px]">
            <aside className="border-r border-border bg-muted/20">
              <div className="border-b border-border px-4 py-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Test questions</p></div>
              {simulatorQuestions.map((question) => <button className={`w-full border-b border-border px-4 py-3 text-left text-sm hover:bg-muted ${question.id === selectedSimulatorQuestion?.id ? "bg-background shadow-[inset_3px_0_0_var(--primary)]" : ""}`} data-slot="simulator-question" key={question.id} onClick={() => setSelectedSimulatorQuestionId(question.id)} type="button"><span className="block truncate font-medium">{topics.find((topic) => topic.id === question.topic_id)?.title ?? "Untitled topic"}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{question.type.replaceAll("_", " ")}</span></button>)}
            </aside>
            <div className="min-w-0 px-8 py-7">
              {selectedSimulatorQuestion ? (() => {
                const question = selectedSimulatorQuestion;
                const firstPattern = question.remediation_rules[0]?.wrong_answer_pattern ?? "incorrect";
                return <div className="mx-auto max-w-2xl"><Badge variant="outline">{question.type.replaceAll("_", " ")}</Badge><h3 className="mt-4 text-lg font-semibold leading-7">{question.body}</h3><div className="mt-6 flex flex-wrap gap-2"><Button disabled={!demoLearnerId} onClick={() => submitLearnerAttempt(question.id, true, 4)} type="button">Correct + confident</Button><Button disabled={!demoLearnerId} onClick={() => submitLearnerAttempt(question.id, true, 2)} type="button" variant="outline">Correct + unsure</Button><Button disabled={!demoLearnerId} onClick={() => submitLearnerAttempt(question.id, false, 1, firstPattern)} type="button" variant="destructive">Incorrect</Button></div></div>;
              })() : null}
              {routingError ? <p className="mt-5 text-sm text-destructive" role="alert">{routingError}</p> : null}
            </div>
            <aside className="border-l border-border bg-muted/20 px-5 py-6">
              <InspectorSection title="Simulator identity"><p className="break-all text-xs leading-5 text-muted-foreground">{demoLearnerId ? `Demo learner: ${demoLearnerId}` : "Create a demo learner to enable outcomes."}</p></InspectorSection>
              <InspectorSection title="Latest decision">
                {routeDecision ? <div role="status"><Badge className="capitalize" variant="secondary">{routeDecision.action.replaceAll("_", " ")}</Badge><p className="mt-3 text-sm leading-6">{routeDecision.why}</p><dl className="mt-3 space-y-2 text-xs text-muted-foreground"><div><dt className="font-medium text-foreground">Mastery state</dt><dd>{routeDecision.mastery_state}</dd></div>{routeDecision.target_concept_id ? <div><dt className="font-medium text-foreground">Target concept</dt><dd className="break-all">{routeDecision.target_concept_id}</dd></div> : null}{routeDecision.target_clip_id ? <div><dt className="font-medium text-foreground">Target clip</dt><dd className="break-all">{routeDecision.target_clip_id}</dd></div> : null}{routeDecision.dashboard_signal_id ? <div><dt className="font-medium text-foreground">Instructor signal</dt><dd className="break-all">{routeDecision.dashboard_signal_id}</dd></div> : null}</dl></div> : <p className="text-sm text-muted-foreground">No outcome recorded yet.</p>}
              </InspectorSection>
            </aside>
          </div>
        </section>
      ) : null}

      {learnerQuestions.length > 0 ? (
        <section
          className="learnerOnly border-b border-border bg-background"
          id="learner-preview"
          aria-labelledby="learner-experience-title"
        >
          <header className="flex min-h-24 items-center justify-between gap-6 border-b border-border px-6 py-5 xl:px-8">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Current lesson</p>
              <h2 className="mt-1 font-serif text-2xl font-semibold" id="learner-experience-title">Learner Experience</h2>
              <p className="mt-1 text-sm text-muted-foreground">{activeLearnerTopic?.title ?? "Choose a topic to begin"}</p>
            </div>
            <Button
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
            </Button>
          </header>

          <div className="grid grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 px-6 py-7 xl:px-8">
              <section aria-labelledby="learner-player-title" className="mx-auto max-w-4xl">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div><p className="text-xs font-medium uppercase text-muted-foreground">Now learning</p><h3 className="mt-1 text-xl font-semibold" id="learner-player-title">{activeLearnerTopic?.title ?? "Choose a topic"}</h3></div>
                  {activeLearnerClip ? <p className="text-xs tabular-nums text-muted-foreground">{formatTime(activeLearnerClip.start_seconds)}–{formatTime(activeLearnerClip.end_seconds)}</p> : null}
                </div>
                {activeLearnerClip && job?.video_id && playback ? (
                  <ProviderVideo
                    endSeconds={activeLearnerClip.end_seconds}
                    pipelineBaseUrl={pipelineBaseUrl}
                    playback={playback}
                    startSeconds={activeLearnerClip.start_seconds}
                    title={`Current learning clip for ${activeLearnerTopic?.title ?? "this topic"}`}
                    videoId={job.video_id}
                    viewerId={isLearnerContext ? selectedIdentity?.id : demoLearnerId}
                    onClipComplete={(watchedSeconds) => void recordWatchEvent(activeLearnerClip, watchedSeconds)}
                  />
                ) : <div className="flex aspect-video items-center justify-center bg-black text-sm text-white/70">No active learner clip is available for this topic.</div>}

              {routeDecision ? (
                <div
                  aria-live="polite"
                  className={`mt-4 border-l-2 px-4 py-3 text-sm ${routeTone(routeDecision.action) === "advance" ? "border-emerald-600 bg-emerald-50 text-emerald-950" : routeTone(routeDecision.action) === "support" ? "border-amber-500 bg-amber-50 text-amber-950" : "border-destructive bg-destructive/5"}`}
                  role="status"
                >
                  <strong className="font-semibold">Why this is next</strong>
                  <p className="mt-1 leading-6">{routeDecision.why}</p>
                  {routeDecision.action === "flag_instructor" ? (
                    <p className="mt-1 leading-6">You are not being sent through the same loop again. The instructor has been flagged to review this concept.</p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm"><strong>Why this is next</strong><p className="mt-1 text-muted-foreground">Start the course, watch the current clip, then answer the check-in.</p></div>
              )}

              {activeLearnerQuestion ? (
                <form
                  className="mt-7 border-t border-border pt-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void gradeAndSubmitLearnerAnswer(activeLearnerQuestion);
                  }}
                >
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Comprehension check</p>
                  <h3 className="mt-2 font-serif text-xl font-semibold leading-8">{activeLearnerQuestion.body}</h3>
                  <fieldset className="mt-5 border-0 p-0" data-slot="learner-answer">
                    <legend className="text-sm font-medium">Your answer</legend>
                    {questionChoices(activeLearnerQuestion).length ? (
                      <div className="mt-3 grid gap-2">
                        {questionChoices(activeLearnerQuestion).map((choice) => (
                          <label className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${learnerAnswer === choice ? "border-primary bg-primary/5" : "border-border hover:border-foreground/25 hover:bg-muted/40"}`} key={choice}>
                            <input checked={learnerAnswer === choice} className="mt-1 size-4 shrink-0 accent-primary" data-slot="learner-answer-option" disabled={!learnerCanAttempt || isGradingAnswer} name="learner-answer" onChange={() => setLearnerAnswer(choice)} type="radio" value={choice} />
                            <span className="min-w-0 flex-1 leading-6">{choice}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Textarea className="mt-3 min-h-24" disabled={!learnerCanAttempt || isGradingAnswer} onChange={(event) => setLearnerAnswer(event.target.value)} placeholder="Write your answer" value={learnerAnswer} />
                    )}
                  </fieldset>
                  <fieldset className="mt-5 border-0 p-0" data-slot="learner-confidence">
                    <legend className="text-sm text-muted-foreground">{activeLearnerQuestion.confidence_prompt}</legend>
                    {isLearnerContext && !isEnrolled ? <p className="mt-2 text-sm text-amber-700">Enroll and start the published course to submit an answer.</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Answer confidence">
                      <Button disabled={!learnerCanAttempt || isGradingAnswer} onClick={() => setLearnerConfidence(4)} type="button" variant={learnerConfidence === 4 ? "default" : "outline"}>Confident</Button>
                      <Button disabled={!learnerCanAttempt || isGradingAnswer} onClick={() => setLearnerConfidence(2)} type="button" variant={learnerConfidence === 2 ? "default" : "outline"}>Unsure</Button>
                    </div>
                  </fieldset>
                  <Button className="mt-5" disabled={!learnerCanAttempt || !learnerAnswer.trim() || learnerConfidence === null || isGradingAnswer} type="submit">
                    {isGradingAnswer ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                    {isGradingAnswer ? "Checking answer" : "Submit answer"}
                  </Button>
                  {gradingFeedback ? <p aria-live="polite" className="mt-3 text-sm font-medium" role="status">{gradingFeedback}</p> : null}
                </form>
              ) : null}
              </section>
            </div>

            <aside aria-labelledby="learner-topics" className="border-l border-border bg-muted/20">
              <div className="border-b border-border px-5 py-5"><p className="text-xs font-semibold uppercase text-muted-foreground">Course outline</p><h3 className="mt-1 text-base font-semibold" id="learner-topics">Topics</h3></div>
              <div role="list" aria-labelledby="learner-topics">
                {topics.filter((topic) => topic.review_status === "accepted" || topic.review_status === "edited").map((topic, index) => (
                  <button
                    aria-current={topic.id === activeLearnerTopic?.id ? "true" : undefined}
                    className={`flex w-full items-start gap-3 border-b border-border px-5 py-4 text-left hover:bg-muted ${topic.id === activeLearnerTopic?.id ? "bg-background shadow-[inset_3px_0_0_var(--primary)]" : ""}`}
                    data-slot="learner-topic"
                    key={topic.id}
                    type="button"
                    onClick={() => setActiveLearnerTopicId(topic.id)}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0"><span className="block text-sm font-medium leading-5">{topic.title}</span><span className="mt-1 block text-xs text-muted-foreground">{formatTime(topic.start_seconds)}–{formatTime(topic.end_seconds)}</span></span>
                  </button>
                ))}
              </div>
            </aside>
          </div>

          <section className="border-t border-border bg-muted/10 px-6 py-8 xl:px-8" id="mastery-map" aria-labelledby="mastery-map-title">
            <div className="mx-auto max-w-5xl">
              <div className="flex items-end justify-between gap-6"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Course path</p><h3 className="mt-1 font-serif text-2xl font-semibold" id="mastery-map-title">Mastery Map</h3></div><p className="text-sm text-muted-foreground">{masterySummary(learnerProgress)}</p></div>
              {masteryFlowNodes.length ? (
                <div className="mt-7 h-[440px] overflow-hidden rounded-lg border border-border bg-background" aria-label="Concept mastery prerequisite flowchart">
                  <ReactFlow
                    edges={masteryFlowEdges}
                    elementsSelectable
                    fitView
                    nodes={masteryFlowNodes}
                    nodesConnectable={false}
                    nodesDraggable={false}
                    onNodeClick={(_, node) => {
                      const topicId = masteryByConcept.get(node.id)?.topic_id;
                      if (topicId) setActiveLearnerTopicId(topicId);
                    }}
                    panOnDrag
                    zoomOnScroll={false}
                  >
                    <Background gap={24} size={1} />
                  </ReactFlow>
                </div>
              ) : (
                <div className="mt-6 border border-dashed border-border px-6 py-10 text-center"><p className="text-sm font-medium">Mastery begins after your first check-in</p><p className="mt-1 text-sm text-muted-foreground">Concept progress and routing status will appear here.</p></div>
              )}
            </div>
          </section>
        </section>
      ) : null}

      {job?.course_id ? (
        <section className="instructorOnly border-b border-border bg-background" id="insights">
          <header className="flex min-h-24 items-center justify-between gap-6 border-b border-border px-6 py-5 xl:px-8">
            <div><p className="text-xs font-semibold uppercase text-muted-foreground">Learning operations</p><h2 className="mt-1 text-xl font-semibold">Instructor dashboard</h2><p className="mt-1 text-sm text-muted-foreground">Review evidence-backed signals and correct the underlying learning system.</p></div>
            <Button onClick={() => loadDashboard(job.course_id!)} type="button"><RefreshCw data-icon="inline-start" /> Refresh signals</Button>
          </header>

          {dashboardSummary ? (
            <>
              <div className="grid grid-cols-3 border-b border-border bg-muted/15">
                <div className="border-r border-border px-6 py-4"><p className="text-xs font-medium uppercase text-muted-foreground">Learners</p><p className="mt-1 text-2xl font-semibold tabular-nums">{dashboardSummary.learner_count}</p></div>
                <div className="border-r border-border px-6 py-4"><p className="text-xs font-medium uppercase text-muted-foreground">Attempts</p><p className="mt-1 text-2xl font-semibold tabular-nums">{dashboardSummary.attempt_count}</p></div>
                <div className="px-6 py-4"><p className="text-xs font-medium uppercase text-muted-foreground">Open signals</p><p className="mt-1 text-2xl font-semibold tabular-nums">{dashboardSummary.signals.length}</p></div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_260px] border-b border-border">
                <section className="border-r border-border px-6 py-5" aria-labelledby="signal-mix-title">
                  <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-muted-foreground" id="signal-mix-title">Open signal mix</p><p className="mt-1 text-sm text-muted-foreground">Current intervention pressure by diagnosis type</p></div><span className="text-xs text-muted-foreground">{dashboardSummary.signals.length} total</span></div>
                  <div className="mt-4 grid grid-cols-3 gap-4">
                    {signalChartData.map(([label, count], index) => (
                      <div key={label}>
                        <div className="flex items-center justify-between text-xs"><span>{label}</span><strong className="tabular-nums">{count}</strong></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={index === 0 ? "h-full bg-amber-500" : index === 1 ? "h-full bg-emerald-600" : "h-full bg-primary"} style={{ width: `${(count / largestSignalCount) * 100}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="px-6 py-5" aria-labelledby="attempt-density-title">
                  <p className="text-xs font-semibold uppercase text-muted-foreground" id="attempt-density-title">Attempt density</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{dashboardSummary.learner_count ? (dashboardSummary.attempt_count / dashboardSummary.learner_count).toFixed(1) : "0.0"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Attempts per learner</p>
                </section>
              </div>
              {dashboardColdStartMessage(dashboardSummary) ? <div className="border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900" role="status"><strong>Not enough data yet.</strong> {dashboardColdStartMessage(dashboardSummary)}</div> : null}

              <div className="grid min-h-[560px] grid-cols-[240px_minmax(0,1fr)_minmax(280px,320px)] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
                <aside className="min-w-0 border-r border-border bg-muted/20" aria-label="Dashboard signal queue">
                  <div className="border-b border-border px-4 py-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase text-muted-foreground">Signal queue</p><Badge variant="outline">{dashboardSummary.signals.length}</Badge></div></div>
                  {dashboardSummary.signals.length ? dashboardSummary.signals.map((signal) => (
                    <button className={`w-full border-b border-border px-4 py-3 text-left hover:bg-muted ${signal.id === selectedDashboardSignal?.id ? "bg-background shadow-[inset_3px_0_0_var(--primary)]" : ""}`} data-slot="dashboard-signal" key={signal.id} onClick={() => setSelectedDashboardSignalId(signal.id)} type="button">
                      <span className="block text-sm font-medium">{dashboardSignalTitle(signal)}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{signal.type.replaceAll("_", " ")}</span>
                    </button>
                  )) : <p className="px-4 py-6 text-sm text-muted-foreground">No open dashboard problems. Refresh after more learner activity.</p>}
                </aside>

                <div className="min-w-0 px-8 py-7">
                  {selectedDashboardSignal ? (() => {
                    const signal = selectedDashboardSignal;
                    const retroactive = Boolean(dashboardRetroactive[signal.id]);
                    return (
                      <div className="mx-auto max-w-2xl">
                        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase text-muted-foreground">{signal.type.replaceAll("_", " ")}</p><h3 className="mt-2 text-xl font-semibold">{dashboardSignalTitle(signal)}</h3></div><Badge className="capitalize" variant="outline">{signal.status}</Badge></div>
                        <p className="mt-5 text-sm leading-7">{dashboardSignalSummary(signal)}</p>
                        <div className="mt-5 border-l-2 border-primary bg-primary/5 px-4 py-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Recommended action</p><p className="mt-1 text-sm leading-6">{dashboardSignalRecommendedAction(signal)}</p></div>
                        <label className="mt-5 grid gap-2 text-sm font-medium">Instructor note<Textarea className="min-h-28" onChange={(event) => setDashboardNotes((current) => ({ ...current, [signal.id]: event.target.value }))} placeholder="Optional edit, rationale, or implementation note" value={dashboardNotes[signal.id] ?? ""} /></label>
                        <label className="mt-4 flex items-start gap-2 text-sm"><input checked={retroactive} className="mt-1 size-4 accent-primary" data-slot="dashboard-retroactive" onChange={(event) => setDashboardRetroactive((current) => ({ ...current, [signal.id]: event.target.checked }))} type="checkbox" /><span>{dashboardActionScopeLabel(retroactive)}</span></label>
                        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5"><Button onClick={() => resolveDashboardSignal(signal.id, "accept")} type="button">Accept AI suggestion</Button><Button onClick={() => resolveDashboardSignal(signal.id, "edit")} type="button" variant="outline">Edit manually</Button><Button onClick={() => resolveDashboardSignal(signal.id, "dismiss")} type="button" variant="destructive">Dismiss</Button></div>
                      </div>
                    );
                  })() : <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">No open signal selected.</div>}
                </div>

                <aside className="min-w-0 border-l border-border bg-muted/20 px-5 py-6">
                  {selectedDashboardSignal ? <><InspectorSection title="Related entity"><p className="break-all text-sm">{selectedDashboardSignal.related_entity_type}: {selectedDashboardSignal.related_entity_id}</p></InspectorSection><InspectorSection title="Traceability"><TraceabilityBlock artifact={{ status: selectedDashboardSignal.status, ai_proposal: { rationale: dashboardSignalSummary(selectedDashboardSignal) }, instructor_revision: selectedDashboardSignal.instructor_action }} /></InspectorSection></> : null}
                  {graph ? (
                    <InspectorSection title="Manual learner override">
                      <form className="grid gap-3" onSubmit={submitLearnerOverride}>
                        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Learner id<Input className="min-w-0" onChange={(event) => setOverrideLearnerId(event.target.value)} placeholder="Paste learner UUID" value={overrideLearnerId} /></label>
                        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Concept<select className="h-9 min-w-0 w-full rounded-lg border border-input bg-background px-2 text-sm" data-slot="override-concept" onChange={(event) => setOverrideConceptId(event.target.value)} value={overrideConceptId}>{graph.concepts.filter((concept) => concept.review_status === "accepted" || concept.review_status === "edited").map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></label>
                        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Override action<select className="h-9 min-w-0 w-full rounded-lg border border-input bg-background px-2 text-sm" data-slot="override-action" onChange={(event) => setOverrideAction(event.target.value as "skip_ahead" | "send_back")} value={overrideAction}><option value="send_back">Send back for remediation</option><option value="skip_ahead">Skip ahead / mark mastered</option></select></label>
                        <Button className="mt-1 w-full" size="sm" type="submit">Apply learner override</Button>
                      </form>
                    </InspectorSection>
                  ) : null}
                </aside>
              </div>
            </>
          ) : <div className="px-8 py-16 text-center"><p className="text-sm font-medium">Insights have not been refreshed</p><p className="mt-1 text-sm text-muted-foreground">Refresh signals to compute problems from current learner data.</p></div>}
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

type QuestionDraft = AssessmentEditorDraft;

function topicToDraft(topic: Topic): TopicDraft {
  return {
    title: topic.title,
    summary: topic.summary ?? "",
    start_seconds: topic.start_seconds,
    end_seconds: topic.end_seconds,
  };
}

function questionToDraft(question: Question): QuestionDraft {
  return questionToAssessmentDraft(question);
}

function questionChoices(question: Question): string[] {
  const choices = question.correct_answer.choices;
  return Array.isArray(choices)
    ? choices.filter((choice): choice is string => typeof choice === "string" && choice.trim().length > 0)
    : [];
}

function policyToDraft(policy: RoutingPolicy): RoutingPolicyDraft {
  return {
    confidence_threshold: policy.confidence_threshold,
    correct_attempts_for_mastery: policy.correct_attempts_for_mastery,
    advancement_mode: policy.advancement_mode,
    max_remediation_attempts: policy.max_remediation_attempts,
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
