/**
 * Calendar-date formatting for invoices and lists. Dates are stored as epoch
 * ms; date inputs produce UTC midnight, so formatting is done in UTC to keep
 * the day stable for every viewer.
 */

export const DATE_FORMATS = ['19 Mar 2026', 'Mar 19, 2026', '19/03/2026', '2026-03-19'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DEFAULT_DATE_FORMAT: DateFormat = '19 Mar 2026';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(ms: number | null | undefined, format: string = DEFAULT_DATE_FORMAT): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  switch (format) {
    case 'Mar 19, 2026':
      return `${MONTHS[month]} ${day}, ${year}`;
    case '19/03/2026':
      return `${pad(day)}/${pad(month + 1)}/${year}`;
    case '2026-03-19':
      return `${year}-${pad(month + 1)}-${pad(day)}`;
    default:
      return `${day} ${MONTHS[month]} ${year}`;
  }
}

/** `YYYY-MM-DD` for <input type="date">, in UTC. */
export function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parses an <input type="date"> value to UTC midnight, or null. */
export function fromDateInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** UTC midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
