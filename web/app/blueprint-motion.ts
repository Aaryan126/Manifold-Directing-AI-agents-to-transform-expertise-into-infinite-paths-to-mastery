export const blueprintNodeMotionDuration = 760;
export const blueprintMotionPaintHold = 110;

export type BlueprintMotionPosition = {
  x: number;
  y: number;
};

export type BlueprintMotionInput = {
  id: string;
  layer: number;
  logicalId: string;
  position: BlueprintMotionPosition;
};

export type BlueprintNodeMotionPlan = BlueprintMotionInput & {
  delay: number;
  entering: boolean;
  from: BlueprintMotionPosition;
};

function deterministicOffset(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return ((Math.abs(hash) % 3) - 1) * 22;
}

export function createBlueprintNodeMotionPlan(
  nodes: BlueprintMotionInput[],
  previousPositions: ReadonlyMap<string, BlueprintMotionPosition>,
): BlueprintNodeMotionPlan[] {
  const layerRanks = new Map<number, number>();
  return nodes.map((node) => {
    const rank = layerRanks.get(node.layer) ?? 0;
    layerRanks.set(node.layer, rank + 1);
    const previous = previousPositions.get(node.logicalId);
    return {
      ...node,
      delay: node.layer * 72 + Math.min(rank * 18, 72),
      entering: !previous,
      from: previous ?? {
        x: node.position.x + deterministicOffset(node.logicalId),
        y: node.position.y - 108 - node.layer * 14,
      },
    };
  });
}

export function blueprintNodeMotionProgress(elapsed: number, delay: number) {
  const linear = Math.max(
    0,
    Math.min(1, (elapsed - delay) / blueprintNodeMotionDuration),
  );
  return linear < 0.5
    ? 4 * (linear ** 3)
    : 1 - (((-2 * linear + 2) ** 3) / 2);
}

export function blueprintEnteringNodeOpacity(progress: number) {
  return 0.14 + progress * 0.86;
}

export function blueprintMotionTotalDuration(plans: BlueprintNodeMotionPlan[]) {
  return Math.max(
    blueprintNodeMotionDuration,
    ...plans.map((plan) => plan.delay + blueprintNodeMotionDuration),
  );
}

export function blueprintEdgeRevealProgress(elapsed: number, totalDuration: number) {
  const start = totalDuration * 0.58;
  const duration = totalDuration * 0.42;
  return Math.max(0, Math.min(1, (elapsed - start) / duration));
}
