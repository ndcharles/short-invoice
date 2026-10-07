/**
 * Reading and showing the date a link expires, as typed or picked in the link
 * editor. Everything is in the visitor's own timezone (what they see on their
 * clock); the editor sends the result to the server as epoch milliseconds, so
 * the server never has to guess a timezone.
 *
 * The parser is strict on purpose: anything it cannot read fully returns null,
 * so a typo can never turn into a quietly wrong expiry date.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "Oct 8, 2026, 5:00 PM" */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** The viewer's timezone, e.g. "Africa/Lagos", for "Expires on … (Africa/Lagos time)". */
export function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

interface Clock {
  hours: number;
  minutes: number;
}

/** "5pm", "5:30 pm", "17:30", "noon". Bare numbers are 24-hour. Null when it is not a time. */
function parseClock(text: string): Clock | null {
  const t = text.trim().replace(/^at\s+/, '');
  if (t === 'noon') return { hours: 12, minutes: 0 };
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

/** A real calendar moment in local time, or null (so "Feb 30" never rolls over into March). */
function localDate(year: number, month: number, day: number, clock: Clock | null, seconds = 0): number | null {
  const hours = clock?.hours ?? 23;
  const minutes = clock?.minutes ?? 59;
  const d = new Date(year, month, day, hours, minutes, seconds, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day || d.getHours() !== hours) return null;
  return d.getTime();
}

const monthIndex = (name: string) => MONTHS.findIndex((m) => name.toLowerCase().startsWith(m.toLowerCase()));

/**
 * Understands:
 *   "in 2 hours", "in 3 days", "in 1 week", "in 2 months"
 *   "today at 5pm", "tomorrow 5:30pm", "tomorrow 17:30", "tomorrow at noon", "tomorrow"
 *   "friday 9am", "next friday at 9am", "fri"
 *   "Oct 10, 2026, 5:00 PM" (what the editor shows), "10 Oct 2026 5pm", "October 10 2026"
 *   "2026-10-10", "2026-10-10 17:00", "2026-10-10T17:00", "2026-10-10T17:00:00Z", "…+01:00"
 * A date with no time means the end of that day (11:59 PM). Numeric dates like
 * 10/11/2026 are refused, because day-first and month-first readings differ.
 */
export function parseNaturalDate(input: string, now: number = Date.now()): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;
  const today = new Date(now);

  // "in 2 hours"
  const relative = /^in (\d{1,4}) ?(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)$/.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (unit.startsWith('min')) return now + amount * 60_000;
    if (unit.startsWith('h')) return now + amount * 3_600_000;
    const d = new Date(now);
    if (unit.startsWith('d')) d.setDate(d.getDate() + amount);
    else if (unit.startsWith('w')) d.setDate(d.getDate() + amount * 7);
    else d.setMonth(d.getMonth() + amount);
    return d.getTime();
  }

  if (text === 'next week') {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.getTime();
  }

  // "today at 5pm", "tomorrow 5pm", "friday 9am", "next friday"
  const day = /^(today|tomorrow|(?:(?:on|next) )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*)(?: (.+))?$/.exec(text);
  if (day) {
    const clock = day[3] ? parseClock(day[3]) : null;
    if (day[3] && !clock) return null;
    // `offset` days from today, normalised first so the 31st + 1 is the 1st of next month.
    const on = (offset: number) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      return localDate(d.getFullYear(), d.getMonth(), d.getDate(), clock);
    };
    if (day[1] === 'today' || day[1] === 'tomorrow') return on(day[1] === 'today' ? 0 : 1);
    const wanted = WEEKDAYS.indexOf(day[2]);
    const startOffset = day[1].startsWith('next ') ? 1 : 0;
    for (let offset = startOffset; offset <= 7 + startOffset; offset += 1) {
      const candidate = on(offset);
      if (candidate !== null && new Date(candidate).getDay() === wanted && candidate > now) return candidate;
    }
    return null;
  }

  // "Oct 10, 2026, 5:00 PM", "october 10 2026", "10 Oct 2026 5pm"
  const named =
    /^(?:([a-z]{3,9})\.? (\d{1,2})|(\d{1,2}) ([a-z]{3,9})\.?),? (\d{4})(?:,? (?:at )?(.+))?$/.exec(text);
  if (named) {
    const month = monthIndex(named[1] ?? named[4]);
    const dayOfMonth = Number(named[2] ?? named[3]);
    const clock = named[6] ? parseClock(named[6]) : null;
    if (month < 0 || (named[6] && !clock)) return null;
    return localDate(Number(named[5]), month, dayOfMonth, clock);
  }

  // "2026-10-10", "2026-10-10 17:00", "2026-10-10T17:00:00Z", "2026-10-10T17:00+01:00"
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2}))?)? ?(z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (iso) {
    const [year, month, dayOfMonth] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
    const clock = iso[4] === undefined ? null : { hours: Number(iso[4]), minutes: Number(iso[5]) };
    if (clock && (clock.hours > 23 || clock.minutes > 59)) return null;
    if (iso[7]) {
      if (!clock) return null; // a zone only makes sense with a time
      const offset = iso[7] === 'z' ? 0 : (iso[7][0] === '-' ? -1 : 1) * (Number(iso[7].slice(1, 3)) * 60 + Number(iso[7].slice(-2)));
      const utc = Date.UTC(year, month, dayOfMonth, clock.hours, clock.minutes, Number(iso[6] ?? 0));
      const check = new Date(utc);
      if (check.getUTCMonth() !== month || check.getUTCDate() !== dayOfMonth) return null;
      return utc - offset * 60_000;
    }
    return localDate(year, month, dayOfMonth, clock, Number(iso[6] ?? 0));
  }

  return null;
}
