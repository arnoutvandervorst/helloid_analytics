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
    directory: null,       // AD/Entra collector export: pre-HelloID baseline
    granted: null,         // what HelloID believes is granted right now
    history: null,         // what HelloID did, when, why, and whether it worked
    demo: null,            // set while showing the published fictional tenant
    products: null,        // Service Automation product catalogue
    assignments: null,     // who holds which product, and who approved it
    raw: {},               // the text of each companion import, so a refresh can restore it
    importedAt: {},        // when each was loaded — decisions rest on how old these are
    fileNames: {},         // the name each came in under, so a restore does not invent one
    view: 'overview',
    params: {}
  };

  /* ------------------------------------------------------------- rendering */
  function render() {
    applyChromeBanner();
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const worksEmpty = state.view === 'settings' || state.view === 'snapshots' || state.view === 'sources' ||
      state.view === 'nedap' || state.view === 'fieldmap';
    if (!state.model && !worksEmpty) { emptyState(root); return; }
    const fn = HR.views[state.view] || HR.views.overview;
    const missing = HR.views.missingFor ? HR.views.missingFor(state.view) : [];
    try {
      root.appendChild(missing.length ? HR.views.gatePage(state.view, missing) : fn(state.model, state.params));
    } catch (err) {
      console.error(err);
      root.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: T('app.renderFail') }),
        el('p', { class: 'note', text: String(err && err.stack || err) })
      ]));
    }
    if (HR.nav) HR.nav.render();
    root.scrollTop = 0;
  }

  /** Everything above the shell, in pixels: the sidebar sizes itself against it. */
  function measureChrome() {
    const bar = document.querySelector('.topbar');
    const host = document.getElementById('demo-host');
    const h = (bar ? bar.offsetHeight : 47) + (host ? host.offsetHeight : 0);
    document.documentElement.style.setProperty('--chrome-h', h + 'px');
  }

  /* The banner is chrome, but it has to survive a re-render of the view it sits above. */
  function applyChromeBanner() {
    const host = document.getElementById('demo-host');
    if (!host) return;
    const wanted = !!state.demo;
    if (wanted === !!host.firstChild) return;
    host.innerHTML = '';
    const b = HR.demo.banner();
    if (b) host.appendChild(b);
    measureChrome();
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
  /* ---- busy veil -----------------------------------------------------------
     The model builds synchronously on the main thread, so an import or a
     re-score freezes the page for as long as it takes. The veil is shown first
     and the browser is given two frames plus a macrotask to actually paint it
     before the blocking work starts. Depth-counted, so a batch of imports (the
     demo set) shows one veil from first file to last. */
  let busyDepth = 0, busyEl = null, busyLabel = null;
  function busyVeil() {
    if (busyEl) return busyEl;
    busyLabel = el('span', {});
    busyEl = el('div', { id: 'busy-veil', hidden: true },
      el('div', { class: 'busy-box' }, [el('span', { class: 'busy-spin' }), busyLabel]));
    document.body.appendChild(busyEl);
    return busyEl;
  }
  async function withBusy(label, fn) {
    const v = busyVeil();
    busyDepth++;
    if (busyDepth === 1) busyLabel.textContent = label;   // a nested phase keeps the first label
    v.hidden = false;
    /* Double-rAF paints the veil before the synchronous work — but rAF is
       suspended in hidden tabs, which used to hang every import and snapshot
       restore started in the background. The timeout fallback lets those
       proceed unpainted. */
    await new Promise(resolve => {
      let done = false;
      const go = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 0)));
      setTimeout(go, 150);
    });
    try { return await fn(); }
    finally { busyDepth--; if (!busyDepth) v.hidden = true; }
  }
  const rebuildBusy = () => withBusy(T('busy.recalc'), () => rebuild());

  async function importText(text, fileName, opts) {
    return withBusy(T('busy.import'), () => importTextNow(text, fileName, opts));
  }

  async function importTextNow(text, fileName, opts) {
    opts = opts || {};
    /* One drop zone: route by what the file says it is. JSON is either a settings
       file, a snapshot bundle or a vault export. */
    if (/^\s*[{[]/.test(text)) return importJsonFile(text, fileName);
    if (HR.nedapons.sniffMappingCsv(text)) return importNedapMappingCsv(text);
    if (looksLikeRuleExport(text)) return importRules(text, fileName);
    if (looksLikeAssignmentExport(text)) return importAssignments(text, fileName);
    const activityKind = looksLikeActivityExport(text);
    if (activityKind) return importActivity(text, fileName, activityKind);

    if (isRulesEntitlementExport(headerOf(text))) {
      U.toast(T('toast.rulesEntitlements'), 10000);
      return;
    }

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
    state.noAutoRecon = false;
    HR.store.saveContext({ noAutoRecon: false });
    state.model = HR.model.build(parsed.records, buildOpts());

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
    state.review = (opts.quiet || HR.config.get().skipReview) ? null : HR.mine.suggest(state.model);
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
      if (HR.config.looksLikeProductMap(peek)) return 'productmap';
      if (HR.config.looksLikeMatchBook(peek)) return 'matchbook';
      if (HR.config.looksLikeNedapBook(peek)) return 'nedapbook';
      if (peek.kind === 'helloid-recon-snapshots' || Array.isArray(peek.snapshots)) return 'snapshots';
      if (HR.directory.looksLikeDirectory(peek)) return 'directory';
      if (HR.products.looksLikeProducts(peek)) return 'products';
      if (HR.fieldmap.looksLikeFieldMapping(peek)) return 'fieldmapping';
      if (HR.fieldmap.looksLikeSourceMapping(peek)) return 'sourcemapping';
      return 'vault';
    }
    const header = headerOf(text);
    if (!header || !header.length) return null;
    if (HR.nedapons.sniffMappingCsv(text)) return 'nedapmapping';
    if (HR.rules.looksLikeRules(header)) return 'rules';
    if (HR.products.looksLikeAssignments(header)) return 'assignments';
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
    if (kind === 'fieldmapping') kind = 'fieldMapping';   // slot id vs state key
    if (!['rules', 'vault', 'granted', 'history', 'products', 'assignments', 'directory', 'fieldMapping'].includes(kind)) return;
    state[kind] = null;
    if (kind === 'rules') state.ruleSet = null;
    delete state.raw[kind];
    delete state.importedAt[kind];
    delete state.fileNames[kind];
    HR.store.saveContext({ [kind]: null, importedAt: state.importedAt, fileNames: state.fileNames });
    withBusy(T('busy.recalc'), () => rebuild()).then(() =>
      U.toast(T('toast.sourceCleared', { kind: T('src.' + kind) }), 4000));
  }

  /**
   * Unload the reconciliation without touching the snapshot archive. The archive is
   * history; this only says "build from the companions for now". The flag survives a
   * reload, or the auto-load of the newest snapshot would bring the import straight back.
   */
  function clearRecon() {
    state.parsed = null;
    state.currentSnapshotId = null;
    state.noAutoRecon = true;
    HR.store.saveContext({ noAutoRecon: true });
    withBusy(T('busy.recalc'), () => rebuild()).then(() =>
      U.toast(T('toast.sourceCleared', { kind: T('src.recon') }), 4000));
  }

  /* HelloID → Rules → Entitlements exports under the same name as the two files this
     tool does read, so it will be dropped here sooner or later. It is the entitlement
     list from the rules' point of view: how many rules grant each one, and whether the
     target system still has it. Both are already derived from the business-rule export,
     so there is no slot for it — but "not recognised" would be the wrong thing to say
     about a file HelloID really produces. */
  const RULES_ENTITLEMENTS = ['systemdisplayname', 'entitlementdisplayname', 'rulescount'];

  function isRulesEntitlementExport(header) {
    const cols = (header || []).map(h => String(h || '').toLowerCase().replace(/[^a-z]/g, ''));
    return RULES_ENTITLEMENTS.every(c => cols.includes(c));
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
    } else {
      U.toast(T('toast.grantedLoaded', { n: U.fmtInt(parsed.meta.rowCount) }), 5000);
    }
    HR.usage.imported(parsed.kind, parsed.meta.rowCount);
    rebuild();
    go('activity');
  }

  function looksLikeAssignmentExport(text) {
    try { return HR.products.looksLikeAssignments(headerOf(text)); } catch (e) { return false; }
  }

  /** Product assignments: requested, approved, held. */
  async function importAssignments(text, fileName) {
    let parsed;
    try { parsed = HR.products.parseAssignments(text, fileName); }
    catch (err) { U.toast(err.message, 7000); return; }

    state.assignments = parsed;
    state.raw.assignments = text;
    state.importedAt.assignments = Date.now();
    state.fileNames.assignments = fileName;
    HR.store.saveContext({ assignments: text, importedAt: state.importedAt, fileNames: state.fileNames });
    HR.usage.imported('assignments', parsed.meta.rowCount);
    rebuild();
    U.toast(T('toast.assignmentsLoaded', {
      n: U.fmtInt(parsed.meta.rowCount), open: U.fmtInt(parsed.meta.openCount),
      products: parsed.meta.products
    }), 5000);
    go('products');
  }

  /** The product catalogue: price, risk factor, time limit, return behaviour. */
  async function importProducts(text, fileName) {
    let parsed;
    try { parsed = HR.products.parseProducts(text, fileName); }
    catch (err) { U.toast(err.message, 7000); return; }

    state.products = parsed;
    state.raw.products = text;
    state.importedAt.products = Date.now();
    state.fileNames.products = fileName;
    HR.store.saveContext({ products: text, importedAt: state.importedAt, fileNames: state.fileNames });
    HR.usage.imported('products', parsed.meta.rowCount);
    rebuild();
    U.toast(T('toast.productsLoaded', {
      n: parsed.meta.rowCount, tasks: parsed.meta.withActions
    }), 5000);
    go('products');
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
    if (peek && HR.config.looksLikeProductMap(peek)) {
      try {
        const res = HR.config.importMap(text, { merge: true });
        rebuild();
        U.toast(T('toast.productMapImported', res), 5000);
      } catch (err) { U.toast(err.message, 7000); }
      return;
    }
    if (peek && HR.config.looksLikeMatchBook(peek)) {
      try {
        const res = HR.config.importMatchBook(text, { merge: true });
        await withBusy(T('busy.recalc'), () => rebuild());
        U.toast(T('toast.matchBookImported', res), 5000);
      } catch (err) { U.toast(err.message, 7000); }
      return;
    }
    if (peek && HR.config.looksLikeNedapBook(peek)) {
      try {
        const res = HR.config.importNedapBook(text);
        /* Demo-loaded books are config, which "Leave demo" does not wipe —
           mark them so the demo exit can. */
        if (/^demo-/.test(fileName || '')) { HR.config.getNedapBook().demo = true; HR.config.save(); }
        await withBusy(T('busy.recalc'), () => rebuild());
        U.toast(T('toast.nedapBookImported', res), 5000);
        if (!/^demo-/.test(fileName || '')) go('nedap');
      } catch (err) { U.toast(err.message, 7000); }
      return;
    }
    if (peek && HR.directory.looksLikeDirectory(peek)) return importDirectory(text, fileName);
    if (peek && HR.products.looksLikeProducts(peek)) return importProducts(text, fileName);
    if (peek && HR.fieldmap.looksLikeFieldMapping(peek)) return importFieldMapping(text, fileName);
    if (peek && HR.fieldmap.looksLikeSourceMapping(peek)) {
      U.toast(T('toast.sourceMapping'), 9000);
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

  /**
   * The Nedap matrix workbook (.xlsx). Parsed in the browser, stored as the
   * editable Nedap book in config; the workbench exports the connector CSVs
   * from it. Import replaces the whole book — the workbook is the customer's
   * source of truth at hand-over time.
   */
  async function importWorkbook(buf, fileName) {
    return withBusy(T('busy.import'), async () => {
      let parsed;
      try {
        const sheets = await HR.xlsx.read(buf);
        parsed = HR.nedapons.parseWorkbook(sheets);
      } catch (err) {
        U.toast(T('toast.workbookFail', { name: fileName, msg: err.message }), 9000);
        return;
      }
      if (HR.nedapons.isEmptyBook(parsed.book)) {
        const first = parsed.errors[0];
        U.toast(first ? T(first.key, first.args) : T('toast.workbookEmpty', { name: fileName }), 9000);
        return;
      }
      HR.config.setNedapBook(parsed.book);
      if (parsed.errors.length) U.toast(T(parsed.errors[0].key, parsed.errors[0].args), 7000);
      rebuild();
      const b = parsed.book;
      U.toast(T('toast.workbookLoaded', {
        m: b.teamMappings.length + b.locationMappings.length,
        e: b.employees.length, r: b.roles.length
      }), 7000);
      HR.usage.imported('nedap-workbook', b.teamMappings.length + b.locationMappings.length + b.employees.length);
      go('nedap');
    });
  }

  /**
   * A running connector's Mapping-Teams.csv / Mapping-Locations.csv: raw IDs in,
   * translated to names through the book's lookup lists (unknown IDs join the
   * lists as id-named entries). Replaces that area's mapping rows in the book.
   */
  async function importNedapMappingCsv(text) {
    const parsed = HR.nedapons.parseMappingCsv(text);
    if (!parsed.rows) {
      const e = parsed.errors[0];
      U.toast(T(e.key, e.args), 7000);
      return;
    }
    if (parsed.errors.length) U.toast(T(parsed.errors[0].key, parsed.errors[0].args), 6000);
    const book = HR.config.getNedapBook();
    book.started = true;
    const res = HR.nedapons.applyMappingImport(book, parsed);
    HR.config.setNedapBook(book);
    rebuild();
    U.toast(T('toast.nedapMappingImported', {
      area: T('no.area.' + res.area), rows: res.rows, added: res.added
    }), 7000);
    HR.usage.imported('nedap-mapping-csv', res.rows);
    go('nedap', { tab: res.area });
  }

  /**
   * The pre-HelloID baseline: users, groups and nested memberships from the AD/Entra
   * collector scripts. It substitutes for the reconciliation and the vault only while
   * the real export of that kind is absent — rebuild() owns that precedence.
   */
  async function importDirectory(text, fileName) {
    let dir;
    try { dir = HR.directory.parse(text, fileName); }
    catch (err) { U.toast(err.message, 7000); return; }
    if (dir.warnings.length) U.toast(dir.warnings[0], 5000);

    state.directory = dir;
    state.raw.directory = text;
    state.importedAt.directory = Date.now();
    state.fileNames.directory = fileName;
    HR.store.saveContext({ directory: text, importedAt: state.importedAt, fileNames: state.fileNames });

    U.toast(T('toast.directoryLoaded', {
      u: U.fmtInt(dir.meta.userCount), g: U.fmtInt(dir.meta.groupCount) }), 7000);
    HR.usage.imported('directory', dir.meta.rowCount);
    rebuild();
    go('overview');
  }

  /**
   * A target connector's field mapping (the v1 MappingFields JSON, whether a
   * connector repo's fieldMapping.json or a HelloID UI export). Companion
   * source: it attaches to whatever population is loaded, and unlocks the
   * update simulation once a collected directory is present.
   */
  async function importFieldMapping(text, fileName) {
    let mapping;
    try { mapping = HR.fieldmap.parse(text, fileName); }
    catch (err) {
      U.toast(err.message === 'SOURCE_MAPPING' ? T('toast.sourceMapping') : err.message, 8000);
      return;
    }
    if (mapping.warnings.length) U.toast(mapping.warnings[0], 5000);

    state.fieldMapping = mapping;
    state.raw.fieldMapping = text;
    state.importedAt.fieldMapping = Date.now();
    state.fileNames.fieldMapping = fileName;
    HR.store.saveContext({ fieldMapping: text, importedAt: state.importedAt, fileNames: state.fileNames });
    HR.usage.imported('field-mapping', mapping.counts.fields);
    U.toast(T('toast.fieldMappingLoaded', {
      n: mapping.counts.fields, c: mapping.counts.complex, u: mapping.counts.updateScoped
    }), 7000);
    render();
    go('fieldmap');
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
    HR.usage.imported('rules', ruleSet.rules.length);
    rebuild();
    U.toast(T('toast.rulesLoaded', { n: ruleSet.rules.length }));
    go('rules');
  }

  function readFile(file, then) {
    const reader = new FileReader();
    /* Decode from bytes rather than trusting readAsText: a UTF-16 export would
       otherwise parse into mangled names instead of failing. */
    reader.onload = () => {
      /* Binary zip = the Nedap matrix workbook (.xlsx) — the one import that is
         not text. Route it before decoding mangles it. */
      if (HR.xlsx.isZip(reader.result)) { importWorkbook(reader.result, file.name); return; }
      const d = HR.parse.decode(reader.result); then(d.text, d.encoding);
    };
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
  let demoManifest = null;
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
    if (state.view === 'snapshots') render();
  }

  async function setBaseline(id, quiet) {
    if (!id) {
      state.baselineId = null; state.baselineModel = null; state.baselineSnapshot = null; state.diff = null;
    } else {
      await withBusy(T('busy.baseline'), async () => {
        const snap = await HR.store.get(id);
        if (!snap) { U.toast(T('toast.snapNotFound')); return; }
        state.baselineId = id;
        state.baselineSnapshot = snap;
        state.baselineModel = HR.model.build(snap.records, buildOpts());
        await recomputeDiff();
        if (!quiet) U.toast(T('toast.baselineSet', { name: snap.name }));
      });
    }
    updateTopbar();
    render();
  }

  async function recomputeDiff() {
    state.diff = (state.model && state.baselineModel) ? HR.diff.compare(state.model, state.baselineModel) : null;
  }

  async function loadSnapshot(id) {
    return withBusy(T('busy.snapshot'), () => loadSnapshotNow(id));
  }

  async function loadSnapshotNow(id) {
    const snap = await HR.store.get(id);
    if (!snap) { U.toast(T('toast.snapNotFound')); return; }
    state.currentSnapshotId = id;
    state.noAutoRecon = false;
    HR.store.saveContext({ noAutoRecon: false });
    state.parsed = { records: snap.records, meta: { fileName: snap.fileName, fingerprint: snap.fingerprint } };
    state.model = HR.model.build(snap.records, buildOpts());
    if (state.baselineId === id) await setBaseline(null);
    await recomputeDiff();
    updateTopbar();
    U.toast(T('toast.snapLoaded', { name: snap.name }));
    render();
  }

  /** Re-run the whole pipeline after a settings change. */
  /**
   * Loading several exports at once rebuilt the whole model after each one.
   *
   * Every import is a companion to the same reconciliation, so the first seven builds are
   * thrown away by the eighth — on the demo set that was eight full builds, five seconds,
   * for one useful result. Inside a batch the rebuild is remembered and run once at the
   * end; outside one nothing changes.
   */
  let batching = 0;
  let rebuildPending = false;

  async function batch(fn) {
    batching++;
    try { return await fn(); }
    finally {
      batching--;
      if (!batching && rebuildPending) { rebuildPending = false; rebuild(); }
    }
  }

  /* A directory import substitutes for the exports it can imitate — its synthesized
     records when no reconciliation is loaded, its pseudo-vault when no real vault is —
     and steps aside the moment the real thing arrives. */
  function effVault() {
    return state.vault || (state.directory ? state.directory.vault : null);
  }
  function effRecords() {
    if (state.parsed) return state.parsed.records;
    if (state.directory) return state.directory.records;
    return [];
  }
  function buildOpts() {
    return { ruleSet: state.ruleSet, vault: effVault(),
      granted: state.granted, history: state.history,
      products: state.products, assignments: state.assignments };
  }

  function rebuild() {
    if (batching) { rebuildPending = true; return; }
    const opts = buildOpts();
    /* Any export is enough to build on: a vault alone already answers people and
       organisation questions. The reconciliation deepens the model, it does not gate it. */
    const anySource = state.parsed || state.vault || state.directory || state.ruleSet ||
      state.granted || state.history || state.products || state.assignments;
    state.model = anySource ? HR.model.build(effRecords(), opts) : null;
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
    if (state.parsed || cur) {
      sources.push(T('src.recon') + ': ' + ((cur && cur.name) || (state.parsed && state.parsed.meta.fileName) || '—'));
    }
    if (state.ruleSet) sources.push(T('src.rules') + ': ' + state.ruleSet.rules.length);
    if (state.vault) sources.push(T('src.vault') + ': ' + state.vault.persons.length);
    if (state.directory) sources.push(T('src.directory') + ': ' + U.fmtInt(state.directory.meta.userCount));
    if (state.granted) sources.push(T('src.granted') + ': ' + state.granted.meta.rowCount);
    if (state.history) sources.push(T('src.history') + ': ' + U.fmtInt(state.history.meta.rowCount));
    if (state.products) sources.push(T('src.products') + ': ' + U.fmtInt(state.products.meta.rowCount));
    if (state.assignments) sources.push(T('src.assignments') + ': ' + U.fmtInt(state.assignments.meta.rowCount));

    const parts = [T('app.sources', { n: sources.length })];
    if (state.model.hasRecon) parts.push(U.fmtInt(s.accounts) + ' ' + T('app.accounts'));
    if (state.vault) parts.push(U.fmtInt(state.vault.persons.length) + ' ' + T('app.persons'));
    if (state.model.hasRecon) parts.push(T('app.riskShort') + ' ' + s.riskScore);
    if (state.baselineSnapshot) parts.push(T('app.vs') + ' ' + state.baselineSnapshot.name);

    sub.textContent = parts.join(' · ');
    sub.title = sources.join('\n');
  }

  /* ------------------------------------------------------------------ wire */
  /** Fill the static chrome (nav, buttons, labels) from the dictionary. */
  function applyChrome() {
    document.documentElement.lang = HR.i18n.lang;
    document.title = (HR.brand.state.productName || T('app.title'));
    const titleEl = document.getElementById('topbar-title');
    titleEl.textContent = HR.brand.state.productName || T('app.title');
    /* The version rides on the title, rebuilt here because the line above
       wipes it on every chrome refresh. Clicking it opens the changelog. */
    const ver = document.createElement('span');
    ver.id = 'topbar-ver';
    ver.textContent = 'v' + HR.changelog.VERSION;
    ver.title = T('app.versionTitle');
    ver.onclick = () => HR.viewkit.drawerChangelog();
    titleEl.append(' ', ver);
    document.getElementById('btn-import-label').textContent = T('app.import');
    document.getElementById('btn-theme').title = T('app.theme');
    const repo = document.getElementById('link-repo');
    repo.textContent = T('app.repo');
    repo.title = T('app.repoTitle');
    const ls = document.getElementById('lang-select');
    ls.title = T('app.language');
    ls.value = HR.i18n.lang;
    document.getElementById('drop-veil-text').textContent = T('app.drop');
    if (HR.nav) HR.nav.render();
    const host = document.getElementById('demo-host');
    host.innerHTML = '';
    const b = HR.demo.banner();
    if (b) host.appendChild(b);
    measureChrome();
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
    HR.demo.available().then(m => { demoManifest = m; if (m && state.view === 'sources') render(); });
    HR.brand.apply();
    applyChrome();

    /* One picker for six kinds of export could not say which file it wanted. The button
       now opens the Imports view, where each source has its own slot; dropping a file
       anywhere on the page still routes it on content. */
    document.getElementById('btn-import').addEventListener('click', () => go('sources'));
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

    HR.nav.init();
    measureChrome();
    window.addEventListener('resize', measureChrome);

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
      state.raw = { rules: ctx.rules, vault: ctx.vault, granted: ctx.granted, history: ctx.history,
        products: ctx.products, assignments: ctx.assignments, directory: ctx.directory,
        fieldMapping: ctx.fieldMapping };
      /* Context saved before import times were tracked still has one useful timestamp:
         when it was written. Better than showing nothing for every restored file. */
      state.importedAt = ctx.importedAt || {};
      state.fileNames = ctx.fileNames || {};
      state.demo = ctx.demo || null;
      state.noAutoRecon = !!ctx.noAutoRecon;
      const named = (k, fallback) => state.fileNames[k] || fallback;
      ['rules', 'vault', 'granted', 'history', 'products', 'assignments', 'directory'].forEach(k => {
        if (ctx[k] && !state.importedAt[k]) state.importedAt[k] = ctx.savedAt || null;
      });
      try { if (ctx.directory) state.directory = HR.directory.parse(ctx.directory, named('directory', 'directory.json')); } catch (e) { /* stale */ }
      try { if (ctx.fieldMapping) state.fieldMapping = HR.fieldmap.parse(ctx.fieldMapping, named('fieldMapping', 'fieldMapping.json')); } catch (e) { /* stale */ }
      try { if (ctx.rules) state.ruleSet = HR.rules.parse(ctx.rules, named('rules', 'rules.csv')); } catch (e) { /* stale */ }
      try { if (ctx.vault) state.vault = HR.vault.parse(ctx.vault, named('vault', 'vault.json')); } catch (e) { /* stale */ }
      try { if (ctx.granted) state.granted = HR.activity.parse(ctx.granted, named('granted', 'entitlements.csv')); } catch (e) { /* stale */ }
      try { if (ctx.history) state.history = HR.activity.parse(ctx.history, named('history', 'historicactions.csv')); } catch (e) { /* stale */ }
      try { if (ctx.products) state.products = HR.products.parseProducts(ctx.products, named('products', 'products.json')); } catch (e) { /* stale */ }
      try { if (ctx.assignments) state.assignments = HR.products.parseAssignments(ctx.assignments, named('assignments', 'product-assignments.csv')); } catch (e) { /* stale */ }
    });

    restoreContext.then(() => refreshSnapshots()).then(async () => {
      const v = location.hash.replace('#', '');
      if (v && HR.views[v]) state.view = v;
      if (state.snapshots.length && !state.noAutoRecon) {
        await loadSnapshot(state.snapshots[0].id);
        if (state.snapshots.length > 1) await setBaseline(state.snapshots[1].id, true);
      } else {
        rebuild();
      }
    });
  }

  const REPO_URL = 'https://github.com/arnoutvandervorst/helloid_analytics';

  HR.app = { REPO_URL, state, go, rebuild, rebuildBusy, batch, loadSnapshot, setBaseline, refreshSnapshots, importText, render, applyChrome,
    importFileAs, clearSource, clearRecon, detectKind, loadSample, findSample, sampleName: () => sampleFile || null,
    demoAvailable: () => demoManifest };
  document.addEventListener('DOMContentLoaded', init);
})(window.HR);
