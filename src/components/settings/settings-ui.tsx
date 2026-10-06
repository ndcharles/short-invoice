'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from '@/components/icons';
import { useMe } from '@/lib/team';

const NAV = [
  {
    id: 'general',
    label: 'General',
    href: '/settings',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v6m0 10v6m11-11h-6M7 12H1m17.66-6.66l-4.24 4.24M9.58 14.42l-4.24 4.24m0-13.32l4.24 4.24m4.84 4.84l4.24 4.24" />
      </svg>
    ),
  },
  {
    id: 'shortener',
    label: 'URL Shortener',
    href: '/settings/shortener',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    id: 'utm',
    label: 'UTM Builder',
    href: '/settings/utm',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h16" />
        <circle cx="18" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: 'invoice',
    label: 'Invoice',
    href: '/settings/invoice',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  {
    id: 'team',
    label: 'Team',
    href: '/settings/team',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <aside className="settings-nav">
      <div className="settings-nav-title">Settings</div>
      {NAV.map((item) => (
        <Link key={item.id} href={item.href} className={pathname === item.href ? 'active' : ''}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </aside>
  );
}

export function SettingsLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const { me } = useMe();
  // Settings are admin-only; the API refuses member writes as well.
  const blocked = me !== null && me.role !== 'admin';
  return (
    <div className="settings-layout">
      <SettingsNav />
      <div className="settings-main">
        <div className="settings-hero">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        {!me ? null : blocked ? (
          <div className="settings-card">
            <div className="settings-card-body" style={{ color: 'var(--muted-foreground)', fontSize: '13px' }}>
              Only admins can view and change settings. Ask an admin if something needs to change.
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function SettingsCard({
  title,
  subtitle,
  foot,
  danger,
  children,
}: {
  title: string;
  subtitle?: string;
  foot?: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`settings-card${danger ? ' danger' : ''}`}>
      <div className="settings-card-head">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="settings-card-body">{children}</div>
      {foot ? <div className="settings-card-foot">{foot}</div> : null}
    </section>
  );
}

export function SettingsRow({
  label,
  help,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <label>{label}</label>
        {help ? <div className="row-help">{help}</div> : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

/** Native select styled as the design system's `.setting-select`. */
export function SettingSelect({
  value,
  onChange,
  options,
  maxWidth,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  maxWidth?: number;
}) {
  return (
    <div className="setting-select" style={maxWidth ? { maxWidth } : undefined}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {(options.includes(value) ? options : [value, ...options]).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="chev">
        <ChevronDown />
      </span>
    </div>
  );
}

export function SettingToggle({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <label className={`toggle ${on ? 'on' : ''}`} onClick={onToggle}>
      <div className="toggle-switch" />
      {label ? <span style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>{label}</span> : null}
    </label>
  );
}

/** Segmented control (`.setting-seg`) for 2–4 mutually exclusive choices. */
export function SettingSeg({
  value,
  options,
  onChange,
  render,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  render?: (option: string) => React.ReactNode;
}) {
  return (
    <div className="setting-seg">
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? 'active' : ''}
          onClick={() => onChange(option)}
        >
          {render ? render(option) : option}
        </button>
      ))}
    </div>
  );
}

/** Inline `code` styling used in card help text. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        background: 'var(--muted)',
        padding: '1px 4px',
        borderRadius: '3px',
        fontFamily: "'SFMono-Regular', ui-monospace, monospace",
        fontSize: '11px',
      }}
    >
      {children}
    </code>
  );
}

export function SaveBar({
  visible,
  saving,
  message,
  onDiscard,
  onSave,
}: {
  visible: boolean;
  saving?: boolean;
  message?: string;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className={`save-bar ${visible ? 'visible' : ''}`} role="status" aria-live="polite">
      <span className="save-bar-dot" />
      <span>{message ?? 'You have unsaved changes'}</span>
      <button className="btn btn-outline" onClick={onDiscard} disabled={saving}>
        Discard
      </button>
      <button className="btn btn-primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
