'use client';

import React from 'react';

/** Explains where a link really works while its domain is not verified yet. */
export function ShortUrlHint({ domain, short }: { domain: string; short: { url: string; label: string; live: boolean } }) {
  if (short.url.startsWith(`https://${domain}/`)) return null;
  return (
    <div className="field-help" style={{ marginTop: 4 }}>
      {short.live ? (
        <>
          Works at <strong>{short.label}</strong> until {domain} is attached and verified in Settings → URL Shortener.
        </>
      ) : (
        <>
          {domain} is not verified yet, so this link will not open until it is (Settings → URL Shortener).
        </>
      )}
    </div>
  );
}
