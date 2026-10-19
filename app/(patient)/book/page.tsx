import Link from "next/link";

export default function BookPage() {
  return (
    <main className="home-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>CarePoint</span>
        </Link>
        <span className="service-label">BOOK A DOCTOR</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">BOOKING WIZARD</p>
        <h1>Choose your doctor.</h1>
        <p className="welcome-copy">
          Step 1 of the three-step booking wizard. This placeholder is replaced by the full
          visual step wizard in Phase 07.
        </p>
      </section>

      <section className="next-steps">
        <h2>
          <span className="anchor-target" id="book-placeholder" />
          Coming in Phase 07
        </h2>
        <p>
          Pick a doctor and a day, choose a time of day, then confirm. Bookings are written
          through the atomic appointment routine so a slot can never be taken twice.
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
