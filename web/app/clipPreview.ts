export type ClipPreviewRange = {
  start_seconds: number;
  end_seconds: number;
};

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

function formatSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(3).replace(/0+$/, "");
}
