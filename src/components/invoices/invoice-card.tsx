'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, Copy, Duplicate, Edit, More, Plus, Trash } from '@/components/icons';
import type { InvoiceRow } from '@/lib/types';
import {
  fmtMoney,
  formatDay,
  invoiceEquivalent,
  InvoiceStatus,
  invoiceStatusPill,
  invoiceTotals,
  MANUAL_STATUSES,
  parsePayments,
} from '@/lib/invoices';
import { usePopoverDismiss } from '@/lib/popover';
import { useMe, useTeam } from '@/lib/team';

type MenuPos = { top: number; left: number } | null;

export function InvoiceCard({
  invoice,
  onStatusChange,
  onDelete,
  onDuplicate,
  onLogPayment,
  tagColor,
  dateFormat,
}: {
  invoice: InvoiceRow;
  tagColor?: string;
  dateFormat?: string;
  onStatusChange: (id: string, status: InvoiceStatus) => void;
  onDelete: (id: string) => void;
  onDuplicate: (invoice: InvoiceRow) => void;
  onLogPayment: (invoice: InvoiceRow) => void;
}) {
  const router = useRouter();
  const { nameOf, initialsOf } = useTeam();
  const admin = useMe().me?.role === 'admin';
  const byline = invoice.created_by
    ? `Created by ${nameOf(invoice.created_by)}${invoice.updated_by && invoice.updated_by !== invoice.created_by ? ` · last edited by ${nameOf(invoice.updated_by)}` : ''}`
    : 'Created before sign-in was set up';
  const [copied, setCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const status = invoice.status as InvoiceStatus;
  const pill = invoiceStatusPill(status);
  const totals = invoiceTotals(invoice);
  const equivalent = invoiceEquivalent({
    currency: invoice.currency,
    grand: totals.grand,
    balance: totals.balance,
    exchangeRate: invoice.exchange_rate,
    equivalentAmount: invoice.equivalent_amount,
  });
  const canLogPayment = status !== 'draft' && status !== 'cancelled' && status !== 'paid';

  const closeMenu = useCallback(() => {
    setMenuPos(null);
    setStatusOpen(false);
  }, []);

  usePopoverDismiss(menuPos !== null, closeMenu);

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuPos) return closeMenu();
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 170 });
  };

  const copyNumber = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    navigator.clipboard.writeText(invoice.number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const paymentCount = parsePayments(invoice.payments).length;

  return (
    <div
      className={`link-card inv-card${menuPos ? ' is-open' : ''}`}
      onClick={() => router.push(`/invoices/edit?id=${encodeURIComponent(invoice.id)}`)}
      style={menuPos ? { background: 'var(--muted-2)', boxShadow: 'var(--shadow-sm)', borderColor: 'var(--border-strong)' } : undefined}
    >
      <div className="favicon inv-favicon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="13" y2="17" />
        </svg>
      </div>

      <div className="link-info">
        <div className="link-alias-row">
          <span className="link-alias">{invoice.number}</span>
          <button
            className="link-alias-copy no-nav"
            onClick={copyNumber}
            title={copied ? 'Copied!' : 'Copy invoice number'}
            style={{ border: 'none', background: 'transparent', display: 'inline-flex' }}
          >
            {copied ? <Check style={{ color: 'var(--accent-green-fg)' }} /> : <Copy />}
          </button>
        </div>

        <div className="link-dest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="7" r="4" />
            <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
          </svg>
          <span className="link-dest-url">{invoice.client_name}</span>
          <span className="link-dest-meta">
            <span className="creator-avatar" title={byline}>{invoice.created_by ? initialsOf(invoice.created_by) : invoice.avatar}</span>
            <span className="link-date">Issued {formatDay(invoice.issued_at, dateFormat)}</span>
            <span className="inv-due-sep">·</span>
            <span className="link-date">Due {formatDay(invoice.due_at, dateFormat)}</span>
            {paymentCount > 0 && (
              <>
                <span className="inv-due-sep">·</span>
                <span className="link-date">
                  {paymentCount} payment{paymentCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="link-meta-right">
        {invoice.tag && <span className={`tag ${tagColor ?? ''}`}>{invoice.tag}</span>}
        <span className={`inv-status ${pill.cls}`}>
          <span className="inv-status-dot" />
          {pill.label}
        </span>
        <div
          className="inv-amount"
          title={[
            totals.paid > 0 ? (totals.balance > 0 ? `${fmtMoney(totals.balance, invoice.currency)} still due` : 'Fully settled') : '',
            equivalent ? `≈ ${fmtMoney(equivalent.total, equivalent.code)} at ${equivalent.rateLine}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || undefined}
        >
          {fmtMoney(totals.grand, invoice.currency)}
          {(equivalent || (totals.paid > 0 && totals.balance > 0)) && (
            <div className="inv-amount-sub">
              {totals.paid > 0 && totals.balance > 0
                ? `${fmtMoney(totals.balance, invoice.currency)} due`
                : `≈ ${fmtMoney(equivalent!.total, equivalent!.code)}`}
            </div>
          )}
        </div>
      </div>

      <button
        ref={menuBtnRef}
        className="icon-btn no-nav"
        data-row-menu
        onClick={toggleMenu}
        aria-label="More"
        style={menuPos ? { background: 'var(--muted)', color: 'var(--foreground)' } : undefined}
      >
        <More />
      </button>

      {menuPos && (
        <div
          className="dropdown"
          data-row-menu
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dropdown-item" onClick={() => { closeMenu(); router.push(`/invoices/edit?id=${encodeURIComponent(invoice.id)}`); }}>
            <Edit />
            <span>Edit</span>
          </div>
          <div className="dropdown-item" onClick={() => { closeMenu(); onDuplicate(invoice); }}>
            <Duplicate />
            <span>Duplicate</span>
          </div>
          <div className="dropdown-item" onClick={() => { copyNumber(); closeMenu(); }}>
            <Copy />
            <span>Copy number</span>
          </div>
          {canLogPayment && (
            <div className="dropdown-item" onClick={() => { closeMenu(); onLogPayment(invoice); }}>
              <Plus />
              <span>Log payment</span>
            </div>
          )}

          <div className="dropdown-sep" />

          <div className="dropdown-item has-sub is-open" onClick={(e) => { e.stopPropagation(); setStatusOpen(!statusOpen); }}>
            <Archive />
            <span>Change status</span>
            <span className="kbd-hint">▾</span>
          </div>
          {statusOpen && (
            <div className="dropdown status-sub" data-popover>
              {MANUAL_STATUSES.map((id) => {
                const meta = invoiceStatusPill(id);
                const current = id === status || (id === 'sent' && status === 'overdue');
                return (
                  <div
                    key={id}
                    className={`dropdown-item${current ? ' is-current' : ''}`}
                    onClick={() => { closeMenu(); if (!current) onStatusChange(invoice.id, id); }}
                  >
                    <span className={`inv-status ${meta.cls}`}>
                      <span className="inv-status-dot" />
                      {meta.label}
                    </span>
                    {current && <span className="kbd-hint">Current</span>}
                  </div>
                );
              })}
              <div className="dropdown-sep" />
              <div style={{ padding: '6px 8px', fontSize: '11px', color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
                Overdue follows the due date. Use <strong>Log payment</strong> for Paid / Partially paid.
              </div>
            </div>
          )}

          {admin && (
            <>
          <div className="dropdown-sep" />
          <div className="dropdown-item destructive" onClick={() => { closeMenu(); onDelete(invoice.id); }}>
            <Trash />
            <span>Delete</span>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
