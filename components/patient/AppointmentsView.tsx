"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
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
};

type Row = {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: Status;
  slot_period: string;
  reason_for_visit: string;
  doctors?: {
    specialty?: string | null;
    profiles?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  } | null;
};

/**
 * Shown while the schema is absent or the request fails, so the page still works.
 * Built on demand rather than at module scope: evaluating Date.now() while
 * prerendering is rejected by Next.js.
 */
function sampleAppointments(): AppointmentView[] {
  const day = 24 * 60 * 60 * 1000;
  return [
    {
      id: "sample-1",
      appointmentDate: new Date(Date.now() + day).toISOString().slice(0, 10),
      startTime: new Date(Date.now() + day + 8 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(Date.now() + day + 9 * 60 * 60 * 1000).toISOString(),
      status: "confirmed",
      slotPeriod: "morning",
      reasonForVisit: "Persistent fever for three days",
      doctorName: "Dr. Sarah Adeyemi",
      specialty: "General practice",
    },
    {
      id: "sample-2",
      appointmentDate: new Date(Date.now() + 3 * day).toISOString().slice(0, 10),
      startTime: new Date(Date.now() + 3 * day + 14 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(Date.now() + 3 * day + 15 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      slotPeriod: "afternoon",
      reasonForVisit: "Follow-up review",
      doctorName: "Dr. Emeka Nwosu",
      specialty: "Internal medicine",
    },
  ];
}

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
  };
}

export default function AppointmentsView() {
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = tryCreateSupabaseBrowserClient();

      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("appointments")
            .select(
              "id, appointment_date, start_time, end_time, status, slot_period, reason_for_visit, doctors(specialty, profiles(full_name))",
            )
            .order("start_time", { ascending: true })
            .limit(50);

          if (!error && data && !cancelled) {
            setAppointments((data as unknown as Row[]).map(mapRow));
            setUsingSamples(false);
            setLoading(false);
            return;
          }
          if (!cancelled && error) {
            setLoadError(error.message);
          }
        } catch (error) {
          if (!cancelled) setLoadError(error instanceof Error ? error.message : "unreachable");
        }
      }

      // Deferred so state is never written synchronously inside the effect.
      await Promise.resolve();
      if (cancelled) return;
      setAppointments(sampleAppointments());
      setUsingSamples(true);
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
      {usingSamples ? (
        <div
          role="status"
          className="mb-space-sm flex items-start gap-space-xs rounded-lg border-2 border-[#dc6803] bg-[#fde6ca] px-space-sm py-space-xs text-body-lg text-[#7a2e05]"
        >
          <Icon name="info" size={28} className="mt-0.5 shrink-0" />
          <span>
            Showing sample appointments{loadError ? " — your records could not be loaded" : ""}.
            Run the Phase 05 migration to see your real bookings.
          </span>
        </div>
      ) : null}

      {appointments.length === 0 ? (
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

              <div className="mt-1 flex justify-end">
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
