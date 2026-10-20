import Link from "next/link";
import { Suspense } from "react";

import Icon from "@/components/common/Icon";
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

      <section className="welcome">
        <p className="eyebrow">YOUR SCHEDULE</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">My appointments</h1>
        <p className="welcome-copy">
          Every booking with its doctor, status and time in West Africa Time.
        </p>
      </section>

      <AppointmentsView />

      <nav aria-label="More actions" className="mt-space-lg flex flex-col gap-space-xs">
        <Link
          href="/book"
          className="flex min-h-16 items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white no-underline shadow-tactile press"
        >
          <Icon name="add" size={30} />
          BOOK ANOTHER APPOINTMENT
        </Link>
        <Link
          href="/health-profile"
          className="flex min-h-16 items-center justify-center gap-space-xs rounded-xl bg-secondary text-label-xl text-white no-underline shadow-tactile press"
        >
          <Icon name="health_and_safety" size={30} />
          MY HEALTH PROFILE
        </Link>
        <Link
          href="/"
          className="flex min-h-14 items-center justify-center gap-space-xs rounded-xl bg-surface-container-low text-label-lg text-primary no-underline press"
        >
          <Icon name="home" size={26} />
          Back to home
        </Link>
      </nav>
    </main>
  );
}
