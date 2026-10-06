'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, Copy, Duplicate, Edit, More, Trash } from '@/components/icons';
import type { UtmCampaign } from '@/lib/types';
import { buildCampaignUrl, UtmFormatOptions, websitePretty } from '@/lib/utm-builder';
import { usePopoverDismiss } from '@/lib/popover';
import { useMe, useTeam } from '@/lib/team';

type MenuPos = { top: number; left: number } | null;

export function UtmCard({
  campaign,
  format,
  onArchiveToggle,
  onDelete,
  onDuplicate,
}: {
  campaign: UtmCampaign;
  format: UtmFormatOptions;
  onArchiveToggle: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
  onDuplicate: (campaign: UtmCampaign) => void;
}) {
  const router = useRouter();
  const { nameOf, initialsOf } = useTeam();
  const admin = useMe().me?.role === 'admin';
  const byline = campaign.created_by
    ? `Created by ${nameOf(campaign.created_by)}${campaign.updated_by && campaign.updated_by !== campaign.created_by ? ` · last edited by ${nameOf(campaign.updated_by)}` : ''}`
    : 'Created before sign-in was set up';
  const [copied, setCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const fields = {
    website: campaign.website,
    source: campaign.source ?? '',
    medium: campaign.medium ?? '',
    campaign: campaign.campaign ?? '',
    campaign_id: campaign.campaign_id ?? '',
    term: campaign.term ?? '',
    content: campaign.content ?? '',
    comments: campaign.comments ?? '',
    folder: campaign.folder,
  };
  const fullUrl = buildCampaignUrl(fields, format);

  const closeMenu = useCallback(() => setMenuPos(null), []);

  usePopoverDismiss(menuPos !== null, closeMenu);

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuPos) return closeMenu();
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 170 });
  };

  const copyUrl = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dateStr = new Date(campaign.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div
      className={`link-card utm-card${menuPos ? ' is-open' : ''}`}
      onClick={() => router.push(`/utms/edit?id=${encodeURIComponent(campaign.id)}`)}
      style={menuPos ? { background: 'var(--muted-2)', boxShadow: 'var(--shadow-sm)', borderColor: 'var(--border-strong)' } : undefined}
    >
      <div className="favicon utm-favicon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16" />
          <path d="M4 12h10" />
          <path d="M4 18h16" />
          <circle cx="18" cy="12" r="2" />
        </svg>
      </div>

      <div className="link-info">
        <div className="link-alias-row">
          <span className="link-alias">{websitePretty(campaign.website)}</span>
          <button
            className="link-alias-copy no-nav"
            onClick={copyUrl}
            title={copied ? 'Copied!' : 'Copy final URL'}
            style={{ border: 'none', background: 'transparent', display: 'inline-flex' }}
          >
            {copied ? <Check style={{ color: 'var(--accent-green-fg)' }} /> : <Copy />}
          </button>
        </div>

        <div className="link-dest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17l10-10M17 17V7H7" />
          </svg>
          <span className="link-dest-url" title={fullUrl}>
            {fullUrl}
          </span>
          <span className="link-dest-meta">
            <span className="creator-avatar" title={byline}>{campaign.created_by ? initialsOf(campaign.created_by) : campaign.avatar}</span>
            <span className="link-date">{dateStr}</span>
          </span>
        </div>
      </div>

      <div className="link-meta-right utm-params">
        <span className="utm-pill utm-src" title="Source">{campaign.source || '—'}</span>
        <span className="utm-pill utm-med" title="Medium">{campaign.medium || '—'}</span>
        <span className="utm-pill utm-cnt" title="Content">{campaign.content || '—'}</span>
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
          data-row-menu
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dropdown-item" onClick={() => { closeMenu(); router.push(`/utms/edit?id=${encodeURIComponent(campaign.id)}`); }}>
            <Edit />
            <span>Edit</span>
            <span className="kbd-hint">E</span>
          </div>
          <div className="dropdown-item" onClick={() => { closeMenu(); onDuplicate(campaign); }}>
            <Duplicate />
            <span>Duplicate</span>
            <span className="kbd-hint">D</span>
          </div>
          <div className="dropdown-item" onClick={() => { copyUrl(); closeMenu(); }}>
            <Copy />
            <span>Copy URL</span>
            <span className="kbd-hint">⌘C</span>
          </div>
          <div className="dropdown-item" onClick={() => { closeMenu(); onArchiveToggle(campaign.id, campaign.archived === 1); }}>
            <Archive />
            <span>{campaign.archived === 1 ? 'Unarchive' : 'Archive'}</span>
            <span className="kbd-hint">A</span>
          </div>
          {admin && (
            <>
          <div className="dropdown-sep" />
          <div className="dropdown-item destructive" onClick={() => { closeMenu(); onDelete(campaign.id); }}>
            <Trash />
            <span>Delete</span>
            <span className="kbd-hint">⌫</span>
          </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
