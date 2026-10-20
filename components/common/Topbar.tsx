"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import Icon from "@/components/common/Icon";
import NotificationBell from "@/components/common/NotificationBell";
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
  const pathname = usePathname();
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
    <header className="flex min-h-20 w-full items-center justify-between gap-space-xs border-b-2 border-surface-container-high px-margin py-space-sm">
      <Link className="flex min-w-0 items-center gap-3 no-underline" href="/">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-tactile-sm"
          aria-hidden="true"
        >
          <Icon name="health_and_safety" size={30} />
        </span>
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-headline-lg-mobile text-on-surface">CarePoint</span>
          {/* The section label is a desktop affordance. Truncating it to
              "TELEHE..." on a phone reads as a broken screen to exactly the
              user this design targets, so it is simply absent below sm. */}
          <span className="mt-1 hidden min-w-0 items-center gap-1.5 text-label-lg text-primary sm:flex">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
            <span className="truncate">{label ?? "See a doctor"}</span>
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-3">
        {/* Plan 11.4: the notification inbox. Renders nothing when signed out. */}
        <NotificationBell />
        {auth.email ? (
          <span className="flex items-center justify-end gap-3">
            <span className="hidden max-w-56 truncate text-label-lg text-on-surface-variant sm:block">
              {auth.email}
              {auth.role ? ` · ${auth.role}` : ""}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex min-h-12 items-center gap-2 rounded-lg border-2 border-on-surface bg-white px-space-sm text-label-lg text-on-surface press"
            >
              <Icon name="logout" size={24} />
              Log out
            </button>
          </span>
        ) : pathname === "/login" ? null : (
          <Link
            className="flex min-h-12 items-center gap-2 rounded-lg bg-primary px-space-sm text-label-lg text-white no-underline press"
            href="/login"
          >
            <Icon name="login" size={24} />
            LOG IN
          </Link>
        )}
      </div>
    </header>
  );
}
