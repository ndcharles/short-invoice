import { describe, expect, it } from 'vitest';
import { formatDateTime, parseNaturalDate } from '@/lib/links/expiry';

/** Wednesday 7 October 2026, 2:30 PM in whatever timezone the tests run in. Expected values are built the same way, so they hold anywhere. */
const NOW = new Date(2026, 9, 7, 14, 30).getTime();
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const parse = (text: string, now = NOW) => parseNaturalDate(text, now);

describe('relative dates', () => {
  it.each([
    ['in 30 minutes', NOW + 30 * 60_000],
    ['in 30 min', NOW + 30 * 60_000],
    ['in 2 hours', NOW + 2 * 3_600_000],
    ['in 1 hr', NOW + 3_600_000],
    ['in 3 days', local(2026, 10, 10, 14, 30)],
    ['in 1 week', local(2026, 10, 14, 14, 30)],
    ['in 2 months', local(2026, 12, 7, 14, 30)],
    ['  IN   2   Hours ', NOW + 2 * 3_600_000],
    ['next week', local(2026, 10, 14, 14, 30)],
  ])('%s', (text, expected) => expect(parse(text)).toBe(expected));
});

describe('today, tomorrow and weekdays', () => {
  it.each([
    ['tomorrow at 5pm', local(2026, 10, 8, 17)],
    ['tomorrow 5pm', local(2026, 10, 8, 17)],
    ['tomorrow at 5:30 pm', local(2026, 10, 8, 17, 30)],
    ['tomorrow 17:30', local(2026, 10, 8, 17, 30)],
    ['tomorrow at noon', local(2026, 10, 8, 12)],
    ['tomorrow at 12am', local(2026, 10, 8, 0)],
    ['tomorrow at 12pm', local(2026, 10, 8, 12)],
    ['tomorrow', local(2026, 10, 8, 23, 59)],
    ['today at 11pm', local(2026, 10, 7, 23)],
    ['friday 9am', local(2026, 10, 9, 9)],
    ['Fri', local(2026, 10, 9, 23, 59)],
    ['next friday at 9am', local(2026, 10, 9, 9)],
    ['on monday', local(2026, 10, 12, 23, 59)],
    ['wednesday 5pm', local(2026, 10, 7, 17)], // still ahead today
    ['wednesday 9am', local(2026, 10, 14, 9)], // already passed today: next week
    ['next wednesday', local(2026, 10, 14, 23, 59)],
  ])('%s', (text, expected) => expect(parse(text)).toBe(expected));

  it('rolls over month and year ends', () => {
    const lastOfMonth = local(2026, 10, 31, 12);
    expect(parse('tomorrow at 5pm', lastOfMonth)).toBe(local(2026, 11, 1, 17));
    const newYearsEve = local(2026, 12, 31, 12);
    expect(parse('tomorrow', newYearsEve)).toBe(local(2027, 1, 1, 23, 59));
    expect(parse('in 2 days', newYearsEve)).toBe(local(2027, 1, 2, 12));
  });
});

describe('written dates', () => {
  it.each([
    ['Oct 10, 2026, 5:00 PM', local(2026, 10, 10, 17)],
    ['oct 10 2026 5pm', local(2026, 10, 10, 17)],
    ['October 10, 2026 at 5:15pm', local(2026, 10, 10, 17, 15)],
    ['10 Oct 2026 5pm', local(2026, 10, 10, 17)],
    ['Oct 10, 2026', local(2026, 10, 10, 23, 59)],
    ['Dec 31, 2026, 12:00 AM', local(2026, 12, 31, 0)],
    ['Dec 31, 2026, 12:00 PM', local(2026, 12, 31, 12)],
  ])('%s', (text, expected) => expect(parse(text)).toBe(expected));

  it('reads back exactly what it shows, whatever the browser', () => {
    for (const ms of [local(2026, 10, 10, 17), local(2026, 1, 1, 0), local(2026, 12, 31, 23, 59), local(2027, 6, 15, 12, 5), local(2026, 3, 9, 0, 1)]) {
      expect(parse(formatDateTime(ms))).toBe(ms);
    }
  });
});

describe('ISO dates', () => {
  it.each([
    ['2026-10-10', local(2026, 10, 10, 23, 59)],
    ['2026-10-10 17:00', local(2026, 10, 10, 17)],
    ['2026-10-10T17:00', local(2026, 10, 10, 17)],
    ['2026-10-10T17:00:30', local(2026, 10, 10, 17) + 30_000],
    ['2026-10-10T17:00:00Z', Date.UTC(2026, 9, 10, 17)],
    ['2026-10-10T17:00+01:00', Date.UTC(2026, 9, 10, 16)],
    ['2026-10-10T17:00-0500', Date.UTC(2026, 9, 10, 22)],
  ])('%s', (text, expected) => expect(parse(text)).toBe(expected));
});

describe('anything unclear is refused rather than guessed', () => {
  it.each([
    '', '   ', 'banana', 'soon', 'next', 'tomorrow at', 'tomorrow at later', 'tomorrow at 25:00', 'tomorrow at 13pm', 'tomorrow at 0am',
    'tomorrow at 5:75', 'in two hours', 'in 2 years', 'in hours', '10/11/2026', '10-11-2026', '2026-02-30', '2026-13-01', 'feb 30 2026',
    'foo 10 2026', '2026-10-10T25:00', '2026-10-10Z', 'friday at', 'oct 10', '2026', 'yesterday',
  ])('%j', (text) => expect(parse(text)).toBeNull());
});
