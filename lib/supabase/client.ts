import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client.
 *
 * Uses `@supabase/ssr` rather than a bare `supabase-js` client so the session
 * is written to **cookies** instead of localStorage. `middleware.ts` reads those
 * cookies to enforce route guards, so a localStorage session would log the user
 * in on screen while every protected route still redirected them to /login.
 *
 * Created lazily inside a function so no configuration is evaluated at module
 * load time.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.",
    );
  }

  return createBrowserClient(url, anonKey);
}

/**
 * Non-throwing variant for components that must render whatever happens.
 *
 * The header sits on every page, so a missing configuration must degrade to
 * the signed-out state instead of crashing the route.
 */
export function tryCreateSupabaseBrowserClient(): SupabaseClient | null {
  try {
    return createSupabaseBrowserClient();
  } catch {
    return null;
  }
}
