import Link from "next/link";

export default function DoctorDashboardPage() {
  return (
    <main className="home-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>CarePoint</span>
        </Link>
        <span className="service-label">DOCTOR DASHBOARD</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">PHYSICIAN WORKSPACE</p>
        <h1>Today&apos;s appointments.</h1>
        <p className="welcome-copy">
          Your schedule, patient intake queue and AI clinical assistant will appear here.
          This placeholder is built out in Phases 09 and 10.
        </p>
      </section>

      <section className="next-steps">
        <h2>
          <span className="anchor-target" id="doctor-placeholder" />
          Coming in Phases 09 and 10
        </h2>
        <p>
          Confirm, complete or cancel appointments, open a patient record with decrypted
          notes, and launch the rate-limited DeepSeek clinical decision support assistant.
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
