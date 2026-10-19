import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guards (plan Phase 06, decision D1).
 *
 * Supabase is the single source of truth for the session; the role used for the
 * doctor/patient split is read from the authenticated user's metadata.
 */

/** Send a signed-out visitor to the login screen, remembering where they were headed. */
function toSignIn(request: NextRequest, attemptedPath: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = attemptedPath ? `?redirect=${encodeURIComponent(attemptedPath)}` : "";
  return NextResponse.redirect(url);
}

function roleOf(userMetadata: unknown): string | undefined {
  const role = (userMetadata as { role?: unknown } | undefined)?.role;
  return typeof role === "string" ? role : undefined;
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
    const url = request.nextUrl.clone();
    url.pathname = roleOf(user.user_metadata) === "doctor" ? "/dashboard" : "/book";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user) {
    return toSignIn(request, pathname);
  }

  // /dashboard is physician-only; anyone else goes back to login.
  if (pathname === "/dashboard" && roleOf(user.user_metadata) !== "doctor") {
    return toSignIn(request, pathname);
  }

  return supabaseResponse;
}

export const config = {
  // An explicit allow-list: static assets (/_next/, /favicon.ico, /assets/) and
  // the public landing page are never evaluated by this middleware.
  matcher: ["/book", "/appointments", "/dashboard", "/login", "/health-profile"],
};
