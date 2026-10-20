import type { Metadata } from "next";

import EmergencyBanner from "@/components/common/EmergencyBanner";
import NotificationListener from "@/components/common/NotificationListener";
import PrototypeNotice from "@/components/common/PrototypeNotice";

import "./globals.css";

/*
 * Both typefaces are vendored in public/fonts and declared in globals.css.
 * They are deliberately *not* loaded through next/font/google: that loader
 * failed on these families at build time, and it would re-introduce the
 * runtime fonts.googleapis.com dependency the plan forbids — a font that must
 * cross a 2G link is a font that will not be on screen when the page paints.
 */

export const metadata: Metadata = {
  title: "CarePoint | See a doctor",
  description:
    "Accessible telemedicine appointments for patients and doctors. Prototype for the STEM Festival.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <div className="site-content">{children}</div>
        {/* Plan 11.1: realtime appointment toasts on every screen. */}
        <NotificationListener />
        {/* Rulebook Ethical Code: safety and honesty stay on every screen. */}
        <PrototypeNotice />
        <EmergencyBanner />
      </body>
    </html>
  );
}
