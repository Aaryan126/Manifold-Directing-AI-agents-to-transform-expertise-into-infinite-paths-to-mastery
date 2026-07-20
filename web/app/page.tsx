"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  type Concept,
  type ConceptEdge,
  focusedConceptIds,
  graphEdgeModels,
  graphNodeModels,
} from "./graphModel";
import {
  topicsReadyForAutomaticAssessmentGeneration,
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
  topicsReadyForAutomaticClipGeneration,
} from "./clipReview";
import {
  clipDisplayTitle,
  clipDurationLabel,
  sourceRangeLabel,
  topicClipDurationLabel,
} from "./clipPresentation";
import { ProviderVideo, type PlaybackInfo } from "./ProviderVideo";
import {
  dashboardActionScopeLabel,
  dashboardColdStartMessage,
  dashboardSignalRecommendedAction,
  dashboardSignalSummary,
  dashboardSignalTitle,
} from "./dashboardReview";
import {
  percentage,
  rankedClipPerformance,
  rankedConceptPerformance,
  rankedQuestionPerformance,
  type ClipPerformance,
  type ConceptPerformance,
  type QuestionPerformance,
} from "./dashboardPerformance";
import {
  buildWorkflow,
  topicProductionLabel,
  type CreationStageId,
  type InstructorStageId,
  type TopicReadiness,
  type WorkflowTask,
} from "./instructorWorkflow";
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
import { graphGenerationBlockedReason, reviewedTopicCount } from "./topicReview";
import { formatTimecode, parseTimecode } from "./timecode";
import {
  aiRationale,
  instructorTrace,
  traceabilityStatus,
  type TraceableArtifact,
} from "./traceability";
import { CourseFoundryShell } from "@/components/coursefoundry-shell";
import { CourseSetupWorkspace } from "@/components/course-setup-workspace";
import {
  InstructorProductionStudio,
  InstructorPublishReview,
} from "@/components/instructor-production-studio";
import {
  InspectorSection,
  ReviewQueueHeader,
  ReviewQueueItem,
  ReviewWorkspace,
  ReviewWorkspaceGrid,
  WorkspaceHeader,
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
  playback_provider: string | null;
  playback_id: string | null;
  materialization_status: "source_reference" | "processing" | "ready" | "failed";
  materialization_error: string | null;
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
  concept_performance: ConceptPerformance[];
  question_performance: QuestionPerformance[];
  clip_performance: ClipPerformance[];
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
  const [workflowHydratedJobId, setWorkflowHydratedJobId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicReviewId, setSelectedTopicReviewId] = useState("");
  const [selectedClipReviewId, setSelectedClipReviewId] = useState("");
  const [selectedQuestionReviewId, setSelectedQuestionReviewId] = useState("");
  const [selectedGraphConceptId, setSelectedGraphConceptId] = useState("");
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState("");
  const [graphReviewFilter, setGraphReviewFilter] = useState<"active" | "all" | "proposed" | "reviewed" | "dismissed">("active");
  const [graphTopicFocus, setGraphTopicFocus] = useState("all");
  const [graphNodePositions, setGraphNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [showGraphConceptForm, setShowGraphConceptForm] = useState(false);
  const [newGraphConcept, setNewGraphConcept] = useState({ name: "", description: "", topic_id: "" });
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
  const [topicConceptSelections, setTopicConceptSelections] = useState<Record<string, string>>({});
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [topicDrafts, setTopicDrafts] = useState<Record<string, TopicDraft>>({});
  const [manualTopic, setManualTopic] = useState<TopicDraft>({
    title: "",
    summary: "",
    start_seconds: 0,
    end_seconds: 600,
  });
  const [showManualTopicForm, setShowManualTopicForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [bulkAction, setBulkAction] = useState<"accept-questions" | null>(null);
  const [generationAction, setGenerationAction] = useState<string | null>(null);
  const [preparationFailures, setPreparationFailures] = useState<Record<string, string>>({});
  const [isAcceptingGraph, setIsAcceptingGraph] = useState(false);
  const [learnerAnswer, setLearnerAnswer] = useState("");
  const [learnerConfidence, setLearnerConfidence] = useState<number | null>(null);
  const [isGradingAnswer, setIsGradingAnswer] = useState(false);
  const [gradingFeedback, setGradingFeedback] = useState<string | null>(null);
  const [activeInstructorStage, setActiveInstructorStage] = useState<InstructorStageId>("source");
  const hydratedJobs = useRef(new Set<string>());
  const workflowAutoFocusedJob = useRef<string | null>(null);
  const graphFlowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const refreshJobRef = useRef<() => Promise<void>>(async () => undefined);
  const hydrateCompletedJobRef = useRef<(nextJob: Job) => Promise<void>>(async () => undefined);
  const automaticPreparationRef = useRef<() => void>(() => undefined);
  const automaticPreparationJob = useRef<string | null>(null);
  const automaticClipAttempts = useRef(new Map<string, string>());
  const automaticQuestionAttempts = useRef(new Set<string>());
  const selectedIdentity =
    identities.find((identity) => identity.id === selectedIdentityId) ?? null;
  const isLearnerContext = selectedIdentity?.role === "learner";
  const graphBlockReason = graphGenerationBlockedReason(topics);
  const reviewedTopics = reviewedTopicCount(topics);
  const topicsWithoutReviewedConcepts = topics.filter(
    (topic) =>
      (topic.review_status === "accepted" || topic.review_status === "edited") &&
      reviewedConceptCountForTopic(topic.id, graph?.concepts ?? []) === 0,
  );
  const graphStatusMatches = (status: Concept["review_status"]) =>
    graphReviewFilter === "all" ||
    (graphReviewFilter === "active" && status !== "dismissed") ||
    status === graphReviewFilter ||
    (graphReviewFilter === "reviewed" && (status === "accepted" || status === "edited"));
  const statusMatchingGraphConcepts =
    graph?.concepts.filter((concept) => graphStatusMatches(concept.review_status)) ?? [];
  const statusMatchingGraphEdges =
    graph?.edges.filter((edge) => graphStatusMatches(edge.review_status)) ?? [];
  const visibleGraphConceptIds = focusedConceptIds(
    statusMatchingGraphConcepts,
    statusMatchingGraphEdges,
    graphTopicFocus,
  );
  const visibleGraphConcepts = statusMatchingGraphConcepts.filter((concept) =>
    visibleGraphConceptIds.has(concept.id),
  );
  const visibleGraphEdges = statusMatchingGraphEdges.filter((edge) =>
    visibleGraphConceptIds.has(edge.from_concept_id) &&
    visibleGraphConceptIds.has(edge.to_concept_id),
  );
  const visibleGraphNodeModels = graph ? graphNodeModels(visibleGraphConcepts, topics) : [];
  const graphNodeModelById = new Map(visibleGraphNodeModels.map((node) => [node.id, node]));
  const flowNodes: FlowNode[] = graph
    ? visibleGraphNodeModels.map((node) => {
      const colors = graphTopicColors(node.topicColorIndex);
      return {
      id: node.id,
      position: graphNodePositions[node.id] ?? { x: node.x, y: node.y },
      data: {
        label: (
          <div className="grid gap-1 text-left">
            <span className="truncate text-[10px] font-semibold uppercase text-muted-foreground">
              {node.topicLabel}
            </span>
            <span className="truncate text-sm font-semibold">{node.label}</span>
            <span className="text-[10px] capitalize text-muted-foreground">{node.status}</span>
          </div>
        ),
      },
      className: node.muted ? "graphNode muted" : "graphNode",
      width: 210,
      height: 88,
      style: {
        width: 210,
        minHeight: 88,
        background: node.muted ? "var(--muted)" : colors.background,
        borderColor: node.muted ? "var(--border)" : colors.border,
        borderWidth: 2,
        borderRadius: 6,
        padding: 12,
      },
    };
    })
    : [];
  const flowEdges: FlowEdge[] = graph
    ? graphEdgeModels(visibleGraphEdges).map((edge) => {
      const sourceNode = graphNodeModelById.get(edge.source);
      const colors = graphTopicColors(sourceNode?.topicColorIndex ?? -1);
      const stroke = edge.muted ? "#9ca3af" : colors.edge;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: edge.status === "proposed",
        className: edge.muted ? "graphEdge muted" : "graphEdge",
        markerEnd: { color: stroke, type: MarkerType.ArrowClosed },
        style: {
          stroke,
          strokeDasharray: edge.status === "proposed" ? "6 5" : undefined,
          strokeWidth: 2,
        },
      };
    })
    : [];
  useEffect(() => {
    if (activeInstructorStage !== "structure" || flowNodes.length === 0) return;
    const timeout = window.setTimeout(() => {
      void graphFlowRef.current?.fitView({ padding: 0.25, maxZoom: 1 });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeInstructorStage, flowNodes.length, graphReviewFilter, graphTopicFocus]);
  useEffect(() => {
    if (!job?.course_id) {
      setGraphNodePositions({});
      return;
    }
    try {
      const saved = window.localStorage.getItem(`manifold:graph-layout:${job.course_id}`);
      setGraphNodePositions(saved ? JSON.parse(saved) as Record<string, { x: number; y: number }> : {});
    } catch {
      setGraphNodePositions({});
    }
  }, [job?.course_id]);
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
  const conceptPerformance = rankedConceptPerformance(
    dashboardSummary?.concept_performance ?? [],
  );
  const questionPerformance = rankedQuestionPerformance(
    dashboardSummary?.question_performance ?? [],
  );
  const clipPerformance = rankedClipPerformance(
    dashboardSummary?.clip_performance ?? [],
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
  const artifactPreparationRevision = [
    ...topics.map((topic) => `topic:${topic.id}:${topic.review_status}:${topic.start_seconds}:${topic.end_seconds}`),
    ...(graph?.concepts.map((concept) =>
      `concept:${concept.id}:${concept.review_status}:${conceptTopicIds(concept).sort().join(",")}`,
    ) ?? []),
    ...clips.map((clip) => `clip:${clip.id}:${clip.topic_id}:${clip.status}:${clip.materialization_status}`),
    ...questions.map((question) => `question:${question.id}:${question.topic_id}:${question.review_status}`),
  ].sort().join("|");

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
        setWorkflowHydratedJobId(nextJob.id);
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
    if (topic) {
      upsertTopic(topic);
      if (job?.video_id) await loadClips(job.video_id);
    }
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
      if (job?.video_id) await loadClips(job.video_id);
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
    if (topic && job?.video_id) {
      await Promise.all([loadTopics(job.video_id), loadClips(job.video_id)]);
    }
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
    if (job?.video_id) {
      await Promise.all([loadTopics(job.video_id), loadClips(job.video_id)]);
    }
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
      setShowManualTopicForm(false);
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
    return concept;
  }

  async function addGraphConcept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job?.course_id || !newGraphConcept.name.trim()) return;
    const topicId = newGraphConcept.topic_id || topics[0]?.id;
    if (!topicId) return;
    const concept = (await graphRequest(
      `${pipelineBaseUrl}/courses/${job.course_id}/graph/concepts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newGraphConcept.name.trim(),
          description: newGraphConcept.description.trim(),
          topic_ids: [topicId],
        }),
      },
    )) as Concept | null;
    if (!concept) return;
    upsertConcept(concept);
    setSelectedGraphConceptId(concept.id);
    setSelectedGraphEdgeId("");
    setNewGraphConcept({ name: "", description: "", topic_id: topicId });
    setShowGraphConceptForm(false);
    setMessage("Concept added to the graph.");
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
      if (job?.video_id) await loadClips(job.video_id);
      setMessage("Concept links updated. Affected clips must be regenerated before learner use.");
    }
    return concept;
  }

  async function linkConceptToTopic(conceptId: string, topicId: string) {
    const existing = graph?.concepts.find((concept) => concept.id === conceptId);
    if (!existing) return;
    const concept = (await graphRequest(
      `${pipelineBaseUrl}/courses/graph/concepts/${conceptId}/topics`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic_ids: [...new Set([...conceptTopicIds(existing), topicId])],
        }),
      },
    )) as Concept | null;
    if (!concept) return;
    upsertConcept(concept);
    setTopicConceptSelections((current) => ({ ...current, [topicId]: "" }));
    if (job?.video_id) await loadClips(job.video_id);
    setMessage("Concept connected. This topic can now generate learner clips.");
  }

  function openConceptRepairForTopic(topic: Topic) {
    setGraphReviewFilter("active");
    setGraphTopicFocus(topic.id);
    setSelectedGraphConceptId("");
    setSelectedGraphEdgeId("");
    setNewGraphConcept({
      name: "",
      description: topic.summary ?? "",
      topic_id: topic.id,
    });
    setShowGraphConceptForm(true);
    window.setTimeout(() => {
      document.getElementById("concept-graph")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function dismissConcept(conceptId: string) {
    const concept = (await graphRequest(
      `${pipelineBaseUrl}/courses/graph/concepts/${conceptId}/dismiss`,
      { method: "POST" },
    )) as Concept | null;
    if (concept && job?.course_id) {
      await Promise.all([
        loadGraph(job.course_id),
        job.video_id ? loadClips(job.video_id) : Promise.resolve(),
      ]);
    }
  }

  async function mergeConcepts(event: FormEvent<HTMLFormElement>, sourceConceptId: string) {
    event.preventDefault();
    if (!sourceConceptId || !mergeTargetId || !job?.course_id) return;
    const concept = (await graphRequest(`${pipelineBaseUrl}/courses/graph/concepts/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_concept_id: sourceConceptId,
        target_concept_id: mergeTargetId,
      }),
    })) as Concept | null;
    if (concept) {
      await Promise.all([
        loadGraph(job.course_id),
        job.video_id ? loadClips(job.video_id) : Promise.resolve(),
      ]);
    }
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

  async function reconnectGraphEdge(edgeId: string, connection: Connection) {
    if (!connection.source || !connection.target) return;
    const currentEdge = graph?.edges.find((edge) => edge.id === edgeId);
    const edge = (await graphRequest(`${pipelineBaseUrl}/courses/graph/edges/${edgeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_concept_id: connection.source,
        to_concept_id: connection.target,
        rationale: currentEdge ? aiRationale(currentEdge) ?? "Instructor reconnected prerequisite." : "Instructor reconnected prerequisite.",
      }),
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
    setMergeTargetId(nextGraph.concepts[1]?.id ?? "");
    setOverrideConceptId(
      nextGraph.concepts.find(
        (concept) => concept.review_status === "accepted" || concept.review_status === "edited",
      )?.id ?? "",
    );
  }

  function upsertConcept(concept: Concept) {
    setGraph((current) =>
      current
        ? {
            ...current,
            concepts: current.concepts.some((item) => item.id === concept.id)
              ? current.concepts.map((item) => (item.id === concept.id ? concept : item))
              : [...current.concepts, concept],
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

  function handleGraphNodesChange(changes: NodeChange<FlowNode>[]) {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange<FlowNode>, { type: "position" }> =>
        change.type === "position" && Boolean(change.position),
    );
    if (!positionChanges.length) return;
    setGraphNodePositions((current) => {
      const next = { ...current };
      for (const change of positionChanges) {
        if (change.position) next[change.id] = change.position;
      }
      return next;
    });
  }

  function persistGraphLayout(node: FlowNode) {
    if (!job?.course_id) return;
    const next = { ...graphNodePositions, [node.id]: node.position };
    setGraphNodePositions(next);
    window.localStorage.setItem(
      `manifold:graph-layout:${job.course_id}`,
      JSON.stringify(next),
    );
  }

  async function loadClips(videoId: string) {
    const response = await fetch(`${pipelineBaseUrl}/videos/${videoId}/clips`);
    if (!response.ok) {
      setMessage(`Clip refresh failed with ${response.status}.`);
      return;
    }
    setClips((await response.json()) as Clip[]);
  }

  async function generateClipsForTopic(topicId: string, automatic = false): Promise<boolean> {
    if (!automatic) setMessage(null);
    setPreparationFailures((current) => {
      const next = { ...current };
      delete next[`clips:${topicId}`];
      return next;
    });
    setGenerationAction(`clips:${topicId}`);
    try {
      const response = await fetch(`${pipelineBaseUrl}/topics/${topicId}/clips/generate`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = body?.detail ?? `Clip generation failed with ${response.status}.`;
        setPreparationFailures((current) => ({ ...current, [`clips:${topicId}`]: detail }));
        if (!automatic) setMessage(detail);
        return false;
      }
      if (job?.video_id) await loadClips(job.video_id);
      return true;
    } finally {
      setGenerationAction(null);
    }
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

  async function generateQuestionForTopic(topicId: string, automatic = false): Promise<boolean> {
    setPreparationFailures((current) => {
      const next = { ...current };
      delete next[`question:${topicId}`];
      return next;
    });
    setGenerationAction(`question:${topicId}`);
    try {
      const response = await fetch(`${pipelineBaseUrl}/topics/${topicId}/questions/generate`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = body?.detail ?? `Question generation failed with ${response.status}.`;
        setPreparationFailures((current) => ({ ...current, [`question:${topicId}`]: detail }));
        if (!automatic) setMessage(detail);
        return false;
      }
      upsertQuestion((await response.json()) as Question);
      return true;
    } finally {
      setGenerationAction(null);
    }
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
  const selectedTopicClips = selectedTopicReview
    ? clips.filter((clip) => clip.topic_id === selectedTopicReview.id)
    : [];
  const selectedTopicActiveClips = selectedTopicClips.filter(
    (clip) => clip.status !== "superseded",
  );
  const selectedClipReview =
    selectedTopicActiveClips.find((clip) => clip.id === selectedClipReviewId) ??
    selectedTopicActiveClips[0] ??
    null;
  const selectedQuestionReview =
    questions.find((question) => question.id === selectedQuestionReviewId) ?? questions[0] ?? null;
  const missingAssessmentProposalTopicIds = graph
    ? topicsReadyForAutomaticAssessmentGeneration(topics, graph.concepts, clips, questions)
    : [];
  const questionPreparationFailures = Object.entries(preparationFailures).filter(([key]) =>
    key.startsWith("question:"),
  );
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
  const reviewedConcepts = graph?.concepts.filter(
    (concept) => concept.review_status === "accepted" || concept.review_status === "edited",
  ) ?? [];
  const topicReadiness: TopicReadiness[] = topics
    .filter((topic) => topic.review_status !== "dismissed")
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      reviewStatus: topic.review_status,
      reviewedConcepts: reviewedConceptCountForTopic(topic.id, graph?.concepts ?? []),
      clips: clips.filter((clip) => clip.topic_id === topic.id && clip.status !== "superseded").length,
      staleClips: clips.filter((clip) => clip.topic_id === topic.id && clip.status === "superseded").length,
      flaggedClips: clips.filter((clip) => clip.topic_id === topic.id && clip.status === "flagged").length,
      approvedQuestions: questions.filter(
        (question) => question.topic_id === topic.id &&
          (question.review_status === "accepted" || question.review_status === "edited"),
      ).length,
      proposedQuestions: questions.filter(
        (question) => question.topic_id === topic.id && question.review_status === "proposed",
      ).length,
    }));
  const workflow = buildWorkflow({
    sourceStatus: !job
      ? "missing"
      : job.status === "complete"
        ? "complete"
        : job.status === "failed"
          ? "failed"
          : "processing",
    topicCount: topics.length,
    proposedTopics: topics.filter((topic) => topic.review_status === "proposed").length,
    reviewedTopics: topics.filter(
      (topic) => topic.review_status === "accepted" || topic.review_status === "edited",
    ).length,
    conceptCount: graph?.concepts.length ?? 0,
    proposedConcepts: graph?.concepts.filter((concept) => concept.review_status === "proposed").length ?? 0,
    proposedEdges: graph?.edges.filter((edge) => edge.review_status === "proposed").length ?? 0,
    topicsMissingConcepts: topicReadiness.filter(
      (topic) => topic.reviewStatus !== "proposed" && topic.reviewedConcepts === 0,
    ).length,
    topicsMissingClips: topicReadiness.filter(
      (topic) => topic.reviewedConcepts > 0 && topic.clips === 0,
    ).length,
    topicsMissingQuestions: topicReadiness.filter(
      (topic) => topic.reviewedConcepts > 0 && topic.approvedQuestions === 0 && topic.proposedQuestions === 0,
    ).length,
    proposedQuestions: questions.filter((question) => question.review_status === "proposed").length,
    reviewedQuestions: questions.filter(
      (question) => question.review_status === "accepted" || question.review_status === "edited",
    ).length,
    reviewedConcepts: reviewedConcepts.length,
    routingPolicyCount: routingPolicies.filter((policy) => policy.concept_id).length,
    routingTested: routeDecision !== null,
    publishBlockers: publishReadiness?.blockers ?? [],
    publishReady: publishReadiness?.ready ?? false,
    published: course?.status === "published",
  });

  automaticPreparationRef.current = () => {
    if (!job?.id || !job.video_id || !graph || isLearnerContext) return;
    if (automaticPreparationJob.current !== job.id) {
      automaticPreparationJob.current = job.id;
      automaticClipAttempts.current.clear();
      automaticQuestionAttempts.current.clear();
      setPreparationFailures({});
    }
    if (bulkAction !== null || generationAction !== null) return;

    const missingClipTopicIds = topicsReadyForAutomaticClipGeneration(
      topics,
      graph.concepts,
      clips,
    );
    for (const nextClipTopic of topics.filter((topic) => missingClipTopicIds.includes(topic.id))) {
      const linkedConceptIds = graph.concepts
        .filter((concept) =>
          (concept.review_status === "accepted" || concept.review_status === "edited") &&
          conceptTopicIds(concept).includes(nextClipTopic.id),
        )
        .map((concept) => concept.id)
        .sort();
      const attemptKey = [
        nextClipTopic.review_status,
        nextClipTopic.start_seconds,
        nextClipTopic.end_seconds,
        linkedConceptIds.join(","),
      ].join(":");
      if (automaticClipAttempts.current.get(nextClipTopic.id) !== attemptKey) {
        automaticClipAttempts.current.set(nextClipTopic.id, attemptKey);
        void generateClipsForTopic(nextClipTopic.id, true);
        return;
      }
    }

    const nextQuestionTopicId = topicsReadyForAutomaticAssessmentGeneration(
      topics,
      graph.concepts,
      clips,
      questions,
    ).find((topicId) => !automaticQuestionAttempts.current.has(topicId));
    if (nextQuestionTopicId) {
      automaticQuestionAttempts.current.add(nextQuestionTopicId);
      void generateQuestionForTopic(nextQuestionTopicId, true);
    }
  };

  useEffect(() => {
    if (!workflowHydratedJobId || workflowHydratedJobId !== job?.id || isLearnerContext) return;
    automaticPreparationRef.current();
  }, [
    artifactPreparationRevision,
    bulkAction,
    generationAction,
    isLearnerContext,
    job?.id,
    workflowHydratedJobId,
  ]);

  useEffect(() => {
    if (!workflowHydratedJobId || workflowHydratedJobId !== job?.id || isLearnerContext) return;
    if (workflowAutoFocusedJob.current === workflowHydratedJobId) return;
    workflowAutoFocusedJob.current = workflowHydratedJobId;
    setActiveInstructorStage(workflow.recommendedStage);
  }, [workflowHydratedJobId, job?.id, isLearnerContext, workflow.recommendedStage]);

  function instructorWorkspaceVisible(stage: CreationStageId | "insights") {
    return activeInstructorStage === stage;
  }

  function stageForTarget(target: string): CreationStageId {
    if (target === "course-setup") return "source";
    if (target === "outline" || target === "concept-graph" || target === "clips") return "structure";
    if (target === "assessments") return "assessments";
    if (target === "routing" || target === "routing-simulator") return "adapt";
    return "publish";
  }

  function openInstructorWorkspace(stage: CreationStageId, target: string) {
    setActiveInstructorStage(stage);
    window.setTimeout(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function openWorkflowTask(task: WorkflowTask) {
    if (task.id === "review-topics") {
      setSelectedTopicReviewId(topics.find((topic) => topic.review_status === "proposed")?.id ?? "");
    } else if (task.id === "prepare-clips") {
      setSelectedTopicReviewId(topicReadiness.find((topic) => topic.clips === 0)?.id ?? "");
    } else if (task.id === "review-graph") {
      setSelectedGraphConceptId(graph?.concepts.find((concept) => concept.review_status === "proposed")?.id ?? "");
    } else if (task.id === "review-questions") {
      setSelectedQuestionReviewId(questions.find((question) => question.review_status === "proposed")?.id ?? "");
    }
    openInstructorWorkspace(stageForTarget(task.target), task.target);
  }

  return (
    <CourseFoundryShell
      activeInstructorView={activeInstructorStage === "insights" ? "insights" : "build"}
      courseStatus={course?.status}
      courseTitle={course?.title ?? "Course workspace"}
      identities={identities}
      isLearner={isLearnerContext}
      onIdentityChange={(identityId) => void changeIdentity(identityId)}
      onInstructorViewChange={(view) => {
        setActiveInstructorStage(view === "insights" ? "insights" : workflow.recommendedStage);
      }}
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
      {!isLearnerContext && activeInstructorStage !== "insights" ? (
        <InstructorProductionStudio
          activeStage={activeInstructorStage}
          onStageChange={setActiveInstructorStage}
          stages={workflow.stages}
        />
      ) : null}
      {message ? <p className="sr-only" role="status">{message}</p> : null}

      <div className={instructorWorkspaceVisible("source") ? "" : "hidden"}>
        <CourseSetupWorkspace
          deliveryCapacity={deliveryCapacity}
          isSubmitting={isSubmitting}
          job={job}
          onFileChange={setSelectedFile}
          onLoadDemo={() => void loadDemo()}
          onSubmitFile={uploadFile}
          onSubmitUrl={submitUrl}
          onUrlChange={setUrl}
          selectedFileName={selectedFile?.name ?? null}
          url={url}
      />
      </div>

      {transcript && job?.video_id ? (
        <div className={`scroll-mt-20 ${instructorWorkspaceVisible("structure") ? "" : "hidden"}`} id="outline">
          <ReviewWorkspace
            description="Review each topic, confirm its concept coverage, and prepare its learner clips."
            eyebrow="Content review"
            title="Topic production"
            toolbar={(
              <>
                <Button
                  aria-controls="manual-topic-form"
                  aria-expanded={showManualTopicForm}
                  onClick={() => setShowManualTopicForm((current) => !current)}
                  type="button"
                  variant="outline"
                >
                  <Plus data-icon="inline-start" /> Add topic
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
            {showManualTopicForm ? (
              <form className="border-b border-border bg-muted/10 px-6 py-5 xl:px-7" id="manual-topic-form" onSubmit={addManualTopic}>
                <div className="mx-auto max-w-5xl">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-sm font-semibold">Add topic</h3>
                    <Button onClick={() => setShowManualTopicForm(false)} size="sm" type="button" variant="ghost">Cancel</Button>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_180px_180px] items-start gap-3">
                    <label className="grid gap-2 text-sm font-medium">
                      Title
                      <Input placeholder="Topic title" value={manualTopic.title} onChange={(event) => setManualTopic((current) => ({ ...current, title: event.target.value }))} />
                    </label>
                    <TimecodeInput id="manual-topic-start" label="Start time" onChange={(seconds) => setManualTopic((current) => ({ ...current, start_seconds: seconds }))} value={manualTopic.start_seconds} />
                    <TimecodeInput id="manual-topic-end" label="End time" onChange={(seconds) => setManualTopic((current) => ({ ...current, end_seconds: seconds }))} value={manualTopic.end_seconds} />
                  </div>
                  <label className="mt-3 grid gap-2 text-sm font-medium">
                    Summary
                    <Textarea className="min-h-20" placeholder="What this topic covers" value={manualTopic.summary} onChange={(event) => setManualTopic((current) => ({ ...current, summary: event.target.value }))} />
                  </label>
                  <div className="mt-4 flex justify-end">
                    <Button disabled={!manualTopic.title.trim()} type="submit">Add topic</Button>
                  </div>
                </div>
              </form>
            ) : null}
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
              const reviewedConceptCount = reviewedConceptCountForTopic(
                topic.id,
                graph?.concepts ?? [],
              );
              const clipBlockReason = topicClipGenerationBlockReason(
                topic,
                graph?.concepts ?? [],
              );
              const needsConcept = isTopicReviewedForClipGeneration(topic) && reviewedConceptCount === 0;
              const conceptCandidates = (graph?.concepts ?? []).filter(
                (concept) =>
                  (concept.review_status === "accepted" || concept.review_status === "edited") &&
                  !conceptTopicIds(concept).includes(topic.id),
              ).sort(
                (first, second) => conceptTopicIds(first).length - conceptTopicIds(second).length,
              );
              const selectedConceptCandidate =
                topicConceptSelections[topic.id] || conceptCandidates[0]?.id || "";
              return (
                <ReviewWorkspaceGrid
                  queue={(
                    <>
                      <ReviewQueueHeader
                        reviewed={topicReadiness.filter((item) =>
                          item.reviewStatus !== "proposed" &&
                          item.reviewedConcepts > 0 &&
                          item.clips > 0 &&
                          item.flaggedClips === 0
                        ).length}
                        total={topics.length}
                      />
                      <nav aria-label="Topics">
                        {topics.map((item) => {
                          const readiness = topicReadiness.find((entry) => entry.id === item.id);
                          return (
                            <ReviewQueueItem
                              active={item.id === topic.id}
                              detail={`${formatTime(item.start_seconds)}–${formatTime(item.end_seconds)} · ${readiness ? topicProductionLabel(readiness) : item.review_status}`}
                              key={item.id}
                              label={item.title}
                              onClick={() => setSelectedTopicReviewId(item.id)}
                              status={readiness && topicProductionLabel(readiness) === "Ready" ? item.review_status : "proposed"}
                            />
                          );
                        })}
                      </nav>
                    </>
                  )}
                  queueWidth="wide"
                  editor={(
                    <div className="mx-auto flex max-w-4xl flex-col">
                      <div className="order-1 mb-5 flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Topic {index + 1} of {topics.length}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatTime(draft.start_seconds)}–{formatTime(draft.end_seconds)} · {formatDuration(draft.end_seconds - draft.start_seconds)}
                          </p>
                        </div>
                        <Badge className="capitalize" variant="outline">{topic.review_status}</Badge>
                      </div>
                      <div className="order-3 mt-8 space-y-5 border-t border-border pt-6">
                        <h4 className="text-base font-semibold">Topic details</h4>
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
                          <TimecodeInput
                            id={`start-${topic.id}`}
                            label="Start time"
                            onChange={(seconds) => setTopicDrafts((current) => ({
                              ...current,
                              [topic.id]: { ...draft, start_seconds: seconds },
                            }))}
                            value={draft.start_seconds}
                          />
                          <TimecodeInput
                            id={`end-${topic.id}`}
                            label="End time"
                            onChange={(seconds) => setTopicDrafts((current) => ({
                              ...current,
                              [topic.id]: { ...draft, end_seconds: seconds },
                            }))}
                            value={draft.end_seconds}
                          />
                        </div>
                        {nextTopic ? (
                          <label className="block rounded-lg border border-border bg-muted/20 px-4 py-3">
                            <span className="flex items-center justify-between gap-4 text-sm font-medium">
                              Boundary to next topic
                              <span className="tabular-nums text-muted-foreground">{formatTime(draft.end_seconds)}</span>
                            </span>
                            <input
                              className="mt-3 w-full accent-primary"
                              max={Math.floor(nextTopic.end_seconds - 30)}
                              min={Math.ceil(draft.start_seconds + 30)}
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
                      </div>
                      <div className="order-4 mt-6 grid grid-cols-5 gap-2 border-t border-border pt-5">
                        <Button className="w-full" disabled={acceptButtonDisabled(topic.review_status)} onClick={() => acceptTopic(topic.id)} type="button" variant="outline">
                          {acceptButtonLabel(topic.review_status)}
                        </Button>
                        <Button className="w-full" onClick={() => updateTopic(topic.id, draft)} type="button" variant="outline">Save changes</Button>
                        <Button className="w-full" onClick={() => dismissTopic(topic.id)} type="button" variant="destructive">Dismiss</Button>
                        <Button className="w-full" onClick={() => splitTopic(topic)} type="button" variant="outline">Split topic</Button>
                        <Button className="w-full" disabled={!nextTopic} onClick={() => mergeTopicWithNext(index)} type="button" variant="outline">Merge next</Button>
                      </div>
                      <section className="order-2" aria-labelledby={`topic-clips-${topic.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <h4 className="text-base font-semibold" id={`topic-clips-${topic.id}`}>Learning clips</h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {reviewedConceptCount} reviewed concept{reviewedConceptCount === 1 ? "" : "s"}
                              <span className="mx-2 text-border">·</span>
                              {selectedTopicActiveClips.length} active clip{selectedTopicActiveClips.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          <Button
                            disabled={
                              clipBlockReason !== null ||
                              generationAction !== null ||
                              bulkAction !== null ||
                              (selectedTopicActiveClips.length === 0 && !preparationFailures[`clips:${topic.id}`])
                            }
                            onClick={() => void generateClipsForTopic(topic.id)}
                            type="button"
                          >
                            {generationAction === `clips:${topic.id}` || (selectedTopicActiveClips.length === 0 && !preparationFailures[`clips:${topic.id}`]) ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                            {generationAction === `clips:${topic.id}`
                              ? "Preparing clips"
                              : selectedTopicActiveClips.length
                                ? "Regenerate clips"
                                : preparationFailures[`clips:${topic.id}`]
                                  ? "Retry clips"
                                  : "Preparing clips"}
                          </Button>
                        </div>

                        {needsConcept ? (
                          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950">
                            <p className="text-sm font-semibold">Connect a reviewed concept to generate clips</p>
                            <p className="mt-1 text-sm text-amber-900">This keeps clip tags, routing, and assessment remediation traceable.</p>
                            {conceptCandidates.length ? (
                              <div className="mt-4 flex flex-wrap items-center gap-2">
                                <select
                                  aria-label={`Concept for ${topic.title}`}
                                  className="h-9 min-w-64 flex-1 rounded-md border border-amber-300 bg-background px-3 text-sm"
                                  onChange={(event) => setTopicConceptSelections((current) => ({ ...current, [topic.id]: event.target.value }))}
                                  value={selectedConceptCandidate}
                                >
                                  {conceptCandidates.map((concept) => {
                                    const linkedTopicCount = conceptTopicIds(concept).length;
                                    return (
                                      <option key={concept.id} value={concept.id}>
                                        {concept.name}{linkedTopicCount === 0 ? " (unlinked)" : ` (${linkedTopicCount} topic${linkedTopicCount === 1 ? "" : "s"})`}
                                      </option>
                                    );
                                  })}
                                </select>
                                <Button disabled={!selectedConceptCandidate} onClick={() => void linkConceptToTopic(selectedConceptCandidate, topic.id)} size="sm" type="button">Connect concept</Button>
                                <Button onClick={() => openConceptRepairForTopic(topic)} size="sm" type="button" variant="outline">Open graph</Button>
                              </div>
                            ) : (
                              <Button className="mt-4" onClick={() => openConceptRepairForTopic(topic)} size="sm" type="button" variant="outline">Add concept in graph</Button>
                            )}
                          </div>
                        ) : clipBlockReason ? (
                          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{clipBlockReason}</p>
                        ) : preparationFailures[`clips:${topic.id}`] ? (
                          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                            Clip preparation failed. Retry when ready.
                          </p>
                        ) : selectedTopicClips.some((clip) => clip.status === "superseded") && selectedTopicActiveClips.length === 0 ? (
                          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            These clips are out of date after a structure change. Regenerate them before learners can use this topic.
                          </p>
                        ) : null}

                        {selectedTopicActiveClips.length ? (
                          <div className="mt-5">
                            <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Topic clips">
                              {selectedTopicActiveClips.map((clip, clipIndex) => (
                                <Button
                                  aria-selected={selectedClipReview?.id === clip.id}
                                  key={clip.id}
                                  onClick={() => setSelectedClipReviewId(clip.id)}
                                  role="tab"
                                  size="sm"
                                  type="button"
                                  variant={selectedClipReview?.id === clip.id ? "default" : "outline"}
                                >
                                  Clip {clipIndex + 1}
                                </Button>
                              ))}
                            </div>
                            {selectedClipReview ? (
                              <div className="mt-3 grid grid-cols-[minmax(0,560px)_220px] justify-between gap-5">
                                <div>
                                  {job.video_id && playback ? (
                                    <ProviderVideo
                                      clipId={selectedClipReview.id}
                                      clipMaterializationStatus={selectedClipReview.materialization_status}
                                      endSeconds={selectedClipReview.end_seconds}
                                      pipelineBaseUrl={pipelineBaseUrl}
                                      playback={playback}
                                      startSeconds={selectedClipReview.start_seconds}
                                      title={`Instructor preview: ${selectedClipReview.type.replaceAll("_", " ")}`}
                                      videoId={job.video_id}
                                    />
                                  ) : <div className="flex aspect-video items-center justify-center bg-black text-sm text-white/70">Preview unavailable</div>}
                                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                    <span className="font-medium">{clipDisplayTitle(selectedClipReview)}</span>
                                    <span className="text-muted-foreground">{clipDurationLabel(selectedClipReview)}</span>
                                    <Badge className="capitalize" variant="outline">{selectedClipReview.type.replaceAll("_", " ")}</Badge>
                                  </div>
                                </div>
                                <div>
                                  <label className="grid gap-2 text-sm font-medium">
                                    Re-cut note
                                    <Textarea
                                      aria-label={`Flag note for clip ${selectedClipReview.id}`}
                                      className="min-h-28"
                                      placeholder="Describe a boundary or playback issue"
                                      value={clipNotes[selectedClipReview.id] ?? ""}
                                      onChange={(event) => setClipNotes((current) => ({ ...current, [selectedClipReview.id]: event.target.value }))}
                                    />
                                  </label>
                                  <div className="mt-3 grid gap-2">
                                    <Button disabled={clipSpotCheckActionsDisabled(selectedClipReview)} onClick={() => recutClip(selectedClipReview.id)} type="button" variant="outline">Re-cut clip</Button>
                                    <Button disabled={clipSpotCheckActionsDisabled(selectedClipReview)} onClick={() => flagClip(selectedClipReview.id)} type="button" variant="destructive">Flag clip</Button>
                                  </div>
                                  <p className="mt-3 text-xs leading-5 text-muted-foreground">{sourceRangeLabel(selectedClipReview)}</p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : !clipBlockReason && !preparationFailures[`clips:${topic.id}`] ? (
                          <div className="mt-5 rounded-md border border-dashed border-border px-5 py-8 text-center">
                            <LoaderCircle className="mx-auto size-5 animate-spin text-primary motion-reduce:animate-none" />
                            <p className="mt-3 text-sm font-medium">Preparing learner clips</p>
                            <p className="mt-1 text-sm text-muted-foreground">This starts automatically after topic and concept review.</p>
                          </div>
                        ) : null}
                      </section>
                    </div>
                  )}
                />
              );
            })() : null}
          </ReviewWorkspace>
        </div>
      ) : null}

      {job?.course_id ? (
        <section className={`instructorOnly scroll-mt-20 border-b border-border bg-background ${instructorWorkspaceVisible("structure") ? "" : "hidden"}`} id="concept-graph">
          <WorkspaceHeader
            description="Review prerequisite structure and inspect each AI-proposed relationship."
            eyebrow="Knowledge structure"
            title="Concept graph"
            toolbar={<>
              <select
                aria-label="Graph review filter"
                className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                data-slot="graph-filter"
                onChange={(event) => {
                  setGraphReviewFilter(event.target.value as typeof graphReviewFilter);
                  setSelectedGraphConceptId("");
                  setSelectedGraphEdgeId("");
                }}
                value={graphReviewFilter}
              >
                <option value="active">Active concepts</option><option value="proposed">Needs review</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed history</option><option value="all">All history</option>
              </select>
              <select
                aria-label="Graph topic focus"
                className="h-8 max-w-52 rounded-lg border border-input bg-background px-2.5 text-sm"
                data-slot="graph-topic-focus"
                onChange={(event) => {
                  setGraphTopicFocus(event.target.value);
                  setSelectedGraphConceptId("");
                  setSelectedGraphEdgeId("");
                }}
                value={graphTopicFocus}
              >
                <option value="all">All topics</option>
                {topics.map((topic, index) => <option key={topic.id} value={topic.id}>{index + 1}. {topic.title}</option>)}
              </select>
              <Button disabled={generationAction === "graph" || isAcceptingGraph} onClick={() => loadGraph(job.course_id!)} type="button" variant="outline"><RefreshCw data-icon="inline-start" /> Refresh</Button>
              <Button
                onClick={() => {
                  setShowGraphConceptForm(true);
                  setSelectedGraphConceptId("");
                  setSelectedGraphEdgeId("");
                  setNewGraphConcept((current) => ({ ...current, topic_id: current.topic_id || topics[0]?.id || "" }));
                }}
                type="button"
                variant="outline"
              >
                <Plus data-icon="inline-start" /> Add concept
              </Button>
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
            </>}
          />

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
              <strong>{topicsWithoutReviewedConcepts.length} topic(s) need concept links.</strong>{" "}
              Select an unlinked concept and assign its topic before generating clips.
            </div>
          ) : null}

          {graph ? (
            <div className="grid grid-cols-[minmax(0,1fr)_336px]">
              <div className="relative min-w-0 bg-muted/15">
                <div className="absolute left-5 top-5 z-10 flex h-9 items-center gap-2 rounded-md border border-border bg-background/95 px-3 text-xs text-muted-foreground shadow-sm backdrop-blur">
                  <span><strong className="font-semibold text-foreground">{flowNodes.length}</strong> {flowNodes.length === 1 ? "concept" : "concepts"}</span>
                  <span aria-hidden="true">·</span>
                  <span><strong className="font-semibold text-foreground">{flowEdges.length}</strong> {flowEdges.length === 1 ? "prerequisite" : "prerequisites"}</span>
                  {graphTopicFocus !== "all" ? <><span aria-hidden="true">·</span><span className="font-medium text-primary">Focused view</span></> : null}
                  <span aria-label="Node colors identify topics" className="ml-1 flex gap-1" role="img" title="Node colors identify topics"><span className="size-2 rounded-full bg-blue-600" /><span className="size-2 rounded-full bg-emerald-600" /><span className="size-2 rounded-full bg-amber-600" /></span>
                </div>
                <div className="h-[700px] min-w-0">
                  <ReactFlow
                    edges={flowEdges}
                    fitView
                    fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
                    nodes={flowNodes}
                    onConnect={handleConnect}
                    onEdgeClick={(_, edge) => { setSelectedGraphEdgeId(edge.id); setSelectedGraphConceptId(""); }}
                    onInit={(instance) => { graphFlowRef.current = instance; }}
                    onNodeDragStop={(_, node) => persistGraphLayout(node)}
                    onNodeClick={(_, node) => { setSelectedGraphConceptId(node.id); setSelectedGraphEdgeId(""); }}
                    onNodesChange={handleGraphNodesChange}
                    onReconnect={(oldEdge, connection) => void reconnectGraphEdge(oldEdge.id, connection)}
                  >
                    <Background gap={24} size={1} />
                    <Controls />
                  </ReactFlow>
                  {flowNodes.length === 0 ? (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="rounded-lg border border-border bg-background px-5 py-4 text-center shadow-sm">
                        <p className="text-sm font-medium">No concepts in this view</p>
                        <p className="mt-1 text-xs text-muted-foreground">Change the topic or review filter.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="max-h-[700px] overflow-y-auto border-l border-border bg-muted/20 px-5 py-6" aria-label="Graph inspector">
                {showGraphConceptForm ? (
                  <form className="grid gap-4" onSubmit={addGraphConcept}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-xs font-semibold uppercase text-muted-foreground">New concept</p><h3 className="mt-2 text-base font-semibold">Add to graph</h3></div>
                      <Button aria-label="Cancel adding concept" onClick={() => setShowGraphConceptForm(false)} size="sm" type="button" variant="ghost">Cancel</Button>
                    </div>
                    <label className="grid gap-2 text-sm font-medium">Name<Input autoFocus value={newGraphConcept.name} onChange={(event) => setNewGraphConcept((current) => ({ ...current, name: event.target.value }))} /></label>
                    <label className="grid gap-2 text-sm font-medium">Description<Textarea className="min-h-20" value={newGraphConcept.description} onChange={(event) => setNewGraphConcept((current) => ({ ...current, description: event.target.value }))} /></label>
                    <label className="grid gap-2 text-sm font-medium">Topic<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={newGraphConcept.topic_id || topics[0]?.id || ""} onChange={(event) => setNewGraphConcept((current) => ({ ...current, topic_id: event.target.value }))}>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
                    <Button disabled={!newGraphConcept.name.trim()} type="submit"><Plus data-icon="inline-start" /> Add concept</Button>
                  </form>
                ) : selectedGraphEdge ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-xs font-semibold uppercase text-muted-foreground">Prerequisite</p><h3 className="mt-2 text-base font-semibold">Learning dependency</h3></div>
                      <Badge className="capitalize" variant="outline">{selectedGraphEdge.review_status}</Badge>
                    </div>
                    <div className="mt-5 grid gap-2 rounded-lg border border-border bg-background p-3 text-sm">
                      <div><p className="text-xs font-medium text-muted-foreground">Required first</p><p className="mt-1 font-medium">{conceptName(graph, selectedGraphEdge.from_concept_id)}</p></div>
                      <div className="border-t border-border pt-2"><p className="text-xs font-medium text-muted-foreground">Unlocks</p><p className="mt-1 font-medium">{conceptName(graph, selectedGraphEdge.to_concept_id)}</p></div>
                    </div>
                    {aiRationale(selectedGraphEdge) ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{aiRationale(selectedGraphEdge)}</p> : null}
                    <div className="mt-5 flex gap-2 border-b border-border pb-5">
                      {!acceptButtonDisabled(selectedGraphEdge.review_status) ? <Button onClick={() => acceptEdge(selectedGraphEdge.id)} size="sm" type="button">Accept</Button> : null}
                      <Button onClick={() => dismissEdge(selectedGraphEdge.id)} size="sm" type="button" variant="destructive"><Trash2 data-icon="inline-start" /> Remove</Button>
                    </div>
                    <details className="border-b border-border py-4">
                      <summary className="cursor-pointer text-sm font-medium">AI context</summary>
                      <div className="mt-3"><TraceabilityBlock artifact={selectedGraphEdge} /></div>
                    </details>
                  </>
                ) : selectedGraphConcept ? (() => {
                  const concept = selectedGraphConcept;
                  const draft = conceptDrafts[concept.id] ?? { name: concept.name, description: concept.description ?? "" };
                  const linkedTopicIds = conceptTopicIds(concept);
                  const linkedTopics = topics.filter((topic) => linkedTopicIds.includes(topic.id));
                  return (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-xs font-semibold uppercase text-muted-foreground">Concept</p><h3 className="mt-2 text-base font-semibold">{concept.name}</h3></div>
                        <Badge className="capitalize" variant="outline">{concept.review_status}</Badge>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-muted-foreground">{concept.description || "No description yet."}</p>
                      <div className="mt-5">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Topics</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {linkedTopics.length ? linkedTopics.map((topic) => {
                            const topicIndex = topics.findIndex((item) => item.id === topic.id);
                            const colors = graphTopicColors(topicIndex);
                            return <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs" key={topic.id} style={{ background: colors.background, borderColor: colors.border }}><span className="size-2 shrink-0 rounded-full" style={{ background: colors.border }} /><span className="truncate">{topic.title}</span></span>;
                          }) : <Badge variant="outline">Unlinked</Badge>}
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2 pb-5">
                        {!acceptButtonDisabled(concept.review_status) ? <Button onClick={() => acceptConcept(concept.id)} size="sm" type="button">Accept</Button> : null}
                        <Button onClick={() => dismissConcept(concept.id)} size="sm" type="button" variant="destructive"><Trash2 data-icon="inline-start" /> Remove</Button>
                      </div>
                      <details className="border-y border-border py-4">
                        <summary className="cursor-pointer text-sm font-medium">Edit details</summary>
                        <div className="mt-4 space-y-4">
                          <label className="grid gap-2 text-sm font-medium">Name<Input aria-label={`Concept name ${concept.name}`} value={draft.name} onChange={(event) => setConceptDrafts((current) => ({ ...current, [concept.id]: { ...draft, name: event.target.value } }))} /></label>
                          <label className="grid gap-2 text-sm font-medium">Description<Textarea aria-label={`Concept description ${concept.name}`} className="min-h-24" value={draft.description} onChange={(event) => setConceptDrafts((current) => ({ ...current, [concept.id]: { ...draft, description: event.target.value } }))} /></label>
                          <Button className="w-full" onClick={() => void updateConcept(concept.id, draft)} size="sm" type="button">Save details</Button>
                        </div>
                      </details>
                      <details className="border-b border-border py-4">
                        <summary className="cursor-pointer text-sm font-medium">Topic assignment</summary>
                        <div className="mt-4 space-y-4">
                          <fieldset className="grid gap-2 border-0 p-0" data-slot="concept-topic-links">
                            <legend className="sr-only">Topics</legend>
                            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-2">
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
                          </fieldset>
                          <Button className="w-full" onClick={() => void updateConceptTopicLinks(concept.id)} size="sm" type="button">Save topics</Button>
                        </div>
                      </details>
                      <details className="border-b border-border py-4">
                        <summary className="cursor-pointer text-sm font-medium">Merge duplicate</summary>
                        <form className="mt-4 grid gap-2" onSubmit={(event) => void mergeConcepts(event, concept.id)}>
                          <select aria-label="Concept to keep" className="h-9 rounded-lg border border-input bg-background px-2 text-sm" data-slot="merge-concept-target" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>{graph.concepts.filter((item) => item.id !== concept.id && item.review_status !== "dismissed").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                          <Button disabled={!mergeTargetId || mergeTargetId === concept.id} size="sm" type="submit" variant="outline">Merge into selected concept</Button>
                        </form>
                      </details>
                      <details className="border-b border-border py-4">
                        <summary className="cursor-pointer text-sm font-medium">AI context</summary>
                        <div className="mt-3"><TraceabilityBlock artifact={concept} /></div>
                      </details>
                    </>
                  );
                })() : <p className="text-sm text-muted-foreground">Select a concept or edge to inspect it.</p>}

              </aside>
            </div>
          ) : (
            <div className="px-8 py-16 text-center"><p className="text-sm font-medium">No graph generated</p><p className="mt-1 text-sm text-muted-foreground">Review at least one topic, then generate the concept graph.</p></div>
          )}
        </section>
      ) : null}

      {job?.video_id && topics.length > 0 ? (
        <div className={`scroll-mt-20 ${instructorWorkspaceVisible("assessments") ? "" : "hidden"}`} id="assessments">
          <ReviewWorkspace
            description="Approve each learner check before it goes live."
            eyebrow="Assessment review"
            title="Assessment review"
            toolbar={(
              <Button
                disabled={bulkAction !== null || generationAction !== null || !questions.some((question) => question.review_status === "proposed")}
                onClick={() => void acceptAllQuestions()}
                type="button"
              >
                {bulkAction === "accept-questions" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : null}
                {bulkAction === "accept-questions" ? "Approving" : "Approve all"}
              </Button>
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
                  ) : missingAssessmentProposalTopicIds.length || generationAction?.startsWith("question:") ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      <LoaderCircle className="mb-3 size-5 animate-spin text-primary motion-reduce:animate-none" />
                      Preparing checks automatically.
                    </div>
                  ) : <p className="px-4 py-6 text-sm text-muted-foreground">Checks appear after reviewed clips are ready.</p>}
                </>
              )}
              queueWidth="wide"
              editor={selectedQuestionReview ? (() => {
                const question = selectedQuestionReview;
                const draft = questionDrafts[question.id] ?? questionToDraft(question);
                return (
                  <div className="mx-auto max-w-4xl">
                    <div className="mb-6 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{topics.find((topic) => topic.id === question.topic_id)?.title ?? "Untitled topic"}</p>
                        <h3 className="mt-1 text-lg font-semibold">Learner check</h3>
                      </div>
                      <Badge className="capitalize" variant="outline">{question.review_status}</Badge>
                    </div>
                    <div className="space-y-5">
                      <label className="grid gap-2 text-sm font-medium" htmlFor={`question-body-${question.id}`}>Question
                        <Textarea className="min-h-24 text-base" id={`question-body-${question.id}`} value={draft.body} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, body: event.target.value } }))} />
                      </label>
                      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
                        <label className="grid gap-2 text-sm font-medium" htmlFor={`question-type-${question.id}`}>Type
                          <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" data-slot="question-type" id={`question-type-${question.id}`} value={draft.type} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, type: event.target.value as Question["type"] } }))}>
                            <option value="mcq">Multiple choice</option><option value="short_answer">Short answer</option><option value="worked_problem">Worked problem</option>
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm font-medium" htmlFor={`question-answer-${question.id}`}>Correct answer
                          <Textarea className="min-h-10" id={`question-answer-${question.id}`} value={draft.correct_answer} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, correct_answer: event.target.value } }))} />
                        </label>
                      </div>
                      {draft.type === "mcq" ? (
                        <label className="grid gap-2 text-sm font-medium" htmlFor={`question-choices-${question.id}`}>Answer choices
                          <Textarea className="min-h-32" id={`question-choices-${question.id}`} placeholder="One choice per line" value={draft.answer_choices} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, answer_choices: event.target.value } }))} />
                        </label>
                      ) : null}
                      <details className="border-t border-border pt-4">
                        <summary className="cursor-pointer text-sm font-medium">Routing details <span className="font-normal text-muted-foreground">({draft.remediation_rules.length} rules)</span></summary>
                        <div className="mt-4 space-y-4">
                          <label className="grid gap-2 text-sm font-medium" htmlFor={`question-confidence-${question.id}`}>Confidence prompt
                            <Input id={`question-confidence-${question.id}`} value={draft.confidence_prompt} onChange={(event) => setQuestionDrafts((current) => ({ ...current, [question.id]: { ...draft, confidence_prompt: event.target.value } }))} />
                          </label>
                          <fieldset className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <legend className="text-sm font-medium">Wrong-answer routing</legend>
                              <Button onClick={() => addRemediationRule(question.id)} size="sm" type="button" variant="outline"><Plus data-icon="inline-start" /> Add rule</Button>
                            </div>
                            {draft.remediation_rules.length ? draft.remediation_rules.map((rule, ruleIndex) => (
                              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4" key={`${question.id}-rule-${ruleIndex}`}>
                                <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Rule {ruleIndex + 1}</p><Button aria-label={`Remove remediation rule ${ruleIndex + 1}`} onClick={() => removeRemediationRule(question.id, ruleIndex)} size="icon-sm" type="button" variant="ghost"><Trash2 /></Button></div>
                                <label className="grid gap-1.5 text-xs font-medium">Answer pattern<Input value={rule.wrong_answer_pattern} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "wrong_answer_pattern", event.target.value)} /></label>
                                <div className="grid grid-cols-2 gap-3">
                                  <label className="grid min-w-0 gap-1.5 text-xs font-medium">Clip<select className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm" value={rule.target_clip_id} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "target_clip_id", event.target.value)}><option value="">Automatic</option>{clips.filter((clip) => clip.status !== "superseded").map((clip, index) => <option key={clip.id} value={clip.id}>Clip {index + 1}: {clip.type.replaceAll("_", " ")}</option>)}</select></label>
                                  <label className="grid min-w-0 gap-1.5 text-xs font-medium">Concept<select className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm" value={rule.target_concept_id} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "target_concept_id", event.target.value)}><option value="">Automatic</option>{graph?.concepts.filter((concept) => concept.review_status === "accepted" || concept.review_status === "edited").map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></label>
                                </div>
                                <label className="grid gap-1.5 text-xs font-medium">Reason<Textarea className="min-h-16" value={rule.rationale} onChange={(event) => updateRemediationRule(question.id, ruleIndex, "rationale", event.target.value)} /></label>
                              </div>
                            )) : <p className="text-sm text-muted-foreground">No custom routing rules.</p>}
                          </fieldset>
                        </div>
                      </details>
                      <details className="border-t border-border pt-4">
                        <summary className="cursor-pointer text-sm font-medium">AI context</summary>
                        <div className="mt-3"><TraceabilityBlock artifact={question} /></div>
                      </details>
                    </div>
                    <div className="mt-7 flex flex-wrap gap-2 border-t border-border pt-5">
                      <Button disabled={acceptButtonDisabled(question.review_status)} onClick={() => acceptQuestion(question.id)} type="button">{acceptButtonLabel(question.review_status)}</Button>
                      <Button onClick={() => editQuestion(question.id)} type="button" variant="outline">Save edits</Button>
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
                  <div className="max-w-sm">
                    {missingAssessmentProposalTopicIds.length || generationAction?.startsWith("question:") ? <LoaderCircle className="mx-auto size-6 animate-spin text-primary motion-reduce:animate-none" /> : null}
                    <p className="mt-3 text-sm font-medium">
                      {questionPreparationFailures.length
                        ? "Assessment preparation paused"
                        : missingAssessmentProposalTopicIds.length || generationAction?.startsWith("question:")
                          ? "Preparing learner checks"
                          : "Waiting for reviewed clips"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {questionPreparationFailures.length
                        ? "Retry the failed check when ready."
                        : "Questions appear here automatically when clips are ready."}
                    </p>
                    {questionPreparationFailures.map(([key]) => {
                      const topicId = key.slice("question:".length);
                      return <Button className="mt-4" key={key} onClick={() => void generateQuestionForTopic(topicId)} type="button" variant="outline">Retry preparation</Button>;
                    })}
                  </div>
                </div>
              )}
            />
          </ReviewWorkspace>
        </div>
      ) : null}

      {job?.course_id && graph ? (
        <div className={`scroll-mt-20 ${instructorWorkspaceVisible("adapt") ? "" : "hidden"}`} id="routing">
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
        <section className={`instructorOnly scroll-mt-20 border-b border-border bg-background ${instructorWorkspaceVisible("adapt") ? "" : "hidden"}`} id="routing-simulator">
          <WorkspaceHeader
            description="Test deterministic outcomes before publishing."
            eyebrow="Policy validation"
            title="Learner routing simulator"
            toolbar={<Button onClick={createDemoLearner} type="button">
              {demoLearnerId ? "Create new learner" : "Create demo learner"}
            </Button>}
          />
          <div className="grid min-h-[480px] grid-cols-[248px_minmax(0,1fr)_304px]">
            <aside className="border-r border-border bg-muted/20">
              <div className="border-b border-border px-4 py-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Test questions</p></div>
              {simulatorQuestions.map((question) => <button className={`w-full border-b border-border px-4 py-3 text-left text-sm hover:bg-muted ${question.id === selectedSimulatorQuestion?.id ? "bg-background shadow-[inset_3px_0_0_var(--primary)]" : ""}`} data-slot="simulator-question" key={question.id} onClick={() => setSelectedSimulatorQuestionId(question.id)} type="button"><span className="block truncate font-medium">{topics.find((topic) => topic.id === question.topic_id)?.title ?? "Untitled topic"}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{question.type.replaceAll("_", " ")}</span></button>)}
            </aside>
            <div className="min-w-0 px-6 py-6 xl:px-7">
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

      {job?.course_id ? (
        <div className={instructorWorkspaceVisible("publish") ? "" : "hidden"}>
          <InstructorPublishReview
            blockers={publishReadiness?.blockers ?? []}
            courseStatus={course?.status}
            onOpenTask={openWorkflowTask}
            onPublish={() => void publishCourse()}
            publishReady={publishReadiness?.ready ?? false}
            stages={workflow.stages}
            tasks={workflow.tasks}
          />
        </div>
      ) : null}

      {isLearnerContext && learnerQuestions.length > 0 ? (
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
                  {activeLearnerClip ? <p className="text-xs text-muted-foreground">{clipDurationLabel(activeLearnerClip)} lesson</p> : null}
                </div>
                {activeLearnerClip && job?.video_id && playback ? (
                  <ProviderVideo
                    clipId={activeLearnerClip.id}
                    clipMaterializationStatus={activeLearnerClip.materialization_status}
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
              <nav aria-labelledby="learner-topics">
                {topics.filter((topic) => topic.review_status === "accepted" || topic.review_status === "edited").map((topic, index) => {
                  const lessonDuration = topicClipDurationLabel(clips, topic.id);
                  return <button
                    aria-current={topic.id === activeLearnerTopic?.id ? "true" : undefined}
                    className={`flex w-full items-start gap-3 border-b border-border px-5 py-4 text-left hover:bg-muted ${topic.id === activeLearnerTopic?.id ? "bg-background shadow-[inset_3px_0_0_var(--primary)]" : ""}`}
                    data-slot="learner-topic"
                    key={topic.id}
                    type="button"
                    onClick={() => setActiveLearnerTopicId(topic.id)}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0"><span className="block text-sm font-medium leading-5">{topic.title}</span><span className="mt-1 block text-xs text-muted-foreground">{lessonDuration}</span></span>
                  </button>
                })}
              </nav>
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
        <section className={`instructorOnly scroll-mt-20 border-b border-border bg-background ${instructorWorkspaceVisible("insights") ? "" : "hidden"}`} id="insights">
          <WorkspaceHeader
            description="Review evidence-backed signals and correct the underlying learning system."
            eyebrow="Learning operations"
            title="Instructor dashboard"
            toolbar={<Button onClick={() => loadDashboard(job.course_id!)} type="button"><RefreshCw data-icon="inline-start" /> Refresh signals</Button>}
          />

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

              {!dashboardSummary.not_enough_data ? (
                <section aria-labelledby="performance-evidence-title" className="border-b border-border">
                  <header className="flex items-end justify-between gap-6 border-b border-border px-6 py-4">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Performance evidence</p>
                      <h3 className="mt-1 text-base font-semibold" id="performance-evidence-title">Where learning needs attention</h3>
                    </div>
                    <p className="max-w-xl text-right text-xs leading-5 text-muted-foreground">Observed learner behavior, shown before or after it crosses an intervention threshold.</p>
                  </header>
                  <div className="grid grid-cols-3">
                    <div className="min-w-0 border-r border-border px-5 py-5">
                      <div className="mb-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Concept pressure</p><p className="mt-1 text-xs text-muted-foreground">Share of learners currently struggling</p></div>
                      <div className="space-y-4">
                        {conceptPerformance.length ? conceptPerformance.map((item) => {
                          const rate = percentage(item.struggling_learners, item.touched_learners);
                          return <div key={item.concept_id}>
                            <div className="flex items-start justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium" title={item.concept_name}>{item.concept_name}</span><strong className="shrink-0 tabular-nums">{rate}%</strong></div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-amber-500" style={{ width: `${rate}%` }} /></div>
                            <p className="mt-1 text-[11px] text-muted-foreground">{item.struggling_learners} struggling · {item.touched_learners} reached</p>
                          </div>;
                        }) : <p className="text-xs leading-5 text-muted-foreground">No concept mastery evidence yet.</p>}
                      </div>
                    </div>

                    <div className="min-w-0 border-r border-border px-5 py-5">
                      <div className="mb-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Question performance</p><p className="mt-1 text-xs text-muted-foreground">Incorrect and low-confidence responses</p></div>
                      <div className="space-y-4">
                        {questionPerformance.length ? questionPerformance.map((item) => {
                          const incorrectRate = percentage(item.incorrect_attempts, item.attempts);
                          const uncertainRate = percentage(item.low_confidence_correct_attempts, item.attempts);
                          return <div className="border-b border-border pb-3 last:border-0" key={item.question_id}>
                            <p className="truncate text-xs font-medium" title={item.prompt}>{item.prompt}</p>
                            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground"><span><strong className="text-foreground">{incorrectRate}%</strong> incorrect</span><span><strong className="text-foreground">{uncertainRate}%</strong> unsure</span><span>{item.attempts} attempts</span></div>
                          </div>;
                        }) : <p className="text-xs leading-5 text-muted-foreground">Question performance appears after the first learner response.</p>}
                      </div>
                    </div>

                    <div className="min-w-0 px-5 py-5">
                      <div className="mb-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Remediation demand</p><p className="mt-1 text-xs text-muted-foreground">Clips used when learners need support</p></div>
                      <div className="space-y-4">
                        {clipPerformance.length ? clipPerformance.map((item) => {
                          const clip = clips.find((candidate) => candidate.id === item.clip_id);
                          return <div className="border-b border-border pb-3 last:border-0" key={item.clip_id}>
                            <p className="truncate text-xs font-medium" title={clip ? clipDisplayTitle(clip) : item.clip_id}>{clip ? clipDisplayTitle(clip) : "Reviewed remediation clip"}</p>
                            <p className="mt-2 text-[11px] text-muted-foreground"><strong className="text-foreground">{item.remediation_attempts}</strong> remediation attempts · <strong className="text-foreground">{item.struggling_learners}</strong> struggling learners</p>
                          </div>;
                        }) : <p className="text-xs leading-5 text-muted-foreground">No clip has accumulated remediation demand yet.</p>}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <div className="grid min-h-[560px] grid-cols-[248px_minmax(0,1fr)_304px]">
                <aside className="min-w-0 border-r border-border bg-muted/20" aria-label="Dashboard signal queue">
                  <div className="border-b border-border px-4 py-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase text-muted-foreground">Signal queue</p><Badge variant="outline">{dashboardSummary.signals.length}</Badge></div></div>
                  {dashboardSummary.signals.length ? dashboardSummary.signals.map((signal) => (
                    <button className={`w-full border-b border-border px-4 py-3 text-left hover:bg-muted ${signal.id === selectedDashboardSignal?.id ? "bg-background shadow-[inset_3px_0_0_var(--primary)]" : ""}`} data-slot="dashboard-signal" key={signal.id} onClick={() => setSelectedDashboardSignalId(signal.id)} type="button">
                      <span className="block text-sm font-medium">{dashboardSignalTitle(signal)}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{signal.type.replaceAll("_", " ")}</span>
                    </button>
                  )) : <p className="px-4 py-6 text-sm text-muted-foreground">No open dashboard problems. Refresh after more learner activity.</p>}
                </aside>

                <div className="min-w-0 px-6 py-6 xl:px-7">
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

function TimecodeInput({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (seconds: number) => void;
  value: number;
}) {
  const [text, setText] = useState(() => formatTimecode(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatTimecode(value));
    setInvalid(false);
  }, [value]);

  function commit() {
    const seconds = parseTimecode(text);
    if (seconds === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatTimecode(seconds));
    onChange(seconds);
  }

  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={id}>
      {label}
      <Input
        aria-describedby={`${id}-hint`}
        aria-invalid={invalid || undefined}
        className="h-10 tabular-nums"
        id={id}
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        placeholder="9:11"
        value={text}
      />
      <span className={invalid ? "text-xs font-normal text-destructive" : "sr-only"} id={`${id}-hint`}>
        {invalid ? "Use minutes:seconds, for example 9:11." : "Enter time as minutes and seconds."}
      </span>
    </label>
  );
}

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

const graphTopicPalette = [
  { background: "#eff6ff", border: "#2563eb", edge: "#3b82f6" },
  { background: "#ecfdf5", border: "#059669", edge: "#10b981" },
  { background: "#fffbeb", border: "#d97706", edge: "#f59e0b" },
  { background: "#fff1f2", border: "#e11d48", edge: "#f43f5e" },
  { background: "#f5f3ff", border: "#7c3aed", edge: "#8b5cf6" },
  { background: "#ecfeff", border: "#0891b2", edge: "#06b6d4" },
] as const;

function graphTopicColors(topicIndex: number) {
  if (topicIndex < 0) {
    return { background: "#f4f4f5", border: "#71717a", edge: "#71717a" };
  }
  return graphTopicPalette[topicIndex % graphTopicPalette.length];
}

function conceptName(graph: GraphResponse, conceptId: string) {
  return graph.concepts.find((concept) => concept.id === conceptId)?.name ?? "Unknown concept";
}
