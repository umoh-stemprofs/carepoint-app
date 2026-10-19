"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Topbar from "@/components/common/Topbar";
import AIDiagnosticDrawer from "@/components/doctor/AIDiagnosticDrawer";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat, watDateOnly } from "@/lib/utils/datetime";

type Status = "pending" | "confirmed" | "completed" | "cancelled";

type QueueItem = {
  id: string;
  patientName: string;
  startTime: string;
  endTime: string;
  status: Status;
  slotPeriod: string;
  reasonForVisit: string;
  appointmentDate: string;
};

type Row = {
  id: string;
  start_time: string;
  end_time: string;
  status: Status;
  slot_period: string;
  reason_for_visit: string;
  appointment_date: string;
  patient?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
};

/**
 * Built on demand rather than at module scope: evaluating Date.now while
 * prerendering is rejected by Next.js.
 */
function sampleQueue(): QueueItem[] {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  return [
    {
      id: "sample-1",
      patientName: "Sample patient",
      startTime: new Date(Date.now() + hour).toISOString(),
      endTime: new Date(Date.now() + 2 * hour).toISOString(),
      status: "confirmed",
      slotPeriod: "morning",
      reasonForVisit: "Fever and chills for three days",
      appointmentDate: new Date().toISOString().slice(0, 10),
    },
    {
      id: "sample-2",
      patientName: "Sample patient",
      startTime: new Date(Date.now() + 26 * hour).toISOString(),
      endTime: new Date(Date.now() + 27 * hour).toISOString(),
      status: "pending",
      slotPeriod: "morning",
      reasonForVisit: "Follow-up after lab results",
      appointmentDate: new Date(Date.now() + day).toISOString().slice(0, 10),
    },
  ];
}

const BADGE_STYLES: Record<Status, React.CSSProperties> = {
  confirmed: { background: "#dcfae6", border: "2px solid #12b76a", color: "#05603a" },
  pending: { background: "#fef0c7", border: "2px solid #f79009", color: "#93370d" },
  completed: { background: "#e0e7ff", border: "2px solid #6172f3", color: "#3538cd" },
  cancelled: { background: "#fee4e2", border: "2px solid #f04438", color: "#7a271a" },
};

function mapRow(row: Row): QueueItem {
  const embedded = Array.isArray(row.patient) ? row.patient[0] : row.patient;
  return {
    id: row.id,
    patientName: embedded?.full_name || "Patient",
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    slotPeriod: row.slot_period,
    reasonForVisit: row.reason_for_visit,
    appointmentDate: row.appointment_date,
  };
}

type QueueAction = "confirmed" | "completed" | "cancelled";

function StatusButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: "primary" | "neutral" | "danger";
  disabled: boolean;
  onClick: () => void;
}) {
  const palette = {
    primary: { background: "var(--green)", color: "#fff", border: "var(--green)" },
    neutral: { background: "#fff", color: "var(--blue)", border: "var(--blue)" },
    danger: { background: "#fff", color: "var(--red)", border: "var(--red)" },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 48,
        padding: "0 16px",
        fontSize: 16,
        fontWeight: 700,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        background: palette.background,
        color: palette.color,
        border: `2px solid ${palette.border}`,
      }}
    >
      {label}
    </button>
  );
}

function QueueCard({
  item,
  isToday,
  busy,
  onAction,
}: {
  item: QueueItem;
  isToday: boolean;
  busy: boolean;
  onAction: (status: QueueAction) => void;
}) {
  const isFinished = item.status === "completed" || item.status === "cancelled";

  return (
    <article
      style={{
        border: "2px solid var(--line)",
        borderLeft: `6px solid ${isToday ? "var(--blue)" : "var(--line)"}`,
        borderRadius: 10,
        padding: 18,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 740 }}>{item.patientName}</div>
          <div style={{ fontSize: 15, color: "#435249" }}>
            {formatInWat(item.startTime, "EEEE d MMMM yyyy")} ·{" "}
            {formatInWat(item.startTime, "h:mm a")} – {formatInWat(item.endTime, "h:mm a")} WAT
          </div>
        </div>
        <span
          style={{
            ...BADGE_STYLES[item.status],
            textTransform: "uppercase",
            fontSize: 13,
            fontWeight: 750,
            letterSpacing: "0.06em",
            borderRadius: 6,
            padding: "6px 12px",
          }}
        >
          {item.status}
        </span>
      </div>
      <p style={{ fontSize: 17, marginTop: 12, marginBottom: 0 }}>{item.reasonForVisit}</p>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <StatusButton
          label="Confirm"
          tone="primary"
          disabled={busy || item.status !== "pending"}
          onClick={() => onAction("confirmed")}
        />
        <StatusButton
          label="Complete"
          tone="neutral"
          disabled={busy || item.status !== "confirmed"}
          onClick={() => onAction("completed")}
        />
        <StatusButton
          label="Cancel"
          tone="danger"
          disabled={busy || isFinished}
          onClick={() => onAction("cancelled")}
        />
      </div>
    </article>
  );
}

export default function DoctorDashboardPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  // Read in the effect, never during render: "current time" APIs are blocked
  // while prerendering this client component.
  const [today, setToday] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function updateStatus(id: string, status: QueueAction) {
    setActionError(null);
    setBusyId(id);
    try {
      const supabase = tryCreateSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const { data, error } = await supabase
        .from("appointments")
        .update({ status })
        .eq("id", id)
        .select("id");

      if (error) throw new Error(error.message);
      // A no-op update on sample rows must not silently claim success.
      if (!data || data.length === 0) {
        throw new Error("That appointment is sample data and is not stored in the database.");
      }

      setItems((previous) =>
        previous.map((item) => (item.id === id ? { ...item, status } : item)),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The status could not be updated.",
      );
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Established first so both the live and sample paths know today's date.
      await Promise.resolve();
      if (cancelled) return;
      setToday(watDateOnly(new Date()));

      const supabase = tryCreateSupabaseBrowserClient();

      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("appointments")
            .select(
              "id, appointment_date, start_time, end_time, status, slot_period, reason_for_visit, patient:profiles(full_name)",
            )
            .order("start_time", { ascending: true })
            .limit(50);

          if (!error && data && !cancelled) {
            setItems((data as unknown as Row[]).map(mapRow));
            setUsingSamples(false);
            setLoading(false);
            return;
          }
        } catch {
          // Unreachable — fall through to the sample queue.
        }
      }

      // Deferred so state is never written synchronously inside the effect.
      await Promise.resolve();
      if (cancelled) return;
      setItems(sampleQueue());
      setUsingSamples(true);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const todays = items.filter((item) => item.appointmentDate === today);
  const upcoming = items.filter((item) => item.appointmentDate !== today);

  return (
    <main className="home-page">
      <Topbar label="DOCTOR DASHBOARD" />

      <section className="welcome" style={{ paddingBottom: 20 }}>
        <p className="eyebrow">PHYSICIAN WORKSPACE</p>
        <h1>Today&apos;s schedule</h1>
        <p className="welcome-copy">
          {loading
            ? "Loading your queue…"
            : `${todays.length} appointment${todays.length === 1 ? "" : "s"} today, ${upcoming.length} upcoming.`}
        </p>
      </section>

      {usingSamples ? (
        <div
          role="status"
          style={{
            marginTop: 6,
            padding: "14px 16px",
            borderRadius: 8,
            background: "#fde6ca",
            border: "2px solid #dc6803",
            color: "#7a2e05",
            fontSize: 16,
          }}
        >
          Showing a sample queue — run the Phase 05 migration to load your real appointments.
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          style={{
            marginTop: 18,
            padding: "14px 16px",
            borderRadius: 8,
            background: "#fee4e2",
            border: "2px solid var(--red)",
            color: "#7a271a",
            fontSize: 16,
          }}
        >
          {actionError}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="next-steps" style={{ marginTop: 26 }}>
          <h2>
            <span className="anchor-target" id="empty-queue" />
            No appointments scheduled
          </h2>
          <p>Patient bookings will appear here as soon as they are confirmed.</p>
        </div>
      ) : null}

      {todays.length > 0 ? (
        <section aria-label="Today" style={{ display: "grid", gap: 14, marginTop: 20 }}>
          <h2 style={{ fontSize: 22, margin: "10px 0 0" }}>Today</h2>
          {todays.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              isToday
              busy={busyId === item.id}
              onAction={(status) => void updateStatus(item.id, status)}
            />
          ))}
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section aria-label="Upcoming" style={{ display: "grid", gap: 14, marginTop: 28 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>Upcoming</h2>
          {upcoming.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              isToday={false}
              busy={busyId === item.id}
              onAction={(status) => void updateStatus(item.id, status)}
            />
          ))}
        </section>
      ) : null}

      <AIDiagnosticDrawer />

      <p className="welcome-copy" style={{ marginTop: 32, fontSize: 16 }}>
        <Link href="/">← Back to home</Link>
      </p>
    </main>
  );
}
