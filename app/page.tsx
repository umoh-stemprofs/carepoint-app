import Link from "next/link";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
import Topbar from "@/components/common/Topbar";

/**
 * Patient landing screen — the "see_a_doctor" Stitch sample.
 *
 * Two giant pictogram cards carry the whole screen: no paragraph of copy a
 * low-literacy user has to decode before acting (plan D8). Colour routes first
 * — emerald means "doctor now", blue means "my schedule" — and every card keeps
 * its own read-aloud button so the option can be heard without hearing the rest
 * of the page.
 *
 * Routes, copy intent and the emergency pad are unchanged; only the rendering
 * moved onto the Clarity token set.
 */
export default function Home() {
  return (
    <main className="home-page">
      <Topbar label="TELEHEALTH AND AI CLINICAL SUPPORT" />

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

            <SpeakButton
              phrase="Book a doctor now. Choose a doctor, a day and a time in three simple steps."
              label="Listen to Book Doctor Now"
              className="bg-primary text-white"
              size={48}
            />
          </span>

          <span className="flex items-center gap-1.5 text-body-lg text-on-primary-container">
            <Icon name="videocam" size={24} className="shrink-0" />
            Choose a doctor, a day and a time in three steps
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

            <SpeakButton
              phrase="My appointments. Review your booked times and past visits."
              label="Listen to My Appointments"
              className="bg-secondary-fixed text-secondary"
              size={48}
            />
          </span>

          <span className="flex items-center gap-1.5 text-body-lg text-secondary-fixed">
            <Icon name="schedule" size={24} className="shrink-0" />
            Check booked time and past visits
          </span>
        </Link>
      </section>

      <p className="mt-space-md flex items-center justify-center gap-space-xs text-center text-body-lg text-on-surface-variant">
        <Icon name="favorite" size={26} className="text-primary" />
        No reading required. Doctors talk with you directly.
      </p>

      <section className="next-steps">
        <h2 className="text-headline-lg-mobile">
          <span className="anchor-target" id="how-it-works" />
          Built for low-bandwidth connections and first-time smartphone users.
        </h2>
        <p>
          CarePoint keeps every step visual and readable: giant buttons, plain language, and
          a persistent emergency shortcut to 112 on every screen.
        </p>
      </section>
    </main>
  );
}
