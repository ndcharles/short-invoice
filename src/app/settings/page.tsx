'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { SaveBar, SettingsCard, SettingsLayout, SettingsRow, SettingSelect } from '@/components/settings/settings-ui';
import { FoldersCard, TagsCard } from '@/components/settings/collections-cards';
import { Upload } from '@/components/icons';

const TIMEZONES = [
  'Africa / Lagos (GMT+1)',
  'Europe / London (GMT+0)',
  'America / New York (GMT-5)',
  'Asia / Dubai (GMT+4)',
];
const DATE_FORMATS = ['Mar 19, 2026', '19 Mar 2026', '2026-03-19', '19/03/2026'];
const LANGUAGES = [
  'English (United Kingdom)',
  'English (United States)',
  'Français',
  'Português (Brasil)',
];
const MAX_LOGO_BYTES = 300 * 1024;

const TEAM = [
  { initials: 'NC', name: 'ndcharles', email: 'nd@acme.co', role: 'Owner', you: true },
  { initials: 'JD', name: 'Jane Doe', email: 'jane@acme.co', role: 'Editor', you: false },
  { initials: 'SO', name: 'Seun Ola', email: 'seun@acme.co', role: 'Editor', you: false },
];

export default function GeneralSettingsPage() {
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('You have unsaved changes');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (cancelled) return;
        const loaded = (data.settings ?? {}) as Record<string, string>;
        setBaseline(loaded);
        setDraft(loaded);
      } catch {
        if (!cancelled) setError('Could not load settings');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => !!baseline && !!draft && JSON.stringify(baseline) !== JSON.stringify(draft),
    [baseline, draft]
  );

  const set = (key: string, value: string) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const initials = 'A';

  const onPickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logos must be under 300 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      set('workspace_logo', String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      const saved = (data.settings ?? {}) as Record<string, string>;
      setBaseline(saved);
      setDraft(saved);
      setMessage('Saved!');
      setTimeout(() => setMessage('You have unsaved changes'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!baseline) return;
    setDraft(baseline);
    setError(null);
  };

  return (
    <Shell>
      <SettingsLayout title="General" subtitle="Workspace-wide settings and your personal profile.">
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
              title="Workspace"
              subtitle="How this workspace appears in the sidebar and on shared docs."
              foot={
                <>
                  <span>Changes apply to everyone in the workspace.</span>
                  <span>ID: ws_default</span>
                </>
              }
            >
              <SettingsRow label="Workspace name" help="Shown in the sidebar switcher and email templates.">
                <input
                  className="input"
                  value={draft.workspace_name ?? ''}
                  onChange={(e) => set('workspace_name', e.target.value)}
                />
              </SettingsRow>

              <SettingsRow
                label="Workspace logo"
                help="Displayed on invoices, receipts and shared preview pages. PNG or SVG, 512×512 max."
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    className="workspace-avatar"
                    style={{ width: '48px', height: '48px', fontSize: '18px', borderRadius: '8px', overflow: 'hidden' }}
                  >
                    {draft.workspace_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.workspace_logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      initials
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => onPickLogo(e.target.files?.[0])}
                  />
                  <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
                    <Upload />
                    <span>Upload logo</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--muted-foreground)' }}
                    onClick={() => set('workspace_logo', '')}
                  >
                    Remove
                  </button>
                </div>
              </SettingsRow>

              <SettingsRow label="Timezone" help="Used for scheduling, activity logs and analytics.">
                <SettingSelect
                  value={draft.timezone ?? TIMEZONES[0]}
                  onChange={(v) => set('timezone', v)}
                  options={TIMEZONES}
                />
              </SettingsRow>

              <SettingsRow label="Date format">
                <div className="setting-seg">
                  {DATE_FORMATS.map((format) => (
                    <button
                      key={format}
                      className={draft.date_format === format ? 'active' : ''}
                      onClick={() => set('date_format', format)}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </SettingsRow>

              <SettingsRow label="Language">
                <SettingSelect
                  value={draft.language ?? LANGUAGES[0]}
                  onChange={(v) => set('language', v)}
                  options={LANGUAGES}
                />
              </SettingsRow>
            </SettingsCard>

            <FoldersCard />
            <TagsCard />

            <SettingsCard title="Your profile" subtitle="How you appear to teammates and clients.">
              <SettingsRow label="Full name">
                <input
                  className="input"
                  value={draft.profile_name ?? ''}
                  onChange={(e) => set('profile_name', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Email" help="Used for sign-in and notifications.">
                <input
                  className="input"
                  type="email"
                  value={draft.profile_email ?? ''}
                  onChange={(e) => set('profile_email', e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Avatar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="avatar" style={{ width: '44px', height: '44px', fontSize: '15px' }}>
                    {(draft.profile_name ?? 'NC').slice(0, 2).toUpperCase()}
                  </div>
                  <button className="btn btn-outline btn-sm" disabled title="Not available in this build">
                    <Upload />
                    <span>Upload</span>
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled style={{ color: 'var(--muted-foreground)' }}>
                    Remove
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label="Password" help="You last changed your password 42 days ago.">
                <button className="btn btn-outline btn-sm" disabled>
                  Change password
                </button>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title="Team members"
              subtitle={`${TEAM.length} members · 1 owner, ${TEAM.length - 1} editors. Invite by email to add more.`}
            >
              <div className="setting-list">
                {TEAM.map((member) => (
                  <div className="setting-list-row team-row" key={member.email}>
                    <div className="team-avatar">{member.initials}</div>
                    <div>
                      <div className="primary">
                        {member.name} {member.you ? <span className="secondary">(you)</span> : null}
                      </div>
                      <div className="secondary">{member.email}</div>
                    </div>
                    <button className="role-select" disabled>
                      {member.role}
                      <span className="chev">▾</span>
                    </button>
                    <button className="icon-btn" disabled style={{ color: 'var(--subtle-foreground)' }} aria-label="More">
                      ⋮
                    </button>
                  </div>
                ))}
                <div className="setting-list-row dashed" title="Not available in this build">
                  <span>+</span>
                  <span style={{ marginLeft: '6px' }}>Invite teammate by email</span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              danger
              title="Danger zone"
              subtitle="Actions here are permanent and cannot be undone."
            >
              <SettingsRow
                label="Transfer ownership"
                help="Give another team member full control of this workspace. You will be downgraded to Editor."
              >
                <button className="btn-danger" disabled title="Not available in this build">
                  Transfer ownership
                </button>
              </SettingsRow>
              <SettingsRow
                label="Delete workspace"
                help="Permanently deletes this workspace, all its links, invoices, and campaigns."
              >
                <button className="btn-danger" disabled title="Not available in this build">
                  Delete workspace
                </button>
              </SettingsRow>
            </SettingsCard>
          </>
        )}
      </SettingsLayout>

      <SaveBar
        visible={dirty}
        saving={saving}
        message={message}
        onDiscard={handleDiscard}
        onSave={handleSave}
      />
    </Shell>
  );
}
