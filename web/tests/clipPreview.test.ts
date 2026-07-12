import { describe, expect, it } from "vitest";
import { clipPreviewUrl } from "../app/clipPreview";

describe("clipPreviewUrl", () => {
  it("passes the stored clip timestamp range to the media fragment", () => {
    expect(
      clipPreviewUrl("http://localhost:8000", "video-1", {
        start_seconds: 962.3,
        end_seconds: 1626.92,
      }),
    ).toBe("http://localhost:8000/videos/video-1/media#t=962.3,1626.92");
  });
});
