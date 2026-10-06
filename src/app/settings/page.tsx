'use client';

import React, { useRef, useState } from 'react';
import { Shell } from '@/components/layout/shell';
import { SaveBar, SettingsCard, SettingsLayout, SettingsRow, SettingSeg } from '@/components/settings/settings-ui';
import { FoldersCard, TagsCard } from '@/components/settings/collections-cards';
import { Download, Upload } from '@/components/icons';
import { useSettingsForm } from '@/lib/settings-form';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate } from '@/lib/dates';
import { readImageFile } from '@/lib/image-file';

export default function GeneralSettingsPage() {
  const { draft, set, dirty, saving, error, savedAt, save, discard } = useSettingsForm();
  const [fileError, setFileError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const workspaceInitial = (draft?.workspace_name || 'W').trim().charAt(0).toUpperCase();

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `short-invoice-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Shell>
      <SettingsLayout title="General" subtitle="Workspace details, folders and tags. Your own name is under your profile (bottom left).">
        {!draft ? (
          <div className="settings-card">
            <div className="settings-card-body" style={{ color: 'var(--muted-foreground)' }}>
              {error ?? 'Loading settings…'}
            </div>
          </div>
        ) : (
          <>
            {(error || fileError) && (
              <div className="settings-card">
                <div className="settings-card-body" style={{ color: 'var(--destructive)' }}>{error ?? fileError}</div>
              </div>
            )}

            <SettingsCard title="Workspace" subtitle="Shown in the sidebar.">
              <SettingsRow label="Workspace name">
                <input
                  className="input"
                  maxLength={60}
                  value={draft.workspace_name ?? ''}
                  onChange={(e) => set('workspace_name', e.target.value)}
                />
              </SettingsRow>

              <SettingsRow label="Workspace logo" help="Square PNG, JPEG, WebP or SVG, under 300 KB.">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    className="workspace-avatar"
                    style={{ width: '48px', height: '48px', fontSize: '18px', borderRadius: '8px', overflow: 'hidden' }}
                  >
                    {draft.workspace_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.workspace_logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      workspaceInitial
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      readImageFile(
                        file,
                        (url) => {
                          setFileError(null);
                          set('workspace_logo', url);
                        },
                        setFileError
                      );
                    }}
                  />
                  <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
                    <Upload />
                    <span>Upload logo</span>
                  </button>
                  {draft.workspace_logo && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--muted-foreground)' }}
                      onClick={() => set('workspace_logo', '')}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </SettingsRow>

              <SettingsRow label="Date format" help="Used on invoices, receipts and lists.">
                <SettingSeg
                  value={draft.date_format || DEFAULT_DATE_FORMAT}
                  options={[...DATE_FORMATS]}
                  onChange={(v) => set('date_format', v)}
                  render={(format) => formatDate(Date.UTC(2026, 2, 19), format)}
                />
              </SettingsRow>
            </SettingsCard>

            <FoldersCard />
            <TagsCard />

            <SettingsCard
              title="Access & data"
              subtitle="Sign-in is handled by Cloudflare Access in front of this app, so there are no passwords to manage here."
            >
              <SettingsRow
                label="Export everything"
                help="Download all links, campaigns, invoices, folders, tags and settings as one JSON file."
              >
                <button className="btn btn-outline btn-sm" onClick={exportData} disabled={exporting}>
                  <Download />
                  <span>{exporting ? 'Preparing…' : 'Download JSON'}</span>
                </button>
              </SettingsRow>
            </SettingsCard>
          </>
        )}
      </SettingsLayout>

      <SaveBar
        visible={dirty}
        saving={saving}
        message={savedAt && !dirty ? 'Saved!' : 'You have unsaved changes'}
        onDiscard={discard}
        onSave={save}
      />
    </Shell>
  );
}
