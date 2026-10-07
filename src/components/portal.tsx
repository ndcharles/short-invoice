'use client';

import { createPortal } from 'react-dom';

/**
 * Renders dialogs at the top level of the page. Inside the sidebar or any other
 * layered container, a dialog's dimming and blur only cover that container and
 * the rest of the page stays bright. Dialogs only mount after a click, so there
 * is nothing to hydrate on the server.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
