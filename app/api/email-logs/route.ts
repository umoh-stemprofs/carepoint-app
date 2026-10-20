import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { logEmailToServerConsole, type EmailLogRow } from "@/lib/services/emailSimulator";

/**
 * Plan 11.2 — print the simulated booking email to the server console.
 *
 * The rows themselves are written by the database trigger the moment an
 * appointment is created or its status changes, so the record exists even if
 * this request never happens. This route is the console half: the patient's
 * client POSTs the appointment id right after a successful booking and the
 * server formats what the trigger logged.
 *
 * Authorisation is the caller's own access token, and the Supabase client is
 * built with that token — so the RLS policy on `email_logs` is what scopes the
 * read, exactly as it would in the browser. No service role is involved.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return NextResponse.json({ error: "Sign in to read the email log." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session is no longer valid." }, { status: 401 });
  }

  let appointmentId: unknown;
  try {
    const body = (await request.json()) as { appointmentId?: unknown };
    appointmentId = body.appointmentId;
  } catch {
    appointmentId = null;
  }

  if (typeof appointmentId !== "string" || !UUID_PATTERN.test(appointmentId)) {
    return NextResponse.json({ error: "appointmentId must be a UUID." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("email_logs")
    .select("id, recipient_email, kind, subject, body, sent_at")
    .eq("appointment_id", appointmentId)
    .order("sent_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logEmailToServerConsole((data ?? []) as unknown as EmailLogRow[]);
  return NextResponse.json({ logged: (data ?? []).length });
}
