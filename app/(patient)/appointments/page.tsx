import Link from "next/link";
import { Suspense } from "react";

import Topbar from "@/components/common/Topbar";
import BookingNotice from "@/components/common/BookingNotice";

export default function AppointmentsPage() {
  return (
    <main className="home-page">
      <Topbar label="MY APPOINTMENTS" />

      <Suspense fallback={null}>
        <BookingNotice />
      </Suspense>

      <section className="welcome">
        <p className="eyebrow">YOUR SCHEDULE</p>
        <h1>No appointments yet.</h1>
        <p className="welcome-copy">
          Your booked and past visits will be listed here. Bookings confirmed in the wizard
          appear as soon as they are recorded.
        </p>
      </section>

      <section className="next-steps">
        <h2>
          <span className="anchor-target" id="appointments-placeholder" />
          Coming in Phase 07
        </h2>
        <p>
          Appointments load from the database showing the doctor, date, time and status of
          every visit you have booked.
        </p>
      </section>

      <p className="welcome-copy">
        <Link href="/book">Book another appointment →</Link>
      </p>
      <p className="welcome-copy">
        <Link href="/">← Back to home</Link>
      </p>
    </main>
  );
}
