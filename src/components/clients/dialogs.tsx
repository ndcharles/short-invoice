'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Portal } from '@/components/portal';
import { XIcon } from '@/components/icons';
import { addCycle, parseMeta, visitChecklist, type ClientRow, type ServiceRow, type ServiceTypeRow } from '@/lib/clients';
import { fmtMoney } from '@/lib/invoices';
import { send, useClientSettings } from '@/lib/use-clients';
import { draftFromService, draftFromType, serviceProblem, servicePayload, ServiceFields, type ServiceDraft } from './service-fields';
import { MoneyField, PartIcon } from './ui';

function Dialog({ title, sub, icon, small, onClose, children, footer }: {
  title: string;
  sub?: string;
  icon?: React.ReactNode;
  small?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Portal>
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal ct-dialog${small ? ' sm' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal-header">
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {icon && <span className="ct-icon lg">{icon}</span>}
              <span>
                <span style={{ display: 'block' }}>{title}</span>
                {sub && <span style={{ display: 'block', fontSize: 12.5, fontWeight: 400, color: 'var(--muted-foreground)' }}>{sub}</span>}
              </span>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <XIcon />
            </button>
          </div>
          <div className="ct-dialog-body">{children}</div>
          <div className="modal-footer">{footer}</div>
        </div>
      </div>
    </Portal>
  );
}

/** Add a service to a client, or edit one (its type stays; how it works can change). */
export function ServiceDialog({
  client,
  service,
  types,
  onClose,
  onSaved,
}: {
  client: ClientRow;
  service: ServiceRow | null;
  types: ServiceTypeRow[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const cfg = useClientSettings();
  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const choices = types.filter((t) => t.show_in_add || t.id === service?.type_id);
  const [draft, setDraft] = useState<ServiceDraft | null>(() =>
    service ? draftFromService(service, byId.get(service.type_id)) : choices[0] ? draftFromType(choices[0]) : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (another: boolean) => {
    if (!draft) return;
    const problem = serviceProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = service
        ? await send<{ invoice: { number: string } | null }>('PATCH', `/api/clients/services/${service.id}`, servicePayload(draft, true))
        : await send<{ invoice?: { number: string } | null }>('POST', `/api/clients/${client.id}/services`, servicePayload(draft, true));
      const name = draft.name || 'Service';
      onSaved(data.invoice ? `${name} saved. Draft invoice ${data.invoice.number} created.` : `${name} saved`);
      if (another) {
        setDraft(choices[0] ? draftFromType(choices[0]) : null);
      } else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={service ? `Edit ${service.name}` : 'Add a service'}
      sub={`For ${client.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {!service && (
              <button className="btn btn-outline" onClick={() => void save(true)} disabled={saving || !draft}>
                Save and add another
              </button>
            )}
            <button className="btn btn-primary" onClick={() => void save(false)} disabled={saving || !draft}>
              {saving ? 'Saving…' : service ? 'Save changes' : 'Save service'}
            </button>
          </div>
        </>
      }
    >
      {!service && (
        <div className="ct-field">
          <span className="ct-label">What is it?</span>
          <div className="ct-tiles">
            {choices.map((t) => (
              <button key={t.id} type="button" className={draft?.type_id === t.id ? 'on' : ''} aria-pressed={draft?.type_id === t.id} onClick={() => setDraft(draftFromType(t))}>
                <PartIcon part={t.part} kind={t.kind} size={16} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <div className="ct-error" role="alert">{error}</div>}
      {draft && (
        <ServiceFields draft={draft} onChange={setDraft} symbol={cfg.symbol} idPrefix="dlg" allowKindChange />
      )}
    </Dialog>
  );
}

/** Renew a service: the next date is counted from the old one; optionally draft the renewal invoice. */
export function RenewDialog({ service, clientName, onClose, onDone }: {
  service: ServiceRow;
  clientName: string;
  onClose: () => void;
  onDone: (message: string, invoiceId?: string) => void;
}) {
  const cfg = useClientSettings();
  const [price, setPrice] = useState(Number(service.price) || 0);
  const alreadyInvoiced = service.invoiced_for !== null && service.invoiced_for === service.next_date;
  const [invoice, setInvoice] = useState(!alreadyInvoiced);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = service.next_date as number;
  const to = addCycle(from, service.cycle);
  const [now] = useState(() => Date.now());
  const overdue = from < now - 86_400_000;

  const renew = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = await send<{ invoice: { id: string; number: string } | null }>('POST', `/api/clients/services/${service.id}/renew`, { price, invoice });
      onDone(
        data.invoice ? `Renewed. Draft invoice ${data.invoice.number} is ready to review.` : `Renewed. Next date ${cfg.fmt(to)}.`,
        data.invoice?.id
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not renew');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      small
      title={`Renew ${service.name.toLowerCase()}`}
      sub={clientName}
      icon={<PartIcon part={service.part} kind={service.kind} size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void renew()} disabled={saving}>
            {saving ? 'Renewing…' : invoice ? 'Renew and create invoice' : 'Renew'}
          </button>
        </>
      }
    >
      <div className="ct-dates">
        <div>
          <div className="k">{overdue ? 'Was due' : 'Renews on'}</div>
          <div className="v">{cfg.fmt(from)}</div>
        </div>
        <span className="arrow" aria-hidden="true">→</span>
        <div className="to">
          <div className="k">Renews next on</div>
          <div className="v">{cfg.fmt(to)}</div>
          <div style={{ fontSize: 12, color: '#525252' }}>Counted from the old date</div>
        </div>
      </div>
      <MoneyField id="renew-price" label={`Price for the new ${service.cycle === 'monthly' ? 'month' : 'year'}`} symbol={cfg.symbol} value={price} onChange={setPrice} />
      {error && <div className="ct-error" role="alert">{error}</div>}
      <div className="ct-field">
        <span className="ct-label">What should we do?</span>
        {alreadyInvoiced ? (
          <div className="ct-box">This period already has a draft invoice (made ahead of time), so only the date moves forward.</div>
        ) : (
          <>
            <label className={`ct-radio${invoice ? ' on' : ''}`}>
              <input type="radio" name="renew-do" checked={invoice} onChange={() => setInvoice(true)} />
              <span>
                <span className="t">Create a renewal invoice</span>
                <span className="d">A draft for {clientName}: {fmtMoney(price, service.currency)} before tax. You review and send it from Invoices.</span>
              </span>
            </label>
            <label className={`ct-radio${!invoice ? ' on' : ''}`}>
              <input type="radio" name="renew-do" checked={!invoice} onChange={() => setInvoice(false)} />
              <span>
                <span className="t">Only move the date forward</span>
                <span className="d">Use this if it is already paid, or you do not bill for it.</span>
              </span>
            </label>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Mark a scheduled service done: tick the steps (from what the plan looks after) and note anything worth keeping. */
export function VisitDialog({ service, clientName, onClose, onDone }: {
  service: ServiceRow;
  clientName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const cfg = useClientSettings();
  const steps = useMemo(() => visitChecklist(parseMeta(service.meta), cfg.settings), [service.meta, cfg.settings]);
  const [ticked, setTicked] = useState<boolean[]>(() => steps.map(() => false));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = addCycle(service.next_date as number, service.cycle);
  const doneCount = ticked.filter(Boolean).length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await send('POST', `/api/clients/services/${service.id}/visit`, { done_steps: doneCount, total_steps: steps.length, note });
      onDone(`Marked done (${doneCount} of ${steps.length} steps). Next scheduled date ${cfg.fmt(next)}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      small
      title={`Schedule: ${service.name}`}
      sub={`${clientName} · due ${cfg.fmt(service.next_date)}`}
      icon={<PartIcon part="maintenance" size={16} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Mark done'}
          </button>
        </>
      }
    >
      {error && <div className="ct-error" role="alert">{error}</div>}
      <div className="ct-field">
        <span className="ct-label">What we did this time</span>
        {steps.map((step, i) => (
          <label key={step + i} className="ct-check" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={ticked[i]} onChange={() => setTicked((t) => t.map((v, j) => (j === i ? !v : v)))} />
            {step}
          </label>
        ))}
        <span className="ct-muted">Steps come from Settings → Clients and follow what the plan looks after.</span>
      </div>
      <div className="ct-field">
        <label className="ct-label" htmlFor="visit-note">Note (optional)</label>
        <textarea id="visit-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Updated 6 plugins. Backups fine." />
      </div>
      <div className="ct-box">The next scheduled date moves to {cfg.fmt(next)}.</div>
    </Dialog>
  );
}
