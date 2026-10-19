import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
