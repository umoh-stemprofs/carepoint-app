/**
 * Anti-double-booking concurrency test (plan Phase 12.1).
 *
 * Fires `book_appointment_prevent_overlap` CONCURRENTLY for one doctor, date
 * and time slot, then asserts that exactly one caller wins and the rest are
 * rejected with SQLSTATE 23505.
 *
 * Run it with:
 *   node --experimental-strip-types scripts/test-concurrency.ts
 *
 * Requires, in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   TEST_EMAIL, TEST_PASSWORD   -- a signed-in patient account
 * Optional:
 *   TEST_DOCTOR_ID              -- otherwise the first accepting doctor is used
 *   TEST_DATE, TEST_START_UTC   -- defaults to a far-future slot to avoid clashes
 *
 * Exits 0 only when the assertion holds; exits 1 with a diagnosis otherwise.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CONCURRENCY = 5;
const EXPECTED_SUCCESSES = 1;
const EXPECTED_FAILURES = CONCURRENCY - 1;
const CONFLICT_SQLSTATE = "23505";

function loadEnv(): Record<string, string> {
  const file = resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return {};

  const values: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function fail(reason: string): never {
  console.error(`\nRESULT: FAIL\nREASON: ${reason}\n`);
  process.exit(1);
}

function pass(detail: string): never {
  console.log(`\nRESULT: PASS\n${detail}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  const env = { ...loadEnv(), ...process.env } as Record<string, string | undefined>;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = env.TEST_EMAIL;
  const password = env.TEST_PASSWORD;

  console.log("Step 1/5 — environment");
  if (!url || !anonKey) fail("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing from .env.local");
  if (!email || !password) {
    fail(
      "TEST_EMAIL and TEST_PASSWORD are not set. The RPC asserts auth.uid() = p_patient_id, " +
        "so a signed-in patient account is required — the service role key cannot be used.",
    );
  }

  console.log("Step 2/5 — sign in");
  const client: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: password as string,
  });

  if (signInError || !session.user) {
    fail(`Sign-in failed: ${signInError?.message ?? "no user returned"}`);
  }
  const patientId = session.user.id;
  console.log(`  signed in as ${patientId}`);

  console.log("Step 3/5 — pick doctor and slot");
  const doctorId = env.TEST_DOCTOR_ID;
  let chosenDoctor = doctorId;

  if (!chosenDoctor) {
    const { data: doctors, error: doctorError } = await client
      .from("doctors")
      .select("id")
      .eq("is_accepting_bookings", true)
      .limit(1);

    if (doctorError) {
      fail(
        `Could not read the doctors table (${doctorError.message}). ` +
          "The Phase 05 migration has not been applied yet.",
      );
    }
    chosenDoctor = doctors?.[0]?.id;
    if (!chosenDoctor) fail("No accepting doctor found. Seed the doctors table first.");
  }

  const date = env.TEST_DATE ?? "2027-06-15";
  const startUtc = env.TEST_START_UTC ?? "2027-06-15T09:00:00.000Z";
  const endUtc = env.TEST_END_UTC ?? "2027-06-15T10:00:00.000Z";

  console.log(`  doctor=${chosenDoctor}`);
  console.log(`  slot=${date} ${startUtc} → ${endUtc}`);

  const args = {
    p_patient_id: patientId,
    p_doctor_id: chosenDoctor,
    p_appointment_date: date,
    p_start_time: startUtc,
    p_end_time: endUtc,
    p_slot_period: "morning",
    p_reason_for_visit: "Concurrency test booking",
  } as const;

  console.log(`Step 4/5 — firing ${CONCURRENCY} simultaneous calls`);
  const settled = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () =>
      client.rpc("book_appointment_prevent_overlap", args),
    ),
  );

  let successes = 0;
  const codes: string[] = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      codes.push("rejected");
      console.log(`  [${index + 1}] transport rejection: ${String(outcome.reason)}`);
      return;
    }

    const { data, error } = outcome.value;
    if (!error) {
      successes += 1;
      codes.push("ok");
      console.log(`  [${index + 1}] SUCCESS id=${(data as { id?: string } | null)?.id ?? "?"}`);
      return;
    }

    const code = (error as { code?: string }).code ?? "none";
    codes.push(code);
    console.log(`  [${index + 1}] FAILED code=${code} message=${error.message}`);
  });

  console.log("Step 5/5 — assertion");
  console.log(`  successes=${successes} (expected ${EXPECTED_SUCCESSES})`);
  console.log(`  codes=${codes.join(", ")}`);

  if (codes.includes("PGRST202")) {
    fail(
      "The book_appointment_prevent_overlap function does not exist. " +
        "Apply supabase/migrations/20261019000000_initial_schema.sql first.",
    );
  }

  const conflictFailures = codes.filter((code) => code === CONFLICT_SQLSTATE).length;

  if (successes !== EXPECTED_SUCCESSES) {
    fail(
      successes === 0
        ? `All ${CONCURRENCY} calls failed. ${conflictFailures} hit ${CONFLICT_SQLSTATE}, ` +
            "which usually means this slot was already booked by an earlier run — pick a fresh TEST_START_UTC."
        : `${successes} callers succeeded; expected exactly ${EXPECTED_SUCCESSES}. ` +
            "The atomic lock did not serialise the concurrent inserts.",
    );
  }

  if (conflictFailures !== EXPECTED_FAILURES) {
    fail(
      `Expected ${EXPECTED_FAILURES} failures with SQLSTATE ${CONFLICT_SQLSTATE}, got ${conflictFailures}.`,
    );
  }

  pass(
    `Exactly ${EXPECTED_SUCCESSES}/${CONCURRENCY} concurrent bookings succeeded and ` +
      `${conflictFailures} were rejected with ${CONFLICT_SQLSTATE} (unique_violation).`,
  );
}

main().catch((error: unknown) => {
  fail(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
});
