'use client';

import React from 'react';
import { NOT_CLOAKABLE, type CloakCheck } from '@/lib/links/cloak-check';

/**
 * What the Cloak link switch has to say about the destination, shown under it: that the link cannot be cloaked
 * (and why), that the site is being looked at, or that it could not be looked at. "Cannot be cloaked" shows while
 * cloaking is on (the link is broken as it stands), and after turning it on was refused (it explains why the
 * switch went back); once the person has switched cloaking off themselves there is nothing left to warn about.
 */
export function CloakNote({ cloak, checking, answer, refused }: { cloak: boolean; checking: boolean; answer: CloakCheck | null; refused: boolean }) {
  if (answer?.status === 'blocked' && (cloak || refused)) {
    return (
      <div className="cloak-note is-blocked" role="alert">
        <strong>{NOT_CLOAKABLE}</strong>
        <span>
          {answer.message}
          {cloak ? ' Turn off Cloak link to fix this.' : ''}
        </span>
      </div>
    );
  }
  if (!cloak) return null;
  if (checking) {
    return (
      <div className="cloak-note" role="status">
        Checking that this site can be cloaked…
      </div>
    );
  }
  if (answer?.status === 'unknown') {
    return (
      <div className="cloak-note" role="status">
        We couldn&apos;t check this site. Open the short link to make sure it loads.
      </div>
    );
  }
  return null;
}
