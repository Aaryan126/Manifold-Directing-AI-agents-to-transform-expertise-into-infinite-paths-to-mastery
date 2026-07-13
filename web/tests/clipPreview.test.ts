import { describe, expect, it } from "vitest";
import {
  clipPreviewUrl,
  materializedClipCaptionsUrl,
  materializedClipUrl,
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
});
