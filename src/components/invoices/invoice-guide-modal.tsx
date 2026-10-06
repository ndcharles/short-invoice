'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, XIcon } from '@/components/icons';
import { STATUS_META, type InvoiceStatus } from '@/lib/invoices';

const STEPS: { id: InvoiceStatus; when: string; why: string }[] = [
  {
    id: 'draft',
    when: 'Every new invoice starts here. Edit freely; nothing has gone to the client yet.',
    why: 'Avoids recognising revenue prematurely. Under accrual accounting, revenue should only be recognised when the obligation is finalised or the service/product is delivered and billed.',
  },
  {
    id: 'sent',
    when: 'Set automatically when you use Send, or choose Mark as sent if you delivered it another way (WhatsApp, printed copy).',
    why: 'Converts potential work into a legal claim for payment (Accounts Receivable). It allows you to track ageing invoices and manage collections.',
  },
  {
    id: 'overdue',
    when: 'Automatic: a sent invoice with a balance becomes Overdue the day after its due date. You never set it by hand.',
    why: 'Surfaces ageing receivables that pose collection risk so they can be escalated (dunning, reminders, or renegotiation).',
  },
  {
    id: 'partially-paid',
    when: 'Automatic: log a payment smaller than the balance. Each payment is listed on the invoice and the receipt.',
    why: 'Keeps the receivable open and auditable without misrepresenting the amount collected. Prevents premature revenue recognition on the outstanding portion.',
  },
  {
    id: 'paid',
    when: 'Automatic: once logged payments cover the total. Remove a payment and the status steps back on its own.',
    why: 'Closes the open receivable cycle, confirming that expected revenue has successfully converted into actual liquid cash.',
  },
  {
    id: 'cancelled',
    when: 'Use Cancel invoice when it was issued by mistake or the deal fell through. You can re-open it later.',
    why: 'Never delete an invoice. Maintaining cancelled records preserves sequential invoice numbering (crucial for tax compliance and audit trails) while ensuring your balance sheet does not report revenue you will never receive.',
  },
];

export function InvoiceGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal guide-modal" role="dialog" aria-label="Invoice status guide">
        <div className="modal-header">
          <div className="modal-title">
            <Link href="/invoices" style={{ color: 'var(--muted-foreground)', textDecoration: 'none' }}>
              Invoices
            </Link>
            <span className="breadcrumb-chev">
              <ChevronRight />
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>How invoices work</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close guide">
            <XIcon />
          </button>
        </div>

        <div className="modal-body guide-body">
          <div>
            <div className="guide-section-title">Statuses, payments and foreign clients</div>
            <div className="guide-intro">
              You only choose Draft, Sent or Cancelled. Paid, Partially paid and Overdue follow from the payments you log
              and the due date, so the status is always right.
            </div>
          </div>

          <div className="guide-callout">
            <div className="guide-callout-icon">i</div>
            <div>
              <strong>Sending:</strong> Send opens your email app with the message and a private client link. The client
              can view the invoice and download a PDF there; you see when they first open it. You can also download the
              PDF yourself and send it any way you like.
            </div>
          </div>

          <div className="guide-warn">
            <strong>Foreign clients →</strong> Keep the invoice in naira and tick <strong>Show USD equivalent</strong>, then
            set the rate (₦ per $1). Every line and total gets a dollar column, labelled as a reference. To bill in
            dollars instead, change the currency; the equivalent then shows naira.
          </div>

          <div className="guide-steps">
            {STEPS.map((step, index) => {
              const pill = STATUS_META[step.id];
              return (
                <div className="guide-step" key={step.id}>
                  <div className="guide-step-head">
                    <span className="guide-step-num">{index + 1}</span>
                    <span className="guide-step-title">{pill.label}</span>
                    <span className={`inv-status ${pill.cls}`} title={step.why}>
                      <span className="inv-status-dot" />
                      {pill.label}
                    </span>
                  </div>
                  <div className="guide-step-body">
                    <p>
                      <span className="guide-label">When to use:</span> {step.when}
                    </p>
                    <p>
                      <span className="guide-label">Justification:</span> {step.why}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <div style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
            Cancel instead of deleting sent invoices: it keeps your numbering continuous for tax records.
          </div>
          <button className="btn btn-primary" onClick={onClose}>
            <span>Got it</span>
          </button>
        </div>
      </div>
    </div>
  );
}
