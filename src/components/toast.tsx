'use client';

import React, { useEffect, useState } from 'react';
import { Check } from '@/components/icons';

/**
 * Small confirmations ("Short link copied"). Call `showToast()` from anywhere,
 * including after a dialog has closed; `<ToastHost />` (mounted once, in the
 * app shell) draws them.
 */
interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'info';
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(list: ToastItem[]) => void>();

const publish = () => {
  for (const listener of listeners) listener(items);
};

export function showToast(message: string, tone: ToastItem['tone'] = 'success', milliseconds = 4000) {
  const id = nextId++;
  items = [...items.slice(-2), { id, message, tone }];
  publish();
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    publish();
  }, milliseconds);
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((item) => (
        <div className={`toast toast-${item.tone}`} key={item.id}>
          {item.tone === 'success' && <Check style={{ color: 'var(--accent-green-fg)', flex: 'none' }} />}
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
