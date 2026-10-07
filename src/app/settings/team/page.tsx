'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { SettingsCard, SettingsLayout } from '@/components/settings/settings-ui';
import { XIcon } from '@/components/icons';
import { Plus } from '@/components/icons';
import { refreshTeam, relativeTime, ROLE_LABEL, roleName, useMe, type TeamUser } from '@/lib/team';
import { useConfirm } from '@/components/invoices/choice-modal';
import { Portal } from '@/components/portal';

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

/** What each role can do. Owners can do everything, so they have no column of their own to fill in. */
const ACCESS: { what: string; hint?: string; member: boolean; admin: boolean }[] = [
  { what: 'Links', hint: 'Create, edit, archive and see analytics', member: true, admin: true },
  { what: 'UTM campaigns', hint: 'Build, edit and archive', member: true, admin: true },
  { what: 'Invoices', hint: 'Create, edit, log payments and email to clients', member: true, admin: true },
  { what: 'Use existing folders and tags', member: true, admin: true },
  { what: 'Delete links, UTMs and invoices', member: false, admin: true },
  { what: 'Create, rename and delete folders and tags', member: false, admin: true },
  { what: 'Settings', hint: 'Workspace, short domains, UTM and invoice setup, email server', member: false, admin: true },
  { what: 'Export all data', member: false, admin: true },
  { what: 'Activity log', hint: 'Who did what', member: false, admin: true },
  { what: 'Team', hint: 'Add or remove people, new setup codes, choose who is an admin', member: false, admin: false },
];

const ACCESS_SUMMARY = {
  owner: 'Everything, including the team',
  admin: 'Everything except managing the team',
  member: 'Links, UTMs and invoices. No settings',
} as const;

function Yes() {
  return (
    <span className="access-yes" role="img" aria-label="Yes">
      ✓
    </span>
  );
}
function No() {
  return (
    <span className="access-no" role="img" aria-label="No">
      –
    </span>
  );
}

const initialsFrom = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)).toUpperCase() || '?';
};

export default function TeamSettingsPage() {
  const { me, mode } = useMe();
  const [ask, confirmModal] = useConfirm();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invite, setInvite] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; code: string; expires_at: number } | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [more, setMore] = useState(false);
  const [actor, setActor] = useState('');
  const [type, setType] = useState('');
  const [reload, setReload] = useState(0);

  // Only the owner adds or removes people and chooses who is an admin.
  const canManage = !!me?.owner;

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
    setIssued(data);
    refreshTeam();
    setReload((n) => n + 1);
  };

  const newCode = async (user: TeamUser) => {
    const res = await fetch(`/api/team/users/${encodeURIComponent(user.email)}/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json();
    if (res.ok) setIssued(data);
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

  const reinvite = async (user: TeamUser) => {
    const res = await fetch('/api/team/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    const data = await res.json();
    if (res.ok) setIssued(data);
    refreshTeam();
    setReload((n) => n + 1);
  };

  const setAdmin = async (user: TeamUser, on: boolean) => {
    if (on) {
      const ok = await ask({
        title: `Give ${user.display_name} admin access?`,
        message:
          'They will be able to change settings and short domains, manage folders and tags, export data and delete links, UTMs and invoices. They still cannot add or remove people or change who is an admin. You can turn this off at any time; it applies on their next click.',
        confirmLabel: 'Give admin access',
      });
      if (!ok) return;
    }
    const role = on ? 'admin' : 'member';
    const before = users;
    setUsers((list) => list.map((u) => (u.email === user.email ? { ...u, role } : u)));
    const res = await fetch(`/api/team/users/${encodeURIComponent(user.email)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setUsers(before);
      const data = await res.json().catch(() => ({}));
      await ask({ title: 'Could not change access', message: data.error || 'Try again in a moment.', confirmLabel: 'OK', infoOnly: true });
    }
    refreshTeam();
    setReload((n) => n + 1);
  };

  const howTheyGotIn = (user: TeamUser) => {
    if (user.owner) return 'Owner';
    return user.invited_by ? `Invited by ${nameOf(user.invited_by)}` : 'Invited';
  };

  const statusText = (user: TeamUser) => {
    if (user.status === 'removed') return 'Removed';
    if (user.status === 'invited') {
      if (user.code_state === 'used_up') return 'Invited · code used up, issue a new one';
      return user.code_state === 'expired' ? 'Invited · code expired, issue a new one' : 'Invited · not signed in yet';
    }
    const devices = user.devices ? ` · ${user.devices} device${user.devices === 1 ? '' : 's'}` : '';
    return `${user.last_seen_at ? `Active · seen ${relativeTime(user.last_seen_at)}` : 'Active'}${devices}`;
  };

  return (
    <Shell>
      <SettingsLayout title="Team" subtitle="Who can use this workspace, and who did what.">
        {me?.role === 'admin' && (
          <>
            {mode === 'dev' && (
              <div className="send-setup-note" style={{ marginBottom: '16px' }}>
                Local development: sign-in is skipped and you act as a stand-in admin.
              </div>
            )}

            <SettingsCard
              title="People"
              subtitle={
                canManage
                  ? 'Only people added here can sign in. Adding someone gives you a one-time setup code to send them; they use it once to choose their password. Everyone starts as a member. Turn on Admin when you want to hand someone settings and bigger changes.'
                  : 'Only people added here can sign in. Only the owner can add or remove people, or change who is an admin.'
              }
            >
              {canManage && (
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
                    <span>Add member</span>
                  </button>
                  {inviteError && <span style={{ color: 'var(--destructive)', fontSize: '12px' }}>{inviteError}</span>}
                </div>
              )}
              <div className="setting-list">
                {users.map((user) => (
                  <div className={`setting-list-row team-row${user.status === 'removed' ? ' is-removed' : ''}`} key={user.email}>
                    <div className="avatar">{initialsFrom(user.display_name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="primary">
                        {user.display_name}
                        {user.email === me?.email && <span className="secondary"> (you)</span>}{' '}
                        <span className={`role-badge is-${roleName(user)}`}>{ROLE_LABEL[roleName(user)]}</span>
                      </div>
                      <div className="secondary">
                        {user.email} · {howTheyGotIn(user)}
                      </div>
                      <div className="secondary">{ACCESS_SUMMARY[roleName(user)]}</div>
                    </div>
                    <span className="secondary">{statusText(user)}</span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {canManage && !user.owner && user.status !== 'removed' && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={user.role === 'admin'}
                          aria-label={`Admin access for ${user.display_name}`}
                          className={`toggle toggle-btn${user.role === 'admin' ? ' on' : ''}`}
                          onClick={() => void setAdmin(user, user.role !== 'admin')}
                        >
                          <span className="toggle-switch" />
                          <span className="toggle-label">Admin</span>
                        </button>
                      )}
                      {user.email !== me?.email && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void setActor(user.email)}
                          title="Show only this person's activity"
                        >
                          Activity
                        </button>
                      )}
                      {canManage && !user.owner && user.status === 'invited' && (
                        <button className="btn btn-outline btn-sm" onClick={() => void newCode(user)}>
                          New code
                        </button>
                      )}
                      {canManage &&
                        !user.owner &&
                        (user.status === 'removed' ? (
                          <button className="btn btn-outline btn-sm" onClick={() => void reinvite(user)}>
                            Re-invite
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

            <SettingsCard
              title="What each role can do"
              subtitle="Members cannot open Settings. When you need bigger changes done, turn on Admin for that person above. Turn it off again when you are done."
            >
              <table className="access-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Area</span>
                    </th>
                    <th scope="col">Member</th>
                    <th scope="col">Admin</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {ACCESS.map((row) => (
                    <tr key={row.what}>
                      <th scope="row">
                        <span className="access-what">{row.what}</span>
                        {row.hint && <span className="access-hint">{row.hint}</span>}
                      </th>
                      <td data-label="Member">{row.member ? <Yes /> : <No />}</td>
                      <td data-label="Admin">{row.admin ? <Yes /> : <No />}</td>
                      <td data-label="Owner">
                        <Yes />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      {issued && <CodeModal issued={issued} onClose={() => setIssued(null)} />}
    </Shell>
  );
}

/** Shows a setup code once, to copy and send to the person yourself. */
function CodeModal({ issued, onClose }: { issued: { email: string; code: string; expires_at: number }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = `You have been added to our workspace.\n\n1. Open ${window.location.origin}/login\n2. Enter ${issued.email}\n3. Enter this setup code: ${issued.code}\n4. Choose your name and a password.\n\nThe code works once and expires on ${new Date(issued.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`;
  return (
    <Portal><div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal choice-modal" role="dialog" aria-label="Setup code">
        <div className="modal-header">
          <div className="modal-title">Setup code for {issued.email}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="choice-modal-body">
          <div className="setup-code">{issued.code}</div>
          <p className="choice-modal-hint">
            Send this to them yourself (WhatsApp, Slack, in person). It is shown only now, works once, and expires in 7 days. If it gets
            lost, use <strong>New code</strong>.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>
            Done
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              void navigator.clipboard.writeText(message);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy message with code'}
          </button>
        </div>
      </div>
    </div></Portal>
  );
}
