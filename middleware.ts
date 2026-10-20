import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guards (plan Phase 06, decision D1).
 *
 * Supabase is the single source of truth for the session. The role used for the
 * doctor/patient split is read from user metadata, falling back to the
 * public.profiles row when metadata is silent.
 *
 * `user_metadata` is not an authority: a signed-in user can edit their own
 * metadata through the auth API, so it only ever *short-circuits* a lookup —
 * it can promote nobody. The profiles row decides, and the booking RPC checks
 * the same column again at the database.
 */

/** Send a signed-out visitor to the login screen, remembering where they were headed. */
function toSignIn(request: NextRequest, attemptedPath: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = attemptedPath ? `?redirect=${encodeURIComponent(attemptedPath)}` : "";
  return NextResponse.redirect(url);
}

/** Send a signed-in visitor to a route, discarding the query string. */
function toRoute(request: NextRequest, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

function roleOf(userMetadata: unknown): string | undefined {
  const role = (userMetadata as { role?: unknown } | undefined)?.role;
  return typeof role === "string" ? role : undefined;
}

/**
 * `"doctor"` only when the account really is one.
 *
 * Anything unknown — no metadata, no profile row, a failed read — resolves to
 * "patient", which keeps /book open for the account that has a booking to make
 * and keeps /dashboard shut to everyone the app has not confirmed as a doctor.
 */
async function roleFor(
  supabase: SupabaseClient,
  user: { id: string; user_metadata: unknown },
): Promise<string> {
  const fromMetadata = roleOf(user.user_metadata);
  if (fromMetadata) return fromMetadata;

  try {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const fromProfile = roleOf(data);
    if (fromProfile) return fromProfile;
  } catch {
    // A failed read must not throw a 500 on every request; fall through.
  }

  return "patient";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed. With Supabase unconfigured every visitor is treated as signed
  // out, which keeps the guards meaningful instead of throwing a 500 per route.
  if (!supabaseUrl || !supabaseAnonKey) {
    return pathname === "/login" ? NextResponse.next() : toSignIn(request, pathname);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the JWT against Supabase rather than trusting the
  // cookie payload, so a forged or expired cookie cannot pass the guard.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname === "/login") {
    if (!user) {
      return supabaseResponse;
    }
    const role = await roleFor(supabase, user);
    return toRoute(request, role === "doctor" ? "/dashboard" : "/book");
  }

  if (!user) {
    return toSignIn(request, pathname);
  }

  const role = await roleFor(supabase, user);

  // /dashboard is physician-only; a patient who lands there belongs in the
  // booking wizard, not back at the login screen they just came from.
  if (pathname === "/dashboard") {
    if (role === "doctor") {
      return supabaseResponse;
    }
    return toRoute(request, "/book");
  }

  // The wizard and the schedule are patient screens. A doctor sent here would
  // be bounced by the booking RPC anyway — better not to show them four steps
  // of a form whose final button cannot succeed.
  if ((pathname === "/book" || pathname === "/appointments") && role === "doctor") {
    return toRoute(request, "/dashboard");
  }

  return supabaseResponse;
}

export const config = {
  // An explicit allow-list: static assets (/_next/, /favicon.ico, /assets/) and
  // the public landing page are never evaluated by this middleware.
  matcher: ["/book", "/appointments", "/dashboard", "/login", "/health-profile"],
};
