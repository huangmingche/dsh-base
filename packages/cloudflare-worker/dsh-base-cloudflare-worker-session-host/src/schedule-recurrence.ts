import { canonicalClientTimeZone, resolveLocalInstant } from '@deepseek-ai/dsh-util-time';
/**
 * Wall-clock recurrence helpers for the durable Host task store.
 *
 * The official schedule record keeps an IANA zone and a local `HH:mm:ss.SSS`
 * time; the Host stores the committed UTC instant. This module computes the
 * next committed occurrence for `daily` and `weekly` timing using the official
 * timezone and local-instant resolver for DST gaps and repeated hours.
 */

/** One normalized local wall-clock time. */
export interface LocalTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/u;

/**
 * Parse and normalize an official local wall-clock time.
 * @param value - `HH:mm[:ss[.SSS]]`.
 * @returns normalized time parts.
 * @throws Error when the shape is not accepted.
 */
export function parseLocalTime(value: string): LocalTime {
  const match = LOCAL_TIME.exec(value);
  if (match === null) throw new Error(`invalid local time: ${value}`);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: match[3] === undefined ? 0 : Number(match[3]),
    millisecond: match[4] === undefined ? 0 : Number(match[4].padEnd(3, "0")),
  };
}

/** Read the wall-clock parts of one instant in a zone. */
function zonedParts(zone: string, instantMs: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") % 24, minute: read("minute"), second: read("second") };
}

/** Reuse the official gap/overlap resolver; a missing wall time is skipped. */
function localToUtc(zone: string, year: number, month: number, day: number, time: LocalTime): number | undefined {
  return resolveLocalInstant({ year, month, day, ...time }, zone);
}

/** Validate an IANA zone name (or UTC) by formatting one instant. */
export function requireTimeZone(value: string): string {
  if (typeof value !== "string" || value === "") throw new Error("time_zone is required");
  const zone = canonicalClientTimeZone(value);
  if (zone === undefined) throw new Error(`invalid time_zone: ${value}`);
  return zone;
}

/** Local calendar date after adding `days` full calendar days. */
function addLocalDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * Next `daily` occurrence strictly after `now`.
 * @param now - reference instant.
 * @param time - local wall-clock time.
 * @param zone - IANA zone.
 * @returns the next UTC instant.
 */
export function nextDailyOccurrence(now: Date, time: LocalTime, zone: string): Date {
  requireTimeZone(zone);
  const base = zonedParts(zone, now.getTime());
  for (let offset = 0; offset < 4; offset += 1) {
    const date = addLocalDays(base.year, base.month, base.day, offset);
    const candidate = localToUtc(zone, date.year, date.month, date.day, time);
    if (candidate !== undefined && candidate > now.getTime()) return new Date(candidate);
  }
  throw new Error("no daily occurrence found");
}

/**
 * Next `weekly` occurrence strictly after `now`.
 * @param now - reference instant.
 * @param time - local wall-clock time.
 * @param zone - IANA zone.
 * @param weekdays - unique ISO weekdays, Monday 1 through Sunday 7.
 * @returns the next UTC instant.
 */
export function nextWeeklyOccurrence(now: Date, time: LocalTime, zone: string, weekdays: readonly number[]): Date {
  requireTimeZone(zone);
  if (!Array.isArray(weekdays) || weekdays.length === 0) throw new Error("weekdays is required");
  const unique = [...new Set(weekdays)];
  if (unique.length !== weekdays.length || unique.some((day) => !Number.isSafeInteger(day) || day < 1 || day > 7)) {
    throw new Error("weekdays must be unique integers from 1 through 7");
  }
  const base = zonedParts(zone, now.getTime());
  for (let offset = 0; offset < 15; offset += 1) {
    const date = addLocalDays(base.year, base.month, base.day, offset);
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() || 7;
    if (!unique.includes(weekday)) continue;
    const candidate = localToUtc(zone, date.year, date.month, date.day, time);
    if (candidate !== undefined && candidate > now.getTime()) return new Date(candidate);
  }
  throw new Error("no weekly occurrence found");
}
