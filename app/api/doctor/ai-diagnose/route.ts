import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cdssRequestSchema, type CDSSInput } from "@/lib/validations/cdss";
import { scrubPII, scrubPIIDeep } from "@/lib/utils/sanitizer";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = 15_000;

/** Plan decision D11: at most 20 diagnostic queries per doctor per day. */
const RATE_LIMIT_PER_DAY = 20;

const DISCLAIMER =
  "AI Clinical Assistance Only — decision rests with the attending doctor.";

const SYSTEM_PROMPT = `You are a clinical decision support assistant working alongside a licensed physician in Nigeria.
You do not prescribe and you do not replace clinical judgement.

Return ONLY valid JSON, with no prose and no markdown fences, matching this shape:
{
  "primaryDiagnosis": { "name": string, "confidence": "low"|"medium"|"high", "rationale": string },
  "differentialDiagnoses": [{ "name": string, "rationale": string }],
  "recommendedTests": [{ "name": string, "purpose": string }],
  "redFlags": [string],
  "contraindications": [string]
}

Rules:
- List at most 3 differential diagnoses, ordered most to least likely.
- Recommend confirmatory tests rather than assuming a diagnosis (for example a malaria RDT or a full blood count).
- Red flags must be warning symptoms that should trigger urgent escalation.
- Consider locally prevalent conditions such as malaria, typhoid, cholera and Lassa fever.
- Base every entry only on the clinical variables supplied; never invent patient history.`;

/**
 * Per-process daily counters keyed by doctor id.
 *
 * In-memory is the documented fallback for this plan: it resets on redeploy and
 * is per-instance, so it throttles a single process rather than the account.
 * When `cdss_logs` exists the audit rows double as a durable count.
 */
const dailyUsage = new Map<string, { day: string; count: number }>();

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function memoryUsage(userId: string): number {
  const entry = dailyUsage.get(userId);
  if (!entry || entry.day !== utcDay()) return 0;
  return entry.count;
}

/**
 * Reserves one unit and returns the post-increment count.
 *
 * Reserve-then-check rather than check-then-record: JavaScript is
 * single-threaded, so N simultaneous requests each reading "19 used" can no
 * longer all slip through the gate before any of them writes.
 */
function reserveUsage(userId: string): number {
  const day = utcDay();
  const entry = dailyUsage.get(userId);
  if (!entry || entry.day !== day) {
    dailyUsage.set(userId, { day, count: 1 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function releaseUsage(userId: string): void {
  const entry = dailyUsage.get(userId);
  if (entry && entry.day === utcDay() && entry.count > 0) {
    entry.count -= 1;
  }
}

/**
 * Durable half of the limit: today's audit rows, when `cdss_logs` exists, so a
 * redeploy does not hand the doctor a brand new quota. Returns null when the
 * Phase 05 migration has not been applied, which leaves memory as the only
 * source of truth.
 */
async function auditUsageToday(
  supabase: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("cdss_logs")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", userId)
    .gte("created_at", `${utcDay()}T00:00:00.000Z`);

  if (error) return null;
  return count ?? 0;
}

type Authed = { userId: string; supabase: SupabaseClient };

/**
 * Reject anything that is not an authenticated physician (plan D11, Phase 10.2).
 * Runs before validation or any model call so an anonymous caller cannot spend
 * API quota or probe the prompt. Both failure modes answer 403, matching the
 * plan's verification gate.
 */
async function requireDoctor(): Promise<Authed | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { ok: false, error: "server_misconfigured" },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called outside a request context where cookies cannot be written.
        }
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    // Plan Phase 10 verification gate: an unauthenticated caller also receives
    // 403 Forbidden (not 401). The body still names the reason so a client can
    // tell "sign in" apart from "signed in as the wrong role".
    return NextResponse.json(
      { ok: false, error: "unauthenticated", message: "Sign in as a doctor to use the assistant." },
      { status: 403 },
    );
  }

  const role = (user.user_metadata as { role?: unknown } | undefined)?.role;
  if (role !== "doctor") {
    // Plan Phase 10 verification gate: patient accounts get 403 Forbidden.
    return NextResponse.json(
      { ok: false, error: "forbidden", message: "This endpoint is restricted to physicians." },
      { status: 403 },
    );
  }

  return { userId: user.id, supabase };
}

function fallbackResult(input: CDSSInput) {
  const hasFever = input.symptoms.some((symptom) => /fever|temperature|hot/i.test(symptom));
  const topDx = hasFever
    ? { name: "Uncomplicated malaria", confidence: "medium" as const }
    : { name: "Undifferentiated illness", confidence: "low" as const };

  return {
    primaryDiagnosis: {
      ...topDx,
      rationale:
        "Generated by the offline fallback because no DeepSeek API key is configured or the upstream call failed.",
    },
    differentialDiagnoses: [
      { name: "Typhoid fever", rationale: "Overlapping fever presentation; confirm with a Widal or blood culture." },
      { name: "Viral upper respiratory infection", rationale: "Common self-limiting differential for fever without localising signs." },
    ],
    recommendedTests: [
      { name: "Malaria rapid diagnostic test", purpose: "Confirm or exclude malaria parasitaemia." },
      { name: "Full blood count", purpose: "Assess for anaemia, leukocytosis or thrombocytopenia." },
    ],
    redFlags: ["Persistent high fever beyond 72 hours", "Altered consciousness", "Inability to keep fluids down"],
    contraindications: ["Verify drug allergies before any antimalarial course"],
  };
}

async function callDeepSeek(input: CDSSInput, model: string) {
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Clinical variables:\n${JSON.stringify(input, null, 2)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek responded with ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek returned an empty completion");
  }

  return JSON.parse(content) as ReturnType<typeof fallbackResult>;
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireDoctor();
  if (auth instanceof NextResponse) return auth;

  const usedToday = Math.max(
    memoryUsage(auth.userId),
    (await auditUsageToday(auth.supabase, auth.userId)) ?? 0,
  );

  if (usedToday >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: `Daily limit of ${RATE_LIMIT_PER_DAY} diagnostic queries reached. Try again tomorrow.`,
        remaining: 0,
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = cdssRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  // Reserve the slot before any network work: see reserveUsage().
  const reserved = reserveUsage(auth.userId);
  if (reserved > RATE_LIMIT_PER_DAY) {
    releaseUsage(auth.userId);
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: `Daily limit of ${RATE_LIMIT_PER_DAY} diagnostic queries reached. Try again tomorrow.`,
        remaining: 0,
      },
      { status: 429 },
    );
  }

  // Strip identifiers before anything leaves the process boundary.
  const scrubbed = scrubPIIDeep({
    ...parsed.data,
    symptoms: parsed.data.symptoms.map((symptom) => scrubPII(symptom)),
    medicalHistory: parsed.data.medicalHistory
      ? scrubPII(parsed.data.medicalHistory)
      : undefined,
  });

  const model = process.env.DEEPSEEK_MODEL_NAME || "deepseek-chat";
  const apiKey = process.env.DEEPSEEK_API_KEY;

  let result: ReturnType<typeof fallbackResult>;
  let source: "deepseek" | "fallback";

  if (!apiKey) {
    result = fallbackResult(scrubbed);
    source = "fallback";
  } else {
    try {
      result = await callDeepSeek(scrubbed, model);
      source = "deepseek";
    } catch {
      // Never fail the doctor's request because an upstream model is down.
      result = fallbackResult(scrubbed);
      source = "fallback";
    }
  }

  const remaining = Math.max(0, RATE_LIMIT_PER_DAY - reserved);

  // Best-effort audit trail (plan Phase 10.5); the table may not exist yet.
  try {
    await auth.supabase.from("cdss_logs").insert({
      doctor_id: auth.userId,
      model: source === "deepseek" ? model : "offline-fallback",
      request_payload: scrubbed,
      response_payload: result,
    });
  } catch {
    // Audit persistence is optional until the Phase 05 migration is applied.
  }

  return NextResponse.json(
    {
      ok: true,
      source,
      model: source === "deepseek" ? model : "offline-fallback",
      scrubbedInput: scrubbed,
      result,
      disclaimer: DISCLAIMER,
      rateLimit: { limit: RATE_LIMIT_PER_DAY, remaining },
    },
    { status: 200 },
  );
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireDoctor();
  if (auth instanceof NextResponse) return auth;

  const usedToday = Math.max(
    memoryUsage(auth.userId),
    (await auditUsageToday(auth.supabase, auth.userId)) ?? 0,
  );
  const remaining = Math.max(0, RATE_LIMIT_PER_DAY - usedToday);

  return NextResponse.json(
    {
      ok: true,
      method: "GET",
      message: "DeepSeek CDSS endpoint is available. POST a cdssRequestSchema payload.",
      rateLimit: { limit: RATE_LIMIT_PER_DAY, remaining },
    },
    { status: 200 },
  );
}
