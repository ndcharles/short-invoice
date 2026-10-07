'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Me {
  email: string;
  name: string;
  /** 'admin' means admin powers: the owner and anyone the owner has delegated to. */
  role: 'admin' | 'member';
  /** The owner (ADMIN_EMAILS): everything, including managing the team. */
  owner: boolean;
  initials: string;
}

export type RoleName = 'owner' | 'admin' | 'member';
export const ROLE_LABEL: Record<RoleName, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** Owner, admin or member, for badges and wording. */
export const roleName = (user: { role: 'admin' | 'member'; owner?: boolean } | null | undefined): RoleName =>
  user?.owner ? 'owner' : user?.role === 'admin' ? 'admin' : 'member';

export interface MeState {
  me: Me | null;
  /** 'session' when signed in; 'dev' when local development skips sign-in. */
  mode: 'session' | 'dev' | null;
  /** Set when the API refused this person (signed out, not invited, removed). */
  denied: { code: string; error: string } | null;
}

export interface TeamUser {
  email: string;
  name: string;
  display_name: string;
  role: 'admin' | 'member';
  owner: boolean;
  status?: 'invited' | 'active' | 'removed';
  source?: 'admin' | 'invite';
  invited_by?: string | null;
  devices?: number;
  code_state?: 'valid' | 'expired' | 'used_up' | null;
  created_at?: number;
  last_seen_at?: number | null;
}

// One request per page load, shared by every component that asks.
let meCache: MeState | null = null;
let meRequest: Promise<MeState> | null = null;
const meListeners = new Set<(state: MeState) => void>();

function loadMe(): Promise<MeState> {
  meRequest ??= fetch('/api/team/me')
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
        // Not signed in (or signed out elsewhere): go to the sign-in page and come back after.
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login?next=${next}`);
      }
      if (!res.ok) return { me: null, mode: null, denied: { code: data.code ?? 'error', error: data.error ?? 'Could not sign you in' } };
      return { me: data.user as Me, mode: data.auth?.mode ?? null, denied: null };
    })
    .catch(() => ({ me: null, mode: null, denied: null }))
    .then((state) => {
      meCache = state;
      for (const listener of meListeners) listener(state);
      return state;
    })
    .finally(() => {
      meRequest = null;
    });
  return meRequest;
}

/** The signed-in person (null while loading). */
export function useMe(): MeState & { setName: (name: string) => Promise<void> } {
  const [state, setState] = useState<MeState>(meCache ?? { me: null, mode: null, denied: null });
  useEffect(() => {
    meListeners.add(setState);
    if (!meCache) void loadMe();
    return () => {
      meListeners.delete(setState);
    };
  }, []);

  const setName = useCallback(async (name: string) => {
    const res = await fetch('/api/team/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save your name');
    const next = { ...(meCache ?? state), me: data.user as Me };
    meCache = next;
    for (const listener of meListeners) listener(next);
    teamCache = null;
  }, [state]);

  return { ...state, setName };
}

export const isAdmin = (state: MeState) => state.me?.role === 'admin';

let teamCache: TeamUser[] | null = null;
let teamRequest: Promise<TeamUser[]> | null = null;

/** Everyone in the workspace, for "Created by …" labels. */
export function useTeam(): { users: TeamUser[]; nameOf: (email: string | null | undefined) => string; initialsOf: (email: string | null | undefined) => string } {
  const [users, setUsers] = useState<TeamUser[]>(teamCache ?? []);
  useEffect(() => {
    if (teamCache) return;
    teamRequest ??= fetch('/api/team/users')
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data) => (teamCache = (data.users ?? []) as TeamUser[]))
      .catch(() => [])
      .finally(() => {
        teamRequest = null;
      });
    let cancelled = false;
    void teamRequest?.then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = useCallback(
    (email: string | null | undefined) => {
      if (!email) return 'someone (before sign-in)';
      return users.find((u) => u.email === email)?.display_name ?? email.split('@')[0];
    },
    [users]
  );
  const initialsOf = useCallback(
    (email: string | null | undefined) => {
      const name = email ? users.find((u) => u.email === email)?.display_name ?? email.split('@')[0] : '';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2);
      return letters.toUpperCase() || '?';
    },
    [users]
  );
  return { users, nameOf, initialsOf };
}

/** Clears the cached people list (after inviting or removing someone). */
export function refreshTeam() {
  teamCache = null;
}

/** "Created by Ada · edited by Tunde 2 days ago" pieces for records. */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '';
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} d ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Ends the session on this device (or all devices) and goes to the sign-in page. */
export async function signOut(everywhere = false) {
  await fetch(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => undefined);
  window.location.replace('/login');
}
