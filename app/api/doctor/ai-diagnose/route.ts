import { NextResponse } from "next/server";

/**
 * Phase 10 stub for the DeepSeek clinical decision support endpoint.
 *
 * Returns a 200 JSON response until the doctor-only session check, PII
 * sanitisation, rate limiting (20 queries per doctor per day) and the
 * structured differential-diagnosis prompt are implemented.
 */
const STUB_BODY = {
  stub: true,
  provider: "deepseek",
  model: process.env.DEEPSEEK_MODEL_NAME || "deepseek-chat",
  message: "AI diagnostic assistance is not wired up yet. Phase 10 replaces this stub.",
  diagnosis: [],
  recommendedTests: [],
  redFlags: [],
};

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(STUB_BODY, { status: 200 });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { ...STUB_BODY, method: "GET", message: "Stub is alive. Use POST for diagnostics." },
    { status: 200 },
  );
}
