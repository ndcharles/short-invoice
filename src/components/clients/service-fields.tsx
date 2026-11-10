'use client';

import React from 'react';
import {
  MODE_LABEL,
  PART_LABEL,
  PER_LABEL,
  REPEATS,
  REPEATS_LABEL,
  STATUSES,
  STATUS_LABEL,
  includesFor,
  modeOf,
  modesFor,
  type Mode,
  type PartName,
  type Repeats,
  type ServiceRow,
  type ServiceTypeRow,
  type Status,
  type TypePart,
} from '@/lib/clients';
import { round2 } from '@/lib/invoices';
import { AreaField, DateField, Label, MoneyField, NumberField, Seg, SelectField, TextField } from './ui';

type PartDraft = { on: boolean; provider: string; count: number | null };

/** A service being written in a form (Log a client, Add a service, Edit). */
export interface ServiceDraft {
  type_id: string;
  typePart: TypePart | null;
  typeName: string;
  priceUnit: 'once' | 'each';
  name: string;
  mode: Mode;
  repeats: Repeats;
  next_at: number | null;
  due_at: number | null;
  status: Status;
  amount: number;
  quantity: number;
  details: string;
  parts: Record<PartName, PartDraft>;
}

const emptyParts = (on: PartName[] = []): Record<PartName, PartDraft> => ({
  website: { on: on.includes('website'), provider: '', count: null },
  domain: { on: on.includes('domain'), provider: '', count: null },
  hosting: { on: on.includes('hosting'), provider: '', count: null },
  email: { on: on.includes('email'), provider: '', count: null },
  other: { on: on.includes('other'), provider: '', count: null },
});

export function draftFromType(type: ServiceTypeRow): ServiceDraft {
  return {
    type_id: type.id,
    typePart: type.part,
    typeName: type.name,
    priceUnit: type.price_unit,
    name: type.part === 'other' ? '' : type.name,
    mode: type.part === 'maintenance' ? 'scheduled' : 'oneoff',
    repeats: type.part === 'maintenance' ? 'monthly' : 'yearly',
    next_at: null,
    due_at: null,
    status: 'not_started',
    amount: Number(type.price) || 0,
    quantity: 1,
    details: '',
    // A website includes itself; email always records its own provider.
    parts: emptyParts(type.part === 'website' ? ['website'] : type.part === 'email' ? ['email'] : []),
  };
}

export function draftFromService(service: ServiceRow, type: ServiceTypeRow | undefined): ServiceDraft {
  const parts = emptyParts();
  for (const p of service.parts ?? []) parts[p.part] = { on: true, provider: p.provider, count: p.count };
  return {
    type_id: service.type_id,
    typePart: service.type_part ?? type?.part ?? null,
    typeName: type?.name ?? service.name,
    priceUnit: type?.price_unit ?? 'once',
    name: service.name,
    mode: modeOf(service),
    repeats: service.repeats,
    next_at: service.next_at,
    due_at: service.due_at,
    status: service.status,
    amount: Number(service.amount) || 0,
    quantity: Number(service.quantity) || 1,
    details: service.details,
    parts,
  };
}

/** What the API takes for a service. */
export function servicePayload(d: ServiceDraft) {
  const fixed = !modesFor(d.typePart).length;
  return {
    type_id: d.type_id,
    name: d.name.trim(),
    ...(fixed ? {} : { mode: d.mode }),
    repeats: d.repeats,
    next_at: fixed || d.mode !== 'oneoff' ? d.next_at : null,
    due_at: fixed || d.mode === 'oneoff' ? d.due_at : null,
    status: d.status,
    amount: round2(d.amount),
    quantity: d.priceUnit === 'each' ? d.quantity : 1,
    details: d.details,
    parts: (Object.keys(d.parts) as PartName[])
      .filter((p) => d.parts[p].on)
      .map((p) => ({ part: p, provider: d.parts[p].provider.trim(), count: d.parts[p].count })),
  };
}

/** A problem that stops the form saving, in plain words, or null. */
export function serviceProblem(d: ServiceDraft): string | null {
  if (d.typePart === 'other' && !d.name.trim()) return 'Give "Something else" a name';
  if (modesFor(d.typePart).length && d.mode === 'scheduled' && d.next_at === null) return `${d.name || d.typeName}: add the next date`;
  return null;
}

const PROVIDER_LABEL: Partial<Record<PartName, string>> = { domain: 'Domain provider', hosting: 'Hosting provider', other: 'What else?' };
const PROVIDER_HINT: Partial<Record<PartName, string>> = { domain: 'Namecheap', hosting: 'Hetzner', other: 'SSL certificate' };

/**
 * The fields for one service. Website and Email: what they include, providers, a due date, a charge, an optional
 * renewal date and a status. Maintenance: scheduled or one-off. Other types: renews, scheduled or one-off.
 */
export function ServiceFields({ draft, onChange, symbol, idPrefix }: { draft: ServiceDraft; onChange: (next: ServiceDraft) => void; symbol: string; idPrefix: string }) {
  const set = <K extends keyof ServiceDraft>(key: K, value: ServiceDraft[K]) => onChange({ ...draft, [key]: value });
  const setPart = (part: PartName, patch: Partial<PartDraft>) => onChange({ ...draft, parts: { ...draft.parts, [part]: { ...draft.parts[part], ...patch } } });
  const id = (name: string) => `${idPrefix}-${name}`;
  const part = draft.typePart;
  const modes = modesFor(part);
  const fixed = !modes.length;
  const ticks = includesFor(part);
  const tickLabel = part === 'maintenance' ? 'Looks after' : 'Includes';
  const tickTip =
    part === 'maintenance'
      ? 'What this plan looks after. The checklist for “Mark done” follows these ticks.'
      : 'Tick what this service covers. Domain and Hosting add a box for the provider.';

  const providerBoxes = ticks
    .filter((p) => draft.parts[p].on && PROVIDER_LABEL[p] && (part !== 'maintenance' || p === 'other'))
    .map((p) => (
      <TextField key={p} id={id(`prov-${p}`)} label={PROVIDER_LABEL[p] as string} value={draft.parts[p].provider} placeholder={PROVIDER_HINT[p]} maxLength={120} onChange={(v) => setPart(p, { provider: v })} />
    ));

  const status = (
    <div className="ct-field full">
      <Label>Status</Label>
      <Seg wide label="Status" value={draft.status} options={STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))} onChange={(v) => set('status', v)} />
    </div>
  );
  const details = <AreaField id={id('details')} label="Details" value={draft.details} onChange={(v) => set('details', v)} tip="Anything extra. Only your team sees it." />;
  const repeatsField = (
    <SelectField id={id('repeats')} label="Repeats" value={draft.repeats} options={REPEATS.map((r) => ({ id: r, label: REPEATS_LABEL[r] }))} onChange={(v) => set('repeats', v)} />
  );
  const nameField =
    part === 'other' ? (
      <TextField id={id('name')} label="Name" required value={draft.name} maxLength={80} placeholder="What is it?" onChange={(v) => set('name', v)} />
    ) : part === 'maintenance' ? (
      <TextField id={id('name')} label="Plan name" value={draft.name} maxLength={80} onChange={(v) => set('name', v)} />
    ) : null;
  const price =
    draft.priceUnit === 'each' && draft.mode === 'oneoff' && !fixed ? (
      <>
        <NumberField id={id('qty')} label="Quantity" value={draft.quantity} onChange={(v) => set('quantity', v)} tip="How many, for example 350 certificates." />
        <MoneyField id={id('price')} label="Price each" symbol={symbol} value={draft.amount} onChange={(v) => set('amount', v)} />
        <MoneyField id={id('total')} label="Total" symbol={symbol} value={round2(draft.amount * (draft.quantity || 0))} />
      </>
    ) : (
      <MoneyField
        id={id('price')}
        label={draft.mode === 'oneoff' && !fixed ? 'Price' : 'Charge'}
        symbol={symbol}
        suffix={!fixed && draft.mode === 'scheduled' ? PER_LABEL[draft.repeats] : undefined}
        value={draft.amount}
        onChange={(v) => set('amount', v)}
        tip="Starts from the default in Settings → Clients. Change it for this client only."
      />
    );

  return (
    <div className="ct-grid tight">
      {!fixed && (
        <div className="ct-field full">
          <Label tip="Renews: comes back on a date and you bill again. Scheduled: the same work on a schedule. One-off: done once.">How it works</Label>
          <Seg wide label="How it works" value={draft.mode} options={modes.map((m) => ({ id: m, label: MODE_LABEL[m] }))} onChange={(v) => set('mode', v)} />
        </div>
      )}

      <div className="ct-field full">
        <Label tip={tickTip}>{tickLabel}</Label>
        <div className="ct-pills" role="group" aria-label={tickLabel}>
          {ticks.map((p) => (
            <label key={p} className={`ct-pill${draft.parts[p].on ? ' on' : ''}`}>
              <input type="checkbox" checked={draft.parts[p].on} onChange={() => setPart(p, { on: !draft.parts[p].on })} />
              {PART_LABEL[p]}
            </label>
          ))}
        </div>
      </div>

      {part === 'website' && (
        <>
          <TextField id={id('built')} label="Built with" value={draft.parts.website.provider} placeholder="WordPress" maxLength={120} onChange={(v) => setPart('website', { provider: v, on: true })} />
          {providerBoxes}
        </>
      )}
      {part === 'email' && (
        <>
          <TextField id={id('provider')} label="Provider" value={draft.parts.email.provider} placeholder="Google Workspace" maxLength={120} onChange={(v) => setPart('email', { provider: v, on: true })} />
          <NumberField id={id('mailboxes')} label="Mailboxes" value={draft.parts.email.count ?? 0} onChange={(v) => setPart('email', { count: v ? Math.floor(v) : null, on: true })} />
          {providerBoxes}
        </>
      )}
      {part !== 'website' && part !== 'email' && (
        <>
          {nameField}
          {providerBoxes}
        </>
      )}

      {fixed ? (
        <>
          <DateField id={id('due')} label="Due date" value={draft.due_at} onChange={(v) => set('due_at', v)} tip="When the work is due. You get reminders before it." />
          {price}
          <DateField
            id={id('renew')}
            label="Renews on"
            value={draft.next_at}
            onChange={(v) => set('next_at', v)}
            tip="Leave empty if it does not renew. When set, you get renewal reminders before this date, and Renew moves it on a year."
          />
        </>
      ) : draft.mode === 'renews' ? (
        <>
          <DateField id={id('renew')} label="Renews on" value={draft.next_at} onChange={(v) => set('next_at', v)} tip="You get renewal reminders before this date." />
          {price}
        </>
      ) : draft.mode === 'scheduled' ? (
        <>
          <DateField id={id('next')} label="Next date" required value={draft.next_at} onChange={(v) => set('next_at', v)} tip="You get a reminder on each scheduled date." />
          {repeatsField}
          {price}
        </>
      ) : (
        <>
          <DateField id={id('due')} label="Due date" value={draft.due_at} onChange={(v) => set('due_at', v)} tip="When the work is due. You get reminders before it." />
          {price}
        </>
      )}

      {status}
      {details}
    </div>
  );
}
