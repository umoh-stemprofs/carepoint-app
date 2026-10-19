"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthState = {
  email: string | null;
  role: string | null;
};

function roleFrom(metadata: unknown): string | null {
  const role = (metadata as { role?: unknown } | undefined)?.role;
  return typeof role === "string" ? role : null;
}

/**
 * Shared navigation header: CarePoint brand, an optional section label, and the
 * signed-in status with a logout control (plan Phase 06).
 *
 * Starts signed-out and updates from the auth subscription. Every setState runs
 * inside a promise callback, and a missing/failed configuration simply leaves
 * the header signed out — it never throws and never crashes the page.
 */
export default function Topbar({ label }: { label?: string }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ email: null, role: null });

  useEffect(() => {
    let cancelled = false;

    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) {
      // No configuration: keep the signed-out header, do nothing else.
      return;
    }

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setAuth({
          email: data.user?.email ?? null,
          role: roleFrom(data.user?.user_metadata),
        });
      })
      .catch(() => {
        // Network failure: remain signed out, which is the safe default.
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setAuth({
        email: session?.user?.email ?? null,
        role: roleFrom(session?.user?.user_metadata),
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    const supabase = tryCreateSupabaseBrowserClient();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Clearing a stale session may fail offline; still return to home.
      }
    }
    router.push("/");
    router.refresh();
  }

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          +
        </span>
        <span>CarePoint</span>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {label ? <span className="service-label">{label}</span> : null}

        {auth.email ? (
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="service-label">
              {auth.email}
              {auth.role ? ` · ${auth.role}` : ""}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="service-label"
              style={{
                background: "none",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
                color: "var(--foreground)",
                minHeight: 40,
              }}
            >
              Log out
            </button>
          </span>
        ) : (
          <Link className="service-label" href="/login" style={{ textDecoration: "none" }}>
            LOG IN
          </Link>
        )}
      </div>
    </header>
  );
}
