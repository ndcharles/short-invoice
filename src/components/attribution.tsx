'use client';

import React from 'react';
import { relativeTime, useTeam } from '@/lib/team';

/** "Created by Ada · 3 Oct · edited by Tunde 2 h ago" for links, UTMs and invoices. */
export function Attribution({
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
  fallbackInitials,
  className = 'creator-note',
}: {
  createdBy?: string | null;
  createdAt: number;
  updatedBy?: string | null;
  updatedAt?: number;
  fallbackInitials?: string;
  className?: string;
}) {
  const { nameOf, initialsOf } = useTeam();
  const created = new Date(createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  // Only mention an edit made after creation (saving straight away is not news).
  const edited = !!updatedBy && !!updatedAt && updatedAt - createdAt > 60_000;
  return (
    <div className={`${className} attribution`}>
      <div className="avatar" style={{ width: '20px', height: '20px', fontSize: '10px' }}>
        {createdBy ? initialsOf(createdBy) : fallbackInitials}
      </div>
      <span>
        {createdBy ? (
          <>
            Created by <strong>{nameOf(createdBy)}</strong> · {created}
          </>
        ) : (
          <>Created {created}</>
        )}
        {edited && (
          <>
            {' '}
            · edited by <strong>{nameOf(updatedBy)}</strong> {relativeTime(updatedAt)}
          </>
        )}
      </span>
    </div>
  );
}
