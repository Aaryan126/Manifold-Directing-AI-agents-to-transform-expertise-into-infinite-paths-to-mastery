export const blueprintNodeMotionDuration = 420;

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
  return ((Math.abs(hash) % 3) - 1) * 10;
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
      delay: node.layer * 36 + Math.min(rank * 10, 40),
      entering: !previous,
      from: previous ?? {
        x: node.position.x + deterministicOffset(node.logicalId),
        y: node.position.y - 34 - node.layer * 4,
      },
    };
  });
}

export function blueprintNodeMotionProgress(elapsed: number, delay: number) {
  const linear = Math.max(
    0,
    Math.min(1, (elapsed - delay) / blueprintNodeMotionDuration),
  );
  return 1 - ((1 - linear) ** 3);
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
