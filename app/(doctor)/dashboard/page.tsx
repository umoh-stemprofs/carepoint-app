"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Icon from "@/components/common/Icon";
import MeetingLink from "@/components/common/MeetingLink";
import Topbar from "@/components/common/Topbar";
import VideoCallButton from "@/components/common/VideoCall";
import AIDiagnosticDrawer from "@/components/doctor/AIDiagnosticDrawer";
import PatientProfileModal from "@/components/doctor/PatientProfileModal";
import ScheduleManager from "@/components/doctor/ScheduleManager";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat, watDateOnly } from "@/lib/utils/datetime";

type Status = "pending" | "confirmed" | "completed" | "cancelled";

type QueueItem = {
  id: string;
  patientId: string;
  patientName: string;
  startTime: string;
  endTime: string;
  status: Status;
  slotPeriod: string;
  reasonForVisit: string;
  appointmentDate: string;
  meetingUrl: string | null;
};

type Row = {
  id: string;
  patient_id: string;
  start_time: string;
  end_time: string;
  status: Status;
  slot_period: string;
  reason_for_visit: string;
  appointment_date: string;
  meeting_url?: string | null;
  patient?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
};

/**
 * Status colours follow the design system's roles: green stays confirmed/go,
 * red stays reserved for emergencies.
 *  - confirmed -> primary
 *  - pending   -> amber (the one non-token hue the Stitch samples use)
 *  - completed -> secondary
 *  - cancelled -> tertiary (validation red, not the emergency crimson)
 */
const BADGE_CLASSES: Record<Status, string> = {
  confirmed: "bg-primary-fixed text-on-primary-fixed border-primary",
  pending: "bg-[#fef0c7] text-[#93370d] border-[#f79009]",
  completed: "bg-secondary-fixed text-on-secondary-fixed border-secondary",
  cancelled: "bg-tertiary-fixed text-on-tertiary-fixed border-tertiary",
};

const STATUS_ICONS: Record<Status, string> = {
  confirmed: "check_circle",
  pending: "pending_actions",
  completed: "task_alt",
  cancelled: "cancel",
};

function mapRow(row: Row): QueueItem {
  const embedded = Array.isArray(row.patient) ? row.patient[0] : row.patient;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: embedded?.full_name || "Patient",
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    slotPeriod: row.slot_period,
    reasonForVisit: row.reason_for_visit,
    appointmentDate: row.appointment_date,
    meetingUrl: row.meeting_url ?? null,
  };
}

type QueueAction = "confirmed" | "completed" | "cancelled";

function StatusButton({
  label,
  icon,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  tone: "primary" | "secondary" | "danger";
  disabled: boolean;
  onClick: () => void;
}) {
  const palette = {
    primary: "bg-primary text-white",
    secondary: "bg-secondary text-white",
    danger: "border-2 border-tertiary bg-white text-tertiary",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-14 items-center justify-center gap-2 rounded-lg px-4 text-label-lg press disabled:cursor-not-allowed disabled:opacity-45 ${palette}`}
    >
      <Icon name={icon} size={24} />
      {label}
    </button>
  );
}

function QueueCard({
  item,
  isToday,
  busy,
  linksSupported,
  onAction,
  onOpenRecord,
  onLinkChange,
}: {
  item: QueueItem;
  isToday: boolean;
  busy: boolean;
  linksSupported: boolean;
  onAction: (status: QueueAction) => void;
  onOpenRecord: (item: QueueItem) => void;
  onLinkChange: (id: string, url: string) => void;
}) {
  const isFinished = item.status === "completed" || item.status === "cancelled";

  return (
    <article
      className={`flex flex-col gap-space-xs rounded-xl border-2 bg-white p-space-sm ${
        isToday ? "border-secondary" : "border-surface-container-high"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-primary">
            <Icon name="person" size={32} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-headline-lg-mobile text-on-surface">{item.patientName}</div>
            <div className="flex items-center gap-1.5 text-body-lg text-on-surface-variant">
              <Icon name="schedule" size={20} />
              {formatInWat(item.startTime, "EEEE d MMMM yyyy")} ·{" "}
              {formatInWat(item.startTime, "h:mm a")} – {formatInWat(item.endTime, "h:mm a")} WAT
            </div>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-label-lg uppercase ${BADGE_CLASSES[item.status]}`}
        >
          <Icon name={STATUS_ICONS[item.status]} size={20} />
          {item.status}
        </span>
      </div>

      <p className="m-0 text-body-lg text-on-surface">{item.reasonForVisit}</p>

      <div className="flex flex-wrap gap-space-xs">
        <StatusButton
          label="Confirm"
          icon="check_circle"
          tone="primary"
          disabled={busy || item.status !== "pending"}
          onClick={() => onAction("confirmed")}
        />
        <StatusButton
          label="Complete"
          icon="task_alt"
          tone="secondary"
          disabled={busy || item.status !== "confirmed"}
          onClick={() => onAction("completed")}
        />
        <StatusButton
          label="Cancel"
          icon="cancel"
          tone="danger"
          disabled={busy || isFinished}
          onClick={() => onAction("cancelled")}
        />
      </div>

      <div className="mt-1 flex flex-wrap gap-space-xs">
        <button
          type="button"
          onClick={() => onOpenRecord(item)}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-secondary bg-white px-4 text-label-lg text-secondary press"
        >
          <Icon name="health_and_safety" size={24} />
          Patient record
        </button>
        {item.status !== "cancelled" ? (
          <VideoCallButton appointmentId={item.id} peerName={item.patientName} />
        ) : null}
      </div>

      {/* Fallback room, full width and unmissable: the in-app call is the
          primary path, but a symmetric NAT can defeat it with no TURN relay
          in this build — so the doctor gets a Jitsi room to hand over. */}
      {item.status !== "cancelled" ? (
        <MeetingLink
          appointmentId={item.id}
          peerLabel={item.patientName}
          meetingUrl={item.meetingUrl}
          supported={linksSupported}
          onChange={(url) => onLinkChange(item.id, url)}
        />
      ) : null}
    </article>
  );
}

export default function DoctorDashboardPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recordItem, setRecordItem] = useState<QueueItem | null>(null);
  // False if migration 0010 is pending: the first select then fails on the
  // unknown meeting_url column and the retry drops it, so the queue still
  // renders — just without the room button.
  const [linksSupported, setLinksSupported] = useState(true);
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
      // A no-op update means the row disappeared while the list was open.
      if (!data || data.length === 0) {
        throw new Error("That appointment is no longer in the database. Reload the page.");
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
      // Established first so the queue and the client agree on today's date.
      await Promise.resolve();
      if (cancelled) return;
      setToday(watDateOnly(new Date()));

      const supabase = tryCreateSupabaseBrowserClient();

      if (supabase) {
        const columns =
          "id, patient_id, appointment_date, start_time, end_time, status, slot_period, reason_for_visit, meeting_url, patient:profiles(full_name)";
        const columnsWithoutLink = columns.replace(
          ", meeting_url, patient:profiles(full_name)",
          ", patient:profiles(full_name)",
        );

        // Try the link column first, drop it only if the database does not
        // know it yet — the effect runs once on mount, so there is no state
        // to read here; the first failure is the only signal needed.
        for (const select of [columns, columnsWithoutLink]) {
          try {
            const { data, error } = await supabase
              .from("appointments")
              .select(select)
              .order("start_time", { ascending: true })
              .limit(50);

            if (error) {
              if (select === columns) {
                setLinksSupported(false);
                continue;
              }
              if (!cancelled) setLoadError(error.message);
              return;
            }
            if (!cancelled && data) {
              setItems((data as unknown as Row[]).map(mapRow));
              setLoading(false);
              return;
            }
          } catch (error) {
            if (!cancelled) {
              setLoadError(error instanceof Error ? error.message : "the queue was unreachable");
              return;
            }
          }
        }
      }

      // Deferred so state is never written synchronously inside the effect.
      await Promise.resolve();
      if (cancelled) return;
      setItems([]);
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

      <section className="welcome">
        <p className="eyebrow">PHYSICIAN WORKSPACE</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">Today&apos;s schedule</h1>
        <p className="welcome-copy">
          {loading
            ? "Loading your queue…"
            : `${todays.length} appointment${todays.length === 1 ? "" : "s"} today, ${upcoming.length} upcoming.`}
        </p>
      </section>

      {loadError ? (
        <div
          role="alert"
          className="mb-space-sm flex items-start gap-space-xs rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <Icon name="error" size={28} className="mt-0.5 shrink-0" />
          <span>Your queue could not be loaded: {loadError}</span>
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="mb-space-sm flex items-center gap-space-xs rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <Icon name="error" size={28} className="shrink-0" />
          {actionError}
        </div>
      ) : null}

      {/* Plan 9.2: the doctor decides which parts of the day are open. */}
      <ScheduleManager />

      {!loading && !loadError && items.length === 0 ? (
        <div className="mt-space-md rounded-xl border-2 border-outline-variant bg-white p-space-md">
          <h2 className="flex items-center gap-2 text-headline-lg-mobile text-on-surface">
            <Icon name="event" size={30} className="text-primary" />
            <span className="anchor-target" id="empty-queue" />
            No appointments scheduled
          </h2>
          <p className="mt-2 text-body-lg text-on-surface-variant">
            Patient bookings will appear here as soon as they are confirmed.
          </p>
        </div>
      ) : null}

      {todays.length > 0 ? (
        <section aria-label="Today" className="flex flex-col gap-space-sm">
          <h2 className="flex items-center gap-2 text-headline-lg-mobile text-on-surface">
            <Icon name="today" size={28} className="text-secondary" />
            Today
          </h2>
          {todays.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              isToday
              busy={busyId === item.id}
              linksSupported={linksSupported}
              onAction={(status) => void updateStatus(item.id, status)}
              onOpenRecord={setRecordItem}
              onLinkChange={(id, url) =>
                setItems((previous) =>
                  previous.map((row) => (row.id === id ? { ...row, meetingUrl: url } : row)),
                )
              }
            />
          ))}
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section aria-label="Upcoming" className="mt-space-xl flex flex-col gap-space-sm">
          <h2 className="flex items-center gap-2 text-headline-lg-mobile text-on-surface">
            <Icon name="calendar_month" size={28} className="text-secondary" />
            Upcoming
          </h2>
          {upcoming.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              isToday={false}
              busy={busyId === item.id}
              linksSupported={linksSupported}
              onAction={(status) => void updateStatus(item.id, status)}
              onOpenRecord={setRecordItem}
              onLinkChange={(id, url) =>
                setItems((previous) =>
                  previous.map((row) => (row.id === id ? { ...row, meetingUrl: url } : row)),
                )
              }
            />
          ))}
        </section>
      ) : null}

      <AIDiagnosticDrawer />

      {recordItem ? (
        <PatientProfileModal item={recordItem} onClose={() => setRecordItem(null)} />
      ) : null}

      <p className="mt-space-lg text-body-lg">
        <Link href="/" className="text-primary">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
