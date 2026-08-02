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
    ruleSet: null,         // parsed HelloID business-rule export, when one is loaded
    vault: null,           // parsed HelloID Vault export: persons, contracts, attributes
    granted: null,         // what HelloID believes is granted right now
    history: null,         // what HelloID did, when, why, and whether it worked
    catalogue: null,       // the entitlement catalogue: rules per entitlement, still in target?
    raw: {},               // the text of each companion import, so a refresh can restore it
    importedAt: {},        // when each was loaded — decisions rest on how old these are
    fileNames: {},         // the name each came in under, so a restore does not invent one
    view: 'overview',
    params: {}
  };

  /* ------------------------------------------------------------- rendering */
  function render() {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const worksEmpty = state.view === 'settings' || state.view === 'snapshots' || state.view === 'sources';
    if (!state.model && !worksEmpty) { emptyState(root); return; }
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
      el('p', {}, [
        el('button', { class: 'btn primary', text: T('empty.sources'), onclick: () => go('sources') }),
        sampleFile ? el('button', { class: 'btn', style: 'margin-left:8px',
          text: T('src.sampleFile', { name: sampleFile }), onclick: loadSample }) : null
      ]),
      el('p', { class: 'hint', text: T('empty.columns') })
    ]));
  }

  function go(view, params) {
    state.view = view; state.params = params || {};
    location.hash = view;
    render();
    HR.usage.view(view);
  }

  /* ---------------------------------------------------------------- import */
  async function importText(text, fileName) {
    /* One drop zone: route by what the file says it is. JSON is either a settings
       file, a snapshot bundle or a vault export. */
    if (/^\s*[{[]/.test(text)) return importJsonFile(text, fileName);
    if (looksLikeRuleExport(text)) return importRules(text, fileName);
    const activityKind = looksLikeActivityExport(text);
    if (activityKind) return importActivity(text, fileName, activityKind);

    let parsed;
    try { parsed = HR.parse.parse(text, fileName); }
    catch (err) {
      /* Falling through to the reconciliation parser made every unrecognised export
         look like a broken reconciliation export. Say what is actually supported. */
      U.toast(T('toast.unknownFormat', { headers: (headerOf(text) || []).slice(0, 6).join(', ') }), 10000);
      return;
    }
    if (parsed.warnings.length) U.toast(parsed.warnings[0], 5000);

    state.parsed = parsed;
    state.model = HR.model.build(parsed.records, { ruleSet: state.ruleSet, vault: state.vault,
      granted: state.granted, history: state.history, catalogue: state.catalogue });

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
    HR.usage.imported('reconciliation', parsed.records.length);
    state.review = HR.config.get().skipReview ? null : HR.mine.suggest(state.model);
    go(state.review ? 'review' : 'overview');
  }

  /**
   * What kind of file is this, without parsing all of it.
   *
   * The import panel offers a slot per source, and a slot has to be able to say "that is
   * a vault export, not a rule export" before it loads anything — dropping a file into
   * the wrong slot should be refused, not silently filed somewhere else.
   */
  function detectKind(text) {
    if (/^\s*[{[]/.test(text)) {
      let peek = null;
      try { peek = JSON.parse(text); } catch (e) { return null; }
      if (HR.config.looksLikeSettings(peek)) return 'settings';
      if (peek.kind === 'helloid-recon-snapshots' || Array.isArray(peek.snapshots)) return 'snapshots';
      return 'vault';
    }
    const header = headerOf(text);
    if (!header || !header.length) return null;
    if (HR.rules.looksLikeRules(header)) return 'rules';
    const activity = HR.activity.classify(header);
    if (activity) return activity;
    if (HR.parse.looksLikeRecon(header)) return 'recon';
    return null;
  }

  /** Import into a named slot: refuse anything that is demonstrably a different export. */
  function importFileAs(file, expected) {
    if (!file) return;
    readFile(file, (text, encoding) => {
      const kind = detectKind(text);
      if (!kind) {
        U.toast(T('toast.unknownFormat', { headers: (headerOf(text) || []).slice(0, 6).join(', ') }), 10000);
        return;
      }
      if (expected && kind !== expected) {
        U.toast(T('toast.slotMismatch', { expected: T('src.' + expected), got: T('src.' + kind) }), 9000);
        return;
      }
      if (encoding !== 'utf-8' && encoding !== 'utf-8 (BOM)') {
        U.toast(T('toast.encoding', { encoding: encoding }), 4000);
      }
      importText(text, file.name);
    });
  }

  /** Drop a companion source without clearing the rest — each one stands on its own. */
  function clearSource(kind) {
    if (!['rules', 'vault', 'granted', 'history', 'catalogue'].includes(kind)) return;
    state[kind] = null;
    if (kind === 'rules') state.ruleSet = null;
    delete state.raw[kind];
    delete state.importedAt[kind];
    delete state.fileNames[kind];
    HR.store.saveContext({ [kind]: null, importedAt: state.importedAt, fileNames: state.fileNames });
    if (state.model) rebuild(); else render();
    U.toast(T('toast.sourceCleared', { kind: T('src.' + kind) }), 4000);
  }

  function headerOf(text) {
    try {
      const firstLine = text.split(/\r?\n/, 1)[0] || '';
      return HR.parse.parseDelimited(firstLine + '\n', HR.parse.sniffDelim(text))[0] || [];
    } catch (e) { return []; }
  }

  function looksLikeActivityExport(text) {
    try { return HR.activity.classify(headerOf(text)); } catch (e) { return null; }
  }

  /** Entitlements granted and historic actions: what HelloID granted, and what it did. */
  async function importActivity(text, fileName, kind) {
    let parsed;
    try { parsed = HR.activity.parse(text, fileName); }
    catch (err) { U.toast(err.message, 7000); return; }

    state[parsed.kind] = parsed;
    state.raw[parsed.kind] = text;
    state.importedAt[parsed.kind] = Date.now();
    state.fileNames[parsed.kind] = fileName;
    HR.store.saveContext({ [parsed.kind]: text, importedAt: state.importedAt, fileNames: state.fileNames });

    if (parsed.empty) {
      U.toast(T('toast.activityEmpty', { kind: T('act.kind.' + parsed.kind) }), 6000);
    } else if (parsed.kind === 'history') {
      U.toast(T('toast.historyLoaded', { n: U.fmtInt(parsed.meta.rowCount), days: parsed.meta.activeDays,
        span: parsed.meta.spanDays == null ? '\u2014' : parsed.meta.spanDays }), 5000);
    } else if (parsed.kind === 'catalogue') {
      U.toast(T('toast.catalogueLoaded', {
        n: U.fmtInt(parsed.meta.rowCount), gone: U.fmtInt(parsed.meta.orphanedCount),
        unruled: U.fmtInt(parsed.meta.unruledCount)
      }), 6000);
    } else {
      U.toast(T('toast.grantedLoaded', { n: U.fmtInt(parsed.meta.rowCount) }), 5000);
    }
    HR.usage.imported(parsed.kind, parsed.meta.rowCount);
    if (!state.model) { render(); return; }
    rebuild();
    go('activity');
  }

  function looksLikeRuleExport(text) {
    try {
      const firstLine = text.split(/\r?\n/, 1)[0] || '';
      const header = HR.parse.parseDelimited(firstLine + '\n', HR.parse.sniffDelim(text))[0] || [];
      return HR.rules.looksLikeRules(header);
    } catch (e) { return false; }
  }

  async function importJsonFile(text, fileName) {
    let peek = null;
    try { peek = JSON.parse(text); } catch (e) { /* handled below */ }
    if (peek && HR.config.looksLikeSettings(peek)) {
      try {
        const counts = HR.config.importJson(text);
        HR.app.applyChrome();
        rebuild();
        U.toast(T('toast.settingsImported', counts), 5000);
      } catch (err) { U.toast(err.message, 7000); }
      return;
    }
    if (peek && (peek.kind === 'helloid-recon-snapshots' || Array.isArray(peek.snapshots))) {
      try {
        const n = await HR.store.importJSON(text);
        await refreshSnapshots();
        U.toast(T('toast.importedSnaps', { n: n }));
      } catch (err) { U.toast(T('toast.importFail', { msg: err.message }), 5000); }
      return;
    }
    return importVault(text, fileName);
  }

  /** The vault attaches to whatever else is loaded; it is what makes conditions evaluable. */
  async function importVault(text, fileName) {
    let vault;
    try { vault = HR.vault.parse(text, fileName); }
    catch (err) { U.toast(err.message, 7000); return; }
    if (vault.warnings.length) U.toast(vault.warnings[0], 5000);

    state.vault = vault;
    state.raw.vault = text;
    state.importedAt.vault = Date.now();
    state.fileNames.vault = fileName;
    HR.store.saveContext({ vault: text, importedAt: state.importedAt, fileNames: state.fileNames });
    if (!state.model) {
      U.toast(T('toast.vaultNoRecon', { n: vault.persons.length }), 6000);
      render();
      return;
    }
    HR.usage.imported('vault', vault.persons.length);
    rebuild();
    U.toast(T('toast.vaultLoaded', {
      n: vault.persons.length, c: vault.meta.contractCount
    }), 5000);
    go(state.ruleSet ? 'rules' : 'people');
  }

  /** Business rules attach to whatever reconciliation export is loaded. */
  async function importRules(text, fileName) {
    let ruleSet;
    try { ruleSet = HR.rules.parse(text, fileName); }
    catch (err) { U.toast(err.message, 7000); return; }
    if (ruleSet.warnings.length) U.toast(ruleSet.warnings[0], 5000);

    state.ruleSet = ruleSet;
    state.raw.rules = text;
    state.importedAt.rules = Date.now();
    state.fileNames.rules = fileName;
    HR.store.saveContext({ rules: text, importedAt: state.importedAt, fileNames: state.fileNames });
    if (!state.model) {
      U.toast(T('toast.rulesNoRecon', { n: ruleSet.rules.length }), 6000);
      render();
      return;
    }
    HR.usage.imported('rules', ruleSet.rules.length);
    rebuild();
    U.toast(T('toast.rulesLoaded', { n: ruleSet.rules.length }));
    go('rules');
  }

  function readFile(file, then) {
    const reader = new FileReader();
    /* Decode from bytes rather than trusting readAsText: a UTF-16 export would
       otherwise parse into mangled names instead of failing. */
    reader.onload = () => { const d = HR.parse.decode(reader.result); then(d.text, d.encoding); };
    reader.onerror = () => U.toast(T('toast.readFail'));
    reader.readAsArrayBuffer(file);
  }

  function handleFile(file) {
    if (!file) return;
    readFile(file, (text, encoding) => {
      if (encoding !== 'utf-8' && encoding !== 'utf-8 (BOM)') {
        U.toast(T('toast.encoding', { encoding: encoding }), 4000);
      }
      importText(text, file.name);
    });
  }

  /* No export ships with the repo, so try the usual names: whatever the user dropped
     in the folder first, then the file make-sample.py writes. */
  const SAMPLE_FILES = ['ReconciliationReport.csv', 'sample-recon.csv'];

  /* The button only makes sense where an export actually sits next to index.html —
     the local server workflow. The hosted copy serves no CSV at all (and denies the
     extension), so offering it there is a button that can only fail. */
  let sampleFile = undefined;
  async function findSample() {
    if (sampleFile !== undefined) return sampleFile;
    sampleFile = null;
    if (location.protocol === 'file:') return sampleFile;
    for (const name of SAMPLE_FILES) {
      try {
        const res = await fetch(name, { method: 'HEAD' });
        if (res.ok && !/html/i.test(res.headers.get('content-type') || '')) { sampleFile = name; break; }
      } catch (e) { /* not served */ }
    }
    return sampleFile;
  }

  async function loadSample() {
    for (const name of SAMPLE_FILES) {
      try {
        const res = await fetch(name);
        if (!res.ok) continue;
        const text = HR.parse.decode(await res.arrayBuffer()).text;
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
      state.baselineModel = HR.model.build(snap.records, { ruleSet: state.ruleSet, vault: state.vault,
        granted: state.granted, history: state.history, catalogue: state.catalogue });
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
    state.model = HR.model.build(snap.records, { ruleSet: state.ruleSet, vault: state.vault,
      granted: state.granted, history: state.history, catalogue: state.catalogue });
    if (state.baselineId === id) await setBaseline(null);
    await recomputeDiff();
    updateTopbar();
    U.toast(T('toast.snapLoaded', { name: snap.name }));
    render();
  }

  /** Re-run the whole pipeline after a settings change. */
  function rebuild() {
    const opts = { ruleSet: state.ruleSet, vault: state.vault,
      granted: state.granted, history: state.history, catalogue: state.catalogue };
    if (state.parsed) state.model = HR.model.build(state.parsed.records, opts);
    if (state.baselineSnapshot) state.baselineModel = HR.model.build(state.baselineSnapshot.records, opts);
    recomputeDiff();
    updateTopbar();
    render();
  }

  function updateTopbar() {
    const sub = document.getElementById('topbar-sub');
    if (!state.model) { sub.textContent = T('app.noData'); return; }
    const s = state.model.summary;

    /* Naming the reconciliation file here was right when it was the only input. With a
       vault, rules and activity loaded it understated what the numbers rest on, so the
       bar now counts the sources and names them on hover. */
    const sources = [];
    const cur = state.snapshots.find(x => x.id === state.currentSnapshotId);
    sources.push(T('src.recon') + ': ' + ((cur && cur.name) || (state.parsed && state.parsed.meta.fileName) || '—'));
    if (state.ruleSet) sources.push(T('src.rules') + ': ' + state.ruleSet.rules.length);
    if (state.vault) sources.push(T('src.vault') + ': ' + state.vault.persons.length);
    if (state.granted) sources.push(T('src.granted') + ': ' + state.granted.meta.rowCount);
    if (state.history) sources.push(T('src.history') + ': ' + U.fmtInt(state.history.meta.rowCount));
    if (state.catalogue) sources.push(T('src.catalogue') + ': ' + U.fmtInt(state.catalogue.meta.rowCount));

    const parts = [
      T('app.sources', { n: sources.length }),
      U.fmtInt(s.accounts) + ' ' + T('app.accounts')
    ];
    if (state.vault) parts.push(U.fmtInt(state.vault.persons.length) + ' ' + T('app.persons'));
    parts.push(T('app.riskShort') + ' ' + s.riskScore);
    if (state.baselineSnapshot) parts.push(T('app.vs') + ' ' + state.baselineSnapshot.name);

    sub.textContent = parts.join(' · ');
    sub.title = sources.join('\n');
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
    const repo = document.getElementById('link-repo');
    repo.textContent = T('app.repo');
    repo.title = T('app.repoTitle');
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
    HR.usage.start();
    HR.brand.detectAuto().then(found => { HR.brand.apply(); if (found) render(); });
    /* Repaint once we know whether a sample is reachable, the same way the logo does. */
    findSample().then(name => { if (name && (state.view === 'sources' || !state.model)) render(); });
    HR.brand.apply();
    applyChrome();

    /* One picker for six kinds of export could not say which file it wanted. The button
       now opens the Imports view, where each source has its own slot; dropping a file
       anywhere on the page still routes it on content. */
    document.getElementById('btn-import').addEventListener('click', () => go('sources'));
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

    /* A reload used to lose the vault and the rules, which quietly downgraded views that
       depend on them — the People overview being the visible one. */
    const restoreContext = HR.store.loadContext().then(ctx => {
      if (!ctx) return;
      state.raw = { rules: ctx.rules, vault: ctx.vault, granted: ctx.granted, history: ctx.history, catalogue: ctx.catalogue };
      /* Context saved before import times were tracked still has one useful timestamp:
         when it was written. Better than showing nothing for every restored file. */
      state.importedAt = ctx.importedAt || {};
      state.fileNames = ctx.fileNames || {};
      const named = (k, fallback) => state.fileNames[k] || fallback;
      ['rules', 'vault', 'granted', 'history', 'catalogue'].forEach(k => {
        if (ctx[k] && !state.importedAt[k]) state.importedAt[k] = ctx.savedAt || null;
      });
      try { if (ctx.rules) state.ruleSet = HR.rules.parse(ctx.rules, named('rules', 'rules.csv')); } catch (e) { /* stale */ }
      try { if (ctx.vault) state.vault = HR.vault.parse(ctx.vault, named('vault', 'vault.json')); } catch (e) { /* stale */ }
      try { if (ctx.granted) state.granted = HR.activity.parse(ctx.granted, named('granted', 'entitlements.csv')); } catch (e) { /* stale */ }
      try { if (ctx.history) state.history = HR.activity.parse(ctx.history, named('history', 'historicactions.csv')); } catch (e) { /* stale */ }
      try { if (ctx.catalogue) state.catalogue = HR.activity.parse(ctx.catalogue, named('catalogue', 'entitlements.csv')); } catch (e) { /* stale */ }
    });

    restoreContext.then(() => refreshSnapshots()).then(async () => {
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

  const REPO_URL = 'https://github.com/arnoutvandervorst/helloid_analytics';

  HR.app = { REPO_URL, state, go, rebuild, loadSnapshot, setBaseline, refreshSnapshots, importText, render, applyChrome,
    importFileAs, clearSource, detectKind, loadSample, findSample, sampleName: () => sampleFile || null };
  document.addEventListener('DOMContentLoaded', init);
})(window.HR);
