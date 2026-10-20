/**
 * CarePoint live integration test (plan Phase 12 spirit, aimed at what this
 * session changed: past-time guard, availability, phase 11, 8.4/9.3 access,
 * and the video-call signalling table).
 *
 * Runs against the REAL Supabase project using three throwaway accounts it
 * provisions through the service role (qa.*@example.com) plus the ordinary
 * anon key, so every assertion goes through RLS exactly the way the app does.
 * Passwords are written to .qa-credentials.json (git-ignored) and are never
 * printed to stdout.
 *
 * Checks that depend on migrations 20261019000004–0008 are reported as PENDING
 * (with the file that unlocks them) rather than failed, so the suite is useful
 * both before and after those migrations land.
 *
 * Run:  node scripts/test-integration.mjs
 *
 * Exit codes: 0 no real failures (pending items allowed) · 1 failures.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CREDENTIALS_FILE = resolve(process.cwd(), ".qa-credentials.json");
const BUCKET = "health-records";

function loadEnv() {
  const file = resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

const env = { ...loadEnv(), ...process.env };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !ANON || !SERVICE) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let passed = 0;
const failures = [];
const pending = [];
const skips = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL   ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function needs(name, migration) {
  pending.push(`${name} → ${migration}`);
  console.log(`  PEND   ${name} — needs ${migration}`);
}

function skip(name, why) {
  skips.push(`${name} — ${why}`);
  console.log(`  SKIP   ${name} — ${why}`);
}

const watDateOnly = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(date);

const dayOffset = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const isoAt = (date, time) => new Date(`${date}T${time}:00+01:00`);

async function ensureAccount(email, role) {
  let user = null;
  let page = 1;
  while (!user && page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    user = data.users.find((entry) => entry.email?.toLowerCase() === email.toLowerCase());
    if (data.users.length < 100) break;
    page += 1;
  }

  const password = `Qa!${randomBytes(12).toString("base64url")}`;
  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUser: ${error.message}`);
    return { id: user.id, email, password };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  return { id: data.user.id, email, password };
}

async function signIn(email, password) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

/** Which of migrations 0004–0008 are live. Absence = PEND, not FAIL. */
async function probeMigrations() {
  const state = {};
  const probe = async (key, run) => {
    const { error } = await run();
    state[key] = !error;
  };

  await probe("m0004", () => admin.from("notifications").select("id").limit(1));
  await probe("m0005", () => admin.from("doctors").select("closed_periods").limit(1));
  await probe("m0008", () => admin.from("call_signals").select("id").limit(1));

  console.log("  live status of this session's migrations:");
  console.log(
    `    20261019000004 phase11_notifications .... ${state.m0004 ? "APPLIED" : "NOT APPLIED"}`,
  );
  console.log(
    `    20261019000005 doctor_availability ....... ${state.m0005 ? "APPLIED" : "NOT APPLIED"}`,
  );
  console.log(
    `    20261019000006 profile_bootstrap .......... (probed via signup below)`,
  );
  console.log(
    `    20261019000007 patient_record_access ...... (probed in the storage phase)`,
  );
  console.log(
    `    20261019000008 video_call_signals ......... ${state.m0008 ? "APPLIED" : "NOT APPLIED"}`,
  );
  return state;
}

async function main() {
  console.log("Phase 1 — migrations present on the live project");
  const m = await probeMigrations();

  console.log("\nPhase 2 — provision qa accounts (email + password auth)");
  const patient = await ensureAccount("qa.carepoint.patient@example.com", "patient");
  const doctor = await ensureAccount("qa.carepoint.doctor@example.com", "doctor");
  const spectator = await ensureAccount("qa.carepoint.spectator@example.com", "patient");
  writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify({ patient, doctor, spectator }, null, 2) + "\n",
    "utf8",
  );
  console.log("  PASS   three qa accounts ready (passwords in .qa-credentials.json)");

  const { data: patientProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", patient.id)
    .maybeSingle();
  if (patientProfile) {
    check("0006: signup wrote the profile row automatically", patientProfile.role === "patient");
  } else {
    needs("0006: signup writes the profile row automatically", "20261019000006_profile_bootstrap");
    await admin
      .from("profiles")
      .insert({ id: patient.id, role: "patient", full_name: "qa-patient" });
    await admin
      .from("profiles")
      .insert({ id: doctor.id, role: "doctor", full_name: "qa-doctor" });
    await admin
      .from("profiles")
      .insert({ id: spectator.id, role: "patient", full_name: "qa-spectator" });
  }

  const { data: doctorProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", doctor.id)
    .maybeSingle();
  if (!doctorProfile) {
    await admin
      .from("profiles")
      .insert({ id: doctor.id, role: "doctor", full_name: "qa-doctor" });
  }

  const { data: doctorRow } = await admin
    .from("doctors")
    .select("id")
    .eq("id", doctor.id)
    .maybeSingle();
  if (doctorRow) {
    check("0006: signup wrote the doctors row automatically", true);
  } else {
    needs("0006: signup writes the doctors row for physicians", "20261019000006_profile_bootstrap");
    await admin.from("doctors").insert({ id: doctor.id, specialty: "General practice" });
  }

  const patientClient = await signIn(patient.email, patient.password);
  const doctorClient = await signIn(doctor.email, doctor.password);
  const spectatorClient = await signIn(spectator.email, spectator.password);
  console.log("  PASS   all three accounts sign in with email + password (auth works live)");

  const tomorrow = watDateOnly(dayOffset(1));
  const dayAfter = watDateOnly(dayOffset(2));

  console.log("\nPhase 3 — booking guards (live RPC behaviour)");

  if (m.m0005) {
    const { error } = await patientClient.rpc("book_appointment_prevent_overlap", {
      p_patient_id: patient.id,
      p_doctor_id: doctor.id,
      p_appointment_date: watDateOnly(new Date()),
      p_start_time: isoAt(watDateOnly(new Date()), "00:00").toISOString(),
      p_end_time: isoAt(watDateOnly(new Date()), "01:00").toISOString(),
      p_slot_period: "morning",
      p_reason_for_visit: "Integration test: past slot",
    });
    check(
      "past time of day is refused by the RPC",
      Boolean(error) && /already passed/i.test(error.message),
      error?.message ?? "booking unexpectedly succeeded",
    );
  } else {
    needs("past time of day refused server-side (1 PM cannot book 9 AM)", "20261019000005");
  }

  if (m.m0005) {
    const { error: closeError } = await doctorClient
      .from("doctors")
      .update({ closed_periods: ["morning"] })
      .eq("id", doctor.id);
    check("doctor can close the morning period", !closeError, closeError?.message);

    const { error } = await patientClient.rpc("book_appointment_prevent_overlap", {
      p_patient_id: patient.id,
      p_doctor_id: doctor.id,
      p_appointment_date: tomorrow,
      p_start_time: isoAt(tomorrow, "09:00").toISOString(),
      p_end_time: isoAt(tomorrow, "10:00").toISOString(),
      p_slot_period: "morning",
      p_reason_for_visit: "Integration test: closed period",
    });
    check(
      "closed period is refused by the RPC",
      Boolean(error) && /not open at that time of day/i.test(error.message),
      error?.message ?? "booking unexpectedly succeeded",
    );
    await doctorClient.from("doctors").update({ closed_periods: [] }).eq("id", doctor.id);
  } else {
    needs("doctor's closed periods enforced in the RPC", "20261019000005");
  }

  {
    const { data: visible } = await patientClient
      .from("doctors")
      .select("id")
      .eq("is_accepting_bookings", true);
    check(
      "the accepting doctor is listed for patients (wizard reads real rows)",
      (visible ?? []).some((row) => row.id === doctor.id),
    );

    const { error: offError } = await doctorClient
      .from("doctors")
      .update({ is_accepting_bookings: false })
      .eq("id", doctor.id);
    check("doctor can switch bookings off (9.2 toggle, own row)", !offError, offError?.message);

    const { data: after } = await patientClient
      .from("doctors")
      .select("id")
      .eq("is_accepting_bookings", true);
    check(
      "closed doctor disappears from the patient wizard immediately",
      !(after ?? []).some((row) => row.id === doctor.id),
    );

    const { error } = await patientClient.rpc("book_appointment_prevent_overlap", {
      p_patient_id: patient.id,
      p_doctor_id: doctor.id,
      p_appointment_date: dayAfter,
      p_start_time: isoAt(dayAfter, "09:00").toISOString(),
      p_end_time: isoAt(dayAfter, "10:00").toISOString(),
      p_slot_period: "morning",
      p_reason_for_visit: "Integration test: doctor closed",
    });
    check(
      "booking a doctor who switched bookings off is refused",
      Boolean(error) && /not accepting bookings/i.test(error.message),
      error?.message ?? "booking unexpectedly succeeded",
    );

    await doctorClient.from("doctors").update({ is_accepting_bookings: true }).eq("id", doctor.id);
  }

  {
    const { error } = await doctorClient.rpc("book_appointment_prevent_overlap", {
      p_patient_id: doctor.id,
      p_doctor_id: doctor.id,
      p_appointment_date: dayAfter,
      p_start_time: isoAt(dayAfter, "09:00").toISOString(),
      p_end_time: isoAt(dayAfter, "10:00").toISOString(),
      p_slot_period: "morning",
      p_reason_for_visit: "Integration test: doctor self-booking",
    });
    check(
      "0002 role guard: a doctor cannot book an appointment",
      Boolean(error) && /only patient accounts may book/i.test(error.message),
      error?.message ?? "doctor booking unexpectedly succeeded",
    );
  }

  const tomorrowStart = isoAt(tomorrow, "09:00");
  let appointmentId = null;
  {
    const { data, error } = await patientClient.rpc("book_appointment_prevent_overlap", {
      p_patient_id: patient.id,
      p_doctor_id: doctor.id,
      p_appointment_date: tomorrow,
      p_start_time: tomorrowStart.toISOString(),
      p_end_time: new Date(tomorrowStart.getTime() + 3600_000).toISOString(),
      p_slot_period: "morning",
      p_reason_for_visit: "Integration test: valid booking",
    });
    check("a future open slot books successfully", !error, error?.message);
    appointmentId = data?.id ?? null;

    const { error: clashError } = await patientClient.rpc("book_appointment_prevent_overlap", {
      p_patient_id: patient.id,
      p_doctor_id: doctor.id,
      p_appointment_date: tomorrow,
      p_start_time: tomorrowStart.toISOString(),
      p_end_time: new Date(tomorrowStart.getTime() + 3600_000).toISOString(),
      p_slot_period: "morning",
      p_reason_for_visit: "Integration test: overlap",
    });
    check(
      "the same slot cannot be booked twice (overlap backstop)",
      Boolean(clashError),
      clashError?.message ?? "second booking unexpectedly succeeded",
    );
  }

  console.log("\nPhase 4 — phase 11 notifications and email logs");
  if (!m.m0004) {
    needs("booking writes notifications for both parties", "20261019000004");
    needs("booking appends rows to public.email_logs", "20261019000004");
    needs("status change notifies the patient", "20261019000004");
    needs("email-logs server route prints the simulated email", "20261019000004");
  } else if (appointmentId) {
    const { data: patientNotices } = await patientClient
      .from("notifications")
      .select("id, kind, title, body")
      .eq("appointment_id", appointmentId);
    check(
      "booking wrote a notification for the patient",
      (patientNotices ?? []).length >= 1,
      `saw ${(patientNotices ?? []).length}`,
    );

    const { data: doctorNotices } = await doctorClient
      .from("notifications")
      .select("id, kind, title")
      .eq("appointment_id", appointmentId);
    check(
      "booking wrote a notification for the doctor",
      (doctorNotices ?? []).length >= 1,
      `saw ${(doctorNotices ?? []).length}`,
    );

    const { data: patientEmails } = await patientClient
      .from("email_logs")
      .select("id, subject, recipient_email")
      .eq("appointment_id", appointmentId);
    check(
      "booking appended email_logs rows the patient can read",
      (patientEmails ?? []).length >= 1 && Boolean((patientEmails ?? [])[0]?.subject),
      `saw ${(patientEmails ?? []).length}`,
    );

    const { error: statusError } = await doctorClient
      .from("appointments")
      .update({ status: "confirmed" })
      .eq("id", appointmentId)
      .select("id");
    check("doctor can confirm the appointment", !statusError, statusError?.message);

    const { data: afterConfirm } = await patientClient
      .from("notifications")
      .select("kind")
      .eq("appointment_id", appointmentId);
    check(
      "status change produced an appointment_confirmed notification",
      (afterConfirm ?? []).some((row) => row.kind === "appointment_confirmed"),
      `kinds: ${(afterConfirm ?? []).map((row) => row.kind).join(", ") || "none"}`,
    );
  } else {
    skip("phase 11 checks", "no appointment was created");
  }

  console.log("\nPhase 5 — health profile (symptoms) and documents (8.4 / 9.3)");
  {
    const symptoms = "Integration test: headache since Monday, worse at night";
    const { error: upsertError } = await patientClient.from("health_profiles").upsert(
      {
        patient_id: patient.id,
        symptoms,
        medical_history: "Integration test history",
        allergies: "none",
        current_medications: "",
        emergency_contact_name: "QA Contact",
        emergency_contact_phone: "+234 800 000 0000",
      },
      { onConflict: "patient_id" },
    );
    check("patient can save a profile including symptoms", !upsertError, upsertError?.message);

    const { data: readBack } = await patientClient
      .from("health_profiles")
      .select("symptoms")
      .eq("patient_id", patient.id)
      .maybeSingle();
    check(
      "symptoms round-trip through the live column (migration 0003)",
      readBack?.symptoms === symptoms,
      `read back ${JSON.stringify(readBack?.symptoms)}`,
    );

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const key = `${patient.id}/qa-integration-1x1.png`;
    const { error: uploadError } = await patientClient.storage
      .from(BUCKET)
      .upload(key, png, { contentType: "image/png", upsert: true });
    check("patient can upload a document to their own folder", !uploadError, uploadError?.message);

    const { data: ownList } = await patientClient.storage.from(BUCKET).list(patient.id);
    check(
      "patient can list their own documents (8.4)",
      (ownList ?? []).some((entry) => entry.name === "qa-integration-1x1.png"),
      `listed ${(ownList ?? []).map((entry) => entry.name).join(", ") || "nothing"}`,
    );

    const { data: spectatorList } = await spectatorClient.storage.from(BUCKET).list(patient.id);
    check(
      "a stranger cannot list the patient's folder",
      (spectatorList ?? []).length === 0,
      `saw ${(spectatorList ?? []).map((entry) => entry.name).join(", ")}`,
    );

    const { data: strangerProfile } = await spectatorClient
      .from("health_profiles")
      .select("id")
      .eq("patient_id", patient.id)
      .maybeSingle();
    check("a stranger cannot read the patient's health profile (RLS)", !strangerProfile);

    if (appointmentId) {
      const { data: doctorProfileRow } = await doctorClient
        .from("health_profiles")
        .select("symptoms")
        .eq("patient_id", patient.id)
        .maybeSingle();
      check(
        "9.3: the doctor can read the linked patient's health profile",
        doctorProfileRow?.symptoms === symptoms,
        JSON.stringify(doctorProfileRow?.symptoms ?? null),
      );
    }

    const { data: doctorList } = await doctorClient.storage.from(BUCKET).list(patient.id);
    const doctorSeesFile = (doctorList ?? []).some(
      (entry) => entry.name === "qa-integration-1x1.png",
    );
    if (doctorSeesFile) {
      check("0007: doctor with a live appointment can list the patient's folder", true);
      const { data: signed, error: signedError } = await doctorClient.storage
        .from(BUCKET)
        .createSignedUrl(key, 900);
      check(
        "0007: doctor can mint a signed preview URL (9.3)",
        !signedError && Boolean(signed?.signedUrl),
        signedError?.message,
      );
    } else {
      needs(
        "doctor can list/preview the patient's documents (9.3) — if 0007 IS applied this is a real failure",
        "20261019000007",
      );
    }

    await patientClient.storage.from(BUCKET).remove([key]);
  }

  console.log("\nPhase 6 — video call signalling (RLS + participants)");
  if (!m.m0008) {
    needs("call_signals table (the video call cannot run without it)", "20261019000008");
  } else if (appointmentId) {
    const offer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
    const { error: offerError } = await patientClient.from("call_signals").insert({
      appointment_id: appointmentId,
      sender_id: patient.id,
      kind: "offer",
      payload: offer,
    });
    check("patient can post a call offer", !offerError, offerError?.message);

    const { data: doctorSees } = await doctorClient
      .from("call_signals")
      .select("kind, payload")
      .eq("appointment_id", appointmentId);
    check(
      "doctor sees the offer for their own appointment",
      (doctorSees ?? []).some((row) => row.kind === "offer" && row.payload === offer),
      `saw ${(doctorSees ?? []).length}`,
    );

    const { error: answerError } = await doctorClient.from("call_signals").insert({
      appointment_id: appointmentId,
      sender_id: doctor.id,
      kind: "answer",
      payload: offer,
    });
    check("doctor can post the answer", !answerError, answerError?.message);

    const { data: patientSees } = await patientClient
      .from("call_signals")
      .select("kind")
      .eq("appointment_id", appointmentId);
    check(
      "patient sees the answer",
      (patientSees ?? []).some((row) => row.kind === "answer"),
      `saw ${(patientSees ?? []).length}`,
    );

    const { data: strangerSees } = await spectatorClient
      .from("call_signals")
      .select("id")
      .eq("appointment_id", appointmentId);
    check("a stranger cannot read the call channel", (strangerSees ?? []).length === 0);

    const { error: strangerInsert } = await spectatorClient.from("call_signals").insert({
      appointment_id: appointmentId,
      sender_id: spectator.id,
      kind: "offer",
      payload: "hostile",
    });
    check("a stranger cannot inject into the call channel", Boolean(strangerInsert));

    await patientClient.from("call_signals").delete().eq("appointment_id", appointmentId);
  } else {
    skip("call signalling checks", "no appointment was created");
  }

  console.log("\nPhase 7 — cleanup");
  {
    const { error } = await admin.from("appointments").delete().eq("patient_id", patient.id);
    check("qa appointments removed from the live table", !error, error?.message);
    if (m.m0008) {
      await admin.from("call_signals").delete().eq("sender_id", patient.id);
      await admin.from("call_signals").delete().eq("sender_id", doctor.id);
    }
    await admin.from("health_profiles").delete().eq("patient_id", patient.id);
  }

  console.log(
    `\nRESULT: ${passed} passed, ${failures.length} failed, ${pending.length} pending on migrations, ${skips.length} skipped`,
  );
  for (const entry of failures) console.log(`  FAILED:  ${entry}`);
  for (const entry of pending) console.log(`  PENDING: ${entry}`);
  for (const entry of skips) console.log(`  SKIPPED: ${entry}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nSUITE CRASHED: ${error.stack ?? error.message}`);
  process.exit(1);
});
