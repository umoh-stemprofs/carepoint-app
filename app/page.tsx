import Link from "next/link";
import { Suspense } from "react";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
import Topbar from "@/components/common/Topbar";
import { createSupabaseRscClient } from "@/lib/supabase/server";

/**
 * Landing screen — the "see_a_doctor" Stitch sample, shown patient-side.
 *
 * Two giant pictogram cards carry the whole screen: no paragraph of copy a
 * low-literacy user has to decode before acting (plan D8). Colour routes first
 * — emerald means "doctor now", blue means "my schedule" — and every card keeps
 * its own read-aloud button so the option can be heard without hearing the rest
 * of the page.
 *
 * A doctor has no appointment to book, so for that role the same two-card shell
 * offers the working day instead: the queue and the diary. Middleware already
 * keeps physicians out of /book; this keeps the marketing copy away from them too.
 *
 * Only the card pair depends on the viewer's role, so the shell stays static
 * and the role lookup streams in behind a Suspense boundary. Caching the whole
 * page would be wrong — the cache key cannot vary on the session cookie, and a
 * shared copy would hand a doctor the patient's booking buttons.
 */
export default function Home() {
  return (
    <main className="home-page">
      <Topbar label="TELEHEALTH AND AI CLINICAL SUPPORT" />

      <Suspense
        fallback={
          <section aria-label="Main actions" className="flex flex-col gap-space-md">
            <div
              aria-hidden="true"
              className="min-h-32 rounded-xl bg-surface-container-low"
            />
            <div
              aria-hidden="true"
              className="min-h-32 rounded-xl bg-surface-container-low"
            />
            <p className="text-center text-body-lg text-on-surface-variant" role="status">
              Loading your options…
            </p>
          </section>
        }
      >
        <RoleCards />
      </Suspense>
    </main>
  );
}

/** Resolves the viewer's role on the server and picks the matching cards. */
async function RoleCards() {
  const supabase = await createSupabaseRscClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = data?.role ?? null;
  }

  return role === "doctor" ? <DoctorHome /> : <PatientHome />;
}

function PatientHome() {
  return (
    <>
      <section className="welcome">
        <p className="eyebrow">CAREPOINT — SEE A DOCTOR</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">
          See a doctor without the long queue.
        </h1>
        <p className="welcome-copy">
          Book an appointment in a few taps, keep your health records in one place, and let
          your doctor review your case before you arrive.
        </p>
      </section>

      <section aria-label="Main actions" className="flex flex-col gap-space-md">
        {/* Emerald: immediate care. */}
        <Link
          href="/book"
          className="group flex min-h-32 flex-col justify-center gap-space-xs rounded-xl bg-primary-container p-space-md text-white shadow-tactile press"
        >
          <span className="flex items-center gap-space-xs">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-primary-container sm:h-14 sm:w-14">
              <Icon name="stethoscope" size={30} />
            </span>
            <span className="min-w-0 flex-1 text-label-xl uppercase leading-tight">
              Book doctor now
            </span>
          </span>

          <span className="flex items-center gap-space-xs text-body-lg text-on-primary-container">
            <Icon name="videocam" size={24} className="shrink-0" />
            <span className="min-w-0 flex-1">Pick a doctor, day and time</span>
            <SpeakButton
              phrase="Book a doctor now. Choose a doctor, a day and a time in three simple steps."
              label="Listen to Book Doctor Now"
              className="bg-primary text-white"
              size={48}
            />
          </span>
        </Link>

        {/* Blue: scheduled care. */}
        <Link
          href="/appointments"
          className="group flex min-h-32 flex-col justify-center gap-space-xs rounded-xl bg-secondary p-space-md text-white shadow-tactile press"
        >
          <span className="flex items-center gap-space-xs">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-secondary sm:h-14 sm:w-14">
              <Icon name="calendar_month" size={30} />
              <span className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary-fixed text-primary">
                <Icon name="check" size={18} />
              </span>
            </span>
            <span className="min-w-0 flex-1 text-label-xl uppercase leading-tight">
              My appointments
            </span>
          </span>

          <span className="flex items-center gap-space-xs text-body-lg text-secondary-fixed">
            <Icon name="schedule" size={24} className="shrink-0" />
            <span className="min-w-0 flex-1">Check booked times</span>
            <SpeakButton
              phrase="My appointments. Review your booked times and past visits."
              label="Listen to My Appointments"
              className="bg-secondary-fixed text-secondary"
              size={48}
            />
          </span>
        </Link>
      </section>

      <p className="mt-space-md flex items-center justify-center gap-space-xs text-center text-body-lg text-on-surface-variant">
        <Icon name="favorite" size={26} className="text-primary" />
        No reading required. Doctors talk with you directly.
      </p>
    </>
  );
}

/** Physician landing: the queue and the diary, never the booking wizard. */
function DoctorHome() {
  return (
    <>
      <section className="welcome">
        <p className="eyebrow">CAREPOINT — CLINICIAN WORKSPACE</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">
          Your patients are waiting.
        </h1>
        <p className="welcome-copy">
          Work today&apos;s queue, open a patient&apos;s record before the call, and keep your
          consulting hours up to date.
        </p>
      </section>

      <section aria-label="Main actions" className="flex flex-col gap-space-md">
        <Link              href="/dashboard"
          className="group flex min-h-32 flex-col justify-center gap-space-xs rounded-xl bg-primary-container p-space-md text-white shadow-tactile press"
        >
          <span className="flex items-center gap-space-xs">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-primary-container sm:h-14 sm:w-14">
              <Icon name="groups" size={30} />
            </span>
            <span className="min-w-0 flex-1 text-label-xl uppercase leading-tight">
              Today&apos;s queue
            </span>
          </span>

          <span className="flex items-center gap-space-xs text-body-lg text-on-primary-container">
            <Icon name="videocam" size={24} className="shrink-0" />
            <span className="min-w-0 flex-1">See who is booked and start the call</span>
            <SpeakButton
              phrase="Today's queue. See who is booked and start the call."
              label="Listen to Today's Queue"
              className="bg-primary text-white"
              size={48}
            />
          </span>
        </Link>

        <Link
          href="/schedule"
          className="group flex min-h-32 flex-col justify-center gap-space-xs rounded-xl bg-secondary p-space-md text-white shadow-tactile press"
        >
          <span className="flex items-center gap-space-xs">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-secondary sm:h-14 sm:w-14">
              <Icon name="calendar_month" size={30} />
              <span className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary-fixed text-primary">
                <Icon name="edit" size={18} />
              </span>
            </span>
            <span className="min-w-0 flex-1 text-label-xl uppercase leading-tight">
              My schedule
            </span>
          </span>

          <span className="flex items-center gap-space-xs text-body-lg text-secondary-fixed">
            <Icon name="schedule" size={24} className="shrink-0" />
            <span className="min-w-0 flex-1">Open or close consulting hours</span>
            <SpeakButton
              phrase="My schedule. Open or close the hours patients can book."
              label="Listen to My Schedule"
              className="bg-secondary-fixed text-secondary"
              size={48}
            />
          </span>
        </Link>
      </section>

      <p className="mt-space-md flex items-center justify-center gap-space-xs text-center text-body-lg text-on-surface-variant">
        <Icon name="health_and_safety" size={26} className="text-primary" />
        Patients book only inside the hours you leave open.
      </p>
    </>
  );
}
