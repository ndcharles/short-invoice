'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
import { useSettingsForm } from '@/lib/settings-form';
import { primeSettings, useCollections, useSettings } from '@/lib/collections';
import { EXPIRATION_OPTIONS } from '@/lib/links/defaults';
import { parseHostname } from '@/lib/validate';
import { formatDate } from '@/lib/dates';
import { Plus, Refresh, Trash } from '@/components/icons';
import type { ShortDomain } from '@/lib/short-url';

interface DomainRow extends ShortDomain {
  links: number;
  is_default: boolean;
}

interface DomainsState {
  domains: DomainRow[];
  default_domain: string;
  verify_path: string;
}

async function domainsApi(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api/domains${path}`, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

/** Domains are saved immediately through /api/domains (not the save bar). */
function DomainsCard({ onDefaultChange }: { onDefaultChange: (domain: string) => void }) {
  const [state, setState] = useState<DomainsState | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [appHost, setAppHost] = useState('');
  const settings = useSettings();

  useEffect(() => {
    queueMicrotask(() => setAppHost(window.location.host));
    domainsApi('').then(({ ok, data }) => ok && setState(data));
  }, []);

  const apply = useCallback(
    (data: DomainsState) => {
      setState(data);
      onDefaultChange(data.default_domain);
      if (settings) {
        primeSettings({
          ...settings,
          default_domain: data.default_domain,
          shortener_domains: JSON.stringify(data.domains.map(({ id, name, status, added, verified_at }) => ({ id, name, status, added, verified_at }))),
        });
      }
    },
    [onDefaultChange, settings]
  );

  const run = async (key: string, action: () => Promise<{ ok: boolean; data: DomainsState & { error?: string; reason?: string; verified?: boolean } }>, success?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const { ok, data } = await action();
      if (data.domains) apply(data);
      if (!ok) setMessage({ tone: 'error', text: data.reason || data.error || 'Something went wrong' });
      else if (success) setMessage({ tone: 'ok', text: success });
    } catch {
      setMessage({ tone: 'error', text: 'Network error, try again.' });
    } finally {
      setBusy(null);
    }
  };

  const addDomain = () => {
    const parsed = parseHostname(newDomain);
    if (!parsed.ok) {
      setMessage({ tone: 'error', text: parsed.error });
      return;
    }
    void run('add', () => domainsApi('', 'POST', { name: parsed.value }), `${parsed.value} added. Attach it to the Worker, then press Verify.`).then(() =>
      setNewDomain('')
    );
  };

  return (
    <SettingsCard
      title="Domains"
      subtitle="Short-link domains. Until a domain is verified, its links work at this app's /s/ address."
      foot={
        <span>
          To attach a domain: Cloudflare dashboard → Workers &amp; Pages → <strong>short-invoice</strong> → Settings → Domains &amp;
          Routes → Add → Custom domain. The domain must be on your Cloudflare account. Then press Verify.
        </span>
      }
    >
      <div className="setting-list">
        {!state && <div className="setting-list-row" style={{ color: 'var(--muted-foreground)' }}>Loading domains…</div>}
        {state?.domains.map((domain) => (
          <div
            className="setting-list-row domain-row"
            key={domain.id}
            style={{ alignItems: 'center', gridTemplateColumns: '24px minmax(0, 1fr) auto auto' }}
          >
            <div className="domain-favicon">{domain.name.charAt(0).toUpperCase()}</div>
            <div>
              <div className="primary">
                {domain.name}
                {domain.is_default && <span className="secondary" style={{ marginLeft: 6 }}>· default</span>}
              </div>
              <div className="secondary">
                {domain.links} link{domain.links === 1 ? '' : 's'}
                {domain.status === 'active' && domain.verified_at
                  ? ` · verified ${formatDate(domain.verified_at, settings?.date_format)}`
                  : domain.is_default && appHost
                    ? ` · links work at ${appHost}/s/… until verified`
                    : ' · not attached yet'}
              </div>
            </div>
            <span className={`tag ${domain.status === 'active' ? 'green' : 'yellow'}`}>
              {domain.status === 'active' ? 'Active' : 'Pending'}
            </span>
            <div className="row-actions">
              <button
                className="btn btn-outline btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  run(`verify-${domain.name}`, () => domainsApi(`/${encodeURIComponent(domain.name)}/verify`, 'POST'), `${domain.name} is verified and live.`)
                }
              >
                <Refresh />
                <span>{busy === `verify-${domain.name}` ? 'Checking…' : 'Verify'}</span>
              </button>
              {!domain.is_default && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() => run(`default-${domain.name}`, () => domainsApi(`/${encodeURIComponent(domain.name)}/default`, 'POST'))}
                >
                  Make default
                </button>
              )}
              {!domain.is_default && (
                <button
                  className="icon-btn"
                  title={domain.links ? 'Move or delete its links first' : 'Remove domain'}
                  disabled={busy !== null || domain.links > 0}
                  style={{ color: 'var(--destructive)' }}
                  onClick={() => {
                    if (!confirm(`Remove ${domain.name}?`)) return;
                    void run(`remove-${domain.name}`, () => domainsApi(`/${encodeURIComponent(domain.name)}`, 'DELETE'));
                  }}
                >
                  <Trash />
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="setting-list-row dashed" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="links.example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
            style={{ maxWidth: 280 }}
          />
          <button className="btn btn-outline btn-sm" onClick={addDomain} disabled={busy !== null || !newDomain.trim()}>
            <Plus />
            <span>Add domain</span>
          </button>
        </div>
      </div>
      {message && (
        <div style={{ marginTop: 10, fontSize: 12, color: message.tone === 'error' ? 'var(--destructive)' : 'var(--accent-green-fg)' }}>
          {message.text}
        </div>
      )}
    </SettingsCard>
  );
}

export default function ShortenerSettingsPage() {
  const { draft, set, dirty, saving, error, savedAt, save, discard, adopt } = useSettingsForm();
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const onDefaultChange = useCallback((domain: string) => adopt({ default_domain: domain }), [adopt]);

  const defaultTags: string[] = (() => {
    try {
      const parsed = JSON.parse(draft?.default_tags ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return (
    <Shell>
      <SettingsLayout title="URL Shortener" subtitle="Domains, root redirect and defaults for new short links.">
        {!draft ? (
          <div className="settings-card">
            <div className="settings-card-body" style={{ color: 'var(--muted-foreground)' }}>
              {error ?? 'Loading settings…'}
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="settings-card">
                <div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error}</div>
              </div>
            )}

            <DomainsCard onDefaultChange={onDefaultChange} />

            <SettingsCard title="Root redirect" subtitle="Where visitors go when they open a short domain without an alias.">
              <SettingsRow
                label="Redirect URL"
                help={
                  <>
                    For example <Code>https://{draft.default_domain}</Code> → your website. Leave empty to show a
                    &ldquo;link not found&rdquo; page.
                  </>
                }
              >
                <input
                  className="input"
                  placeholder="https://yourcompany.com"
                  value={draft.root_redirect ?? ''}
                  onChange={(e) => set('root_redirect', e.target.value)}
                />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="Link defaults" subtitle="Pre-filled on the Create link form. Each link can still change them.">
              <SettingsRow label="Default folder">
                <SettingSelect
                  value={draft.default_folder || 'Links'}
                  onChange={(v) => set('default_folder', v)}
                  options={folders.length ? folders.map((f) => f.name) : ['Links']}
                />
              </SettingsRow>

              <SettingsRow label="Default tag">
                <SettingSelect
                  value={defaultTags[0] ?? 'None'}
                  onChange={(v) => set('default_tags', JSON.stringify(v === 'None' ? [] : [v]))}
                  options={['None', ...tags.map((t) => t.name)]}
                />
              </SettingsRow>

              <SettingsRow label="Default expiration" help="New links stop working after this long.">
                <SettingSelect
                  value={draft.default_expiration || 'Never expire'}
                  onChange={(v) => set('default_expiration', v)}
                  options={[...EXPIRATION_OPTIONS]}
                  maxWidth={200}
                />
              </SettingsRow>

              <SettingsRow
                label="Cloak new links"
                help="Shows the destination inside a frame so the short link stays in the address bar. Many sites (Google, banks, social networks) refuse to be framed, so use it sparingly."
              >
                <SettingToggle
                  on={draft.default_cloak === 'true'}
                  onToggle={() => set('default_cloak', draft.default_cloak === 'true' ? 'false' : 'true')}
                  label={draft.default_cloak === 'true' ? 'On' : 'Off'}
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
