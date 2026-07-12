"use client";

import MuxPlayer from "@mux/mux-player-react";
import { clipPreviewUrl } from "./clipPreview";

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
}: ProviderVideoProps) {
  const captions = `${pipelineBaseUrl}/videos/${videoId}/captions.vtt`;
  const stopAtBoundary = (player: HTMLVideoElement) => {
    if (player.currentTime < endSeconds) return;
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
      preload="metadata"
      src={clipPreviewUrl(pipelineBaseUrl, videoId, {
        start_seconds: startSeconds,
        end_seconds: endSeconds,
      })}
      onTimeUpdate={(event) => stopAtBoundary(event.currentTarget)}
    >
      <track default kind="captions" label="English" src={captions} srcLang="en" />
    </video>
  );
}
