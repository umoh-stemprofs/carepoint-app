"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import Icon from "@/components/common/Icon";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat } from "@/lib/utils/datetime";

/**
 * Plan 11.4: the visual notification inbox in the header.
 *
 * Reads the same `public.notifications` rows the toast listener reacts to, so
 * anything that flashed past while the user was looking elsewhere is still
 * there. Opening the panel marks rows read; RLS scopes every query to the
 * signed-in recipient, and a signed-out visitor sees nothing at all.
 */

type Notice = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  function mapRow(row: {
    id: string;
    title: string;
    body: string;
    read_at: string | null;
    created_at: string;
  }): Notice {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }

  useEffect(() => {
    let cancelled = false;
    const maybeClient = tryCreateSupabaseBrowserClient();
    if (!maybeClient) return;
    const supabase = maybeClient;

    async function refresh() {
      const { data: userData } = await supabase.auth.getUser().catch(() => ({
        data: { user: null },
      }));
      if (cancelled) return;
      if (!userData.user) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);

      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(12);
      if (cancelled || !data) return;

      const rows = (data as unknown as Parameters<typeof mapRow>[0][]).map(mapRow);
      setNotices(rows);
      setUnread(rows.filter((notice) => !notice.readAt).length);
    }

    void refresh();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      channel = supabase
        .channel(`bell:${data.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${data.user.id}`,
          },
          () => void refresh(),
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  // Close when tapping outside the panel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!signedIn) return null;

  async function markRead(id: string) {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
    setNotices((previous) =>
      previous.map((notice) => (notice.id === id ? { ...notice, readAt: new Date().toISOString() } : notice)),
    );
    setUnread((count) => Math.max(0, count - 1));
  }

  async function markAllRead() {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    setNotices((previous) =>
      previous.map((notice) => ({ ...notice, readAt: notice.readAt ?? new Date().toISOString() })),
    );
    setUnread(0);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setLoading(true);
          void (async () => {
            const supabase = tryCreateSupabaseBrowserClient();
            if (supabase) {
              const { data } = await supabase
                .from("notifications")
                .select("id, title, body, read_at, created_at")
                .order("created_at", { ascending: false })
                .limit(12);
              if (data) {
                const rows = (data as unknown as Parameters<typeof mapRow>[0][]).map(mapRow);
                setNotices(rows);
                setUnread(rows.filter((notice) => !notice.readAt).length);
              }
            }
            setLoading(false);
          })();
        }}
        aria-expanded={open}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications, none unread"
        }
        className="relative flex min-h-12 min-w-12 items-center justify-center rounded-lg border-2 border-on-surface bg-white px-space-xs text-on-surface press"
      >
        <Icon name="notifications" size={26} />
        {unread > 0 ? (
          <span className="absolute -top-2 -right-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-tertiary px-1.5 text-label-lg text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notification inbox"
          className="absolute right-0 z-50 mt-2 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-space-xs rounded-xl border-2 border-outline-variant bg-white p-space-xs shadow-tactile-sm"
        >
          <div className="flex items-center justify-between gap-space-xs px-space-xs">
            <span className="text-label-lg uppercase text-on-surface-variant">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-label-lg text-secondary press"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {loading ? (
            <p className="m-0 px-space-xs text-body-lg text-on-surface-variant">Loading…</p>
          ) : notices.length === 0 ? (
            <p className="m-0 px-space-xs text-body-lg text-on-surface-variant">
              Nothing yet. Book an appointment and a confirmation will appear here.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-space-xs p-0">
              {notices.map((notice) => (
                <li key={notice.id}>
                  <button
                    type="button"
                    onClick={() => void markRead(notice.id)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-lg p-space-xs text-left press ${
                      notice.readAt
                        ? "bg-surface-container-low"
                        : "bg-primary-fixed"
                    }`}
                  >
                    <span className="text-label-lg text-on-surface">{notice.title}</span>
                    <span className="text-body-lg leading-snug text-on-surface-variant">
                      {notice.body}
                    </span>
                    <span className="text-label-lg text-on-surface-variant">
                      {formatInWat(notice.createdAt, "d MMM yyyy, h:mm a")} WAT
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/appointments"
            onClick={() => setOpen(false)}
            className="flex min-h-12 items-center justify-center gap-space-xs rounded-lg bg-surface-container-high text-label-lg text-on-surface no-underline press"
          >
            <Icon name="event" size={24} />
            Open my appointments
          </Link>
        </div>
      ) : null}
    </div>
  );
}
