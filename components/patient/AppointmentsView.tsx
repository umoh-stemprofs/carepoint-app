"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/common/Icon";
import MeetingLink from "@/components/common/MeetingLink";
import SpeakButton from "@/components/common/SpeakButton";
import VideoCallButton from "@/components/common/VideoCall";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat } from "@/lib/utils/datetime";

type Status = "pending" | "confirmed" | "completed" | "cancelled";

type AppointmentView = {
  id: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  status: Status;
  slotPeriod: string;
  reasonForVisit: string;
  doctorName: string;
  specialty: string;
  meetingUrl: string | null;
};

type Row = {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: Status;
  slot_period: string;
  reason_for_visit: string;
  meeting_url?: string | null;
  doctors?: {
    specialty?: string | null;
    profiles?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  } | null;
};

/**
 * Status colours come from the design system's own roles, so green keeps its
 * single meaning (confirmed / go) and red stays reserved for emergencies:
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

function mapRow(row: Row): AppointmentView {
  const embedded = Array.isArray(row.doctors?.profiles)
    ? row.doctors.profiles[0]
    : row.doctors?.profiles;

  return {
    id: row.id,
    appointmentDate: row.appointment_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    slotPeriod: row.slot_period,
    reasonForVisit: row.reason_for_visit,
    doctorName: embedded?.full_name || "CarePoint doctor",
    specialty: row.doctors?.specialty || "General practice",
    meetingUrl: row.meeting_url ?? null,
  };
}

export default function AppointmentsView() {
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // False until proven otherwise: if migration 0010 is not applied the first
  // select fails on the unknown column, and the cards degrade to no room
  // button rather than to no appointments at all.
  const [linksSupported, setLinksSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = tryCreateSupabaseBrowserClient();

      if (supabase) {
        const columns =
          "id, appointment_date, start_time, end_time, status, slot_period, reason_for_visit, meeting_url, doctors(specialty, profiles(full_name))";
        const columnsWithoutLink = columns.replace(
          ", meeting_url, doctors(specialty, profiles(full_name))",
          ", doctors(specialty, profiles(full_name))",
        );

        // Always attempt with the link column first, then without: the loop
        // body is the graceful-degradation path for a pending migration.
        for (const select of [columns, columnsWithoutLink]) {
          try {
            const { data, error } = await supabase
              .from("appointments")
              .select(select)
              .order("start_time", { ascending: true })
              .limit(50);

            if (error) {
              if (select === columns) {
                // The meeting_url column is unknown: migration 0010 pending.
                setLinksSupported(false);
                continue;
              }
              if (!cancelled) setLoadError(error.message);
              return;
            }
            if (!cancelled && data) {
              setAppointments((data as unknown as Row[]).map(mapRow));
              setLoading(false);
              return;
            }
          } catch (error) {
            if (!cancelled) {
              setLoadError(error instanceof Error ? error.message : "unreachable");
              return;
            }
          }
        }
      }

      // Deferred so state is never written synchronously inside the effect.
      await Promise.resolve();
      if (cancelled) return;
      setAppointments([]);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-body-lg text-on-surface-variant">Loading your appointments…</p>;
  }

  return (
    <>
      {loadError ? (
        <div
          role="alert"
          className="mb-space-sm flex items-start gap-space-xs rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <Icon name="error" size={28} className="mt-0.5 shrink-0" />
          <span>Your appointments could not be loaded: {loadError}</span>
        </div>
      ) : null}

      {appointments.length === 0 && !loadError ? (
        <div className="mt-space-md rounded-xl border-2 border-outline-variant bg-white p-space-md">
          <h2 className="flex items-center gap-2 text-headline-lg-mobile text-on-surface">
            <Icon name="event" size={30} className="text-primary" />
            <span className="anchor-target" id="no-appointments" />
            Nothing scheduled yet
          </h2>
          <p className="mt-2 text-body-lg text-on-surface-variant">
            Book a visit and it will appear here with its date, time and status.
          </p>
        </div>
      ) : (
        <section aria-label="Your appointments" className="flex flex-col gap-space-sm">
          {appointments.map((appointment) => (
            <article
              key={appointment.id}
              className="flex flex-col gap-space-xs rounded-xl border-2 border-outline-variant bg-white p-space-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-primary">
                    <Icon name="person" size={32} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-headline-lg-mobile text-on-surface">
                      {appointment.doctorName}
                    </div>
                    <div className="text-body-lg text-on-surface-variant">
                      {appointment.specialty}
                    </div>
                  </div>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-label-lg uppercase ${BADGE_CLASSES[appointment.status]}`}
                >
                  <Icon name={STATUS_ICONS[appointment.status]} size={20} />
                  {appointment.status}
                </span>
              </div>

              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="flex items-center gap-1.5 text-label-lg text-on-surface-variant">
                  <Icon name="schedule" size={22} />
                  When
                </dt>
                <dd className="m-0 text-body-lg text-on-surface">
                  {formatInWat(appointment.startTime, "EEEE d MMMM yyyy")}
                  {" · "}
                  {formatInWat(appointment.startTime, "h:mm a")} –{" "}
                  {formatInWat(appointment.endTime, "h:mm a")} WAT
                </dd>

                <dt className="flex items-center gap-1.5 text-label-lg text-on-surface-variant">
                  <Icon name="description" size={22} />
                  Reason
                </dt>
                <dd className="m-0 text-body-lg text-on-surface">{appointment.reasonForVisit}</dd>
              </dl>

              {/* The fallback room, full width: the primary path is the
                  in-app call, but this must be impossible to miss. */}
              {appointment.status !== "cancelled" ? (
                <MeetingLink
                  appointmentId={appointment.id}
                  peerLabel={appointment.doctorName}
                  meetingUrl={appointment.meetingUrl}
                  supported={linksSupported}
                  onChange={(url) =>
                    setAppointments((previous) =>
                      previous.map((row) =>
                        row.id === appointment.id ? { ...row, meetingUrl: url } : row,
                      ),
                    )
                  }
                />
              ) : null}

              <div className="mt-1 flex flex-wrap items-center justify-end gap-space-xs">
                {appointment.status !== "cancelled" ? (
                  <VideoCallButton
                    appointmentId={appointment.id}
                    peerName={appointment.doctorName}
                  />
                ) : null}
                <SpeakButton
                  phrase={`Appointment with ${appointment.doctorName}, ${appointment.status}, on ${formatInWat(
                    appointment.startTime,
                    "EEEE d MMMM yyyy",
                  )} at ${formatInWat(appointment.startTime, "h:mm a")} West Africa Time. Reason: ${
                    appointment.reasonForVisit
                  }`}
                  label={`Listen to appointment with ${appointment.doctorName}`}
                  className="bg-surface-container-high text-on-surface"
                  size={52}
                />
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
