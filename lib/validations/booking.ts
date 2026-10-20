import { z } from "zod";

/** Time-of-day slots offered by the visual booking wizard. */
export const SLOT_PERIODS = ["morning", "midday", "afternoon", "evening"] as const;

/**
 * Appointment creation payload.
 *
 * Timestamps are accepted with an explicit UTC offset (or Z) so the client can
 * send West Africa Time unambiguously; the server normalises them to UTC for
 * storage, matching plan decision D6.
 */
export const bookingSchema = z
  .object({
    doctorId: z.uuid("doctorId must be a valid UUID"),
    appointmentDate: z.iso.date("appointmentDate must be formatted as YYYY-MM-DD"),
    startTime: z.iso.datetime({ offset: true }),
    endTime: z.iso.datetime({ offset: true }),
    slotPeriod: z.enum(SLOT_PERIODS),
    reasonForVisit: z
      .string()
      .trim()
      .min(3, "reasonForVisit must be at least 3 characters")
      .max(1000, "reasonForVisit must be at most 1000 characters"),
  })
  .refine((value) => new Date(value.endTime).getTime() > new Date(value.startTime).getTime(), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })
  .refine(
    (value) => new Date(value.startTime).toISOString().slice(0, 10) === value.appointmentDate,
    {
      message: "startTime must fall on appointmentDate",
      path: ["startTime"],
    },
  )
  // A slot that has already gone by cannot be taken — at 1 PM there is no
  // 9 AM appointment left today. The booking RPC re-checks this server-side.
  .refine((value) => new Date(value.startTime).getTime() > Date.now(), {
    message: "startTime has already passed — pick a later time",
    path: ["startTime"],
  });

export type BookingInput = z.infer<typeof bookingSchema>;
