import { describe, expect, it } from "vitest";
import {
  clipPlaybackElapsedSeconds,
  clipPreviewUrl,
  materializedClipCaptionsUrl,
  materializedClipUrl,
  muxClipPlaybackBounds,
} from "../app/clipPreview";

describe("clipPreviewUrl", () => {
  it("passes the stored clip timestamp range to the media fragment", () => {
    expect(
      clipPreviewUrl("http://localhost:8000", "video-1", {
        start_seconds: 962.3,
        end_seconds: 1626.92,
      }),
    ).toBe("http://localhost:8000/videos/video-1/media#t=962.3,1626.92");
  });

  it("builds independent local clip media and caption URLs", () => {
    expect(materializedClipUrl("http://localhost:8000", "clip-1")).toBe(
      "http://localhost:8000/clips/clip-1/media",
    );
    expect(materializedClipCaptionsUrl("http://localhost:8000", "clip-1")).toBe(
      "http://localhost:8000/clips/clip-1/captions.vtt",
    );
  });

  it("turns a source range into a true bounded Mux asset duration", () => {
    expect(muxClipPlaybackBounds({ start_seconds: 120, end_seconds: 180 })).toEqual({
      assetStartTime: 120,
      assetEndTime: 180,
      defaultDuration: 60,
    });
  });

  it("uses clip-relative time for materialized and Mux instant clips", () => {
    const clip = { start_seconds: 309.58, end_seconds: 430.08 };
    expect(clipPlaybackElapsedSeconds(4.2, clip, "clip_relative")).toBe(4.2);
    expect(clipPlaybackElapsedSeconds(309.58, clip, "asset_relative")).toBe(0);
    expect(clipPlaybackElapsedSeconds(313.78, clip, "asset_relative")).toBeCloseTo(4.2);
    expect(clipPlaybackElapsedSeconds(999, clip, "clip_relative")).toBe(120.5);
  });
});
