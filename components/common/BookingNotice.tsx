"use client";

import { useSearchParams } from "next/navigation";

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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 22,
        padding: "16px 18px",
        borderRadius: 8,
        background: "#dcfae6",
        border: "3px solid var(--green)",
        color: "#05603a",
        fontSize: 19,
        fontWeight: 700,
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 26 }}>
        ✓
      </span>
      Your appointment is confirmed. It is listed below.
    </div>
  );
}
