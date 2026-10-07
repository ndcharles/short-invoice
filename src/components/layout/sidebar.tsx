'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSettings } from '@/lib/collections';
import { ROLE_LABEL, roleName, signOut, useMe } from '@/lib/team';
import { XIcon } from '@/components/icons';
import { Portal } from '@/components/portal';

function initialsOf(name: string, fallback: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2);
  return (letters || fallback).toUpperCase();
}

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();

  const isShortener = pathname === '/' || pathname.startsWith('/links');
  const isUtm = pathname.startsWith('/utms');
  const isInvoice = pathname.startsWith('/invoices');
  const isSettings = pathname.startsWith('/settings');
  const settings = useSettings();
  const { me } = useMe();
  const admin = me?.role === 'admin';
  const [profileOpen, setProfileOpen] = useState(false);
  const workspaceName = settings?.workspace_name || 'Workspace';
  const workspaceLogo = settings?.workspace_logo || '';

  return (
    <aside className="sidebar" data-collapsed={collapsed ? 'true' : undefined}>
      {/* Workspace (name and logo from Settings → General) */}
      {settings ? (
        <Link href={admin ? '/settings' : '/links'} className="workspace" title={admin ? 'Workspace settings' : workspaceName}>
          <div className="workspace-avatar" style={workspaceLogo ? { overflow: 'hidden', padding: 0 } : undefined}>
            {workspaceLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={workspaceLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              initialsOf(workspaceName, 'W').slice(0, 1)
            )}
          </div>
          <div className="workspace-name">{workspaceName}</div>
        </Link>
      ) : (
        // Neutral blocks until the real name and logo arrive, so no placeholder ever flashes.
        <div className="workspace" aria-busy="true">
          <div className="workspace-avatar skeleton" />
          <div className="workspace-name skeleton skeleton-text" />
        </div>
      )}

      <div className="nav-section-label">Workspace</div>

      {/* URL Shortener */}
      <div>
        <Link
          href="/links"
          className={`nav-item ${isShortener ? 'active' : ''}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>URL Shortener</span>
        </Link>
        {isShortener && !collapsed && (
          <div className="nav-sub">
            <Link
              href="/links"
              className={`nav-item ${pathname === '/links' || pathname === '/' ? 'active' : ''}`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>Links</span>
            </Link>
            <Link
              href="/links/analytics"
              className={`nav-item ${pathname.startsWith('/links/analytics') ? 'active' : ''}`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span>Analytics</span>
            </Link>
          </div>
        )}
      </div>

      {/* UTM Builder */}
      <div>
        <Link
          href="/utms"
          className={`nav-item ${isUtm ? 'active' : ''}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16" />
            <path d="M4 12h10" />
            <path d="M4 18h16" />
            <circle cx="18" cy="12" r="2" />
          </svg>
          <span>UTM Builder</span>
        </Link>
      </div>

      {/* Invoice Generator */}
      <div>
        <Link
          href="/invoices"
          className={`nav-item ${isInvoice ? 'active' : ''}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="13" y2="17" />
          </svg>
          <span>Invoice Generator</span>
        </Link>
        {isInvoice && !collapsed && (
          <div className="nav-sub">
            <Link
              href="/invoices"
              className={`nav-item ${pathname === '/invoices' ? 'active' : ''}`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              <span>Invoices</span>
            </Link>
            <Link
              href="/invoices/analytics"
              className={`nav-item ${pathname.startsWith('/invoices/analytics') ? 'active' : ''}`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span>Analytics</span>
            </Link>
          </div>
        )}
      </div>

      {/* Settings (admins only) */}
      {admin && (
      <div>
        <Link
          href="/settings"
          className={`nav-item ${isSettings ? 'active' : ''}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </Link>
      </div>
      )}

      {/* Footer: the signed-in person */}
      <div className="sidebar-footer">
        <button type="button" className="user-row" title="Your profile" onClick={() => setProfileOpen(true)}>
          <div className={`avatar${me ? '' : ' skeleton'}`}>{me?.initials ?? ''}</div>
          <div className="user-meta">
            <div className="user-name">
              {me?.name ?? <span className="skeleton skeleton-text" style={{ width: 90 }} />}
              {me && <span className={`role-badge${admin ? ' is-admin' : ''}`}>{ROLE_LABEL[roleName(me)]}</span>}
            </div>
            <div className="user-email">{me?.email ?? ''}</div>
          </div>
        </button>
      </div>
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </aside>
  );
}

/** Your own name, shown next to everything you create or change. */
function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, mode, setName } = useMe();
  const [name, setDraft] = useState(me?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setName(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal><div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal choice-modal" role="dialog" aria-label="Your profile">
        <div className="modal-header">
          <div className="modal-title">Your profile</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="choice-modal-body">
          <div className="log-field">
            <label>Your name</label>
            <input
              autoFocus
              maxLength={60}
              value={name}
              placeholder={me?.email.split('@')[0]}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </div>
          <div className="choice-modal-hint">
            Signed in as <strong>{me?.email}</strong> ({me ? ROLE_LABEL[roleName(me)].toLowerCase() : 'member'}). Your name appears next to
            the links, UTMs and invoices you create or change.
          </div>
          {error && <div style={{ color: 'var(--destructive)', fontSize: '12px' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          {mode === 'session' ? (
            <span style={{ display: 'flex', gap: '6px' }}>
              <button className="btn btn-outline" onClick={() => void signOut()}>
                Sign out
              </button>
              <button className="btn btn-ghost" title="Signs you out on every phone and computer" onClick={() => void signOut(true)}>
                Sign out everywhere
              </button>
            </span>
          ) : (
            <span />
          )}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div></Portal>
  );
}
