'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Shell } from '@/components/layout/shell';
import { LinkCard } from '@/components/links/link-card';
import { CreateLinkModal } from '@/components/links/create-link-modal';
import Link from 'next/link';
import type { LinkItem } from '@/lib/types';
import { useCollections, useSettings } from '@/lib/collections';
import { useConfirm } from '@/components/invoices/choice-modal';
import { useShortUrls } from '@/lib/use-short-url';
import { usePopoverDismiss } from '@/lib/popover';
import {
  ChevronDown,
  Filter,
  FolderIcon,
  LinkIcon,
  More,
  Plus,
  Refresh,
  Search,
  Sort,
} from '@/components/icons';

const PAGE_SIZE = 25;
const SORTS = [
  { id: 'date', label: 'Newest first' },
  { id: 'clicks', label: 'Most clicks' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

export default function LinksPage() {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [counts, setCounts] = useState({ active: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [folderFilter, setFolderFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortId>('date');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<'folder' | 'filter' | 'sort' | 'more' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { items: folders } = useCollections('folders');
  const { items: tags } = useCollections('tags');
  const activeFolder = folders.find((f) => f.name === folderFilter);
  const settings = useSettings();
  const [ask, confirmModal] = useConfirm();
  const { urlFor } = useShortUrls(settings);
  // Short URLs depend on which domains are verified, so hold the list until settings are known.
  const pageLoading = loading || !settings;
  const tagColors = useMemo(() => new Map(tags.map((t) => [t.name, t.color])), [tags]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          archived: activeTab === 'archived' ? '1' : '0',
        });
        if (search.trim()) params.set('search', search.trim());
        if (folderFilter && folderFilter !== 'All') params.set('folder', folderFilter);

        const res = await fetch(`/api/links?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.links) setLinks(data.links);
        if (data.counts) setCounts(data.counts);
      } catch (err) {
        console.error('Failed to fetch links:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, search, folderFilter, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  /** The Refresh menu item: reload and show the loading state so the click is visible. */
  const manualRefresh = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  // Global 'C' shortcut to create link
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'c' || e.key === 'C') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isModalOpen &&
        !openMenu &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        setIsModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, openMenu]);

  // Close toolbar dropdowns on outside click / Escape
  const closeToolbarMenu = useCallback(() => setOpenMenu(null), []);
  usePopoverDismiss(openMenu !== null, closeToolbarMenu);

  const visible = useMemo(() => {
    let rows = [...links];
    if (tagFilter) rows = rows.filter((l) => l.tag === tagFilter);
    rows.sort((a, b) => (sortOrder === 'clicks' ? b.clicks - a.clicks : b.created_at - a.created_at));
    return rows;
  }, [links, tagFilter, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = (currentPage - 1) * PAGE_SIZE + paged.length;

  const isEmpty = !pageLoading && counts.active + counts.archived === 0;
  const hasNoResults = !pageLoading && visible.length === 0 && !isEmpty;

  const handleArchiveToggle = async (id: string, currentlyArchived: boolean) => {
    try {
      await fetch(`/api/links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !currentlyArchived }),
      });
      refresh();
    } catch (err) {
      console.error('Archive toggle failed:', err);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await ask({
      title: 'Delete this link?',
      message: 'It stops redirecting immediately and its click history is removed. Archiving keeps it instead.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await fetch(`/api/links/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleDuplicate = async (link: LinkItem) => {
    try {
      await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // A fresh random alias; everything except the password carries over
          // (password hashes never leave the server).
          dest: link.dest,
          domain: link.domain,
          tag: link.tag,
          folder: link.folder,
          comments: link.comments,
          cloak: link.cloak === 1,
          expires_at: link.expires_at,
          expires_url: link.expires_url,
          utm_source: link.utm_source,
          utm_medium: link.utm_medium,
          utm_campaign: link.utm_campaign,
          utm_term: link.utm_term,
          utm_content: link.utm_content,
          utm_referral: link.utm_referral,
          custom_preview: link.custom_preview === 1,
          og_title: link.og_title,
          og_description: link.og_description,
          og_image: link.og_image,
        }),
      });
      refresh();
    } catch (err) {
      console.error('Duplicate failed:', err);
    }
  };

  return (
    <Shell>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <span>Links</span>
          <span className="title-count">{counts.active + counts.archived} total</span>
          <ChevronDown className="page-title-chevron" />
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus />
          <span>Create link</span>
          <kbd>C</kbd>
        </button>
      </div>

      {/* List Tabs */}
      <div className={`list-tabs${isEmpty ? ' is-dim' : ''}`}>
        <button
          className={`list-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('active');
            setPage(1);
          }}
        >
          All Active <span className="list-tab-count">{counts.active}</span>
        </button>
        <button
          className={`list-tab ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('archived');
            setPage(1);
          }}
        >
          Archived <span className="list-tab-count">{counts.archived}</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className={`toolbar${isEmpty ? ' is-dim' : ''}`} ref={toolbarRef}>
        {/* Folder filter */}
        <div className="toolbar-menu" data-popover-root>
          <button
            className="folder-filter"
            disabled={isEmpty}
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
                onClick={() => {
                  setFolderFilter('All');
                  setPage(1);
                  setOpenMenu(null);
                }}
              >
                <FolderIcon width="12" height="12" />
                <span>All folders</span>
              </div>
              {folders.map((f) => (
                <div
                  key={f.id}
                  className={`dropdown-item${folderFilter === f.name ? ' is-current' : ''}`}
                  onClick={() => {
                    setFolderFilter(f.name);
                    setPage(1);
                    setOpenMenu(null);
                  }}
                >
                  <span className={`fs-swatch ${f.color}`} style={{ width: '14px', height: '14px' }}>
                    <FolderIcon width="8" height="8" />
                  </span>
                  <span>{f.name}</span>
                </div>
              ))}
              <div className="dropdown-sep" />
              <Link href="/settings" className="dropdown-item">
                <span>Manage folders…</span>
              </Link>
            </div>
          )}
        </div>

        {/* Filter */}
        <div className="toolbar-menu" data-popover-root>
          <button
            className="btn btn-outline btn-sm"
            disabled={isEmpty}
            onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
          >
            <Filter />
            <span>Filter</span>
            <ChevronDown />
          </button>
          {openMenu === 'filter' && (
            <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0 }}>
              <div
                className={`dropdown-item${tagFilter === null ? ' is-current' : ''}`}
                onClick={() => {
                  setTagFilter(null);
                  setPage(1);
                  setOpenMenu(null);
                }}
              >
                <span>All tags</span>
              </div>
              {tags.map((t) => (
                <div
                  key={t.id}
                  className={`dropdown-item${tagFilter === t.name ? ' is-current' : ''}`}
                  onClick={() => {
                    setTagFilter(t.name);
                    setPage(1);
                    setOpenMenu(null);
                  }}
                >
                  <span className={`tag ${t.color}`}>{t.name}</span>
                </div>
              ))}
              <div className="dropdown-sep" />
              <Link href="/settings" className="dropdown-item">
                <span>Manage tags…</span>
              </Link>
            </div>
          )}
        </div>

        {/* Sort */}
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
                  onClick={() => {
                    setSortOrder(s.id);
                    setPage(1);
                    setOpenMenu(null);
                  }}
                >
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-spacer" />

        {/* Search */}
        <div className="search">
          <Search />
          <input
            placeholder="Search by short link or URL"
            value={search}
            disabled={isEmpty}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="toolbar-menu" data-popover-root>
          <button
            className="icon-btn"
            onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')}
            aria-label="More"
          >
            <More />
          </button>
          {openMenu === 'more' && (
            <div className="dropdown" data-popover data-align="end" style={{ top: 'calc(100% + 4px)', right: 0 }}>
              <div className="dropdown-item" onClick={() => { setOpenMenu(null); manualRefresh(); }}>
                <Refresh />
                <span>Refresh</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Link list / empty states */}
      {pageLoading ? (
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
            <LinkIcon width="24" height="24" />
          </div>
          <h3>No links yet</h3>
          <p>Create your first short link to start sharing and tracking clicks across your channels.</p>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>Create link</span>
            <kbd>C</kbd>
          </button>
        </div>
      ) : hasNoResults ? (
        <div className="empty">
          <div className="empty-icon">
            <LinkIcon width="24" height="24" />
          </div>
          <h3>No links found</h3>
          <p>Try adjusting your search or filters to find what you are looking for.</p>
          <button
            className="btn btn-outline"
            onClick={() => {
              setSearch('');
              setTagFilter(null);
              setFolderFilter('All');
              setPage(1);
            }}
          >
            <span>Clear filters</span>
          </button>
        </div>
      ) : (
        <div className="link-list">
          {paged.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              shortUrl={urlFor(link)}
              tagColor={link.tag ? tagColors.get(link.tag) : undefined}
              onArchiveToggle={handleArchiveToggle}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      )}

      {/* Pagination — the design omits it entirely when there is nothing to page */}
      {!pageLoading && visible.length > 0 && (
        <div className="pagination">
          <div>
            Viewing {rangeStart}–{rangeEnd} of {visible.length} links
          </div>
          <div className="pagination-btns">
            <button
              className="btn btn-outline btn-sm"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-outline btn-sm"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <CreateLinkModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => refresh()}
      />
      {confirmModal}
    </Shell>
  );
}
