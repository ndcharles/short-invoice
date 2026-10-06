'use client';

import React, { useState } from 'react';
import { XIcon } from '@/components/icons';
import { CURRENCY_SYMBOLS, fmtMoney } from '@/lib/invoices';

const NOTE_LIMIT = 2000;

export interface PaymentDraft {
  amount: number;
  date: string;
  method: string;
  note: string;
}

const toDateInput = (d = new Date()) => d.toISOString().slice(0, 10);

/** Log Payment modal (design: shell.js `log-payment-modal`). */
export function LogPaymentModal({
  initialFullyPaid = true,
  currency,
  outstanding,
  methods,
  onClose,
  onSubmit,
}: {
  initialFullyPaid?: boolean;
  currency: string;
  outstanding: number;
  methods: string[];
  onClose: () => void;
  onSubmit: (payment: PaymentDraft) => Promise<void> | void;
}) {
  const [fullyPaid, setFullyPaid] = useState(initialFullyPaid);
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding : 0);
  const [date, setDate] = useState(toDateInput());
  const [method, setMethod] = useState(methods[0] ?? 'Bank transfer');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const symbol = CURRENCY_SYMBOLS[currency] ?? '';

  const toggleFullyPaid = (checked: boolean) => {
    setFullyPaid(checked);
    if (checked) setAmount(outstanding > 0 ? outstanding : 0);
  };

  const submit = async () => {
    if (!amount || amount <= 0) {
      setError('Enter the amount received.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ amount, date, method, note });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal log-payment-modal" role="dialog" aria-label="Log Payment">
        <div className="modal-header">
          <div className="modal-title">
            <span style={{ fontWeight: 600 }}>{symbol}</span>
            <span>Log Payment</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="log-payment-body">
          <label className="log-check">
            <input type="checkbox" checked={fullyPaid} onChange={(e) => toggleFullyPaid(e.target.checked)} />
            <span>Fully paid</span>
            <span className="log-check-hint">
              Outstanding balance: <strong>{fmtMoney(outstanding, currency)}</strong>
            </span>
          </label>

          <div className="log-field">
            <label>Amount paid</label>
            <div className="log-amount-wrap">
              <span className="log-amount-sym">{symbol}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                disabled={fullyPaid}
                title={fullyPaid ? 'Amount is set to the outstanding balance' : 'Enter the amount received'}
                value={amount || ''}
                onChange={(e) => {
                  setAmount(Number(e.target.value));
                  setFullyPaid(Math.abs(Number(e.target.value) - outstanding) < 0.01);
                }}
              />
            </div>
          </div>

          <div className="log-field-row">
            <div className="log-field">
              <label>Date</label>
              <input
                type="text"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder={toDateInput()}
              />
            </div>
            <div className="log-field">
              <label>Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="log-field">
            <label>Note</label>
            <textarea
              maxLength={NOTE_LIMIT}
              placeholder="Optional reference, cheque number, or context…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="log-charcount">
              {note.length} / {NOTE_LIMIT} characters at most
            </span>
          </div>

          {error && <div style={{ color: 'var(--destructive)', fontSize: '12px' }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <div style={{ fontSize: '13px', color: 'var(--muted-foreground)', maxWidth: '320px' }}>
            Full payment marks as <strong style={{ color: 'var(--foreground)' }}>Paid</strong>; partial marks as{' '}
            <strong style={{ color: 'var(--foreground)' }}>Partially paid</strong>.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={saving}>
              Close
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Adding…' : 'Add Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Send modal (design: shell.js `send-modal`, templates from Settings → Invoice). */
export function SendModal({
  clientEmail,
  subject,
  message,
  receiptMode,
  onClose,
  onSubmit,
}: {
  clientEmail: string;
  subject: string;
  message: string;
  receiptMode: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void> | void;
}) {
  const [to, setTo] = useState(clientEmail);
  const [cc, setCc] = useState('');
  const [mailSubject, setMailSubject] = useState(subject);
  const [body, setBody] = useState(message);
  const [attach, setAttach] = useState(receiptMode ? 'receipt' : 'invoice');
  const [sendCopy, setSendCopy] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = [
    { id: 'receipt', title: 'Receipt only', sub: 'Recommended after payment — clean receipt document.' },
    { id: 'invoice', title: 'Invoice only', sub: 'Resend the original bill (e.g. if the client requests it).' },
    { id: 'both', title: 'Invoice + Receipt', sub: 'Attach both documents in one email.' },
  ];

  const submit = async () => {
    if (!to.trim()) {
      setError('A recipient email is required.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invoice');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal send-modal" role="dialog" aria-label="Send to client">
        <div className="modal-header">
          <div className="modal-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>Send to client</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="send-modal-body">
          <div className="log-field">
            <label>
              Recipient email <span className="required-mark">*</span>
            </label>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@company.com" />
          </div>

          <div className="log-field">
            <label>CC (optional)</label>
            <input
              type="email"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="finance@yourcompany.com"
            />
          </div>

          <div className="log-field">
            <label>Subject</label>
            <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} />
          </div>

          <div className="log-field">
            <label>Message</label>
            <textarea
              style={{ minHeight: '120px' }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Hi {client},\n\n…`}
            />
          </div>

          <div className="send-attach">
            <div className="send-attach-label">Attachments</div>
            {choices.map((choice) => (
              <label
                key={choice.id}
                className={`send-choice${attach === choice.id ? ' is-selected' : ''}`}
                style={attach === choice.id ? { borderColor: 'var(--foreground)', background: 'var(--muted-2)' } : undefined}
              >
                <input
                  type="radio"
                  name="invoice-attachment"
                  checked={attach === choice.id}
                  onChange={() => setAttach(choice.id)}
                />
                <span>
                  <span className="send-choice-title">{choice.title}</span>
                  <span className="send-choice-sub">{choice.sub}</span>
                </span>
              </label>
            ))}
          </div>

          {error && <div style={{ color: 'var(--destructive)', fontSize: '12px' }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <label className="log-check" style={{ border: 'none', background: 'transparent', padding: 0, gap: '8px' }}>
            <input type="checkbox" checked={sendCopy} onChange={(e) => setSendCopy(e.target.checked)} />
            <span style={{ fontWeight: 400, fontSize: '13px' }}>Send me a copy</span>
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
