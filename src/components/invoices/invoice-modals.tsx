'use client';

import React, { useState } from 'react';
import { Copy, XIcon } from '@/components/icons';
import { CURRENCY_SYMBOLS, fmtMoney } from '@/lib/invoices';
import { toDateInput } from '@/lib/dates';

export interface PaymentDraft {
  amount: number;
  date: string;
  method: string;
  note: string;
}

const NOTE_LIMIT = 500;

function Modal({ title, onClose, children, footer, className = '' }: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className={`modal ${className}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        {children}
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

/** Records money received against an invoice. Status follows automatically. */
export function LogPaymentModal({
  currency,
  balance,
  methods,
  onClose,
  onSubmit,
}: {
  currency: string;
  balance: number;
  methods: string[];
  onClose: () => void;
  onSubmit: (payment: PaymentDraft) => Promise<void>;
}) {
  const [amount, setAmount] = useState(balance > 0 ? balance : 0);
  const [today] = useState(() => toDateInput(Date.now()));
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(methods[0] ?? 'Bank transfer');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const remaining = Math.max(0, Math.round((balance - amount) * 100) / 100);

  const submit = async () => {
    if (!(amount > 0)) {
      setError('Enter the amount received.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ amount, date, method, note });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the payment');
      setSaving(false);
    }
  };

  return (
    <Modal
      className="log-payment-modal"
      onClose={onClose}
      title={<span>Log payment</span>}
      footer={
        <>
          <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', maxWidth: '300px' }}>
            {amount >= balance && balance > 0
              ? 'This settles the invoice; it will be marked Paid.'
              : `Leaves ${fmtMoney(remaining, currency)} outstanding; the invoice will be Partially paid.`}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Add payment'}
            </button>
          </div>
        </>
      }
    >
      <div className="log-payment-body">
        <div className="log-field">
          <label htmlFor="pay-amount">Amount received</label>
          <div className="log-amount-wrap">
            <span className="log-amount-sym">{symbol}</span>
            <input
              id="pay-amount"
              type="number"
              min="0.01"
              step="0.01"
              autoFocus
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted-foreground)' }}>
            <span>Balance due: {fmtMoney(balance, currency)}</span>
            {balance > 0 && amount !== balance && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', height: 'auto' }} onClick={() => setAmount(balance)}>
                Pay full balance
              </button>
            )}
          </div>
        </div>

        <div className="log-field-row">
          <div className="log-field">
            <label htmlFor="pay-date">Date received</label>
            <input id="pay-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="log-field">
            <label htmlFor="pay-method">Method</label>
            <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {(methods.length ? methods : ['Bank transfer']).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="log-field">
          <label htmlFor="pay-note">Note</label>
          <textarea
            id="pay-note"
            maxLength={NOTE_LIMIT}
            placeholder="Optional: transfer reference, cheque number…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <div style={{ color: 'var(--destructive)', fontSize: '12px' }}>{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * Prepares the email to the client. There is no mail server on the free
 * plan, so this opens the user's own email app with everything filled in
 * (and offers to copy it), then marks a draft invoice as sent.
 */
export function SendModal({
  to: initialTo,
  subject: initialSubject,
  body: initialBody,
  link,
  isDraft,
  onClose,
  onSent,
}: {
  to: string;
  subject: string;
  body: string;
  link: string;
  isDraft: boolean;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markSent = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the invoice');
    } finally {
      setBusy(false);
    }
  };

  const openEmail = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      setError('Enter a valid recipient email.');
      return;
    }
    const href = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    await markSent();
  };

  return (
    <Modal
      className="send-modal"
      onClose={onClose}
      title={<span>Send to client</span>}
      footer={
        <>
          <button
            className="btn btn-outline"
            onClick={async () => {
              await navigator.clipboard.writeText(`${subject}\n\n${body}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              await markSent();
            }}
            disabled={busy}
          >
            <Copy />
            <span>{copied ? 'Copied' : 'Copy message'}</span>
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button className="btn btn-primary" onClick={openEmail} disabled={busy}>
              Open in email app
            </button>
          </div>
        </>
      }
    >
      <div className="send-modal-body">
        <div className="log-field">
          <label htmlFor="send-to">To</label>
          <input id="send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="billing@client.com" />
        </div>
        <div className="log-field">
          <label htmlFor="send-subject">Subject</label>
          <input id="send-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="log-field">
          <label htmlFor="send-body">Message</label>
          <textarea id="send-body" style={{ minHeight: '160px' }} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
          The message links to the client view of this invoice:{' '}
          <a href={link} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
            {link}
          </a>
          . The client can download a PDF from there.{isDraft ? ' Sending marks the invoice as Sent.' : ''}
        </div>
        {error && <div style={{ color: 'var(--destructive)', fontSize: '12px' }}>{error}</div>}
      </div>
    </Modal>
  );
}
