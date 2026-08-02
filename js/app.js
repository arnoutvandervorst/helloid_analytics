/* Bootstrap: state, routing, import pipeline, snapshot + baseline wiring. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, T = (k, p) => HR.i18n.t(k, p);

  const state = {
    parsed: null,          // last parse result
    model: null,           // current model
    baselineModel: null,
    baselineSnapshot: null,
    baselineId: null,
    currentSnapshotId: null,
    snapshots: [],
    diff: null,
    review: null,          // pending configuration proposals for the current import
    view: 'overview',
    params: {}
  };

  /* ------------------------------------------------------------- rendering */
  function render() {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    if (!state.model && state.view !== 'settings' && state.view !== 'snapshots') { emptyState(root); return; }
    const fn = HR.views[state.view] || HR.views.overview;
    try {
      root.appendChild(fn(state.model, state.params));
    } catch (err) {
      console.error(err);
      root.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: T('app.renderFail') }),
        el('p', { class: 'note', text: String(err && err.stack || err) })
      ]));
    }
    document.querySelectorAll('.sidenav button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === state.view));
    root.scrollTop = 0;
  }

  function emptyState(root) {
    root.appendChild(el('section', { class: 'empty-state' }, [
      el('h1', { text: T('empty.title') }),
      el('p', { text: T('empty.body') }),
      el('p', {}, el('button', { class: 'btn', text: T('empty.sample'), onclick: loadSample })),
      el('p', { class: 'hint', text: T('empty.columns') })
    ]));
  }

  function go(view, params) {
    state.view = view; state.params = params || {};
    location.hash = view;
    render();
  }

  /* ---------------------------------------------------------------- import */
  async function importText(text, fileName) {
    let parsed;
    try { parsed = HR.parse.parse(text, fileName); }
    catch (err) { U.toast(err.message, 6000); return; }
    if (parsed.warnings.length) U.toast(parsed.warnings[0], 5000);

    state.parsed = parsed;
    state.model = HR.model.build(parsed.records);

    const snap = HR.store.makeSnapshot(parsed, state.model);
    const dup = state.snapshots.find(s => s.fingerprint === parsed.meta.fingerprint);
    if (dup) {
      state.currentSnapshotId = dup.id;
      U.toast(T('toast.duplicate', { name: dup.name }));
    } else {
      const res = await HR.store.put(snap);
      state.currentSnapshotId = snap.id;
      if (!res.persisted) U.toast(T('toast.noStorage'), 5000);
    }
    await refreshSnapshots();

    // Auto-baseline against the previous distinct import, if there is one.
    if (!state.baselineId) {
      const prev = state.snapshots.filter(s => s.id !== state.currentSnapshotId)[0];
      if (prev) await setBaseline(prev.id, true);
    } else {
      await recomputeDiff();
    }

    updateTopbar();

    /* First look at a new export: show what the settings do and do not describe about
       it, with rules mined from its own naming, before any number is presented. */
    state.review = HR.config.get().skipReview ? null : HR.mine.suggest(state.model);
    go(state.review ? 'review' : 'overview');
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importText(String(reader.result), file.name);
    reader.onerror = () => U.toast(T('toast.readFail'));
    reader.readAsText(file);
  }

  /* No export ships with the repo, so try the usual names: whatever the user dropped
     in the folder first, then the file make-sample.py writes. */
  const SAMPLE_FILES = ['ReconciliationReport.csv', 'sample-recon.csv'];

  async function loadSample() {
    for (const name of SAMPLE_FILES) {
      try {
        const res = await fetch(name);
        if (!res.ok) continue;
        const text = await res.text();
        if (/^\s*</.test(text)) continue;          // a 404 page, not a CSV
        importText(text, name);
        return;
      } catch (e) { /* not served, or file:// — try the next name */ }
    }
    U.toast(T('toast.sampleFail'), 8000);
  }

  /* ------------------------------------------------------------- snapshots */
  async function refreshSnapshots() {
    state.snapshots = await HR.store.list();
    const sel = document.getElementById('baseline-select');
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '', text: T('app.baselineNone') }));
    state.snapshots.forEach(s => sel.appendChild(el('option', {
      value: s.id, text: s.name + ' · ' + U.fmtDate(s.importedAt), selected: s.id === state.baselineId
    })));
    if (state.view === 'snapshots') render();
  }

  async function setBaseline(id, quiet) {
    if (!id) {
      state.baselineId = null; state.baselineModel = null; state.baselineSnapshot = null; state.diff = null;
    } else {
      const snap = await HR.store.get(id);
      if (!snap) { U.toast(T('toast.snapNotFound')); return; }
      state.baselineId = id;
      state.baselineSnapshot = snap;
      state.baselineModel = HR.model.build(snap.records);
      await recomputeDiff();
      if (!quiet) U.toast(T('toast.baselineSet', { name: snap.name }));
    }
    document.getElementById('baseline-select').value = state.baselineId || '';
    updateTopbar();
    render();
  }

  async function recomputeDiff() {
    state.diff = (state.model && state.baselineModel) ? HR.diff.compare(state.model, state.baselineModel) : null;
  }

  async function loadSnapshot(id) {
    const snap = await HR.store.get(id);
    if (!snap) { U.toast(T('toast.snapNotFound')); return; }
    state.currentSnapshotId = id;
    state.parsed = { records: snap.records, meta: { fileName: snap.fileName, fingerprint: snap.fingerprint } };
    state.model = HR.model.build(snap.records);
    if (state.baselineId === id) await setBaseline(null);
    await recomputeDiff();
    updateTopbar();
    U.toast(T('toast.snapLoaded', { name: snap.name }));
    render();
  }

  /** Re-run the whole pipeline after a settings change. */
  function rebuild() {
    if (state.parsed) state.model = HR.model.build(state.parsed.records);
    if (state.baselineSnapshot) state.baselineModel = HR.model.build(state.baselineSnapshot.records);
    recomputeDiff();
    updateTopbar();
    render();
  }

  function updateTopbar() {
    const sub = document.getElementById('topbar-sub');
    if (!state.model) { sub.textContent = T('app.noData'); return; }
    const s = state.model.summary;
    const cur = state.snapshots.find(x => x.id === state.currentSnapshotId);
    sub.textContent = (cur ? cur.name + ' · ' : '') +
      U.fmtInt(s.rows) + ' ' + T('app.rows') + ' · ' + U.fmtInt(s.accounts) + ' ' + T('app.accounts') +
      ' · ' + T('app.riskShort') + ' ' + s.riskScore +
      (state.baselineSnapshot ? ' · ' + T('app.vs') + ' ' + state.baselineSnapshot.name : '');
  }

  /* ------------------------------------------------------------------ wire */
  /** Fill the static chrome (nav, buttons, labels) from the dictionary. */
  function applyChrome() {
    document.documentElement.lang = HR.i18n.lang;
    document.title = (HR.brand.state.productName || T('app.title'));
    document.getElementById('topbar-title').textContent = HR.brand.state.productName || T('app.title');
    document.getElementById('btn-import-label').textContent = T('app.import');
    document.getElementById('baseline-label').textContent = T('app.baseline');
    document.getElementById('btn-theme').title = T('app.theme');
    const ls = document.getElementById('lang-select');
    ls.title = T('app.language');
    ls.value = HR.i18n.lang;
    document.getElementById('drop-veil-text').textContent = T('app.drop');
    document.querySelectorAll('.sidenav button[data-view]').forEach(btn => {
      btn.textContent = T('nav.' + btn.dataset.view);
    });
    updateTopbar();
  }

  function init() {
    HR.config.get();

    const langSel = document.getElementById('lang-select');
    HR.i18n.langs.forEach(l => langSel.appendChild(el('option', {
      value: l.id, text: l.label, selected: l.id === HR.i18n.lang
    })));
    langSel.addEventListener('change', e => HR.i18n.setLang(e.target.value));
    HR.i18n.onChange(() => { applyChrome(); rebuild(); refreshSnapshots(); });

    // Detection is async: repaint once the shipped logo turns up, or the first
    // render would keep the placeholder until the next navigation.
    HR.brand.detectAuto().then(found => { HR.brand.apply(); if (found) render(); });
    HR.brand.apply();
    applyChrome();

    document.getElementById('file-input').addEventListener('change', e => {
      handleFile(e.target.files[0]); e.target.value = '';
    });
    document.getElementById('baseline-select').addEventListener('change', e => setBaseline(e.target.value));
    document.getElementById('drawer-close').addEventListener('click', HR.views.closeDrawer);
    document.getElementById('drawer-scrim').addEventListener('click', HR.views.closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') HR.views.closeDrawer(); });

    document.getElementById('btn-theme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('hr.theme', next); } catch (e) { /* ignore */ }
    });
    try {
      const t = localStorage.getItem('hr.theme');
      if (t) document.documentElement.setAttribute('data-theme', t);
    } catch (e) { /* ignore */ }

    document.getElementById('sidenav').addEventListener('click', e => {
      const b = e.target.closest('button[data-view]');
      if (b) go(b.dataset.view);
    });

    /* drag & drop anywhere */
    const veil = document.getElementById('drop-veil');
    let dragDepth = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth === 1) veil.hidden = false; });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; veil.hidden = true; } });
    window.addEventListener('drop', e => {
      e.preventDefault(); dragDepth = 0; veil.hidden = true;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    window.addEventListener('hashchange', () => {
      const v = location.hash.replace('#', '');
      if (v && HR.views[v] && v !== state.view) { state.view = v; state.params = {}; render(); }
    });

    refreshSnapshots().then(async () => {
      const v = location.hash.replace('#', '');
      if (v && HR.views[v]) state.view = v;
      if (state.snapshots.length) {
        await loadSnapshot(state.snapshots[0].id);
        if (state.snapshots.length > 1) await setBaseline(state.snapshots[1].id, true);
      } else {
        render();
      }
    });
  }

  HR.app = { state, go, rebuild, loadSnapshot, setBaseline, refreshSnapshots, importText, render, applyChrome };
  document.addEventListener('DOMContentLoaded', init);
})(window.HR);
