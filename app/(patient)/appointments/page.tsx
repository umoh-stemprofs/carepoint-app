import Link from "next/link";

export default function AppointmentsPage() {
  return (
    <main className="home-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>CarePoint</span>
        </Link>
        <span className="service-label">MY APPOINTMENTS</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">YOUR SCHEDULE</p>
        <h1>No appointments yet.</h1>
        <p className="welcome-copy">
          Your booked and past visits will be listed here. This placeholder is populated by
          real appointment data in Phase 07.
        </p>
      </section>

      <section className="next-steps">
        <h2>
          <span className="anchor-target" id="appointments-placeholder" />
          Coming in Phase 07
        </h2>
        <p>
          Appointments load from the database once Supabase is connected, showing the
          doctor, date, time and status of every visit you have booked.
        </p>
      </section>

      <p className="welcome-copy">
        <Link className="brand" href="/">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
