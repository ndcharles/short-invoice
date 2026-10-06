'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Copy, Duplicate, Edit, More, Plus, Refresh, Send, Trash } from '@/components/icons';
import type { InvoiceView } from '@/lib/types';
import { daysUntil, fmtMoney, STATUS_META } from '@/lib/invoices';
import { formatDate } from '@/lib/dates';
import { usePopoverDismiss } from '@/lib/popover';

export type InvoiceAction = 'pay' | 'link' | 'duplicate' | 'sent' | 'cancel' | 'reopen' | 'delete';

type MenuPos = { top: number; left: number } | null;

function dueHint(invoice: InvoiceView, dateFormat?: string): { text: string; overdue: boolean } {
  const status = invoice.display_status;
  if (status === 'paid') return { text: 'Paid', overdue: false };
  if (status === 'cancelled') return { text: 'Cancelled', overdue: false };
  if (status === 'draft') return { text: `Due ${formatDate(invoice.due_at, dateFormat)}`, overdue: false };
  const days = daysUntil(invoice.due_at);
  if (days < 0) return { text: `Overdue ${-days}d`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: false };
  return { text: `Due in ${days}d`, overdue: false };
}

export function InvoiceCard({
  invoice,
  dateFormat,
  tagColor,
  onAction,
}: {
  invoice: InvoiceView;
  dateFormat?: string;
  tagColor?: string;
  onAction: (action: InvoiceAction, invoice: InvoiceView) => void;
}) {
  const router = useRouter();
  const [menuPos, setMenuPos] = useState<MenuPos>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const status = invoice.display_status;
  const meta = STATUS_META[status];
  const due = dueHint(invoice, dateFormat);
  const open = () => router.push(`/invoices/edit?id=${encodeURIComponent(invoice.id)}`);

  const closeMenu = useCallback(() => setMenuPos(null), []);
  usePopoverDismiss(menuPos !== null, closeMenu);

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuPos) return closeMenu();
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 200) });
  };

  const run = (action: InvoiceAction) => {
    closeMenu();
    onAction(action, invoice);
  };

  const balance = invoice.totals.balance;
  const partlyPaid = invoice.totals.paid > 0 && balance > 0;

  return (
    <div
      className={`link-card inv-card${menuPos ? ' is-open' : ''}`}
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open()}
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
          <span className="link-alias">{invoice.client_name}</span>
          {invoice.tag && <span className={`tag ${tagColor ?? ''}`} style={{ marginLeft: 6 }}>{invoice.tag}</span>}
        </div>
        <div className="link-dest">
          <span className="link-dest-url">
            {invoice.number}
            {invoice.reference ? ` · ${invoice.reference}` : ''}
          </span>
          <span className="link-dest-meta">
            <span className="creator-avatar" title={invoice.avatar}>{invoice.avatar}</span>
            <span className="link-date">Issued {formatDate(invoice.issued_at, dateFormat)}</span>
            <span className="inv-due-sep">·</span>
            <span className={`link-date inv-due-hint${due.overdue ? ' is-overdue' : ''}`}>{due.text}</span>
            {invoice.viewed_at && status !== 'paid' && (
              <>
                <span className="inv-due-sep">·</span>
                <span className="link-date" title={`Opened ${formatDate(invoice.viewed_at, dateFormat)}`}>Viewed</span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="link-meta-right">
        <span className={`inv-status ${meta.cls}`}>
          <span className="inv-status-dot" />
          {meta.label}
        </span>
        <div>
          <div className="inv-amount">{fmtMoney(invoice.totals.total, invoice.currency)}</div>
          {(partlyPaid || invoice.equivalent) && (
            <div className="inv-amount-sub">
              {partlyPaid ? `${fmtMoney(balance, invoice.currency)} due` : ''}
              {partlyPaid && invoice.equivalent ? ' · ' : ''}
              {invoice.equivalent ? `≈ ${fmtMoney(invoice.equivalent.total, invoice.equivalent.currency)}` : ''}
            </div>
          )}
        </div>
      </div>

      <button ref={menuBtnRef} className="icon-btn no-nav" data-row-menu onClick={toggleMenu} aria-label="Invoice actions">
        <More />
      </button>

      {menuPos && (
        <div className="dropdown" data-row-menu style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-item" onClick={() => { closeMenu(); open(); }}>
            <Edit />
            <span>Open</span>
          </div>
          {status !== 'cancelled' && balance > 0 && (
            <div className="dropdown-item" onClick={() => run('pay')}>
              <Plus />
              <span>Log payment</span>
            </div>
          )}
          {invoice.status === 'draft' && (
            <div className="dropdown-item" onClick={() => run('sent')}>
              <Send />
              <span>Mark as sent</span>
            </div>
          )}
          <div className="dropdown-item" onClick={() => run('link')}>
            <Copy />
            <span>Copy client link</span>
          </div>
          <div className="dropdown-item" onClick={() => run('duplicate')}>
            <Duplicate />
            <span>Duplicate</span>
          </div>
          <div className="dropdown-sep" />
          {status === 'cancelled' ? (
            <div className="dropdown-item" onClick={() => run('reopen')}>
              <Refresh />
              <span>Re-open</span>
            </div>
          ) : (
            <div className="dropdown-item" onClick={() => run('cancel')}>
              <Archive />
              <span>Cancel invoice</span>
            </div>
          )}
          <div className="dropdown-item destructive" onClick={() => run('delete')}>
            <Trash />
            <span>Delete</span>
          </div>
        </div>
      )}
    </div>
  );
}
