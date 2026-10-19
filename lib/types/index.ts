/**
 * Shared domain types for CarePoint.
 *
 * These mirror the tables created in
 * `supabase/migrations/20261019000000_initial_schema.sql`. The *Input types are
 * inferred from the Zod schemas in `lib/validations` so a schema change and its
 * TypeScript shape cannot drift apart.
 */

import type { SLOT_PERIODS } from "@/lib/validations/booking";

export type { BookingInput } from "@/lib/validations/booking";
export type { HealthProfileInput } from "@/lib/validations/health-profile";
export type { CDSSInput } from "@/lib/validations/cdss";

// ---------------------------------------------------------------------------
// Enumerations (match the PostgreSQL enum types)
// ---------------------------------------------------------------------------

export type UserRole = "patient" | "doctor";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled";

/** Derived from SLOT_PERIODS so the wizard and the schema stay in sync. */
export type SlotPeriod = (typeof SLOT_PERIODS)[number];

// ---------------------------------------------------------------------------
// Table row shapes
// ---------------------------------------------------------------------------

/** `public.profiles` */
export interface UserProfile {
  id: string;
  role: UserRole;
  fullName: string;
  phoneNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `public.doctors` */
export interface DoctorProfile {
  id: string;
  specialty: string | null;
  licenseNumber: string | null;
  isAcceptingBookings: boolean;
  createdAt: string;
}

/** `public.appointments` */
export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  /** Calendar date stored as `appointment_date`, formatted YYYY-MM-DD. */
  appointmentDate: string;
  /** UTC instant, stored as TIMESTAMPTZ. */
  startTime: string;
  /** UTC instant, stored as TIMESTAMPTZ. */
  endTime: string;
  slotPeriod: SlotPeriod;
  reasonForVisit: string;
  status: AppointmentStatus;
  createdAt: string;
}

/** `public.health_profiles` */
export interface HealthProfile {
  id: string;
  patientId: string;
  medicalHistory: string | null;
  allergies: string | null;
  currentMedications: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `public.cdss_logs` */
export interface CDSSLog {
  id: string;
  doctorId: string;
  appointmentId: string | null;
  model: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Derived / composite shapes
// ---------------------------------------------------------------------------

/** Structured differential output returned by the Phase 10 CDSS. */
export interface AIDiagnosticResult {
  differentialDiagnoses: string[];
  recommendedTests: string[];
  redFlags: string[];
}

/** A slot offered by the booking wizard once existing bookings are subtracted. */
export interface TimeSlot {
  slotPeriod: SlotPeriod;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}
