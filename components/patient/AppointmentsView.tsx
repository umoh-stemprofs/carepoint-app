"use client";

import { useEffect, useState } from "react";

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

const BADGE_STYLES: Record<Status, React.CSSProperties> = {
  confirmed: { background: "#dcfae6", border: "2px solid #12b76a", color: "#05603a" },
  pending: { background: "#fef0c7", border: "2px solid #f79009", color: "#93370d" },
  completed: { background: "#e0e7ff", border: "2px solid #6172f3", color: "#3538cd" },
  cancelled: { background: "#fee4e2", border: "2px solid #f04438", color: "#7a271a" },
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
    return <p className="welcome-copy">Loading your appointments…</p>;
  }

  return (
    <>
      {usingSamples ? (
        <div
          role="status"
          style={{
            marginTop: 18,
            padding: "14px 16px",
            borderRadius: 8,
            background: "#fde6ca",
            border: "2px solid #dc6803",
            color: "#7a2e05",
            fontSize: 16,
          }}
        >
          Showing sample appointments{loadError ? ` — your records could not be loaded` : ""}.
          Run the Phase 05 migration to see your real bookings.
        </div>
      ) : null}

      {appointments.length === 0 ? (
        <div className="next-steps" style={{ marginTop: 30 }}>
          <h2>
            <span className="anchor-target" id="no-appointments" />
            Nothing scheduled yet
          </h2>
          <p>Book a visit and it will appear here with its date, time and status.</p>
        </div>
      ) : (
        <section aria-label="Your appointments" style={{ display: "grid", gap: 16, marginTop: 22 }}>
          {appointments.map((appointment) => (
            <article
              key={appointment.id}
              style={{
                border: "2px solid var(--line)",
                borderRadius: 10,
                padding: 20,
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 14,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 21, fontWeight: 740 }}>{appointment.doctorName}</div>
                  <div style={{ fontSize: 16, color: "#435249" }}>{appointment.specialty}</div>
                </div>
                <span
                  style={{
                    ...BADGE_STYLES[appointment.status],
                    textTransform: "uppercase",
                    fontSize: 13,
                    fontWeight: 750,
                    letterSpacing: "0.06em",
                    borderRadius: 6,
                    padding: "6px 12px",
                  }}
                >
                  {appointment.status}
                </span>
              </div>

              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "8px 18px",
                  marginTop: 16,
                  marginBottom: 0,
                }}
              >
                <dt style={{ fontSize: 15, fontWeight: 700, color: "#435249" }}>When</dt>
                <dd style={{ fontSize: 17, margin: 0 }}>
                  {formatInWat(appointment.startTime, "EEEE d MMMM yyyy")}
                  {" · "}
                  {formatInWat(appointment.startTime, "h:mm a")} –{" "}
                  {formatInWat(appointment.endTime, "h:mm a")} WAT
                </dd>

                <dt style={{ fontSize: 15, fontWeight: 700, color: "#435249" }}>Reason</dt>
                <dd style={{ fontSize: 17, margin: 0 }}>{appointment.reasonForVisit}</dd>
              </dl>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
