'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const pathname = usePathname();
  // Settings gets more room for its own sub-nav by shrinking the main menu to icons.
  const collapsed = pathname.startsWith('/settings');

  return (
    <div className={`app${collapsed ? ' app-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} />
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}
