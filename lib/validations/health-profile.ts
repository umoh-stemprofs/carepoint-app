import { z } from "zod";

const nigerianPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s\-()]{6,19}$/, "emergencyContactPhone must be a valid phone number");

/**
 * Patient digital health profile (plan Phase 08).
 *
 * Narrative fields stay plaintext in the schema; selective encryption of the
 * confidential bodies happens at the persistence layer (plan decision D3).
 */
export const healthProfileSchema = z.object({
  medicalHistory: z.string().trim().max(5000, "medicalHistory is too long").optional(),
  allergies: z.string().trim().max(2000, "allergies is too long").optional(),
  currentMedications: z.string().trim().max(2000, "currentMedications is too long").optional(),
  emergencyContactName: z
    .string()
    .trim()
    .min(2, "emergencyContactName is too short")
    .max(120, "emergencyContactName is too long"),
  emergencyContactPhone: nigerianPhone,
});

export type HealthProfileInput = z.infer<typeof healthProfileSchema>;
