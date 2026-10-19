import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import EmergencyBanner from "@/components/common/EmergencyBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CarePoint | See a doctor",
  description: "Accessible healthcare access for patients and doctors.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="site-content">{children}</div>
        <EmergencyBanner />
      </body>
    </html>
  );
}
