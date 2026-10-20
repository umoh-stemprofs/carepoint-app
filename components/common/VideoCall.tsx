"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import Icon from "@/components/common/Icon";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * In-app doctor⇄patient video call (plan Phase 07 "Doctor video call").
 *
 * Media is peer-to-peer WebRTC: frames never touch Supabase. Only the
 * handshake travels through the database — `public.call_signals` rows scoped
 * by RLS to the two participants of one appointment — and it is polled once a
 * second, because signalling happens a handful of times per call while the
 * media itself flows directly between the two devices.
 *
 * To keep signalling to a single round trip each way, each side waits for ICE
 * gathering to finish (host candidates arrive immediately on a LAN, STUN
 * answers within a couple of seconds) before sending its session description,
 * so the offer already carries its own candidates.
 *
 * Known limit of this design: STUN only, no TURN relay. Two devices on the
 * same network — or with permissive NATs — connect; a symmetric NAT would
 * need a TURN server, which is out of scope for a prototype.
 */

const ICE_GATHER_TIMEOUT_MS = 3000;
const POLL_MS = 1000;
/** A handshake older than this is stale (the other side is no longer waiting). */
const SIGNAL_MAX_AGE_MS = 60_000;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type CallPhase = "requesting" | "waiting" | "connected" | "ended" | "error";

type SignalRow = {
  id: string;
  sender_id: string;
  kind: "offer" | "answer" | "end";
  payload: string;
  created_at: string;
};

/** Resolve once every ICE candidate has been gathered, or after a short cap. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", onStateChange);
    window.setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
  });
}

function VideoCallRoom({
  appointmentId,
  peerName,
  onClose,
}: {
  appointmentId: string;
  peerName: string;
  onClose: () => void;
}) {
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const meRef = useRef<string>("");
  const peerIdRef = useRef<string>("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const roleRef = useRef<"" | "caller" | "callee">("");
  const pollRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const [phase, setPhase] = useState<CallPhase>("requesting");
  const [status, setStatus] = useState("Starting your camera…");
  const [failure, setFailure] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // Callback refs: React re-runs them whenever the element or the stream
  // changes, which is exactly when srcObject needs (re)assigning.
  const attachLocal = (element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    if (element && localStream && element.srcObject !== localStream) {
      element.srcObject = localStream;
    }
  };
  const attachRemote = (element: HTMLVideoElement | null) => {
    remoteVideoRef.current = element;
    if (element && remoteStream && element.srcObject !== remoteStream) {
      element.srcObject = remoteStream;
    }
  };

  function stopEverything() {
    closedRef.current = true;
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const supabase = createSupabaseBrowserClient();
      supabaseRef.current = supabase;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || closedRef.current) return;
      if (!user) {
        setPhase("error");
        setFailure("Your session has expired. Sign in again, then start the call.");
        return;
      }
      meRef.current = user.id;

      // Both sides must know who the other is before the handshake.
      const { data: appointment, error: appointmentError } = await supabase
        .from("appointments")
        .select("id, patient_id, doctor_id, status")
        .eq("id", appointmentId)
        .maybeSingle();
      if (cancelled || closedRef.current) return;
      if (appointmentError || !appointment) {
        setPhase("error");
        setFailure("This appointment could not be opened for a call.");
        return;
      }
      const row = appointment as { patient_id: string; doctor_id: string; status: string };
      if (row.status === "cancelled") {
        setPhase("error");
        setFailure("This appointment was cancelled, so there is no call to join.");
        return;
      }
      peerIdRef.current =
        row.patient_id === meRef.current ? row.doctor_id : row.patient_id;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        });
      } catch {
        if (cancelled || closedRef.current) return;
        setPhase("error");
        setFailure(
          "CarePoint needs your camera and microphone for the call. Allow access in the browser, then try again.",
        );
        return;
      }
      if (cancelled || closedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        const incoming = event.streams[0];
        if (incoming && !closedRef.current) setRemoteStream(incoming);
      };
      pc.onconnectionstatechange = () => {
        if (closedRef.current) return;
        if (pc.connectionState === "connected") {
          setPhase("connected");
          setStatus("Connected — you are with " + peerName);
        } else if (pc.connectionState === "failed") {
          setPhase("ended");
          setStatus("The connection dropped. Close and start the call again.");
        } else if (pc.connectionState === "disconnected") {
          setStatus("Reconnecting…");
        }
      };

      // Drop anything left behind by an earlier session of mine.
      await supabase
        .from("call_signals")
        .delete()
        .eq("appointment_id", appointmentId)
        .eq("sender_id", meRef.current);
      if (cancelled || closedRef.current) return;

      setPhase("waiting");
      setStatus(`Waiting for ${peerName} to join…`);

      pollRef.current = window.setInterval(() => {
        void pollSignals();
      }, POLL_MS);
      void pollSignals();

      // First to arrive offers; if the peer's offer is already waiting, answer it.
      const existing = await supabase
        .from("call_signals")
        .select("id, sender_id, kind, payload, created_at")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: true })
        .limit(20);
      if (cancelled || closedRef.current) return;

      const freshPeerOffer = ((existing.data ?? []) as unknown as SignalRow[]).find(
        (signal) =>
          signal.sender_id === peerIdRef.current &&
          signal.kind === "offer" &&
          Date.now() - Date.parse(signal.created_at) <= SIGNAL_MAX_AGE_MS,
      );

      if (freshPeerOffer) {
        (existing.data as unknown as SignalRow[]).forEach((signal) =>
          seenRef.current.add(signal.id),
        );
        await answerOffer(freshPeerOffer.payload);
      } else {
        await makeOffer();
      }
    }

    void setup();

    return () => {
      cancelled = true;
      stopEverything();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  async function sendSignal(kind: SignalRow["kind"], payload: string): Promise<void> {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const { error } = await supabase.from("call_signals").insert({
      appointment_id: appointmentId,
      sender_id: meRef.current,
      kind,
      payload,
    });
    if (error && !closedRef.current) {
      setPhase("error");
      setFailure(`The call could not be signalled: ${error.message}`);
    }
  }

  async function makeOffer(): Promise<void> {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      roleRef.current = "caller";
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      await sendSignal("offer", pc.localDescription?.sdp ?? offer.sdp ?? "");
    } catch {
      if (!closedRef.current) {
        setPhase("error");
        setFailure("Your browser could not start the call. Close this box and try again.");
      }
    }
  }

  async function answerOffer(sdp: string): Promise<void> {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      roleRef.current = "callee";
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);
      await sendSignal("answer", pc.localDescription?.sdp ?? answer.sdp ?? "");
      setStatus(`Answering ${peerName} — connecting…`);
    } catch {
      if (!closedRef.current) {
        setPhase("error");
        setFailure("The call handshake failed. Close this box and start again.");
      }
    }
  }

  async function pollSignals(): Promise<void> {
    const supabase = supabaseRef.current;
    if (!supabase || closedRef.current) return;

    try {
      const { data, error } = await supabase
        .from("call_signals")
        .select("id, sender_id, kind, payload, created_at")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error || !data || closedRef.current) return;

      for (const raw of data as unknown as SignalRow[]) {
        if (seenRef.current.has(raw.id)) continue;
        seenRef.current.add(raw.id);

        // My own rows are what the peer reads; they mean nothing to me.
        if (raw.sender_id === meRef.current) continue;
        if (raw.sender_id !== peerIdRef.current) continue;
        if (Date.now() - Date.parse(raw.created_at) > SIGNAL_MAX_AGE_MS) continue;

        if (raw.kind === "end") {
          stopEverything();
          setPhase("ended");
          setStatus(`${peerName} ended the call.`);
          return;
        }

        if (raw.kind === "offer") {
          if (roleRef.current === "caller") {
            // Both sides pressed start at once. The lower user id wins the
            // glare: it keeps its offer, the higher one answers instead.
            if (!(peerIdRef.current < meRef.current)) continue;
          }
          await answerOffer(raw.payload);
          continue;
        }

        if (raw.kind === "answer" && roleRef.current === "caller") {
          const pc = pcRef.current;
          if (!pc) continue;
          try {
            await pc.setRemoteDescription({ type: "answer", sdp: raw.payload });
            setStatus(`Connecting to ${peerName}…`);
          } catch {
            // A stale or duplicated answer is ignored; the poll continues.
          }
        }
      }
    } catch {
      // A dropped poll is retried on the next tick.
    }
  }

  async function endCall() {
    const supabase = supabaseRef.current;
    if (supabase) {
      try {
        await supabase.from("call_signals").insert({
          appointment_id: appointmentId,
          sender_id: meRef.current,
          kind: "end",
          payload: "",
        });
      } catch {
        // Best effort: closing the room matters more than the goodbye row.
      }
    }
    stopEverything();
    setPhase("ended");
    setStatus("You ended the call.");
  }

  function toggleMic() {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicOn(next);
  }

  function toggleCam() {
    const next = !camOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCamOn(next);
  }

  const busy = phase === "requesting" || phase === "waiting" || phase === "connected";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Video call with ${peerName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-space-xs sm:p-space-sm"
    >
      <div className="flex w-full max-w-3xl flex-col gap-space-sm rounded-xl bg-white p-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <div className="min-w-0">
            <p className="eyebrow mb-0">DOCTOR VIDEO CALL</p>
            <h2 className="truncate text-headline-lg-mobile text-on-surface">{peerName}</h2>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-label-lg uppercase ${
              phase === "connected"
                ? "border-primary bg-primary-fixed text-on-primary-fixed"
                : phase === "error" || phase === "ended"
                  ? "border-tertiary bg-error-container text-on-error-container"
                  : "border-outline-variant bg-surface-container-low text-on-surface-variant"
            }`}
          >
            <Icon
              name={phase === "connected" ? "check_circle" : phase === "error" ? "error" : "schedule"}
              size={22}
            />
            {phase === "connected"
              ? "LIVE"
              : phase === "error"
                ? "PROBLEM"
                : phase === "ended"
                  ? "ENDED"
                  : "CONNECTING"}
          </span>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-on-surface">
          <video
            ref={attachRemote}
            autoPlay
            playsInline
            className="aspect-video w-full bg-on-surface object-cover"
          />
          {phase !== "connected" && remoteStream === null ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-space-xs p-space-sm text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-white">
                <Icon name="videocam" size={40} />
              </span>
              <p className="text-body-lg text-white">{status}</p>
            </div>
          ) : null}

          <video
            ref={attachLocal}
            autoPlay
            playsInline
            muted
            className="absolute right-3 bottom-3 aspect-[4/3] w-32 rounded-lg border-2 border-white object-cover shadow-tactile-sm sm:w-44"
          />
        </div>

        {failure ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
          >
            <Icon name="error" size={28} className="mt-0.5 shrink-0" />
            {failure}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-space-sm">
          <button
            type="button"
            onClick={toggleMic}
            disabled={phase === "error" || phase === "ended"}
            aria-pressed={!micOn}
            className={`flex min-h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-xl px-space-sm text-label-lg press disabled:cursor-not-allowed disabled:opacity-45 ${
              micOn ? "bg-surface-container-high text-on-surface" : "bg-tertiary text-white"
            }`}
          >
            <Icon name={micOn ? "mic" : "mic_off"} size={30} />
            {micOn ? "MIC ON" : "MIC OFF"}
          </button>

          <button
            type="button"
            onClick={toggleCam}
            disabled={phase === "error" || phase === "ended"}
            aria-pressed={!camOn}
            className={`flex min-h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-xl px-space-sm text-label-lg press disabled:cursor-not-allowed disabled:opacity-45 ${
              camOn ? "bg-surface-container-high text-on-surface" : "bg-tertiary text-white"
            }`}
          >
            <Icon name={camOn ? "videocam" : "videocam_off"} size={30} />
            {camOn ? "CAM ON" : "CAM OFF"}
          </button>

          {phase === "error" || phase === "ended" ? (
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-16 items-center justify-center gap-2 rounded-xl bg-primary px-space-md text-label-xl text-white shadow-tactile press"
            >
              <Icon name="close" size={30} />
              CLOSE
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void endCall()}
              className="flex min-h-16 items-center justify-center gap-2 rounded-xl bg-tertiary px-space-md text-label-xl text-white shadow-tactile press"
            >
              <Icon name="call_end" size={30} />
              END CALL
            </button>
          )}
        </div>

        <p className="text-center text-body-lg text-on-surface-variant">
          {busy ? "Do not close this box until the call is finished." : null}
        </p>
      </div>
    </div>
  );
}

/**
 * Blue "VIDEO CALL" action for an appointment card. The room only mounts (and
 * only asks for the camera) once it is pressed.
 */
export default function VideoCallButton({
  appointmentId,
  peerName,
  className = "",
}: {
  appointmentId: string;
  peerName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-14 items-center justify-center gap-2 rounded-lg bg-secondary px-4 text-label-lg text-white press ${className}`.trim()}
      >
        <Icon name="videocam" size={26} />
        VIDEO CALL
      </button>
      {open ? (
        <VideoCallRoom
          appointmentId={appointmentId}
          peerName={peerName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
