import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

/**
 * Phase 02 stub: server-side Supabase client for route handlers and server
 * components.
 *
 * Uses the service role key with session persistence disabled, which is the
 * correct shape for privileged server work. Reading the caller's cookie
 * session and scoping queries through Row Level Security is added in
 * Phase 05/Phase 06.
 *
 * Never expose this client to the browser: the service role key bypasses
 * every Row Level Security policy.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cookie-scoped Supabase client for React Server Components.
 *
 * Unlike createSupabaseServerClient this one carries the signed-in user's
 * session, so every query it runs is subject to Row Level Security as that
 * user. Use it whenever a server component renders data belonging to the
 * person looking at the page.
 *
 * The cookie adapter is written through the response returned by the caller's
 * request so refreshes actually persist; that is why this is async.
 */
export async function createSupabaseRscClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
