export type PresentableClip = {
  topic_id: string;
  start_seconds: number;
  end_seconds: number;
  type: string;
  status: string;
  ai_proposal: Record<string, unknown> | null;
};

export function clipDisplayTitle(clip: PresentableClip): string {
  const proposedTitle = clip.ai_proposal?.title;
  if (typeof proposedTitle === "string" && proposedTitle.trim()) {
    return proposedTitle.trim();
  }
  return `${titleCase(clip.type.replaceAll("_", " "))} clip`;
}

export function clipDurationLabel(
  clip: Pick<PresentableClip, "start_seconds" | "end_seconds">,
): string {
  const durationSeconds = Math.max(0, clip.end_seconds - clip.start_seconds);
  const rounded = Math.round(durationSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes}m ${seconds}s`;
}

export function topicClipDurationLabel(
  clips: PresentableClip[],
  topicId: string,
): string {
  const durationSeconds = clips
    .filter((clip) => clip.topic_id === topicId && clip.status === "active")
    .reduce(
      (total, clip) => total + Math.max(0, clip.end_seconds - clip.start_seconds),
      0,
    );
  if (durationSeconds === 0) return "Clip unavailable";
  return `~${Math.max(1, Math.round(durationSeconds / 60))} min`;
}

export function sourceRangeLabel(clip: PresentableClip): string {
  return `${formatSourceTime(clip.start_seconds)}–${formatSourceTime(
    clip.end_seconds,
  )} in original recording`;
}

function formatSourceTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
