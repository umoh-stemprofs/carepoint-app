import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="home-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>CarePoint</span>
        </Link>
        <span className="service-label">SIGN IN</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">STEP 1 OF 1</p>
        <h1>Log in to CarePoint.</h1>
        <p className="welcome-copy">
          Choose whether you are a patient or a doctor, then continue. This screen is a
          Phase 02 placeholder and is wired up in Phase 06.
        </p>
      </section>

      <section className="action-grid" aria-label="Choose account type">
        <Link className="action-tile action-primary" href="/book">
          <span className="tile-index">01 / PATIENT</span>
          <span className="tile-title">I AM A PATIENT</span>
          <span className="tile-caption">Book visits and keep my health records.</span>
          <span className="tile-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <Link className="action-tile action-secondary" href="/dashboard">
          <span className="tile-index">02 / DOCTOR</span>
          <span className="tile-title">I AM A DOCTOR</span>
          <span className="tile-caption">Review my schedule and patient intake.</span>
          <span className="tile-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </section>

      <section className="next-steps">
        <h2>
          <span className="anchor-target" id="login-help" />
          Not sure which to pick?
        </h2>
        <p>
          Patients book appointments. Doctors manage their schedule. Use the red bar at the
          bottom of the screen to call 112 in an emergency.
        </p>
      </section>
    </main>
  );
}
