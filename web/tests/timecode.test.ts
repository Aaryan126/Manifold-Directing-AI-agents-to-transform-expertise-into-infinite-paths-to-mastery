import { describe, expect, it } from "vitest";

import { formatTimecode, parseTimecode } from "../app/timecode";

describe("editable timecodes", () => {
  it("formats seconds as readable minute and hour timecodes", () => {
    expect(formatTimecode(551.28)).toBe("9:11");
    expect(formatTimecode(3723)).toBe("1:02:03");
  });

  it("parses minute and hour timecodes back to seconds", () => {
    expect(parseTimecode("9:11")).toBe(551);
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("90")).toBe(90);
  });

  it("rejects malformed timecodes", () => {
    expect(parseTimecode("9:75")).toBeNull();
    expect(parseTimecode("1:62:03")).toBeNull();
    expect(parseTimecode("later")).toBeNull();
  });
});
