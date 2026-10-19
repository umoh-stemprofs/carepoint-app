import { z } from "zod";

/**
 * DeepSeek clinical decision support request (plan Phase 10).
 *
 * Only clinical variables are accepted here. Patient identifiers must be
 * stripped upstream by the PII sanitizer before this schema is applied, so the
 * payload sent to the model carries no name, phone number or address.
 */
export const cdssRequestSchema = z.object({
  symptoms: z
    .array(z.string().trim().min(2, "each symptom needs at least 2 characters"))
    .min(1, "at least one symptom is required")
    .max(25, "at most 25 symptoms are accepted"),
  patientAge: z.number().int("patientAge must be a whole number").min(0).max(120),
  gender: z.enum(["female", "male", "other", "unknown"]),
  durationDays: z.number().int().min(0).max(3650).optional(),
  medicalHistory: z.string().trim().max(5000).optional(),
  vitals: z
    .object({
      temperatureC: z.number().min(25).max(45).optional(),
      heartRateBpm: z.number().min(20).max(300).optional(),
      systolicBp: z.number().min(40).max(300).optional(),
      diastolicBp: z.number().min(20).max(200).optional(),
      spo2Percent: z.number().min(40).max(100).optional(),
    })
    .optional(),
});

export type CDSSInput = z.infer<typeof cdssRequestSchema>;
