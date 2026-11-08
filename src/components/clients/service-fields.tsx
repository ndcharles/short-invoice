'use client';

import React from 'react';
import {
  INVOICE_WHEN,
  INVOICE_WHEN_LABEL,
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  KIND_HELP,
  KIND_LABEL,
  LOOKS_AFTER,
  parseMeta,
  type Cycle,
  type InvoiceWhen,
  type JobStatus,
  type ServiceKind,
  type ServiceMeta,
  type ServiceRow,
  type ServiceTypeRow,
} from '@/lib/clients';
import { round2 } from '@/lib/invoices';
import { AreaField, DateField, Label, MoneyField, NumberField, Seg, SelectField, TextField, Tip } from './ui';

/** A service being written in a form (Log a client, Add a service, Edit). */
export interface ServiceDraft {
  type_id: string;
  part: string | null;
  typeKind: ServiceTypeRow['kind'];
  priceUnit: 'once' | 'each';
  name: string;
  kind: ServiceKind;
  details: string;
  meta: ServiceMeta;
  cycle: Cycle;
  next_date: number | null;
  price: number;
  quantity: number;
  job_status: JobStatus;
  invoice_when: InvoiceWhen | '';
}

export function draftFromType(type: ServiceTypeRow): ServiceDraft {
  const kind: ServiceKind = type.kind === 'any' ? 'job' : type.kind;
  return {
    type_id: type.id,
    part: type.part,
    typeKind: type.kind,
    priceUnit: type.price_unit,
    name: type.kind === 'any' ? '' : type.name,
    kind,
    details: '',
    meta: type.part === 'maintenance' ? { looks_after: [] } : {},
    cycle: kind === 'job' ? 'once' : type.cycle === 'once' ? (kind === 'visits' ? 'monthly' : 'yearly') : type.cycle,
    next_date: null,
    price: Number(type.price) || 0,
    quantity: 1,
    job_status: 'not_started',
    invoice_when: '',
  };
}

export function draftFromService(service: ServiceRow, type: ServiceTypeRow | undefined): ServiceDraft {
  return {
    type_id: service.type_id,
    part: service.part ?? type?.part ?? null,
    typeKind: type?.kind ?? service.kind,
    priceUnit: type?.price_unit ?? 'once',
    name: service.name,
    kind: service.kind,
    details: service.details,
    meta: parseMeta(service.meta),
    cycle: service.cycle,
    next_date: service.next_date,
    price: Number(service.price) || 0,
    quantity: Number(service.quantity) || 1,
    job_status: (service.job_status || 'not_started') as JobStatus,
    invoice_when: service.invoice_when,
  };
}

/** What the API takes for a service. */
export function servicePayload(d: ServiceDraft, includeKind: boolean) {
  return {
    type_id: d.type_id,
    name: d.name.trim(),
    ...(includeKind ? { kind: d.kind } : {}),
    details: d.details,
    meta: d.meta,
    cycle: d.kind === 'job' ? 'once' : d.cycle,
    next_date: d.next_date,
    price: round2(d.price),
    quantity: d.kind === 'job' ? d.quantity : 1,
    ...(d.kind === 'job' ? { job_status: d.job_status, invoice_when: d.invoice_when } : {}),
  };
}

/** A problem that stops the form saving, in plain words, or null. */
export function serviceProblem(d: ServiceDraft): string | null {
  const name = d.name.trim() || 'This service';
  if (d.typeKind === 'any' && !d.name.trim()) return 'Give "Something else" a name';
  if (d.kind === 'renews' && ['domain', 'hosting', 'email'].includes(d.part ?? '') && d.next_date === null) return `${name}: add the date it renews`;
  if (d.kind === 'visits' && d.next_date === null) return `${name}: add the first scheduled date`;
  return null;
}

const CYCLE_OPTIONS: { id: Cycle; label: string }[] = [
  { id: 'yearly', label: 'Yearly' },
  { id: 'monthly', label: 'Monthly' },
];

/** The fields for one service, matching how it works (renews, schedule, one-off job) and its part. */
export function ServiceFields({
  draft,
  onChange,
  symbol,
  idPrefix,
  allowKindChange,
}: {
  draft: ServiceDraft;
  onChange: (next: ServiceDraft) => void;
  symbol: string;
  idPrefix: string;
  allowKindChange: boolean;
}) {
  const set = <K extends keyof ServiceDraft>(key: K, value: ServiceDraft[K]) => onChange({ ...draft, [key]: value });
  const setMeta = (key: keyof ServiceMeta, value: ServiceMeta[keyof ServiceMeta]) => onChange({ ...draft, meta: { ...draft.meta, [key]: value } });
  const id = (name: string) => `${idPrefix}-${name}`;
  const per = draft.cycle === 'monthly' ? 'per month' : 'per year';
  const part = draft.part;
  const metaText = (key: 'built_with' | 'registrar' | 'provider' | 'plan' | 'mailboxes', label: string, placeholder?: string) => (
    <TextField id={id(key)} label={label} value={draft.meta[key] ?? ''} placeholder={placeholder} maxLength={120} onChange={(v) => setMeta(key, v)} />
  );

  const priceTip = 'Filled from Settings → Clients. Change it for this client only.';
  const cycleField = (
    <SelectField id={id('cycle')} label={draft.kind === 'visits' ? 'Repeats' : 'Billing cycle'} value={draft.cycle} options={CYCLE_OPTIONS} onChange={(v) => set('cycle', v)} />
  );

  return (
    <div className="ct-grid">
      {draft.typeKind === 'any' && (
        <TextField id={id('name')} label="Name" required value={draft.name} maxLength={80} placeholder="What is it?" onChange={(v) => set('name', v)} />
      )}
      <div className="ct-field">
        <Label tip={`Renews: ${KIND_HELP.renews} Schedule: ${KIND_HELP.visits} One-off job: ${KIND_HELP.job} The fields below change to match.`}>How it works</Label>
        {allowKindChange ? (
          <Seg
            label="How it works"
            value={draft.kind}
            options={(['renews', 'visits', 'job'] as ServiceKind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))}
            onChange={(kind) => onChange({ ...draft, kind, cycle: kind === 'job' ? 'once' : draft.cycle === 'once' ? (kind === 'visits' ? 'monthly' : 'yearly') : draft.cycle })}
          />
        ) : (
          <span className="ct-kind" style={{ alignSelf: 'flex-start' }}>{KIND_LABEL[draft.kind]}</span>
        )}
      </div>

      {part === 'maintenance' && <TextField id={id('name')} label="Plan name" value={draft.name} maxLength={80} onChange={(v) => set('name', v)} />}
      {part === 'website' && metaText('built_with', 'Built with', 'WordPress')}
      {part === 'domain' && metaText('registrar', 'Registrar', 'Namecheap')}
      {(part === 'hosting' || part === 'email') && metaText('provider', part === 'email' ? 'Provider' : 'Hosting provider', part === 'email' ? 'Google Workspace' : '')}
      {part === 'hosting' && metaText('plan', 'Plan')}
      {part === 'email' && metaText('mailboxes', 'Mailboxes', '5')}

      {draft.kind === 'renews' && (
        <>
          <DateField
            id={id('date')}
            label={part === 'website' ? 'Renews on (if you bill yearly)' : 'Renews on'}
            required={['domain', 'hosting', 'email'].includes(part ?? '')}
            tip={part === 'domain' ? 'Usually one year after registration. Change it if the registrar shows another date.' : undefined}
            value={draft.next_date}
            onChange={(v) => set('next_date', v)}
          />
          {cycleField}
          <MoneyField id={id('price')} label="What you charge" symbol={symbol} suffix={per} value={draft.price} onChange={(v) => set('price', v)} tip={priceTip} />
          {!part || part === 'other' || part === 'ssl' ? (
            <AreaField id={id('details')} label="Details" value={draft.details} onChange={(v) => set('details', v)} tip="Only your team sees it." />
          ) : null}
        </>
      )}

      {draft.kind === 'visits' && (
        <>
          <DateField
            id={id('date')}
            label="Next scheduled date"
            required
            tip="You get a reminder on each scheduled date. The checklist comes from Settings → Clients."
            value={draft.next_date}
            onChange={(v) => set('next_date', v)}
          />
          {cycleField}
          <MoneyField id={id('price')} label="What you charge" symbol={symbol} suffix={per} value={draft.price} onChange={(v) => set('price', v)} />
          <div className="ct-field full">
            <Label tip="Tick everything this plan looks after, even if it is not with us. The schedule checklist follows these ticks.">Looks after</Label>
            <div className="ct-pills" role="group" aria-label="Looks after">
              {LOOKS_AFTER.map((name) => {
                const on = (draft.meta.looks_after ?? []).includes(name);
                return (
                  <label key={name} className={`ct-pill${on ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setMeta('looks_after', on ? (draft.meta.looks_after ?? []).filter((n) => n !== name) : [...(draft.meta.looks_after ?? []), name])
                      }
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          </div>
          {part !== 'maintenance' && <AreaField id={id('details')} label="Details" value={draft.details} onChange={(v) => set('details', v)} />}
        </>
      )}

      {draft.kind === 'job' && (
        <>
          <AreaField
            id={id('details')}
            label="Details"
            value={draft.details}
            onChange={(v) => set('details', v)}
            tip="Describe what you are doing for them. Only your team sees it."
          />
          <div className="ct-field">
            <Label>Status</Label>
            <Seg label="Status" value={draft.job_status} options={JOB_STATUSES.map((s) => ({ id: s, label: JOB_STATUS_LABEL[s] }))} onChange={(v) => set('job_status', v)} />
          </div>
          <DateField
            id={id('date')}
            label="Due date"
            tip="You get reminders before it is due. Change the days in Settings → Clients."
            value={draft.next_date}
            onChange={(v) => set('next_date', v)}
          />
          <NumberField
            id={id('qty')}
            label="Quantity"
            value={draft.quantity}
            onChange={(v) => set('quantity', v)}
            tip="Leave at 1 for a single job. For a batch, put how many, for example 350 certificates."
          />
          <MoneyField id={id('price')} label="Price each" symbol={symbol} value={draft.price} onChange={(v) => set('price', v)} tip={priceTip} />
          <MoneyField id={id('total')} label="Total" symbol={symbol} value={round2(draft.price * (draft.quantity || 0))} tip="Quantity times price each." />
          <SelectField
            id={id('inv')}
            label="Draft the invoice"
            value={draft.invoice_when}
            options={[{ id: '' as const, label: 'Settings default' }, ...INVOICE_WHEN.map((w) => ({ id: w, label: INVOICE_WHEN_LABEL[w] }))]}
            onChange={(v) => set('invoice_when', v)}
            tip="You still review and send it. Nothing reaches the client by itself."
          />
        </>
      )}
    </div>
  );
}

export { Tip };
