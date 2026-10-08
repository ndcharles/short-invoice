'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { randomAlias } from '@/lib/links/fields';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Edit,
  Globe,
  Info,
  Lock,
  Plus,
  Shuffle,
  TagIcon,
  Wand,
  XIcon,
} from '@/components/icons';
import { OgPreview, OgTabs, OgPlatform } from '@/components/links/og-preview';
import {
  EMPTY_UTM,
  ExpirationPopup,
  LinkPreviewPopup,
  PasswordPopup,
  UtmPopup,
  UtmValues,
} from '@/components/links/link-popups';
import { hasUtm } from '@/lib/links/utm';
import { resolveOg } from '@/lib/og';
import { useOgMetadata } from '@/lib/use-og-metadata';
import { useCollections, useSettings } from '@/lib/collections';
import { useMe } from '@/lib/team';
import { useShortUrls } from '@/lib/use-short-url';
import { DomainPicker } from '@/components/links/domain-picker';
import { ShortUrlHint } from '@/components/links/short-url-hint';
import { expirationFromSetting } from '@/lib/links/defaults';
import { usePopoverDismiss } from '@/lib/popover';
import { Portal } from '@/components/portal';
import { copyText } from '@/lib/clipboard';
import { showToast } from '@/components/toast';

interface CreateLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}


export function CreateLinkModal({ isOpen, onClose, onSuccess }: CreateLinkModalProps) {
  if (!isOpen) return null;
  return <CreateLinkForm onClose={onClose} onSuccess={onSuccess} />;
}

interface CreateLinkFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

type ActivePopup = 'utm' | 'password' | 'expiration' | 'preview' | null;

function CreateLinkForm({ onClose, onSuccess }: CreateLinkFormProps) {
  const [dest, setDest] = useState('');
  const [alias, setAlias] = useState(() => randomAlias());
  const [aliasLocked, setAliasLocked] = useState(true);
  const [domain, setDomain] = useState('4th.link');
  const [tag, setTag] = useState<string | null>(null);
  const [folder, setFolder] = useState('Links');
  const [comments, setComments] = useState('');
  const [cloak, setCloak] = useState(false);
  const [openFolderPicker, setOpenFolderPicker] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const { items: folders } = useCollections('folders');
  const { items: tags, create: createTag } = useCollections('tags');
  const admin = useMe().me?.role === 'admin';
  const settings = useSettings();
  const { urlFor, domains } = useShortUrls(settings);
  const defaultsApplied = useRef(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);

  // Advanced options
  const [utm, setUtm] = useState<UtmValues>(EMPTY_UTM);
  const [password, setPassword] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [expiresUrl, setExpiresUrl] = useState<string | null>(null);
  const [customPreview, setCustomPreview] = useState(false);
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImage, setOgImage] = useState('');

  // Pre-fill from the workspace defaults once settings arrive. Deferred a tick
  // so we never set state synchronously inside the effect.
  useEffect(() => {
    if (!settings || defaultsApplied.current) return;
    defaultsApplied.current = true;
    queueMicrotask(() => {
      if (settings.default_domain) setDomain(settings.default_domain);
      if (settings.default_folder && settings.default_folder !== 'None') setFolder(settings.default_folder);
      if (settings.default_cloak === 'true') setCloak(true);
      const expiry = expirationFromSetting(settings.default_expiration, Date.now());
      if (expiry) setExpiresAt(expiry);
      try {
        const defaults = JSON.parse(settings.default_tags || '[]');
        if (Array.isArray(defaults) && defaults.length > 0) setTag(defaults[0]);
      } catch {
        /* ignore malformed defaults */
      }
    });
  }, [settings]);


  const [previewTab, setPreviewTab] = useState<OgPlatform>('web');
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<'tag' | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Popups own Escape while they are open.
      if (e.key === 'Escape' && !activePopup) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, activePopup]);

  const closePickers = useCallback(() => {
    setOpenPicker(null);
    setOpenFolderPicker(false);
  }, []);
  usePopoverDismiss(openPicker !== null || openFolderPicker, closePickers);

  const randomizeAlias = () => setAlias(randomAlias());

  const suggestAlias = () => {
    if (!dest) {
      setAlias(randomAlias());
      return;
    }
    try {
      const url = new URL(dest.startsWith('http') ? dest : `https://${dest}`);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      if (pathSegments.length > 0) {
        const last = pathSegments[pathSegments.length - 1];
        setAlias(last.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 15));
      } else {
        const hostParts = url.hostname.split('.');
        const name = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
        setAlias(`${name}-${randomAlias().slice(0, 4)}`);
      }
    } catch {
      setAlias(randomAlias());
    }
  };

  const fullShortUrl = urlFor({ domain, alias: alias || 'link' }).url;
  const { remote, loading: ogLoading } = useOgMetadata(dest);
  const preview = resolveOg({
    dest,
    alias,
    remote,
    custom_preview: customPreview ? 1 : 0,
    og_title: ogTitle,
    og_description: ogDescription,
    og_image: ogImage,
  });
  // What the destination says about itself, before any of the owner's own wording (the popup's starting point).
  const destinationPreview = resolveOg({ dest, alias, remote });

  const utmActive = hasUtm(utm);
  const passwordActive = !!password;
  const expirationActive = expiresAt !== null;

  const handleCreate = async () => {
    if (!dest.trim()) {
      setError('Please provide a destination URL');
      return;
    }

    setLoading(true);
    setError(null);

    const created = fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dest,
        alias: alias.trim(),
        domain,
        tag,
        folder,
        comments,
        cloak,
        password,
        expires_at: expiresAt,
        expires_url: expiresUrl,
        ...utm,
        custom_preview: customPreview,
        og_title: ogTitle,
        og_description: ogDescription,
        og_image: ogImage,
      }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create link');
      return data.link as { domain: string; alias: string };
    });
    // Copy the new short link the moment it exists. The copy is started here, inside the click,
    // with a promise for the address, because Safari refuses clipboard writes made after a wait.
    const copied = copyText(created.then((link) => urlFor(link).url));

    try {
      const link = await created;
      onSuccess();
      onClose();
      const label = urlFor(link).label;
      showToast((await copied) ? `Short link copied: ${label}` : `Link created: ${label}`, (await copied) ? 'success' : 'info');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Portal><div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // mousedown (not click) so dismissing a stacked popup cannot
        // bubble into a backdrop click that closes this modal too.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-label="New link">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <span style={{ color: 'var(--muted-foreground)' }}>Links</span>
            <span className="breadcrumb-chev">
              <ChevronRight />
            </span>
            <Globe />
            <span>New link</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <XIcon />
          </button>
        </div>

        {error && (
          <div
            style={{
              margin: '12px 20px 0',
              padding: '8px 12px',
              background: '#fee2e2',
              color: '#991b1b',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
            }}
          >
            {error}
          </div>
        )}

        {/* Body */}
        <div className="modal-body">
          {/* Left column */}
          <div className="modal-left">
            <div className="field">
              <label className="field-label">
                Destination URL
                <span className="field-hint"><Info /></span>
              </label>
              <input
                className="input"
                placeholder="https://4th-entity.com/about-us"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label className="field-label" style={{ flex: 1 }}>
                  Short Link
                  <span className="field-hint"><Info /></span>
                </label>
                <span className="field-action" style={{ display: 'inline-flex', gap: '10px' }}>
                  <span onClick={randomizeAlias} title="Randomize" style={{ cursor: 'pointer', display: 'inline-flex' }}>
                    <Shuffle />
                  </span>
                  <span onClick={suggestAlias} title="Suggest from destination" style={{ cursor: 'pointer', display: 'inline-flex' }}>
                    <Wand />
                  </span>
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
                </span>
              </div>
              <div className="alias-constructor" style={aliasLocked ? { background: 'var(--muted-2)' } : undefined}>
                <DomainPicker value={domain} domains={domains} onChange={setDomain} />
                <input
                  className="alias-input"
                  placeholder="Nk6EwSL"
                  value={alias}
                  disabled={aliasLocked}
                  onChange={(e) => setAlias(e.target.value)}
                  title={aliasLocked ? 'Click the pen to edit' : undefined}
                />
              </div>
              <ShortUrlHint domain={domain} short={urlFor({ domain, alias: alias || 'link' })} />
            </div>

            {/* Tags */}
            <div className="field" ref={pickerRef} style={{ position: 'relative' }}>
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
                  color: tag ? 'var(--foreground)' : 'var(--subtle-foreground)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <TagIcon />
                <span>{tag ?? 'Select tags…'}</span>
              </div>
              {openPicker === 'tag' && (
                <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                  <div
                    className={`dropdown-item${tag === null ? ' is-current' : ''}`}
                    onClick={() => {
                      setTag(null);
                      setOpenPicker(null);
                    }}
                  >
                    <span>No tag</span>
                  </div>
                  {tags.map((t) => (
                    <div
                      key={t.id}
                      className={`dropdown-item${tag === t.name ? ' is-current' : ''}`}
                      onClick={() => {
                        setTag(t.name);
                        setOpenPicker(null);
                      }}
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
                              setTag(item.name);
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

            <div className="field">
              <label className="field-label">
                Comments
                <span className="field-hint"><Info /></span>
              </label>
              <textarea
                className="input"
                placeholder="Add comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </div>

            <div className="field field-row">
              <label className="field-label" style={{ margin: 0 }}>
                Cloak link
                <span className="field-hint"><Info /></span>
              </label>
              <div className={`toggle ${cloak ? 'on' : ''}`} onClick={() => setCloak(!cloak)}>
                <div className="toggle-switch" />
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="modal-right">
            <div ref={folderPickerRef} data-popover-root style={{ position: 'relative' }}>
              <div className="right-panel-title" style={{ marginBottom: '8px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Folder <span className="field-hint"><Info /></span>
                </span>
              </div>
              <div
                className="input"
                onClick={() => setOpenFolderPicker(!openFolderPicker)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              >
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
                <span style={{ flex: 1 }}>{folder}</span>
                <ChevronDown />
              </div>
              {openFolderPicker && (
                <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                  {(folders.length ? folders : [{ id: 'fld_links', name: 'Links', color: 'green' }]).map((f) => (
                    <div
                      key={f.id}
                      className={`dropdown-item${folder === f.name ? ' is-current' : ''}`}
                      onClick={() => {
                        setFolder(f.name);
                        setOpenFolderPicker(false);
                      }}
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
                <button className="icon-btn qr-edit" title="Edit QR" aria-label="Edit QR">
                  <Edit />
                </button>
                <div className="qr">
                  <QRCodeSVG value={fullShortUrl} size={120} level="M" includeMargin={false} />
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
                <div className={`toggle ${customPreview ? 'on' : ''}`} aria-hidden="true">
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
              <OgPreview platform={previewTab} content={preview} site={`${domain}/${alias}`} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="tools-bar">
            <button
              className={`tool-btn ${utmActive ? 'on' : ''}`}
              onClick={() => setActivePopup('utm')}
            >
              <Plus />
              <span>UTM</span>
            </button>
            <button
              className={`tool-btn ${passwordActive ? 'on' : ''}`}
              onClick={() => setActivePopup('password')}
            >
              <Lock />
              <span>Password</span>
            </button>
            <button
              className={`tool-btn ${expirationActive ? 'on' : ''}`}
              onClick={() => setActivePopup('expiration')}
            >
              <Clock />
              <span>Expiration</span>
            </button>
          </div>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            <span>{loading ? 'Saving…' : 'Create link'}</span>
            <kbd>↵</kbd>
          </button>
        </div>
      </div>

      {/* Advanced-option popups */}
      {activePopup === 'utm' && (
        <UtmPopup
          initial={utm}
          baseUrl={dest ? (dest.startsWith('http') ? dest : `https://${dest}`) : ''}
          onClose={() => setActivePopup(null)}
          onSave={(values) => {
            setUtm(values);
            setActivePopup(null);
          }}
        />
      )}
      {activePopup === 'password' && (
        <PasswordPopup
          hasPassword={passwordActive}
          onClose={() => setActivePopup(null)}
          onSave={(value) => {
            setPassword(value);
            setActivePopup(null);
          }}
        />
      )}
      {activePopup === 'expiration' && (
        <ExpirationPopup
          initialExpiresAt={expiresAt}
          initialExpiresUrl={expiresUrl}
          onClose={() => setActivePopup(null)}
          onSave={(at, url) => {
            setExpiresAt(at);
            setExpiresUrl(url);
            setActivePopup(null);
          }}
        />
      )}
      {activePopup === 'preview' && (
        <LinkPreviewPopup
          fallback={destinationPreview}
          initialTitle={ogTitle}
          initialDescription={ogDescription}
          initialImage={ogImage}
          onClose={() => setActivePopup(null)}
          onSave={(values) => {
            setOgTitle(values.og_title);
            setOgDescription(values.og_description);
            setOgImage(values.og_image);
            setCustomPreview(true);
            setActivePopup(null);
          }}
          onReset={() => {
            setOgTitle('');
            setOgDescription('');
            setOgImage('');
            setCustomPreview(false);
          }}
        />
      )}
    </div></Portal>
  );
}
