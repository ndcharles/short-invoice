'use client';

/**
 * Settings are stored as strings, so list-shaped settings are JSON encoded.
 * These helpers keep parse/serialise in one place with safe fallbacks.
 */

export function parseList<T>(value: string | undefined | null, fallback: T[] = []): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function serializeList(list: unknown): string {
  return JSON.stringify(list);
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Adds or removes a value from a string list stored as JSON. */
export function toggleListValue(value: string, item: string): string {
  const list = parseList<string>(value, []);
  const next = list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  return serializeList(next);
}
