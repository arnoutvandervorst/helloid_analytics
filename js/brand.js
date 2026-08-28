/* Branding: three separate assets, because they do different jobs.
     icon      — square app mark, used in the top bar and as the favicon
     logo      — wordmark, used wherever the background is light
     logoLight — the same wordmark drawn for a dark background (report cover chip)
   Files dropped at assets/icon.*, assets/logo.* and assets/logo-light.* are picked up
   automatically; anything uploaded in Settings is stored as a data URI in this browser
   so it also survives into the printed PDF. Each slot falls back to the next, and
   finally to a neutral placeholder tile. */
(function (HR) {
  'use strict';

  const KEY = 'hr.brand';
  const AUTO = {
    icon: ['assets/icon.svg', 'assets/icon.png'],
    logo: ['assets/logo.svg', 'assets/logo.png'],
    logoLight: ['assets/logo-light.svg', 'assets/logo-light.png']
  };

  const state = {
    icon: null,
    logo: null,
    logoLight: null,
    productName: '',     // overrides the app title when set
    org: '',
    preparedBy: '',
    date: '',            // empty = today, formatted in the active language
    accent: '',          // #rrggbb; drives --series-1/--series-7 in both themes
    defaultTheme: '',    // ''|'light'|'dark' — the theme a fresh visitor gets
    welcome: '',         // custom line on the empty landing state
    footerText: '',      // printed on every board-report sheet
    contact: ''          // contact line on the report cover
  };

  if (window.HR_BUNDLED_ICON) state.icon = window.HR_BUNDLED_ICON;
  if (window.HR_BUNDLED_LOGO) state.logo = window.HR_BUNDLED_LOGO;
  if (window.HR_BUNDLED_LOGO_LIGHT) state.logoLight = window.HR_BUNDLED_LOGO_LIGHT;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) Object.assign(state, saved, {
      icon: saved.icon || state.icon,
      logo: saved.logo || state.logo,
      logoLight: saved.logoLight || state.logoLight
    });
  } catch (e) { /* ignore */ }

  function persist() {
    if (HR.storageMode && !HR.storageMode.enabled()) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { HR.util.toast(HR.i18n.t('toast.configFail')); }
  }

  /** Probe for an asset shipped next to the app; never overrides an uploaded one. */
  async function probe(slot) {
    if (state[slot]) return state[slot];
    for (const path of AUTO[slot]) {
      try {
        const res = await fetch(path);
        if (!res.ok) continue;
        const type = (res.headers.get('content-type') || '').toLowerCase();
        if (type.includes('html')) continue;              // dev-server 404 page
        state[slot] = path;
        return path;
      } catch (e) { /* not served, or file:// — fall through */ }
    }
    return null;
  }

  /** @returns {Promise<boolean>} whether anything new turned up */
  async function detectAuto() {
    const before = JSON.stringify([state.icon, state.logo, state.logoLight]);
    await Promise.all(Object.keys(AUTO).map(probe));
    return before !== JSON.stringify([state.icon, state.logo, state.logoLight]);
  }

  function setAsset(slot, dataUri) {
    state[slot] = dataUri || null;
    persist();
    apply();
  }

  function set(patch) { Object.assign(state, patch); persist(); }

  const today = () => new Date().toLocaleDateString(HR.i18n.locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const reportDate = () => state.date || today();

  const FALLBACK = { icon: ['icon', 'logo'], logo: ['logo', 'icon'], logoLight: ['logoLight', 'logo', 'icon'] };

  /**
   * An <img> for the requested slot, falling back through the related slots and
   * finally to the gradient placeholder.
   * @param {'icon'|'logo'|'logoLight'} slot
   */
  function mark(slot, cls) {
    const el = HR.util.el;
    const src = FALLBACK[slot].map(s => state[s]).find(Boolean);
    if (src) {
      const img = el('img', { src: src, alt: state.org || 'logo', class: (cls || '') + ' brand-img' });
      img.style.objectFit = 'contain';
      return img;
    }
    return el('span', { class: (cls || '') + ' brand-placeholder' });
  }

  const has = slot => !!FALLBACK[slot].map(s => state[s]).find(Boolean);

  /** A darker companion for the gradient's far stop: the accent scaled in RGB. */
  function shade(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const ch = shift => Math.round(((n >> shift) & 255) * factor);
    return '#' + [16, 8, 0].map(ch).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  /** Repaint the top-bar mark, the favicon and the accent after a branding change. */
  function apply() {
    const host = document.querySelector('.brand .mark-host');
    if (host) { host.innerHTML = ''; host.appendChild(mark('icon', 'mark')); }
    const src = state.icon || state.logo;
    if (src) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = HR.util.el('link', { rel: 'icon' }); document.head.appendChild(link); }
      link.href = src;
    }
    /* Inline on the root, so it outranks both theme blocks; --series-1 is the
       one accent token everything reads (buttons, links, tabs, chart slot 1). */
    const root = document.documentElement.style;
    if (/^#[0-9a-fA-F]{6}$/.test(state.accent)) {
      root.setProperty('--series-1', state.accent);
      root.setProperty('--series-7', shade(state.accent, 0.62));
    } else {
      root.removeProperty('--series-1');
      root.removeProperty('--series-7');
    }
  }

  HR.brand = { state, set, setAsset, detectAuto, mark, has, apply, persist, reportDate };
})(window.HR);
