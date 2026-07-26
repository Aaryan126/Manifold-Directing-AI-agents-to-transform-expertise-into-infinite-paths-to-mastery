"use client";

import MuxPlayer from "@mux/mux-player-react";
import { useEffect, useRef } from "react";
import {
  clipPlaybackElapsedSeconds,
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
  const videoFrameId = useRef<number | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const completionReported = useRef(false);
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
  const playbackTimeline =
    usesMaterializedClip || usesMuxClip ? "clip_relative" : "asset_relative";
  const captionClipId = materializedClipId ?? (usesMuxClip ? clipId : null);
  const captions = captionClipId
    ? materializedClipCaptionsUrl(pipelineBaseUrl, captionClipId)
    : `${pipelineBaseUrl}/videos/${videoId}/captions.vtt`;
  const stopAtBoundary = (player: HTMLVideoElement) => {
    if (player.currentTime < effectiveEndSeconds) return;
    player.pause();
    if (!completionReported.current) {
      completionReported.current = true;
      onClipComplete?.(Math.max(0, endSeconds - startSeconds));
    }
  };
  const stopPreciseClock = () => {
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
  };
  const stopVideoFrameClock = (player: HTMLVideoElement) => {
    const framePlayer = player as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (
      videoFrameId.current !== null
      && typeof framePlayer.cancelVideoFrameCallback === "function"
    ) {
      framePlayer.cancelVideoFrameCallback(videoFrameId.current);
      videoFrameId.current = null;
    }
    stopPreciseClock();
  };
  const startVideoFrameClock = (player: HTMLVideoElement) => {
    stopVideoFrameClock(player);
    const framePlayer = player as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        callback: VideoFrameRequestCallback,
      ) => number;
    };
    if (typeof framePlayer.requestVideoFrameCallback === "function") {
      const tick = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        reportPlaybackTime(metadata.mediaTime);
        stopAtBoundary(player);
        if (!player.paused && !player.ended) {
          videoFrameId.current = framePlayer.requestVideoFrameCallback?.(tick) ?? null;
        }
      };
      videoFrameId.current = framePlayer.requestVideoFrameCallback(tick);
      return;
    }
    const tick = () => {
      reportPlaybackTime(player.currentTime);
      stopAtBoundary(player);
      if (!player.paused && !player.ended) {
        animationFrameId.current = requestAnimationFrame(tick);
      }
    };
    animationFrameId.current = requestAnimationFrame(tick);
  };
  const startMuxClock = (player: { currentTime?: number; paused?: boolean }) => {
    stopPreciseClock();
    const tick = () => {
      if (typeof player.currentTime === "number") reportPlaybackTime(player.currentTime);
      if (!player.paused) animationFrameId.current = requestAnimationFrame(tick);
    };
    animationFrameId.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    completionReported.current = false;
    return () => {
      if (animationFrameId.current !== null) cancelAnimationFrame(animationFrameId.current);
    };
  }, [clipId, videoId, startSeconds, endSeconds]);
  const reportPlaybackTime = (currentTime: number) => {
    onPlaybackTimeUpdate?.(clipPlaybackElapsedSeconds(
      currentTime,
      { start_seconds: startSeconds, end_seconds: endSeconds },
      playbackTimeline,
    ));
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
        onEnded={() => {
          stopPreciseClock();
          if (!completionReported.current) {
            completionReported.current = true;
            onClipComplete?.(bounds.defaultDuration);
          }
        }}
        onPause={stopPreciseClock}
        onPlay={(event) => {
          startMuxClock(event.currentTarget as unknown as {
            currentTime?: number;
            paused?: boolean;
          });
        }}
        onTimeUpdate={(event) => {
          const currentTime = (event.target as { currentTime?: number } | null)?.currentTime;
          if (typeof currentTime === "number") reportPlaybackTime(currentTime);
        }}
        onSeeked={(event) => {
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
      onPause={(event) => stopVideoFrameClock(event.currentTarget)}
      onPlay={(event) => startVideoFrameClock(event.currentTarget)}
      onSeeked={(event) => reportPlaybackTime(event.currentTarget.currentTime)}
    >
      <track default kind="captions" label="English" src={captions} srcLang="en" />
    </video>
  );
}
