'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettings } from '@/lib/collections';
import { clientRules, type ServiceTypeRow } from '@/lib/clients';
import { currencyCode, currencySymbol } from '@/lib/invoices';
import { DEFAULT_DATE_FORMAT, formatDate } from '@/lib/dates';

/** The service types (Settings → Clients), shared by the forms. */
export function useServiceTypes() {
  const [types, setTypes] = useState<ServiceTypeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/service-types');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load service types');
      setTypes(data.types);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load service types');
    }
  }, []);
  useEffect(() => {
    // Loading data for this view from the API, not deriving state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);
  return { types, error, reload };
}

/** What the client screens read from Settings: date format, currency and the reminder rules. */
export function useClientSettings() {
  const settings = useSettings();
  return useMemo(() => {
    const s = settings ?? {};
    const currency = currencyCode(s.inv_default_currency);
    const dateFormat = s.date_format || DEFAULT_DATE_FORMAT;
    return {
      loaded: settings !== null,
      currency,
      symbol: currencySymbol(currency),
      dateFormat,
      fmt: (ms: number | null | undefined) => formatDate(ms, dateFormat),
      rules: clientRules(s),
      settings: s,
    };
  }, [settings]);
}

/** Small JSON helper for the client screens: throws the API's own error message. */
export async function send<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  // Writes always carry a JSON body (the API's CSRF guard asks for one); reads and deletes carry none.
  const payload = body !== undefined ? JSON.stringify(body) : method === 'POST' || method === 'PATCH' ? '{}' : undefined;
  const res = await fetch(url, {
    method,
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong');
  return data as T;
}
