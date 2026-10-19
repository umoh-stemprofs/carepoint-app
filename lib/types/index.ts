/**
 * Shared domain types for CarePoint.
 *
 * Phase 03 expands these alongside the Zod validation schemas and the
 * date helpers that lock display to Africa/Lagos (WAT, UTC+1).
 */

export type UserRole = "patient" | "doctor";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled";

/** Time-of-day slots offered by the visual booking wizard. */
export type SlotPeriod = "morning" | "midday" | "afternoon" | "evening";

export interface UserProfile {
  id: string;
  role: UserRole;
  fullName: string;
  phoneNumber?: string;
  createdAt: string;
}

export interface DoctorProfile extends UserProfile {
  role: "doctor";
  specialty?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  /** ISO-8601 date normalised to UTC for storage. */
  appointmentDate: string;
  slotPeriod: SlotPeriod;
  /** Wall-clock time rendered in Africa/Lagos (WAT). */
  slotTime: string;
  status: AppointmentStatus;
}

/** Structured differential output returned by the Phase 10 CDSS. */
export interface AIDiagnosticResult {
  differentialDiagnoses: string[];
  recommendedTests: string[];
  redFlags: string[];
}
