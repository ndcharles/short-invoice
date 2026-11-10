'use client';

import React, { useRef, useState } from 'react';
import type { ClientRow } from '@/lib/clients';
import { send } from '@/lib/use-clients';

/** What picking a client writes into an invoice's "Invoiced To". The client is the source; the invoice copies it. */
export function invoicedToFrom(client: Pick<ClientRow, 'id' | 'name' | 'contact_name' | 'email' | 'address_street' | 'address_city' | 'address_country'>) {
  return {
    clientId: client.id,
    clientName: client.name,
    clientContact: client.contact_name,
    clientAddr1: client.address_street,
    clientAddr2: client.address_city,
    clientCountry: client.address_country,
    clientEmail: client.email,
  };
}

// One list per page load; it is small and only needed while typing a name.
let cached: Promise<ClientRow[]> | null = null;
const loadClients = () => {
  cached ??= send<{ clients: ClientRow[] }>('GET', '/api/clients')
    .then((r) => r.clients)
    .catch(() => {
      cached = null;
      return [];
    });
  return cached;
};

/**
 * The client name on an invoice. Typing shows matching clients from the client tracker; picking one fills the
 * contact, address and email and links the invoice to that client. Any name can still be typed for a one-off.
 */
export function ClientNameInput({
  value,
  onType,
  onPick,
  className,
}: {
  value: string;
  onType: (name: string) => void;
  onPick: (client: ClientRow) => void;
  className: string;
}) {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = value.trim().toLowerCase();
  const matches = (clients ?? [])
    .filter((c) => !q || [c.name, c.contact_name, c.email].some((v) => v.toLowerCase().includes(q)))
    .slice(0, 6);
  const show = open && matches.length > 0;

  const focus = () => {
    setOpen(true);
    if (!clients) void loadClients().then(setClients);
  };
  const pick = (c: ClientRow) => {
    setOpen(false);
    onPick(c);
  };

  return (
    <div className="inv-client-pick">
      <input
        className={className}
        value={value}
        placeholder="Client name"
        aria-label="Client name"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        aria-controls="inv-client-list"
        autoComplete="off"
        onFocus={focus}
        onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 120))}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(matches[Math.min(active, matches.length - 1)]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="inv-client-list inv-print-hide" id="inv-client-list" role="listbox" aria-label="Clients">
          <div className="inv-client-list-head">Your clients</div>
          {matches.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={`inv-client-option${i === active ? ' on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (blurTimer.current) clearTimeout(blurTimer.current);
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="n">{c.name}</span>
              <span className="d">{[c.contact_name, c.address_city || c.address_country, c.email].filter(Boolean).join(' · ') || 'No billing details yet'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Under "Invoiced To" on a linked invoice: refill from the client, or unlink. Hidden when printed. */
export function LinkedClient({ clientId, onFill, onUnlink }: { clientId: string; onFill: (client: ClientRow) => void; onUnlink: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fill = async () => {
    setBusy(true);
    setError(null);
    try {
      onFill((await send<{ client: ClientRow }>('GET', `/api/clients/${encodeURIComponent(clientId)}`)).client);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the client');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inv-linked inv-print-hide">
      <a href={`/clients/view?id=${encodeURIComponent(clientId)}`}>Linked client</a>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => void fill()} disabled={busy}>
        {busy ? 'Loading…' : "Use client's details"}
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onUnlink}>
        Unlink
      </button>
      {error && <span className="err">{error}</span>}
    </div>
  );
}
