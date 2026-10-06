/**
 * The invoice / receipt document as a self-contained HTML page (inline CSS,
 * no external assets). The Worker serves it at the public client link
 * (/s/i/<token>), and the app opens the same page to print or save a PDF, so
 * what the client sees and what gets downloaded are always identical.
 *
 * Every dynamic value goes through esc(); images and colours are validated.
 */

import type { InvoiceView } from './types';
import { CURRENCY_SYMBOLS, fmtMoney, lineAmount, moneyInWords, parseItems, parsePayments, rateLabel, toEquivalent } from './invoices';
import { formatDate } from './dates';
import { parseHexColor, parseImageSource } from './validate';

export interface DocumentAccount {
  title: string;
  currency: string;
  bank: string;
  accountName: string;
  accountNumber: string;
  extraLabel: string;
  extraValue: string;
}

export interface DocumentProfile {
  name: string;
  address1: string;
  address2: string;
  email: string;
  taxId: string;
  logo: string;
  accounts: DocumentAccount[];
  tagline: { on: boolean; text: string; color: string };
  dateFormat: string;
}

export interface DocumentOptions {
  kind: 'invoice' | 'receipt';
  /** Opens the print dialog on load (Download PDF from the app). */
  autoPrint?: boolean;
  now?: number;
}

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const lines = (value: string) => esc(value).replace(/\n/g, '<br>');

/** Accounts in the invoice currency, plus the equivalent currency when one is shown. */
export function accountsFor(accounts: DocumentAccount[], currency: string, equivalentCurrency: string | null): DocumentAccount[] {
  const wanted = new Set([currency, ...(equivalentCurrency ? [equivalentCurrency] : [])]);
  const matching = accounts.filter((a) => wanted.has(a.currency));
  return matching.length ? matching : accounts;
}

function statusLine(invoice: InvoiceView, profile: DocumentProfile, now: number): { label: string; tone: string } {
  const status = invoice.display_status;
  if (status === 'paid') return { label: 'Paid in full', tone: 'paid' };
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'void' };
  if (status === 'draft') return { label: 'Draft', tone: 'muted' };
  if (status === 'overdue') {
    const days = Math.max(1, Math.round((now - invoice.due_at) / 86_400_000));
    return { label: `Overdue by ${days} day${days === 1 ? '' : 's'}`, tone: 'overdue' };
  }
  if (status === 'partially-paid') return { label: `Partially paid · due ${formatDate(invoice.due_at, profile.dateFormat)}`, tone: 'partial' };
  return { label: `Due ${formatDate(invoice.due_at, profile.dateFormat)}`, tone: 'due' };
}

export function renderInvoiceDocument(invoice: InvoiceView, profile: DocumentProfile, options: DocumentOptions): string {
  const now = options.now ?? Date.now();
  const receipt = options.kind === 'receipt';
  const currency = invoice.currency;
  const items = parseItems(invoice.items);
  const payments = parsePayments(invoice.payments);
  const totals = invoice.totals;
  const eq = invoice.equivalent;
  const money = (amount: number) => esc(fmtMoney(amount, currency));
  const eqMoney = (amount: number) => (eq ? esc(fmtMoney(toEquivalent(amount, currency, eq.rate) ?? 0, eq.currency)) : '');
  const status = statusLine(invoice, profile, now);
  const logo = parseImageSource(profile.logo);
  const taglineColor = parseHexColor(profile.tagline.color);
  const title = receipt ? 'Receipt' : 'Invoice';
  const accounts = accountsFor(profile.accounts, currency, eq?.currency ?? null);
  const fmtDay = (ms: number) => esc(formatDate(ms, profile.dateFormat));
  const lastPayment = payments[payments.length - 1];

  const itemRows = items
    .map((item, index) => {
      const amount = lineAmount(item);
      return `<tr>
        <td class="n">${index + 1}</td>
        <td><div class="item">${esc(item.name || 'Item')}</div>${item.desc ? `<div class="desc">${lines(item.desc)}</div>` : ''}</td>
        <td class="r">${esc(Number(item.qty).toLocaleString('en-US'))}</td>
        <td class="r">${money(item.unitPrice)}</td>
        <td class="r strong">${money(amount)}</td>
        ${eq ? `<td class="r eq">${eqMoney(amount)}</td>` : ''}
      </tr>`;
    })
    .join('');

  const totalRow = (label: string, value: string, cls = '', eqValue = '') =>
    `<tr class="${cls}"><td>${label}</td><td class="r">${value}</td>${eq ? `<td class="r eq">${eqValue}</td>` : ''}</tr>`;

  const discountLabel =
    invoice.discount_type === 'percent' ? `Discount (${esc(Number(invoice.discount).toLocaleString('en-US'))}%)` : 'Discount';
  const taxPercent = Math.round(Number(invoice.tax_rate) * 10000) / 100;

  const totalsRows = [
    totalRow('Subtotal', money(totals.subtotal), '', eqMoney(totals.subtotal)),
    totals.discount > 0 ? totalRow(discountLabel, `−${money(totals.discount)}`, '', `−${eqMoney(totals.discount)}`) : '',
    totals.charges > 0 ? totalRow('Additional charges', money(totals.charges), '', eqMoney(totals.charges)) : '',
    taxPercent > 0 ? totalRow(`VAT (${taxPercent}%)`, money(totals.tax), '', eqMoney(totals.tax)) : '',
    totalRow('Total', money(totals.total), 'grand', eqMoney(totals.total)),
    totals.paid > 0 ? totalRow('Amount paid', `−${money(Math.min(totals.paid, totals.total))}`, 'paid', `−${eqMoney(Math.min(totals.paid, totals.total))}`) : '',
    totals.overpaid > 0 ? totalRow('Credit (overpaid)', money(totals.overpaid), '', eqMoney(totals.overpaid)) : '',
    totals.paid > 0 || !receipt
      ? totalRow(totals.balance > 0 ? 'Balance due' : 'Balance', money(totals.balance), totals.balance > 0 ? 'balance' : 'cleared', eqMoney(totals.balance))
      : '',
  ].join('');

  const paymentRows = payments
    .map(
      (p) => `<tr><td>${fmtDay(Date.parse(`${p.date}T00:00:00Z`))}</td><td>${esc(p.method || '—')}</td><td>${lines(p.note || '')}</td><td class="r strong">${money(p.amount)}</td></tr>`
    )
    .join('');

  const accountCards = accounts
    .map(
      (a) => `<div class="acct">
        <div class="acct-title"><span class="flag">${esc(CURRENCY_SYMBOLS[a.currency] ?? a.currency)}</span>${esc(a.title || `${a.currency} account`)}</div>
        <dl>
          ${a.bank ? `<dt>Bank</dt><dd>${esc(a.bank)}</dd>` : ''}
          ${a.accountName ? `<dt>Account name</dt><dd>${esc(a.accountName)}</dd>` : ''}
          ${a.accountNumber ? `<dt>Account number</dt><dd class="mono">${esc(a.accountNumber)}</dd>` : ''}
          ${a.extraValue ? `<dt>${esc(a.extraLabel || 'Details')}</dt><dd class="mono">${esc(a.extraValue)}</dd>` : ''}
        </dl>
      </div>`
    )
    .join('');

  const watermark =
    invoice.display_status === 'draft' ? 'DRAFT' : invoice.display_status === 'cancelled' ? 'CANCELLED' : receipt && totals.balance <= 0 ? 'PAID' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} ${esc(invoice.number)} · ${esc(profile.name)}</title>
<style>
  :root { --fg:#0a0a0a; --muted:#6b6b6b; --line:#e7e7e7; --soft:#f6f6f6; --accent:${taglineColor.ok ? taglineColor.value : '#1d4ed8'}; }
  * { box-sizing:border-box; }
  html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { margin:0; background:#eef0f2; color:var(--fg); font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif; }
  .bar { position:sticky; top:0; display:flex; gap:8px; justify-content:center; padding:10px; background:rgba(238,240,242,.92); backdrop-filter:blur(6px); z-index:2; }
  .bar button, .bar a { font:inherit; font-weight:500; border:1px solid var(--fg); background:var(--fg); color:#fff; border-radius:6px; padding:7px 14px; cursor:pointer; text-decoration:none; }
  .bar a.alt { background:#fff; color:var(--fg); border-color:var(--line); }
  .page { position:relative; width:min(820px, calc(100vw - 24px)); margin:8px auto 40px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:40px 44px 28px; overflow:hidden; }
  .watermark { position:absolute; top:38%; left:50%; transform:translate(-50%,-50%) rotate(-24deg); font-size:110px; font-weight:800; letter-spacing:.08em; color:rgba(0,0,0,.045); pointer-events:none; white-space:nowrap; }
  header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; }
  .brand img { max-height:56px; max-width:200px; display:block; margin-bottom:10px; }
  .brand .name { font-size:16px; font-weight:700; }
  .brand .addr, .muted { color:var(--muted); }
  .doc { text-align:right; }
  .doc h1 { margin:0; font-size:26px; letter-spacing:.12em; text-transform:uppercase; }
  .doc .num { font-size:13px; color:var(--muted); margin-top:2px; }
  .pill { display:inline-block; margin-top:10px; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; background:var(--soft); color:var(--muted); }
  .pill.paid { background:#dcfce7; color:#166534; } .pill.overdue { background:#fee2e2; color:#991b1b; }
  .pill.partial { background:#fef3c7; color:#92400e; } .pill.due { background:#dbeafe; color:#1e40af; } .pill.void { background:#f3f4f6; color:#6b7280; text-decoration:line-through; }
  .meta { display:grid; grid-template-columns:1.4fr 1fr; gap:24px; margin:30px 0 22px; }
  .label { font-size:10.5px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
  .billto .who { font-size:14px; font-weight:600; }
  .facts { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; align-content:start; }
  .facts dt { color:var(--muted); } .facts dd { margin:0; text-align:right; font-weight:500; }
  table { width:100%; border-collapse:collapse; }
  table.items thead th { background:var(--fg); color:#fff; font-size:10.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; padding:8px 10px; text-align:left; }
  table.items thead th:first-child { border-radius:6px 0 0 6px; } table.items thead th:last-child { border-radius:0 6px 6px 0; }
  table.items td { padding:10px; border-bottom:1px solid var(--line); vertical-align:top; }
  .n { width:28px; color:var(--muted); } .r, th.r { text-align:right !important; white-space:nowrap; } .strong { font-weight:600; }
  .item { font-weight:500; } .desc { color:var(--muted); font-size:12px; margin-top:2px; }
  .eq { color:var(--muted); }
  th.eq { color:#d4d4d4 !important; }
  .summary { display:grid; grid-template-columns:1fr minmax(280px, 1.1fr); gap:28px; margin-top:18px; align-items:start; }
  table.totals td { padding:6px 0; } table.totals td + td { padding-left:14px; }
  table.totals tr.grand td { border-top:1px solid var(--fg); font-weight:700; font-size:15px; padding-top:10px; }
  table.totals tr.paid td { color:#166534; }
  table.totals tr.balance td { font-weight:700; font-size:15px; background:var(--soft); padding:9px 8px; }
  table.totals tr.cleared td { font-weight:600; color:#166534; }
  .rate { font-size:11.5px; color:var(--muted); margin-top:8px; text-align:right; }
  .words { margin-top:10px; font-size:12px; } .words b { font-weight:600; }
  .stamp { display:inline-block; border:3px solid #16a34a; color:#16a34a; border-radius:8px; padding:6px 14px; font-weight:800; letter-spacing:.12em; transform:rotate(-6deg); margin-top:6px; }
  .stamp small { display:block; font-size:10px; letter-spacing:.04em; font-weight:600; text-align:center; }
  section { margin-top:26px; }
  .accts { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:12px; }
  .acct { border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  .acct-title { font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
  .flag { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding:0 4px; border-radius:5px; background:var(--fg); color:#fff; font-size:11px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:3px 12px; margin:0; font-size:12px; }
  .acct dt { color:var(--muted); } .acct dd { margin:0; text-align:right; } .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  table.payments th { text-align:left; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); padding:6px 8px; border-bottom:1px solid var(--line); }
  table.payments td { padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
  .notes { white-space:normal; }
  .tagline { margin:28px -44px -28px; padding:12px; text-align:center; color:#fff; background:var(--accent); font-weight:500; }
  footer.small { margin-top:22px; color:var(--muted); font-size:11px; text-align:center; }
  @media (max-width:640px) {
    .page { padding:24px 18px; } .meta, .summary { grid-template-columns:1fr; }
    header { flex-direction:column; } .doc { text-align:left; } .tagline { margin:24px -18px -24px; }
    table.items .n, table.items th:first-child, table.items .eq { display:none; }
    table.items td, table.items th { padding:8px 6px; }
  }
  @page { size:A4; margin:12mm; }
  @media print {
    body { background:#fff; } .bar { display:none; }
    .page { width:auto; margin:0; border:none; border-radius:0; padding:0; overflow:visible; }
    .tagline { margin:28px 0 0; border-radius:6px; }
    tr, .acct { break-inside:avoid; }
  }
</style>
</head>
<body>
<div class="bar">
  <button type="button" onclick="window.print()">Download PDF</button>
  ${payments.length ? `<a class="alt" href="?doc=${receipt ? 'invoice' : 'receipt'}">${receipt ? 'View invoice' : 'View receipt'}</a>` : ''}
</div>
<main class="page">
  ${watermark ? `<div class="watermark">${watermark}</div>` : ''}
  <header>
    <div class="brand">
      ${logo.ok && logo.value ? `<img src="${esc(logo.value)}" alt="">` : ''}
      <div class="name">${esc(profile.name)}</div>
      <div class="addr">${[profile.address1, profile.address2].filter(Boolean).map(esc).join('<br>')}</div>
      <div class="addr">${[profile.email, profile.taxId ? `TIN: ${profile.taxId}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
    </div>
    <div class="doc">
      <h1>${esc(title)}</h1>
      <div class="num"># ${esc(invoice.number)}</div>
      <span class="pill ${status.tone}">${esc(receipt && totals.balance <= 0 ? 'Paid in full' : status.label)}</span>
    </div>
  </header>

  <div class="meta">
    <div class="billto">
      <div class="label">${receipt ? 'Received from' : 'Bill to'}</div>
      <div class="who">${esc(invoice.client_name)}</div>
      ${invoice.client_contact ? `<div>Attn: ${esc(invoice.client_contact)}</div>` : ''}
      ${invoice.client_address ? `<div class="muted">${lines(invoice.client_address)}</div>` : ''}
      ${invoice.client_email ? `<div class="muted">${esc(invoice.client_email)}</div>` : ''}
    </div>
    <dl class="facts">
      <dt>Invoice date</dt><dd>${fmtDay(invoice.issued_at)}</dd>
      <dt>Due date</dt><dd>${fmtDay(invoice.due_at)}</dd>
      ${invoice.reference ? `<dt>Reference</dt><dd>${esc(invoice.reference)}</dd>` : ''}
      ${receipt && lastPayment ? `<dt>Last payment</dt><dd>${fmtDay(Date.parse(`${lastPayment.date}T00:00:00Z`))}</dd>` : ''}
      <dt>Currency</dt><dd>${esc(currency)}</dd>
    </dl>
  </div>

  <table class="items">
    <thead><tr><th class="n">#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th>${eq ? `<th class="r eq">≈ ${esc(eq.currency)}</th>` : ''}</tr></thead>
    <tbody>${itemRows || `<tr><td></td><td class="muted" colspan="${eq ? 5 : 4}">No line items</td></tr>`}</tbody>
  </table>

  <div class="summary">
    <div>
      <div class="words"><span class="label">Amount in words</span><br><b>${esc(moneyInWords(receipt ? Math.min(totals.paid, totals.total) : totals.total, currency))}</b></div>
      ${receipt && totals.balance <= 0 && totals.paid > 0 ? `<div class="stamp">PAID<small>${lastPayment ? fmtDay(Date.parse(`${lastPayment.date}T00:00:00Z`)) : ''}</small></div>` : ''}
    </div>
    <div>
      <table class="totals">
        ${eq ? `<tr><td></td><td class="r label">${esc(currency)}</td><td class="r label">≈ ${esc(eq.currency)}</td></tr>` : ''}
        ${totalsRows}
      </table>
      ${eq ? `<div class="rate">Exchange rate ${esc(rateLabel(currency, eq.rate))}. The ${esc(eq.currency)} column is for reference; the invoice is payable in ${esc(currency)}.</div>` : ''}
    </div>
  </div>

  ${payments.length ? `<section><div class="label">Payments received</div>
    <table class="payments"><thead><tr><th>Date</th><th>Method</th><th>Note</th><th class="r">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table></section>` : ''}

  ${!receipt && accounts.length && totals.balance > 0 && invoice.display_status !== 'cancelled' ? `<section><div class="label">Payment information</div><div class="accts">${accountCards}</div></section>` : ''}
  ${invoice.notes ? `<section><div class="label">Notes</div><div class="notes">${lines(invoice.notes)}</div></section>` : ''}
  ${invoice.terms && !receipt ? `<section><div class="label">Payment terms</div><div class="notes muted">${lines(invoice.terms)}</div></section>` : ''}

  ${receipt ? `<footer class="small">Thank you for your payment.</footer>` : ''}
  ${profile.tagline.on && profile.tagline.text ? `<div class="tagline">${esc(profile.tagline.text)}</div>` : ''}
</main>
${options.autoPrint ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>' : ''}
</body>
</html>`;
}

