export type CoverageTopic = {
  id: string;
  start_seconds: number;
  end_seconds: number;
  review_status: string;
};

export type CoverageGap = {
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
};

const GAP_TOLERANCE_SECONDS = 3;

export function detectCoverageGaps(
  topics: CoverageTopic[],
  sourceStartSeconds: number,
  sourceEndSeconds: number,
): CoverageGap[] {
  if (sourceEndSeconds <= sourceStartSeconds) return [];

  const activeTopics = topics
    .filter((topic) => topic.review_status !== "dismissed")
    .filter((topic) => topic.end_seconds > topic.start_seconds)
    .sort((first, second) => first.start_seconds - second.start_seconds);

  const gaps: CoverageGap[] = [];
  let cursor = sourceStartSeconds;

  for (const topic of activeTopics) {
    if (topic.start_seconds - cursor > GAP_TOLERANCE_SECONDS) {
      gaps.push(toGap(cursor, topic.start_seconds));
    }
    cursor = Math.max(cursor, topic.end_seconds);
  }

  if (sourceEndSeconds - cursor > GAP_TOLERANCE_SECONDS) {
    gaps.push(toGap(cursor, sourceEndSeconds));
  }

  return gaps;
}

function toGap(startSeconds: number, endSeconds: number): CoverageGap {
  return {
    start_seconds: roundSeconds(startSeconds),
    end_seconds: roundSeconds(endSeconds),
    duration_seconds: roundSeconds(endSeconds - startSeconds),
  };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
