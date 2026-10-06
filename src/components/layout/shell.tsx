'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { useMe } from '@/lib/team';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const pathname = usePathname();
  const { denied } = useMe();
  // Settings gets more room for its own sub-nav by shrinking the main menu to icons.
  const collapsed = pathname.startsWith('/settings');

  // Signed in with Cloudflare Access, but not (or no longer) part of this workspace.
  if (denied) {
    return (
      <div className="access-denied">
        <div className="access-denied-card">
          <h1>{denied.code === 'signed_out' ? 'Please sign in' : 'No access to this workspace'}</h1>
          <p>{denied.error}</p>
          <a className="btn btn-outline" href="/cdn-cgi/access/logout">
            Sign in with a different email
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`app${collapsed ? ' app-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} />
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}
