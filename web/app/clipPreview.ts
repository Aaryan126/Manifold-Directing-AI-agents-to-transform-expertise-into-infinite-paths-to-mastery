export type ClipPreviewRange = {
  start_seconds: number;
  end_seconds: number;
};

export type ClipPlaybackTimeline = "asset_relative" | "clip_relative";

export function clipPreviewUrl(
  pipelineBaseUrl: string,
  videoId: string,
  clip: ClipPreviewRange,
): string {
  return `${pipelineBaseUrl}/videos/${videoId}/media#t=${formatSeconds(
    clip.start_seconds,
  )},${formatSeconds(clip.end_seconds)}`;
}

export function materializedClipUrl(pipelineBaseUrl: string, clipId: string): string {
  return `${pipelineBaseUrl}/clips/${clipId}/media`;
}

export function materializedClipCaptionsUrl(
  pipelineBaseUrl: string,
  clipId: string,
): string {
  return `${pipelineBaseUrl}/clips/${clipId}/captions.vtt`;
}

export function muxClipPlaybackBounds(clip: ClipPreviewRange) {
  return {
    assetStartTime: Math.max(0, clip.start_seconds),
    assetEndTime: Math.max(clip.start_seconds, clip.end_seconds),
    defaultDuration: Math.max(0, clip.end_seconds - clip.start_seconds),
  };
}

export function clipPlaybackElapsedSeconds(
  currentTime: number,
  clip: ClipPreviewRange,
  timeline: ClipPlaybackTimeline,
) {
  const duration = Math.max(0, clip.end_seconds - clip.start_seconds);
  const elapsed = timeline === "clip_relative"
    ? currentTime
    : currentTime - clip.start_seconds;
  return Math.min(duration, Math.max(0, elapsed));
}

function formatSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(3).replace(/0+$/, "");
}
