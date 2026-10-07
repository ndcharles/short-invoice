'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { useMe } from '@/lib/team';
import { ToastHost } from '@/components/toast';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const pathname = usePathname();
  const { denied } = useMe();
  // Settings gets more room for its own sub-nav by shrinking the main menu to icons.
  const collapsed = pathname.startsWith('/settings');

  // Signed out: useMe() is already sending the browser to /login; show nothing meanwhile.
  if (denied) return <div className="access-denied" aria-busy="true" />;

  return (
    <div className={`app${collapsed ? ' app-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} />
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
      <ToastHost />
    </div>
  );
}
