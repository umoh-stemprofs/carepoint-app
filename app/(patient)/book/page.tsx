"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
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
const TIME_SLOTS: Array<{ period: SlotPeriod; time: string; label: string; icon: string }> = [
  { period: "morning", time: "09:00", label: "MORNING", icon: "wb_sunny" },
  { period: "midday", time: "12:00", label: "MIDDAY", icon: "light_mode" },
  { period: "afternoon", time: "15:00", label: "AFTERNOON", icon: "wb_twilight" },
  { period: "evening", time: "17:00", label: "EVENING", icon: "dark_mode" },
];

const DAY_LABELS = ["TODAY", "TOMORROW", "NEXT DAY"] as const;
const DAY_ICONS = ["wb_sunny", "partly_cloudy_day", "event"] as const;

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

  const stepTitle =
    step === 1
      ? "Choose your doctor"
      : step === 2
        ? "Pick a day and time"
        : step === 3
          ? "Why are you visiting?"
          : "Check and confirm";

  return (
    <main className="home-page">
      <Topbar label="BOOK A DOCTOR" />

      <header className="flex flex-wrap items-center justify-between gap-space-sm py-space-sm">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => goBack(step)}
            className="flex min-h-16 items-center gap-space-xs rounded-lg bg-surface-container-high px-space-sm text-on-surface press"
          >
            <Icon name="arrow_back" size={28} />
            <span className="text-label-lg uppercase">Back</span>
          </button>
        ) : (
          <Link
            href="/"
            className="flex min-h-16 items-center gap-space-xs rounded-lg bg-surface-container-high px-space-sm text-on-surface no-underline press"
          >
            <Icon name="arrow_back" size={28} />
            <span className="text-label-lg uppercase">Home</span>
          </Link>
        )}

        <span className="rounded-full bg-surface-container-high px-space-sm py-1.5 text-label-lg text-primary">
          STEP {step} OF 4
        </span>
      </header>

      <section className="pb-space-md">
        <h1 className="text-headline-lg-mobile sm:text-headline-lg">{stepTitle}</h1>
      </section>

      {/* Status banners: same conditions and copy as before, new skin. */}
      {conflict ? (
        <div
          role="alert"
          className="mb-space-sm flex items-center gap-space-xs rounded-lg border-2 border-[#dc6803] bg-[#fde6ca] px-space-sm py-space-xs text-body-lg font-bold text-[#7a2e05]"
        >
          <Icon name="warning" size={28} className="shrink-0" />
          {conflict}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="mb-space-sm flex items-center gap-space-xs rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <Icon name="error" size={28} className="shrink-0" />
          {failure}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div
          role="alert"
          className="mb-space-sm rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <ul className="m-0 list-disc pl-6">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 1 ? (
        <>
          <div className="mb-space-sm flex items-center gap-space-xs rounded-lg bg-surface-container-low p-space-xs">
            <Icon name="touch_app" size={30} className="text-primary" />
            <p className="text-body-lg text-on-surface-variant">
              Tap a doctor card to begin your visit
            </p>
          </div>

          {usingMocks ? (
            <p className="mb-space-xs text-body-lg text-on-surface-variant">
              No live doctor list is available yet, so these sample doctors are shown.
            </p>
          ) : null}

          <section aria-label="Available doctors" className="flex flex-col gap-space-sm">
            {doctors.map((doctor) => {
              const selected = doctorId === doctor.id;
              return (
                <article
                  key={doctor.id}
                  className={`flex flex-col gap-space-xs rounded-xl border-2 p-space-sm ${
                    selected
                      ? "border-primary bg-primary-fixed"
                      : "border-outline-variant bg-white"
                  }`}
                >
                  <div className="flex items-center gap-space-sm">
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-primary">
                      <Icon name="person" size={44} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-headline-lg-mobile text-on-surface">
                        {doctor.name}
                      </h2>
                      <p className="text-body-lg text-on-surface-variant">{doctor.specialty}</p>
                      <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-primary px-space-xs py-1 text-label-lg uppercase text-white">
                        <span className="inline-block h-3 w-3 rounded-full bg-white" aria-hidden="true" />
                        {doctor.isMock ? "Sample" : "Available now"}
                      </span>
                    </div>

                    <SpeakButton
                      phrase={`${doctor.name}, ${doctor.specialty}. Tap select to choose this doctor.`}
                      label={`Listen to ${doctor.name} introduction`}
                      className="bg-surface-container-high text-on-surface"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setDoctorId(doctor.id)}
                    aria-pressed={selected}
                    className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-xl text-label-xl text-white press ${
                      selected ? "bg-primary shadow-tactile-sm" : "bg-primary-container"
                    }`}
                  >
                    <Icon name={selected ? "done_all" : "check_circle"} size={36} />
                    {selected ? "SELECTED" : "SELECT"}
                  </button>
                </article>
              );
            })}
          </section>

          <button
            type="button"
            onClick={() => goNext(1)}
            disabled={!doctorId}
            className="mt-space-md flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press disabled:cursor-not-allowed disabled:opacity-50"
          >
            NEXT
            <Icon name="arrow_forward" size={30} />
          </button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <section aria-label="Choose a day">
            <div className="mb-space-xs flex items-center gap-2">
              <Icon name="calendar_month" size={30} className="text-secondary" />
              <h2 className="text-headline-lg-mobile text-on-surface">Choose day</h2>
            </div>

            <div role="radiogroup" aria-label="Consultation day" className="grid grid-cols-3 gap-3">
              {days.map((day, index) => {
                const active = dateStr === day.date;
                return (
                  <button
                    key={day.date}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDateStr(day.date)}
                    className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl p-3 press ${
                      active
                        ? "bg-secondary text-white shadow-tactile-sm"
                        : "bg-surface-container-high text-on-surface"
                    }`}
                  >
                    <Icon name={DAY_ICONS[index] ?? "event"} size={36} />
                    <span className="text-label-lg uppercase">{day.label}</span>
                  </button>
                );
              })}
            </div>

            {days.length > 0 ? (
              <p className="mt-space-xs text-body-lg text-on-surface-variant">
                {dateStr
                  ? formatInWat(dateStr, "EEEE d MMMM yyyy")
                  : "Pick today, tomorrow or the next day."}
              </p>
            ) : null}
          </section>

          <section aria-label="Choose a time" className="mt-space-lg">
            <div className="mb-space-xs flex items-center justify-between gap-space-xs">
              <h2 className="text-headline-lg-mobile text-on-surface">Pick time</h2>
              <SpeakButton
                phrase="Pick a time. Morning at 9, midday at 12, afternoon at 3, or evening at 5, West Africa Time."
                label="Listen to the time options"
                className="bg-secondary text-white"
              />
            </div>
            <p className="mb-space-xs text-body-lg text-on-surface-variant">
              All times are West Africa Time (WAT).
            </p>

            <div role="radiogroup" aria-label="Time of day" className="grid grid-cols-2 gap-3">
              {TIME_SLOTS.map((slot) => {
                const active = slotPeriod === slot.period;
                return (
                  <button
                    key={slot.period}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSlotPeriod(slot.period)}
                    className={`relative flex min-h-36 flex-col items-start justify-between gap-2 rounded-xl p-4 press ${
                      active
                        ? "bg-primary-container text-white shadow-tactile-sm"
                        : "bg-surface-container-low text-on-surface"
                    }`}
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                        active ? "bg-primary text-white" : "bg-surface-container-high text-primary"
                      }`}
                    >
                      <Icon name={slot.icon} size={28} />
                    </span>
                    <span className="flex flex-col text-left">
                      <span className="text-label-lg uppercase">{slot.label}</span>
                      <span className="text-headline-lg-mobile">{slot.time}</span>
                    </span>
                    {active ? (
                      <span className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-primary">
                        <Icon name="check" size={22} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="mt-space-sm flex items-center gap-space-xs rounded-xl bg-surface-container-high p-space-xs">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-primary">
              <Icon name="video_call" size={32} />
            </span>
            <span className="flex flex-col">
              <span className="text-label-lg text-on-surface">Doctor video call</span>
              <span className="text-body-lg text-on-surface-variant">
                Booked for West Africa Time
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => goNext(2)}
            disabled={!dateStr || !slotPeriod}
            className="mt-space-md flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press disabled:cursor-not-allowed disabled:opacity-50"
          >
            NEXT
            <Icon name="arrow_forward" size={30} />
          </button>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <label
            htmlFor="reason"
            className="mb-2 flex items-center gap-2 text-label-lg text-on-surface"
          >
            <Icon name="description" size={26} className="text-primary" />
            Reason for visit
          </label>
          <textarea
            id="reason"
            rows={5}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Describe your symptoms, for example: fever and headache for three days"
            className="min-h-40 w-full resize-y rounded-xl bg-surface-container-low p-4 text-body-xl text-on-surface placeholder:text-outline focus:bg-white"
          />
          <p className="mt-2 text-body-lg text-on-surface-variant">Between 3 and 1000 characters.</p>

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
            className="mt-space-md flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press"
          >
            REVIEW BOOKING
            <Icon name="arrow_forward" size={30} />
          </button>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <div className="flex flex-col gap-space-xs rounded-xl border-2 border-outline-variant bg-white p-space-md">
            {[
              ["Doctor", selectedDoctor?.name ?? "—"],
              ["Day", days.find((day) => day.date === dateStr)?.label ?? "—"],
              ["Date", dateStr ? formatInWat(dateStr, "EEEE d MMMM yyyy") : "—"],
              ["Time", selectedSlot ? `${selectedSlot.time} WAT` : "—"],
              ["Reason", reason.trim() || "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-surface-container-high pb-space-xs last:border-0">
                <span className="text-label-lg text-on-surface-variant">{label}</span>
                <span className="text-body-lg text-right text-on-surface">{value}</span>
              </div>
            ))}
          </div>

          <p className="mt-space-sm text-body-lg text-on-surface-variant">
            Your slot is only held once the booking is confirmed.
          </p>

          <button
            type="button"
            onClick={submitBooking}
            disabled={busy}
            className="mt-space-md flex min-h-18 w-full items-center justify-center gap-space-xs rounded-xl bg-primary-container text-label-xl text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
          >
            <Icon name="calendar_check" size={36} />
            {busy ? "BOOKING…" : "CONFIRM & BOOK"}
          </button>
        </>
      ) : null}

      <p className="mt-space-lg text-body-lg">
        <Link href="/" className="text-primary">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
