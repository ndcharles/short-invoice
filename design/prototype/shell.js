// Shared shell renderer — sidebar + main wrapper
// Usage: <div id="app" data-nav="links"></div>
//        <script src="shell.js"></script>
//        <script>renderShell({activeNav:'links', activeSub:'links', children:`...html...`})</script>

const SUB_ICONS = {
  links:             `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  analytics:         `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  invoices:          `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`,
  'invoice-analytics': `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
};

const NAV_ITEMS = [
  { id: 'links', label: 'URL Shortener', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`, sub: [
    { id: 'links',     label: 'Links',     href: 'links.html',     icon: SUB_ICONS.links },
    { id: 'analytics', label: 'Analytics', href: 'analytics.html', icon: SUB_ICONS.analytics },
  ]},
  { id: 'utm', label: 'UTM Builder', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h16"/><circle cx="18" cy="12" r="2"/></svg>`, href: 'utms.html' },
  { id: 'invoice', label: 'Invoice Generator', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`, href: 'invoices.html', sub: [
    { id: 'invoices',          label: 'Invoices',  href: 'invoices.html',          icon: SUB_ICONS.invoices },
    { id: 'invoice-analytics', label: 'Analytics', href: 'invoice-analytics.html', icon: SUB_ICONS['invoice-analytics'] },
  ]},
  { id: 'settings', label: 'Settings', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`, href: 'settings.html' },
];

function renderShell({ activeNav = 'links', activeSub = 'links', children = '', modal = '' } = {}) {
  const navHtml = NAV_ITEMS.map(item => {
    const isActive = item.id === activeNav;
    const sub = item.sub && isActive
      ? `<div class="nav-sub">${item.sub.map(s => `<a class="nav-item ${s.id === activeSub ? 'active' : ''}" href="${s.href}">${s.icon || ''}<span>${s.label}</span></a>`).join('')}</div>`
      : '';
    const href = item.href || (item.id === 'links' ? 'links.html' : '#');
    return `<a class="nav-item ${isActive ? 'active' : ''}" href="${href}">${item.icon}<span>${item.label}</span></a>${sub}`;
  }).join('');

  const shell = `
    <div class="app">
      <aside class="sidebar">
        <div class="workspace">
          <div class="workspace-avatar">A</div>
          <div class="workspace-name">Acme Inc.</div>
          <svg class="workspace-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
        </div>

        <div class="nav-section-label">Workspace</div>
        ${navHtml}

        <div class="sidebar-footer">
          <div class="user-row">
            <div class="avatar">NC</div>
            <div class="user-meta">
              <div class="user-name">ndcharles</div>
              <div class="user-email">nd@acme.co</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--muted-foreground)"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </div>
        </div>
      </aside>

      <main class="main">
        <div class="main-inner">
          ${children}
        </div>
      </main>
    </div>
    ${modal}
  `;

  document.getElementById('app').innerHTML = shell;
}

// --- Reusable snippets ---

const ICONS = {
  plus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  filter: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  display: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
  sort: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h5"/><path d="m18 9 3-3-3-3"/><path d="M21 6h-9"/><path d="m18 15 3 3-3 3"/><path d="M12 18h9"/></svg>`,
  search: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  chevronDown: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  chevronRight: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  copy: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  more: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,
  cursor: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  externalLink: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 8-8"/><path d="M15 3h6v6"/><path d="M21 3l-8 8"/></svg>`,
  x: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  shuffle: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  wand: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2m0 14v-2M8 9h2M20 9h2M17.8 11.8 19 13m-1.2-8.2L19 4M2 22l14-14m-3.6-2.4L11 4"/></svg>`,
  info: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  edit: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  image: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  globe: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  xLogo: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  linkedin: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  facebook: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  utm: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20"/></svg>`,
  lock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  clock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  chevronLeft: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  archive: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  duplicate: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
  link: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  invoice: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`,
  drag: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
  download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  reset: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  send: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  qr: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <rect width="100" height="100" fill="white"/>
    <!-- Position squares -->
    <rect x="4" y="4" width="24" height="24" fill="black"/>
    <rect x="8" y="8" width="16" height="16" fill="white"/>
    <rect x="12" y="12" width="8" height="8" fill="black"/>
    <rect x="72" y="4" width="24" height="24" fill="black"/>
    <rect x="76" y="8" width="16" height="16" fill="white"/>
    <rect x="80" y="12" width="8" height="8" fill="black"/>
    <rect x="4" y="72" width="24" height="24" fill="black"/>
    <rect x="8" y="76" width="16" height="16" fill="white"/>
    <rect x="12" y="80" width="8" height="8" fill="black"/>
    <!-- Random modules -->
    <g fill="black">
      <rect x="32" y="4" width="4" height="4"/><rect x="40" y="4" width="4" height="4"/><rect x="52" y="4" width="4" height="4"/><rect x="60" y="4" width="4" height="4"/>
      <rect x="32" y="12" width="4" height="4"/><rect x="44" y="12" width="4" height="4"/><rect x="56" y="12" width="4" height="4"/><rect x="64" y="12" width="4" height="4"/>
      <rect x="36" y="16" width="4" height="4"/><rect x="48" y="16" width="4" height="4"/><rect x="60" y="16" width="4" height="4"/>
      <rect x="32" y="20" width="4" height="4"/><rect x="40" y="20" width="4" height="4"/><rect x="52" y="20" width="4" height="4"/>
      <rect x="36" y="24" width="4" height="4"/><rect x="44" y="24" width="4" height="4"/><rect x="56" y="24" width="4" height="4"/><rect x="64" y="24" width="4" height="4"/>
      <rect x="4" y="32" width="4" height="4"/><rect x="12" y="32" width="4" height="4"/><rect x="20" y="32" width="4" height="4"/><rect x="28" y="32" width="4" height="4"/><rect x="36" y="32" width="4" height="4"/><rect x="48" y="32" width="4" height="4"/><rect x="60" y="32" width="4" height="4"/><rect x="72" y="32" width="4" height="4"/><rect x="80" y="32" width="4" height="4"/><rect x="88" y="32" width="4" height="4"/><rect x="92" y="32" width="4" height="4"/>
      <rect x="8" y="36" width="4" height="4"/><rect x="16" y="36" width="4" height="4"/><rect x="32" y="36" width="4" height="4"/><rect x="44" y="36" width="4" height="4"/><rect x="52" y="36" width="4" height="4"/><rect x="64" y="36" width="4" height="4"/><rect x="76" y="36" width="4" height="4"/><rect x="84" y="36" width="4" height="4"/>
      <rect x="4" y="40" width="4" height="4"/><rect x="20" y="40" width="4" height="4"/><rect x="28" y="40" width="4" height="4"/><rect x="40" y="40" width="4" height="4"/><rect x="56" y="40" width="4" height="4"/><rect x="72" y="40" width="4" height="4"/><rect x="88" y="40" width="4" height="4"/>
      <rect x="12" y="44" width="4" height="4"/><rect x="24" y="44" width="4" height="4"/><rect x="36" y="44" width="4" height="4"/><rect x="48" y="44" width="4" height="4"/><rect x="60" y="44" width="4" height="4"/><rect x="68" y="44" width="4" height="4"/><rect x="80" y="44" width="4" height="4"/><rect x="92" y="44" width="4" height="4"/>
      <rect x="4" y="48" width="4" height="4"/><rect x="16" y="48" width="4" height="4"/><rect x="32" y="48" width="4" height="4"/><rect x="44" y="48" width="4" height="4"/><rect x="52" y="48" width="4" height="4"/><rect x="64" y="48" width="4" height="4"/><rect x="76" y="48" width="4" height="4"/><rect x="88" y="48" width="4" height="4"/>
      <rect x="8" y="52" width="4" height="4"/><rect x="20" y="52" width="4" height="4"/><rect x="28" y="52" width="4" height="4"/><rect x="40" y="52" width="4" height="4"/><rect x="48" y="52" width="4" height="4"/><rect x="60" y="52" width="4" height="4"/><rect x="72" y="52" width="4" height="4"/><rect x="84" y="52" width="4" height="4"/><rect x="92" y="52" width="4" height="4"/>
      <rect x="4" y="56" width="4" height="4"/><rect x="16" y="56" width="4" height="4"/><rect x="24" y="56" width="4" height="4"/><rect x="32" y="56" width="4" height="4"/><rect x="44" y="56" width="4" height="4"/><rect x="56" y="56" width="4" height="4"/><rect x="68" y="56" width="4" height="4"/><rect x="80" y="56" width="4" height="4"/>
      <rect x="12" y="60" width="4" height="4"/><rect x="20" y="60" width="4" height="4"/><rect x="36" y="60" width="4" height="4"/><rect x="48" y="60" width="4" height="4"/><rect x="60" y="60" width="4" height="4"/><rect x="72" y="60" width="4" height="4"/><rect x="84" y="60" width="4" height="4"/><rect x="92" y="60" width="4" height="4"/>
      <rect x="4" y="64" width="4" height="4"/><rect x="24" y="64" width="4" height="4"/><rect x="40" y="64" width="4" height="4"/><rect x="52" y="64" width="4" height="4"/><rect x="64" y="64" width="4" height="4"/><rect x="76" y="64" width="4" height="4"/><rect x="88" y="64" width="4" height="4"/>
      <rect x="32" y="68" width="4" height="4"/><rect x="40" y="68" width="4" height="4"/><rect x="52" y="68" width="4" height="4"/><rect x="60" y="68" width="4" height="4"/><rect x="68" y="68" width="4" height="4"/><rect x="80" y="68" width="4" height="4"/>
      <rect x="32" y="72" width="4" height="4"/><rect x="44" y="72" width="4" height="4"/><rect x="56" y="72" width="4" height="4"/><rect x="60" y="72" width="4" height="4"/>
      <rect x="36" y="76" width="4" height="4"/><rect x="48" y="76" width="4" height="4"/><rect x="52" y="76" width="4" height="4"/><rect x="64" y="76" width="4" height="4"/>
      <rect x="32" y="80" width="4" height="4"/><rect x="40" y="80" width="4" height="4"/><rect x="56" y="80" width="4" height="4"/><rect x="60" y="80" width="4" height="4"/><rect x="72" y="80" width="4" height="4"/><rect x="80" y="80" width="4" height="4"/><rect x="88" y="80" width="4" height="4"/>
      <rect x="36" y="84" width="4" height="4"/><rect x="44" y="84" width="4" height="4"/><rect x="52" y="84" width="4" height="4"/><rect x="64" y="84" width="4" height="4"/><rect x="76" y="84" width="4" height="4"/><rect x="84" y="84" width="4" height="4"/><rect x="92" y="84" width="4" height="4"/>
      <rect x="32" y="88" width="4" height="4"/><rect x="40" y="88" width="4" height="4"/><rect x="48" y="88" width="4" height="4"/><rect x="56" y="88" width="4" height="4"/><rect x="72" y="88" width="4" height="4"/><rect x="80" y="88" width="4" height="4"/><rect x="88" y="88" width="4" height="4"/>
      <rect x="36" y="92" width="4" height="4"/><rect x="44" y="92" width="4" height="4"/><rect x="52" y="92" width="4" height="4"/><rect x="60" y="92" width="4" height="4"/><rect x="68" y="92" width="4" height="4"/><rect x="80" y="92" width="4" height="4"/><rect x="92" y="92" width="4" height="4"/>
    </g>
  </svg>`,
};

// Sample link data
const SAMPLE_LINKS = [
  { favicon: 'google', alias: '4th.link/fa-curriculum', dest: 'example.com/docs/curriculum', avatar: 'NC', tag: null, clicks: 0, date: 'Aug 14' },
  { favicon: 'google', alias: '4th.link/nkechi', dest: 'example.com/forms/signup', avatar: 'NC', tag: null, clicks: 174, date: 'Jan 8' },
  { favicon: 'google', alias: '4th.link/SBD2025feedback', dest: 'example.com/forms/feedback', avatar: 'NC', tag: null, clicks: 40, date: 'Dec 5, 2025' },
  { favicon: 'google', alias: '4th.link/thatbros', dest: 'example.com/docs/proposal', avatar: 'NC', tag: 'Client', clicks: 2, date: 'Dec 2, 2025' },
  { favicon: 'dot-green', alias: '4th.link/seunbd-ama', dest: 'example.com/forms/ama', avatar: 'NC', tag: null, clicks: 28, date: 'Sep 22, 2025' },
  { favicon: 'slack', alias: '4th.link/2103', dest: 'example.com/events/2103', avatar: 'NC', tag: 'Client', clicks: 130, date: 'Mar 7, 2025' },
  { favicon: 'discord', alias: '4th.link/dc-launch', dest: 'example.com/community/launch', avatar: 'NC', tag: 'Campaign', clicks: 892, date: 'Feb 18, 2025' },
  { favicon: 'google', alias: '4th.link/hr-onboard', dest: 'example.com/docs/onboarding', avatar: 'JD', tag: 'Internal', clicks: 47, date: 'Jan 30, 2025' },
];

function renderLinkCard(link, idx) {
  const tagClass = link.tag === 'Client' ? 'yellow' : link.tag === 'Campaign' ? 'blue' : link.tag === 'Internal' ? 'green' : '';
  const tagHtml = link.tag ? `<span class="tag ${tagClass}">${link.tag}</span>` : `<span></span>`;
  const faviconInner = link.favicon === 'google'
    ? `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`
    : link.favicon === 'slack'
    ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.527 2.527 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.522-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.522 2.522v6.312zm-2.521 10.122a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.522-2.522v-2.522h2.522zm0-1.268a2.527 2.527 0 0 1-2.522-2.521 2.527 2.527 0 0 1 2.522-2.522h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.522h-6.313z"/></svg>`
    : link.favicon === 'discord'
    ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`
    : link.favicon === 'dot-green'
    ? ''
    : '';

  return `
    <a class="link-card" href="edit-link.html" onclick="if(event.target.closest('.no-nav')){event.preventDefault();}" data-idx="${idx}">
      <div class="favicon ${link.favicon}">${faviconInner}</div>
      <div class="link-info">
        <div class="link-alias-row">
          <span class="link-alias">${link.alias}</span>
          <span class="link-alias-copy no-nav" onclick="event.preventDefault();event.stopPropagation();">${ICONS.copy}</span>
        </div>
        <div class="link-dest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17l10-10M17 17V7H7"/></svg>
          <span class="link-dest-url">${link.dest}</span>
          <span class="link-dest-meta">
            <span class="creator-avatar" title="${link.avatar}">${link.avatar}</span>
            <span class="link-date">${link.date}</span>
          </span>
        </div>
      </div>
      <div class="link-meta-right">
        ${tagHtml}
        <div class="click-pill">${ICONS.cursor}<span>${link.clicks.toLocaleString()} clicks</span></div>
      </div>
      <button class="icon-btn no-nav" onclick="event.preventDefault();event.stopPropagation();toggleActionMenu(${idx}, event);" aria-label="More">${ICONS.more}</button>
    </a>
  `;
}

// Reusable folder filter for list toolbars
function renderFolderFilter(name = 'Links', swatch = 'green') {
  return `
    <button class="folder-filter">
      <span class="fs-swatch ${swatch}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </span>
      <span>${name}</span>
      <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  `;
}

function renderLinkList() {
  return `<div class="link-list">${SAMPLE_LINKS.map(renderLinkCard).join('')}</div>`;
}

function renderPagination() {
  return `
    <div class="pagination">
      <div>Viewing 1–${SAMPLE_LINKS.length} of ${SAMPLE_LINKS.length} links</div>
      <div class="pagination-btns">
        <button class="btn btn-outline btn-sm" disabled>Previous</button>
        <button class="btn btn-outline btn-sm">Next</button>
      </div>
    </div>
  `;
}

// ---------- UTM Builder ----------

const SAMPLE_UTMS = [
  { website: 'https://4th.link', source: 'sleekbio', medium: 'profile', campaign: 'footer', content: 'forster', term: '', avatar: 'NC', clicks: 412, date: 'Aug 14' },
  { website: 'https://acme.co/pricing', source: 'newsletter', medium: 'email', campaign: 'q3_launch', content: 'header_cta', term: '', avatar: 'NC', clicks: 289, date: 'Aug 12' },
  { website: 'https://acme.co', source: 'google', medium: 'cpc', campaign: 'brand_search', content: 'ad_var_a', term: 'acme software', avatar: 'JD', clicks: 1024, date: 'Aug 09' },
  { website: 'https://acme.co/blog/intro', source: 'linkedin', medium: 'social', campaign: 'thought_leadership', content: 'post_1', term: '', avatar: 'NC', clicks: 176, date: 'Aug 01' },
  { website: 'https://acme.co/webinar', source: 'x', medium: 'social', campaign: 'sept_webinar', content: 'tweet_thread', term: '', avatar: 'JD', clicks: 58, date: 'Jul 24' },
  { website: 'https://acme.co/demo', source: 'partner', medium: 'referral', campaign: 'partner_pilot', content: 'sidebar_banner', term: '', avatar: 'NC', clicks: 34, date: 'Jul 14' },
];

// Build generated URL from a UTM record
function buildUtmUrl(u) {
  if (!u || !u.website) return '';
  const params = [];
  if (u.source)   params.push(`utm_source=${encodeURIComponent(u.source)}`);
  if (u.medium)   params.push(`utm_medium=${encodeURIComponent(u.medium)}`);
  if (u.campaign) params.push(`utm_campaign=${encodeURIComponent(u.campaign)}`);
  if (u.term)     params.push(`utm_term=${encodeURIComponent(u.term)}`);
  if (u.content)  params.push(`utm_content=${encodeURIComponent(u.content)}`);
  return u.website + (params.length ? '?' + params.join('&') : '');
}

function renderUtmCard(u, idx) {
  const fullUrl = buildUtmUrl(u);
  const websitePretty = (u.website || '').replace(/^https?:\/\//, '');
  return `
    <a class="link-card utm-card" href="edit-utm.html" onclick="if(event.target.closest('.no-nav')){event.preventDefault();}" data-idx="${idx}">
      <div class="favicon utm-favicon">${ICONS.utm}</div>
      <div class="link-info">
        <div class="link-alias-row">
          <span class="link-alias">${websitePretty}</span>
          <span class="link-alias-copy no-nav" title="Copy final URL" onclick="event.preventDefault();event.stopPropagation();navigator.clipboard&&navigator.clipboard.writeText('${fullUrl.replace(/'/g,"\\'")}');">${ICONS.copy}</span>
        </div>
        <div class="link-dest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17l10-10M17 17V7H7"/></svg>
          <span class="link-dest-url">${fullUrl}</span>
          <span class="link-dest-meta">
            <span class="creator-avatar" title="${u.avatar}">${u.avatar}</span>
            <span class="link-date">${u.date}</span>
          </span>
        </div>
      </div>
      <div class="link-meta-right utm-params">
        <span class="utm-pill utm-src" title="Source">${u.source || '—'}</span>
        <span class="utm-pill utm-med" title="Medium">${u.medium || '—'}</span>
        <span class="utm-pill utm-cnt" title="Content">${u.content || '—'}</span>
      </div>
      <button class="icon-btn no-nav" onclick="event.preventDefault();event.stopPropagation();toggleActionMenu(${idx}, event);" aria-label="More">${ICONS.more}</button>
    </a>
  `;
}

function renderUtmList() {
  return `<div class="link-list">${SAMPLE_UTMS.map(renderUtmCard).join('')}</div>`;
}

function renderUtmPagination() {
  return `
    <div class="pagination">
      <div>Viewing 1–${SAMPLE_UTMS.length} of ${SAMPLE_UTMS.length} campaigns</div>
      <div class="pagination-btns">
        <button class="btn btn-outline btn-sm" disabled>Previous</button>
        <button class="btn btn-outline btn-sm">Next</button>
      </div>
    </div>
  `;
}


// ---------- Invoice Generator ----------

// Supported currencies. Default = NGN (Naira). More can be added via Settings.
const CURRENCIES = {
  NGN: { code: 'NGN', symbol: '₦', label: 'NGN (₦)' },
  USD: { code: 'USD', symbol: '$', label: 'USD ($)' },
  EUR: { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  GBP: { code: 'GBP', symbol: '£', label: 'GBP (£)' },
};
const DEFAULT_CURRENCY = 'NGN';

function fmtMoney(amount, currency = DEFAULT_CURRENCY) {
  const c = CURRENCIES[currency] || CURRENCIES.NGN;
  const n = Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c.symbol + n;
}

// Single source of truth for invoice totals. Used by both the canvas and
// the right rail so they never disagree.
const INVOICE_TAX_RATE = 0.075;
function computeTotals(inv) {
  const payments = (inv && inv.payments) || [];
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  let items, subtotal, salesTax, grand;

  if (inv && Array.isArray(inv.items) && inv.items.length) {
    // Real line items → sum them, tax on top.
    items = inv.items;
    subtotal = items.reduce((s, i) => s + (Number(i.qty) * Number(i.unitPrice)), 0);
    salesTax = subtotal * INVOICE_TAX_RATE;
    grand    = subtotal + salesTax;
  } else if (inv && Number.isFinite(inv.total)) {
    // Stored total → back-solve one synthetic "Services" line so the canvas
    // renders SOMETHING plausible while every downstream calculation matches
    // the authored grand total.
    grand    = Number(inv.total);
    subtotal = grand / (1 + INVOICE_TAX_RATE);
    salesTax = grand - subtotal;
    items    = [{ name: 'Services rendered', desc: 'Item description (optional)', qty: 1, unitPrice: subtotal, taxPct: 0 }];
  } else {
    // Fresh draft (create-invoice modal) → default demo lines.
    items = [
      { name: 'Item name', desc: 'Item description (optional)', qty: 1, unitPrice: 200,  taxPct: 8 },
      { name: 'New item',  desc: 'Item description (optional)', qty: 1, unitPrice: 5000, taxPct: 8 },
    ];
    subtotal = items.reduce((s, i) => s + (Number(i.qty) * Number(i.unitPrice)), 0);
    salesTax = subtotal * INVOICE_TAX_RATE;
    grand    = subtotal + salesTax;
  }

  const outstanding = Math.max(0, grand - paid);
  return { items, subtotal, salesTax, grand, payments, paid, outstanding };
}

// Convert a number to English words (integer + minor units), for invoice display.
function moneyInWords(amount, currency = DEFAULT_CURRENCY) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
                'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function under1000(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? '-' + ones[n%10] : '');
    return ones[Math.floor(n/100)] + ' hundred' + (n%100 ? ' and ' + under1000(n%100) : '');
  }
  function toWords(n) {
    if (n === 0) return 'zero';
    const scales = [['trillion', 1e12], ['billion', 1e9], ['million', 1e6], ['thousand', 1e3]];
    let parts = [];
    for (const [name, val] of scales) {
      if (n >= val) {
        const chunk = Math.floor(n / val);
        parts.push(under1000(chunk) + ' ' + name);
        n = n % val;
      }
    }
    if (n > 0) parts.push(under1000(n));
    return parts.join(' ');
  }
  const currencyNames = { NGN: ['naira', 'kobo'], USD: ['dollars', 'cents'], EUR: ['euros', 'cents'], GBP: ['pounds', 'pence'] };
  const [major, minor] = currencyNames[currency] || currencyNames.NGN;
  const amt = Number(amount || 0);
  const intPart = Math.floor(amt);
  const fracPart = Math.round((amt - intPart) * 100);
  let result = toWords(intPart) + ' ' + major;
  if (fracPart > 0) result += ' and ' + toWords(fracPart) + ' ' + minor;
  return result.charAt(0).toUpperCase() + result.slice(1) + ' only.';
}

const SAMPLE_INVOICES = [
  { number: 'INV-435430', client: 'Meridian Ventures',   issued: 'Sep 12, 2026', due: 'Oct 12, 2026', total: 3200.00,   currency: 'USD', status: 'draft',          avatar: 'NC', payments: [] },
  { number: 'INV-435424', client: 'Opendiari',           issued: 'Mar 19, 2026', due: 'Apr 16, 2026', total: 5590.00,   currency: 'NGN', status: 'sent',         avatar: 'NC', payments: [] },
  { number: 'INV-435418', client: 'Shecluded',           issued: 'Mar 04, 2026', due: 'Apr 03, 2026', total: 1250000.00,currency: 'NGN', status: 'paid',           avatar: 'NC', payments: [
    { amount: 1250000.00, date: 'Apr 02, 2026', method: 'Bank transfer', note: 'Ref: GTB-8842910' }
  ]},
  { number: 'INV-435402', client: 'Payflow Labs',        issued: 'Feb 22, 2026', due: 'Mar 24, 2026', total: 4200.00,   currency: 'USD', status: 'partially-paid', avatar: 'JD', payments: [
    { amount: 2000.00, date: 'Mar 14, 2026', method: 'Wire transfer', note: '50% deposit' },
    { amount: 600.00,  date: 'Apr 03, 2026', method: 'Paystack',      note: '' }
  ]},
  { number: 'INV-435389', client: 'Kite Studios',        issued: 'Feb 14, 2026', due: 'Mar 15, 2026', total: 890.00,    currency: 'EUR', status: 'paid',           avatar: 'JD', payments: [
    { amount: 890.00, date: 'Mar 12, 2026', method: 'Card', note: '' }
  ]},
  { number: 'INV-435341', client: 'Northwind Retail',    issued: 'Jan 30, 2026', due: 'Feb 28, 2026', total: 12750.00,  currency: 'USD', status: 'overdue',        avatar: 'NC', payments: [] },
  { number: 'INV-435297', client: 'Acme Foundries',      issued: 'Jan 12, 2026', due: 'Feb 10, 2026', total: 680000.00, currency: 'NGN', status: 'cancelled',      avatar: 'NC', payments: [] },
  { number: 'INV-435241', client: 'Brightline Media',    issued: 'Dec 20, 2025', due: 'Jan 20, 2026', total: 2360.00,   currency: 'GBP', status: 'paid',           avatar: 'JD', payments: [
    { amount: 2360.00, date: 'Jan 18, 2026', method: 'Bank transfer', note: '' }
  ]},
  { number: 'INV-435188', client: 'Sable & Co.',         issued: 'Dec 04, 2025', due: 'Jan 05, 2026', total: 15400.00,  currency: 'USD', status: 'overdue',        avatar: 'NC', payments: [] },
];

function invoiceStatusPill(status) {
  const map = {
    'draft':          { label: 'Draft',          cls: 'inv-status-draft' },
    'sent':           { label: 'Sent',           cls: 'inv-status-sent' },
    'overdue':        { label: 'Overdue',        cls: 'inv-status-overdue' },
    'partially-paid': { label: 'Partially paid', cls: 'inv-status-partial' },
    'paid':           { label: 'Paid',           cls: 'inv-status-paid' },
    'cancelled':      { label: 'Cancelled',      cls: 'inv-status-cancelled' },
  };
  const m = map[status] || map['draft'];
  return `<span class="inv-status ${m.cls}"><span class="inv-status-dot"></span>${m.label}</span>`;
}

function countByStatus(status) {
  if (status === 'all') return SAMPLE_INVOICES.length;
  return SAMPLE_INVOICES.filter(i => i.status === status).length;
}

function renderInvoiceCard(inv, idx) {
  const derived = computeTotals(inv).grand;
  return `
    <a class="link-card inv-card" href="edit-invoice.html" onclick="if(event.target.closest('.no-nav')){event.preventDefault();}" data-idx="${idx}">
      <div class="favicon inv-favicon">${ICONS.invoice || ICONS.copy}</div>
      <div class="link-info">
        <div class="link-alias-row">
          <span class="link-alias">${inv.number}</span>
          <span class="link-alias-copy no-nav" onclick="event.preventDefault();event.stopPropagation();">${ICONS.copy}</span>
        </div>
        <div class="link-dest">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>
          <span class="link-dest-url">${inv.client}</span>
          <span class="link-dest-meta">
            <span class="creator-avatar" title="${inv.avatar}">${inv.avatar}</span>
            <span class="link-date">Issued ${inv.issued}</span>
            <span class="inv-due-sep">·</span>
            <span class="link-date">Due ${inv.due}</span>
          </span>
        </div>
      </div>
      <div class="link-meta-right">
        ${invoiceStatusPill(inv.status)}
        <div class="inv-amount">${fmtMoney(derived, inv.currency)}</div>
      </div>
      <button class="icon-btn no-nav" onclick="event.preventDefault();event.stopPropagation();toggleActionMenu(${idx}, event);" aria-label="More">${ICONS.more}</button>
    </a>
  `;
}

function renderInvoiceList(status = 'all') {
  const rows = status === 'all' ? SAMPLE_INVOICES : SAMPLE_INVOICES.filter(i => i.status === status);
  return `<div class="link-list">${rows.map(renderInvoiceCard).join('')}</div>`;
}

// Auto-grow helper for description textareas (fallback for browsers
// that don't yet support CSS `field-sizing: content`).
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
// Run once on load for every invoice-item textarea.
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.inv-item-name, .inv-item-desc').forEach(autoGrow);
  });
  // Re-run after every shell render (invoice pages call renderShell then paint)
  const _mo = new MutationObserver(() => {
    document.querySelectorAll('.inv-item-name, .inv-item-desc').forEach(el => {
      if (!el.dataset.grown) { autoGrow(el); el.dataset.grown = '1'; }
    });
  });
  if (document.body) _mo.observe(document.body, { childList: true, subtree: true });
  else window.addEventListener('DOMContentLoaded', () => _mo.observe(document.body, { childList: true, subtree: true }));
}

// Pop a status-switcher dropdown from the invoice footer bar.
function toggleStatusSwitcher(evt) {
  evt.preventDefault();
  evt.stopPropagation();
  const existing = document.querySelector('.status-switch-pop');
  if (existing) { existing.remove(); return; }
  const btn = evt.currentTarget;
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'dropdown status-switch-pop';
  dd.style.position = 'fixed';
  dd.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  dd.style.left = rect.left + 'px';
  dd.style.minWidth = '190px';
  // Only administrative statuses live here. Paid / Partially paid are set by Log Payment.
  const statuses = [
    { id: 'draft',     label: 'Draft' },
    { id: 'sent',      label: 'Sent' },
    { id: 'overdue',   label: 'Overdue' },
    { id: 'cancelled', label: 'Cancelled' },
  ];
  dd.innerHTML = `
    <div style="padding:6px 8px 4px;font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:0.05em">Change status</div>
    ${statuses.map(s => `
      <div class="dropdown-item" data-status="${s.id}">
        ${invoiceStatusPill(s.id)}
      </div>
    `).join('')}
    <div class="dropdown-sep"></div>
    <div style="padding:6px 8px;font-size:11px;color:var(--muted-foreground);line-height:1.4">
      To mark as <strong>Paid</strong> or <strong>Partially paid</strong>, use <em>Log Payment</em>.
    </div>
  `;
  document.body.appendChild(dd);
  // Close on outside click
  setTimeout(() => {
    const onDoc = (e) => {
      if (!e.target.closest('.status-switch-pop') && !e.target.closest('.status-switch')) {
        dd.remove();
        document.removeEventListener('click', onDoc, true);
      }
    };
    document.addEventListener('click', onDoc, true);
  }, 0);
}

// Toggle the invoice items table between simple and detailed modes.
// Updates URL param and re-renders the row that owns the items grid.
function setItemsMode(mode) {
  const url = new URL(window.location.href);
  url.searchParams.set('items', mode);
  history.replaceState({}, '', url);
  // Reload for now — cheap and reliable since the whole canvas re-renders.
  window.location.reload();
}

// ---------- Log Payment popup ----------

function openLogPayment(evt) {
  if (evt) { evt.preventDefault(); evt.stopPropagation(); }
  if (document.querySelector('.log-payment-backdrop')) return;
  // Best-effort: read the outstanding from the current canvas totals row.
  const outstandingRow = document.querySelector('.tot-outstanding .tot-value')
    || document.querySelector('.inv-totals-row.grand .tot-value');
  const outstandingText = outstandingRow ? outstandingRow.textContent.trim() : '';
  const outstandingNum = Number(outstandingText.replace(/[^\d.]/g, '')) || 0;
  const currencySymbol = (outstandingText.match(/[₦$€£]/) || [''])[0] || '₦';
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop log-payment-backdrop';
  wrap.innerHTML = `
    <div class="modal log-payment-modal" role="dialog" aria-label="Log payment">
      <div class="modal-header">
        <div class="modal-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span>Log Payment</span>
        </div>
        <button class="modal-close" onclick="closeLogPayment()">${ICONS.x}</button>
      </div>
      <div class="modal-body log-payment-body">
        <label class="log-check">
          <input type="checkbox" id="lp-fully" checked onchange="toggleFullyPaid(this)" />
          <span>Fully paid</span>
          <span class="log-check-hint">Outstanding balance: <strong>${currencySymbol}${outstandingNum.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></span>
        </label>

        <div class="log-field">
          <label>Amount paid</label>
          <div class="log-amount-wrap">
            <span class="log-amount-sym">${currencySymbol}</span>
            <input type="text" id="lp-amount" value="${outstandingNum.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}" disabled />
          </div>
        </div>

        <div class="log-field-row">
          <div class="log-field">
            <label>Date</label>
            <input type="text" id="lp-date" value="${today}" />
          </div>
          <div class="log-field">
            <label>Method</label>
            <select id="lp-method" class="log-select">
              <option>Cash</option>
              <option>Bank transfer</option>
              <option>Card</option>
              <option>Paystack</option>
              <option>Wire transfer</option>
              <option>Other</option>
            </select>
          </div>
        </div>

        <div class="log-field">
          <label>Note</label>
          <textarea id="lp-note" maxlength="2000" placeholder="Optional reference, cheque number, or context…"></textarea>
          <div class="log-charcount"><span id="lp-count">0</span> / 2000 characters at most</div>
        </div>
      </div>
      <div class="modal-footer">
        <div style="font-size:12px;color:var(--muted-foreground)">Full payment marks as <strong style="color:var(--foreground)">Paid</strong>; partial marks as <strong style="color:var(--foreground)">Partially paid</strong>.</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="closeLogPayment()">Close</button>
          <button class="btn btn-primary">Add Payment</button>
        </div>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeLogPayment(); });
  document.body.appendChild(wrap);

  // Wire char counter
  const note = wrap.querySelector('#lp-note');
  const count = wrap.querySelector('#lp-count');
  note.addEventListener('input', () => count.textContent = note.value.length);

  // Esc closes
  const onEsc = (e) => { if (e.key === 'Escape') { closeLogPayment(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
}
function closeLogPayment() {
  const el = document.querySelector('.log-payment-backdrop');
  if (el) el.remove();
}
function toggleFullyPaid(chk) {
  const amt = document.querySelector('#lp-amount');
  if (!amt) return;
  amt.disabled = chk.checked;
  if (chk.checked) amt.classList.remove('is-editing');
  else amt.classList.add('is-editing');
}

// Toggle a body class so we can visualise "Receipt view" (dev stub; real app
// would re-render from state). For now just scrolls back to top.
function toggleReceiptMode(evt) {
  if (evt) { evt.preventDefault(); evt.stopPropagation(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Send modal (context aware: invoice / receipt / both) ----------
function openSendModal(evt) {
  if (evt) { evt.preventDefault(); evt.stopPropagation(); }
  if (document.querySelector('.send-modal-backdrop')) return;
  // Detect: are we in a document with logged payments? (drives Receipt option)
  const hasPayments = !!document.querySelector('.inv-payment-history')
    || !!document.querySelector('.rail-payment');

  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop send-modal-backdrop';
  wrap.innerHTML = `
    <div class="modal send-modal" role="dialog" aria-label="Send invoice">
      <div class="modal-header">
        <div class="modal-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          <span>Send ${hasPayments ? 'to client' : 'invoice'}</span>
        </div>
        <button class="modal-close" onclick="closeSendModal()">${ICONS.x}</button>
      </div>
      <div class="modal-body send-modal-body">
        <div class="field">
          <label class="field-label">Recipient email <span class="required-mark">*</span></label>
          <input class="input" placeholder="client@company.com" value="client@company.com" />
        </div>
        <div class="field">
          <label class="field-label">CC (optional)</label>
          <input class="input" placeholder="finance@yourcompany.com" />
        </div>
        <div class="field">
          <label class="field-label">Subject</label>
          <input class="input" value="${hasPayments ? 'Receipt for your recent payment' : 'Your invoice from Your Company Ltd'}" />
        </div>
        <div class="field">
          <label class="field-label">Message</label>
          <textarea class="input" rows="4" style="min-height:80px">${hasPayments ? 'Thanks for your payment. Attached is your receipt for record-keeping.' : 'Please find your invoice attached. Payment terms are Net 30.'}</textarea>
        </div>

        <div class="send-attach">
          <div class="send-attach-label">Attachments</div>
          ${hasPayments ? `
            <label class="send-choice">
              <input type="radio" name="send-doc" value="receipt" checked />
              <div>
                <div class="send-choice-title">Receipt only</div>
                <div class="send-choice-sub">Recommended after payment — clean receipt document.</div>
              </div>
            </label>
            <label class="send-choice">
              <input type="radio" name="send-doc" value="invoice" />
              <div>
                <div class="send-choice-title">Invoice only</div>
                <div class="send-choice-sub">Resend the original bill (e.g. if the client requests it).</div>
              </div>
            </label>
            <label class="send-choice">
              <input type="radio" name="send-doc" value="both" />
              <div>
                <div class="send-choice-title">Invoice + Receipt</div>
                <div class="send-choice-sub">Attach both documents in one email.</div>
              </div>
            </label>
          ` : `
            <label class="send-choice is-locked">
              <input type="radio" name="send-doc" value="invoice" checked />
              <div>
                <div class="send-choice-title">Invoice</div>
                <div class="send-choice-sub">The receipt option unlocks once a payment is logged.</div>
              </div>
            </label>
          `}
        </div>
      </div>
      <div class="modal-footer">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted-foreground)">
          <input type="checkbox" checked /> Send me a copy
        </label>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="closeSendModal()">Cancel</button>
          <button class="btn btn-primary">Send</button>
        </div>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSendModal(); });
  document.body.appendChild(wrap);

  const onEsc = (e) => { if (e.key === 'Escape') { closeSendModal(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
}
function closeSendModal() {
  const el = document.querySelector('.send-modal-backdrop');
  if (el) el.remove();
}

// Renders the full invoice canvas (used by both create and edit).
// Pass an invoice-like object; nulls/blanks yield placeholders (create flow).
function renderInvoiceCanvas(inv = {}, opts = {}) {
  // Items table mode — simple (default) or detailed.
  const itemsMode = (typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('items')) === 'detailed'
    ? 'detailed' : 'simple';
  const c = inv.currency || DEFAULT_CURRENCY;
  const status = inv.status || 'sent';
  const statusMap = {
    'draft':          { cls: 'is-draft',     label: 'DRAFT' },
    'sent':           { cls: 'is-sent',      label: 'SENT' },
    'overdue':        { cls: 'is-overdue',   label: 'OVERDUE' },
    'partially-paid': { cls: 'is-partial',   label: 'PARTIALLY PAID' },
    'paid':           { cls: 'is-paid',      label: 'PAID' },
    'cancelled':      { cls: 'is-cancelled', label: 'CANCELLED' },
  };
  const st = statusMap[status];

  // Single source of truth (also used by the right rail on Edit page).
  const totals = computeTotals(inv);
  const { items, subtotal, salesTax, grand, payments, paid, outstanding } = totals;
  const latestPayment = payments[payments.length - 1] || null;

  // Receipt mode = at least one payment logged. Flips document title.
  const isReceiptMode = payments.length > 0;

  // Diagonal stamp on totals section — only when paid/partially-paid
  let stamp = null, stampClass = '', stampLabel = '';
  if (status === 'paid')            { stamp = true; stampClass = 'stamp-paid';    stampLabel = 'PAID IN FULL'; }
  else if (status === 'partially-paid') { stamp = true; stampClass = 'stamp-partial'; stampLabel = 'PARTIALLY PAID'; }

  const itemRows = items.map((it, i) => {
    const line = Number(it.qty) * Number(it.unitPrice);
    const qtyPriceCells = itemsMode === 'detailed' ? `
        <div class="inv-item-col num-center"><input class="inv-item-input" style="text-align:center" value="${it.qty}" /></div>
        <div class="inv-item-col num-right"><input class="inv-item-input" value="${fmtMoney(it.unitPrice, c)}" /></div>
    ` : '';
    return `
      <div class="inv-item-row items-${itemsMode}">
        <div class="inv-item-lead">
          <span class="inv-item-idx">${i+1}</span>
          <span class="inv-item-handle" title="Drag to reorder">${ICONS.drag}</span>
        </div>
        <div class="inv-item-text">
          <textarea class="inv-item-name" rows="1" oninput="autoGrow(this)">${it.name}</textarea>
          <textarea class="inv-item-desc" rows="1" oninput="autoGrow(this)" placeholder="Item description (optional)">${it.desc}</textarea>
        </div>
        ${qtyPriceCells}
        <div class="inv-item-col num-right"><strong>${fmtMoney(line, c)}</strong></div>
        <div class="inv-item-actions inv-item-actions-stack">
          <button class="icon-btn item-delete" title="Delete">${ICONS.trash}</button>
          <button class="icon-btn" title="Duplicate">${ICONS.duplicate}</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="invoice-canvas">
      <!-- Header block: logo + invoice # on left, status + due + Pay Now on right -->
      <div class="inv-top">
        <div class="inv-logo-block">
          <div style="display:flex;align-items:center;gap:14px">
            <div class="inv-logo-slot" title="Click to upload your logo">Upload logo</div>
          </div>
          <div class="inv-number">${isReceiptMode ? 'Receipt' : 'Invoice'} #${(inv.number || 'INV-000000').replace(/^INV-/,'')}</div>
        </div>
        <div class="inv-status-big ${st.cls}">
          <div class="inv-status-label">${st.label}</div>
          <div class="inv-due-line">Due Date: <strong style="color:var(--foreground)">${inv.due || 'Thursday, April 16th, 2026'}</strong></div>
          ${status !== 'paid' && status !== 'cancelled' ? `<button class="inv-pay-now">Pay Now</button>` : ''}
        </div>
      </div>

      <!-- Invoiced To / Pay To -->
      <div class="inv-parties">
        <div class="inv-party">
          <div class="inv-party-title">Invoiced To</div>
          <input class="inv-party-input inv-party-strong" value="${inv.client || 'Client name'}" />
          <input class="inv-party-input" value="${inv.clientContact || 'Contact person'}" />
          <input class="inv-party-input" value="${inv.clientAddr1 || 'Street address'}" />
          <input class="inv-party-input" value="${inv.clientAddr2 || 'City, State, Postal code'}" />
          <input class="inv-party-input" value="${inv.clientCountry || 'Country'}" />
          <input class="inv-party-input" type="email" value="${inv.clientEmail || 'client@company.com'}" />
        </div>
        <div class="inv-party inv-right">
          <div class="inv-party-title">Pay To</div>
          <input class="inv-party-input inv-party-strong" value="${inv.payTo || 'Your company Ltd.'}" />
          <input class="inv-party-input" value="${inv.payToAddr1 || 'Street address,'}" />
          <input class="inv-party-input" value="${inv.payToCity || 'City, State.'}" />
          <input class="inv-party-input" type="email" value="${inv.payToEmail || 'billing@company.com'}" />
          <input class="inv-party-input" value="TIN: ${inv.taxId || '24537673'}" />
        </div>
      </div>

      <!-- Invoice date & Payment method -->
      <div class="inv-meta-row">
        <div class="inv-meta-left">
          <div class="inv-meta-title">Invoice Date</div>
          <input class="inv-party-input" value="${inv.issued || 'Thursday, March 19th, 2026'}" />
        </div>
        <div class="inv-meta-right-col">
          <div class="inv-meta-title">Payment Method</div>
          <button class="pay-method-select">
            <span>${inv.paymentMethod || 'Paystack (Debit/Credit Cards)'}</span>
            <span class="chev">${ICONS.chevronDown}</span>
          </button>
        </div>
      </div>

      <!-- Invoice Items -->
      <div class="inv-items items-${itemsMode}">
        <div class="inv-items-head items-${itemsMode}">
          <div>#</div>
          <div>Item Description</div>
          ${itemsMode === 'detailed' ? `
            <div class="num-center">Qty</div>
            <div class="num-right">Unit Price</div>
          ` : ''}
          <div class="num-right">Amount</div>
          <div></div>
        </div>
        ${itemRows}
      </div>
      <div class="inv-items-footer">
        <button class="inv-add-item">${ICONS.plus}<span>Add Item</span></button>
        <div class="inv-mode-toggle" role="tablist" aria-label="Items table mode">
          <button class="mode-tab ${itemsMode === 'simple' ? 'active' : ''}" onclick="setItemsMode('simple')">Simple</button>
          <button class="mode-tab ${itemsMode === 'detailed' ? 'active' : ''}" onclick="setItemsMode('detailed')">Detailed</button>
        </div>
      </div>

      <!-- Totals summary (right-aligned) with Payment Terms + payment history on the left -->
      <div class="inv-totals-wrap">
        <div class="inv-terms-block">
          <div class="inv-meta-title">Payment Terms</div>
          <textarea class="inv-notes-input inv-terms-input" placeholder="Net 30. Late payments accrue 1.5% interest per month.">${inv.terms || 'Net 30. Late payments accrue 1.5% interest per month.'}</textarea>

          ${stamp ? `
            <div class="inv-stamp-wrap">
              <div class="inv-stamp ${stampClass}">
                <div class="inv-stamp-text">${stampLabel}</div>
                <div class="inv-stamp-sub">${latestPayment ? latestPayment.date : ''}</div>
              </div>
              ${payments.length ? `
                <div class="inv-payment-history">
                  <div class="inv-history-title">Payment history</div>
                  ${payments.map((p, i) => `
                    <div class="inv-history-row">
                      <span class="inv-history-idx">${i + 1}</span>
                      <div class="inv-history-body">
                        <div class="inv-history-line1">
                          <strong>${fmtMoney(p.amount, c)}</strong>
                          <span class="inv-history-method">${p.method}</span>
                        </div>
                        <div class="inv-history-line2">
                          ${p.date}${p.note ? ` · <em>${p.note}</em>` : ''}
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>
        <div>
          <div class="inv-totals">
            <div class="inv-totals-row add-charge">
              <span class="tot-label">+ Additional Charges</span>
              <span class="tot-value">${fmtMoney(0, c)}</span>
            </div>
            <div class="inv-totals-row">
              <span class="tot-label">Subtotal</span>
              <span class="tot-value">${fmtMoney(subtotal, c)}</span>
            </div>
            <div class="inv-totals-row inv-discount-row">
              <span class="tot-label">+ Discount</span>
              <span class="tot-value">
                <input class="inv-discount-input" placeholder="0.00" value="" />
              </span>
            </div>
            <div class="inv-totals-row">
              <span class="tot-label">Tax (7.5%)</span>
              <span class="tot-value">${fmtMoney(salesTax, c)}</span>
            </div>
            <div class="inv-totals-row grand">
              <span class="tot-label">${isReceiptMode ? 'Invoice Total' : 'Amount Due'}</span>
              <span class="tot-value">${fmtMoney(grand, c)}</span>
            </div>
            ${paid > 0 ? `
              <div class="inv-totals-row tot-paid">
                <span class="tot-label">Amount Paid</span>
                <span class="tot-value">− ${fmtMoney(paid, c)}</span>
              </div>
              <div class="inv-totals-row grand ${outstanding <= 0 ? 'tot-cleared' : 'tot-outstanding'}">
                <span class="tot-label">${outstanding <= 0 ? 'Balance' : 'Balance Due'}</span>
                <span class="tot-value">${fmtMoney(Math.max(0, outstanding), c)}</span>
              </div>
            ` : ''}
          </div>
          <div class="inv-total-words">
            <span class="inv-total-words-label">In words:</span>
            <span class="inv-total-words-value">${moneyInWords(grand, c)}</span>
          </div>
        </div>
      </div>

      <!-- Divider between totals and payment blocks -->
      <hr class="inv-hr" />

      <!-- Payment Information: Naira left, USD right -->
      <div class="inv-meta-title" style="margin-bottom: 12px">Payment Information</div>
      <div class="inv-payment-grid">
        <div class="inv-account-card">
          <div class="inv-account-head">
            <span class="inv-account-flag">₦</span>
            <span class="inv-account-name">Naira account</span>
          </div>
          <div class="inv-account-grid">
            <div><label>Bank</label><input class="inv-party-input" value="${inv.ngnBank || 'Guaranty Trust Bank'}" /></div>
            <div><label>Account name</label><input class="inv-party-input" value="${inv.ngnAcctName || 'Your Company Ltd'}" /></div>
            <div><label>Account number</label><input class="inv-party-input" value="${inv.ngnAcctNum || '0123456789'}" /></div>
            <div><label>Sort code / Branch</label><input class="inv-party-input" value="${inv.ngnBranch || 'GTB · Ikeja'}" /></div>
          </div>
        </div>

        <div class="inv-account-card">
          <div class="inv-account-head">
            <span class="inv-account-flag">$</span>
            <span class="inv-account-name">USD account</span>
          </div>
          <div class="inv-account-grid">
            <div><label>Bank</label><input class="inv-party-input" value="${inv.usdBank || 'Wise (US)'}" /></div>
            <div><label>Account name</label><input class="inv-party-input" value="${inv.usdAcctName || 'Your Company Ltd'}" /></div>
            <div><label>Account / IBAN</label><input class="inv-party-input" value="${inv.usdAcctNum || '9600 0000 0000 12'}" /></div>
            <div><label>Routing / SWIFT</label><input class="inv-party-input" value="${inv.usdRouting || 'CMFGUS33'}" /></div>
          </div>
        </div>
      </div>

      <!-- Bottom themed strip -->
      <div class="inv-tagline-strip">May the 4th be with you!</div>

      <!-- Footer: brand + currency + palette + Reset + Download PDF -->
      <div class="inv-footer-bar">
        <div class="inv-brand-mini">
          <span class="inv-brand-mini-dot">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6M4.93 4.93l4.24 4.24M2 12h6M4.93 19.07l4.24-4.24"/></svg>
          </span>
          <strong>4th.link</strong>
          <span>Invoices</span>
        </div>

        <button class="currency-select" title="Change currency">
          <span class="currency-symbol">${CURRENCIES[c].symbol}</span>
          <span>${CURRENCIES[c].label}</span>
          ${ICONS.chevronDown}
        </button>

        <button class="currency-select status-switch" title="Change status (Sent / Overdue / Cancelled)" onclick="toggleStatusSwitcher(event)">
          ${invoiceStatusPill(status)}
          ${ICONS.chevronDown}
        </button>

        ${(status === 'sent' || status === 'overdue' || status === 'partially-paid') ? `
          <button class="btn btn-outline btn-sm log-payment-btn" onclick="openLogPayment(event)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Log Payment</span>
          </button>
        ` : ''}

        <div class="inv-footer-spacer"></div>

        ${isReceiptMode ? `
          <button class="btn btn-outline btn-sm" onclick="toggleReceiptMode(event)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6M9 11h6"/></svg>
            <span>View Receipt</span>
          </button>
        ` : `
          <button class="btn btn-outline btn-sm">${ICONS.reset}<span>Reset</span></button>
        `}
        <button class="btn btn-primary btn-sm">${ICONS.download}<span>Download PDF</span></button>
      </div>
    </div>
  `;
}

function renderInvoicePagination(status = 'all') {
  const n = status === 'all' ? SAMPLE_INVOICES.length : SAMPLE_INVOICES.filter(i => i.status === status).length;
  return `
    <div class="pagination">
      <div>Viewing 1–${n} of ${n} invoices</div>
      <div class="pagination-btns">
        <button class="btn btn-outline btn-sm" disabled>Previous</button>
        <button class="btn btn-outline btn-sm">Next</button>
      </div>
    </div>
  `;
}
