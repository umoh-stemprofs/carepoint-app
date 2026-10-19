import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 02 stub: browser-side Supabase client.
 *
 * Created lazily inside a function so no configuration is evaluated at module
 * load time. Cookie-based session transport via `@supabase/ssr` lands in
 * Phase 06 alongside the auth flow.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.",
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
