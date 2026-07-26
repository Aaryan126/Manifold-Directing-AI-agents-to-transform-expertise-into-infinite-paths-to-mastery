"use client";

import MuxPlayer from "@mux/mux-player-react";
import {
  clipPreviewUrl,
  materializedClipCaptionsUrl,
  materializedClipUrl,
  muxClipPlaybackBounds,
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
  onPlaybackTimeUpdate?: (elapsedSeconds: number) => void;
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
  onPlaybackTimeUpdate,
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
  const usesMuxClip = playback.provider === "mux" && Boolean(playback.playback_id);
  const captionClipId = materializedClipId ?? (usesMuxClip ? clipId : null);
  const captions = captionClipId
    ? materializedClipCaptionsUrl(pipelineBaseUrl, captionClipId)
    : `${pipelineBaseUrl}/videos/${videoId}/captions.vtt`;
  const stopAtBoundary = (player: HTMLVideoElement) => {
    if (player.currentTime < effectiveEndSeconds) return;
    player.pause();
    onClipComplete?.(Math.max(0, endSeconds - startSeconds));
  };
  const reportPlaybackTime = (currentTime: number) => {
    const elapsed = usesMaterializedClip
      ? currentTime
      : currentTime - startSeconds;
    onPlaybackTimeUpdate?.(
      Math.min(
        Math.max(0, endSeconds - startSeconds),
        Math.max(0, elapsed),
      ),
    );
  };

  if (usesMuxClip && playback.playback_id) {
    const bounds = muxClipPlaybackBounds({
      start_seconds: startSeconds,
      end_seconds: endSeconds,
    });
    return (
      <MuxPlayer
        aria-label={title}
        assetEndTime={bounds.assetEndTime}
        assetStartTime={bounds.assetStartTime}
        className="clipPreview"
        data-clip-bounded="true"
        defaultDuration={bounds.defaultDuration}
        metadata={{
          video_id: videoId,
          video_title: title,
          viewer_user_id: viewerId ?? "instructor-preview",
        }}
        playbackId={playback.playback_id}
        streamType="on-demand"
        onEnded={() => onClipComplete?.(bounds.defaultDuration)}
        onTimeUpdate={(event) => {
          const currentTime = (event.target as { currentTime?: number } | null)?.currentTime;
          if (typeof currentTime === "number") reportPlaybackTime(currentTime);
        }}
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
      data-clip-bounded="true"
      data-materialized-clip={usesMaterializedClip ? "true" : "false"}
      preload="metadata"
      src={usesMaterializedClip
        ? materializedClipUrl(pipelineBaseUrl, materializedClipId)
        : clipPreviewUrl(pipelineBaseUrl, videoId, {
            start_seconds: effectiveStartSeconds,
            end_seconds: effectiveEndSeconds,
          })}
      onTimeUpdate={(event) => {
        reportPlaybackTime(event.currentTarget.currentTime);
        stopAtBoundary(event.currentTarget);
      }}
    >
      <track default kind="captions" label="English" src={captions} srcLang="en" />
    </video>
  );
}
