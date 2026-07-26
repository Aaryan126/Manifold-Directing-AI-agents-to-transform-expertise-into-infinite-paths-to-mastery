"use client";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  CheckCircle2,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  Route,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  learnerMasteryConnections,
  learnerPathVisualState,
  type LearnerMasteryConnection,
  type LearnerMasteryReview,
  type LearnerPath,
  type LearnerPathItem,
  type LearnerPathVisualState,
} from "./learner-course";
import styles from "./learner.module.css";

type MasteryNodeData = {
  evidence: LearnerMasteryReview["concepts"][number] | null;
  item: LearnerPathItem;
  onInspect: (conceptId: string) => void;
  selected: boolean;
  state: LearnerPathVisualState;
};
type MasteryNode = Node<MasteryNodeData, "learnerMastery">;
type MasteryEdgeData = {
  kind: LearnerMasteryConnection["kind"];
};
type MasteryEdge = Edge<MasteryEdgeData>;

const masteryNodeTypes = { learnerMastery: MasteryMapNode };
const nodeWidth = 238;
const nodeHeight = 94;

export function LearnerMasteryMap({
  inspectedConceptId,
  mastery,
  onInspect,
  path,
}: {
  inspectedConceptId: string | null;
  mastery: LearnerMasteryReview;
  onInspect: (conceptId: string) => void;
  path: LearnerPath;
}) {
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [layoutKey, setLayoutKey] = useState<string | null>(null);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const connections = useMemo(
    () => learnerMasteryConnections(path.items),
    [path.items],
  );
  const requestedLayoutKey = useMemo(
    () => [
      ...path.items.map((item) => item.concept_id).sort(),
      ...connections.map((connection) => connection.id).sort(),
    ].join(":"),
    [connections, path.items],
  );

  useEffect(() => {
    if (!path.items.length) {
      setPositions({});
      setLayoutKey(requestedLayoutKey);
      return;
    }
    let cancelled = false;
    const elk = new ELK();
    void elk.layout({
      id: "learner-mastery",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "42",
        "elk.spacing.edgeEdge": "14",
        "elk.spacing.edgeNode": "18",
        "elk.layered.spacing.nodeNodeBetweenLayers": "78",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.favorStraightEdges": "true",
        "elk.layered.considerModelOrder.strategy": "PREFER_NODES",
      },
      children: [...path.items]
        .sort(
          (left, right) =>
            left.sequence_rank - right.sequence_rank
            || left.name.localeCompare(right.name),
        )
        .map((item) => ({
          id: item.concept_id,
          width: nodeWidth,
          height: nodeHeight,
        })),
      edges: connections.map((connection) => ({
        id: connection.id,
        sources: [connection.source],
        targets: [connection.target],
      })),
    }).then((layout) => {
      if (cancelled) return;
      setPositions(Object.fromEntries((layout.children ?? []).map((node) => [
        node.id,
        { x: node.x ?? 0, y: node.y ?? 0 },
      ])));
      setLayoutKey(requestedLayoutKey);
    }).catch(() => {
      if (cancelled) return;
      setPositions(Object.fromEntries(path.items.map((item, index) => [
        item.concept_id,
        {
          x: (index % 3) * (nodeWidth + 42),
          y: Math.floor(index / 3) * (nodeHeight + 78),
        },
      ])));
      setLayoutKey(requestedLayoutKey);
    });
    return () => {
      cancelled = true;
    };
  }, [connections, path.items, requestedLayoutKey]);

  const evidenceByConcept = useMemo(
    () => new Map(
      mastery.concepts.map((concept) => [concept.concept_id, concept]),
    ),
    [mastery.concepts],
  );
  const nodes = useMemo<MasteryNode[]>(() => path.items.map((item) => ({
    id: item.concept_id,
    type: "learnerMastery",
    position: positions[item.concept_id] ?? { x: 0, y: 0 },
    data: {
      evidence: evidenceByConcept.get(item.concept_id) ?? null,
      item,
      onInspect,
      selected: inspectedConceptId === item.concept_id,
      state: learnerPathVisualState(item, path.current_concept_id),
    },
    selected: inspectedConceptId === item.concept_id,
  })), [
    evidenceByConcept,
    inspectedConceptId,
    onInspect,
    path.current_concept_id,
    path.items,
    positions,
  ]);
  const edges = useMemo<MasteryEdge[]>(() => connections.map((connection) => {
    const entersCurrent = connection.target === path.current_concept_id;
    const prerequisite = connection.kind === "prerequisite";
    return {
      id: connection.id,
      source: connection.source,
      target: connection.target,
      data: { kind: connection.kind },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: entersCurrent ? "#c86622" : prerequisite ? "#77747b" : "#b8b4ac",
        height: 15,
        width: 15,
      },
      style: {
        stroke: entersCurrent ? "#c86622" : prerequisite ? "#77747b" : "#b8b4ac",
        strokeDasharray: prerequisite ? undefined : "5 6",
        strokeWidth: entersCurrent ? 2.4 : prerequisite ? 1.7 : 1.25,
      },
      type: "smoothstep",
    };
  }), [connections, path.current_concept_id]);
  const ready = layoutKey === requestedLayoutKey;

  useEffect(() => {
    if (!instance || !ready || !nodes.length) return;
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({ duration: 280, maxZoom: 1, padding: 0.18 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [instance, nodes.length, ready, requestedLayoutKey]);

  return (
    <div
      aria-label="Adaptive mastery prerequisite map"
      className={styles.masteryMapCanvas}
      data-testid="mastery-map"
    >
      {!ready ? (
        <div className={styles.masteryMapLoading}>
          <LoaderCircle className={styles.spin} />
          Arranging your course map…
        </div>
      ) : null}
      <ReactFlow
        edges={edges}
        fitView
        maxZoom={1.25}
        minZoom={0.35}
        nodeTypes={masteryNodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        onInit={setInstance}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background color="#dedbd3" gap={22} size={1} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function MasteryMapNode({ data }: NodeProps<MasteryNode>) {
  const { evidence, item, onInspect, selected, state } = data;
  return (
    <article
      className={styles.masteryMapNode}
      data-selected={selected || undefined}
      data-state={state}
    >
      <Handle
        className={styles.masteryMapHandle}
        position={Position.Top}
        type="target"
      />
      <button
        aria-label={`${masteryStateLabel(state, evidence?.access_state)}: ${item.name}`}
        onClick={() => onInspect(item.concept_id)}
        type="button"
      >
        <span>{masteryNodeIcon(state, item.sequence_rank)}</span>
        <small>{masteryStateLabel(state, evidence?.access_state)}</small>
        <strong>{item.name}</strong>
      </button>
      <Handle
        className={styles.masteryMapHandle}
        position={Position.Bottom}
        type="source"
      />
    </article>
  );
}

function masteryNodeIcon(state: LearnerPathVisualState, sequenceRank: number) {
  if (state === "mastered") return <CheckCircle2 />;
  if (state === "blocked") return <LockKeyhole />;
  if (state === "recommended" || state === "review") return <Route />;
  if (sequenceRank > 0) return sequenceRank;
  return <GitBranch />;
}

function masteryStateLabel(
  state: LearnerPathVisualState,
  accessState?: string,
) {
  if (accessState === "content_unavailable") return "Needs reviewed content";
  if (state === "mastered") return "Mastered";
  if (state === "recommended") return "Recommended next";
  if (state === "review") return "Review recommended";
  if (state === "ready") return "Ready";
  return "Blocked";
}
