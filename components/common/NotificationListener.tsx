"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "@/components/common/Icon";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat } from "@/lib/utils/datetime";

/**
 * Plan 11.1: real-time toasts for appointment notifications.
 *
 * Subscribes to `public.notifications` inserts for the signed-in user over
 * Supabase Realtime (the table joins `supabase_realtime` in migration 0004),
 * with a slow poll behind it so a dropped websocket — the normal condition on
 * a 2G link — still delivers the message a few seconds later. Rows are
 * de-duplicated by id across both paths, so a subscriber never toasts twice.
 *
 * Mounted once in the root layout; it renders nothing but the toast stack.
 */

type Toast = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

const TOAST_LIFETIME_MS = 8000;
const FALLBACK_POLL_MS = 30000;

export default function NotificationListener() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;

    function present(raw: unknown) {
      const row = raw as
        | { id?: string; title?: string; body?: string; created_at?: string }
        | null;
      if (!row?.id || seenRef.current.has(row.id)) return;
      seenRef.current.add(row.id);

      const toast: Toast = {
        id: row.id,
        title: row.title ?? "CarePoint",
        body: row.body ?? "",
        createdAt: row.created_at ?? new Date().toISOString(),
      };
      setToasts((previous) => [...previous.slice(-2), toast]);
      window.setTimeout(() => dismiss(toast.id), TOAST_LIFETIME_MS);
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let poll: number | null = null;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` },
          (payload) => present(payload.new),
        )
        .subscribe();

      // Fallback polling (plan 12.2): catch anything Realtime misses.
      const fetchRecent = async () => {
        const { data } = await supabase
          .from("notifications")
          .select("id, title, body, created_at")
          .order("created_at", { ascending: false })
          .limit(5);
        if (cancelled || !data) return;
        for (const row of data) present(row);
      };

      void fetchRecent();
      poll = window.setInterval(() => void fetchRecent(), FALLBACK_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (poll) window.clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-3 bottom-3 z-40 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-space-xs"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex items-start gap-space-xs rounded-xl border-2 border-primary bg-primary-fixed p-space-xs shadow-tactile-sm"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white">
            <Icon name="notifications" size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-label-lg text-on-primary-fixed">{toast.title}</p>
            <p className="m-0 text-body-lg break-words text-on-primary-fixed">
              {toast.body}
            </p>
            <p className="m-0 text-label-lg text-on-primary-fixed-variant">
              {formatInWat(toast.createdAt, "h:mm a")} WAT
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(toast.id)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-on-surface press"
          >
            <Icon name="close" size={24} />
          </button>
        </div>
      ))}
    </div>
  );
}
