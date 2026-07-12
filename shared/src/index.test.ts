import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./index";

describe("healthResponseSchema", () => {
  it("accepts the shared health payload shape", () => {
    expect(
      healthResponseSchema.parse({ service: "web", status: "ok" }),
    ).toEqual({ service: "web", status: "ok" });
  });
});
