'use client';

import React, { useState } from 'react';
import { XIcon } from '@/components/icons';
import { currencySymbol, fmtMoney, round2 } from '@/lib/invoices';
import { MoneyInput } from './money-input';
import { useConfirm } from './choice-modal';
import { Portal } from '@/components/portal';

const NOTE_LIMIT = 2000;

export interface PaymentDraft {
  amount: number;
  date: string;
  method: string;
  note: string;
}

/** Today's date in the browser's own timezone, as YYYY-MM-DD. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Log Payment modal (design: shell.js `log-payment-modal`). */
export function LogPaymentModal({
  initialFullyPaid = true,
  currency,
  outstanding,
  methods,
  defaultMethod,
  onClose,
  onSubmit,
}: {
  initialFullyPaid?: boolean;
  currency: string;
  outstanding: number;
  methods: string[];
  /** The invoice's payment method, preselected when it is enabled. */
  defaultMethod?: string;
  onClose: () => void;
  onSubmit: (payment: PaymentDraft) => Promise<void> | void;
}) {
  const [fullyPaid, setFullyPaid] = useState(initialFullyPaid);
  const [amount, setAmount] = useState(initialFullyPaid && outstanding > 0 ? outstanding : 0);
  const [date, setDate] = useState(today());
  const methodOptions = methods.length ? methods : ['Bank transfer'];
  const [method, setMethod] = useState(
    defaultMethod && methodOptions.includes(defaultMethod) ? defaultMethod : methodOptions[0]
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmModal] = useConfirm();

  const symbol = currencySymbol(currency);

  const toggleFullyPaid = (checked: boolean) => {
    setFullyPaid(checked);
    if (checked) setAmount(outstanding > 0 ? outstanding : 0);
  };

  const submit = async () => {
    if (!amount || amount <= 0) {
      setError('Enter the amount received.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Pick the date the payment was received.');
      return;
    }
    if (amount > outstanding + 0.005) {
      const ok = await ask({
        title: 'More than the balance',
        message: `${fmtMoney(amount, currency)} is more than the ${fmtMoney(outstanding, currency)} still due. The extra ${fmtMoney(round2(amount - outstanding), currency)} is shown as a credit on the receipt.`,
        confirmLabel: 'Record with credit',
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ amount: round2(amount), date, method, note: note.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal><div
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
              <MoneyInput
                disabled={fullyPaid}
                autoFocus={!fullyPaid}
                aria-label="Amount paid"
                placeholder="0.00"
                blankZero
                title={fullyPaid ? 'Amount is set to the outstanding balance' : 'Enter the amount received'}
                value={amount}
                onChange={(value) => {
                  setAmount(value);
                  setFullyPaid(outstanding > 0 && Math.abs(value - outstanding) < 0.01);
                }}
              />
            </div>
          </div>

          <div className="log-field-row">
            <div className="log-field">
              <label>Date</label>
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="log-field">
              <label>Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {methodOptions.map((m) => (
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
      {confirmModal}
    </div></Portal>
  );
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const emailList = (value: string) =>
  value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);

export type AttachChoice = 'invoice' | 'receipt' | 'both';

export interface SendDraft {
  to: string[];
  cc: string[];
  copyMe: boolean;
  subject: string;
  message: string;
  attach: AttachChoice;
}

export interface EmailTemplate {
  subject: string;
  message: string;
}

/**
 * Send modal (design: shell.js `send-modal`, templates from Settings → Invoice).
 * The email goes out through the SMTP server in Settings, with the chosen
 * documents attached as PDFs.
 */
export function SendModal({
  clientEmail,
  copyEmail = '',
  hasPayments,
  templates,
  ready,
  onClose,
  onSubmit,
}: {
  clientEmail: string;
  /** Where "Send me a copy" goes (Settings → reply-to or contact email). */
  copyEmail?: string;
  hasPayments: boolean;
  /** Invoice and receipt templates, already filled in for this invoice. */
  templates: Record<'invoice' | 'receipt', EmailTemplate>;
  /** False until SMTP is set up in Settings → Invoice. */
  ready: boolean;
  onClose: () => void;
  /** Resolves when sent; rejects with the reason it was not. */
  onSubmit: (draft: SendDraft, progress: (step: string) => void) => Promise<void>;
}) {
  const initialAttach: AttachChoice = hasPayments ? 'receipt' : 'invoice';
  const [to, setTo] = useState(clientEmail);
  const [cc, setCc] = useState('');
  const [attach, setAttach] = useState<AttachChoice>(initialAttach);
  const templateFor = (choice: AttachChoice) => templates[choice === 'invoice' ? 'invoice' : 'receipt'];
  const [mailSubject, setMailSubject] = useState(templateFor(initialAttach).subject);
  const [body, setBody] = useState(templateFor(initialAttach).message);
  const [edited, setEdited] = useState(false);
  const [sendCopy, setSendCopy] = useState(!!copyEmail);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choices: { id: AttachChoice; title: string; sub: string; needsPayment: boolean }[] = [
    { id: 'receipt', title: 'Receipt only', sub: 'Recommended after payment: the receipt with payments logged.', needsPayment: true },
    { id: 'invoice', title: 'Invoice only', sub: hasPayments ? 'The original invoice, as issued (e.g. if the client asks for it).' : 'The invoice to be paid.', needsPayment: false },
    { id: 'both', title: 'Invoice + Receipt', sub: 'Attach both documents in one email.', needsPayment: true },
  ];

  const pick = (choice: AttachChoice) => {
    setAttach(choice);
    // Follow the matching template until the text has been edited by hand.
    if (!edited) {
      setMailSubject(templateFor(choice).subject);
      setBody(templateFor(choice).message);
    }
  };

  const submit = async () => {
    const recipients = emailList(to);
    const copies = emailList(cc);
    if (recipients.length === 0) {
      setError('A recipient email is required.');
      return;
    }
    const invalid = [...recipients, ...copies].find((email) => !EMAIL_RE.test(email));
    if (invalid) {
      setError(`"${invalid}" is not a valid email address.`);
      return;
    }
    if (!mailSubject.trim() || !body.trim()) {
      setError('Add a subject and a message.');
      return;
    }
    setSending('Preparing…');
    setError(null);
    try {
      await onSubmit(
        { to: recipients, cc: copies, copyMe: sendCopy && !!copyEmail, subject: mailSubject.trim(), message: body, attach },
        setSending
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email');
    } finally {
      setSending(null);
    }
  };

  return (
    <Portal><div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
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
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={!!sending}>
            <XIcon />
          </button>
        </div>

        <div className="send-modal-body">
          {!ready && (
            <div className="send-setup-note">
              Email sending is not set up yet. Add your SMTP details in{' '}
              <a href="/settings/invoice#email-sending">Settings → Invoice → Email sending</a>, then come back to send.
            </div>
          )}

          <div className="log-field">
            <label>
              Recipient email <span className="required-mark">*</span>
            </label>
            <input type="text" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@company.com" />
          </div>

          <div className="log-field">
            <label>CC (optional)</label>
            <input
              type="text"
              inputMode="email"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="finance@client.com, accounts@client.com"
            />
          </div>

          <div className="log-field">
            <label>Subject</label>
            <input
              value={mailSubject}
              onChange={(e) => {
                setMailSubject(e.target.value);
                setEdited(true);
              }}
            />
          </div>

          <div className="log-field">
            <label>Message</label>
            <textarea
              style={{ minHeight: '140px' }}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setEdited(true);
              }}
            />
          </div>

          <div className="send-attach">
            <div className="send-attach-label">Attachments</div>
            {choices.map((choice) => {
              const disabled = choice.needsPayment && !hasPayments;
              return (
                <label
                  key={choice.id}
                  className={`send-choice${attach === choice.id ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                  style={attach === choice.id ? { borderColor: 'var(--foreground)', background: 'var(--muted-2)' } : undefined}
                  title={disabled ? 'Available once a payment is logged' : undefined}
                >
                  <input
                    type="radio"
                    name="invoice-attachment"
                    checked={attach === choice.id}
                    disabled={disabled}
                    onChange={() => pick(choice.id)}
                  />
                  <span>
                    <span className="send-choice-title">{choice.title}</span>
                    <span className="send-choice-sub">{disabled ? 'Available once a payment is logged.' : choice.sub}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {error && (
            <div role="alert" style={{ color: 'var(--destructive)', fontSize: '12px' }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <label
            className="log-check"
            style={{ border: 'none', background: 'transparent', padding: 0, gap: '8px' }}
            title={copyEmail ? `BCC ${copyEmail}` : 'Add a contact email in Settings → Invoice'}
          >
            <input type="checkbox" checked={sendCopy} disabled={!copyEmail} onChange={(e) => setSendCopy(e.target.checked)} />
            <span style={{ fontWeight: 400, fontSize: '13px' }}>Send me a copy</span>
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={!!sending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={!!sending || !ready}>
              {sending ?? 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div></Portal>
  );
}
