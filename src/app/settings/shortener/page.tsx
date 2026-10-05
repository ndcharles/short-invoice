'use client';

import React, { useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { SaveBar, SettingsCard, SettingsLayout, SettingsRow, SettingSelect, SettingToggle } from '@/components/settings/settings-ui';
import { useSettingsForm } from '@/lib/settings-form';
import { useCollections } from '@/lib/collections';
import { newId, parseList, serializeList } from '@/lib/settings-json';
import { Edit, Trash } from '@/components/icons';

const EXPIRATIONS = ['Never expire', '7 days', '30 days', '90 days', '1 year', 'Custom'];

interface ShortDomain {
  id: string;
  initial: string;
  name: string;
  meta: string;
  status: string;
  added: string;
}

export default function ShortenerSettingsPage() {
  const { draft, set, dirty, saving, error, savedAt, save, discard } = useSettingsForm();
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const [editingDomain, setEditingDomain] = useState<string | null>(null);

  const domains = parseList<ShortDomain>(draft?.shortener_domains, []);
  const setDomains = (list: ShortDomain[]) => set('shortener_domains', serializeList(list));
  const updateDomain = (id: string, patch: Partial<ShortDomain>) =>
    setDomains(domains.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const defaultDomain = draft?.default_domain ?? '4th.link';
  const domainOptions = Array.from(new Set([defaultDomain, ...domains.map((d) => d.name)]));

  const defaultTags: string[] = (() => {
    try {
      const parsed = JSON.parse(draft?.default_tags ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const toggleDefaultTag = (name: string) => {
    const next = defaultTags.includes(name)
      ? defaultTags.filter((t) => t !== name)
      : [...defaultTags, name];
    set('default_tags', JSON.stringify(next));
  };

  return (
    <Shell>
      <SettingsLayout
        title="URL Shortener"
        subtitle="Domains, root redirection, folders, tags and defaults for every new short link."
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

            <SettingsCard
              title="Domains"
              subtitle="Manage the short-link domains your team can use."
            >
              <SettingsRow label="Default domain" help="New short links use this domain unless overridden.">
                <SettingSelect
                  value={defaultDomain}
                  onChange={(v) => set('default_domain', v)}
                  options={domainOptions}
                />
              </SettingsRow>

              <SettingsRow label="Custom domains" help="Add and verify your own domains via CNAME / A records.">
                <div className="setting-list">
                  {domains.map((domain) => (
                    <div
                      className="setting-list-row domain-row"
                      key={domain.id}
                      style={{ alignItems: 'start', gridTemplateColumns: '24px minmax(0, 1fr) auto auto' }}
                    >
                      <div className="domain-favicon">{domain.initial}</div>
                      {editingDomain === domain.id ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <input
                            className="input"
                            value={domain.name}
                            placeholder="example.com"
                            onChange={(e) => updateDomain(domain.id, { name: e.target.value })}
                          />
                          <input
                            className="input"
                            value={domain.meta}
                            placeholder="SSL enabled / verification note"
                            onChange={(e) => updateDomain(domain.id, { meta: e.target.value })}
                          />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                              className="input"
                              style={{ maxWidth: '70px' }}
                              maxLength={2}
                              value={domain.initial}
                              placeholder="4"
                              onChange={(e) => updateDomain(domain.id, { initial: e.target.value.toUpperCase() })}
                            />
                            <SettingSelect
                              value={domain.status}
                              onChange={(v) => updateDomain(domain.id, { status: v })}
                              options={['Active', 'Pending']}
                            />
                            <button className="btn btn-primary btn-sm" onClick={() => setEditingDomain(null)}>
                              Done
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="primary">{domain.name}</div>
                          <div className="secondary">
                            {domain.meta.includes('Verify CNAME:') ? (
                              <>
                                Verify CNAME:{' '}
                                <code style={{ background: 'var(--muted)', padding: '1px 5px', borderRadius: '3px' }}>
                                  {domain.meta.replace('Verify CNAME: ', '')}
                                </code>
                              </>
                            ) : (
                              domain.meta
                            )}
                            <span style={{ marginLeft: '6px' }}>· {domain.added}</span>
                          </div>
                        </div>
                      )}
                      <span className={`tag ${domain.status === 'Active' ? 'green' : 'yellow'}`}>
                        {domain.status}
                      </span>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          title="Edit domain"
                          onClick={() => setEditingDomain(editingDomain === domain.id ? null : domain.id)}
                        >
                          <Edit />
                        </button>
                        <button
                          className="icon-btn"
                          title="Remove domain"
                          style={{ color: 'var(--destructive)' }}
                          onClick={() => setDomains(domains.filter((d) => d.id !== domain.id))}
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
                      setDomains([
                        ...domains,
                        {
                          id: newId('dom'),
                          initial: 'N',
                          name: 'newdomain.link',
                          meta: 'Verify CNAME: cname.4th.link',
                          status: 'Pending',
                          added: 'Added today',
                        },
                      ])
                    }
                  >
                    <span>+</span>
                    <span style={{ marginLeft: '6px' }}>Add custom domain</span>
                  </div>
                </div>
              </SettingsRow>

              <SettingsRow
                label="Root domain redirection"
                help={
                  <>
                    When someone visits the domain root (e.g. <strong>{defaultDomain}</strong>) instead of a short
                    link, send them to this URL.
                  </>
                }
              >
                <input
                  className="input"
                  placeholder="https://acme.co"
                  value={draft.root_redirect ?? ''}
                  onChange={(e) => set('root_redirect', e.target.value)}
                />
                <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                  Leave empty to show a 404. Applies per domain — configure other domains from the list above.
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Link defaults"
              subtitle="Values pre-filled on the Create Link modal. Individual links can still override any of these."
            >
              <SettingsRow label="Default folder">
                <SettingSelect
                  value={draft.default_folder ?? 'Links'}
                  onChange={(v) => set('default_folder', v)}
                  options={['None', ...(folders.length ? folders.map((f) => f.name) : ['Links'])]}
                />
              </SettingsRow>

              <SettingsRow label="Default expiration" help="How long new links stay active before returning a 404.">
                <SettingSelect
                  value={draft.default_expiration ?? 'Never expire'}
                  onChange={(v) => set('default_expiration', v)}
                  options={EXPIRATIONS}
                  maxWidth={200}
                />
              </SettingsRow>

              <SettingsRow label="Default tags" help="Auto-applied to every new link. Users can remove them on create.">
                <div className="setting-toggle-list">
                  {tags.map((tag) => {
                    const on = defaultTags.includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        className={`setting-chip${on ? ' on' : ''}`}
                        onClick={() => toggleDefaultTag(tag.name)}
                      >
                        <span>{tag.name}</span>
                        <span className="x">{on ? '×' : '+'}</span>
                      </button>
                    );
                  })}
                  {tags.length === 0 && (
                    <span className="row-help">Create a tag below to set defaults.</span>
                  )}
                </div>
              </SettingsRow>

              <SettingsRow
                label="Cloak link (default)"
                help="When on, the destination URL is hidden behind a proxy page so the short link stays visible in the browser bar."
              >
                <SettingToggle
                  on={draft.default_cloak === 'true'}
                  onToggle={() => set('default_cloak', draft.default_cloak === 'true' ? 'false' : 'true')}
                  label={draft.default_cloak === 'true' ? 'On' : 'Off'}
                />
              </SettingsRow>

              <SettingsRow
                label="Custom preview fallback"
                help="Use a saved custom OG preview when the destination page has no OG tags, or when you explicitly turn off the fetched preview."
              >
                <SettingToggle
                  on={draft.custom_preview_fallback === 'true'}
                  onToggle={() =>
                    set(
                      'custom_preview_fallback',
                      draft.custom_preview_fallback === 'true' ? 'false' : 'true'
                    )
                  }
                  label={draft.custom_preview_fallback === 'true' ? 'On' : 'Off'}
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
