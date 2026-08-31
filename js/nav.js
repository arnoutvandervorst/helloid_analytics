/* The sidebar.

   Fifteen views in one flat column is a list, not navigation: nothing tells you that
   Accounts and Permissions are the same kind of thing, or that Imports and Snapshots are
   both about the files rather than the findings. So they are grouped by the question they
   answer, and the groups are named.

   Two things make a long list workable. Favourites, because everybody uses three or four
   views and hunts for them in a list of fifteen; a starred view is pinned to the top and
   stays there across sessions. And collapsing, because on a laptop the sidebar costs
   200px of a table's width — collapsed it keeps the icons, which is enough once you know
   where things are.

   Icons are inline paths rather than a font or a sprite: this page loads no external
   resource, and an icon that fails to load is worse than no icon at all. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, T = (k, p) => HR.i18n.t(k, p);
  const KEY = 'hr.nav.v1';

  /* 16×16 on a 24 grid, stroked with currentColor so themes need no second set. */
  const ICONS = {
    overview: 'M4 13h5V4H4v9zm0 7h5v-5H4v5zm7 0h9v-9h-9v9zm0-16v5h9V4h-9z',
    risk: 'M12 3l9 16H3l9-16zm0 6v5m0 3v.5',
    cost: 'M12 3v18M8 7h6a3 3 0 010 6H9a3 3 0 000 6h7',
    accounts: 'M4 20v-1a5 5 0 015-5h6a5 5 0 015 5v1M12 3a4 4 0 100 8 4 4 0 000-8z',
    permissions: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5V11z',
    people: 'M3 20v-1a4 4 0 014-4h4a4 4 0 014 4v1M9 4a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM17 20v-1a4 4 0 00-3-3.9M15.5 4.2a3.5 3.5 0 010 6.8',
    org: 'M12 3v4M6 21v-4m12 4v-4M4 7h16M6 17h12M9 7v4h6V7M12 11v6',
    mining: 'M12 3L4 20h16L12 3zm-4 11h8M10 8h4',
    activity: 'M3 12h4l3 8 4-16 3 8h4',
    products: 'M3 8l9-5 9 5-9 5-9-5zm0 8l9 5 9-5M3 12l9 5 9-5',
    explain: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 13v.5M12 8a2 2 0 012 2c0 1.5-2 1.6-2 3.5',
    rules: 'M5 4h14v16H5V4zm3 4h8M8 12h8M8 16h5',
    diff: 'M6 3v12a3 3 0 003 3h6M18 21V9a3 3 0 00-3-3H9M6 3l-3 3 3 3M18 21l3-3-3-3',
    snapshots: 'M4 7h16v13H4V7zm5-3h6l1 3H8l1-3zM12 11a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
    sources: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
    board: 'M4 4h16v14H4V4zm4 10V9m4 5V7m4 7v-3M9 21h6',
    settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z',
    star: 'M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-4 5.6-.7L12 4z',
    collapse: 'M15 5l-7 7 7 7M20 5v14',
    expand: 'M9 5l7 7-7 7M4 5v14',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
    conventions: 'M4 6h16M4 12h10M4 18h13M19 16l2 2-2 2',
    matching: 'M8 12h8M5 8a4 4 0 000 8h3M19 8a4 4 0 010 8h-3',
    nedap: 'M4 5h16v4H4zM4 10.5h10v4H4zM4 16h13v4H4zM16.5 12.5l2 2 3-3.5',
    fieldmap: 'M4 6h6M4 12h6M4 18h6M14 6h6M14 12h6M14 18h6M10 6l4 6M10 12l4-6M10 12l4 6M10 18l4-6',
    policies: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3zM9 12l2 2 4-4'
  };

  /* The groups are the questions somebody arrives with, not the modules that answer them. */
  const GROUPS = [
    { key: 'state', views: ['overview', 'risk', 'cost'] },
    { key: 'who', views: ['accounts', 'permissions', 'people', 'matching', 'org', 'conventions'] },
    { key: 'model', views: ['mining', 'rules', 'policies', 'products', 'nedap', 'fieldmap', 'activity', 'explain'] },
    { key: 'data', views: ['diff', 'snapshots', 'sources'] },
    { key: 'out', views: ['board', 'settings'] }
  ];

  const icon = (name, cls) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'nav-icon ' + (cls || ''));
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name] || ICONS.overview);
    svg.appendChild(path);
    return svg;
  };

  let state = { collapsed: false, favourites: [] };

  /* Views that have been renamed. A favourite pinned under the old name still points at
     something real, so it is migrated rather than dropped — and rendered under the new
     label instead of the missing translation key for the old one. */
  const RENAMED = { pyramid: 'mining' };

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (stored) state = Object.assign(state, stored);
    } catch (e) { /* first run, or storage blocked */ }
    const migrated = U.uniq((state.favourites || []).map(v => RENAMED[v] || v));
    if (migrated.join() !== (state.favourites || []).join()) {
      state.favourites = migrated;
      save();
    }
    return state;
  }

  function save() {
    if (HR.storageMode && !HR.storageMode.enabled()) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* not fatal */ }
  }

  const isFavourite = view => state.favourites.indexOf(view) >= 0;

  function toggleFavourite(view) {
    const i = state.favourites.indexOf(view);
    if (i >= 0) state.favourites.splice(i, 1);
    else state.favourites.push(view);
    save();
    render();
  }

  function toggleCollapsed() {
    state.collapsed = !state.collapsed;
    save();
    render();
    /* The shell reserves the width, so it has to hear about it too. */
    document.body.classList.toggle('nav-collapsed', state.collapsed);
  }

  /** One row: icon, label, and a star that appears on hover or when it is set. */
  function item(view, current) {
    /* A view whose imports are missing stays clickable — the page it opens says
       exactly what to import — but wears a lock so nobody hunts for hidden data. */
    const missing = HR.views.missingFor ? HR.views.missingFor(view) : [];
    const needs = missing.map(req => req.split('|').map(k => T('src.' + k)).join(' / ')).join(', ');
    const button = el('button', {
      class: 'nav-item' + (view === current ? ' active' : '') + (missing.length ? ' gated' : ''),
      'data-view': view,
      title: T('nav.' + view) + (missing.length ? ' \u2014 ' + T('nav.needs', { list: needs }) : ''),
      onclick: () => HR.app.go(view)
    }, [
      icon(view),
      el('span', { class: 'nav-label', text: T('nav.' + view) }),
      missing.length ? icon('lock', 'nav-lock') : null
    ]);

    const star = el('button', {
      class: 'nav-star' + (isFavourite(view) ? ' on' : ''),
      title: T(isFavourite(view) ? 'nav.unfavourite' : 'nav.favourite'),
      onclick: e => { e.stopPropagation(); toggleFavourite(view); }
    }, icon('star'));

    return el('div', { class: 'nav-row' }, [button, star]);
  }

  function render() {
    const nav = document.getElementById('sidenav');
    if (!nav) return;
    const current = HR.app.state.view;
    nav.innerHTML = '';
    nav.classList.toggle('collapsed', state.collapsed);

    /* Favourites first, because that is the point of them. */
    const favourites = state.favourites.filter(v => HR.views[v]);
    if (favourites.length) {
      nav.appendChild(el('div', { class: 'nav-group-label', text: T('nav.g.favourites') }));
      favourites.forEach(view => nav.appendChild(item(view, current)));
      nav.appendChild(el('div', { class: 'nav-divider' }));
    }

    GROUPS.forEach(group => {
      const views = group.views.filter(v => HR.views[v]);
      if (!views.length) return;
      nav.appendChild(el('div', { class: 'nav-group-label', text: T('nav.g.' + group.key) }));
      views.forEach(view => nav.appendChild(item(view, current)));
    });

    /* Last, and pushed to the bottom: a control you use once a session should not sit
       where the ones you use constantly are. */
    nav.appendChild(el('button', {
      class: 'nav-toggle',
      title: T(state.collapsed ? 'nav.expand' : 'nav.collapse'),
      onclick: toggleCollapsed
    }, [
      icon(state.collapsed ? 'expand' : 'collapse'),
      el('span', { class: 'nav-label', text: T('nav.collapse') })
    ]));
  }

  function init() {
    load();
    document.body.classList.toggle('nav-collapsed', state.collapsed);
    render();
  }

  HR.nav = { init, render, toggleFavourite, toggleCollapsed, state: () => state, ICONS, icon };
})(window.HR);
