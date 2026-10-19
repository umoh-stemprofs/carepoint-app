import Link from "next/link";

import Topbar from "@/components/common/Topbar";

export default function Home() {
  return (
    <main className="home-page">
      <Topbar label="TELEHEALTH AND AI CLINICAL SUPPORT" />

      <section className="welcome">
        <p className="eyebrow">CAREPOINT — SEE A DOCTOR</p>
        <h1>See a doctor without the long queue.</h1>
        <p className="welcome-copy">
          Book an appointment in a few taps, keep your health records in one place, and let
          your doctor review your case before you arrive.
        </p>
      </section>

      <section className="action-grid" aria-label="Main actions">
        <Link className="action-tile action-primary" href="/book">
          <span className="tile-index">01 / BOOKING</span>
          <span className="tile-title">BOOK DOCTOR NOW</span>
          <span className="tile-caption">
            Choose a doctor, a day and a time in three simple steps.
          </span>
          <span className="tile-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <Link className="action-tile action-secondary" href="/appointments">
          <span className="tile-index">02 / SCHEDULE</span>
          <span className="tile-title">MY APPOINTMENTS</span>
          <span className="tile-caption">
            Review upcoming visits and past consultations.
          </span>
          <span className="tile-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </section>

      <section className="next-steps">
        <h2>
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
