'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LinkItem } from '@/lib/types';
import {
  Archive,
  Check,
  Copy,
  Cursor,
  Duplicate,
  Edit,
  More,
  Trash,
} from '@/components/icons';
import { usePopoverDismiss } from '@/lib/popover';

interface LinkCardProps {
  link: LinkItem;
  onArchiveToggle: (id: string, currentlyArchived: boolean) => void;
  onDelete: (id: string) => void;
  onDuplicate: (link: LinkItem) => void;
}

type MenuPos = { top: number; left: number } | null;

export function LinkCard({ link, onArchiveToggle, onDelete, onDuplicate }: LinkCardProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const fullUrl = `https://${link.domain}/${link.alias}`;

  const closeMenu = useCallback(() => setMenuPos(null), []);

  usePopoverDismiss(menuPos !== null, closeMenu);

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuPos) {
      closeMenu();
      return;
    }
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 170 });
  };

  const copyToClipboard = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderFavicon = () => {
    const dest = link.dest.toLowerCase();
    if (dest.includes('google.com') || dest.includes('docs.google') || dest.includes('forms.gle')) {
      return (
        <div className="favicon google">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
        </div>
      );
    }
    if (dest.includes('slack.com') || dest.includes('sli.do')) {
      return (
        <div className="favicon slack">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="white">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.527 2.527 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.522-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.522 2.522v6.312zm-2.521 10.122a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.522-2.522v-2.522h2.522zm0-1.268a2.527 2.527 0 0 1-2.522-2.521 2.527 2.527 0 0 1 2.522-2.522h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.522h-6.313z" />
          </svg>
        </div>
      );
    }
    if (dest.includes('discord.com') || dest.includes('discord.gg')) {
      return (
        <div className="favicon discord">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="white">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
        </div>
      );
    }
    return <div className="favicon dot-green" />;
  };

  const dateStr = new Date(link.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const tagClass = link.tag === 'Client' ? 'yellow' : link.tag === 'Campaign' ? 'blue' : link.tag === 'Internal' ? 'green' : '';

  return (
    <div
      className={`link-card${menuPos ? ' is-open' : ''}`}
      onClick={() => router.push(`/links/edit?id=${encodeURIComponent(link.id)}`)}
      style={menuPos ? { background: 'var(--muted-2)', boxShadow: 'var(--shadow-sm)', borderColor: 'var(--border-strong)' } : undefined}
    >
      {renderFavicon()}

      <div className="link-info">
        <div className="link-alias-row">
          <span className="link-alias">{link.domain}/{link.alias}</span>
          <button
            className="link-alias-copy no-nav"
            onClick={copyToClipboard}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
            style={{ border: 'none', background: 'transparent', display: 'inline-flex' }}
          >
            {copied ? <Check style={{ color: 'var(--accent-green-fg)' }} /> : <Copy />}
          </button>
        </div>

        <div className="link-dest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17l10-10M17 17V7H7" />
          </svg>
          <span className="link-dest-url" title={link.dest}>
            {link.dest.replace(/^https?:\/\//, '')}
          </span>
          <span className="link-dest-meta">
            <span className="creator-avatar" title={link.avatar}>{link.avatar}</span>
            <span className="link-date">{dateStr}</span>
          </span>
        </div>
      </div>

      <div className="link-meta-right">
        {link.tag ? <span className={`tag ${tagClass}`}>{link.tag}</span> : <span />}
        <div className="click-pill">
          <Cursor />
          <span>{link.clicks.toLocaleString()} clicks</span>
        </div>
      </div>

      <button
        ref={menuBtnRef}
        className="icon-btn no-nav"
        data-row-menu
        onClick={toggleMenu}
        aria-label="More"
        style={menuPos ? { background: 'var(--muted)', color: 'var(--foreground)' } : undefined}
      >
        <More />
      </button>

      {menuPos && (
        <div
          className="dropdown"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          data-row-menu
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dropdown-item" onClick={() => { closeMenu(); router.push(`/links/edit?id=${encodeURIComponent(link.id)}`); }}>
            <Edit />
            <span>Edit</span>
            <span className="kbd-hint">E</span>
          </div>
          <div className="dropdown-item" onClick={() => { closeMenu(); onDuplicate(link); }}>
            <Duplicate />
            <span>Duplicate</span>
            <span className="kbd-hint">D</span>
          </div>
          <div className="dropdown-item" onClick={() => { closeMenu(); onArchiveToggle(link.id, link.archived === 1); }}>
            <Archive />
            <span>{link.archived === 1 ? 'Unarchive' : 'Archive'}</span>
            <span className="kbd-hint">A</span>
          </div>
          <div className="dropdown-sep" />
          <div className="dropdown-item destructive" onClick={() => { closeMenu(); onDelete(link.id); }}>
            <Trash />
            <span>Delete</span>
            <span className="kbd-hint">⌫</span>
          </div>
        </div>
      )}
    </div>
  );
}
