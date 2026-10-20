"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/common/Icon";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SlotPeriod } from "@/lib/types";

/**
 * Plan 9.2 — the availability setter.
 *
 * Two switches, both on the `doctors` row the signed-in physician owns (RLS
 * `doctors_update_own` is what allows the write):
 *
 *   1. the master "accepting bookings" toggle, which removes or restores the
 *      doctor from the patient's booking wizard immediately (that query is
 *      filtered on `is_accepting_bookings`);
 *   2. per-period switches for morning / midday / afternoon / evening, stored
 *      in `doctors.closed_periods` and enforced again inside the booking RPC
 *      (migration 20261019000005), so a closed period is refused server-side
 *      even if a client never rendered the wizard.
 */

const PERIODS: Array<{ period: SlotPeriod; label: string; time: string }> = [
  { period: "morning", label: "Morning", time: "9:00 AM" },
  { period: "midday", label: "Midday", time: "12:00 PM" },
  { period: "afternoon", label: "Afternoon", time: "3:00 PM" },
  { period: "evening", label: "Evening", time: "5:00 PM" },
];

type DoctorRow = {
  specialty: string | null;
  is_accepting_bookings: boolean;
  closed_periods?: SlotPeriod[] | null;
};

export default function ScheduleManager() {
  const [loading, setLoading] = useState(true);
  const [hasRow, setHasRow] = useState(false);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(true);
  const [closed, setClosed] = useState<SlotPeriod[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = tryCreateSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (cancelled || !user) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data, error: loadError } = await supabase
        .from("doctors")
        .select("specialty, is_accepting_bookings, closed_periods")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;

      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        const row = data as DoctorRow;
        setHasRow(true);
        setSpecialty(row.specialty);
        setAccepting(row.is_accepting_bookings);
        setClosed(row.closed_periods ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /** Run a write against the doctor's own row, rolling back on refusal. */
  async function save(
    patch: { is_accepting_bookings?: boolean; closed_periods?: SlotPeriod[] },
    apply: () => void,
    confirm: string,
  ): Promise<void> {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured, so availability cannot be changed.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) {
      setError("Sign in again to change your availability.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    apply();

    try {
      const { data, error: writeError } = await supabase
        .from("doctors")
        .update(patch)
        .eq("id", user.id)
        .select("id");

      if (writeError) throw new Error(writeError.message);
      if (!data || data.length === 0) {
        // No row yet: create it, then re-apply the change on the fresh row.
        const { error: insertError } = await supabase
          .from("doctors")
          .insert({ id: user.id, ...patch });
        if (insertError) throw new Error(insertError.message);
        setHasRow(true);
      }

      setNotice(confirm);
    } catch (caught) {
      // Roll the optimistic change back so the screen never lies.
      setLoading(true);
      const { data } = await supabase
        .from("doctors")
        .select("specialty, is_accepting_bookings, closed_periods")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        const row = data as DoctorRow;
        setSpecialty(row.specialty);
        setAccepting(row.is_accepting_bookings);
        setClosed(row.closed_periods ?? []);
      }
      setError(caught instanceof Error ? caught.message : "The change did not save.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  function toggleAccepting(): void {
    const next = !accepting;
    void save(
      { is_accepting_bookings: next },
      () => setAccepting(next),
      next
        ? "You are open for bookings — patients can see you now."
        : "You are closed — patients can no longer pick you.",
    );
  }

  function togglePeriod(period: SlotPeriod): void {
    const next = closed.includes(period)
      ? closed.filter((value) => value !== period)
      : [...closed, period];
    void save({ closed_periods: next }, () => setClosed(next), "Your hours were updated.");
  }

  if (loading) {
    return (
      <section className="mb-space-sm rounded-xl border-2 border-outline-variant bg-white p-space-sm">
        <p className="m-0 text-body-lg text-on-surface-variant">Loading your availability…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="availability-heading"
      className="mb-space-sm rounded-xl border-2 border-outline-variant bg-white p-space-sm"
    >
      <div className="flex items-center gap-space-xs">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary text-white">
          <Icon name="event" size={28} />
        </span>
        <div className="min-w-0">
          <h2 id="availability-heading" className="text-headline-lg-mobile text-on-surface">
            Booking availability
          </h2>
          {specialty ? (
            <p className="m-0 text-body-lg text-on-surface-variant">{specialty}</p>
          ) : null}
        </div>
      </div>

      <p className="mt-space-xs text-body-lg text-on-surface-variant">
        Close a time of day to stop patients booking it. Changes apply to the booking
        wizard immediately.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-space-xs flex items-start gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
        >
          <Icon name="error" size={28} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mt-space-xs flex items-center gap-2 rounded-lg border-2 border-primary bg-primary-fixed px-space-sm py-space-xs text-body-lg font-bold text-on-primary-fixed"
        >
          <Icon name="check_circle" size={28} />
          {notice}
        </p>
      ) : null}

      {!hasRow ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void save({}, () => undefined, "Your doctor profile is ready.");
          }}
          className="mt-space-xs flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press disabled:opacity-60"
        >
          <Icon name="add" size={30} />
          SET UP MY DOCTOR PROFILE
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-pressed={accepting}
            disabled={busy}
            onClick={toggleAccepting}
            className={`mt-space-xs flex min-h-18 w-full items-center justify-between gap-space-xs rounded-xl px-space-sm text-label-xl press disabled:opacity-60 ${
              accepting ? "bg-primary text-white" : "bg-surface-container-highest text-on-surface-variant"
            }`}
          >
            <span className="flex items-center gap-space-xs">
              <Icon name={accepting ? "toggle_on" : "toggle_off"} size={34} />
              {accepting ? "OPEN FOR BOOKINGS" : "CLOSED FOR BOOKINGS"}
            </span>
            <span className="text-body-lg">
              {accepting ? "Patients can pick you" : "Hidden from patients"}
            </span>
          </button>

          <fieldset
            className="m-0 border-none p-0"
            disabled={busy || !accepting}
          >
            <legend className="mt-space-sm mb-space-xs flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="schedule" size={24} className="text-secondary" />
              Which parts of the day do you see patients?
            </legend>
            <div className="grid grid-cols-2 gap-space-xs">
              {PERIODS.map((entry) => {
                const isClosed = closed.includes(entry.period);
                return (
                  <button
                    key={entry.period}
                    type="button"
                    aria-pressed={!isClosed}
                    onClick={() => togglePeriod(entry.period)}
                    className={`flex min-h-24 flex-col items-start justify-between rounded-xl p-space-xs press ${
                      isClosed
                        ? "bg-surface-container-highest text-on-surface-variant"
                        : "bg-secondary-fixed text-on-secondary-fixed"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-label-lg uppercase">{entry.label}</span>
                      <Icon name={isClosed ? "close" : "check_circle"} size={24} />
                    </span>
                    <span className="text-body-lg">{entry.time}</span>
                    <span className="text-label-lg uppercase">
                      {isClosed ? "Closed" : "Open"}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
}
