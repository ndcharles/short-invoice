'use client';

import React, { useRef, useState } from 'react';
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
import { newId, parseList, serializeList } from '@/lib/settings-json';
import { readImageFile } from '@/lib/image-file';
import { CURRENCIES, CURRENCY_SYMBOLS, currencyCode, formatInvoiceNumber } from '@/lib/invoices';

interface Account {
  id: string;
  title: string;
  currency: string;
  bank: string;
  accountName: string;
  accountNumber: string;
  extraLabel: string;
  extraValue: string;
}

interface Method {
  id: string;
  name: string;
  enabled: boolean;
}

const EXTRA_LABELS = ['Sort code / Branch', 'SWIFT / BIC', 'Routing number', 'IBAN', 'BSB / Branch'];
const TERMS = ['Due on receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60'];
const TAGLINE_COLORS = [
  { value: '#1d4ed8', title: 'Blue' },
  { value: '#0f172a', title: 'Slate' },
  { value: '#166534', title: 'Green' },
  { value: '#9a3412', title: 'Orange' },
  { value: '#7c2d12', title: 'Brown' },
];
const CURRENCY_LABELS = CURRENCIES.map((c) => `${c.code} (${c.symbol})`);

export default function InvoiceSettingsPage() {
  const { draft, set, dirty, saving, error, savedAt, save, discard } = useSettingsForm();
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const fileRef = useRef<HTMLInputElement>(null);

  const accounts = parseList<Account>(draft?.inv_accounts, []);
  const methods = parseList<Method>(draft?.inv_methods, []);
  const setAccounts = (list: Account[]) => set('inv_accounts', serializeList(list));
  const setMethods = (list: Method[]) => set('inv_methods', serializeList(list.map(({ id, name, enabled }) => ({ id, name, enabled }))));
  const updateAccount = (id: string, patch: Partial<Account>) => setAccounts(accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const defaultCurrency = currencyCode(draft?.inv_default_currency);
  const numberPreview = formatInvoiceNumber(
    draft?.inv_number_prefix ?? '',
    Number(draft?.inv_number_padding) || 6,
    Number(draft?.inv_next_number) || 1
  );

  return (
    <Shell>
      <SettingsLayout title="Invoice" subtitle="What prints on every invoice, and the defaults for new ones.">
        {!draft ? (
          <div className="settings-card">
            <div className="settings-card-body" style={{ color: 'var(--muted-foreground)' }}>
              {error ?? 'Loading settings…'}
            </div>
          </div>
        ) : (
          <>
            {(error || fileError) && (
              <div className="settings-card">
                <div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error ?? fileError}</div>
              </div>
            )}

            <SettingsCard title="Company profile" subtitle="The “from” details at the top of every invoice and receipt.">
              <SettingsRow label="Legal name">
                <input className="input" maxLength={120} value={draft.inv_legal_name ?? ''} onChange={(e) => set('inv_legal_name', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Tax ID (TIN)" help="Printed as “TIN: …”. Leave empty to hide.">
                <input className="input" maxLength={40} value={draft.inv_tax_id ?? ''} onChange={(e) => set('inv_tax_id', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Address">
                <input className="input" placeholder="Street" maxLength={120} value={draft.inv_address_1 ?? ''} onChange={(e) => set('inv_address_1', e.target.value)} />
                <input className="input" placeholder="City, State" maxLength={120} value={draft.inv_address_2 ?? ''} onChange={(e) => set('inv_address_2', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Billing email" help="Shown on the invoice; clients reply here.">
                <input className="input" type="email" value={draft.inv_contact_email ?? ''} onChange={(e) => set('inv_contact_email', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Logo" help="PNG, JPEG, WebP or SVG under 300 KB. Shown top-left on invoices.">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="inv-logo-slot" style={{ width: '120px', height: '44px', overflow: 'hidden' }}>
                    {draft.inv_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.inv_logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      'No logo'
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) readImageFile(file, (url) => { setFileError(null); set('inv_logo', url); }, setFileError);
                    }}
                  />
                  <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
                    <Upload />
                    <span>Upload</span>
                  </button>
                  {draft.inv_logo && (
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--muted-foreground)' }} onClick={() => set('inv_logo', '')}>
                      Remove
                    </button>
                  )}
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Currency & tax" subtitle="Defaults for new invoices; each invoice can change them.">
              <SettingsRow label="Default currency">
                <SettingSelect
                  value={`${defaultCurrency} (${CURRENCY_SYMBOLS[defaultCurrency]})`}
                  onChange={(v) => set('inv_default_currency', v.slice(0, 3))}
                  options={CURRENCY_LABELS}
                  maxWidth={200}
                />
              </SettingsRow>
              <SettingsRow
                label="Exchange rate"
                help="Pre-filled when you tick “Show USD equivalent” on an invoice, for clients outside Nigeria. Update it as the rate moves."
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '260px' }}>
                  <span style={{ color: 'var(--muted-foreground)' }}>₦</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    style={{ textAlign: 'right' }}
                    value={draft.inv_usd_rate ?? ''}
                    onChange={(e) => set('inv_usd_rate', e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                  <span style={{ color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>= $1</span>
                </div>
              </SettingsRow>
              <SettingsRow label="VAT rate" help="Nigeria’s standard VAT is 7.5%. Set 0 if you are not VAT-registered.">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '160px' }}>
                  <input
                    className="input"
                    inputMode="decimal"
                    style={{ textAlign: 'right' }}
                    value={draft.inv_tax_rate ?? ''}
                    onChange={(e) => set('inv_tax_rate', e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                  <span style={{ color: 'var(--muted-foreground)' }}>%</span>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Numbering & terms">
              <SettingsRow label="Invoice number" help={<>Next invoice: <Code>{numberPreview}</Code></>}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: '8px', maxWidth: '420px' }}>
                  <div className="setting-field">
                    <label>Prefix</label>
                    <input className="input" maxLength={12} value={draft.inv_number_prefix ?? ''} onChange={(e) => set('inv_number_prefix', e.target.value.replace(/[^A-Za-z0-9/_.-]/g, ''))} />
                  </div>
                  <div className="setting-field">
                    <label>Digits</label>
                    <input className="input" style={{ textAlign: 'right' }} value={draft.inv_number_padding ?? '6'} onChange={(e) => set('inv_number_padding', e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
                  </div>
                  <div className="setting-field">
                    <label>Next number</label>
                    <input className="input" style={{ textAlign: 'right' }} value={draft.inv_next_number ?? ''} onChange={(e) => set('inv_next_number', e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                </div>
              </SettingsRow>
              <SettingsRow label="Default due date" help="Sets the due date on new invoices.">
                <SettingSelect value={draft.inv_payment_terms ?? 'Net 30'} onChange={(v) => set('inv_payment_terms', v)} options={TERMS} maxWidth={200} />
              </SettingsRow>
              <SettingsRow label="Payment terms text" help="Pre-filled in the Payment terms box of new invoices.">
                <textarea className="input" style={{ minHeight: '70px' }} maxLength={2000} value={draft.inv_terms_note ?? ''} onChange={(e) => set('inv_terms_note', e.target.value)} />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Bank accounts"
              subtitle="Printed under “Payment information”. Each invoice shows the accounts in its currency (plus USD when the USD equivalent is on)."
            >
              <div className="setting-list">
                {accounts.map((account) => (
                  <div className="setting-list-row account-row" key={account.id} style={{ alignItems: 'start', gridTemplateColumns: '28px minmax(0,1fr) auto' }}>
                    <div className="inv-account-flag" style={{ background: 'var(--foreground)' }}>
                      {CURRENCY_SYMBOLS[account.currency] ?? account.currency}
                    </div>
                    {editingAccount === account.id ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <div className="setting-field">
                            <label>Label</label>
                            <input className="input" placeholder="Naira account" value={account.title} onChange={(e) => updateAccount(account.id, { title: e.target.value })} />
                          </div>
                          <div className="setting-field">
                            <label>Currency</label>
                            <SettingSelect value={account.currency} onChange={(v) => updateAccount(account.id, { currency: v })} options={CURRENCIES.map((c) => c.code)} />
                          </div>
                          <div className="setting-field">
                            <label>Bank</label>
                            <input className="input" placeholder="Bank name" value={account.bank} onChange={(e) => updateAccount(account.id, { bank: e.target.value })} />
                          </div>
                          <div className="setting-field">
                            <label>Account name</label>
                            <input className="input" value={account.accountName} onChange={(e) => updateAccount(account.id, { accountName: e.target.value })} />
                          </div>
                          <div className="setting-field">
                            <label>Account number</label>
                            <input className="input" value={account.accountNumber} onChange={(e) => updateAccount(account.id, { accountNumber: e.target.value })} />
                          </div>
                          <div className="setting-field">
                            <label>
                              <select
                                value={account.extraLabel || EXTRA_LABELS[0]}
                                onChange={(e) => updateAccount(account.id, { extraLabel: e.target.value })}
                                style={{ border: 'none', background: 'transparent', font: 'inherit', fontWeight: 500, padding: 0 }}
                                aria-label="Extra detail type"
                              >
                                {Array.from(new Set([...EXTRA_LABELS, account.extraLabel].filter(Boolean))).map((l) => (
                                  <option key={l}>{l}</option>
                                ))}
                              </select>{' '}
                              (optional)
                            </label>
                            <input className="input" value={account.extraValue} onChange={(e) => updateAccount(account.id, { extraValue: e.target.value })} />
                          </div>
                        </div>
                        <button className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }} onClick={() => setEditingAccount(null)}>
                          Done
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="primary">{account.title || `${account.currency} account`}</div>
                        <div className="secondary">
                          {[account.bank, account.accountName, account.accountNumber, account.extraValue ? `${account.extraLabel}: ${account.extraValue}` : '']
                            .filter(Boolean)
                            .join(' · ') || 'No details yet'}
                        </div>
                      </div>
                    )}
                    <div className="row-actions">
                      <button className="icon-btn" title="Edit account" onClick={() => setEditingAccount(editingAccount === account.id ? null : account.id)}>
                        <Edit />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete account"
                        style={{ color: 'var(--destructive)' }}
                        onClick={() => confirm(`Remove ${account.title || 'this account'}?`) && setAccounts(accounts.filter((a) => a.id !== account.id))}
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
                  onClick={() => {
                    const account: Account = {
                      id: newId('acc'),
                      title: '',
                      currency: defaultCurrency,
                      bank: '',
                      accountName: draft.inv_legal_name ?? '',
                      accountNumber: '',
                      extraLabel: EXTRA_LABELS[0],
                      extraValue: '',
                    };
                    setAccounts([...accounts, account]);
                    setEditingAccount(account.id);
                  }}
                >
                  <Plus />
                  <span style={{ marginLeft: '6px' }}>Add bank account</span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard title="Payment methods" subtitle="Choices in the Log payment form. Switch off the ones you don’t use.">
              <div className="setting-list">
                {methods.map((method) => (
                  <div className="setting-list-row method-row" key={method.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <input
                      className="input"
                      aria-label="Method name"
                      maxLength={60}
                      value={method.name}
                      onChange={(e) => setMethods(methods.map((m) => (m.id === method.id ? { ...m, name: e.target.value } : m)))}
                      style={{ maxWidth: 280 }}
                    />
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <SettingToggle on={method.enabled !== false} onToggle={() => setMethods(methods.map((m) => (m.id === method.id ? { ...m, enabled: m.enabled === false } : m)))} />
                      <button className="icon-btn" title="Delete method" style={{ color: 'var(--destructive)' }} onClick={() => setMethods(methods.filter((m) => m.id !== method.id))}>
                        <Trash />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="setting-list-row dashed" role="button" tabIndex={0} onClick={() => setMethods([...methods, { id: newId('mth'), name: 'New method', enabled: true }])}>
                  <Plus />
                  <span style={{ marginLeft: '6px' }}>Add method</span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard title="Organisation" subtitle="Where new invoices land.">
              <SettingsRow label="Default folder">
                <SettingSelect
                  value={draft.inv_default_folder && draft.inv_default_folder !== 'None' ? draft.inv_default_folder : 'Invoices'}
                  onChange={(v) => set('inv_default_folder', v)}
                  options={folders.length ? folders.map((f) => f.name) : ['Invoices']}
                />
              </SettingsRow>
              <SettingsRow label="Default tag">
                <SettingSelect value={draft.inv_default_tag ?? 'None'} onChange={(v) => set('inv_default_tag', v)} options={['None', ...tags.map((t) => t.name)]} />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Footer strip" subtitle="A coloured line of text at the bottom of every invoice and receipt.">
              <SettingsRow label="Show strip">
                <SettingToggle
                  on={draft.inv_tagline_on === 'true'}
                  onToggle={() => set('inv_tagline_on', draft.inv_tagline_on === 'true' ? 'false' : 'true')}
                  label={draft.inv_tagline_on === 'true' ? 'On' : 'Off'}
                />
              </SettingsRow>
              {draft.inv_tagline_on === 'true' && (
                <>
                  <SettingsRow label="Text">
                    <input className="input" maxLength={120} value={draft.inv_tagline_text ?? ''} onChange={(e) => set('inv_tagline_text', e.target.value)} />
                  </SettingsRow>
                  <SettingsRow label="Colour">
                    <div className="setting-toggle-list">
                      {TAGLINE_COLORS.map((color) => (
                        <button
                          key={color.value}
                          className={`color-swatch${draft.inv_tagline_color === color.value ? ' active' : ''}`}
                          style={{ background: color.value, width: '32px', height: '32px', borderRadius: '8px', borderWidth: '2px' }}
                          title={color.title}
                          aria-label={color.title}
                          onClick={() => set('inv_tagline_color', color.value)}
                        />
                      ))}
                    </div>
                    <div className="tagline-preview" style={{ background: draft.inv_tagline_color ?? '#1d4ed8', marginTop: 8 }}>
                      {draft.inv_tagline_text || 'Thank you for your business'}
                    </div>
                  </SettingsRow>
                </>
              )}
            </SettingsCard>

            <SettingsCard
              title="Email templates"
              subtitle="Used by Send on an invoice. Placeholders are filled in for you."
              foot={
                <span>
                  <Code>{'{client}'}</Code> <Code>{'{number}'}</Code> <Code>{'{amount}'}</Code> <Code>{'{balance}'}</Code>{' '}
                  <Code>{'{due}'}</Code> <Code>{'{link}'}</Code> <Code>{'{payment_date}'}</Code>. If <Code>{'{link}'}</Code> is
                  missing, the client link is added at the end.
                </span>
              }
            >
              <SettingsRow label="Invoice subject">
                <input className="input" value={draft.inv_email_invoice_subject ?? ''} onChange={(e) => set('inv_email_invoice_subject', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Invoice message">
                <textarea className="input" style={{ minHeight: '110px' }} value={draft.inv_email_invoice_body ?? ''} onChange={(e) => set('inv_email_invoice_body', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Receipt subject" help="Used once a payment has been logged.">
                <input className="input" value={draft.inv_email_receipt_subject ?? ''} onChange={(e) => set('inv_email_receipt_subject', e.target.value)} />
              </SettingsRow>
              <SettingsRow label="Receipt message">
                <textarea className="input" style={{ minHeight: '110px' }} value={draft.inv_email_receipt_body ?? ''} onChange={(e) => set('inv_email_receipt_body', e.target.value)} />
              </SettingsRow>
            </SettingsCard>
          </>
        )}
      </SettingsLayout>

      <SaveBar visible={dirty} saving={saving} message={savedAt && !dirty ? 'Saved!' : 'You have unsaved changes'} onDiscard={discard} onSave={save} />
    </Shell>
  );
}
