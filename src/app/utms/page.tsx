'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { UtmCard } from '@/components/utms/utm-card';
import { UtmForm } from '@/components/utms/utm-form';
import type { UtmCampaign } from '@/lib/types';
import { ChevronDown, Filter, FolderIcon, More, Plus, Refresh, Search, Sort, XIcon } from '@/components/icons';
import { useCollections, useSettings } from '@/lib/collections';
import { usePopoverDismiss } from '@/lib/popover';
import {
  buildCampaignUrl,
  EMPTY_UTM_FIELDS,
  formatOptionsFromSettings,
  UtmFields,
  validateUtmFields,
} from '@/lib/utm-builder';

const PAGE_SIZE = 25;
const SORTS = [
  { id: 'date', label: 'Newest first' },
  { id: 'clicks', label: 'Most clicks' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

export default function UtmsPage() {
  const [campaigns, setCampaigns] = useState<UtmCampaign[]>([]);
  const [counts, setCounts] = useState({ active: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [folderFilter, setFolderFilter] = useState('Campaigns');
  const [sortOrder, setSortOrder] = useState<SortId>('date');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [openMenu, setOpenMenu] = useState<'folder' | 'sort' | 'more' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [fields, setFields] = useState<UtmFields>(EMPTY_UTM_FIELDS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = useSettings();
  const format = useMemo(() => formatOptionsFromSettings(settings), [settings]);
  const { items: folders } = useCollections('folders');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ archived: activeTab === 'archived' ? '1' : '0' });
        if (search.trim()) params.set('search', search.trim());
        if (folderFilter && folderFilter !== 'All') params.set('folder', folderFilter);
        const res = await fetch(`/api/utms?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        setCampaigns(data.campaigns ?? []);
        if (data.counts) setCounts(data.counts);
      } catch (err) {
        console.error('Failed to load campaigns:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, search, folderFilter, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // "C" opens the create modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'c' || e.key === 'C') &&
        !createOpen &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        setFields(EMPTY_UTM_FIELDS);
        setCreateOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen]);

  const closeToolbarMenu = useCallback(() => setOpenMenu(null), []);
  usePopoverDismiss(openMenu !== null, closeToolbarMenu);

  const visible = useMemo(() => {
    const rows = [...campaigns];
    rows.sort((a, b) => (sortOrder === 'clicks' ? b.clicks - a.clicks : b.created_at - a.created_at));
    return rows;
  }, [campaigns, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = (currentPage - 1) * PAGE_SIZE + paged.length;
  const isEmpty = !loading && counts.active + counts.archived === 0;

  const handleCreate = async () => {
    const validation = validateUtmFields(fields);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/utms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create campaign');
      setCreateOpen(false);
      setFields(EMPTY_UTM_FIELDS);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async (id: string, archived: boolean) => {
    await fetch(`/api/utms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !archived }),
    });
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    await fetch(`/api/utms/${id}`, { method: 'DELETE' });
    refresh();
  };

  const handleDuplicate = async (campaign: UtmCampaign) => {
    await fetch('/api/utms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website: campaign.website,
        source: campaign.source,
        medium: campaign.medium,
        campaign: campaign.campaign ? `${campaign.campaign}_copy` : null,
        campaign_id: campaign.campaign_id,
        term: campaign.term,
        content: campaign.content,
        comments: campaign.comments,
        folder: campaign.folder,
      }),
    });
    refresh();
  };

  const activeFolder = folders.find((f) => f.name === folderFilter);
  const previewUrl = buildCampaignUrl(fields, format);

  return (
    <Shell>
      <div className="page-header">
        <div className="page-title">
          <span>UTM Builder</span>
          <span className="title-count">{counts.active + counts.archived} total</span>
          <ChevronDown className="page-title-chevron" />
        </div>
        <button className="btn btn-primary" onClick={() => { setFields(EMPTY_UTM_FIELDS); setCreateOpen(true); }}>
          <Plus />
          <span>Create campaign</span>
          <kbd>C</kbd>
        </button>
      </div>

      <div className={`list-tabs${isEmpty ? ' is-dim' : ''}`}>
        <button
          className={`list-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => { setActiveTab('active'); setPage(1); }}
        >
          All Active <span className="list-tab-count">{counts.active}</span>
        </button>
        <button
          className={`list-tab ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => { setActiveTab('archived'); setPage(1); }}
        >
          Archived <span className="list-tab-count">{counts.archived}</span>
        </button>
      </div>

      <div className={`toolbar${isEmpty ? ' is-dim' : ''}`} ref={toolbarRef}>
        {!isEmpty && (
          <div className="toolbar-menu" data-popover-root>
            <button
              className="folder-filter"
              onClick={() => setOpenMenu(openMenu === 'folder' ? null : 'folder')}
            >
              <span className={`fs-swatch ${activeFolder?.color ?? 'green'}`}>
                <FolderIcon />
              </span>
              <span>{folderFilter === 'All' ? 'All folders' : folderFilter}</span>
              <ChevronDown className="chev" />
            </button>
            {openMenu === 'folder' && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0 }}>
                <div
                  className={`dropdown-item${folderFilter === 'All' ? ' is-current' : ''}`}
                  onClick={() => { setFolderFilter('All'); setPage(1); setOpenMenu(null); }}
                >
                  <FolderIcon width="12" height="12" />
                  <span>All folders</span>
                </div>
                {folders.map((f) => (
                  <div
                    key={f.id}
                    className={`dropdown-item${folderFilter === f.name ? ' is-current' : ''}`}
                    onClick={() => { setFolderFilter(f.name); setPage(1); setOpenMenu(null); }}
                  >
                    <span className={`fs-swatch ${f.color}`} style={{ width: '14px', height: '14px' }}>
                      <FolderIcon width="8" height="8" />
                    </span>
                    <span>{f.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button className="btn btn-outline btn-sm" disabled={isEmpty}>
          <Filter />
          <span>Filter</span>
          <ChevronDown />
        </button>

        <div className="toolbar-menu" data-popover-root>
          <button
            className="btn btn-outline btn-sm"
            disabled={isEmpty}
            onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
          >
            <Sort />
            <span>Sort</span>
            <ChevronDown />
          </button>
          {openMenu === 'sort' && (
            <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0 }}>
              {SORTS.map((s) => (
                <div
                  key={s.id}
                  className={`dropdown-item${sortOrder === s.id ? ' is-current' : ''}`}
                  onClick={() => { setSortOrder(s.id); setPage(1); setOpenMenu(null); }}
                >
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-spacer" />

        <div className="search">
          <Search />
          <input
            placeholder="Search by campaign or source"
            value={search}
            disabled={isEmpty}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {!isEmpty && (
          <div className="toolbar-menu" data-popover-root>
            <button className="icon-btn" onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')} aria-label="More">
              <More />
            </button>
            {openMenu === 'more' && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', right: 0 }}>
                <div className="dropdown-item" onClick={() => { setOpenMenu(null); refresh(); }}>
                  <Refresh />
                  <span>Refresh</span>
                  <span className="kbd-hint">R</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="link-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="link-card" style={{ opacity: 0.4 }}>
              <div className="favicon" />
              <div className="link-info">
                <span className="link-alias" style={{ color: 'var(--subtle-foreground)' }}>loading…</span>
              </div>
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="empty">
          <div className="empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16" />
              <path d="M4 12h10" />
              <path d="M4 18h16" />
              <circle cx="18" cy="12" r="2" />
            </svg>
          </div>
          <h3>No campaigns yet</h3>
          <p>Build your first UTM-tagged URL to start attributing traffic to sources, mediums and campaigns.</p>
          <button className="btn btn-primary" onClick={() => { setFields(EMPTY_UTM_FIELDS); setCreateOpen(true); }}>
            <Plus />
            <span>Create campaign</span>
            <kbd>C</kbd>
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Search width="24" height="24" />
          </div>
          <h3>No campaigns found</h3>
          <p>Try adjusting your search or folder to find what you are looking for.</p>
          <button className="btn btn-outline" onClick={() => { setSearch(''); setFolderFilter('All'); }}>
            <span>Clear filters</span>
          </button>
        </div>
      ) : (
        <div className="link-list">
          {paged.map((campaign) => (
            <UtmCard
              key={campaign.id}
              campaign={campaign}
              format={format}
              onArchiveToggle={handleArchiveToggle}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="pagination">
          <div>
            Viewing {rangeStart}–{rangeEnd} of {visible.length} campaigns
          </div>
          <div className="pagination-btns">
            <button className="btn btn-outline btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </button>
            <button className="btn btn-outline btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Create campaign modal */}
      {createOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-label="New campaign">
            <div className="modal-header">
              <div className="modal-title">
                <span style={{ color: 'var(--muted-foreground)' }}>UTM Builder</span>
                <span className="breadcrumb-chev">›</span>
                <span className="favicon utm-favicon" style={{ width: '20px', height: '20px' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h16" />
                    <path d="M4 12h10" />
                    <path d="M4 18h16" />
                    <circle cx="18" cy="12" r="2" />
                  </svg>
                </span>
                <span>New campaign</span>
              </div>
              <button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close modal">
                <XIcon />
              </button>
            </div>

            {error && (
              <div style={{ margin: '12px 20px 0', padding: '8px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}>
                {error}
              </div>
            )}

            <div className="modal-body utm">
              <UtmForm
                fields={fields}
                onChange={(patch) => setFields((prev) => ({ ...prev, ...patch }))}
                format={format}
                folders={folders}
                previewLabel="Live preview"
              />
            </div>

            <div className="modal-footer">
              <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
                Required: source, medium, and campaign name or ID
              </span>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !previewUrl}>
                <span>{saving ? 'Creating…' : 'Create campaign'}</span>
                <kbd>↵</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
