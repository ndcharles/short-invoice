'use client';

import React, { useState } from 'react';
import { Shell } from '@/components/layout/shell';
import {
  Code,
  SaveBar,
  SettingsCard,
  SettingsLayout,
  SettingsRow,
  SettingSelect,
  SettingToggle,
} from '@/components/settings/settings-ui';
import { Edit, Plus, Trash, Upload } from '@/components/icons';
import { useSettingsForm } from '@/lib/settings-form';
import { useCollections } from '@/lib/collections';
import { newId, parseList, serializeList, toggleListValue } from '@/lib/settings-json';

interface Account {
  id: string;
  title: string;
  symbol: string;
  currency: string;
  bank: string;
  accountName: string;
  accountNumber: string;
  extraLabel: string;
  extraValue: string;
}

const EXTRA_LABELS = ['Sort code / Branch', 'Routing / SWIFT', 'IBAN / BIC', 'BSB / Branch'];

interface Method {
  id: string;
  name: string;
  uses: number;
  enabled: boolean;
}

const TAGLINE_COLORS = [
  { value: '#1d4ed8', title: 'Blue' },
  { value: '#0f172a', title: 'Slate' },
  { value: '#166534', title: 'Green' },
  { value: '#9a3412', title: 'Orange' },
  { value: '#7c2d12', title: 'Brown' },
];

export default function InvoiceSettingsPage() {
  const { draft, set, dirty, saving, error, savedAt, save, discard } = useSettingsForm();
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [editingMethod, setEditingMethod] = useState<string | null>(null);
  const [addingCurrency, setAddingCurrency] = useState(false);
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const [newCurrency, setNewCurrency] = useState('');

  const accounts = parseList<Account>(draft?.inv_accounts, []);
  const methods = parseList<Method>(draft?.inv_methods, []);
  const enabledCurrencies = parseList<string>(draft?.inv_enabled_currencies, []);
  const currencyOptions = Array.from(
    new Set([
      ...parseList<string>(draft?.inv_currency_options, []),
      ...enabledCurrencies,
      draft?.inv_default_currency ?? 'NGN (₦)',
    ])
  );

  const setAccounts = (list: Account[]) => set('inv_accounts', serializeList(list));
  const setMethods = (list: Method[]) => set('inv_methods', serializeList(list));
  const updateAccount = (id: string, patch: Partial<Account>) =>
    setAccounts(accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const taxRate = draft?.inv_tax_rate ?? '7.5';
  const padding = Number(draft?.inv_number_padding ?? 6);
  const nextNumber = draft?.inv_next_number ?? '435431';
  const numberPreview = `${draft?.inv_number_prefix ?? 'INV-'}${nextNumber.padStart(
    Number.isFinite(padding) ? padding : 6,
    '0'
  )}`;

  return (
    <Shell>
      <SettingsLayout
        title="Invoice"
        subtitle="Company profile, currencies, payment accounts, and every invoice default."
      >
        {!draft ? (
          <div className="settings-card">
            <div className="settings-card-body" style={{ color: 'var(--muted-foreground)' }}>
              Loading settings…
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="settings-card">
                <div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error}</div>
              </div>
            )}

            <SettingsCard title="Company profile" subtitle='Shown as the "Pay To" party on every invoice you issue.'>
              <SettingsRow label="Legal name">
                <input
                  className="input"
                  value={draft.inv_legal_name ?? ''}
                  onChange={(e) => set('inv_legal_name', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Tax ID (TIN)">
                <input
                  className="input"
                  value={draft.inv_tax_id ?? ''}
                  onChange={(e) => set('inv_tax_id', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Registered address">
                <input
                  className="input"
                  value={draft.inv_address_1 ?? ''}
                  onChange={(e) => set('inv_address_1', e.target.value)}
                />
                <input
                  className="input"
                  value={draft.inv_address_2 ?? ''}
                  onChange={(e) => set('inv_address_2', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Contact email" help="Replies to invoice emails go here.">
                <input
                  className="input"
                  type="email"
                  value={draft.inv_contact_email ?? ''}
                  onChange={(e) => set('inv_contact_email', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Company logo" help="Shown top-left of every invoice and receipt. 512×512 PNG or SVG.">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    className="inv-logo-slot"
                    style={{ width: '120px', height: '44px', overflow: 'hidden' }}
                    title="Company logo"
                  >
                    {draft.inv_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.inv_logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      'Upload logo'
                    )}
                  </div>
                  <button className="btn btn-outline btn-sm" disabled title="Uploads are not available in this build">
                    <Upload />
                    <span>Upload</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--muted-foreground)' }}
                    onClick={() => set('inv_logo', '')}
                  >
                    Remove
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Currencies"
              subtitle="Currencies available in the invoice canvas and the Log Payment popup."
            >
              <SettingsRow label="Default currency" help="Used for new invoices unless overridden.">
                <SettingSelect
                  value={draft.inv_default_currency ?? 'NGN (₦)'}
                  onChange={(v) => set('inv_default_currency', v)}
                  options={currencyOptions}
                />
              </SettingsRow>

              <SettingsRow
                label="Enabled currencies"
                help="Turn on any currency you want to invoice in. Custom currencies can be added at the end."
              >
                <div className="setting-toggle-list">
                  {currencyOptions.map((currency) => (
                    <button
                      key={currency}
                      className={`setting-chip${enabledCurrencies.includes(currency) ? ' on' : ''}`}
                      onClick={() =>
                        set('inv_enabled_currencies', toggleListValue(draft.inv_enabled_currencies ?? '[]', currency))
                      }
                    >
                      <span>{currency}</span>
                      <span className="x">{enabledCurrencies.includes(currency) ? '×' : '+'}</span>
                    </button>
                  ))}
                  {addingCurrency ? (
                    <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        className="input"
                        autoFocus
                        style={{ width: '140px' }}
                        placeholder="e.g. CAD (C$)"
                        value={newCurrency}
                        onChange={(e) => setNewCurrency(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setAddingCurrency(false);
                            setNewCurrency('');
                          }
                          if (e.key === 'Enter' && newCurrency.trim()) {
                            set(
                              'inv_currency_options',
                              serializeList([...currencyOptions, newCurrency.trim()])
                            );
                            set('inv_enabled_currencies', toggleListValue(draft.inv_enabled_currencies ?? '[]', newCurrency.trim()));
                            setNewCurrency('');
                            setAddingCurrency(false);
                          }
                        }}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          if (!newCurrency.trim()) return;
                          set('inv_currency_options', serializeList([...currencyOptions, newCurrency.trim()]));
                          set('inv_enabled_currencies', toggleListValue(draft.inv_enabled_currencies ?? '[]', newCurrency.trim()));
                          setNewCurrency('');
                          setAddingCurrency(false);
                        }}
                      >
                        Add
                      </button>
                    </span>
                  ) : (
                    <button className="setting-chip" onClick={() => setAddingCurrency(true)}>
                      <Plus />
                      <span>Add currency</span>
                    </button>
                  )}
                </div>
              </SettingsRow>

              <SettingsRow
                label="Tax rate"
                help="Applied to the subtotal on every new invoice. Individual line items can still override."
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '200px' }}>
                  <input
                    className="input"
                    style={{ textAlign: 'right' }}
                    value={taxRate}
                    onChange={(e) => set('inv_tax_rate', e.target.value)}
                  />
                  <span style={{ color: 'var(--muted-foreground)', fontSize: '13px' }}>%</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '4px' }}>
                  Label shown on invoice: <strong style={{ color: 'var(--foreground)' }}>Tax ({taxRate}%)</strong>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Payment accounts"
              subtitle='Bank accounts shown in the "Payment Information" section of every invoice. Pick a currency per account.'
            >
              <div className="setting-list">
                {accounts.map((account) => (
                  <div className="setting-list-row account-row" key={account.id} style={{ alignItems: 'start' }}>
                    <div className="inv-account-flag" style={{ background: 'var(--foreground)' }}>
                      {account.symbol}
                    </div>

                    {editingAccount === account.id ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <div className="setting-field">
                            <label>Title</label>
                            <input
                              className="input"
                              value={account.title}
                              placeholder="Naira account"
                              onChange={(e) => updateAccount(account.id, { title: e.target.value })}
                            />
                          </div>
                          <div className="setting-field">
                            <label>Bank</label>
                            <input
                              className="input"
                              value={account.bank}
                              placeholder="Guaranty Trust Bank"
                              onChange={(e) => updateAccount(account.id, { bank: e.target.value })}
                            />
                          </div>
                          <div className="setting-field">
                            <label>Account name</label>
                            <input
                              className="input"
                              value={account.accountName}
                              onChange={(e) => updateAccount(account.id, { accountName: e.target.value })}
                            />
                          </div>
                          <div className="setting-field">
                            <label>Account number</label>
                            <input
                              className="input"
                              value={account.accountNumber}
                              onChange={(e) => updateAccount(account.id, { accountNumber: e.target.value })}
                            />
                          </div>
                          <div className="setting-field">
                            <label>Fourth field</label>
                            <SettingSelect
                              value={account.extraLabel}
                              onChange={(v) => updateAccount(account.id, { extraLabel: v })}
                              options={EXTRA_LABELS}
                            />
                          </div>
                          <div className="setting-field">
                            <label>{account.extraLabel}</label>
                            <input
                              className="input"
                              value={account.extraValue}
                              onChange={(e) => updateAccount(account.id, { extraValue: e.target.value })}
                            />
                          </div>
                          <div className="setting-field">
                            <label>Currency</label>
                            <SettingSelect
                              value={account.currency}
                              onChange={(v) => updateAccount(account.id, { currency: v })}
                              options={['NGN', 'USD', 'EUR', 'GBP', 'CAD', 'ZAR', 'KES']}
                            />
                          </div>
                          <div className="setting-field">
                            <label>Symbol</label>
                            <input
                              className="input"
                              style={{ maxWidth: '90px' }}
                              maxLength={3}
                              value={account.symbol}
                              onChange={(e) => updateAccount(account.id, { symbol: e.target.value })}
                            />
                          </div>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={() => setEditingAccount(null)}>
                          Done
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="primary">{account.title}</div>
                        <div className="secondary">
                          {account.bank} · {account.accountName} · {account.accountNumber} · {account.extraLabel}: {account.extraValue}
                        </div>
                      </div>
                    )}

                    <div className="setting-select" style={{ minWidth: '110px', maxWidth: '110px' }}>
                      <select
                        value={account.currency}
                        onChange={(e) => updateAccount(account.id, { currency: e.target.value })}
                        disabled={editingAccount === account.id}
                      >
                        {['NGN', 'USD', 'EUR', 'GBP', 'CAD', 'ZAR', 'KES'].map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                      <span className="chev">▾</span>
                    </div>

                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        title="Edit account"
                        onClick={() => setEditingAccount(editingAccount === account.id ? null : account.id)}
                      >
                        <Edit />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete account"
                        style={{ color: 'var(--destructive)' }}
                        onClick={() => setAccounts(accounts.filter((a) => a.id !== account.id))}
                      >
                        <Trash />
                      </button>
                    </div>
                  </div>
                ))}

                <div
                  className="setting-list-row dashed"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setAccounts([
                      ...accounts,
                      {
                        id: newId('acc'),
                        title: 'New account',
                        symbol: '₦',
                        currency: 'NGN',
                        bank: '',
                        accountName: '',
                        accountNumber: '',
                        extraLabel: 'Sort code / Branch',
                        extraValue: '',
                      },
                    ])
                  }
                >
                  <Plus />
                  <span style={{ marginLeft: '6px' }}>Add payment account</span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Payment methods"
              subtitle="Which methods appear in the Log Payment dropdown. Toggle on to enable."
            >
              <div className="setting-list">
                {methods.map((method) => (
                  <div className="setting-list-row method-row" key={method.id}>
                    <span
                      className="favicon"
                      style={{ width: '24px', height: '24px', background: 'var(--muted-2)', border: '1px solid var(--border)' }}
                    />
                    {editingMethod === method.id ? (
                      <input
                        className="input"
                        value={method.name}
                        autoFocus
                        onChange={(e) =>
                          setMethods(methods.map((m) => (m.id === method.id ? { ...m, name: e.target.value } : m)))
                        }
                        onBlur={() => setEditingMethod(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setEditingMethod(null);
                        }}
                      />
                    ) : (
                      <div
                        className="primary"
                        style={{ cursor: 'text' }}
                        title="Click to rename"
                        onClick={() => setEditingMethod(method.id)}
                      >
                        {method.name}
                      </div>
                    )}
                    <span className="secondary">{method.uses} uses</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <button
                        className="icon-btn"
                        title="Delete method"
                        style={{ color: 'var(--destructive)' }}
                        onClick={() => setMethods(methods.filter((m) => m.id !== method.id))}
                      >
                        <Trash />
                      </button>
                      <SettingToggle
                        on={method.enabled}
                        onToggle={() =>
                          setMethods(
                            methods.map((m) => (m.id === method.id ? { ...m, enabled: !m.enabled } : m))
                          )
                        }
                      />
                    </div>
                  </div>
                ))}

                <div
                  className="setting-list-row dashed"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setMethods([...methods, { id: newId('mth'), name: 'New method', uses: 0, enabled: true }])
                  }
                >
                  <Plus />
                  <span style={{ marginLeft: '6px' }}>Add custom method</span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard title="Organisation" subtitle="Where new invoices land and how they are labelled.">
              <SettingsRow label="Default folder" help="Choose None to use the module default.">
                <SettingSelect
                  value={draft.inv_default_folder ?? 'None'}
                  onChange={(v) => set('inv_default_folder', v)}
                  options={['None', ...(folders.length ? folders.map((f) => f.name) : ['Invoices'])]}
                />
              </SettingsRow>
              <SettingsRow label="Default tag" help="Applied to every new invoice. Choose None for no tag.">
                <SettingSelect
                  value={draft.inv_default_tag ?? 'None'}
                  onChange={(v) => set('inv_default_tag', v)}
                  options={['None', ...(tags.length ? tags.map((t) => t.name) : [])]}
                />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Payment terms & numbering" subtitle="Defaults for every new invoice.">
              <SettingsRow label="Default payment terms" help="Sets the due date on new invoices (Net = days after issue).">
                <SettingSelect
                  value={draft.inv_payment_terms ?? 'Net 30'}
                  onChange={(v) => set('inv_payment_terms', v)}
                  options={['Net 14', 'Net 30', 'Net 45', 'Net 60', 'Due on receipt', 'Custom']}
                />
              </SettingsRow>
              <SettingsRow
                label="Terms note"
                help="Free-text block appended to the Payment Terms section on the invoice."
              >
                <textarea
                  className="input"
                  style={{ minHeight: '70px' }}
                  value={draft.inv_terms_note ?? ''}
                  onChange={(e) => set('inv_terms_note', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow
                label="Invoice number format"
                help={
                  <>
                    Preview: <Code>{numberPreview}</Code>. Prefix + sequential number, zero-padded.
                  </>
                }
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr', gap: '8px', maxWidth: '420px' }}>
                  <div className="setting-field">
                    <label>Prefix</label>
                    <input
                      className="input"
                      value={draft.inv_number_prefix ?? 'INV-'}
                      onChange={(e) => set('inv_number_prefix', e.target.value)}
                    />
                  </div>
                  <div className="setting-field">
                    <label>Padding</label>
                    <input
                      className="input"
                      style={{ textAlign: 'right' }}
                      value={draft.inv_number_padding ?? '6'}
                      onChange={(e) => set('inv_number_padding', e.target.value.replace(/[^0-9]/g, ''))}
                    />
                  </div>
                  <div className="setting-field">
                    <label>Next number</label>
                    <input
                      className="input"
                      style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                      value={draft.inv_next_number ?? ''}
                      onChange={(e) => set('inv_next_number', e.target.value.replace(/[^0-9]/g, ''))}
                    />
                  </div>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Invoice tagline strip"
              subtitle="A branded strip that appears at the bottom of every invoice and receipt."
            >
              <SettingsRow label="Show tagline strip">
                <SettingToggle
                  on={draft.inv_tagline_on === 'true'}
                  onToggle={() => set('inv_tagline_on', draft.inv_tagline_on === 'true' ? 'false' : 'true')}
                  label={draft.inv_tagline_on === 'true' ? 'On' : 'Off'}
                />
              </SettingsRow>
              <SettingsRow label="Tagline text">
                <input
                  className="input"
                  value={draft.inv_tagline_text ?? ''}
                  onChange={(e) => set('inv_tagline_text', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Background colour">
                <div className="setting-toggle-list">
                  {TAGLINE_COLORS.map((color) => (
                    <button
                      key={color.value}
                      className={`color-swatch${draft.inv_tagline_color === color.value ? ' active' : ''}`}
                      style={{
                        background: color.value,
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        borderWidth: '2px',
                      }}
                      title={color.title}
                      onClick={() => set('inv_tagline_color', color.value)}
                    />
                  ))}
                </div>
              </SettingsRow>
              <SettingsRow label="Preview">
                {draft.inv_tagline_on === 'true' ? (
                  <div className="tagline-preview" style={{ background: draft.inv_tagline_color ?? '#1d4ed8' }}>
                    {draft.inv_tagline_text || 'May the 4th be with you!'}
                  </div>
                ) : (
                  <div className="row-help">Tagline strip is hidden.</div>
                )}
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Email templates"
              subtitle="Default subject and message body when sending invoices and receipts from the Send modal."
            >
              <SettingsRow label="Invoice email subject">
                <input
                  className="input"
                  value={draft.inv_email_invoice_subject ?? ''}
                  onChange={(e) => set('inv_email_invoice_subject', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow
                label="Invoice email body"
                help={
                  <>
                    Use <Code>{'{client}'}</Code>, <Code>{'{number}'}</Code>, <Code>{'{amount}'}</Code>,{' '}
                    <Code>{'{due}'}</Code>.
                  </>
                }
              >
                <textarea
                  className="input"
                  style={{ minHeight: '100px' }}
                  value={draft.inv_email_invoice_body ?? ''}
                  onChange={(e) => set('inv_email_invoice_body', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Receipt email subject">
                <input
                  className="input"
                  value={draft.inv_email_receipt_subject ?? ''}
                  onChange={(e) => set('inv_email_receipt_subject', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Receipt email body">
                <textarea
                  className="input"
                  style={{ minHeight: '100px' }}
                  value={draft.inv_email_receipt_body ?? ''}
                  onChange={(e) => set('inv_email_receipt_body', e.target.value)}
                />
              </SettingsRow>
            </SettingsCard>
          </>
        )}
      </SettingsLayout>

      <SaveBar
        visible={dirty}
        saving={saving}
        message={savedAt && !dirty ? 'Saved!' : 'You have unsaved changes'}
        onDiscard={discard}
        onSave={save}
      />
    </Shell>
  );
}
