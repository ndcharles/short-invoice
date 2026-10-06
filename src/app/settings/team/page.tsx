'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { SaveBar, SettingsCard, SettingsLayout, SettingsRow } from '@/components/settings/settings-ui';
import { Plus } from '@/components/icons';
import { useSettingsForm } from '@/lib/settings-form';
import { parseList, serializeList } from '@/lib/settings-json';
import { refreshTeam, relativeTime, useMe, type TeamUser } from '@/lib/team';
import { useConfirm } from '@/components/invoices/choice-modal';

interface ActivityRow {
  id: string;
  at: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  label: string;
  detail: string;
}

const TYPES = [
  { id: '', label: 'Everything' },
  { id: 'link', label: 'Links' },
  { id: 'utm', label: 'UTMs' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'settings', label: 'Settings' },
  { id: 'team', label: 'Team' },
];

const TYPE_WORD: Record<string, string> = {
  link: 'link',
  utm: 'UTM',
  invoice: 'invoice',
  settings: '',
  team: '',
  folder: 'folder',
  tag: 'tag',
  domain: 'domain',
};

/** Activity actions as they read in a sentence: "Ada logged a payment on invoice INV-12". */
const PHRASE: Record<string, string> = {
  status: 'changed the status of',
  'logged payment': 'logged a payment on',
  'removed payment': 'removed a payment from',
  'email failed': 'tried to email',
  'verify failed': 'could not verify',
  'made default': 'made the default',
};

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function hrefFor(row: ActivityRow): string | null {
  if (row.action === 'deleted' || !row.entity_id) return null;
  if (row.entity_type === 'link') return `/links/edit?id=${encodeURIComponent(row.entity_id)}`;
  if (row.entity_type === 'utm') return `/utms/edit?id=${encodeURIComponent(row.entity_id)}`;
  if (row.entity_type === 'invoice') return `/invoices/edit?id=${encodeURIComponent(row.entity_id)}`;
  return null;
}

const initialsFrom = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)).toUpperCase() || '?';
};

export default function TeamSettingsPage() {
  const { me, mode } = useMe();
  const { draft, set, dirty, saving, error, savedAt, save, discard } = useSettingsForm();
  const [ask, confirmModal] = useConfirm();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [invite, setInvite] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [more, setMore] = useState(false);
  const [actor, setActor] = useState('');
  const [type, setType] = useState('');
  const [reload, setReload] = useState(0);

  const domains = parseList<string>(draft?.team_domains, []);
  const nameOf = useCallback(
    (email: string) => users.find((u) => u.email === email)?.display_name ?? email.split('@')[0],
    [users]
  );

  useEffect(() => {
    if (me?.role !== 'admin') return;
    let cancelled = false;
    fetch('/api/team/users')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setUsers(data.users ?? []);
        setAdmins(data.admins ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me?.role, reload]);

  const loadActivity = useCallback(
    async (before?: number) => {
      const params = new URLSearchParams();
      if (actor) params.set('actor', actor);
      if (type) params.set('type', type);
      if (before) params.set('before', String(before));
      const res = await fetch(`/api/team/activity?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setActivity((prev) => (before ? [...prev, ...(data.activity ?? [])] : data.activity ?? []));
      setMore(!!data.more);
    },
    [actor, type]
  );

  useEffect(() => {
    if (me?.role !== 'admin') return;
    // Loading the feed is fetching data for this view, not deriving state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadActivity();
  }, [me?.role, loadActivity, reload]);

  const sendInvite = async () => {
    const email = invite.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setInviteError('Enter a valid email address');
      return;
    }
    setInviteError(null);
    const res = await fetch('/api/team/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      setInviteError(data.error || 'Could not invite');
      return;
    }
    setInvite('');
    refreshTeam();
    setReload((n) => n + 1);
  };

  const remove = async (user: TeamUser) => {
    const ok = await ask({
      title: `Remove ${user.display_name}?`,
      message: `${user.email} loses access on their next click. Everything they created stays, with their name on it. You can let them back in later.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/team/users/${encodeURIComponent(user.email)}`, { method: 'DELETE' });
    refreshTeam();
    setReload((n) => n + 1);
  };

  const restore = async (user: TeamUser) => {
    await fetch('/api/team/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    refreshTeam();
    setReload((n) => n + 1);
  };

  const addDomain = () => {
    const domain = newDomain.trim().toLowerCase().replace(/^@/, '');
    if (!domain) return;
    if (!domains.includes(domain)) set('team_domains', serializeList([...domains, domain]));
    setNewDomain('');
  };

  const howTheyGotIn = (user: TeamUser) => {
    if (admins.includes(user.email) || user.source === 'admin') return 'Admin';
    if (user.source === 'domain') return `@${user.email.split('@')[1]} domain`;
    return user.invited_by ? `Invited by ${nameOf(user.invited_by)}` : 'Invited';
  };

  const statusText = (user: TeamUser) => {
    if (user.status === 'removed') return 'Removed';
    if (user.status === 'invited') return 'Invited · not signed in yet';
    return user.last_seen_at ? `Active · seen ${relativeTime(user.last_seen_at)}` : 'Active';
  };

  return (
    <Shell>
      <SettingsLayout title="Team" subtitle="Who can use this workspace, and who did what.">
        {draft && (
          <>
            {mode !== 'access' && mode !== null && (
              <div className="send-setup-note" style={{ marginBottom: '16px' }}>
                {mode === 'local'
                  ? 'Local development: you are signed in as a stand-in admin. In production, people sign in through Cloudflare Access.'
                  : 'Cloudflare Access is not switched on yet, so anyone with the link can open this app. Turn it on before inviting people.'}
              </div>
            )}

            {error && (
              <div className="settings-card">
                <div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error}</div>
              </div>
            )}

            <SettingsCard
              title="Who can sign in"
              subtitle="People sign in with their email (a one-time code from Cloudflare Access). Anyone on an allowed domain gets in as a member; everyone else needs an invite."
            >
              <SettingsRow label="Allowed domains" help="E.g. 4th-entity.com. Public email services like gmail.com cannot be added; invite those people one by one.">
                <div className="setting-toggle-list">
                  {domains.map((domain) => (
                    <button
                      key={domain}
                      className="setting-chip on"
                      title="Remove this domain"
                      onClick={() => set('team_domains', serializeList(domains.filter((d) => d !== domain)))}
                    >
                      <span>@{domain}</span>
                      <span className="x">×</span>
                    </button>
                  ))}
                  <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      className="input"
                      style={{ width: '180px' }}
                      placeholder="4th-entity.com"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                    />
                    <button className="btn btn-outline btn-sm" onClick={addDomain} disabled={!newDomain.trim()}>
                      Add
                    </button>
                  </span>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard title="People" subtitle="Admins manage settings and the team. Members create and edit links, UTMs and invoices, but cannot change settings or delete records.">
              <div className="team-invite">
                <input
                  className="input"
                  type="email"
                  placeholder="name@anydomain.com"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void sendInvite()}
                  aria-label="Email to invite"
                />
                <button className="btn btn-primary btn-sm" onClick={() => void sendInvite()}>
                  <Plus />
                  <span>Invite member</span>
                </button>
                {inviteError && <span style={{ color: 'var(--destructive)', fontSize: '12px' }}>{inviteError}</span>}
              </div>
              <div className="setting-list">
                {users.map((user) => (
                  <div className={`setting-list-row team-row${user.status === 'removed' ? ' is-removed' : ''}`} key={user.email}>
                    <div className="avatar">{initialsFrom(user.display_name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="primary">
                        {user.display_name}
                        {user.email === me?.email && <span className="secondary"> (you)</span>}{' '}
                        <span className={`role-badge${user.role === 'admin' ? ' is-admin' : ''}`}>{user.role === 'admin' ? 'Admin' : 'Member'}</span>
                      </div>
                      <div className="secondary">
                        {user.email} · {howTheyGotIn(user)}
                      </div>
                    </div>
                    <span className="secondary">{statusText(user)}</span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      {user.role !== 'admin' && user.email !== me?.email && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void setActor(user.email)}
                          title="Show only this person's activity"
                        >
                          Activity
                        </button>
                      )}
                      {user.role !== 'admin' &&
                        (user.status === 'removed' ? (
                          <button className="btn btn-outline btn-sm" onClick={() => void restore(user)}>
                            Let back in
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--destructive)' }} onClick={() => void remove(user)}>
                            Remove
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </SettingsCard>

            <SettingsCard title="Activity" subtitle="Every change to links, UTMs, invoices, settings and the team, newest first.">
              <div className="team-filters">
                <span className="setting-select" style={{ maxWidth: '220px' }}>
                  <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Person">
                    <option value="">Everyone</option>
                    {users.map((u) => (
                      <option key={u.email} value={u.email}>
                        {u.display_name}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </span>
                <span className="setting-select" style={{ maxWidth: '180px' }}>
                  <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
                    {TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </span>
              </div>
              <div className="activity-list">
                {activity.length === 0 && <div className="row-help" style={{ padding: '12px 0' }}>Nothing yet.</div>}
                {activity.map((row) => {
                  const href = hrefFor(row);
                  const word = TYPE_WORD[row.entity_type] ?? row.entity_type;
                  return (
                    <div className="activity-row" key={row.id}>
                      <div className="avatar" title={row.actor}>{initialsFrom(nameOf(row.actor))}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="activity-line">
                          <strong>{nameOf(row.actor)}</strong> {PHRASE[row.action] ?? row.action} {word}{' '}
                          {href ? <Link href={href}>{row.label}</Link> : <span className="activity-label">{row.label}</span>}
                        </div>
                        {row.detail && <div className="activity-detail">{row.detail}</div>}
                      </div>
                      <span className="activity-time" title={new Date(row.at).toLocaleString()}>
                        {relativeTime(row.at)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {more && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: '10px' }} onClick={() => void loadActivity(activity[activity.length - 1]?.at)}>
                  Load older
                </button>
              )}
            </SettingsCard>
          </>
        )}
      </SettingsLayout>
      {confirmModal}
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
