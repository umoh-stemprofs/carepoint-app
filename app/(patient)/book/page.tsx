"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Topbar from "@/components/common/Topbar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { bookingSchema, type BookingInput } from "@/lib/validations/booking";
import type { SlotPeriod } from "@/lib/types";
import { addHours, formatInWat, watDateOnly, watLocalToUtc } from "@/lib/utils/datetime";

type DoctorOption = {
  id: string;
  name: string;
  specialty: string;
  isMock: boolean;
};

type DoctorRow = {
  id: string;
  specialty: string | null;
  is_accepting_bookings: boolean;
  profiles?: { full_name?: string } | Array<{ full_name?: string }> | null;
};

/** Shown when the doctors table is empty or not migrated yet. */
const MOCK_DOCTORS: DoctorOption[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Dr. Sarah Adeyemi",
    specialty: "General practice",
    isMock: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Dr. Emeka Nwosu",
    specialty: "Internal medicine",
    isMock: true,
  },
];

/** Fixed WAT wall-clock slots (plan Phase 07, Step 2). */
const TIME_SLOTS: Array<{ period: SlotPeriod; time: string; label: string }> = [
  { period: "morning", time: "09:00", label: "MORNING" },
  { period: "midday", time: "12:00", label: "MIDDAY" },
  { period: "afternoon", time: "15:00", label: "AFTERNOON" },
  { period: "evening", time: "17:00", label: "EVENING" },
];

const DAY_LABELS = ["TODAY", "TOMORROW", "NEXT DAY"] as const;

const bannerBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "16px 18px",
  borderRadius: 8,
  fontSize: 18,
  lineHeight: 1.45,
  marginTop: 22,
};

export default function BookPage() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [usingMocks, setUsingMocks] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState<string | null>(null);
  const [slotPeriod, setSlotPeriod] = useState<SlotPeriod | null>(null);
  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived on entry to step 2 (an event handler), never during render:
  // Next.js rejects Date.now() at prerender, and React rejects setState in an
  // effect. Computing it in the click handler satisfies both.
  const [days, setDays] = useState<Array<{ label: string; date: string }>>([]);

  function ensureDays() {
    if (days.length > 0) return;
    setDays(
      DAY_LABELS.map((label, index) => ({
        label,
        date: watDateOnly(new Date(Date.now() + index * 24 * 60 * 60 * 1000)),
      })),
    );
  }

  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId) ?? null;
  const selectedSlot = TIME_SLOTS.find((slot) => slot.period === slotPeriod) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function loadDoctors() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("doctors")
          .select("id, specialty, is_accepting_bookings, profiles(full_name)")
          .eq("is_accepting_bookings", true)
          .limit(10);

        if (!cancelled && !error && data && data.length > 0) {
          const rows = data as unknown as DoctorRow[];
          setDoctors(
            rows.map((row) => {
              const embedded = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
              return {
                id: row.id,
                name: embedded?.full_name || row.specialty || "CarePoint doctor",
                specialty: row.specialty || "General practice",
                isMock: false,
              };
            }),
          );
          setUsingMocks(false);
          return;
        }
      } catch {
        // Network or unconfigured Supabase — fall through to the mock list.
      }

      if (!cancelled) {
        setDoctors(MOCK_DOCTORS);
        setUsingMocks(true);
      }
    }

    loadDoctors();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetBanner() {
    setConflict(null);
    setFailure(null);
  }

  function goNext(from: number) {
    resetBanner();
    const target = from + 1;
    if (target === 2) ensureDays();
    setStep(target);
  }

  function goBack(from: number) {
    resetBanner();
    const target = from - 1;
    if (target === 2) ensureDays();
    setStep(target);
  }

  function buildPayload(): BookingInput | null {
    if (!doctorId || !dateStr || !slotPeriod || !selectedSlot) return null;

    const start = watLocalToUtc(dateStr, selectedSlot.time);
    const end = addHours(start, 1);

    return {
      doctorId,
      appointmentDate: dateStr,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      slotPeriod,
      reasonForVisit: reason.trim(),
    };
  }

  async function submitBooking() {
    resetBanner();

    const payload = buildPayload();
    if (!payload) {
      setFailure("Please complete every step before confirming.");
      return;
    }

    const parsed = bookingSchema.safeParse(payload);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      setStep(3);
      return;
    }
    setIssues([]);

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setFailure("Your session has expired. Please log in again, then retry the booking.");
        return;
      }

      const { error: rpcError } = await supabase.rpc("book_appointment_prevent_overlap", {
        p_patient_id: user.id,
        p_doctor_id: parsed.data.doctorId,
        p_appointment_date: parsed.data.appointmentDate,
        p_start_time: parsed.data.startTime,
        p_end_time: parsed.data.endTime,
        p_slot_period: parsed.data.slotPeriod,
        p_reason_for_visit: parsed.data.reasonForVisit,
      });

      if (rpcError) {
        const code = (rpcError as { code?: string }).code ?? "";
        const message = rpcError.message ?? "";
        const isConflict =
          code === "23505" ||
          /slot already booked|duplicate key|prevent_double_booking/i.test(message);

        if (isConflict) {
          setConflict(
            "That time slot was just taken by someone else. Please go back and pick another time slot.",
          );
          setStep(2);
        } else {
          setFailure(
            `We could not record that booking: ${message || "the booking service is unavailable"}. ${
              usingMocks ? "No doctors table is available yet, so mock doctors cannot be booked." : ""
            }`.trim(),
          );
        }
        return;
      }

      router.push("/appointments?booked=1");
    } catch {
      setFailure("We could not reach the booking service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const tileStyle = (active: boolean, primary: boolean): React.CSSProperties => ({
    minHeight: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 6,
    padding: "18px 20px",
    borderRadius: 8,
    border: active ? "4px solid var(--foreground)" : "2px solid var(--line)",
    background: active ? (primary ? "var(--green)" : "var(--blue)") : "#fff",
    color: active ? "#fff" : "var(--foreground)",
    textAlign: "left",
    cursor: "pointer",
    fontSize: 17,
    fontWeight: 700,
  });

  const primaryButton: React.CSSProperties = {
    width: "100%",
    minHeight: 64,
    marginTop: 24,
    fontSize: 20,
    fontWeight: 750,
    borderRadius: 8,
    border: "none",
    background: "var(--green)",
    color: "#fff",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
  };

  const secondaryButton: React.CSSProperties = {
    minHeight: 60,
    marginTop: 24,
    fontSize: 18,
    fontWeight: 700,
    borderRadius: 8,
    border: "2px solid var(--line)",
    background: "#fff",
    color: "var(--foreground)",
    cursor: "pointer",
    width: "100%",
  };

  return (
    <main className="home-page">
      <Topbar label="BOOK A DOCTOR" />

      <section className="welcome" style={{ paddingBottom: 24 }}>
        <p className="eyebrow">STEP {step} OF 4</p>
        <h1>
          {step === 1 && "Choose your doctor"}
          {step === 2 && "Pick a day and time"}
          {step === 3 && "Why are you visiting?"}
          {step === 4 && "Check and confirm"}
        </h1>
      </section>

      {conflict ? (
        <div
          role="alert"
          style={{
            ...bannerBase,
            background: "#fde6ca",
            border: "3px solid #dc6803",
            color: "#7a2e05",
            fontWeight: 700,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 26, marginRight: 12 }}>
            ⚠
          </span>
          {conflict}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          style={{ ...bannerBase, background: "#fee4e2", border: "2px solid var(--red)", color: "#7a271a" }}
        >
          {failure}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div role="alert" style={{ ...bannerBase, background: "#fee4e2", border: "2px solid var(--red)" }}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 1 ? (
        <>
          {usingMocks ? (
            <p className="welcome-copy" style={{ fontSize: 16 }}>
              No live doctor list is available yet, so these sample doctors are shown.
            </p>
          ) : null}
          <section className="action-grid" aria-label="Available doctors" style={{ marginTop: 18 }}>
            {doctors.map((doctor, index) => (
              <button
                key={doctor.id}
                type="button"
                onClick={() => setDoctorId(doctor.id)}
                aria-pressed={doctorId === doctor.id}
                style={tileStyle(doctorId === doctor.id, true)}
              >
                <span style={{ fontSize: 13, opacity: 0.85 }}>
                  {String(index + 1).padStart(2, "0")} / AVAILABLE
                </span>
                <span style={{ fontSize: 24, fontWeight: 740 }}>{doctor.name}</span>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{doctor.specialty}</span>
              </button>
            ))}
          </section>
          <button
            type="button"
            onClick={() => goNext(1)}
            disabled={!doctorId}
            style={{ ...primaryButton, opacity: doctorId && !busy ? 1 : 0.5 }}
          >
            NEXT
          </button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <section aria-label="Choose a day" style={{ display: "grid", gap: 12 }}>
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                onClick={() => setDateStr(day.date)}
                aria-pressed={dateStr === day.date}
                style={tileStyle(dateStr === day.date, false)}
              >
                <span style={{ fontSize: 22 }}>{day.label}</span>
                <span style={{ fontSize: 16, fontWeight: 500 }}>
                  {formatInWat(day.date, "EEEE d MMMM yyyy")}
                </span>
              </button>
            ))}
          </section>

          <h2 style={{ fontSize: 22, marginTop: 30 }}>Pick a time (West Africa Time)</h2>
          <section
            aria-label="Choose a time"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}
          >
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot.period}
                type="button"
                onClick={() => setSlotPeriod(slot.period)}
                aria-pressed={slotPeriod === slot.period}
                style={tileStyle(slotPeriod === slot.period, true)}
              >
                <span style={{ fontSize: 20 }}>{slot.label}</span>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{slot.time} WAT</span>
              </button>
            ))}
          </section>

          <button
            type="button"
            onClick={() => goNext(2)}
            disabled={!dateStr || !slotPeriod}
            style={{ ...primaryButton, opacity: dateStr && slotPeriod ? 1 : 0.5 }}
          >
            NEXT
          </button>
          <button type="button" onClick={() => goBack(2)} style={secondaryButton}>
            BACK
          </button>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <label
            htmlFor="reason"
            style={{ display: "block", fontSize: 17, fontWeight: 700, marginBottom: 8 }}
          >
            Reason for visit
          </label>
          <textarea
            id="reason"
            rows={5}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Describe your symptoms, for example: fever and headache for three days"
            style={{
              width: "100%",
              fontSize: 19,
              padding: 14,
              border: "2px solid var(--line)",
              borderRadius: 8,
              background: "#fff",
              color: "var(--foreground)",
              resize: "vertical",
            }}
          />
          <p style={{ fontSize: 15, color: "#435249", marginTop: 8 }}>
            Between 3 and 1000 characters.
          </p>

          <button
            type="button"
            onClick={() => {
              const payload = buildPayload();
              if (!payload) {
                setIssues(["Complete every earlier step before continuing."]);
                return;
              }
              const parsed = bookingSchema.safeParse(payload);
              if (!parsed.success) {
                setIssues(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
                return;
              }
              setIssues([]);
              goNext(3);
            }}
            style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}
          >
            REVIEW BOOKING
          </button>
          <button type="button" onClick={() => goBack(3)} style={secondaryButton}>
            BACK
          </button>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <div
            style={{
              border: "3px solid var(--line)",
              borderRadius: 10,
              padding: 22,
              background: "#fff",
              display: "grid",
              gap: 14,
            }}
          >
            {[
              ["Doctor", selectedDoctor?.name ?? "—"],
              ["Day", days.find((day) => day.date === dateStr)?.label ?? "—"],
              [
                "Date",
                dateStr ? formatInWat(dateStr, "EEEE d MMMM yyyy") : "—",
              ],
              ["Time", selectedSlot ? `${selectedSlot.time} WAT` : "—"],
              ["Reason", reason.trim() || "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#435249" }}>{label}</span>
                <span style={{ fontSize: 17, textAlign: "right" }}>{value}</span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 15, color: "#435249", marginTop: 14 }}>
            Times are shown in West Africa Time (WAT). Your slot is only held once the booking
            is confirmed.
          </p>

          <button
            type="button"
            onClick={submitBooking}
            disabled={busy}
            style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "BOOKING…" : "CONFIRM & BOOK"}
          </button>
          <button type="button" onClick={() => goBack(4)} disabled={busy} style={secondaryButton}>
            BACK
          </button>
        </>
      ) : null}

      <p className="welcome-copy" style={{ marginTop: 32, fontSize: 16 }}>
        <Link href="/">← Back to home</Link>
      </p>
    </main>
  );
}
