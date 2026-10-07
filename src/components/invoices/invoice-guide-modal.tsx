'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, XIcon } from '@/components/icons';
import { InvoiceStatus, invoiceStatusPill } from '@/lib/invoices';
import { Portal } from '@/components/portal';

const STEPS: { id: InvoiceStatus; when: string; why: string }[] = [
  {
    id: 'draft',
    when: 'While drafting, waiting for internal approval, or when work is still being tracked before issuing.',
    why: 'Avoids recognising revenue prematurely. Under accrual accounting, revenue should only be recognised when the obligation is finalised or the service/product is delivered and billed.',
  },
  {
    id: 'sent',
    when: 'The moment an invoice is finalised and sent to the customer with an established due date (e.g. Net 30).',
    why: 'Converts potential work into a legal claim for payment (Accounts Receivable). It allows you to track ageing invoices and manage collections.',
  },
  {
    id: 'overdue',
    when: 'Applied automatically once the due date has passed without full payment. Prioritise collection activity for these.',
    why: 'Surfaces ageing receivables that pose collection risk so they can be escalated (dunning, reminders, or renegotiation).',
  },
  {
    id: 'partially-paid',
    when: "When the customer has settled part of the total due but a balance remains. Log each received amount against the invoice's open balance.",
    why: 'Keeps the receivable open and auditable without misrepresenting the amount collected. Prevents premature revenue recognition on the outstanding portion.',
  },
  {
    id: 'paid',
    when: 'Mark as paid immediately upon bank confirmation, payment gateway settlement, or cheque clearance. Only after the full amount is cleared.',
    why: 'Closes the open receivable cycle, confirming that expected revenue has successfully converted into actual liquid cash.',
  },
  {
    id: 'cancelled',
    when: 'When an invoice was issued by mistake, billing terms changed fundamentally, or the agreement was cancelled.',
    why: 'Never delete an invoice. Maintaining cancelled records preserves sequential invoice numbering (crucial for tax compliance and audit trails) while ensuring your balance sheet does not report revenue you will never receive.',
  },
];

export function InvoiceGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Portal><div
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
            <span>How to Guide — Invoice statuses</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close guide">
            <XIcon />
          </button>
        </div>

        <div className="modal-body guide-body">
          <div>
            <div className="guide-section-title">Detailed Breakdown &amp; Guidelines</div>
            <div className="guide-intro">
              When to use what invoice tags for appropriate accounting and reconciliation.
            </div>
          </div>

          <div className="guide-callout">
            <div className="guide-callout-icon">i</div>
            <div>
              Every invoice starts as a <em>Draft</em>. When you send it, it becomes <em>Sent</em>. If the due date
              passes without settlement, it flips to <em>Overdue</em>. On receiving payment, use <em>Log Payment</em> to
              record it — the invoice moves to <em>Paid</em> or <em>Partially paid</em>. If a contract is terminated
              before fulfilment or an error is made, transition directly to <em>Cancelled</em>.{' '}
              <strong>Never delete the record.</strong>
            </div>
          </div>

          <div className="guide-warn">
            <strong>Partial payments →</strong> Log each amount you receive with <strong>Log Payment</strong>. The
            invoice switches to <strong>Partially paid</strong> on its own and to <strong>Paid</strong> only once the
            full amount is settled. <strong>Overdue</strong> is also automatic: it applies the day after the due date.
          </div>

          <div className="guide-steps">
            {STEPS.map((step, index) => {
              const pill = invoiceStatusPill(step.id);
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
            Tip: hover a status pill in the list to see this description as a tooltip.
          </div>
          <button className="btn btn-primary" onClick={onClose}>
            <span>Got it</span>
          </button>
        </div>
      </div>
    </div></Portal>
  );
}
