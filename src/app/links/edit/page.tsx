'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Shell } from '@/components/layout/shell';
import { Attribution } from '@/components/attribution';
import { useConfirm } from '@/components/invoices/choice-modal';
import { useMe } from '@/lib/team';
import type { LinkItem } from '@/lib/types';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Cursor,
  Duplicate,
  Edit,
  Info,
  Lock,
  More,
  Plus,
  TagIcon,
  Trash,
} from '@/components/icons';
import { OgPreview, OgTabs, OgPlatform } from '@/components/links/og-preview';
import {
  ExpirationPopup,
  LinkPreviewPopup,
  PasswordPopup,
  UtmPopup,
  UtmValues,
} from '@/components/links/link-popups';
import { hasUtm, pickUtm } from '@/lib/links/utm';
import { useCollections, useSettings } from '@/lib/collections';
import { useShortUrls } from '@/lib/use-short-url';
import { DomainPicker } from '@/components/links/domain-picker';
import { ShortUrlHint } from '@/components/links/short-url-hint';
import { usePopoverDismiss } from '@/lib/popover';
import { resolveOg } from '@/lib/og';
import { useOgMetadata } from '@/lib/use-og-metadata';
import { useCloakCheck } from '@/lib/use-cloak-check';
import { CloakNote } from '@/components/links/cloak-note';


type ActivePopup = 'utm' | 'password' | 'expiration' | 'preview' | null;

interface LinkDraft {
  dest: string;
  domain: string;
  alias: string;
  folder: string;
  tag: string | null;
  comments: string;
  cloak: boolean;
  utm: UtmValues;
  expiresAt: number | null;
  expiresUrl: string | null;
  customPreview: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
}

function draftFromLink(link: LinkItem): LinkDraft {
  const utm = pickUtm(link);
  return {
    dest: link.dest,
    domain: link.domain,
    alias: link.alias,
    folder: link.folder,
    tag: link.tag,
    comments: link.comments || '',
    cloak: link.cloak === 1,
    utm: {
      utm_source: utm.utm_source ?? '',
      utm_medium: utm.utm_medium ?? '',
      utm_campaign: utm.utm_campaign ?? '',
      utm_term: utm.utm_term ?? '',
      utm_content: utm.utm_content ?? '',
      utm_referral: utm.utm_referral ?? '',
    },
    expiresAt: link.expires_at,
    expiresUrl: link.expires_url,
    customPreview: link.custom_preview === 1,
    ogTitle: link.og_title ?? '',
    ogDescription: link.og_description ?? '',
    ogImage: link.og_image ?? '',
  };
}

// Edit pages take the id as `?id=` because a static export cannot
// prerender a dynamic `[id]` segment for ids that do not exist yet.
export default function EditLinkPage() {
  return (
    <Suspense>
      <EditLinkPageInner />
    </Suspense>
  );
}

function EditLinkPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [ask, confirmModal] = useConfirm();
  const admin = useMe().me?.role === 'admin';
  const id = searchParams.get('id') ?? '';

  const [link, setLink] = useState<LinkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [baseline, setBaseline] = useState<LinkDraft | null>(null);
  const [draft, setDraft] = useState<LinkDraft | null>(null);

  // Passwords are write-only: we never read the stored hash back.
  const [pendingPassword, setPendingPassword] = useState<string | null>(null);
  const [passwordCleared, setPasswordCleared] = useState(false);

  const [aliasLocked, setAliasLocked] = useState(true);
  const [previewTab, setPreviewTab] = useState<OgPlatform>('web');
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  const [openPicker, setOpenPicker] = useState<'tag' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Declared before the loading guards so hook order stays stable.
  // What the destination says about itself: the copy the server keeps, while the address is still the saved
  // one (instant, and it works even for sites that turn our lookups away); otherwise a live look at the address
  // that was just typed.
  const stored = link?.preview && draft && draft.dest.trim() === link.dest.trim() ? link.preview : null;
  const { remote: liveRemote, loading: liveLoading } = useOgMetadata(stored ? '' : draft?.dest ?? '');
  const remote = stored ?? liveRemote;
  const ogLoading = !stored && liveLoading;
  const { items: folders } = useCollections('folders');
  const { items: tags, create: createTag } = useCollections('tags');
  const settings = useSettings();
  const { urlFor, domains } = useShortUrls(settings);
  // Whether the destination can be shown in a cloaked link. Checked on its own while cloaking is on, so a link
  // that is already cloaked (and would show a blank page) is flagged as soon as it opens.
  const { answer: cloakAnswer, checking: cloakChecking, check: checkCloak } = useCloakCheck(draft?.dest ?? '', draft?.domain ?? '', !!draft?.cloak);
  // The address (trimmed) that cloaking was last refused for, so the note can explain why the switch went back.
  const [cloakRefusedFor, setCloakRefusedFor] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const folderPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/links/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = await res.json();
        if (cancelled || !data.link) return;
        const loaded = data.link as LinkItem;
        const initial = draftFromLink(loaded);
        setLink(loaded);
        setBaseline(initial);
        setDraft(initial);
      } catch (err) {
        console.error('Failed to load link:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dirty = useMemo(() => {
    if (!baseline || !draft) return false;
    if (pendingPassword !== null || passwordCleared) return true;
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [baseline, draft, pendingPassword, passwordCleared]);

  const patch = useCallback((partial: Partial<LinkDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  // Turning cloaking on asks whether the site allows it. If it does not, the switch goes back off and the note
  // under it says "This link cannot be cloaked" (unless the person has already changed the address meanwhile).
  const toggleCloak = () => {
    if (!draft) return;
    setCloakRefusedFor(null);
    if (draft.cloak) {
      patch({ cloak: false });
      return;
    }
    const asked = draft.dest.trim();
    patch({ cloak: true });
    void checkCloak(asked, draft.domain).then((answer) => {
      if (answer.status !== 'blocked') return;
      setDraft((prev) => (prev && prev.cloak && prev.dest.trim() === asked ? { ...prev, cloak: false } : prev));
      setCloakRefusedFor(asked);
    });
  };

  const closePickers = useCallback(() => {
    setOpenPicker(null);
    setMenuOpen(false);
    setFolderPickerOpen(false);
  }, []);
  usePopoverDismiss(openPicker !== null || menuOpen || folderPickerOpen, closePickers);

  const handleSave = async () => {
    if (!draft || !link) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        dest: draft.dest,
        domain: draft.domain,
        alias: draft.alias,
        folder: draft.folder,
        tag: draft.tag,
        comments: draft.comments,
        cloak: draft.cloak,
        expires_at: draft.expiresAt,
        expires_url: draft.expiresUrl,
        custom_preview: draft.customPreview,
        og_title: draft.ogTitle,
        og_description: draft.ogDescription,
        og_image: draft.ogImage,
        ...draft.utm,
      };
      if (passwordCleared) body.password = null;
      else if (pendingPassword !== null) body.password = pendingPassword;

      const res = await fetch(`/api/links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save changes');

      const updated = data.link as LinkItem;
      const nextDraft = draftFromLink(updated);
      setLink(updated);
      setBaseline(nextDraft);
      setDraft(nextDraft);
      setPendingPassword(null);
      setPasswordCleared(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!baseline) return;
    setDraft(baseline);
    setPendingPassword(null);
    setPasswordCleared(false);
    setSaveError(null);
  };

  if (loading || !settings) {
    return (
      <Shell>
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--muted-foreground)' }}>Loading link…</div>
      </Shell>
    );
  }

  if (notFound || !link || !draft) {
    return (
      <Shell>
        <div className="empty">
          <div className="empty-icon">
            <Info width="24" height="24" />
          </div>
          <h3>Link not found</h3>
          <p>This short link may have been deleted.</p>
          <button className="btn btn-primary" onClick={() => router.push('/links')}>
            Back to links
          </button>
        </div>
      </Shell>
    );
  }

  const short = urlFor({ domain: draft.domain, alias: draft.alias });
  const fullUrl = short.url;
  const shorthand = short.label;

  const preview = resolveOg({
    dest: draft.dest,
    alias: draft.alias,
    remote,
    custom_preview: draft.customPreview ? 1 : 0,
    og_title: draft.ogTitle,
    og_description: draft.ogDescription,
    og_image: draft.ogImage,
  });
  // What the destination says about itself, before any of the owner's own wording (the popup's starting point).
  const destinationPreview = resolveOg({ dest: draft.dest, alias: draft.alias, remote });

  const copyFullUrl = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDuplicate = async () => {
    const res = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // A fresh random alias; the password does not carry over.
        dest: draft.dest,
        domain: draft.domain,
        tag: draft.tag,
        folder: draft.folder,
        comments: draft.comments,
        cloak: draft.cloak,
        expires_at: draft.expiresAt,
        expires_url: draft.expiresUrl,
        custom_preview: draft.customPreview,
        og_title: draft.ogTitle,
        og_description: draft.ogDescription,
        og_image: draft.ogImage,
        ...draft.utm,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveError(data.error || 'Could not duplicate the link');
      return;
    }
    router.push(`/links/edit?id=${encodeURIComponent(data.link.id)}`);
  };

  const handleArchive = async () => {
    await fetch(`/api/links/${link.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: link.archived !== 1 }),
    });
    router.push('/links');
  };

  const handleDelete = async () => {
    const ok = await ask({
      title: 'Delete this link?',
      message: 'It stops redirecting immediately and its click history is removed. Archiving keeps it instead.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/links/${link.id}`, { method: 'DELETE' });
    router.push('/links');
  };

  const utmActive = hasUtm(draft.utm);
  const passwordActive = !!link.has_password || pendingPassword !== null;

  return (
    <Shell>
      {confirmModal}
      {/* Crumb bar */}
      <div className="crumb-bar">
        <div className="crumbs">
          <Link href="/links">Links</Link>
          <ChevronRight />
          <span className="current">
            <span className="favicon google" style={{ width: '20px', height: '20px' }}>
              <svg viewBox="0 0 24 24" width="12" height="12">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            </span>
            {shorthand}
            <ChevronDown />
          </span>
          {dirty && (
            <span className="draft-saved" style={{ marginLeft: 0 }}>
              Unsaved changes
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="click-stat-large">
            <Cursor />
            <strong>{link.clicks.toLocaleString()}</strong>{' '}
            <span style={{ color: 'var(--muted-foreground)' }}>clicks</span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={copyFullUrl}>
            <Copy />
            <span>{copied ? 'Copied' : 'Copy link'}</span>
          </button>
          <div className="toolbar-menu" data-popover-root ref={menuRef}>
            <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="More">
              <More />
            </button>
            {menuOpen && (
              <div className="dropdown" data-popover data-align="end" style={{ top: 'calc(100% + 4px)', right: 0 }}>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); copyFullUrl(); }}>
                  <Copy />
                  <span>Copy URL</span>
                </div>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); handleDuplicate(); }}>
                  <Duplicate />
                  <span>Duplicate</span>
                </div>
                <div className="dropdown-item" onClick={() => { setMenuOpen(false); handleArchive(); }}>
                  <Archive />
                  <span>{link.archived === 1 ? 'Unarchive' : 'Archive'}</span>
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

      <div className="edit-page-body">
        {/* Left column */}
        <div className="modal-left">
          <div className="field">
            <label className="field-label">
              Destination URL
              <span className="field-hint"><Info /></span>
            </label>
            <input className="input" value={draft.dest} onChange={(e) => patch({ dest: e.target.value })} />
          </div>

          <div className="field" style={{ marginTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label className="field-label" style={{ flex: 1 }}>
                Short Link
                <span className="field-hint"><Info /></span>
              </label>
              <span className="field-action" style={{ display: 'inline-flex', gap: '10px' }}>
                <span
                  onClick={() => setAliasLocked(!aliasLocked)}
                  title={aliasLocked ? 'Edit short link' : 'Lock short link'}
                  style={{
                    cursor: 'pointer',
                    display: 'inline-flex',
                    color: aliasLocked ? 'var(--muted-foreground)' : 'var(--foreground)',
                  }}
                >
                  <Edit />
                </span>
                <span title="Copy" onClick={copyFullUrl} style={{ cursor: 'pointer', display: 'inline-flex' }}>
                  <Copy />
                </span>
              </span>
            </div>
            <div className="alias-constructor" style={aliasLocked ? { background: 'var(--muted-2)' } : undefined}>
              <DomainPicker value={draft.domain} domains={domains} onChange={(domain) => patch({ domain })} />
              <input
                className="alias-input"
                value={draft.alias}
                disabled={aliasLocked}
                onChange={(e) => patch({ alias: e.target.value })}
                title={aliasLocked ? 'Click the pen to edit' : undefined}
              />
            </div>
            <ShortUrlHint domain={draft.domain} short={short} />
          </div>

          <div className="field" ref={pickerRef} data-popover-root style={{ marginTop: '14px', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <label className="field-label" style={{ flex: 1 }}>
                Tags
                <span className="field-hint"><Info /></span>
              </label>
              <span className="field-action" onClick={() => setOpenPicker(openPicker ? null : 'tag')}>
                Manage
              </span>
            </div>
            <div
              className="input"
              onClick={() => setOpenPicker(openPicker ? null : 'tag')}
              style={{
                color: draft.tag ? 'var(--foreground)' : 'var(--subtle-foreground)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <TagIcon />
              <span>{draft.tag ?? 'Select tags…'}</span>
            </div>
            {openPicker === 'tag' && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                <div className={`dropdown-item${draft.tag === null ? ' is-current' : ''}`} onClick={() => { patch({ tag: null }); setOpenPicker(null); }}>
                  <span>No tag</span>
                </div>
                {tags.map((t) => (
                  <div
                    key={t.id}
                    className={`dropdown-item${draft.tag === t.name ? ' is-current' : ''}`}
                    onClick={() => { patch({ tag: t.name }); setOpenPicker(null); }}
                  >
                    <span className={`tag ${t.color}`}>{t.name}</span>
                  </div>
                ))}
                <div className="dropdown-sep" />
                {!admin ? (
                  <div className="dropdown-note">Only admins can add tags</div>
                ) : creatingTag ? (
                  <div className="dropdown-item" style={{ padding: 0 }}>
                    <input
                      className="input"
                      autoFocus
                      placeholder="New tag name"
                      value={newTagName}
                      style={{ margin: '2px' }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') {
                          setCreatingTag(false);
                          setNewTagName('');
                        }
                        if (e.key === 'Enter' && newTagName.trim()) {
                          try {
                            const item = await createTag(newTagName.trim(), 'blue');
                            patch({ tag: item.name });
                            setCreatingTag(false);
                            setNewTagName('');
                            setOpenPicker(null);
                          } catch {
                            /* duplicate names are ignored here */
                          }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); setCreatingTag(true); }}>
                    <span>＋ Create tag</span>
                  </div>
                )}
                {admin && (
                  <Link href="/settings" className="dropdown-item">
                    <span>Manage tags…</span>
                  </Link>
                )}
              </div>
            )}
          </div>

          <div className="field" style={{ marginTop: '14px' }}>
            <label className="field-label">
              Comments
              <span className="field-hint"><Info /></span>
            </label>
            <textarea
              className="input"
              placeholder="Add comments"
              value={draft.comments}
              onChange={(e) => patch({ comments: e.target.value })}
            />
          </div>

          <div className="field field-row" style={{ marginTop: '14px' }}>
            <label className="field-label" style={{ margin: 0 }} title="Visitors see the short URL in the address bar while the destination loads in a frame">
              Cloak link
              <span className="field-hint"><Info /></span>
            </label>
            <div
              className={`toggle ${draft.cloak ? 'on' : ''}`}
              role="switch"
              aria-checked={draft.cloak}
              aria-label="Cloak link"
              tabIndex={0}
              onClick={toggleCloak}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleCloak();
                }
              }}
            >
              <div className="toggle-switch" />
            </div>
          </div>
          <CloakNote cloak={draft.cloak} checking={cloakChecking} answer={cloakAnswer} refused={cloakRefusedFor === draft.dest.trim()} />

          <div className="tools-bar" style={{ marginTop: '16px' }}>
            <button className={`tool-btn ${utmActive ? 'on' : ''}`} onClick={() => setActivePopup('utm')}>
              <Plus />
              <span>UTM</span>
            </button>
            <button className={`tool-btn ${passwordActive ? 'on' : ''}`} onClick={() => setActivePopup('password')}>
              <Lock />
              <span>Password</span>
            </button>
            <button className={`tool-btn ${draft.expiresAt !== null ? 'on' : ''}`} onClick={() => setActivePopup('expiration')}>
              <Clock />
              <span>Expiration</span>
            </button>
          </div>

          {draft.expiresAt !== null && (
            <div className="popup-hint" style={{ marginTop: '8px' }}>
              Expires {new Date(draft.expiresAt).toLocaleString()}
              {draft.expiresUrl ? ` · then redirects to ${draft.expiresUrl}` : ''}
            </div>
          )}

          <Attribution
            createdBy={link.created_by}
            createdAt={link.created_at}
            updatedBy={link.updated_by}
            updatedAt={link.updated_at}
            fallbackInitials={link.avatar}
          />
        </div>

        {/* Right column */}
        <div className="modal-right">
          <div ref={folderPickerRef} data-popover-root style={{ position: 'relative' }}>
            <div className="right-panel-title" style={{ marginBottom: '8px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Folder <span className="field-hint"><Info /></span>
              </span>
            </div>
            <div className="input" onClick={() => setFolderPickerOpen(!folderPickerOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'white' }}>
              <span
                style={{
                  width: '16px',
                  height: '16px',
                  background: 'var(--accent-green)',
                  borderRadius: '3px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-green-fg)',
                  flexShrink: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span style={{ flex: 1 }}>{draft.folder}</span>
              <ChevronDown />
            </div>
            {folderPickerOpen && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                {(folders.length ? folders : [{ id: 'fld_links', name: 'Links', color: 'green' }]).map((f) => (
                  <div
                    key={f.id}
                    className={`dropdown-item${draft.folder === f.name ? ' is-current' : ''}`}
                    onClick={() => { patch({ folder: f.name }); setFolderPickerOpen(false); }}
                  >
                    <span className={`fs-swatch ${f.color}`} style={{ width: '14px', height: '14px' }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
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

          <div>
            <div className="right-panel-title" style={{ marginBottom: '8px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                QR Code <span className="field-hint"><Info /></span>
              </span>
            </div>
            <div className="qr-card">
              <button className="icon-btn qr-edit" title="Edit QR">
                <Edit />
              </button>
              <div className="qr">
                <QRCodeSVG value={fullUrl} size={120} level="M" includeMargin={false} />
              </div>
            </div>
          </div>

          <div>
            <div
              className="custom-preview-row"
              onClick={() => setActivePopup('preview')}
              title="Customise the preview image, title and description"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                Custom Link Preview <span className="field-hint"><Info /></span>
              </span>
              <div className={`toggle ${draft.customPreview ? 'on' : ''}`} aria-hidden="true">
                <div className="toggle-switch" />
              </div>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <OgTabs value={previewTab} onChange={setPreviewTab} />
            </div>
            {ogLoading && (
              <div className="popup-hint" style={{ marginBottom: '6px' }}>
                Fetching preview…
              </div>
            )}
            <OgPreview platform={previewTab} content={preview} site={shorthand} />
          </div>
        </div>
      </div>

      {/* Floating save / discard bar */}
      <div className={`save-bar ${dirty ? 'visible' : ''}`}>
        <span className="save-bar-dot" />
        <span>{saveError ? saveError : 'Unsaved changes'}</span>
        <button className="btn btn-outline" onClick={handleDiscard} disabled={saving}>
          Discard
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Advanced-option popups */}
      {activePopup === 'utm' && (
        <UtmPopup
          initial={draft.utm}
          baseUrl={draft.dest ? (draft.dest.startsWith('http') ? draft.dest : `https://${draft.dest}`) : ''}
          onClose={() => setActivePopup(null)}
          onSave={(values) => {
            patch({ utm: values });
            setActivePopup(null);
          }}
        />
      )}
      {activePopup === 'password' && (
        <PasswordPopup
          hasPassword={passwordActive}
          onClose={() => setActivePopup(null)}
          onSave={(value) => {
            if (value === null) {
              setPendingPassword(null);
              setPasswordCleared(true);
            } else {
              setPendingPassword(value);
              setPasswordCleared(false);
            }
            setActivePopup(null);
          }}
        />
      )}
      {activePopup === 'expiration' && (
        <ExpirationPopup
          initialExpiresAt={draft.expiresAt}
          initialExpiresUrl={draft.expiresUrl}
          onClose={() => setActivePopup(null)}
          onSave={(at, url) => {
            patch({ expiresAt: at, expiresUrl: url });
            setActivePopup(null);
          }}
        />
      )}
      {activePopup === 'preview' && (
        <LinkPreviewPopup
          fallback={destinationPreview}
          initialTitle={draft.ogTitle}
          initialDescription={draft.ogDescription}
          initialImage={draft.ogImage}
          onClose={() => setActivePopup(null)}
          onSave={(values) => {
            patch({
              ogTitle: values.og_title,
              ogDescription: values.og_description,
              ogImage: values.og_image,
              customPreview: true,
            });
            setActivePopup(null);
          }}
          onReset={() => {
            patch({ ogTitle: '', ogDescription: '', ogImage: '', customPreview: false });
          }}
        />
      )}
    </Shell>
  );
}
