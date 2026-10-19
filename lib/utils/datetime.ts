import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Date/time helpers locked to West Africa Time (plan decision D6).
 *
 * Storage is always UTC; display is always Africa/Lagos (WAT, UTC+1). Locking
 * the display timezone stops a booking from drifting when a doctor and a
 * patient open the app on devices with different system clocks.
 */

/** Display timezone for every CarePoint screen. */
export const WAT_TIMEZONE = "Africa/Lagos";

/** Default human-readable label, e.g. "Mon 19 Oct 2026, 9:00 AM". */
export const SLOT_LABEL_PATTERN = "EEE d MMM yyyy, h:mm a";

/** ISO date-only format, e.g. "2026-10-19". */
export const DATE_ONLY_PATTERN = "yyyy-MM-dd";

/** Accepts "YYYY-MM-DD" or a full ISO-8601 instant. */
export function isSupportedDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value));
}

/**
 * Normalise any supported input to a Date held in UTC.
 *
 * A bare "YYYY-MM-DD" is interpreted as midnight in WAT, then converted to UTC,
 * so "2026-10-19" means 19 October to a Lagos user and not the day before.
 */
export function parseAppointmentDate(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fromZonedTime(`${value}T00:00:00`, WAT_TIMEZONE);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Cannot parse date value: ${value}`);
  }
  return parsed;
}

/** Render a stored UTC instant as West Africa Time. */
export function formatInWat(
  value: string | Date,
  pattern: string = SLOT_LABEL_PATTERN,
): string {
  const date = value instanceof Date ? value : parseAppointmentDate(value);
  return formatInTimeZone(date, WAT_TIMEZONE, pattern);
}

/** Build the UTC instant for a WAT wall-clock pair like ("2026-10-19", "09:00"). */
export function watLocalToUtc(date: string, time: string): Date {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Time must be formatted as HH:mm, received: ${time}`);
  }
  return fromZonedTime(`${date}T${time}:00`, WAT_TIMEZONE);
}

/** Split a stored UTC instant back into its WAT date and time parts. */
export function utcToWatParts(value: string | Date): { date: string; time: string } {
  const date = value instanceof Date ? value : parseAppointmentDate(value);
  return {
    date: formatInTimeZone(date, WAT_TIMEZONE, DATE_ONLY_PATTERN),
    time: formatInTimeZone(date, WAT_TIMEZONE, "HH:mm"),
  };
}

/** The WAT calendar date for an instant, used for appointment_date storage. */
export function watDateOnly(value: string | Date): string {
  return formatInWat(value, DATE_ONLY_PATTERN);
}

/**
 * Shift an instant by whole hours. Used by the booking wizard to derive an end
 * time from the start time. WAT is a fixed UTC+1 offset with no daylight saving,
 * so absolute hour arithmetic is exact.
 */
export function addHours(value: string | Date, hours: number): Date {
  const date = value instanceof Date ? value : parseAppointmentDate(value);
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Expose the WAT calendar fields for a date, for the day-picker tiles. */
export function watDayParts(value: string | Date): {
  year: number;
  month: number;
  day: number;
  weekday: string;
} {
  const date = value instanceof Date ? value : parseAppointmentDate(value);
  const shifted = toZonedTime(date, WAT_TIMEZONE);
  return {
    year: shifted.getFullYear(),
    month: shifted.getMonth() + 1,
    day: shifted.getDate(),
    weekday: formatInWat(date, "EEEE"),
  };
}
