"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import Icon from "@/components/common/Icon";
import MeetingLink from "@/components/common/MeetingLink";
import { VideoCallRoom, isCallOpen } from "@/components/common/VideoCall";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat } from "@/lib/utils/datetime";

/**
 * Real-time incoming-call ringing, mounted once in the root layout.
 *
 * Before this, a call only happened if both people were already staring at
 * the right screen: the caller waited in silence and the callee never learned
 * anything had happened. Now the caller's room knocks on the peer's open page
 * with a `ring` row in `call_signals`, and this listener turns that row into a
 * full-screen prompt with a tone.
 *
 * Delivery is Supabase Realtime with a short poll behind it — the same
 * realtime-then-poll pairing the notification toasts use, because a websocket
 * dropping is normal on a 2G link and the knock still has to land.
 *
 * Two gates decide whether a ring is real, in this order:
 *   1. the row is not my own (Realtime hands me my own inserts too);
 *   2. the appointment can actually be read back by me. RLS returns nothing
 *      for an appointment I am not a participant in, so a forged or leaked
 *      row can never make this page ring for someone else's call.
 *
 * The tone is synthesised with WebAudio rather than shipped as a file: no
 * asset to download on a 2G link, and if the browser refuses to start audio
 * before a gesture the overlay still flashes.
 */

type RingRow = {
  id: string;
  appointment_id: string;
  sender_id: string;
  kind: string;
  created_at: string;
};

type Incoming = {
  appointmentId: string;
  senderId: string;
  peerName: string;
  meetingUrl: string | null;
  linksSupported: boolean;
  startsAt: string;
};

const POLL_MS = 5000;
/** A knock older than this is from a call nobody is waiting on any more. */
const RING_FRESH_MS = 60_000;
/** After declining, stop re-ringing me for this appointment for half a minute. */
const DECLINE_COOLDOWN_MS = 30_000;
/** VideoCall dispatches this when a room mounts or closes. */
const CALL_STATE_EVENT = "carepoint:call-state";

const APPT_SELECT_WITH_LINK =
  "id, status, patient_id, doctor_id, start_time, meeting_url, patient:profiles(full_name), doctor:doctors(profiles(full_name))";
const APPT_SELECT_WITHOUT_LINK =
  "id, status, patient_id, doctor_id, start_time, patient:profiles(full_name), doctor:doctors(profiles(full_name))";

/** A two-tone burr, repeated, from the platform's own audio synth. */
function createRingtone() {
  let ctx: AudioContext | null = null;
  let timer: number | null = null;

  function beep() {
    if (!ctx) return;
    const start = ctx.currentTime;
    for (const offset of [0, 0.35]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = offset === 0 ? 440 : 480;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.35);
    }
  }

  return {
    start() {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = ctx ?? new Ctor();
        void ctx.resume().catch(() => undefined);
        beep();
        if (timer === null) timer = window.setInterval(beep, 1600);
      } catch {
        // Audio blocked before a user gesture: the flashing overlay is enough.
      }
      try {
        if (typeof navigator.vibrate === "function") {
          navigator.vibrate([400, 200, 400, 200, 400]);
        }
      } catch {
        // No vibrator (or desktop): nothing to do.
      }
    },
    stop() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      try {
        void ctx?.close();
      } catch {
        // Already closed.
      }
      ctx = null;
    },
  };
}

function nameOf(profile: { full_name?: string | null } | null | undefined): string | null {
  return profile?.full_name?.trim() || null;
}

export default function CallRing() {
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [room, setRoom] = useState<{ id: string; peer: string } | null>(null);
  const [, rerender] = useState(0);

  const meRef = useRef("");
  const seenRef = useRef<Set<string>>(new Set());
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const incomingRef = useRef<Incoming | null>(null);
  const toneRef = useRef(createRingtone());

  const settle = useCallback(() => {
    toneRef.current.stop();
    incomingRef.current = null;
    setIncoming(null);
  }, []);

  const accept = useCallback(() => {
    const current = incomingRef.current;
    if (current) {
      // The room is open now; any knock still in flight must not re-open this.
      cooldownRef.current.set(current.appointmentId, Date.now() + RING_FRESH_MS);
      setRoom({ id: current.appointmentId, peer: current.peerName });
    }
    settle();
  }, [settle]);

  const decline = useCallback(async () => {
    const current = incomingRef.current;
    if (current) {
      cooldownRef.current.set(current.appointmentId, Date.now() + DECLINE_COOLDOWN_MS);
      const supabase = tryCreateSupabaseBrowserClient();
      if (supabase) {
        try {
          // Tell the caller nobody is coming rather than leaving them ringing;
          // their room shows "ended" instead of waiting out the window.
          await supabase.from("call_signals").insert({
            appointment_id: current.appointmentId,
            sender_id: meRef.current,
            kind: "end",
            payload: "",
          });
        } catch {
          // Best effort — their own 60s timeout still ends the wait.
        }
      }
    }
    settle();
  }, [settle]);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let poll: number | null = null;
    // Captured now so cleanup stops THIS effect's tone, not whatever a later
    // render has swapped into the ref.
    const tone = toneRef.current;

    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;

    /** Read the appointment back; RLS is the gate that says "yours or not". */
    async function resolveRing(row: RingRow): Promise<void> {
      const client = supabase;
      if (!client || cancelled || incomingRef.current) return;

      let result = await client
        .from("appointments")
        .select(APPT_SELECT_WITH_LINK)
        .eq("id", row.appointment_id)
        .maybeSingle();

      let linksSupported = true;
      if (result.error) {
        // Migration 20261019000010 not applied yet: meeting_url is unknown to
        // the database. Ringing must survive that, so retry without it.
        linksSupported = false;
        result = await client
          .from("appointments")
          .select(APPT_SELECT_WITHOUT_LINK)
          .eq("id", row.appointment_id)
          .maybeSingle();
      }

      const appt = result.data as
        | {
            id: string;
            status: string;
            patient_id: string;
            doctor_id: string;
            start_time: string;
            meeting_url?: string | null;
            patient?: { full_name?: string | null } | null;
            doctor?: {
              profiles?:
                | { full_name?: string | null }
                | Array<{ full_name?: string | null }>
                | null;
            } | null;
          }
        | null;

      if (cancelled || !appt || incomingRef.current) return;
      if (appt.status === "cancelled") return;

      const iAmThePatient = appt.patient_id === meRef.current;
      const doctorProfile = Array.isArray(appt.doctor?.profiles)
        ? appt.doctor.profiles[0]
        : appt.doctor?.profiles;
      const peerName = iAmThePatient
        ? nameOf(doctorProfile) ?? "your doctor"
        : nameOf(appt.patient) ?? "your patient";

      const next: Incoming = {
        appointmentId: appt.id,
        senderId: row.sender_id,
        peerName,
        meetingUrl: linksSupported ? (appt.meeting_url ?? null) : null,
        linksSupported,
        startsAt: appt.start_time,
      };
      incomingRef.current = next;
      setIncoming(next);
      tone.start();
    }

    function ingest(rows: readonly unknown[]): void {
      for (const raw of rows) {
        const row = raw as RingRow | null;
        if (!row?.id || seenRef.current.has(row.id)) continue;
        seenRef.current.add(row.id);

        // Realtime also delivers my own inserts; they are not an incoming call.
        if (meRef.current && row.sender_id === meRef.current) continue;

        if (row.kind === "end") {
          const current = incomingRef.current;
          if (
            current &&
            current.appointmentId === row.appointment_id &&
            current.senderId === row.sender_id
          ) {
            cooldownRef.current.set(row.appointment_id, Date.now() + DECLINE_COOLDOWN_MS);
            settle();
          }
          continue;
        }

        if (row.kind !== "ring") continue;

        // A call room is already open for this appointment somewhere on this
        // page (the peer accepted while I am mid-call) — never ring over it.
        if (isCallOpen(row.appointment_id)) continue;

        const cooldownUntil = cooldownRef.current.get(row.appointment_id) ?? 0;
        if (cooldownUntil > Date.now()) continue;
        if (Date.now() - Date.parse(row.created_at) > RING_FRESH_MS) continue;

        void resolveRing(row);
      }
    }

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      meRef.current = user.id;

      channel = supabase
        .channel(`call-ring:${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_signals" },
          (payload) => ingest([payload.new]),
        )
        .subscribe();

      const fetchRecent = async () => {
        const { data } = await supabase
          .from("call_signals")
          .select("id, appointment_id, sender_id, kind, created_at")
          .in("kind", ["ring", "end"])
          .gt("created_at", new Date(Date.now() - RING_FRESH_MS).toISOString())
          .order("created_at", { ascending: false })
          .limit(10);
        if (cancelled || !data) return;
        ingest(data);
      };

      void fetchRecent();
      poll = window.setInterval(() => void fetchRecent(), POLL_MS);
    })();

    // A room mounted or closed somewhere on this page: never stack the
    // overlay on top of a call the user already has open.
    const onCallState = () => rerender((count) => count + 1);
    window.addEventListener(CALL_STATE_EVENT, onCallState);

    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
      window.removeEventListener(CALL_STATE_EVENT, onCallState);
      tone.stop();
    };
  }, [settle]);

  if (room) {
    return <VideoCallRoom appointmentId={room.id} peerName={room.peer} onClose={() => setRoom(null)} />;
  }

  if (!incoming || isCallOpen(incoming.appointmentId)) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming call from ${incoming.peerName}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-space-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border-4 border-primary bg-white p-space-md shadow-tactile-sm">
        <p
          aria-live="assertive"
          className="m-0 flex items-center justify-center gap-space-xs text-label-xl uppercase text-primary"
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          Incoming call
        </p>

        <span className="mx-auto mt-space-sm flex h-24 w-24 items-center justify-center rounded-full bg-primary text-white shadow-tactile-sm">
          <Icon name="ring_volume" size={54} />
        </span>

        <h2 className="m-0 mt-space-sm text-center text-headline-lg-mobile text-on-surface">
          {incoming.peerName}
        </h2>
        <p className="m-0 text-center text-body-lg text-on-surface-variant">
          is calling you now · {formatInWat(incoming.startsAt, "EEEE d MMM, h:mm a")} WAT
        </p>

        <div className="mt-space-md flex flex-wrap gap-space-xs">
          <button
            type="button"
            onClick={accept}
            className="flex min-h-16 flex-1 items-center justify-center gap-space-xs rounded-xl bg-primary px-space-sm text-label-xl text-white shadow-tactile press"
          >
            <Icon name="call" size={30} />
            ACCEPT
          </button>
          <button
            type="button"
            onClick={() => void decline()}
            className="flex min-h-16 flex-1 items-center justify-center gap-space-xs rounded-xl border-2 border-tertiary bg-white px-space-sm text-label-xl text-tertiary press"
          >
            <Icon name="call_end" size={30} />
            DECLINE
          </button>
        </div>

        <MeetingLink
          appointmentId={incoming.appointmentId}
          peerLabel={incoming.peerName}
          meetingUrl={incoming.meetingUrl}
          supported={incoming.linksSupported}
          onChange={(url) => {
            if (incomingRef.current) {
              incomingRef.current = { ...incomingRef.current, meetingUrl: url };
            }
            setIncoming((previous) => (previous ? { ...previous, meetingUrl: url } : previous));
          }}
        />
      </div>
    </div>
  );
}
