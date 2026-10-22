"use client";

import { useEffect, useRef, useState } from "react";

import Icon from "@/components/common/Icon";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * The fallback room: a Jitsi meet link stored on the appointment itself.
 *
 * Peer-to-peer WebRTC is the primary path, but this build is STUN-only — no
 * TURN relay — so a symmetric NAT can leave both sides staring at a spinner.
 * This button gives them a way out that needs no signalling at all: either
 * participant mints the room once, the URL lands on the appointment row, and
 * because both sides read that same row the link is "shared" by being stored,
 * not by being messaged.
 *
 * The URL shape is fixed by the RPC's own check
 * (`https://meet.jit.si/MamaDoc-<appointmentId>-<random>`), so a value that
 * would not round-trip through `set_appointment_meeting_link` is never sent.
 *
 * If migration 20261019000010 has not been applied, the parent passes
 * `supported={false}` and this component renders nothing rather than showing a
 * button that can only ever fail.
 */

/** URL-safe room suffix straight from the platform CSPRNG (hex: no bias). */
function newRoomSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

export function buildMeetingUrl(appointmentId: string): string {
  return `https://meet.jit.si/MamaDoc-${appointmentId}-${newRoomSuffix()}`;
}

type Props = {
  appointmentId: string;
  /** Who is on the other end — the caption tells the user it reached them. */
  peerLabel: string;
  meetingUrl: string | null;
  onChange: (url: string) => void;
  supported?: boolean;
  /** Compact variant for the call room, where space is already spent. */
  compact?: boolean;
};

export default function MeetingLink({
  appointmentId,
  peerLabel,
  meetingUrl,
  onChange,
  supported = true,
  compact = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Held in a ref so the watcher below subscribes once instead of on every
  // parent re-render (the parents pass inline arrow functions). Written in an
  // effect, never during render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /**
   * Watch this appointment for a room minted by the OTHER side.
   *
   * Both participants read the same row, so this is what makes the link feel
   * shared: the doctor mints it, the patient's card flips from the button to
   * the room panel on its own, and the reverse too. Realtime (migration 0010
   * joins the publication) with a slow poll behind it — the same pairing the
   * notification toasts use, because a dropped websocket is normal.
   *
   * Only runs while no link exists yet, and only when the migration that
   * adds the column is actually applied; otherwise there is nothing to watch.
   */
  useEffect(() => {
    if (!supported || meetingUrl) return undefined;
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return undefined;

    let cancelled = false;
    let poll: number | null = null;

    const ingest = (raw: unknown) => {
      const url = (raw as { meeting_url?: string | null } | null)?.meeting_url;
      if (!cancelled && url) onChangeRef.current(url);
    };

    const channel = supabase
      .channel(`meeting-link:${appointmentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "appointments", filter: `id=eq.${appointmentId}` },
        (payload) => ingest(payload.new),
      )
      .subscribe();

    const fetchUrl = async () => {
      const { data } = await supabase
        .from("appointments")
        .select("meeting_url")
        .eq("id", appointmentId)
        .maybeSingle();
      if (!cancelled) ingest(data);
    };

    void fetchUrl();
    poll = window.setInterval(() => void fetchUrl(), 20000);

    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [appointmentId, meetingUrl, supported]);

  if (!supported) return null;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const supabase = tryCreateSupabaseBrowserClient();
      if (!supabase) throw new Error("Sign in again to create a meeting room.");

      const url = buildMeetingUrl(appointmentId);
      const { error: rpcError } = await supabase.rpc("set_appointment_meeting_link", {
        p_appointment_id: appointmentId,
        p_url: url,
      });
      if (rpcError) throw new Error(rpcError.message);

      onChange(url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The meeting room could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(meetingUrl ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Your browser blocked the copy. Select the link above to copy it by hand.");
    }
  }

  if (!meetingUrl) {
    return (
      <div className="mt-space-xs w-full">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className={`flex w-full items-center justify-center gap-space-xs rounded-xl border-2 border-secondary bg-white text-label-xl text-secondary press disabled:cursor-wait disabled:opacity-60 ${
            compact ? "min-h-14 px-4" : "min-h-16 px-space-sm"
          }`}
        >
          <Icon name="link" size={28} />
          {busy ? "CREATING ROOM…" : "GENERATE MEETING LINK"}
        </button>
        {error ? (
          <p
            role="alert"
            className="mt-space-xs flex items-start gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
          >
            <Icon name="error" size={24} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-space-xs w-full rounded-xl border-2 border-primary bg-primary-fixed p-space-sm">
      <p className="m-0 flex items-center gap-space-xs text-label-lg uppercase text-on-primary-fixed-variant">
        <Icon name="groups" size={20} className="text-primary" />
        Shared meeting room — both sides can open it
      </p>

      <p className="m-0 mt-space-xs break-all text-body-xl font-bold text-on-primary-fixed">
        {meetingUrl.replace(/^https:\/\//, "")}
      </p>

      <div className="mt-space-xs flex flex-wrap gap-space-xs">
        <a
          href={meetingUrl}
          target="_blank"
          rel="noreferrer"
          className={`flex flex-1 items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white no-underline shadow-tactile press ${
            compact ? "min-h-14" : "min-h-16"
          }`}
        >
          <Icon name="open_in_new" size={26} />
          OPEN MEETING
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          className={`flex flex-1 items-center justify-center gap-space-xs rounded-xl border-2 border-primary bg-white text-label-xl text-primary press ${
            compact ? "min-h-14" : "min-h-16"
          }`}
        >
          <Icon name="content_copy" size={26} />
          {copied ? "COPIED" : "COPY LINK"}
        </button>
      </div>

      <p className="m-0 mt-space-xs text-label-lg text-on-primary-fixed-variant">
        Saved on this appointment — {peerLabel} sees it too.
      </p>

      {error ? (
        <p
          role="alert"
          className="m-0 mt-space-xs flex items-start gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <Icon name="error" size={24} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
