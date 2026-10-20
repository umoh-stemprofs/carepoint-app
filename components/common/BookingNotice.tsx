"use client";

import { useSearchParams } from "next/navigation";

import Icon from "@/components/common/Icon";

/**
 * Success banner shown after the booking wizard redirects to /appointments
 * with `?booked=1` (plan Phase 07).
 *
 * Reads the query string client-side inside a Suspense boundary, which keeps
 * /appointments statically prerenderable.
 */
export default function BookingNotice() {
  const searchParams = useSearchParams();

  if (searchParams.get("booked") !== "1") {
    return null;
  }

  return (
    <div
      role="status"
      className="mb-space-sm flex items-center gap-space-xs rounded-xl border-2 border-primary bg-primary-fixed p-space-sm text-body-lg font-bold text-on-primary-fixed"
    >
      <Icon name="check_circle" size={34} className="shrink-0 text-primary" />
      Your appointment is confirmed. It is listed below.
    </div>
  );
}
