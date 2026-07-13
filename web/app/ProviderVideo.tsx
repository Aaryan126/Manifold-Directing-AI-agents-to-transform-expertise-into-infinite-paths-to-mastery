"use client";

import MuxPlayer from "@mux/mux-player-react";
import {
  clipPreviewUrl,
  materializedClipCaptionsUrl,
  materializedClipUrl,
} from "./clipPreview";

export type PlaybackInfo = {
  provider: "local" | "mux";
  playback_id: string | null;
  playback_url: string;
  delivery_asset_id: string | null;
};

type ProviderVideoProps = {
  playback: PlaybackInfo;
  pipelineBaseUrl: string;
  videoId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  viewerId?: string | null;
  onClipComplete?: (watchedSeconds: number) => void;
  clipId?: string;
  clipMaterializationStatus?: "source_reference" | "processing" | "ready" | "failed";
};

export function ProviderVideo({
  playback,
  pipelineBaseUrl,
  videoId,
  title,
  startSeconds,
  endSeconds,
  viewerId,
  onClipComplete,
  clipId,
  clipMaterializationStatus = "source_reference",
}: ProviderVideoProps) {
  const materializedClipId =
    playback.provider === "local" && clipMaterializationStatus === "ready"
      ? clipId ?? null
      : null;
  const usesMaterializedClip = materializedClipId !== null;
  const effectiveStartSeconds = usesMaterializedClip ? 0 : startSeconds;
  const effectiveEndSeconds = usesMaterializedClip
    ? Math.max(0, endSeconds - startSeconds)
    : endSeconds;
  const captions = usesMaterializedClip
    ? materializedClipCaptionsUrl(pipelineBaseUrl, materializedClipId)
    : `${pipelineBaseUrl}/videos/${videoId}/captions.vtt`;
  const stopAtBoundary = (player: HTMLVideoElement) => {
    if (player.currentTime < effectiveEndSeconds) return;
    player.pause();
    onClipComplete?.(Math.max(0, endSeconds - startSeconds));
  };

  if (playback.provider === "mux" && playback.playback_id) {
    return (
      <MuxPlayer
        aria-label={title}
        className="clipPreview"
        metadata={{
          video_id: videoId,
          video_title: title,
          viewer_user_id: viewerId ?? "instructor-preview",
        }}
        playbackId={playback.playback_id}
        startTime={startSeconds}
        streamType="on-demand"
        onTimeUpdate={(event) => stopAtBoundary(event.currentTarget as HTMLVideoElement)}
      >
        <track default kind="captions" label="English" src={captions} srcLang="en" />
      </MuxPlayer>
    );
  }

  return (
    <video
      aria-label={title}
      className="clipPreview"
      controls
      data-materialized-clip={usesMaterializedClip ? "true" : "false"}
      preload="metadata"
      src={usesMaterializedClip
        ? materializedClipUrl(pipelineBaseUrl, materializedClipId)
        : clipPreviewUrl(pipelineBaseUrl, videoId, {
            start_seconds: effectiveStartSeconds,
            end_seconds: effectiveEndSeconds,
          })}
      onTimeUpdate={(event) => stopAtBoundary(event.currentTarget)}
    >
      <track default kind="captions" label="English" src={captions} srcLang="en" />
    </video>
  );
}
