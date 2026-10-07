'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/layout/shell';
import { Attribution } from '@/components/attribution';
import { useConfirm, useNotice } from '@/components/invoices/choice-modal';
import { useMe } from '@/lib/team';
import { UtmForm } from '@/components/utms/utm-form';
import type { UtmCampaign } from '@/lib/types';
import { Archive, ChevronDown, ChevronRight, Copy, Cursor, Duplicate, Info, More, Trash } from '@/components/icons';
import { useCollections, useSettings } from '@/lib/collections';
import { useShortUrls } from '@/lib/use-short-url';
import { copyText } from '@/lib/clipboard';
import { showToast } from '@/components/toast';
import {
  buildCampaignUrl,
  formatOptionsFromSettings,
  UtmFields,
  validateUtmFields,
} from '@/lib/utm-builder';

// Edit pages take the id as `?id=` because a static export cannot
// prerender a dynamic `[id]` segment for ids that do not exist yet.
export default function EditUtmPage() {
  return (
    <Suspense>
      <EditUtmPageInner />
    </Suspense>
  );
}

function EditUtmPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [ask, confirmModal] = useConfirm();
  const [notify, noticeModal] = useNotice();
  const admin = useMe().me?.role === 'admin';
  const id = searchParams.get('id') ?? '';

  const settings = useSettings();
  const { urlFor } = useShortUrls(settings);
  const format = useMemo(() => formatOptionsFromSettings(settings), [settings]);
  const { items: folders } = useCollections('folders');

  const [campaign, setCampaign] = useState<UtmCampaign | null>(null);
  const [baseline, setBaseline] = useState<UtmFields | null>(null);
  const [fields, setFields] = useState<UtmFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/utms/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = await res.json();
        if (cancelled || !data.campaign) return;
        const c = data.campaign as UtmCampaign;
        const loaded: UtmFields = {
          website: c.website,
          source: c.source ?? '',
          medium: c.medium ?? '',
          campaign: c.campaign ?? '',
          campaign_id: c.campaign_id ?? '',
          term: c.term ?? '',
          content: c.content ?? '',
          comments: c.comments ?? '',
          folder: c.folder,
        };
        setCampaign(c);
        setBaseline(loaded);
        setFields(loaded);
      } catch (err) {
        console.error('Failed to load campaign:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dirty = useMemo(
    () => !!baseline && !!fields && JSON.stringify(baseline) !== JSON.stringify(fields),
    [baseline, fields]
  );

  const url = fields ? buildCampaignUrl(fields, format) : '';

  const [shortening, setShortening] = useState(false);
  /** Campaign URLs are not tracked by themselves; a short link in front of one is. */
  const shorten = async () => {
    if (!url || dirty) {
      if (dirty) await notify('Save first', 'Save the campaign before creating a short link for it.');
      return;
    }
    setShortening(true);
    const created = fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dest: url, comments: `UTM campaign: ${fields?.campaign || fields?.campaign_id || url}` }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the short link');
      return data.link as { id: string; domain: string; alias: string };
    });
    // Copy the new short link as soon as it exists (started inside the click, so Safari allows it).
    const copied = copyText(created.then((link) => urlFor(link).url));
    try {
      const link = await created;
      showToast((await copied) ? `Short link copied: ${urlFor(link).label}` : `Short link created: ${urlFor(link).label}`, (await copied) ? 'success' : 'info');
      router.push(`/links/edit?id=${encodeURIComponent(link.id)}`);
    } catch (err) {
      await notify('Could not create the short link', err instanceof Error ? err.message : 'Please try again.');
      setShortening(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!fields || !campaign) return;
    const validation = validateUtmFields(fields);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/utms/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save campaign');
      setCampaign(data.campaign);
      setBaseline(fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save campaign');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!campaign) return;
    await fetch(`/api/utms/${campaign.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: campaign.archived !== 1 }),
    });
    router.push('/utms');
  };

  const handleDelete = async () => {
    if (!campaign) return;
    const ok = await ask({ title: 'Delete this UTM?', message: 'The tracked URL record is removed. Archiving keeps it instead.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    await fetch(`/api/utms/${campaign.id}`, { method: 'DELETE' });
    router.push('/utms');
  };

  const handleDuplicate = async () => {
    if (!campaign || !fields) return;
    await fetch('/api/utms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, campaign: fields.campaign ? `${fields.campaign}_copy` : null }),
    });
    router.push('/utms');
  };

  if (loading) {
    return (
      <Shell>
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading campaign…</div>
      </Shell>
    );
  }

  if (notFound || !campaign || !fields) {
    return (
      <Shell>
        <div className="empty">
          <div className="empty-icon">
            <Info width="24" height="24" />
          </div>
          <h3>Campaign not found</h3>
          <p>This campaign may have been deleted.</p>
          <button className="btn btn-primary" onClick={() => router.push('/utms')}>
            Back to UTM Builder
          </button>
        </div>
      </Shell>
    );
  }

  const label = fields.campaign || fields.campaign_id || '(no campaign)';

  return (
    <Shell>
      {confirmModal}
      {noticeModal}
      <div className="crumb-bar">
        <div className="crumbs">
          <Link href="/utms">UTM Builder</Link>
          <ChevronRight />
          <span className="current">
            <span className="favicon utm-favicon" style={{ width: '20px', height: '20px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16" />
                <path d="M4 12h10" />
                <path d="M4 18h16" />
                <circle cx="18" cy="12" r="2" />
              </svg>
            </span>
            {label}
            <ChevronDown />
          </span>
          {dirty && <span className="draft-saved" style={{ marginLeft: 0 }}>Unsaved changes</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            className="btn btn-outline btn-sm"
            title="Create a short link for this campaign URL so clicks are counted"
            disabled={!url || shortening}
            onClick={shorten}
          >
            <Cursor />
            <span>{shortening ? 'Creating…' : 'Shorten & track'}</span>
          </button>
          <button className="btn btn-outline btn-sm" onClick={copyUrl}>
            <Copy />
            <span>{copied ? 'Copied' : 'Copy URL'}</span>
          </button>
          <div className="toolbar-menu">
            <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="More">
              <More />
            </button>
            {menuOpen && (
              <div className="dropdown" style={{ top: 'calc(100% + 4px)', right: 0 }}>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); copyUrl(); }}>
                  <Copy />
                  <span>Copy URL</span>
                </div>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); handleDuplicate(); }}>
                  <Duplicate />
                  <span>Duplicate</span>
                </div>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); handleArchive(); }}>
                  <Archive />
                  <span>{campaign.archived === 1 ? 'Unarchive' : 'Archive'}</span>
                </div>
                {admin && (
                  <>
                    <div className="dropdown-sep" />
                    <div className="dropdown-item destructive" onClick={() => { setMenuOpen(false); handleDelete(); }}>
                      <Trash />
                      <span>Delete</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="utm-edit-body">
        <UtmForm
          fields={fields}
          onChange={(patch) => setFields((prev) => (prev ? { ...prev, ...patch } : prev))}
          format={format}
          folders={folders}
          previewLabel="Generated URL"
        />

        <Attribution
          className="creator-note-inline"
          createdBy={campaign.created_by}
          createdAt={campaign.created_at}
          updatedBy={campaign.updated_by}
          updatedAt={campaign.updated_at}
          fallbackInitials={campaign.avatar}
        />
      </div>

      <div className={`save-bar ${dirty ? 'visible' : ''}`}>
        <span className="save-bar-dot" />
        <span>{error ?? (saving ? 'Saving…' : 'Unsaved changes')}</span>
        <button className="btn btn-outline" onClick={() => { if (baseline) setFields(baseline); setError(null); }} disabled={saving}>
          Discard
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Shell>
  );
}
