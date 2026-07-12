import { healthResponseSchema } from "@coursefoundry/shared";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    healthResponseSchema.parse({ service: "web", status: "ok" }),
  );
}
