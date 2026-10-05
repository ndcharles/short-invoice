// Settings helpers: sub-nav, form primitives, floating save bar.
// The save bar only appears once at least one input has been touched
// (dirty state), so we avoid chatty per-keystroke autosaves.

const SETTINGS_NAV = [
  { id: 'general',   label: 'General',        href: 'settings.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6m11-11h-6M7 12H1m17.66-6.66l-4.24 4.24M9.58 14.42l-4.24 4.24m0-13.32l4.24 4.24m4.84 4.84l4.24 4.24"/></svg>` },
  { id: 'shortener', label: 'URL Shortener',  href: 'settings-shortener.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
  { id: 'utm',       label: 'UTM Builder',    href: 'settings-utm.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h16"/><circle cx="18" cy="12" r="2"/></svg>` },
  { id: 'invoice',   label: 'Invoice',        href: 'settings-invoice.html',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>` },
];

function renderSettingsNav(activeId) {
  return `
    <aside class="settings-nav">
      <div class="settings-nav-title">Settings</div>
      ${SETTINGS_NAV.map(n => `
        <a href="${n.href}" class="${n.id === activeId ? 'active' : ''}">
          ${n.icon}
          <span>${n.label}</span>
        </a>
      `).join('')}
    </aside>
  `;
}

// Save bar HTML — hidden until dirty
function renderSaveBar() {
  return `
    <div class="save-bar" id="save-bar" role="status" aria-live="polite">
      <span class="save-bar-dot"></span>
      <span id="save-bar-msg">You have unsaved changes</span>
      <button class="btn btn-outline" onclick="resetSettings()">Discard</button>
      <button class="btn btn-primary" onclick="saveSettings()">Save changes</button>
    </div>
  `;
}

// Wire dirty-state detection. Any input/select/textarea change flips the bar on.
function initSaveBar(rootSelector = '.settings-main') {
  const root = document.querySelector(rootSelector);
  const bar  = document.getElementById('save-bar');
  if (!root || !bar) return;

  let dirty = false;
  const setDirty = (v) => {
    dirty = v;
    bar.classList.toggle('visible', v);
  };

  // Capture initial values so we can diff on input
  const controls = root.querySelectorAll('input, textarea, select');
  controls.forEach(el => {
    el._initial = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });

  const check = () => {
    const anyChanged = Array.from(controls).some(el => {
      const cur = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
      return cur !== el._initial;
    });
    setDirty(anyChanged);
  };

  root.addEventListener('input',  check);
  root.addEventListener('change', check);

  // Also flip dirty on any chip/segmented click
  root.addEventListener('click', (e) => {
    if (e.target.closest('.setting-chip, .setting-seg button, .btn-danger, [data-dirty="true"]')) {
      // Delay so the toggling classList/attr change has already happened
      setTimeout(check, 0);
    }
  });

  // Warn on unload
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // Expose globals used by the bar buttons
  window.resetSettings = () => {
    controls.forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = el._initial;
      else el.value = el._initial;
    });
    setDirty(false);
  };
  window.saveSettings = () => {
    // Simulate save
    const msg = document.getElementById('save-bar-msg');
    const dot = bar.querySelector('.save-bar-dot');
    if (msg) msg.textContent = 'Saved!';
    if (dot) { dot.style.background = '#22c55e'; dot.style.boxShadow = '0 0 0 4px rgba(34,197,94,0.15)'; }
    setTimeout(() => {
      controls.forEach(el => { el._initial = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value; });
      setDirty(false);
      if (msg) msg.textContent = 'You have unsaved changes';
      if (dot) { dot.style.background = '#fbbf24'; dot.style.boxShadow = '0 0 0 4px rgba(251,191,36,0.15)'; }
    }, 900);
  };
}

// Convenience: a labelled setting row
function settingsRow({ label, help = '', control = '' }) {
  return `
    <div class="settings-row">
      <div class="settings-row-label">
        <label>${label}</label>
        ${help ? `<div class="row-help">${help}</div>` : ''}
      </div>
      <div class="settings-row-control">${control}</div>
    </div>
  `;
}

// Convenience: a section card
function settingsCard({ title, subtitle = '', body = '', foot = '', danger = false }) {
  return `
    <section class="settings-card ${danger ? 'danger' : ''}">
      <div class="settings-card-head">
        <h3>${title}</h3>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      <div class="settings-card-body">${body}</div>
      ${foot ? `<div class="settings-card-foot">${foot}</div>` : ''}
    </section>
  `;
}
