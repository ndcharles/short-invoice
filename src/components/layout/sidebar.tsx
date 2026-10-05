'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSettings } from '@/lib/collections';

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
  const workspaceName = settings?.workspace_name || 'Workspace';
  const workspaceLogo = settings?.workspace_logo || '';
  const profileName = settings?.profile_name || '';
  const profileEmail = settings?.profile_email || '';

  return (
    <aside className="sidebar" data-collapsed={collapsed ? 'true' : undefined}>
      {/* Workspace (name and logo from Settings → General) */}
      <Link href="/settings" className="workspace" title="Workspace settings">
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

      {/* Settings */}
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

      {/* Footer */}
      <div className="sidebar-footer">
        <Link href="/settings" className="user-row" title="Your profile">
          <div className="avatar">{initialsOf(profileName, 'ME')}</div>
          <div className="user-meta">
            <div className="user-name">{profileName || 'Your name'}</div>
            <div className="user-email">{profileEmail || 'Set your profile in Settings'}</div>
          </div>
        </Link>
      </div>
    </aside>
  );
}
