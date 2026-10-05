'use client';

import React from 'react';
import { Facebook, Globe, ImageIcon, LinkedIn, XLogo } from '@/components/icons';
import { OgContent } from '@/lib/og';

export type OgPlatform = 'web' | 'x' | 'linkedin' | 'facebook';

export const OG_PLATFORMS: { id: OgPlatform; label: string; icon: React.ReactNode }[] = [
  { id: 'web', label: 'Web', icon: <Globe /> },
  { id: 'x', label: 'X', icon: <XLogo /> },
  { id: 'linkedin', label: 'LinkedIn', icon: <LinkedIn /> },
  { id: 'facebook', label: 'Facebook', icon: <Facebook /> },
];

export function OgTabs({
  value,
  onChange,
}: {
  value: OgPlatform;
  onChange: (platform: OgPlatform) => void;
}) {
  return (
    <div className="og-tabs">
      {OG_PLATFORMS.map((p) => (
        <div
          key={p.id}
          className={`og-tab ${value === p.id ? 'active' : ''}`}
          title={p.label}
          role="button"
          tabIndex={0}
          onClick={() => onChange(p.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onChange(p.id);
          }}
        >
          {p.icon}
        </div>
      ))}
    </div>
  );
}

export function OgPreview({
  platform,
  content,
  site,
}: {
  platform: OgPlatform;
  content: OgContent;
  site: string;
}) {
  return (
    <div className={`og-preview ${platform}${content.image ? '' : ' is-empty'}`}>
      <div className="og-image">
        {content.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.image} alt="" />
        ) : (
          <ImageIcon width="24" height="24" />
        )}
      </div>
      <div className="og-body">
        {platform !== 'web' && <div className="og-site">{content.site || site}</div>}
        <div className="og-title">{content.title}</div>
        <div className="og-desc">{content.description}</div>
      </div>
    </div>
  );
}
