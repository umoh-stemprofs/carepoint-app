import Link from "next/link";
import { Suspense } from "react";

import Topbar from "@/components/common/Topbar";
import BookingNotice from "@/components/common/BookingNotice";
import AppointmentsView from "@/components/patient/AppointmentsView";

export default function AppointmentsPage() {
  return (
    <main className="home-page">
      <Topbar label="MY APPOINTMENTS" />

      <Suspense fallback={null}>
        <BookingNotice />
      </Suspense>

      <section className="welcome" style={{ paddingBottom: 20 }}>
        <p className="eyebrow">YOUR SCHEDULE</p>
        <h1>My appointments</h1>
        <p className="welcome-copy">
          Every booking with its doctor, status and time in West Africa Time.
        </p>
      </section>

      <AppointmentsView />

      <p className="welcome-copy" style={{ marginTop: 34, fontSize: 16 }}>
        <Link href="/book">Book another appointment →</Link>
      </p>
      <p className="welcome-copy" style={{ fontSize: 16 }}>
        <Link href="/health-profile">My health profile →</Link>
      </p>
      <p className="welcome-copy" style={{ fontSize: 16 }}>
        <Link href="/">← Back to home</Link>
      </p>
    </main>
  );
}
