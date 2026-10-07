'use client';

import { useEffect } from 'react';

/**
 * One document-level listener for every popover in the app.
 *
 * A component calls `usePopoverDismiss(open, close)` and marks its dropdown
 * panel with `data-popover` and its trigger with `data-popover-root`. Any
 * mousedown outside those (or Escape) closes it — no per-component listeners,
 * and nested panels stay open because the check is ancestor-based.
 */
const closers = new Set<() => void>();
let installed = false;

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener(
    'mousedown',
    (event) => {
      const target = event.target;
      // Clicks inside any menu panel or on its trigger are the menu's own business.
      // (Row menus on the list pages use `.dropdown` + `data-row-menu`, not `data-popover`;
      // closing on their mousedown removed the item before its click could land.)
      if (target instanceof Element && target.closest('[data-popover], [data-popover-root], [data-row-menu], .dropdown')) return;
      if (target instanceof Element && target.closest('.icon-btn')) {
        // let the trigger's own onClick toggle it
        return;
      }
      for (const close of [...closers]) close();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const close of [...closers]) close();
  });
}

export function usePopoverDismiss(active: boolean, onClose: () => void) {
  useEffect(() => {
    install();
    if (!active) return;
    // Only one menu is open at a time: opening this one closes every other.
    for (const close of [...closers]) if (close !== onClose) close();
    closers.add(onClose);
    return () => {
      closers.delete(onClose);
    };
  }, [active, onClose]);
}
