'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronDown, Edit, Globe, Info } from '@/components/icons';
import { buildCampaignUrl, encodedUtmPairs, UtmFields, UtmFormatOptions } from '@/lib/utm-builder';
import { CollectionItem } from '@/lib/collections';
import { usePopoverDismiss } from '@/lib/popover';

interface UtmFormProps {
  fields: UtmFields;
  onChange: (patch: Partial<UtmFields>) => void;
  format: UtmFormatOptions;
  folders: CollectionItem[];
  /** Design uses "Live preview" on create and "Generated URL" on edit. */
  previewLabel: string;
  onFolderClick?: () => void;
}

/**
 * The two-column campaign form + preview rail shared by the create modal and
 * the edit page (design: create-utm.html / edit-utm.html).
 */
export function UtmForm({ fields, onChange, format, folders, previewLabel }: UtmFormProps) {
  const url = buildCampaignUrl(fields, format);
  const pairs = encodedUtmPairs(fields, format);
  const previewUrl = url || 'https://www.example.com';
  const [folderOpen, setFolderOpen] = React.useState(false);
  usePopoverDismiss(folderOpen, React.useCallback(() => setFolderOpen(false), []));

  return (
    <div className="utm-layout">
      <div className="utm-form-col">
        <div className="utm-form-grid">
          <div className="field wide">
            <label className="field-label">
              Website URL <span className="required-mark">*</span>
              <span className="field-hint"><Info /></span>
            </label>
            <input
              className="input"
              value={fields.website}
              placeholder="https://www.example.com"
              onChange={(e) => onChange({ website: e.target.value })}
            />
            <div className="field-help">
              The full website URL (e.g. <code>https://www.example.com</code>)
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Campaign source <span className="required-mark">*</span>
            </label>
            <input
              className="input"
              value={fields.source}
              onChange={(e) => onChange({ source: e.target.value })}
            />
            <div className="field-help">
              The referrer (e.g. <code>google</code>, <code>newsletter</code>)
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Campaign medium <span className="required-mark">*</span>
            </label>
            <input
              className="input"
              value={fields.medium}
              onChange={(e) => onChange({ medium: e.target.value })}
            />
            <div className="field-help">
              Marketing medium (e.g. <code>cpc</code>, <code>banner</code>, <code>email</code>)
            </div>
          </div>

          <div className="field">
            <label className="field-label">Campaign name</label>
            <input
              className="input"
              value={fields.campaign}
              onChange={(e) => onChange({ campaign: e.target.value })}
            />
            <div className="field-help">Product, promo code, or slogan.</div>
          </div>

          <div className="field">
            <label className="field-label">Campaign ID</label>
            <input
              className="input"
              placeholder="abc_123"
              value={fields.campaign_id}
              onChange={(e) => onChange({ campaign_id: e.target.value })}
            />
            <div className="field-help">The ads campaign ID.</div>
          </div>

          <div className="field">
            <label className="field-label">Campaign term</label>
            <input
              className="input"
              value={fields.term}
              onChange={(e) => onChange({ term: e.target.value })}
            />
            <div className="field-help">Identify the paid keywords.</div>
          </div>

          <div className="field">
            <label className="field-label">Campaign content</label>
            <input
              className="input"
              value={fields.content}
              onChange={(e) => onChange({ content: e.target.value })}
            />
            <div className="field-help">Use to differentiate ads.</div>
          </div>

          <div className="field wide">
            <label className="field-label">
              Comments <span className="field-hint"><Info /></span>
            </label>
            <textarea
              className="input"
              placeholder="Internal note — who this campaign is for, where it runs, expected volume…"
              value={fields.comments}
              onChange={(e) => onChange({ comments: e.target.value })}
            />
            <div className="field-help">Internal only. Not appended to the URL.</div>
          </div>
        </div>
      </div>

      <div className="utm-preview-col">
        <div className="folder-block">
          <div className="folder-label">
            <span>Folder</span>
            <span className="field-hint"><Info /></span>
          </div>
          <div data-popover-root style={{ position: 'relative' }}>
            <div className="folder-select" onClick={() => setFolderOpen(!folderOpen)}>
              <span className={`folder-swatch ${folders.find((f) => f.name === fields.folder)?.color ?? 'green'}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span className="folder-name">{fields.folder}</span>
              <span className="folder-chev"><ChevronDown /></span>
            </div>
            {folderOpen && (
              <div className="dropdown" data-popover style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
                {(folders.length ? folders : [{ id: 'fld_campaigns', name: 'Campaigns', color: 'green' }]).map((f) => (
                  <div
                    key={f.id}
                    className={`dropdown-item${fields.folder === f.name ? ' is-current' : ''}`}
                    onClick={() => {
                      onChange({ folder: f.name });
                      setFolderOpen(false);
                    }}
                  >
                    <span className={`folder-swatch ${f.color}`} style={{ width: '14px', height: '14px' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </span>
                    <span>{f.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="qr-block">
          <div className="qr-block-label">
            <span>QR Code</span>
            <span className="field-hint"><Info /></span>
          </div>
          <div className="qr-block-inner">
            <div className="qr-thumb">
              <QRCodeSVG value={previewUrl} size={64} level="L" includeMargin={false} />
            </div>
            <div className="qr-actions">
              <span>Auto-generated from the URL below.</span>
              <a href="#" onClick={(e) => e.preventDefault()}>
                <Edit /> Customize
              </a>
            </div>
          </div>
        </div>

        <div className="preview-label">
          <span>{previewLabel}</span>
          <span className="preview-length">{previewUrl.length} chars</span>
        </div>
        <div className="preview-card">
          <span className="base">{url ? (fields.website.trim() || 'https://www.example.com') : 'https://www.example.com'}</span>
          {pairs.length > 0 && (
            <>
              <span className="sep">?</span>
              {pairs.map((pair, i) => (
                <span key={pair.key}>
                  {i > 0 && <span className="sep">&amp;</span>}
                  <span className="param-key">{pair.key}</span>
                  <span className="sep">=</span>
                  <span className="param-val">{pair.value}</span>
                </span>
              ))}
            </>
          )}
        </div>
        <div className="preview-hint">
          <Globe width="11" height="11" />{' '}
          {url ? 'Share this URL to attribute traffic to this campaign.' : 'Add a website URL to build the campaign link.'}
        </div>
      </div>
    </div>
  );
}
