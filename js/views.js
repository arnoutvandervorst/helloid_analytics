/* All views. Each render function returns a DocumentFragment / element that app.js
   mounts into #view-root. State lives in HR.app.state. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, C = HR.charts;
  const T = (k, p) => HR.i18n.t(k, p);

  /* ------------------------------------------------------------- primitives */
  /* ---------------------------------------------------- long text behind ⓘ
     Explanations grew into paragraphs. Past LONG characters a note shows only its lead
     — the first sentence or clause, cut at a word boundary — and an ⓘ; the whole text
     sits in the tooltip. Short notes stay inline. card(), tile() and the render
     post-pass in app.js all apply the same rule, so every screen behaves alike. */
  const LONG = 120;
  const LEAD_MAX = 90;
  function lead(text) {
    const full = String(text || '');
    if (full.length <= LONG) return { short: full, cut: false };
    const m = full.match(/^(.*?)(\.\s|\s\u2014\s|;\s)/);
    let head = m ? m[1] + (m[2].trim() === '.' ? '.' : '') : full;
    let cut = head.length < full.length;
    if (head.length > LEAD_MAX) {
      const sp = head.lastIndexOf(' ', LEAD_MAX);
      head = head.slice(0, sp > 40 ? sp : LEAD_MAX).replace(/[\s,;:\u2014.]+$/, '') + '\u2026';
      cut = true;
    }
    return { short: head, cut };
  }
  const tipText = full => () => '<div class="t-text">' + U.esc(full) + '</div>';
  /** The ⓘ that carries the full text. */
  function info(full) {
    return U.tip(el('span', { class: 'info', role: 'img', 'aria-label': T('c.more'), text: '\u24d8' }), tipText(full));
  }
  /** Fill `node` with `text`, collapsed behind ⓘ when long. Returns the node. */
  function explainInto(node, text) {
    const l = lead(text);
    node.textContent = l.short;
    if (l.cut) {
      node.classList.add('lead');
      node.appendChild(info(text));
      U.tip(node, tipText(text));
    }
    node.dataset.lead = '1';
    return node;
  }
  const explain = (text, cls) => explainInto(el('p', { class: cls || 'note' }), text);
  /** Collapse every plain long note under `root` that has not been handled yet. */
  function collapseNotes(root) {
    root.querySelectorAll('p.note, span.note, div.note, .view-head p').forEach(n => {
      if (n.dataset.lead || n.childElementCount || n.textContent.length <= LONG) return;
      explainInto(n, n.textContent);
    });
  }

  function card(title, note, children, cls) {
    const c = el('div', { class: 'card ' + (cls || '') });
    if (title) c.appendChild(el('h2', {}, [document.createTextNode(title), note ? explainInto(el('span', { class: 'card-note' }), note) : null]));
    (Array.isArray(children) ? children : [children]).forEach(ch => ch && c.appendChild(ch));
    return c;
  }

  function tile(label, value, foot, opts) {
    opts = opts || {};
    const t = el('div', { class: 'tile' + (opts.onClick ? ' click' : '') });
    t.appendChild(el('div', { class: 'label' }, [
      opts.severity ? el('span', { class: 'sev ' + opts.severity }) : null,
      document.createTextNode(label)
    ]));
    const v = el('div', { class: 'value' + (opts.small ? ' sm' : ''), text: value });
    if (opts.color) v.style.color = opts.color;
    t.appendChild(v);
    const footRow = el('div', { class: 'foot' });
    if (foot) explainInto(footRow, foot);
    if (opts.delta != null) {
      footRow.append(document.createTextNode(foot ? ' · ' : ''), deltaBadge(opts.delta, opts.deltaFormat, opts.inverse));
    }
    if (footRow.childNodes.length) t.appendChild(footRow);
    if (opts.onClick) t.addEventListener('click', opts.onClick);
    return t;
  }

  function deltaBadge(d, fmt, inverse) {
    const change = typeof d === 'object' ? d.change : d;
    const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '=';
    const txt = change === 0 ? T('df.noChange')
      : (change > 0 ? '+' : '−') + (fmt ? fmt(Math.abs(change)) : U.fmtInt(Math.abs(change)));
    return el('span', { class: 'delta ' + dir + (inverse ? ' inverse' : ''), text: arrow + ' ' + txt, title: T('df.vsBaseline') });
  }

  /**
   * Say plainly when a view is working from part of the picture. A number computed from
   * the reconciliation export alone is not wrong, but it answers a narrower question than
   * the reader assumes, and the fix is one drag-and-drop away.
   */
  function partialNotice(missing) {
    if (!missing.length) return null;
    return el('div', { class: 'notice' }, [
      el('strong', { text: T('nx.partial') }),
      el('span', { text: ' ' + missing.map(k => T('nx.needs.' + k)).join(' ') })
    ]);
  }

  /* The loaded imports do not look like one tenant: one line per pair that fails,
     and the way to the page that shows all of them. */
  const fitPairName = p => T('fit.name.' + p.a) + ' \u2194 ' + T('fit.name.' + p.b);
  function fitNotice(fit) {
    return el('div', { class: 'notice' }, [
      el('strong', { text: T('fit.title') }),
      el('span', { text: ' ' + fit.mismatches.map(p => T('fit.pair.' + p.key, { pct: U.fmtPct(p.share, 0) })).join(' ') + ' ' }),
      el('button', { class: 'btn ghost sm', text: T('fit.goSources'), onclick: () => HR.app.go('sources') })
    ]);
  }

  /** The Sources card: every judged pair with its overlap and verdict. */
  function fitCard() {
    const fit = HR.app.state.fit;
    if (!fit || !fit.pairs.length) return null;
    const rows = fit.pairs.map(p => el('div', { class: 'fit-row' + (p.level === 'small' ? ' small' : '') }, [
      el('span', { class: 'fit-pair', text: fitPairName(p) }),
      p.level === 'small'
        ? el('span', { class: 'note', text: T('fit.small') })
        : el('span', { class: 'fit-bar', title: p.sample.length ? T('fit.sampleTip') + ' ' + p.sample.join(' · ') : '' },
            [scoreBar(Math.round(p.share * 100)), el('span', { class: 'note', text: U.fmtInt(p.matched) + ' / ' + U.fmtInt(p.of) })]),
      el('span', { class: 'sev ' + (p.level === 'ok' ? 'good' : p.level === 'weak' ? 'medium' : p.level === 'mismatch' ? 'high' : 'low'),
        text: T('fit.' + p.level) })
    ]));
    return card(T('fit.cardTitle'), T('fit.cardNote'), el('div', { class: 'stack', style: 'gap:6px' }, rows));
  }

  /* A vault synthesized from a directory import answers different questions than a
     real one: the notice says where each shown field really comes from, and the
     mapping drawer spells out the whole translation with its caveats. */
  function syntheticVaultNotice(m) {
    if (!m || !m.vault || !m.vault.meta.synthetic) return null;
    const dir = HR.app.state.directory;
    return el('div', { class: 'notice' }, [
      el('strong', { text: T('syn.title') }),
      el('span', { text: ' ' + T('syn.body', { system: dir ? dir.meta.system : '—' }) + ' ' }),
      el('button', { class: 'btn ghost sm', text: T('syn.mapping'), onclick: showSyntheticMapping })
    ]);
  }

  function showSyntheticMapping() {
    const rows = [
      [T('c.employeeId'), 'employeeID / employeeNumber', T('syn.cav.emptyWhenUnfilled')],
      [T('syn.f.contractType'), 'employeeType', ''],
      [T('pp.department'), 'department', ''],
      [T('pp.jobTitle'), 'title', ''],
      [T('syn.f.employer'), 'company / companyName', ''],
      [T('syn.f.location'), 'physicalDeliveryOfficeName / officeLocation', ''],
      [T('syn.f.manager'), 'manager', T('syn.cav.managerResolved')],
      [T('syn.f.start'), 'whenCreated · Entra: employeeHireDate', T('syn.cav.start')],
      [T('syn.f.end'), 'accountExpires', T('syn.cav.end')],
      [T('syn.f.custom'), 'extensionAttribute1-15 · OU', ''],
      [T('syn.f.personCustom'), 'mail · phones · address', '']
    ];
    const t = el('table', { class: 'tbl' });
    t.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { class: 'no-sort', text: T('syn.thShown') }),
      el('th', { class: 'no-sort', text: T('syn.thSource') }),
      el('th', { class: 'no-sort', text: T('syn.thNote') })
    ])));
    t.appendChild(el('tbody', {}, rows.map(([shown, src, note]) => el('tr', {}, [
      el('td', { text: shown }),
      el('td', {}, el('span', { class: 'mono', text: src })),
      el('td', {}, note ? el('span', { class: 'note', text: note }) : null)
    ]))));
    const head = el('div', {}, el('h2', { text: T('syn.title') }));
    const body = el('div', { class: 'stack' }, [
      card(null, null, el('div', { class: 'tbl-wrap' }, t)),
      el('p', { class: 'note', text: T('syn.footer') })
    ]);
    openDrawer(head, body);
  }

  /* ------------------------------------------------------------ import gates */
  /* What each view cannot say anything without. Every entry is required; a
     pipe-separated entry is satisfied by any one of its options. Views absent
     here run on whatever is loaded and degrade with partialNotice instead. */
  const REQUIRES = {
    overview: ['recon'], policies: ['recon'], risk: ['recon'], cost: ['recon'],
    accounts: ['recon'], permissions: ['recon'],
    people: ['vault|recon'], org: ['vault'], matching: ['recon', 'vault'],
    mining: ['vault'], rules: ['rules'],
    products: ['products|assignments'], activity: ['granted|history'],
    explain: ['recon'], diff: ['recon'], board: ['recon'],
    conventions: ['recon|vault']
  };

  function hasSource(k) {
    const st = HR.app.state;
    if (k === 'recon') return !!(st.model && st.model.hasRecon);
    if (k === 'rules') return !!st.ruleSet;
    /* A directory import substitutes a synthesized vault while no real one is loaded. */
    if (k === 'vault') return !!(st.vault || (st.directory && st.directory.vault));
    return !!st[k];
  }

  const missingFor = view => (REQUIRES[view] || []).filter(req => !req.split('|').some(hasSource));

  /* The whole page, when a view has nothing to stand on: name the view, name the
     export(s) that unlock it, say what each one is and where in HelloID it lives. */
  function gatePage(view, missing) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('nav.' + view) }),
      el('p', { text: T('gate.lead') })
    ])));
    const rows = [];
    missing.forEach(req => req.split('|').forEach((k, i) => {
      if (i > 0) rows.push(el('p', { class: 'note', text: T('gate.or') }));
      rows.push(el('div', { class: 'gate-source' }, [
        el('strong', { text: T('src.' + k) }),
        el('p', { text: T('src.slot.' + k + '.unlocks') }),
        el('p', { class: 'note', text: T('src.slot.' + k + '.where') })
      ]));
    }));
    rows.push(el('p', { style: 'margin-top:12px' },
      el('button', { class: 'btn primary', text: T('empty.sources'), onclick: () => HR.app.go('sources') })));
    f.appendChild(card(T('gate.title'), null, rows));
    return f;
  }

  function bandPill(band) { return el('span', { class: 'sev ' + band, text: T('c.' + band) }); }

  function scoreBar(score) {
    const wrap = el('span');
    const bar = el('span', { class: 'scorebar' });
    const i = el('i');
    i.style.width = U.clamp(score, 0, 100) + '%';
    i.style.background = C.STATUS[HR.config.severityOf(score)];
    bar.appendChild(i);
    wrap.append(bar, el('span', { text: ' ' + score, class: 'mono' }));
    return wrap;
  }

  /**
   * A view in sections, one on screen at a time.
   *
   * Four of these views had grown to eight or nine cards, which is a scroll rather than a
   * page: nobody reads the ninth card because nobody knows it is there. Tabs also make
   * them cheaper — only the section on screen is built, and the mining sections in
   * particular are not free to build.
   *
   * The chosen tab lives in the route, so a link points at a section rather than a view.
   */
  function tabbed(view, sections, params) {
    const usable = sections.filter(Boolean);
    const wanted = (params && params.tab) || usable[0].id;
    const active = usable.find(s => s.id === wanted) || usable[0];

    const f = document.createDocumentFragment();
    const bar = el('div', { class: 'tabs', role: 'tablist' }, usable.map(section =>
      el('button', {
        class: 'tab' + (section === active ? ' active' : ''),
        role: 'tab',
        onclick: () => HR.app.go(view, { tab: section.id })
      }, [
        document.createTextNode(section.label),
        section.count != null
          ? el('span', { class: 'tab-count', text: U.fmtInt(section.count) })
          : null
      ].filter(Boolean))));
    f.appendChild(bar);

    const body = el('div', { class: 'tab-body' });
    let content = null;
    try { content = active.build(); }
    catch (err) {
      console.error(err);
      content = card(T('app.renderFail'), null, el('p', { class: 'note', text: String(err && err.message || err) }));
    }
    if (content) body.appendChild(content);
    f.appendChild(body);
    return f;
  }

  const dl = pairs => {
    const d = el('dl', { class: 'kv' });
    pairs.forEach(([k, v]) => { if (v == null) return; d.append(el('dt', { text: k }), el('dd', {}, typeof v === 'string' ? document.createTextNode(v) : v)); });
    return d;
  };

  const bDelta = key => {
    const b = HR.app.state.diff;
    return b ? b.summary[key] : null;
  };

  /**
   * What this analysis is standing on, and how old it is.
   *
   * Every number downstream is only as current as the file it came from, and the files
   * arrive separately: a reconciliation from last month next to a vault from this morning
   * describes two different organisations. Only some exports carry a date of their own —
   * where none exists, that is said rather than guessed at.
   */
  /** One line for any parser's health object; null when there is nothing to flag. */
  function healthSummary(h) {
    if (!h) return null;
    const bits = [];
    if (h.skippedEmpty || h.shortRows) bits.push(T('src.healthSkipped', { n: U.fmtInt((h.skippedEmpty || 0) + (h.shortRows || 0)) }));
    if (h.badDates) bits.push(T('src.healthBadDates', { n: U.fmtInt(h.badDates) }));
    if (h.noIdentity) bits.push(T('src.healthNoIdentity', { n: U.fmtInt(h.noIdentity) }));
    if (h.noContract) bits.push(T('src.healthNoContract', { n: U.fmtInt(h.noContract) }));
    if (h.badPrices) bits.push(T('src.healthBadPrices', { n: U.fmtInt(h.badPrices) }));
    if (h.noName) bits.push(T('src.healthNoName', { n: U.fmtInt(h.noName) }));
    if (h.oddDurations) bits.push(T('src.healthOddDurations', { n: U.fmtInt(h.oddDurations) }));
    return bits.length ? bits.join(' \u00b7 ') : null;
  }

  function sourcesCard(m) {
    const st = HR.app.state;
    const now = Date.now();
    const days = ts => ts ? Math.round((now - ts) / 86400000) : null;
    const rows = [];

    const snapshot = st.snapshots.find(x => x.id === st.currentSnapshotId);
    if (snapshot || st.parsed) rows.push({
      kind: T('src.recon'), loaded: snapshot ? snapshot.importedAt : null,
      dataDate: null,
      detail: T('src.reconDetail', { rows: U.fmtInt(m.summary.rows), accounts: m.summary.accounts }),
      file: snapshot ? snapshot.fileName : (st.parsed ? st.parsed.meta.fileName : '—'),
      health: st.parsed ? st.parsed.meta.health : null,
      loadedOnly: true
    });
    if (st.ruleSet) rows.push({
      kind: T('src.rules'), loaded: st.importedAt.rules, dataDate: null,
      detail: T('src.rulesDetail', { n: st.ruleSet.rules.length,
        live: st.ruleSet.rules.filter(r => r.status === 'published' || r.status === 'enabled').length }),
      file: st.ruleSet.meta.fileName, health: st.ruleSet.meta.health, loadedOnly: true
    });
    if (st.vault) rows.push({
      kind: T('src.vault'), loaded: st.importedAt.vault, dataDate: null,
      detail: T('src.vaultDetail', { n: st.vault.persons.length, c: st.vault.meta.contractCount }),
      file: st.vault.meta.fileName, health: st.vault.meta.health, loadedOnly: true
    });
    if (st.directory) rows.push({
      kind: T('src.directory'), loaded: st.importedAt.directory,
      dataDate: st.directory.meta.collectedAt,
      detail: T('src.directoryDetail', { u: U.fmtInt(st.directory.meta.userCount),
        g: U.fmtInt(st.directory.meta.groupCount), n: U.fmtInt(st.directory.meta.nestedEdges) })
        + (st.parsed ? '' : ' · ' + T('src.directorySubsRecon'))
        + (st.vault ? '' : ' · ' + T('src.directorySubsVault')),
      file: st.directory.meta.fileName, health: null
    });
    if (st.granted) rows.push({
      kind: T('src.granted'), loaded: st.importedAt.granted,
      dataDate: st.granted.meta.lastChange ? +st.granted.meta.lastChange : null,
      detail: st.granted.empty ? T('act.grantedEmpty') : T('src.grantedDetail', { n: U.fmtInt(st.granted.meta.rowCount) }),
      file: st.granted.meta.fileName, health: st.granted.meta.health
    });
    if (st.products) rows.push({
      kind: T('src.products'), loaded: st.importedAt.products, dataDate: null,
      detail: T('src.productsDetail', { n: st.products.meta.rowCount, tasks: st.products.meta.withActions }),
      file: st.products.meta.fileName, health: st.products.meta.health, loadedOnly: true
    });
    if (st.assignments) rows.push({
      kind: T('src.assignments'), loaded: st.importedAt.assignments,
      dataDate: st.assignments.meta.to ? +st.assignments.meta.to : null,
      detail: T('src.assignmentsDetail', { n: U.fmtInt(st.assignments.meta.rowCount),
        open: U.fmtInt(st.assignments.meta.openCount) }),
      file: st.assignments.meta.fileName, health: st.assignments.meta.health
    });
    if (st.history) rows.push({
      kind: T('src.history'), loaded: st.importedAt.history,
      dataDate: st.history.meta.to ? +st.history.meta.to : null,
      detail: T('src.historyDetail', { n: U.fmtInt(st.history.meta.rowCount),
        days: st.history.meta.activeDays, span: st.history.meta.spanDays == null ? '—' : st.history.meta.spanDays }),
      file: st.history.meta.fileName, health: st.history.meta.health
    });

    /* The spread between the newest and oldest evidence is what makes a comparison lie. */
    const dataDates = rows.map(r => r.dataDate).filter(Boolean);
    const loadDates = rows.map(r => r.loaded).filter(Boolean);
    const spreadDays = loadDates.length > 1
      ? Math.round((Math.max.apply(null, loadDates) - Math.min.apply(null, loadDates)) / 86400000) : 0;
    const oldest = dataDates.length ? Math.min.apply(null, dataDates) : null;

    const missing = [];
    if (!st.parsed && !st.currentSnapshotId) missing.push(T('src.recon'));
    if (!st.ruleSet) missing.push(T('src.rules'));
    if (!st.vault) missing.push(T('src.vault'));
    if (!st.history) missing.push(T('src.history'));
    if (!st.granted) missing.push(T('src.granted'));

    const table = HR.table.make({
      columns: [
        { key: 'kind', label: T('src.cKind'), value: r => r.kind },
        { key: 'file', label: T('src.cFile'), value: r => r.file },
        { key: 'detail', label: T('src.cContents'), value: r => r.detail },
        { key: 'dataDate', label: T('src.cDataDate'), value: r => r.dataDate || 0,
          render: r => r.dataDate
            ? el('span', { text: U.fmtDate(r.dataDate).split(',')[0] })
            : el('span', { class: 'note', text: T('src.noDate') }) },
        { key: 'loaded', label: T('src.cLoaded'), value: r => r.loaded || 0,
          render: r => r.loaded
            ? el('span', { text: T('src.daysAgo', { n: U.fmtInt(days(r.loaded)) }) })
            : el('span', { class: 'note', text: '—' }) },
        { key: 'health', label: T('src.cHealth'), value: r => healthSummary(r.health) ? 1 : 0,
          render: r => {
            const line = healthSummary(r.health);
            return line
              ? el('span', { class: 'slot-health', text: '\u26a0 ' + line })
              : el('span', { class: 'note', text: T('src.healthOk') });
          } }
      ],
      rows, pageSize: 10, exportName: 'sources'
    });

    const notes = [];
    if (spreadDays > 7) notes.push(T('src.spread', { n: spreadDays }));
    if (oldest && days(oldest) > 30) notes.push(T('src.stale', { n: U.fmtInt(days(oldest)) }));
    if (missing.length) notes.push(T('src.missing', { list: missing.join(', ') }));

    return card(T('src.title'), T('src.note'), [
      table,
      el('p', { style: 'margin-top:10px' },
        el('button', { class: 'btn ghost', text: T('src.manage'), onclick: () => HR.app.go('sources') })),
      notes.length ? el('p', { class: 'note', style: 'margin-top:10px', text: notes.join(' ') }) : null
    ].filter(Boolean));
  }


  /* ================================================================= SOURCES

     One import button routing on content was fine while there was one export. There
     are six now, they arrive at different moments from different screens in HelloID,
     and "did the vault load?" became a question the UI could not answer. So each
     source gets its own slot: what it is, what it unlocks, whether it is loaded, how
     old it is, and one button that only accepts that kind of file.                */

  const SOURCE_SLOTS = [
    { kind: 'recon',     accept: '.csv' },
    { kind: 'vault',     accept: '.json' },
    { kind: 'directory', accept: '.json' },
    { kind: 'rules',     accept: '.csv' },
    { kind: 'granted',   accept: '.csv' },
    { kind: 'history',   accept: '.csv' },
    { kind: 'products', accept: '.json' },
    { kind: 'assignments', accept: '.csv' },
    { kind: 'fieldmapping', accept: '.json' }
  ];

  function slotState(kind) {
    const st = HR.app.state;
    switch (kind) {
      case 'recon': {
        if (!st.parsed && !st.currentSnapshotId) return null;
        const snap = st.snapshots.find(x => x.id === st.currentSnapshotId);
        return {
          file: snap ? snap.fileName : (st.parsed ? st.parsed.meta.fileName : '—'),
          loaded: snap ? snap.importedAt : null,
          detail: T('src.reconDetail', { rows: U.fmtInt(st.model.summary.rows), accounts: st.model.summary.accounts }),
          health: st.parsed ? st.parsed.meta.health : null
        };
      }
      case 'rules':
        return st.ruleSet && { file: st.ruleSet.meta.fileName, loaded: st.importedAt.rules,
          detail: T('src.rulesDetail', { n: st.ruleSet.rules.length,
            live: st.ruleSet.rules.filter(r => r.status === 'published' || r.status === 'enabled').length }),
          health: st.ruleSet.meta.health };
      case 'vault':
        return st.vault && { file: st.vault.meta.fileName, loaded: st.importedAt.vault,
          detail: T('src.vaultDetail', { n: st.vault.persons.length, c: st.vault.meta.contractCount }),
          health: st.vault.meta.health };
      case 'directory':
        return st.directory && { file: st.directory.meta.fileName, loaded: st.importedAt.directory,
          detail: T('src.directoryDetail', { u: U.fmtInt(st.directory.meta.userCount),
            g: U.fmtInt(st.directory.meta.groupCount), n: U.fmtInt(st.directory.meta.nestedEdges) })
            + (st.parsed ? '' : ' · ' + T('src.directorySubsRecon'))
            + (st.vault ? '' : ' · ' + T('src.directorySubsVault')),
          health: st.directory.meta.health };
      case 'granted':
        return st.granted && { file: st.granted.meta.fileName, loaded: st.importedAt.granted,
          detail: st.granted.empty ? T('act.grantedEmpty')
            : T('src.grantedDetail', { n: U.fmtInt(st.granted.meta.rowCount) }),
          health: st.granted.meta.health };
      case 'history':
        return st.history && { file: st.history.meta.fileName, loaded: st.importedAt.history,
          detail: T('src.historyDetail', { n: U.fmtInt(st.history.meta.rowCount),
            days: st.history.meta.activeDays,
            span: st.history.meta.spanDays == null ? '—' : st.history.meta.spanDays }),
          health: st.history.meta.health };
      case 'products':
        return st.products && { file: st.products.meta.fileName, loaded: st.importedAt.products,
          detail: T('src.productsDetail', { n: st.products.meta.rowCount,
            tasks: st.products.meta.withActions }),
          health: st.products.meta.health };
      case 'assignments':
        return st.assignments && { file: st.assignments.meta.fileName, loaded: st.importedAt.assignments,
          detail: T('src.assignmentsDetail', { n: U.fmtInt(st.assignments.meta.rowCount),
            open: U.fmtInt(st.assignments.meta.openCount) }),
          health: st.assignments.meta.health };
      case 'fieldmapping':
        return st.fieldMapping && { file: st.fieldMapping.fileName, loaded: st.importedAt.fieldMapping,
          detail: T('src.fieldmappingDetail', { n: st.fieldMapping.counts.fields,
            c: st.fieldMapping.counts.complex, u: st.fieldMapping.counts.updateScoped }),
          health: null };
      default: return null;
    }
  }

  /** A file input that only ever hands its file to one slot. */
  function pickButton(label, accept, cls, onFile) {
    const wrap = el('label', { class: 'btn ' + (cls || '') });
    const input = el('input', { type: 'file', accept: accept, hidden: true });
    input.addEventListener('change', e => { onFile(e.target.files[0]); e.target.value = ''; });
    wrap.append(document.createTextNode(label), input);
    return wrap;
  }

  /* The collector scripts ship next to the app on a served copy, but not inside the
     single-file bundle and not over file:// — so the download buttons only appear
     once a probe has actually found them. Same guard as the brand-asset probe: a
     dev server's 404 page answers 200 with HTML. */
  let collectorProbe = null;
  function probeCollectors() {
    if (collectorProbe) return collectorProbe;
    collectorProbe = Promise.all(['collect-ad.ps1', 'collect-entra.ps1', 'docs/ENTRA-CONSENT.md'].map(path =>
      fetch(path, { method: 'HEAD' })
        .then(res => res.ok && !(res.headers.get('content-type') || '').includes('html') ? path : null)
        .catch(() => null)
    )).then(found => found.filter(Boolean));
    return collectorProbe;
  }

  function collectorDownloads() {
    const row = el('div', { class: 'slot-actions' });
    probeCollectors().then(found => {
      if (!found.length) return;
      found.forEach(path => row.appendChild(el('a', {
        class: 'btn sm', href: path, download: path.split('/').pop(),
        text: path.split('/').pop()
      })));
    });
    return row;
  }

  function sourceSlot(slot) {
    const st = slotState(slot.kind);
    const days = st && st.loaded ? Math.round((Date.now() - st.loaded) / 86400000) : null;

    /* Every import is optional now, so the only status worth a badge is "loaded". */
    const head = el('div', { class: 'slot-head' }, [
      el('span', { class: 'sev ' + (st ? 'good' : 'none') }),
      el('strong', { text: T('src.' + slot.kind) }),
      st ? el('span', { class: 'pill ok', text: T('src.slotLoaded') }) : null
    ]);

    const healthLine = st ? healthSummary(st.health) : null;

    const body = st
      ? el('div', {}, [
          el('div', { class: 'mono ellipsis', text: st.file }),
          el('div', { class: 'note', text: st.detail }),
          el('div', { class: 'note', text: st.loaded
            ? (days === 0 ? T('src.today') : T('src.daysAgo', { n: U.fmtInt(days) })) + ' · ' + U.fmtDate(st.loaded)
            : T('src.noDate') }),
          healthLine ? el('div', { class: 'note slot-health', text: '\u26a0 ' + healthLine }) : null
        ].filter(Boolean))
      : el('div', {}, [
          el('div', { class: 'note', text: T('src.slot.' + slot.kind + '.unlocks') }),
          el('div', { class: 'note', text: T('src.slot.' + slot.kind + '.where') }),
          slot.kind === 'directory' ? collectorDownloads() : null
        ].filter(Boolean));

    const actions = el('div', { class: 'slot-actions' }, [
      pickButton(st ? T('src.replace') : T('src.choose'), slot.accept, st ? '' : 'primary',
        f => HR.app.importFileAs(f, slot.kind)),
      st
        ? el('button', { class: 'btn ghost', text: T('src.remove'),
            onclick: () => slot.kind === 'recon' ? HR.app.clearRecon() : HR.app.clearSource(slot.kind) })
        : null,
      st && slot.kind === 'recon'
        ? el('button', { class: 'btn ghost', text: T('src.manageSnaps'),
            onclick: () => HR.app.go('snapshots') })
        : null
    ].filter(Boolean));

    return el('div', { class: 'card slot' + (st ? ' filled' : '') }, [head, body, actions]);
  }

  /* Somewhere to try the thing before handing it a real tenant export. */
  function demoCard() {
    const on = HR.demo.isOn();
    const m = HR.app.demoAvailable();
    return card(T('demo.title'), on ? T('demo.badge') : null, [
      el('p', { class: 'note', text: on ? T('demo.onNote') : T('demo.offNote') }),
      m && !on ? el('p', { class: 'note', text: T('demo.contents', {
        n: m.files.length, date: m.generatedOn || '\u2014' }) }) : null,
      el('div', { class: 'slot-actions' }, [
        on
          ? el('button', { class: 'btn danger', text: T('demo.exit'), onclick: () => HR.demo.exit() })
          : el('button', { class: 'btn primary', text: T('demo.load'), onclick: () => HR.demo.load() })
      ])
    ], on ? 'demo-card' : '');
  }

  function sourcesView() {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('src.pageTitle') }),
        el('p', { text: T('src.pageLead') })
      ])
    ]));

    /* One stack, one gap: the demo card, the slot grid and the tool's own files were
       three siblings whose spacing lived only inside the grid, so they sat flush. */
    const stack = el('div', { class: 'stack' });
    if (HR.demo.isOn() || HR.app.demoAvailable()) stack.appendChild(demoCard());
    stack.appendChild(el('div', { class: 'grid g3' }, SOURCE_SLOTS.map(sourceSlot)));
    const fits = fitCard();
    if (fits) stack.appendChild(fits);

    /* Not sources of truth about the tenant — settings and snapshot bundles are this
       tool's own files — so they sit apart from the slots above. */
    stack.appendChild(card(T('src.otherTitle'), null, [
      el('p', { class: 'note', text: T('src.otherNote') }),
      el('div', { class: 'slot-actions' }, [
        pickButton(T('src.settingsFile'), '.json', '', f2 => HR.app.importFileAs(f2, 'settings')),
        pickButton(T('src.snapshotBundle'), '.json', '', f2 => HR.app.importFileAs(f2, 'snapshots')),
        HR.app.sampleName() ? el('button', { class: 'btn ghost',
          text: T('src.sampleFile', { name: HR.app.sampleName() }), onclick: () => HR.app.loadSample() }) : null
      ].filter(Boolean))
    ]));
    f.appendChild(stack);

    f.appendChild(el('p', { class: 'note', style: 'margin-top:12px', text: T('src.privacy') }));
    /* Whoever hits a file this tool reads wrongly is the only one who can say so. */
    f.appendChild(el('p', { class: 'note', style: 'margin-top:4px' }, [
      document.createTextNode(T('src.repoNote') + ' '),
      el('a', { href: HR.app.REPO_URL + '/issues/new', target: '_blank', rel: 'noopener noreferrer',
        text: T('src.repoLink') })
    ]));
    return f;
  }


  /* ================================================================ OVERVIEW */
  function overview(m) {
    const f = document.createDocumentFragment();
    const s = m.summary;
    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('ov.title') }),
        el('p', { text: T('ov.lead', { rows: U.fmtInt(s.rows), accounts: s.accounts, perms: s.permissions, systems: s.systems }) })
      ])
    ]));

    f.appendChild(el('div', { class: 'grid', style: 'margin-bottom:14px' }, sourcesCard(m)));

    const kpis = el('div', { class: 'grid g4' });
    kpis.append(
      tile(T('ov.overallRisk'), String(s.riskScore), T('ov.weighted'), {
        severity: s.riskBand, delta: bDelta('riskScore'), onClick: () => HR.app.go('risk')
      }),
      tile(T('ov.unownedAccounts'), U.fmtInt(s.orphanAccounts),
        T('ov.stillEnabled', { n: s.orphanEnabled }), { severity: s.orphanEnabled ? 'critical' : 'good', delta: bDelta('orphanAccounts'), onClick: () => HR.app.go('accounts', { filter: 'orphan' }) }),
      tile(T('ov.unmanagedEnt'), U.fmtInt(s.unmanagedPermissionRows),
        T('ov.outsideModel'), { severity: 'medium', delta: bDelta('unmanagedPermissionRows'), onClick: () => HR.app.go('permissions') }),
      tile(T('ov.recoverable'), U.fmtMoney(s.wasteMonthly) + '/mo',
        T('ov.perYear', { amount: U.fmtMoney(m.cost.wasteAnnual) }), { severity: s.wasteMonthly > 0 ? 'high' : 'good', onClick: () => HR.app.go('cost') })
    );
    f.appendChild(kpis);

    const kpis2 = el('div', { class: 'grid g4' });
    kpis2.style.marginTop = '14px';
    kpis2.append(
      tile(T('ov.accounts'), U.fmtInt(s.accounts), T('ov.enabledDisabled', { e: s.enabledAccounts, d: s.disabledAccounts }), { small: true, delta: bDelta('accounts'), onClick: () => HR.app.go('accounts') }),
      tile(T('ov.coverage'), U.fmtPct(s.coverage, 0), T('ov.coverageFoot'), { small: true, severity: s.coverage > .9 ? 'good' : 'medium', onClick: () => HR.app.go('people') }),
      tile(T('ov.licenceSpend'), U.fmtMoney(s.monthlyCost) + '/mo', T('ov.pricedGroups', { n: m.cost.pricedPermissions }), { small: true, delta: bDelta('monthlyCost'), deltaFormat: U.fmtMoney, onClick: () => HR.app.go('cost', { tab: 'spend' }) }),
      tile(T('ov.cleanup'), U.fmtMoney(m.cost.remediationCost), T('ov.cleanupFoot', { h: Math.round(m.cost.remediation.hours), rate: U.fmtMoney(m.cost.remediation.rate) }), { small: true, onClick: () => HR.app.go('cost', { tab: 'case' }) })
    );
    f.appendChild(kpis2);

    const g = el('div', { class: 'grid g2' }); g.style.marginTop = '14px';

    /* issue mix */
    const issueColors = { 'Account unmanaged': C.STATUS.critical, 'Permission unmanaged': C.slot(1), 'Permission missing': C.STATUS.warning };
    const issueData = Object.entries(s.issueCounts).map(([k, v]) => ({
      label: k, value: v, color: issueColors[k] || C.slot(7),
      onClick: () => HR.app.go('accounts', { issue: k })
    }));
    g.appendChild(card(T('ov.issueMix'), U.fmtInt(s.rows) + ' ' + T('app.rows'), C.stackedBar(issueData)));

    /* account population */
    const pop = [
      { label: T('ov.managed'), value: s.accounts - s.orphanAccounts, color: C.slot(3) },
      { label: T('ov.unownedEnabled'), value: s.orphanEnabled, color: C.STATUS.critical },
      { label: T('ov.unownedDisabled'), value: s.orphanAccounts - s.orphanEnabled, color: C.STATUS.serious }
    ];
    g.appendChild(card(T('ov.population'), U.fmtInt(s.accounts) + ' ' + T('app.accounts'), C.stackedBar(pop)));

    /* risk distribution */
    g.appendChild(card(T('ov.riskDist'), T('ov.riskDistNote'),
      C.histogram(m.accountList.map(a => a.riskScore), {
        max: 100, bins: 10, unit: T('app.riskShort'), itemLabel: T('app.accounts'),
        onBin: (lo, hi) => HR.app.go('accounts', { riskMin: lo, riskMax: hi })
      })));

    /* top risky accounts */
    /* Ranked on the uncapped exposure so the top of the list still separates —
       many accounts pin at the 100 cap once they are unowned and privileged. */
    g.appendChild(card(T('ov.topAccounts'), T('ov.topAccountsNote'), C.barList(
      m.risk.topAccounts.slice(0, 10).map(a => ({
        label: a.userName, value: Math.round(a.riskRaw), color: C.STATUS[a.riskBand],
        onClick: () => drawerAccount(a),
        tip: '<div class="t-title">' + U.esc(a.userName) + '</div>' +
          '<div class="t-row"><span>' + T('ov.riskCapped') + '</span><b>' + a.riskScore + '</b></div>' +
          '<div class="t-row"><span>' + T('c.exposure') + '</span><b>' + Math.round(a.riskRaw) + '</b></div>' +
          '<div class="t-row"><span>' + T('dr.permsHeld') + '</span><b>' + a.permCount + '</b></div>' +
          '<div class="t-row"><span>' + T('ov.ownerTip') + '</span><b>' + U.esc(a.personName || T('ov.none')) + '</b></div>'
      })), { valueLabel: T('c.exposure') })));

    /* permission categories */
    const catRows = Array.from(U.by(m.permissionList, p => p.categoryLabel).entries())
      .map(([k, list]) => ({
        label: k, value: U.sum(list, p => p.holderCount), color: C.slot(list[0].colorSlot),
        note: T('ov.groupsNote', { n: list.length })
      })).sort((a, b) => b.value - a.value);
    g.appendChild(card(T('ov.byCategory'), T('ov.byCategoryNote'), C.barList(catRows, { valueLabel: T('c.assignments') })));

    /* cost by SKU */
    if (m.cost.bySku.length) {
      g.appendChild(card(T('ov.spendByGroup'), T('ov.spendByGroupNote'), C.barList(
        m.cost.bySku.slice(0, 10).map(x => ({
          label: x.name, value: x.monthly, color: C.slot(4),
          note: T('ov.holdersAt', { n: x.holders, price: U.fmtMoney(x.unit) })
        })), { format: v => U.fmtMoney(v), valueLabel: T('c.perMonth') })));
    }

    /* scatter: entitlement volume vs risk */
    /* One circle per account stops being readable — and stops being fast — long before
       the population does, so above the cap this shows an even sample and says so. */
    const SCATTER_CAP = 4000;
    const scatterAll = m.accountList.filter(a => a.permCount > 0);
    const step = Math.ceil(scatterAll.length / SCATTER_CAP);
    const scatterPoints = step > 1 ? scatterAll.filter((_, i) => i % step === 0) : scatterAll;
    g.appendChild(card(T('ov.scatter'),
      step > 1 ? T('ov.scatterSampled', { shown: U.fmtInt(scatterPoints.length), total: U.fmtInt(scatterAll.length) }) : T('ov.scatterNote'),
      C.scatter(
      scatterPoints.map(a => ({
        x: a.permCount, y: a.riskScore,
        r: 3 + Math.min(9, Math.sqrt(a.monthlyCost)),
        color: C.STATUS[a.riskBand],
        onClick: () => drawerAccount(a),
        tip: '<div class="t-title">' + U.esc(a.userName) + '</div>' +
          '<div class="t-row"><span>' + T('dr.permsHeld') + '</span><b>' + a.permCount + '</b></div>' +
          '<div class="t-row"><span>' + T('app.riskShort') + '</span><b>' + a.riskScore + '</b></div>' +
          '<div class="t-row"><span>' + T('dr.monthlyCost') + '</span><b>' + U.fmtMoney(a.monthlyCost) + '/mo</b></div>'
      })), { xLabel: T('ov.scatterX'), yLabel: T('app.riskShort'), maxY: 100, height: 300 })));

    /* class × band heatmap */
    const bands = ['critical', 'high', 'medium', 'low'];
    const classes = Array.from(U.by(m.accountList, a => a.clsLabel).entries());
    g.appendChild(card(T('ov.heat'), T('app.accounts'), C.heatmap(
      classes.map(([label, list]) => ({
        label,
        cells: bands.map(b => ({
          value: list.filter(a => a.riskBand === b).length,
          tip: '<div class="t-title">' + U.esc(label) + ' · ' + T('c.' + b) + '</div><div class="t-row"><span>' + T('app.accounts') + '</span><b>' +
            list.filter(a => a.riskBand === b).length + '</b></div>',
          onClick: () => HR.app.go('accounts', { cls: label, band: b })
        }))
      })), bands.map(b => T('c.' + b)), { corner: T('c.class') })));

    /* With the vault loaded, department is knowable — and where entitlement mass sits
       per department is a question the reconciliation export alone cannot answer. */
    if (m.vault) {
      const index = HR.correlate.personAccountIndex(m, m.vault, m.correlation);
      const cats = U.uniq(m.permissionList.map(p => p.categoryLabel)).slice(0, 8);
      const perDept = new Map();
      for (const entry of index.values()) {
        const pc = entry.person.primaryContract;
        const dept = pc ? (pc.department.name || pc.department.externalId || '—') : '—';
        if (!perDept.has(dept)) perDept.set(dept, { dept, people: 0, counts: new Map() });
        const row = perDept.get(dept);
        row.people++;
        entry.accounts.forEach(a => a.perms.forEach(p => {
          row.counts.set(p.categoryLabel, (row.counts.get(p.categoryLabel) || 0) + 1);
        }));
      }
      const deptRows = Array.from(perDept.values())
        .filter(r => U.sum(cats, c => r.counts.get(c) || 0) > 0)
        .sort((a, b) => U.sum(cats, c => b.counts.get(c) || 0) - U.sum(cats, c => a.counts.get(c) || 0))
        .slice(0, 14);
      if (deptRows.length) {
        g.appendChild(card(T('ov.deptHeat'), T('ov.deptHeatNote'), C.heatmap(
          deptRows.map(r => ({
            label: r.dept,
            cells: cats.map(c => ({
              value: r.counts.get(c) || 0,
              tip: '<div class="t-title">' + U.esc(r.dept) + ' · ' + U.esc(c) + '</div>' +
                '<div class="t-row"><span>' + T('c.assignments') + '</span><b>' + U.fmtInt(r.counts.get(c) || 0) + '</b></div>' +
                '<div class="t-row"><span>' + T('pp.persons') + '</span><b>' + r.people + '</b></div>'
            }))
          })), cats, { corner: T('pp.department') })));
      }
    }

    f.appendChild(g);

    f.appendChild(el('div', { class: 'grid' }, card(T('ov.systems'), null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.system') },
        { key: 'accountCount', label: T('ov.accounts'), num: true },
        { key: 'permissionCount', label: T('pm.title'), num: true },
        { key: 'rows', label: T('c.rowsCol'), num: true },
        { key: 'monthlySpend', label: T('c.costMo'), num: true, render: s => U.fmtMoney(s.monthlySpend) },
        { key: 'meanRisk', label: T('sy.meanRisk'), num: true, render: s => scoreBar(Math.round(s.meanRisk)) }
      ], rows: m.systemList, pageSize: 20, exportName: 'systems',
      onRowClick: s => drawerSystem(s, m)
    }))));
    return f;
  }

  /* =================================================================== RISK */
  function riskView(m, params) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('rk.title') }),
      el('p', { text: T('rk.lead') })
    ])));

    const top = el('div', { class: 'grid g4' });
    top.append(
      tile(T('ov.overallRisk'), String(m.risk.overall), T('c.' + m.summary.riskBand), { severity: m.summary.riskBand, delta: bDelta('riskScore') }),
      tile(T('rk.criticalFindings'), String(m.summary.criticalFindings), T('rk.actWeek'), { severity: 'critical' }),
      tile(T('rk.highFindings'), String(m.summary.highFindings), T('rk.actQuarter'), { severity: 'high' }),
      tile(T('rk.atHigh'), String((m.risk.bands.critical || 0) + (m.risk.bands.high || 0)), T('rk.ofN', { n: m.summary.accounts }), { severity: 'high' })
    );
    f.appendChild(top);

    /* The rest in tabs — the score build-up, the findings and the permission
       ranking are three different reads, not one scroll. */
    f.appendChild(tabbed('risk', [
      { id: 'findings', label: T('rk.tab.findings'), count: m.findings.length,
        build: () => riskFindings(m) },
      { id: 'score', label: T('rk.tab.score'), build: () => riskScoreTab(m) },
      { id: 'permissions', label: T('rk.tab.permissions'), build: () => riskPermsTab(m) },
      HR.sod ? { id: 'toxic', label: T('sod.tab'), count: HR.sod.evaluate(m).violations.length, build: () => riskToxicTab(m) } : null
    ].filter(Boolean), params));
    return f;
  }

  /* Toxic combinations: the pairs, who breaks them, and the two things that collide. */
  function riskToxicTab(m) {
    const sod = HR.sod.evaluate(m);
    const s = sod.summary;
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'grid g4', style: 'margin-bottom:14px' }, [
      tile(T('sod.kViolations'), U.fmtInt(s.violations), T('sod.kViolationsFoot', { critical: U.fmtInt(s.bySeverity.critical), high: U.fmtInt(s.bySeverity.high) }),
        { severity: s.bySeverity.critical ? 'critical' : s.violations ? 'high' : 'good' }),
      tile(T('sod.kAccounts'), U.fmtInt(s.accounts), T('sod.kAccountsFoot'), { small: true }),
      tile(T('sod.kPeople'), U.fmtInt(s.people), T('sod.kPeopleFoot'), { small: true }),
      tile(T('sod.kRules'), U.fmtInt(s.rules), T('sod.kRulesFoot', { hit: U.fmtInt(sod.byRule.filter(r => r.count).length) }), { small: true })
    ]));
    wrap.appendChild(card(T('sod.rulesTitle'), T('sod.rulesNote'), [
      C.barList(sod.byRule.map(r => ({ label: r.rule.label, value: r.count, sev: r.rule.severity })), { format: v => U.fmtInt(v) }),
      el('p', { class: 'note' }, [document.createTextNode(T('sod.editNote') + ' '),
        el('a', { href: '#', text: T('sod.editLink'), onclick: e => { e.preventDefault(); HR.app.go('settings', { tab: 'classification' }); } })])
    ]));
    const sideText = (v, side) => v[side] ? v[side].name : T('sod.accountType', { cls: T('cls.' + v.account.cls) || v.account.cls });
    wrap.appendChild(card(T('sod.violationsTitle'), null, HR.table.make({
      columns: [
        { key: 'severity', label: T('c.severity'), value: v => ({ critical: 0, high: 1, medium: 2 })[v.severity],
          render: v => el('span', { class: 'sev ' + v.severity, text: T('c.' + v.severity) }) },
        { key: 'rule', label: T('sod.cRule'), value: v => v.rule.label },
        { key: 'account', label: T('c.account'), value: v => v.account.userName },
        { key: 'person', label: T('c.person'), value: v => v.person || '', render: v => v.person ? el('span', { text: v.person }) : el('span', { class: 'note', text: T('c.unowned') }) },
        { key: 'a', label: T('sod.cA'), value: v => sideText(v, 'a') },
        { key: 'b', label: T('sod.cB'), value: v => sideText(v, 'b') }
      ],
      rows: sod.violations, pageSize: 25, exportName: 'toxic-combinations',
      initialSort: { key: 'severity', dir: 1 },
      search: (v, q) => (v.account.userName + ' ' + v.person + ' ' + v.rule.label).toLowerCase().includes(q),
      onRowClick: v => drawerAccount(v.account)
    })));
    return wrap;
  }

  /* How the overall number is built, and which classes and categories carry it. */
  function riskScoreTab(m) {
    const g = el('div', { class: 'grid g2' });
    g.appendChild(card(T('rk.formula'), null, [
      (() => {
        const t = el('table', { class: 'tbl' });
        const tb = el('tbody');
        m.risk.formula.forEach(x => {
          tb.appendChild(el('tr', {}, [
            el('td', { text: x.label }),
            el('td', { class: 'num', text: '×' + x.weight.toFixed(2) }),
            el('td', { class: 'num', text: U.fmtNum(x.value, 1) }),
            el('td', { class: 'num', text: U.fmtNum(x.value * x.weight, 1) })
          ]));
        });
        tb.appendChild(el('tr', {}, [el('td', { html: '<b>' + U.esc(T('rk.overall')) + '</b>' }), el('td', {}), el('td', {}),
          el('td', { class: 'num', html: '<b>' + m.risk.overall + '</b>' })]));
        t.appendChild(tb);
        return el('div', { class: 'tbl-wrap' }, t);
      })(),
      el('p', { class: 'note', text: T('rk.formulaNote') })
    ]));

    g.appendChild(card(T('rk.byClass'), null, HR.table.make({
      columns: [
        { key: 'key', label: T('c.class') },
        { key: 'accounts', label: T('ov.accounts'), num: true },
        { key: 'meanRisk', label: T('rk.meanRisk'), num: true, render: r => U.fmtNum(r.meanRisk, 1) },
        { key: 'maxRisk', label: T('rk.max'), num: true },
        { key: 'critical', label: T('c.critical'), num: true },
        { key: 'high', label: T('c.high'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) }
      ], rows: m.risk.byClass, pageSize: 12, exportName: 'risk-by-class',
      initialSort: { key: 'meanRisk', dir: -1 },
      onRowClick: r => HR.app.go('accounts', { cls: r.key })
    })));

    /* Who the accounts work for: the multiplier column explains why two accounts
       with the same access rank apart. */
    g.appendChild(card(T('rk.byEcat'), T('rk.byEcatNote'), HR.table.make({
      columns: [
        { key: 'key', label: T('c.empCategory') },
        { key: 'multiplier', label: T('st.multiplier'), num: true,
          render: r => { const c = (HR.config.get().employeeCategories || []).find(x => HR.config.labelOf(x) === r.key); return c ? '×' + c.multiplier : '—'; } },
        { key: 'accounts', label: T('ov.accounts'), num: true },
        { key: 'meanRisk', label: T('rk.meanRisk'), num: true, render: r => U.fmtNum(r.meanRisk, 1) },
        { key: 'maxRisk', label: T('rk.max'), num: true },
        { key: 'critical', label: T('c.critical'), num: true },
        { key: 'high', label: T('c.high'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) }
      ], rows: m.risk.byEmployeeCategory, pageSize: 12, exportName: 'risk-by-employee-category',
      initialSort: { key: 'meanRisk', dir: -1 },
      onRowClick: r => HR.app.go('accounts', { ecat: r.key })
    })));
    return g;
  }

  function riskFindings(m) {
    const list = el('div', { class: 'stack' });
    list.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn sm', text: T('rk.exportReport'),
        onclick: () => { HR.usage.exported('markdown-report');
          U.download('reconciliation-report.md', buildReport(m), 'text/markdown;charset=utf-8'); }
      }),
      el('button', {
        class: 'btn sm', text: T('rk.exportFindings'), onclick: () => {
          U.download('findings.csv', U.toCSV(m.findings.map(x => ({
            severity: x.severity, category: x.category, title: x.title, affected: x.count,
            monthlyImpact: Math.round(x.impactMonthly || 0), annualImpact: Math.round(x.annualImpact || 0),
            what: x.what, why: x.why, remediation: x.fix
          }))), 'text/csv;charset=utf-8');
        }
      })
    ]));
    m.findings.forEach(fd => list.appendChild(findingCard(fd, m)));
    return list;
  }

  function riskPermsTab(m) {
    return el('div', { class: 'grid' }, card(T('rk.topPerms'), T('rk.topPermsNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('c.permission'), render: r => el('a', { href: '#', text: r.name, onclick: e => { e.preventDefault(); drawerPermission(r, m); } }) },
        { key: 'categoryLabel', label: T('c.category') },
        { key: 'holderCount', label: T('c.holders'), num: true },
        { key: 'holdersOrphan', label: T('c.unowned'), num: true },
        { key: 'holdersDisabled', label: T('c.disabled'), num: true },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ], rows: m.permissionList.slice().sort((a, b) => b.riskScore - a.riskScore), pageSize: 15,
      exportName: 'permission-risk', initialSort: { key: 'riskScore', dir: -1 },
      search: (r, q) => r.name.toLowerCase().includes(q),
      onRowClick: r => drawerPermission(r, m)
    })));
  }

  function findingCard(fd, m) {
    const d = el('details', { class: 'finding' });
    const sum = el('summary');
    /* append() stringifies a null argument into the literal text "null", so filter. */
    sum.append(...[
      el('span', { class: 'sev ' + fd.severity, text: T('c.' + fd.severity) }),
      el('span', { class: 'f-title', text: fd.title }),
      el('span', { class: 'pill', text: fd.category }),
      el('span', { class: 'pill solid', text: T(fd.count === 1 ? 'rk.item' : 'rk.items', { n: fd.count }) }),
      fd.impactMonthly ? el('span', { class: 'pill', text: U.fmtMoney(fd.impactMonthly) + '/mo · ' + T(fd.recoverable ? 'rk.recoverable' : 'rk.atStake') }) : null
    ].filter(Boolean));
    d.appendChild(sum);
    const body = el('div', { class: 'f-body' });
    body.appendChild(dl([
      [T('rk.what'), fd.what],
      [T('rk.why'), fd.why],
      [T('rk.fix'), fd.fix],
      fd.impactMonthly ? [T('rk.impact'), T('rk.impactVal', { m: U.fmtMoney(fd.impactMonthly), y: U.fmtMoney(fd.annualImpact) })] : null
    ].filter(Boolean)));
    if (fd.entities.length) {
      const rows = fd.entities;
      body.appendChild(el('div', { style: 'margin-top:10px' }, HR.table.make({
        columns: [
          { key: 'label', label: T(fd.entities[0].type === 'permission' ? 'c.permission' : 'c.account') },
          { key: 'detail', label: T('rk.detail') }
        ],
        rows, pageSize: 15, exportName: 'finding-' + fd.id,
        search: (r, q) => (r.label + ' ' + r.detail).toLowerCase().includes(q),
        onRowClick: r => {
          if (r.type === 'account') { const a = m.accounts.get(r.key); if (a) drawerAccount(a); }
          else { const p = m.permissions.get(r.key); if (p) drawerPermission(p, m); }
        }
      })));
    }
    d.appendChild(body);
    return d;
  }


  /** Executive summary as Markdown — the thing that gets pasted into the report. */
  function buildReport(m) {
    const s = m.summary, c = m.cost, st = HR.app.state;
    const L = [];
    const row = (k, v) => L.push('| ' + k + ' | ' + v + ' |');
    L.push('# ' + T('md.title', { systems: m.systemList.map(x => x.name).join(', ') }));
    L.push('');
    L.push(T('md.source', {
      name: (st.snapshots.find(x => x.id === st.currentSnapshotId) || {}).name || '—',
      rows: U.fmtInt(s.rows), date: new Date().toLocaleString(HR.i18n.locale)
    }));
    if (st.baselineSnapshot) L.push(T('md.baseline', { name: st.baselineSnapshot.name, date: U.fmtDate(st.baselineSnapshot.importedAt) }));
    L.push('');
    L.push('## ' + T('md.headline'));
    L.push('');
    L.push('| ' + T('md.metric') + ' | ' + T('md.value') + ' |');
    L.push('| --- | --- |');
    row(T('md.mRisk'), s.riskScore + '/100 (' + T('c.' + s.riskBand) + ')');
    row(T('md.mAccounts'), T('md.mAccountsVal', { n: s.accounts, e: s.enabledAccounts, d: s.disabledAccounts }));
    row(T('md.mOrphan'), T('md.mOrphanVal', { n: s.orphanAccounts, e: s.orphanEnabled }));
    row(T('md.mCoverage'), U.fmtPct(s.coverage, 0));
    row(T('md.mUnmanaged'), U.fmtInt(s.unmanagedPermissionRows));
    row(T('md.mMissing'), U.fmtInt(s.missingPermissionRows));
    row(T('md.mSpend'), U.fmtMoney(c.totalMonthly) + '/mo · ' + U.fmtMoney(c.totalAnnual) + '/yr');
    row(T('md.mRecoverable'), U.fmtMoney(c.wasteMonthly) + '/mo · ' + U.fmtMoney(c.wasteAnnual) + '/yr');
    row(T('md.mCleanup'), U.fmtNum(c.remediation.hours, 0) + ' h ≈ ' + U.fmtMoney(c.remediationCost));
    if (c.paybackMonths) row(T('md.mPayback'), T('md.mPaybackVal', { n: U.fmtNum(c.paybackMonths, 1) }));
    L.push('');
    L.push('## ' + T('md.findings'));
    m.findings.forEach(f => {
      L.push('');
      L.push('### [' + T('c.' + f.severity).toUpperCase() + '] ' + f.title);
      L.push('');
      L.push('- **' + T('md.affected') + ':** ' + f.count);
      if (f.impactMonthly) L.push('- **' + T('md.money') + ':** ' + U.fmtMoney(f.impactMonthly) + '/mo · ' +
        U.fmtMoney(f.annualImpact) + '/yr (' + T(f.recoverable ? 'rk.recoverable' : 'rk.atStake') + ')');
      L.push('- **' + T('md.what') + ':** ' + f.what);
      L.push('- **' + T('md.why') + ':** ' + f.why);
      L.push('- **' + T('md.fix') + ':** ' + f.fix);
      if (f.entities.length) {
        L.push('- **' + T('md.examples') + ':** ' + f.entities.slice(0, 8).map(e => e.label).join(', ') +
          (f.entities.length > 8 ? ' … (' + f.entities.length + ' ' + T('md.total') + ')' : ''));
      }
    });
    L.push('');
    L.push('## ' + T('md.topAccounts'));
    L.push('');
    L.push('| ' + [T('c.account'), T('c.owner'), T('c.class'), T('c.perms'), T('c.risk'), T('md.drivers')].join(' | ') + ' |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    m.risk.topAccounts.slice(0, 15).forEach(a => L.push('| ' + [
      a.userName, a.personName || '—', a.clsLabel, a.permCount, a.riskScore,
      a.riskParts.slice(0, 3).map(p => p.label).join('; ')
    ].join(' | ') + ' |'));
    if (st.diff) {
      L.push('');
      L.push('## ' + T('md.change'));
      L.push('');
      L.push(st.diff.headline);
      L.push('');
      L.push('| ' + [T('c.finding'), T('c.was'), T('c.now'), T('c.change')].join(' | ') + ' |');
      L.push('| --- | --- | --- | --- |');
      st.diff.findings.filter(f => f.change).forEach(f => L.push('| ' + [
        f.title, f.was, f.now, (f.change > 0 ? '+' : '') + f.change
      ].join(' | ') + ' |'));
    }
    L.push('');
    L.push('---');
    L.push(T('md.disclaimer'));
    return L.join('\n');
  }

  /* =================================================================== COST */
  function costView(m, params) {
    const f = document.createDocumentFragment();
    const c = m.cost;
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('ct.title') }),
      el('p', { text: T('ct.lead') })
    ])));

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('ov.licenceSpend'), U.fmtMoney(c.totalMonthly) + '/mo', T('ov.perYear', { amount: U.fmtMoney(c.totalAnnual) }), { delta: bDelta('monthlyCost'), deltaFormat: U.fmtMoney, onClick: () => HR.app.go('cost', { tab: 'spend' }) }),
      tile(T('ct.recoverableNow'), U.fmtMoney(c.wasteMonthly) + '/mo', T('ov.perYear', { amount: U.fmtMoney(c.wasteAnnual) }), { severity: c.wasteMonthly ? 'high' : 'good', onClick: () => HR.app.go('cost', { tab: 'waste' }) }),
      tile(T('ct.outsideControl'), U.fmtMoney(c.unmanagedSpend) + '/mo', T('ct.outsideControlFoot'), { severity: 'medium', onClick: () => HR.app.go('permissions') }),
      tile(T('ov.cleanup'), U.fmtMoney(c.remediationCost), T('ct.cleanupFoot', { h: Math.round(c.remediation.hours) }) + (c.paybackMonths ? ' \u00b7 ' + T('ct.payback', { n: U.fmtNum(c.paybackMonths, 1) }) : ''), { small: true, onClick: () => HR.app.go('cost', { tab: 'case' }) })
    );
    f.appendChild(k);

    f.appendChild(tabbed('cost', [
      { id: 'waste', label: T('ct.tab.waste'), count: c.disabledHolders.length || null,
        build: () => costWasteTab(m) },
      { id: 'case', label: T('ct.tab.case'), build: () => costCaseTab(m) },
      { id: 'spend', label: T('ct.tab.spend'), build: () => costSpendTab(m) }
    ], params));
    return f;
  }

  function costWasteTab(m) {
    const c = m.cost;
    const f = document.createDocumentFragment();
    const buckets = [
      { label: T('ct.bucketDisabled'), value: c.disabledWaste, n: c.disabledHolders.length, color: C.STATUS.critical, hard: true },
      { label: T('ct.bucketStacked'), value: c.stackedWasteNet, n: c.stacked.length, color: C.STATUS.serious, hard: true },
      { label: T('ct.bucketOrphan'), value: c.orphanExposure, n: c.orphanEnabled.length, color: C.STATUS.warning, hard: false }
    ];
    f.appendChild(el('div', { class: 'grid' }, card(T('ct.leaks'), T('ct.leaksNote'), [
      C.barList(buckets.map(b => ({ label: b.label, value: b.value, color: b.color, note: T('ct.bucketFoot', { n: b.n }) })),
        { format: v => U.fmtMoney(v), valueLabel: T('c.perMonth') }),
      el('p', { class: 'note', text: T('ct.leaksNote2') })
    ])));

    f.appendChild(el('div', { class: 'grid', style: 'margin-top:14px' }, card(T('ct.disabledHolding'), T('ct.disabledHoldingNote', { n: c.disabledHolders.length, amount: U.fmtMoney(c.disabledWaste) }), HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account') },
        { key: 'displayName', label: T('c.displayName') },
        { key: 'perms', label: T('ct.paidGroups'), render: r => el('span', { class: 'trunc', text: r.perms.filter(p => p.monthlyPrice).map(p => p.name).join(', ') }) },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) }
      ], rows: c.disabledHolders, pageSize: 20, exportName: 'disabled-licensed',
      initialSort: { key: 'monthlyCost', dir: -1 },
      search: (r, q) => (r.userName + ' ' + r.displayName).toLowerCase().includes(q),
      onRowClick: a => drawerAccount(a)
    }))));
    return f;
  }

  function costCaseTab(m) {
    const c = m.cost;
    const g = el('div', { class: 'grid g2' });
    g.appendChild(card(T('ct.scenario'), null, savingsScenario(m)));
    g.appendChild(card(T('ct.effortModel'), T('ct.effortNote'), (() => {
      const r = c.remediation;
      const rows = [
        [T('ct.workUnmanagedPerms'), r.counts.unmanagedPerms, HR.config.get().effort.minutesPerUnmanagedPermission],
        [T('ct.workUnmanagedAccounts'), r.counts.unmanagedAccounts, HR.config.get().effort.minutesPerUnmanagedAccount],
        [T('ct.workMissingPerms'), r.counts.missingPerms, HR.config.get().effort.minutesPerMissingPermission],
        [T('ct.workPrivReview'), r.counts.privilegedReviews, HR.config.get().effort.minutesPerPrivilegedReview]
      ];
      const t = el('table', { class: 'tbl' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { class: 'no-sort', text: T('ct.workItem') }), el('th', { class: 'no-sort num', text: T('ct.count') }),
        el('th', { class: 'no-sort num', text: T('ct.minEach') }), el('th', { class: 'no-sort num', text: T('ct.hours') })])));
      const tb = el('tbody');
      rows.forEach(([lb, n0, mins]) => tb.appendChild(el('tr', {}, [
        el('td', { text: lb }), el('td', { class: 'num', text: U.fmtInt(n0) }),
        el('td', { class: 'num', text: String(mins) }), el('td', { class: 'num', text: U.fmtNum(n0 * mins / 60, 1) })
      ])));
      tb.appendChild(el('tr', {}, [el('td', { html: '<b>' + U.esc(T('ct.total')) + '</b>' }), el('td', {}), el('td', {}),
        el('td', { class: 'num', html: '<b>' + U.fmtNum(r.hours, 1) + '</b>' })]));
      t.appendChild(tb);
      return el('div', { class: 'tbl-wrap' }, t);
    })()));
    return g;
  }

  function costSpendTab(m) {
    const c = m.cost;
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'grid' }, card(T('ct.byCategory'), null, C.barList(c.byCategory.map(x => ({
      label: x.key, value: x.monthly, color: C.slot(4), note: T('ct.groupsN', { n: x.items })
    })), { format: v => U.fmtMoney(v), valueLabel: T('c.perMonth') }))));

    f.appendChild(el('div', { class: 'grid', style: 'margin-top:14px' }, card(T('ct.pricedGroups'), T('ct.pricedNote', { priced: c.pricedPermissions, unpriced: c.unpricedPermissions }), HR.table.make({
      columns: [
        { key: 'name', label: T('ct.group') },
        { key: 'label', label: T('ct.priceEntry') },
        { key: 'unit', label: T('c.unitMo'), num: true, render: r => U.fmtMoney(r.unit) },
        { key: 'holders', label: T('c.holders'), num: true },
        { key: 'disabled', label: T('c.disabled'), num: true },
        { key: 'orphan', label: T('c.unowned'), num: true },
        { key: 'monthly', label: T('ct.monthly'), num: true, render: r => U.fmtMoney(r.monthly) },
        { key: 'annual', label: T('ct.annual'), num: true, render: r => U.fmtMoney(r.annual) }
      ], rows: c.bySku, pageSize: 20, exportName: 'spend-by-group',
      initialSort: { key: 'monthly', dir: -1 },
      search: (r, q) => r.name.toLowerCase().includes(q),
      onRowClick: r => { const p = m.permissions.get(r.key); if (p) drawerPermission(p, m); }
    }))));
    return f;
  }

  function savingsScenario(m) {
    const wrap = el('div');
    const out = el('div');
    const state = { pct: 80, months: 12 };
    const rate = el('input', { type: 'range', min: 0, max: 100, value: state.pct, oninput: e => { state.pct = +e.target.value; draw(); } });
    rate.style.width = '100%';
    function draw() {
      const monthly = m.cost.wasteMonthly * state.pct / 100;
      const annual = monthly * 12;
      const net = annual - m.cost.remediationCost;
      out.innerHTML = '';
      out.append(
        el('div', { class: 'row' }, [
          el('div', { class: 'tile', style: 'flex:1' }, [
            el('div', { class: 'label', text: T('ct.actioned') }),
            el('div', { class: 'value sm', text: state.pct + '%' }),
            el('div', { class: 'foot', text: T('ct.removedMo', { amount: U.fmtMoney(monthly) }) })
          ]),
          el('div', { class: 'tile', style: 'flex:1' }, [
            el('div', { class: 'label', text: T('ct.year1') }),
            el('div', { class: 'value sm', text: U.fmtMoney(annual) }),
            el('div', { class: 'foot', text: T('ct.gross') })
          ]),
          el('div', { class: 'tile', style: 'flex:1' }, [
            el('div', { class: 'label', text: T('ct.netOf') }),
            el('div', { class: 'value sm', text: U.fmtMoney(net) }),
            el('div', { class: 'foot', text: T(net > 0 ? 'ct.paysItself' : 'ct.effortExceeds') })
          ])
        ])
      );
    }
    wrap.append(el('label', { class: 'inline', text: T('ct.scenarioLabel') }), rate, out);
    draw();
    return wrap;
  }

  /* =============================================================== ACCOUNTS */
  function accountsView(m, params) {
    params = params || {};
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('ac.title') }),
      el('p', { text: T('ac.lead') })
    ])));

    let rows = m.accountList;
    const notes = [];
    if (params.filter === 'orphan') { rows = rows.filter(a => a.orphan); notes.push(T('ac.fUnownedOnly')); }
    if (params.issue) { rows = rows.filter(a => a.issues[params.issue]); notes.push(T('ac.fIssue', { v: params.issue })); }
    if (params.cls) { rows = rows.filter(a => a.clsLabel === params.cls); notes.push(T('ac.fClass', { v: params.cls })); }
    if (params.ecat) { rows = rows.filter(a => a.ecatLabel === params.ecat); notes.push(T('ac.fEcat', { v: params.ecat })); }
    if (params.band) { rows = rows.filter(a => a.riskBand === params.band); notes.push(T('ac.fBand', { v: T('c.' + params.band) })); }
    if (params.riskMin != null) { rows = rows.filter(a => a.riskScore >= params.riskMin && a.riskScore <= params.riskMax); notes.push(T('ac.fRisk', { a: params.riskMin, b: params.riskMax })); }
    if (params.permKey) { rows = rows.filter(a => a.permKeys.has(params.permKey)); notes.push(T('ac.fHolders')); }

    if (notes.length) {
      f.appendChild(el('div', { class: 'row', style: 'margin-bottom:10px' }, [
        el('span', { class: 'pill solid', text: T('c.filtered', { what: notes.join(' · ') }) }),
        el('button', { class: 'btn sm', text: T('c.clear'), onclick: () => HR.app.go('accounts') })
      ]));
    }

    f.appendChild(card(null, null, HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account') },
        { key: 'displayName', label: T('c.displayName') },
        { key: 'personName', label: T('c.person'), render: r => r.personRaw ? el('span', { text: r.personName }) : el('span', { class: 'sev critical', text: T('c.unowned') }) },
        m.systemList.length > 1 ? { key: 'system', label: T('c.system') } : null,
        { key: 'clsLabel', label: T('c.class') },
        { key: 'ecatLabel', label: T('c.empCategory'), hint: T('ac.ecatHint'),
          render: r => el('span', { title: T('dr.ecatSource.' + (r.ecatSource || 'default')), text: r.ecatLabel }) },
        { key: 'enabled', label: T('c.state'), value: r => T(r.enabled === false ? 'c.disabled' : 'c.enabled'), render: r => el('span', { class: 'pill', text: T(r.enabled === false ? 'c.disabled' : 'c.enabled') }) },
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'unmanagedPermCount', label: T('c.unmanaged'), num: true },
        { key: 'missingCount', label: T('c.missing'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) },
        { key: 'outlier', label: T('c.outlier'), num: true, render: r => r.outlier == null ? '—' : U.fmtPct(r.outlier, 0), hint: T('ac.outlierHint') },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ].filter(Boolean),
      rows, pageSize: 40, exportName: 'accounts',
      initialSort: { key: 'riskScore', dir: -1 },
      searchPlaceholder: T('ac.searchPh'),
      search: (r, q) => (r.userName + ' ' + r.displayName + ' ' + r.personRaw + ' ' + r.clsLabel + ' ' + r.ecatLabel).toLowerCase().includes(q) ||
        r.perms.some(p => p.name.toLowerCase().includes(q)),
      filters: [
        m.systemList.length > 1 ? { key: 'sys', label: T('c.system'), options: m.systemList.map(s => ({ value: s.name, label: s.name })), match: (r, v) => r.system === v } : null,
        { key: 'state', label: T('c.state'), options: [{ value: 'enabled', label: T('c.enabled') }, { value: 'disabled', label: T('c.disabled') }], match: (r, v) => (v === 'disabled') === (r.enabled === false) },
        { key: 'owner', label: T('c.owner'), options: [{ value: 'owned', label: T('c.linked') }, { value: 'orphan', label: T('c.unowned') }], match: (r, v) => (v === 'orphan') === !!r.orphan },
        { key: 'cls', label: T('c.class'), options: U.uniq(m.accountList.map(a => a.clsLabel)).map(v => ({ value: v, label: v })), match: (r, v) => r.clsLabel === v },
        { key: 'ecat', label: T('c.empCategory'), options: U.uniq(m.accountList.map(a => a.ecatLabel)).filter(Boolean).map(v => ({ value: v, label: v })), match: (r, v) => r.ecatLabel === v },
        { key: 'band', label: T('c.risk'), options: ['critical', 'high', 'medium', 'low'].map(v => ({ value: v, label: T('c.' + v) })), match: (r, v) => r.riskBand === v }
      ].filter(Boolean),
      onRowClick: a => drawerAccount(a)
    })));
    return f;
  }

  /* ============================================================ PERMISSIONS */
  function permissionsView(m) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('pm.title') }),
      el('p', { text: T('pm.lead') })
    ])));

    const k = el('div', { class: 'grid g4' });
    const rare = m.permissionList.filter(p => p.rare).length;
    const priv = m.permissionList.filter(p => p.category === 'privileged' || p.category === 'server').length;
    k.append(
      tile(T('pm.distinct'), U.fmtInt(m.permissionList.length), T('pm.acrossSystems', { n: m.systemList.length }), { small: true, delta: bDelta('permissions') }),
      tile(T('pm.privInfra'), U.fmtInt(priv), T('pm.sensAtLeast'), { small: true, severity: 'high' }),
      tile(T('pm.rareGroups'), U.fmtInt(rare), T('pm.rareFoot', { n: HR.config.get().rarityThreshold }), { small: true, severity: 'medium' }),
      tile(T('pm.heldByUnowned'), U.fmtInt(m.permissionList.filter(p => p.holdersOrphan > 0).length), T('pm.heldByUnownedFoot'), { small: true, severity: 'high' })
    );
    f.appendChild(k);

    /* What the directory's own structure says about these groups: query-based
       (dynamic) groups are in-directory RBAC, nesting terminals are the groups
       that actually grant. Only speaks when a directory import is loaded. */
    const dir = HR.app.state.directory;
    if (!dir) {
      /* The recon flattens memberships — nesting and Entra group types only
         exist in the collector's envelope. Say so instead of silently having
         no structure to show. */
      f.appendChild(el('div', { style: 'margin-top:14px' },
        el('p', { class: 'note', text: T('pm.structHint') })));
    }
    if (dir && dir.groupMeta && (dir.meta.nestedEdges || dir.meta.dynamicGroups)) {
      const metas = Array.from(dir.groupMeta.values());
      const dynamics = metas.filter(g => g.dynamic);
      const roles = metas.filter(g => g.kind === 'role');
      const resources = metas.filter(g => g.kind === 'resource');
      const body = el('div', { class: 'stack' });
      body.appendChild(el('p', { class: 'note', text: T('pm.structCounts', {
        res: resources.length, role: roles.length, dyn: dynamics.length }) }));
      if (dynamics.length) {
        body.appendChild(card(T('pm.structDynTitle'), T('pm.structDynNote'), HR.table.make({
          columns: [
            { key: 'name', label: T('c.permission'), render: g => {
              const perm = m.permissionList.find(p => p.name === g.name);
              return perm
                ? el('a', { href: '#', text: g.name,
                    onclick: e => { e.preventDefault(); drawerPermission(perm, m); } })
                : el('span', { text: g.name });
            } },
            { key: 'rule', label: T('pm.structRule'), sortable: false,
              render: g => el('span', { class: 'mono trunc', title: g.membershipRule,
                text: g.membershipRule || '—' }) }
          ],
          rows: dynamics, pageSize: 8, exportName: 'dynamic-groups',
          search: (g, q) => (g.name + ' ' + g.membershipRule).toLowerCase().includes(q)
        })));
      }
      if (roles.length) {
        body.appendChild(card(T('pm.structRoleTitle'), T('pm.structRoleNote'), HR.table.make({
          columns: [
            { key: 'name', label: T('c.permission') },
            { key: 'feeds', label: T('pm.structFeeds'), sortable: false,
              render: g => el('span', { class: 'trunc', title: g.parentNames.join(', '),
                text: g.parentNames.join(', ') }) },
            { key: 'directUsers', label: T('pm.structMembers'), num: true }
          ],
          rows: roles, pageSize: 8, exportName: 'abstraction-groups',
          search: (g, q) => (g.name + ' ' + g.parentNames.join(' ')).toLowerCase().includes(q)
        })));
      }
      f.appendChild(el('div', { style: 'margin-top:14px' },
        card(T('pm.structTitle'), T('pm.structNote'), body)));
    }

    /* The suppliers, judged side by side — only worth a card when there is
       more than one of them. */
    const multi = m.systemList.length > 1;
    if (multi) {
      f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('sy.byTitle'), T('sy.byNote'), HR.table.make({
        columns: [
          { key: 'name', label: T('c.system') },
          { key: 'permissionCount', label: T('pm.title'), num: true },
          { key: 'monthlySpend', label: T('c.costMo'), num: true, render: s => U.fmtMoney(s.monthlySpend) },
          { key: 'unmanagedShare', label: T('sy.unmanagedShare'), num: true, render: s => U.fmtPct(s.unmanagedShare, 0) },
          m.comparison ? { key: 'cov', label: T('sy.coverage'), num: true,
            value: s => s.coverage && s.coverage.total ? s.coverage.modelled / s.coverage.total : 0,
            render: s => s.coverage && s.coverage.total
              ? scoreBar(Math.round(100 * s.coverage.modelled / s.coverage.total))
              : el('span', { class: 'note', text: '—' }) } : null,
          { key: 'meanRisk', label: T('sy.meanRisk'), num: true, render: s => scoreBar(Math.round(s.meanRisk)) }
        ].filter(Boolean),
        rows: m.systemList, pageSize: 10, exportName: 'permissions-by-system',
        onRowClick: s => drawerSystem(s, m)
      }))));
    }

    f.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.permission'),
          render: r => {
            const n = HR.config.getPermNote(r.name);
            return el('span', n ? { text: r.name, title: n } : { text: r.name });
          } },
        multi ? { key: 'system', label: T('c.system') } : null,
        { key: 'categoryLabel', label: T('c.category') },
        { key: 'sensitivity', label: T('c.sensitivity'), num: true, render: r => U.fmtNum(r.sensitivity, 1) },
        { key: 'holderCount', label: T('c.holders'), num: true },
        { key: 'holdersEnabled', label: T('c.enabled'), num: true },
        { key: 'holdersDisabled', label: T('c.disabled'), num: true },
        { key: 'holdersOrphan', label: T('c.unowned'), num: true },
        { key: 'monthlyPrice', label: T('c.unitMo'), num: true, render: r => r.monthlyPrice ? U.fmtMoney(r.monthlyPrice) : '—' },
        { key: 'monthlyTotal', label: T('c.totalMo'), num: true, render: r => r.monthlyTotal ? U.fmtMoney(r.monthlyTotal) : '—' },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ].filter(Boolean),
      rows: m.permissionList, pageSize: 40, exportName: 'permissions',
      initialSort: { key: 'riskScore', dir: -1 },
      searchPlaceholder: T('pm.searchPh'),
      search: (r, q) => (r.name + ' ' + r.path + ' ' + r.categoryLabel + ' ' + r.system).toLowerCase().includes(q),
      filters: [
        multi ? { key: 'sys', label: T('c.system'), options: m.systemList.map(s => ({ value: s.name, label: s.name })), match: (r, v) => r.system === v } : null,
        { key: 'cat', label: T('c.category'), options: U.uniq(m.permissionList.map(p => p.categoryLabel)).map(v => ({ value: v, label: v })), match: (r, v) => r.categoryLabel === v },
        { key: 'rare', label: T('c.rarity'), options: [{ value: 'rare', label: T('c.rare') }, { value: 'common', label: T('c.common') }], match: (r, v) => (v === 'rare') === !!r.rare },
        { key: 'priced', label: T('c.priced'), options: [{ value: 'yes', label: T('c.yes') }, { value: 'no', label: T('c.no') }], match: (r, v) => (v === 'yes') === (r.monthlyPrice > 0) }
      ].filter(Boolean),
      onRowClick: p => drawerPermission(p, m)
    }))));
    return f;
  }

  /* ================================================================= PEOPLE */
  /** Accounts belonging to each vault person, via the shared three-layer index. */
  function peopleIndex(m) {
    const map = HR.correlate.personAccountIndex(m, m.vault, m.correlation);
    m.vault.persons.forEach(p => { if (!map.has(p.personId)) map.set(p.personId, { person: p, accounts: [] }); });
    return map;
  }

  const STATE_SEV = { future: 'info', current: 'good', past: 'critical', unknown: 'medium' };

  /** The label for a contract state, wherever it is shown. */
  const stateLabel = state => T('pp.state' + state.charAt(0).toUpperCase() + state.slice(1));

  /**
   * Everything the person drawer needs, derived from a vault person.
   *
   * The People view builds these rows as it goes; the organisation walker has only a
   * person, so it needs the same shape from somewhere. Building it in one place keeps
   * the drawer from having to know which view opened it.
   */
  function personRow(m, person, index) {
    const entry = (index || peopleIndex(m)).get(person.personId) || { person, accounts: [] };
    const pc = person.primaryContract || person.contracts[0] || null;
    return {
      person,
      accounts: entry.accounts,
      perms: U.uniq(entry.accounts.flatMap(a => a.perms)),
      life: HR.vault.lifecycle(person),
      department: pc ? (pc.department.name || pc.department.externalId) : '',
      title: pc ? (pc.title.name || pc.title.code) : '',
      monthlyCost: U.sum(entry.accounts, a => a.monthlyCost),
      maxRisk: entry.accounts.length ? Math.max.apply(null, entry.accounts.map(a => a.riskScore)) : 0
    };
  }

  function offsetText(life) {
    if (life.days == null) return life.state === 'current' ? T('pp.noEnd') : '—';
    if (life.state === 'future') return T('pp.startsIn', { n: U.fmtInt(life.days) });
    if (life.state === 'current') return T('pp.endsIn', { n: U.fmtInt(life.days) });
    if (life.state === 'past') return T('pp.endedAgo', { n: U.fmtInt(life.days) });
    return '—';
  }

  function peopleView(m) {
    const f = document.createDocumentFragment();
    const hasVault = !!m.vault;

    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('pp.title') }),
      el('p', { text: hasVault
        ? T('pp.vaultLead', { n: m.vault.persons.length, c: m.vault.meta.contractCount })
        : T('pp.lead') })
    ])));

    if (!hasVault) {
      const note = partialNotice(['vault']);
      if (note) f.appendChild(note);
      return peopleFromRecon(m, f);
    }

    const index = peopleIndex(m);
    const rows = Array.from(index.values()).map(entry => {
      const life = HR.vault.lifecycle(entry.person);
      const perms = U.uniq(entry.accounts.flatMap(a => a.perms));
      const pc = entry.person.primaryContract;
      return {
        person: entry.person,
        accounts: entry.accounts,
        perms,
        life,
        department: pc ? (pc.department.name || pc.department.externalId) : '',
        title: pc ? (pc.title.name || pc.title.code) : '',
        monthlyCost: U.sum(entry.accounts, a => a.monthlyCost),
        maxRisk: entry.accounts.length ? Math.max.apply(null, entry.accounts.map(a => a.riskScore)) : 0
      };
    });

    /* A synthesized vault knows no lifecycle: its dates are account dates and every
       person carries exactly one pseudo-contract, so the state tiles, the contract
       columns and the joiner/leaver reading are withheld rather than shown wrong. */
    const synthetic = !!m.vault.meta.synthetic;
    if (synthetic) f.appendChild(syntheticVaultNotice(m));

    const k = el('div', { class: 'grid g4' });
    if (synthetic) {
      const depts = U.uniq(rows.map(r => r.department).filter(Boolean)).length;
      const withId = rows.filter(r => r.person.externalId).length;
      const withMgr = rows.filter(r => {
        const pc = r.person.primaryContract;
        return pc && pc.manager && pc.manager.displayName;
      }).length;
      k.append(
        tile(T('pp.persons'), U.fmtInt(rows.length), T('pp.personsFoot'), { small: true }),
        tile(T('syn.departments'), U.fmtInt(depts), T('pp.department'), { small: true }),
        tile(T('syn.withEmployeeId'), U.fmtInt(withId), U.fmtPct(rows.length ? withId / rows.length : 0, 0), { small: true, severity: withId === rows.length ? 'good' : 'medium' }),
        tile(T('syn.withManager'), U.fmtInt(withMgr), U.fmtPct(rows.length ? withMgr / rows.length : 0, 0), { small: true, severity: withMgr ? 'good' : 'medium' })
      );
    } else {
      const counts = U.counts(rows, r => r.life.state);
      k.append(
        tile(T('pp.persons'), U.fmtInt(rows.length), T('pp.personsFoot'), { small: true }),
        tile(T('pp.stateCurrent'), U.fmtInt(counts.get('current') || 0), T('pp.contracts'), { small: true, severity: 'good' }),
        tile(T('pp.statePast'), U.fmtInt(counts.get('past') || 0), T('pp.statePast'), { small: true, severity: (counts.get('past') || 0) ? 'critical' : 'good' }),
        tile(T('pp.stateFuture'), U.fmtInt(counts.get('future') || 0), T('pp.stateFuture'), { small: true, severity: 'info' })
      );
    }
    f.appendChild(k);

    let outliers = null;
    try { outliers = m.hasRecon && HR.outlier ? HR.outlier.build(m) : null; } catch (e) { outliers = null; }
    const columns = [
      { key: 'name', label: T('c.person'), value: r => r.person.displayName },
      { key: 'externalId', label: T('c.employeeId'), value: r => r.person.externalId,
        render: r => r.person.externalId ? el('span', { text: r.person.externalId }) : el('span', { class: 'note', text: '—' }) },
      !synthetic ? { key: 'state', label: T('pp.state'), value: r => r.life.state,
        render: r => el('span', { class: 'sev ' + STATE_SEV[r.life.state], text: stateLabel(r.life.state) }) } : null,
      !synthetic ? { key: 'offset', label: T('pp.offset'), num: true, hint: T('pp.offsetHint'),
        value: r => r.life.state === 'past' ? -(r.life.days || 0) : (r.life.days == null ? 1e9 : r.life.days),
        render: r => offsetText(r.life) } : null,
      !synthetic ? { key: 'contracts', label: T('pp.contracts'), num: true, value: r => r.person.contracts.length } : null,
      { key: 'department', label: T('pp.department'), value: r => r.department },
      { key: 'title', label: T('pp.jobTitle'), value: r => r.title },
      { key: 'accounts', label: T('pp.accounts'), num: true, value: r => r.accounts.length },
      { key: 'perms', label: T('c.perms'), num: true, value: r => r.perms.length },
      { key: 'cost', label: T('c.costMo'), num: true, value: r => r.monthlyCost, render: r => U.fmtMoney(r.monthlyCost) },
      { key: 'risk', label: T('pp.maxRisk'), num: true, value: r => r.maxRisk, render: r => r.accounts.length ? scoreBar(r.maxRisk) : '—' },
      outliers ? { key: 'outlier', label: T('ol.col'), num: true, hint: T('ol.colHint'),
        value: r => { const o = outliers.byPerson.get(r.person.personId); return o ? o.score : -1; },
        render: r => { const o = outliers.byPerson.get(r.person.personId); return o ? scoreBar(o.score) : el('span', { class: 'note', text: '\u2014' }); } } : null
    ].filter(Boolean);

    if (outliers && outliers.rows.length) {
      f.appendChild(el('div', { class: 'grid g4', style: 'margin-top:14px' }, [
        tile(T('ol.kHigh'), U.fmtInt(outliers.summary.high), T('ol.kHighFoot', { of: U.fmtInt(outliers.summary.people), mean: outliers.summary.mean }),
          { severity: outliers.summary.high ? 'medium' : 'good', small: true })
      ]));
    }
    f.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns,
      rows, pageSize: 40, exportName: 'people',
      initialSort: synthetic ? { key: 'risk', dir: -1 } : { key: 'state', dir: 1 },
      search: (r, q) => (r.person.displayName + ' ' + r.person.externalId + ' ' + r.department + ' ' + r.title +
        ' ' + r.accounts.map(a => a.userName).join(' ')).toLowerCase().includes(q),
      filters: [
        !synthetic ? { key: 'state', label: T('pp.state'),
          options: ['current', 'past', 'future', 'unknown'].map(v => ({ value: v, label: T('pp.state' + v.charAt(0).toUpperCase() + v.slice(1)) })),
          match: (r, v) => r.life.state === v } : null,
        { key: 'accounts', label: T('pp.accounts'),
          options: [{ value: 'with', label: '1+' }, { value: 'without', label: '0' }],
          match: (r, v) => (v === 'with') === (r.accounts.length > 0) }
      ].filter(Boolean),
      onRowClick: r => drawerVaultPerson(r, m)
    }))));
    return f;
  }

  /** The pre-vault view: persons as the reconciliation export knows them. */
  function peopleFromRecon(m, f) {
    const multi = m.personList.filter(p => p.accountCount > 1).length;
    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('pp.persons'), U.fmtInt(m.personList.length), T('pp.personsFoot'), { small: true, delta: bDelta('persons') }),
      tile(T('pp.multi'), U.fmtInt(multi), T('pp.multiFoot'), { small: true, severity: multi ? 'medium' : 'good' }),
      tile(T('pp.perPerson'), U.fmtNum(m.personList.length ? U.sum(m.personList, p => p.accountCount) / m.personList.length : 0, 2), T('pp.mean'), { small: true }),
      tile(T('pp.unowned'), U.fmtInt(m.summary.orphanAccounts), T('pp.unownedFoot'), { small: true, severity: 'critical', onClick: () => HR.app.go('accounts', { filter: 'orphan' }) })
    );
    f.appendChild(k);
    f.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.person') },
        { key: 'accountCount', label: T('pp.accounts'), num: true },
        { key: 'enabledAccounts', label: T('c.enabled'), num: true },
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) },
        { key: 'maxRisk', label: T('pp.maxRisk'), num: true, value: r => Math.max(0, ...r.accounts.map(a => a.riskScore)), render: r => scoreBar(Math.max(0, ...r.accounts.map(a => a.riskScore))) }
      ],
      rows: m.personList, pageSize: 40, exportName: 'people',
      initialSort: { key: 'permCount', dir: -1 },
      search: (r, q) => r.name.toLowerCase().includes(q),
      onRowClick: p => drawerPerson(p, m)
    }))));
    return f;
  }

  /** Combined entitlements as a table rather than a paragraph: sortable and exportable. */
  function entitlementTable(perms, accounts, m, exportName) {
    const rows = perms.map(p => ({
      perm: p,
      via: accounts.filter(a => a.permKeys.has(p.key)).map(a => a.userName).join(', ')
    }));
    return HR.table.make({
      columns: [
        { key: 'name', label: T('ru.cGroup'), value: r => r.perm.name },
        { key: 'category', label: T('c.category'), value: r => r.perm.categoryLabel },
        { key: 'holders', label: T('c.holders'), num: true, value: r => r.perm.holderCount },
        { key: 'cost', label: T('c.unitMo'), num: true, value: r => r.perm.monthlyPrice || 0,
          render: r => r.perm.monthlyPrice ? U.fmtMoney(r.perm.monthlyPrice) : '—' },
        { key: 'risk', label: T('c.risk'), num: true, value: r => r.perm.riskScore },
        { key: 'via', label: T('pp.accounts'), value: r => r.via }
      ],
      rows, pageSize: 15, exportName: exportName || 'entitlements',
      initialSort: { key: 'risk', dir: -1 },
      search: (r, q) => (r.perm.name + ' ' + r.perm.categoryLabel).toLowerCase().includes(q),
      onRowClick: r => drawerPermission(r.perm, m)
    });
  }

  /** A vault person: contracts, accounts, entitlements, and what the rules expect. */

  /**
   * Similar access, from one person outward.
   *
   * Two questions in one card: is the group of people who hold what this person holds a
   * group at all — do they share a department, a title — and what does this person have
   * or lack relative to them. The second is what "copy the access of a colleague" is
   * really asking, and it is a bad practice only because nobody could see what they were
   * copying. Here the copy is split by what it costs and what it exposes.
   */
  function peersCard(m, person) {
    let r = null;
    try { r = HR.peers.forPerson(m, person); } catch (e) { return null; }
    if (!r) return null;

    const nameOf = ent => (m.permissions.get(ent) || {}).name || ent;
    const permLink = ent => {
      const perm = m.permissions.get(ent);
      return perm
        ? el('a', { href: '#', text: perm.name,
            onclick: e => { e.preventDefault(); drawerPermission(perm, m); } })
        : el('span', { text: String(ent) });
    };

    if (!r.peers.length) {
      return card(T('pe.title'), T('pe.note'), el('p', { class: 'note',
        text: T('pe.none', { threshold: U.fmtPct(r.cfg.minSimilarity, 0) }) }));
    }

    /* Does this access group correspond to anything the organisation knows about? */
    const top = r.cohesion[0];
    const verdict = !top ? null
      : top.share >= 0.8 ? T('pe.verdictTight', {
          attr: T('py.attr.' + top.attr) || top.attr, share: U.fmtPct(top.share, 0) })
      : top.share >= 0.5 ? T('pe.verdictLoose', {
          attr: T('py.attr.' + top.attr) || top.attr, share: U.fmtPct(top.share, 0) })
      : T('pe.verdictScattered', { n: r.cohesion.length ? r.cohesion[0].distinct : 0 });

    const body = [
      el('p', { class: 'note', text: T('pe.lead', {
        n: r.peers.length, population: U.fmtInt(r.population),
        threshold: U.fmtPct(r.cfg.minSimilarity, 0) }) }),
      verdict ? el('p', { text: verdict }) : null,

      HR.table.make({
        columns: [
          { key: 'name', label: T('pe.cPeer'), value: x => x.person.name,
            render: x => el('a', { href: '#', text: x.person.name, onclick: e => {
              e.preventDefault(); drawerVaultPerson(personRow(m, x.person.person), m);
            } }) },
          { key: 'similarity', label: T('pe.cSimilarity'), value: x => x.similarity,
            render: x => scoreBar(Math.round(x.similarity * 100)) },
          { key: 'title', label: T('org.cTitle'), value: x => x.person.labels.Title || '' },
          { key: 'department', label: T('pp.department'), value: x => x.person.labels.Department || '' },
          { key: 'shared', label: T('pe.cShared'), value: x => x.shared, align: 'right' },
          { key: 'theirs', label: T('pe.cTheirs'), value: x => x.onlyTheirs.length, align: 'right',
            hint: T('pe.cTheirsHint') }
        ],
        rows: r.peers, pageSize: 8, exportName: 'peers-' + person.externalId
      })
    ];

    /* What this person is short of, and what they carry alone. */
    if (r.profile.under.length) {
      body.push(card(T('pe.underTitle'), T('pe.underNote', { consensus: U.fmtPct(r.cfg.consensus, 0) }),
        HR.table.make({
          columns: [
            { key: 'ent', label: T('py.cEntitlement'), value: x => nameOf(x.ent), render: x => permLink(x.ent) },
            { key: 'share', label: T('pe.cPeersHolding'), value: x => x.share,
              render: x => scoreBar(Math.round(x.share * 100)) }
          ],
          rows: r.profile.under, pageSize: 6, exportName: 'peer-gaps'
        })));
    }
    if (r.profile.over.length) {
      body.push(card(T('pe.overTitle'), T('pe.overNote', { rare: U.fmtPct(r.cfg.rare, 0) }),
        HR.table.make({
          columns: [
            { key: 'ent', label: T('py.cEntitlement'), value: x => nameOf(x.ent), render: x => permLink(x.ent) },
            { key: 'share', label: T('pe.cPeersHolding'), value: x => x.share,
              render: x => el('span', { text: U.fmtPct(x.share, 0) }) }
          ],
          rows: r.profile.over, pageSize: 6, exportName: 'peer-extras'
        })));
    }

    /* The defensible version of "copy a colleague". */
    const c = r.copy;
    const listCard = (titleKey, noteKey, rows, cls) => rows.length
      ? card(T(titleKey), T(noteKey), HR.table.make({
          columns: [
            { key: 'ent', label: T('py.cEntitlement'), value: x => nameOf(x.ent), render: x => permLink(x.ent) },
            { key: 'share', label: T('pe.cPeersHolding'), value: x => x.share,
              render: x => scoreBar(Math.round(x.share * 100)) },
            { key: 'flags', label: T('pe.cWhy'), sortable: false,
              render: x => el('span', {}, [
                x.reasons.indexOf('sensitive') >= 0
                  ? el('span', { class: 'sev high', text: T('pe.flagSensitive') }) : null,
                x.price ? el('span', { class: 'pill', text: U.fmtMoney(x.price) + '/mo' }) : null
              ].filter(Boolean)) }
          ],
          rows, pageSize: 8, exportName: 'copy-' + cls
        }), cls)
      : null;

    body.push(card(T('pe.copyTitle'), T('pe.copyNote'), [
      el('p', { text: T('pe.copyLead', {
        standard: c.summary.standard, review: c.summary.review, exclude: c.summary.exclude,
        whole: U.fmtMoney(c.summary.monthlyIfCopiedWhole),
        sensitive: c.summary.sensitiveIfCopiedWhole }) }),
      listCard('pe.copyStandard', 'pe.copyStandardNote', c.standard, 'ok'),
      listCard('pe.copyReview', 'pe.copyReviewNote', c.review, 'warn'),
      listCard('pe.copyExclude', 'pe.copyExcludeNote', c.exclude, 'bad')
    ].filter(Boolean)));

    return card(T('pe.title'), T('pe.note'), body.filter(Boolean));
  }

  function drawerVaultPerson(row, m) {
    const p = row.person;
    const head = el('div', {}, [
      el('h2', { text: p.displayName }),
      el('div', { class: 'row' }, [
        el('span', { class: 'sev ' + STATE_SEV[row.life.state], text: stateLabel(row.life.state) }),
        el('span', { class: 'pill', text: offsetText(row.life) }),
        el('span', { class: 'pill', text: T('dr.accountsN', { n: row.accounts.length }) }),
        p.blocked ? el('span', { class: 'pill removed', text: 'blocked' }) : null,
        p.excluded ? el('span', { class: 'pill removed', text: 'excluded' }) : null
      ])
    ]);
    const body = el('div', { class: 'stack' });
    if (m && !m.hasRecon) body.appendChild(partialNotice(['recon']));
    body.appendChild(dl([
      [T('c.employeeId'), p.externalId || '—'],
      [T('pp.department'), row.department || '—'],
      [T('pp.jobTitle'), row.title || '—'],
      [T('dr.monthlyCost'), U.fmtMoney(row.monthlyCost)]
    ]));
    /* How far this person's access is from anyone else's, and what drives it. */
    let ol = null;
    try { ol = m && m.hasRecon && HR.outlier ? HR.outlier.build(m).byPerson.get(p.personId) : null; } catch (e) { ol = null; }
    if (ol) {
      const permName = k => { const perm = m.permissions.get(k); return perm ? perm.name : String(k); };
      const list = ents => ents.slice(0, 5).map(permName).join(', ') + (ents.length > 5 ? ' +' + (ents.length - 5) : '');
      body.appendChild(card(T('ol.title'), T('ol.note'), dl([
        [T('ol.score'), scoreBar(ol.score)],
        [T('ol.fPeer'), el('span', {}, [scoreBar(ol.factors.peer.value), el('span', { class: 'note', text: ' ' + (ol.factors.peer.peer
          ? T('ol.fPeerD', { p: Math.round(100 * ol.factors.peer.similarity), name: ol.factors.peer.peer.person.displayName }) : T('ol.fPeerNone')) })])],
        [T('ol.fStandalone'), el('span', {}, [scoreBar(ol.factors.standalone.value), el('span', { class: 'note', text: ' ' + list(ol.factors.standalone.ents) })])],
        [T('ol.fRare'), el('span', {}, [scoreBar(ol.factors.rare.value), el('span', { class: 'note', text: ' ' + list(ol.factors.rare.ents) })])]
      ])));
    }

    body.appendChild(card(T('pp.drawerContracts'), T('dr.groupsN', { n: p.contracts.length }), HR.table.make({
      columns: [
        { key: 'start', label: T('pp.cStart'), value: c => c.startDate ? c.startDate.toISOString().slice(0, 10) : '—' },
        { key: 'end', label: T('pp.cEnd'), value: c => c.endDate ? c.endDate.toISOString().slice(0, 10) : '—' },
        { key: 'dept', label: T('pp.department'), value: c => c.department.name || c.department.externalId },
        { key: 'title', label: T('pp.jobTitle'), value: c => c.title.name || c.title.code },
        { key: 'type', label: T('pp.cType'), value: c => c.type.code || c.type.name },
        { key: 'fte', label: T('pp.cFte'), num: true, value: c => (c.details || {}).Fte || 0 }
      ],
      rows: p.contracts, pageSize: 10, exportName: 'contracts-' + p.externalId,
      initialSort: { key: 'start', dir: -1 }
    })));

    if (row.accounts.length) {
      body.appendChild(card(T('pp.accounts'), null, HR.table.make({
        columns: [
          { key: 'userName', label: T('c.account') },
          { key: 'enabled', label: T('c.state'), value: a => T(a.enabled === false ? 'c.disabled' : 'c.enabled') },
          { key: 'permCount', label: T('c.perms'), num: true },
          { key: 'monthlyCost', label: T('c.costMo'), num: true, render: a => U.fmtMoney(a.monthlyCost) },
          { key: 'riskScore', label: T('c.risk'), num: true, render: a => scoreBar(a.riskScore) }
        ], rows: row.accounts, pageSize: 10, exportName: 'accounts-' + p.externalId,
        onRowClick: a => drawerAccount(a)
      })));
    }

    if (row.perms.length) {
      body.appendChild(card(T('pp.combined'), T('pp.combinedNote', { n: row.perms.length }),
        entitlementTable(row.perms, row.accounts, m, 'entitlements-' + p.externalId)));
    }

    /* What the rules say this person should have, once a vault makes them evaluable. */
    const prov = m.provisioning && m.provisioning.rows.find(r => r.person.personId === p.personId);
    if (prov) {
      body.appendChild(card(T('pp.drawerRules'), T('dr.groupsN', { n: prov.matchedRules.length }),
        prov.matchedRules.length
          ? el('ul', { class: 'clean' }, prov.matchedRules.map(r => el('li', {}, [
              el('strong', { text: r.name }),
              el('span', { class: 'pill', text: r.status })
            ])))
          : el('p', { class: 'note', text: T('ru.noRule') })));
      if (prov.missing.length || prov.extra.length) {
        body.appendChild(card(T('pp.drawerExpected'), null, [
          prov.missing.length ? el('div', {}, [
            el('h3', { text: T('pp.missingHere') }),
            entitlementTable(prov.missing.map(x => x.perm), row.accounts, m, 'expected-not-held-' + p.externalId)
          ]) : null,
          prov.extra.length ? el('div', { style: 'margin-top:12px' }, [
            el('h3', { text: T('pp.heldNotExpected') }),
            entitlementTable(prov.extra, row.accounts, m, 'held-not-expected-' + p.externalId)
          ]) : null
        ].filter(Boolean)));
      }
    }

    /* The career, where the vault records one: moves, and what travelled along. */
    try {
      const myMoves = HR.workforce.moves(m.vault).filter(x => x.person === p);
      if (myMoves.length) {
        const res = HR.workforce.moverResidue(m, m.vault);
        const mine = res ? res.rows.filter(r => r.move.person === p) : [];
        body.appendChild(card(T('wf.careerTitle'), T('wf.careerNote'), [
          el('ul', { class: 'clean' }, myMoves.map(mv => el('li', { class: 'note' }, [
            el('span', { class: 'mono', text: U.fmtDate(mv.date).split(',')[0] + '  ' }),
            document.createTextNode(
              (mv.deptChanged ? mv.from.dept + ' \u2192 ' + mv.to.dept : '') +
              (mv.deptChanged && mv.titleChanged ? ' \u00b7 ' : '') +
              (mv.titleChanged ? mv.from.title + ' \u2192 ' + mv.to.title : ''))
          ]))),
          mine.length ? el('div', {}, [
            el('h3', { text: T('wf.careerResidue', { n: mine[0].residue.length }) }),
            el('div', {}, mine[0].residue.map(e => el('span', {
              class: 'pill', style: 'margin:0 4px 4px 0; display:inline-block',
              text: (m.permissions.get(e) || {}).name || e })))
          ] ) : null
        ].filter(Boolean)));
      }
    } catch (e) { /* career is optional */ }

    /* Who else looks like this, and what that says about the group. */
    const peers = peersCard(m, p);
    if (peers) body.appendChild(peers);

    openDrawer(head, body);
  }

  /* =================================================================== DIFF */
  function diffView(m) {
    const f = document.createDocumentFragment();
    const st = HR.app.state;
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('df.title') }),
      el('p', { text: T('df.lead') })
    ])));

    /* The control sits beside its effect: pick the import to compare against here. */
    if (st.snapshots.length > 1 || st.baselineId) {
      const sel = el('select', { onchange: e => HR.app.setBaseline(e.target.value) });
      sel.appendChild(el('option', { value: '', text: T('app.baselineNone') }));
      st.snapshots.forEach(s => sel.appendChild(el('option', {
        value: s.id, text: s.name + ' \u00b7 ' + U.fmtDate(s.importedAt), selected: s.id === st.baselineId
      })));
      f.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' },
        el('label', { class: 'inline' }, [document.createTextNode(T('app.baseline')), sel])));
    }

    if (!st.diff) {
      f.appendChild(card(null, null, el('p', {
        text: T(st.snapshots && st.snapshots.length > 1 ? 'df.pickBaseline' : 'df.importSecond')
      })));
      return f;
    }

    const d = st.diff;
    f.appendChild(el('p', { class: 'note', text: T('df.baselineIs', { name: st.baselineSnapshot.name, date: U.fmtDate(st.baselineSnapshot.importedAt), headline: d.headline }) }));

    const k = el('div', { class: 'grid g4' });
    const dt = (label, key, fmt, inverse) => {
      const x = d.summary[key];
      return tile(label, fmt ? fmt(x.now) : U.fmtInt(x.now), T('df.wasVal', { v: fmt ? fmt(x.was) : U.fmtInt(x.was) }),
        { small: true, delta: x, deltaFormat: fmt, inverse });
    };
    k.append(
      dt(T('ov.overallRisk'), 'riskScore'),
      dt(T('ov.unownedAccounts'), 'orphanAccounts'),
      dt(T('ov.unmanagedEnt'), 'unmanagedPermissionRows'),
      dt(T('df.licenceSpendMo'), 'monthlyCost', U.fmtMoney)
    );
    f.appendChild(k);
    const k2 = el('div', { class: 'grid g4', style: 'margin-top:14px' });
    k2.append(
      dt(T('ov.accounts'), 'accounts'),
      dt(T('df.enabledAccounts'), 'enabledAccounts'),
      dt(T('pp.persons'), 'persons'),
      dt(T('df.recoverableMo'), 'wasteMonthly', U.fmtMoney)
    );
    f.appendChild(k2);

    const g = el('div', { class: 'grid g2', style: 'margin-top:14px' });
    g.appendChild(card(T('df.findingsMovement'), null, HR.table.make({
      columns: [
        { key: 'severity', label: T('c.sev'), render: r => el('span', { class: 'sev ' + r.severity, text: T('c.' + r.severity) }) },
        { key: 'title', label: T('c.finding') },
        { key: 'was', label: T('c.was'), num: true },
        { key: 'now', label: T('c.now'), num: true },
        { key: 'change', label: T('c.change'), num: true, render: r => deltaBadge(r.change) },
        { key: 'status', label: T('c.status'), value: r => r.isNew ? T('df.new') : r.resolved ? T('df.resolved') : '', render: r => r.isNew ? el('span', { class: 'pill removed', text: T('df.new') }) : (r.resolved ? el('span', { class: 'pill added', text: T('df.resolved') }) : el('span', { text: '' })) }
      ], rows: d.findings, pageSize: 20, exportName: 'findings-diff'
    })));

    g.appendChild(card(T('df.entMovement'), T('df.entMovementNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('c.permission'), value: r => r.perm.name },
        { key: 'was', label: T('c.was'), num: true },
        { key: 'now', label: T('c.now'), num: true },
        { key: 'change', label: T('c.change'), num: true, render: r => deltaBadge(r.change) }
      ], rows: d.permissions.moved, pageSize: 20, exportName: 'permission-diff',
      onRowClick: r => drawerPermission(r.perm, m)
    })));
    f.appendChild(g);

    f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('df.changedAccounts'), T('df.changedAccountsNote', { n: d.accounts.changed.length }), HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account'), value: r => r.account.userName },
        { key: 'what', label: T('df.whatChanged'), value: r => r.changes.map(c => c.field).join(', '), render: r => el('span', { class: 'trunc', title: r.changes.map(c => c.field + ': ' + c.from + ' → ' + c.to).join(' | '), text: r.changes.map(c => c.field).join(', ') }) },
        { key: 'granted', label: T('c.granted'), num: true, value: r => r.permsAdded.length },
        { key: 'revoked', label: T('c.revoked'), num: true, value: r => r.permsRemoved.length },
        { key: 'riskDelta', label: T('df.dRisk'), num: true, render: r => deltaBadge(r.riskDelta) },
        { key: 'costDelta', label: T('df.dCost'), num: true, render: r => deltaBadge(r.costDelta, U.fmtMoney) }
      ], rows: d.accounts.changed, pageSize: 25, exportName: 'account-changes',
      search: (r, q) => r.account.userName.toLowerCase().includes(q),
      onRowClick: r => drawerAccount(r.account, r)
    }))));

    const g2 = el('div', { class: 'grid g2', style: 'margin-top:14px' });
    g2.appendChild(card(T('df.newAccounts'), T('df.added', { n: d.accounts.added.length }), HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account'), value: r => r.account.userName },
        { key: 'cls', label: T('c.class'), value: r => r.account.clsLabel },
        { key: 'perms', label: T('c.perms'), num: true, value: r => r.account.permCount },
        { key: 'risk', label: T('c.risk'), num: true, value: r => r.account.riskScore, render: r => scoreBar(r.account.riskScore) }
      ], rows: d.accounts.added, pageSize: 15, exportName: 'accounts-added',
      onRowClick: r => drawerAccount(r.account)
    })));
    g2.appendChild(card(T('df.goneAccounts'), T('df.removed', { n: d.accounts.removed.length }), HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account'), value: r => r.account.userName },
        { key: 'cls', label: T('c.class'), value: r => r.account.clsLabel },
        { key: 'perms', label: T('c.perms'), num: true, value: r => r.account.permCount },
        { key: 'risk', label: T('c.risk'), num: true, value: r => r.account.riskScore, render: r => scoreBar(r.account.riskScore) }
      ], rows: d.accounts.removed, pageSize: 15, exportName: 'accounts-removed'
    })));
    f.appendChild(g2);
    return f;
  }

  /* ============================================================== SNAPSHOTS */
  function snapshotsView(m) {
    const f = document.createDocumentFragment();
    const st = HR.app.state;
    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('sn.title') }),
        el('p', { text: T('sn.lead') })
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn sm', text: T('sn.exportAll'), onclick: async () => {
          U.download('recon-snapshots.json', await HR.store.exportAll(), 'application/json');
        } }),
        el('label', { class: 'btn sm' }, [
          document.createTextNode(T('sn.importJson')),
          el('input', { type: 'file', accept: '.json', hidden: true, onchange: async e => {
            const file = e.target.files[0]; if (!file) return;
            try { const n = await HR.store.importJSON(await file.text()); U.toast(T('toast.importedSnaps', { n: n })); HR.app.refreshSnapshots(); }
            catch (err) { U.toast(T('toast.importFail', { msg: err.message }), 5000); }
          } })
        ])
      ])
    ]));

    if (HR.store.isMemory()) {
      f.appendChild(card(null, null, el('p', {
        class: 'note',
        text: T('sn.noStorage')
      })));
    }

    const snaps = st.snapshots || [];
    if (snaps.length > 1) {
      const ordered = snaps.slice().sort((a, b) => a.importedAt - b.importedAt);
      const labels = ordered.map(s => new Date(s.importedAt).toLocaleDateString(HR.i18n.locale, { day: '2-digit', month: 'short' }));
      const g = el('div', { class: 'grid g2' });
      g.appendChild(card(T('sn.riskOverTime'), T('sn.perImport'), C.line(
        [{ label: T('ov.overallRisk'), color: C.slot(1), points: ordered.map((s, i) => ({ x: i, y: s.summary.riskScore, tip: '<div class="t-title">' + U.esc(s.name) + '</div><div class="t-row"><span>' + T('app.riskShort') + '</span><b>' + s.summary.riskScore + '</b></div>' })) }],
        labels, { maxY: 100 })));
      g.appendChild(card(T('sn.unownedOverTime'), T('sn.perImport'), C.line(
        [{ label: T('ov.unownedAccounts'), color: C.STATUS.critical, points: ordered.map((s, i) => ({ x: i, y: s.summary.orphanAccounts })) }],
        labels)));
      /* The two lines a business reads: is the drift shrinking, is the spend moving. */
      g.appendChild(card(T('sn.driftOverTime'), T('sn.perImport'), C.line(
        [{ label: T('ov.unmanagedEnt'), color: C.slot(1),
           points: ordered.map((s, i) => ({ x: i, y: s.summary.unmanagedPermissionRows })) }],
        labels)));
      /* Compliance is the line a board asks for: is the control set holding. */
      if (ordered.some(s => s.summary.policyScore != null)) {
        g.appendChild(card(T('sn.policyOverTime'), T('sn.perImport'), C.line(
          [{ label: T('po.kScore'), color: C.STATUS.good,
             points: ordered.map((s, i) => ({ x: i, y: s.summary.policyScore == null ? null : Math.round(100 * s.summary.policyScore) })).filter(p => p.y != null) }],
          labels, { maxY: 100 })));
      }
      g.appendChild(card(T('sn.moneyOverTime'), T('sn.perImport'), C.line([
        { label: T('ov.licenceSpend'), color: C.slot(4),
          points: ordered.map((s, i) => ({ x: i, y: Math.round(s.summary.monthlyCost || 0) })) },
        { label: T('ov.recoverable'), color: C.STATUS.warning,
          points: ordered.map((s, i) => ({ x: i, y: Math.round(s.summary.wasteMonthly || 0) })) }
      ], labels)));
      f.appendChild(g);
    }

    f.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('sn.snapshot'), render: r => el('span', {}, [
          document.createTextNode(r.name),
          st.currentSnapshotId === r.id ? el('span', { class: 'pill solid', text: ' ' + T('sn.loaded') }) : null,
          st.baselineId === r.id ? el('span', { class: 'pill', text: ' ' + T('sn.baseline') }) : null
        ]) },
        { key: 'importedAt', label: T('sn.imported'), render: r => U.fmtDate(r.importedAt) },
        { key: 'rowCount', label: T('c.rowsCol'), num: true },
        { key: 'accounts', label: T('ov.accounts'), num: true, value: r => r.summary.accounts },
        { key: 'orphan', label: T('c.unowned'), num: true, value: r => r.summary.orphanAccounts },
        { key: 'risk', label: T('c.risk'), num: true, value: r => r.summary.riskScore, render: r => scoreBar(r.summary.riskScore) },
        { key: 'cost', label: T('sn.spendMo'), num: true, value: r => r.summary.monthlyCost || 0, render: r => U.fmtMoney(r.summary.monthlyCost || 0) },
        { key: 'actions', label: '', sortable: false, render: r => el('div', { class: 'row' }, [
          el('button', { class: 'btn sm', text: T('sn.load'), onclick: e => { e.stopPropagation(); HR.app.loadSnapshot(r.id); } }),
          el('button', { class: 'btn sm', text: T('sn.setBaseline'), onclick: e => { e.stopPropagation(); HR.app.setBaseline(r.id); } }),
          el('button', { class: 'btn sm', text: T('sn.rename'), onclick: async e => {
            e.stopPropagation();
            const name = prompt(T('sn.renamePrompt'), r.name); if (!name) return;
            const full = await HR.store.get(r.id); full.name = name; await HR.store.put(full); HR.app.refreshSnapshots();
          } }),
          el('button', { class: 'btn sm danger', text: T('sn.delete'), onclick: async e => {
            e.stopPropagation();
            if (!confirm(T('sn.deleteConfirm', { name: r.name }))) return;
            await HR.store.remove(r.id); HR.app.refreshSnapshots();
          } })
        ]) }
      ],
      rows: snaps, pageSize: 20, exportName: 'snapshots',
      initialSort: { key: 'importedAt', dir: -1 }
    }))));
    return f;
  }

  /* =============================================================== SETTINGS */
  /* Edits live in a draft until saved, so switching tabs does not throw them away. */
  let settingsDraft = null;
  function settingsView(m, params) {
    const cfg = settingsDraft || (settingsDraft = HR.config.clone(HR.config.get()));
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('st.title') }),
        el('p', { text: T('st.lead') }),
        el('p', { class: 'note', text: T('st.persistNote') })
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: T('st.save'), onclick: async () => { HR.config.save(cfg); settingsDraft = null; await HR.app.rebuildBusy(); U.toast(T('toast.settingsSaved')); } }),
        el('button', { class: 'btn', text: T('st.reset'), onclick: async () => { if (confirm(T('st.resetConfirm'))) { settingsDraft = null; HR.config.reset(); await HR.app.rebuildBusy(); HR.app.go('settings'); } } }),
        el('button', { class: 'btn', text: T('st.exportFile'), onclick: () => {
          HR.config.save(cfg);
          U.download('analytics-settings.json', HR.config.exportJson(), 'application/json');
        } }),
        el('label', { class: 'btn' }, [
          document.createTextNode(T('st.importFile')),
          el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async e => {
            const file = e.target.files[0]; if (!file) return;
            try {
              const counts = HR.config.importJson(await file.text());
              settingsDraft = null;
              HR.app.applyChrome(); await HR.app.rebuildBusy(); HR.app.go('settings');
              U.toast(T('toast.settingsImported', counts), 5000);
            } catch (err) { U.toast(err.message, 7000); }
          } })
        ])
      ])
    ]));

    const editableList = (title, note, list, fields, factory, opts) => {
      const body = el('div');
      const draw = () => {
        body.innerHTML = '';
        const t = el('table', { class: 'tbl' });
        t.appendChild(el('thead', {}, el('tr', {}, fields.map(fl => el('th', { class: 'no-sort' + (fl.num ? ' num' : ''), text: fl.label }))
          .concat([el('th', { class: 'no-sort num', text: opts && (opts.target || opts.matchFn) ? T('rv.matches') : '' }), el('th', { class: 'no-sort' })]))));
        const tb = el('tbody');
        list.forEach((item, idx) => {
          const tr = el('tr');
          fields.forEach(fl => {
            const td = el('td', { class: fl.num ? 'num' : '' });
            if (fl.matcher) {
              /* Structured matcher: op dropdown + comma-separated values, compiled
                 to the regex the engine runs. Rows saved as raw regex keep their
                 pattern and show as "advanced". */
              const spec = (item[fl.matcher] && item[fl.matcher].op)
                ? item[fl.matcher]
                : { op: item[fl.key] ? 'regex' : 'contains', value: item[fl.key] || '' };
              const apply = () => {
                item[fl.matcher] = spec;
                item[fl.key] = HR.config.compileMatch(spec);
              };
              const val = el('input', {
                type: 'text', value: spec.value, placeholder: T('st.opValuesPh'),
                oninput: e => { spec.value = e.target.value; apply(); }
              });
              val.style.width = fl.width || '150px';
              if (spec.op === 'regex') val.classList.add('mono');
              const sel = el('select', { onchange: e => {
                if (e.target.value === 'regex') spec.value = item[fl.key] || spec.value;
                spec.op = e.target.value;
                apply(); draw();
              } });
              ['equals', 'starts', 'ends', 'contains', 'regex'].forEach(op => sel.appendChild(
                el('option', { value: op, text: T('st.op.' + op), selected: spec.op === op })));
              const wrap = el('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, [sel, val]);
              td.appendChild(wrap);
            } else if (fl.options) {
              /* A linked reference, not free text: pick from what is defined. */
              const sel = el('select', { onchange: e => { item[fl.key] = e.target.value; draw(); } });
              fl.options().forEach(o => sel.appendChild(el('option', {
                value: o.value, text: o.label, selected: (item[fl.key] || '') === o.value })));
              td.appendChild(sel);
            } else {
              const shown = (fl.translated && item.key) ? HR.config.labelOf(item) : item[fl.key];
              const inp = el('input', {
                type: fl.num ? 'number' : 'text', value: shown == null ? '' : shown,
                step: fl.step || 'any',
                oninput: e => {
                  item[fl.key] = fl.num ? parseFloat(e.target.value) || 0 : e.target.value;
                  if (fl.translated) delete item.key;   // a hand-typed label stops being translated
                }
              });
              inp.style.width = fl.width || (fl.num ? '90px' : '100%');
              td.appendChild(inp);
            }
            tr.appendChild(td);
          });
          const res = HR.app.state.model && opts
            ? (opts.matchFn ? opts.matchFn(item)
              : (opts.target ? HR.mine.test(item.pattern, opts.target, HR.app.state.model) : null))
            : null;
          if (res) {
            tr.appendChild(el('td', { class: 'num' }, el('span', {
              class: 'pill' + (res.valid ? (res.everything ? ' removed' : '') : ' removed'),
              title: res.valid ? '' : res.error,
              text: res.valid ? T('st.ruleMatches', { n: U.fmtInt(res.count) }) : '!'
            })));
          } else {
            tr.appendChild(el('td', {}));
          }
          tr.appendChild(el('td', {}, el('button', { class: 'btn sm danger', text: '✕', onclick: () => { list.splice(idx, 1); draw(); } })));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        body.appendChild(el('div', { class: 'tbl-wrap' }, t));
        body.appendChild(el('button', { class: 'btn sm', text: T('st.addRow'), onclick: () => { list.push(factory()); draw(); } }));
      };
      draw();
      return card(title, note, body);
    };

    const grid = cards => {
      const g = el('div', { class: 'grid' });
      cards.filter(Boolean).forEach(c => g.appendChild(c));
      return g;
    };

    /* The classification is defined once, globally; pricing links to it below and
       risk attributes live on the rows themselves. */
    /* Categories and classes are definitions now — label, sensitivity/weight,
       colour. What lands in each is decided by the classification wizard
       (mined families + assignments), not by patterns. The count pill shows
       what each definition currently holds. */
    const assignedCategory = item => {
      const m2 = HR.app.state.model;
      return { valid: true, count: m2 ? m2.permissionList.filter(p => p.category === item.id).length : 0 };
    };
    const assignedClass = item => {
      const m2 = HR.app.state.model;
      return { valid: true, count: m2 ? m2.accountList.filter(a => a.cls === item.id).length : 0 };
    };
    /* The recognition vocabulary rides in the draft too; without stored rows
       the built-in table shows (and deleting every row brings it back). */
    if (!cfg.hints || !Array.isArray(cfg.hints.categories)) {
      cfg.hints = HR.config.clone(HR.hints.DEFAULTS);
    }
    const hintCatCount = item => {
      const m2 = HR.app.state.model;
      if (!m2) return null;
      const toks = HR.hints.tokens(item);
      return { valid: true, count: m2.permissionList.filter(p => {
        const fam = HR.wizard.famKeyOf(p.name);
        return fam && toks.some(x => fam.toLowerCase().startsWith(x));
      }).length };
    };
    const hintClsCount = item => {
      const m2 = HR.app.state.model;
      if (!m2) return null;
      const toks = HR.hints.tokens(item);
      return { valid: true, count: m2.accountList.filter(a => {
        const co = HR.wizard.cohortKeyOf(a.userName);
        return co && toks.includes(co.slice(2));
      }).length };
    };
    if (!Array.isArray(cfg.sod)) cfg.sod = HR.config.clone(HR.sod.DEFAULTS);
    /* A pair's live count: how many accounts break it today. */
    const sodCount = item => {
      const m2 = HR.app.state.model;
      if (!m2 || !m2.hasRecon) return null;
      const probe = Object.assign({}, m2, { _sod: null });
      const saved = HR.config.get().sod;
      HR.config.get().sod = [item];
      let n = 0;
      try { n = HR.sod.evaluate(probe).violations.length; } finally { HR.config.get().sod = saved; }
      return { valid: true, count: n };
    };
    const classificationTab = () => grid([
      HR.app.state.model ? card(T('wz.stTitle'), T('wz.stNote'), el('div', { class: 'slot-actions' },
        el('button', { class: 'btn primary', text: T('wz.stOpen'),
          onclick: () => HR.app.go('classify') }))) : null,
      editableList(T('st.categories'), T('st.categoriesNote'),
        cfg.categories,
        [{ key: 'label', label: T('c.category'), translated: true },
         { key: 'sensitivity', label: T('st.sensitivity'), num: true, step: '0.1' }],
        () => ({ id: 'custom' + Date.now(), label: 'New category', sensitivity: 1, color: 2 }),
        { matchFn: assignedCategory }),
      editableList(T('st.classes'), T('st.classesNote'),
        cfg.accountClasses,
        [{ key: 'label', label: T('c.class'), translated: true },
         { key: 'weight', label: T('st.weight'), num: true, step: '0.1' }],
        () => ({ id: 'custom' + Date.now(), label: 'New class', weight: 1 }),
        { matchFn: assignedClass }),
      editableList(T('st.hintsCat'), T('st.hintsCatNote'),
        cfg.hints.categories,
        [{ key: 't', label: T('st.hintTokens'), width: '260px' },
         { key: 'id', label: T('c.category'), options: () =>
            cfg.categories.map(c => ({ value: c.id, label: HR.config.labelOf(c) })) }],
        () => ({ t: '', id: 'other' }),
        { matchFn: hintCatCount }),
      editableList(T('st.sodTitle'), T('st.sodNote'),
        cfg.sod,
        [{ key: 'label', label: T('st.sodLabel'), width: '220px' },
         { key: 'aKind', label: T('st.sodA'), options: () => HR.sod.KINDS.map(k => ({ value: k, label: T('st.sodKind.' + k) })) },
         { key: 'aValue', label: T('st.sodValue'), width: '140px' },
         { key: 'bKind', label: T('st.sodB'), options: () => HR.sod.KINDS.map(k => ({ value: k, label: T('st.sodKind.' + k) })) },
         { key: 'bValue', label: T('st.sodValue'), width: '140px' },
         { key: 'severity', label: T('c.severity'), options: () => HR.sod.SEVERITIES.map(v => ({ value: v, label: T('c.' + v) })) }],
        () => ({ id: 'sod' + Date.now(), label: '', aKind: 'category', aValue: '', bKind: 'category', bValue: '', severity: 'medium' }),
        { matchFn: sodCount }),
      editableList(T('st.hintsCls'), T('st.hintsClsNote'),
        cfg.hints.classes,
        [{ key: 't', label: T('st.hintTokensExact'), width: '260px' },
         { key: 'id', label: T('c.class'), options: () =>
            cfg.accountClasses.map(c => ({ value: c.id, label: HR.config.labelOf(c) })) }],
        () => ({ t: '', id: 'user' }),
        { matchFn: hintClsCount }),
      editableList(T('st.ecats'), T('st.ecatsNote'),
        cfg.employeeCategories,
        [{ key: 'label', label: T('c.category'), translated: true },
         { key: 'multiplier', label: T('st.multiplier'), num: true, step: '0.05' },
         { key: 'vaultPattern', matcher: 'vaultMatch', label: T('st.vaultPattern'), width: '120px' },
         { key: 'accountPattern', matcher: 'accountMatch', label: T('st.accountPattern'), width: '120px' },
         { key: 'groupPattern', matcher: 'groupMatch', label: T('st.groupPattern'), width: '120px' }],
        () => ({ id: 'custom' + Date.now(), label: 'New category', multiplier: 1,
          vaultPattern: '', vaultMatch: { op: 'contains', value: '' }, accountPattern: '', groupPattern: '' }))
    ]);


    const pricingTab = () => grid([
      editableList(T('st.priceBook'), T('st.priceBookNote'),
        cfg.priceBook,
        [{ key: 'label', label: T('st.label') },
         { key: 'classification', label: T('st.classification'), options: () =>
            [{ value: '', label: T('st.anyClassification') }].concat(
              cfg.categories.map(c => ({ value: c.id, label: HR.config.labelOf(c) }))) },
         { key: 'pattern', matcher: 'match', label: T('st.refine'), width: '140px' },
         { key: 'price', label: T('st.price'), num: true, step: '0.01' }],
        () => ({ label: 'New SKU', classification: 'licence', pattern: '', match: { op: 'ends', value: '' }, price: 0, unit: 'month' }),
        { matchFn: item => {
            const m = HR.app.state.model;
            if (!m) return null;
            let rx = null;
            try { if (item.pattern) rx = new RegExp(item.pattern, 'i'); }
            catch (e) { return { valid: false, error: e.message, count: 0, everything: false }; }
            const hits = m.permissionList.filter(p =>
              (!item.classification || p.category === item.classification) && (!rx || rx.test(p.name)));
            return { valid: true, count: hits.length, everything: false };
          } })
    ]);

    const numField = (obj, key, label, step) => {
      const w = el('label', { class: 'inline' });
      const i = el('input', { type: 'number', value: obj[key], step: step || 'any', oninput: e => obj[key] = parseFloat(e.target.value) || 0 });
      i.style.width = '90px';
      w.append(document.createTextNode(label), i);
      return w;
    };

    const weightsTab = () => grid([
      card(T('st.riskWeights'), T('st.riskWeightsNote'), el('div', { class: 'row' }, [
      numField(cfg.risk.issueWeights, 'Account unmanaged', T('st.wAccountUnmanaged')),
      numField(cfg.risk.issueWeights, 'Permission unmanaged', T('st.wPermUnmanaged')),
      numField(cfg.risk.issueWeights, 'Permission missing', T('st.wPermMissing')),
      numField(cfg.risk, 'orphanEnabledBonus', T('st.wOrphanEnabled')),
      numField(cfg.risk, 'privilegedOrphanBonus', T('st.wOrphanPriv')),
      numField(cfg.risk, 'disabledWithEntitlementsBonus', T('st.wDisabledEnt')),
      numField(cfg.risk, 'disabledWithLicenceBonus', T('st.wDisabledLic')),
      numField(cfg.risk, 'rarityBonus', T('st.wRarity')),
      numField(cfg.risk, 'outlierBonus', T('st.wOutlier')),
      numField(cfg.risk, 'stackedLicenceBonus', T('st.wStacked'))
      ])),

      card(T('st.effort'), T('st.effortNote'), el('div', { class: 'row' }, [
      numField(cfg.effort, 'hourlyRate', T('st.hourlyRate')),
      numField(cfg.effort, 'minutesPerUnmanagedPermission', T('st.minPerm')),
      numField(cfg.effort, 'minutesPerUnmanagedAccount', T('st.minAccount')),
      numField(cfg.effort, 'minutesPerMissingPermission', T('st.minMissing')),
      numField(cfg.effort, 'minutesPerPrivilegedReview', T('st.minPriv'))
      ])),

      card(T('st.thresholds'), null, el('div', { class: 'row' }, [
      numField(cfg.severityBands, 'critical', T('st.criticalAt')),
      numField(cfg.severityBands, 'high', T('st.highAt')),
      numField(cfg.severityBands, 'medium', T('st.mediumAt')),
      numField(cfg, 'rarityThreshold', T('st.rareAt')),
      (() => {
        const w = el('label', { class: 'inline' });
        const s = el('select', { onchange: e => cfg.currency = e.target.value });
        ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK'].forEach(c => s.appendChild(el('option', { value: c, text: c, selected: cfg.currency === c })));
        w.append(document.createTextNode(T('st.currency')), s);
        return w;
      })()
      ]))
    ]);

    /* ---- account-to-person matching, with the effect of the current numbers ---- */
    const matchingCard = () => {
      const c = cfg.correlation;
      const m = HR.app.state.model;
      const stats = (m && m.vault) ? HR.correlate.attributionStats(m, m.vault, m.correlation) : null;
      /* The scoring, spoken instead of coded: each rule is a sentence about the
         evidence, its number says how much that evidence weighs, and the preview
         line answers the only question that matters while tuning — what would
         these settings match, right now, on this tenant. */
      const preview = el('p', { class: 'note', style: 'margin-top:10px' });
      let previewTimer = null;
      const refreshPreview = () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
          if (!m || !m.vault) { preview.textContent = T('st.mNoVault'); return; }
          const sim = HR.correlate.matchUnowned(m, m.vault, { cfg: c });
          preview.textContent = T('st.mPreview', {
            matched: U.fmtInt(sim.stats.matched), ambiguous: U.fmtInt(sim.stats.ambiguous),
            unmatched: U.fmtInt(sim.stats.unmatched)
          });
        }, 250);
      };

      const toggle = (key, labelKey) => {
        const box = el('input', { type: 'checkbox', checked: c[key],
          onchange: e => { c[key] = e.target.checked; refreshPreview(); } });
        return el('label', { class: 'inline' }, [box, document.createTextNode(T(labelKey))]);
      };
      const rule = (key, labelKey) => {
        const i = el('input', { type: 'number', value: c.weights[key], step: '5',
          oninput: e => { c.weights[key] = parseFloat(e.target.value) || 0; refreshPreview(); } });
        i.style.width = '70px';
        return el('div', { class: 'row', style: 'gap:8px' }, [
          i, el('span', { class: 'note', text: T(labelKey) })
        ]);
      };
      const threshold = el('input', { type: 'number', value: c.strongThreshold, step: '5',
        oninput: e => { c.strongThreshold = parseFloat(e.target.value) || 0; refreshPreview(); } });
      threshold.style.width = '70px';

      const preset = (labelKey, value) => el('button', { class: 'btn sm', text: T(labelKey),
        onclick: () => { c.strongThreshold = value; threshold.value = value; refreshPreview(); } });

      refreshPreview();
      return card(T('st.matching'), T('st.matchingNote'), [
        el('div', { class: 'row' }, [
          toggle('useVaultCorrelation', 'st.mUseVault'),
          toggle('useReconPerson', 'st.mUseRecon'),
          toggle('useNameMatch', 'st.mUseName')
        ]),
        el('div', { style: 'margin-top:10px; display:flex; flex-direction:column; gap:6px' }, [
          rule('vaultCorrelated', 'st.wVaultCorrelated'),
          rule('displayNameExact', 'st.wDisplayExact'),
          rule('employeeIdInUsername', 'st.wEmployeeId'),
          rule('displayNameContains', 'st.wDisplayContains'),
          rule('surnameInUsername', 'st.wSurname'),
          rule('firstAndSurnameInUsername', 'st.wFirstSurname'),
          rule('initialBeforeSurname', 'st.wInitial')
        ]),
        el('div', { class: 'row', style: 'margin-top:10px' }, [
          el('label', { class: 'inline' }, [
            document.createTextNode(T('st.mThresholdPre') + ' '), threshold,
            document.createTextNode(' ' + T('st.mThresholdPost'))
          ]),
          el('span', { class: 'spacer', style: 'flex:1' }),
          preset('st.presetStrict', 120),
          preset('st.presetBalanced', 90),
          preset('st.presetLoose', 55)
        ]),
        preview,
        stats ? el('p', { class: 'note', text: T('st.mStats', {
          attributed: U.fmtInt(stats.attributed), total: U.fmtInt(stats.accounts),
          vault: U.fmtInt(stats.byLayer.vault || 0), recon: U.fmtInt(stats.byLayer.recon || 0),
          name: U.fmtInt(stats.byLayer.name || 0), left: U.fmtInt(stats.unattributed)
        }) }) : null
      ]);
    };

    const matchingTab = () => grid([
      matchingCard(),
      HR.app.state.model
        ? card(T('rv.tester'), T('rv.testerNote'), regexTester(HR.app.state.model)) : null
    ]);

    /* ---- branding: icon, wordmark, report title block ---- */
    const B = HR.brand.state;
    const slotRow = (slot, labelKey, previewCls) => {
      const preview = el('div', { class: 'logo-preview' + (slot === 'logoLight' ? ' on-dark' : '') });
      const draw = () => { preview.innerHTML = ''; preview.appendChild(HR.brand.mark(slot, previewCls)); };
      draw();
      const upload = el('input', {
        type: 'file', accept: 'image/svg+xml,image/png,image/jpeg', hidden: true,
        onchange: e => {
          const file = e.target.files[0]; if (!file) return;
          const reader = new FileReader();
          reader.onload = () => { HR.brand.setAsset(slot, String(reader.result)); draw(); };
          reader.readAsDataURL(file);     // inlined so it survives into the printed PDF
        }
      });
      return el('div', { class: 'brand-slot' }, [
        el('div', { class: 'brand-slot-label', text: T(labelKey) }),
        preview,
        el('div', { class: 'row' }, [
          el('label', { class: 'btn sm' }, [document.createTextNode(T('st.logoUpload')), upload]),
          el('button', { class: 'btn sm', text: T('st.logoClear'), onclick: () => { HR.brand.setAsset(slot, null); draw(); } })
        ])
      ]);
    };
    /* ---- storage: what this app keeps in the browser, and the off switch */
    const lsSize = key => {
      try { const v = localStorage.getItem(key); return v ? v.length : 0; } catch (e) { return 0; }
    };
    const fmtSize = n => n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : (n ? n + ' B' : '—');

    const storageTab = () => {
      const wrap = el('div', { class: 'stack' });
      const on = !HR.storageMode || HR.storageMode.enabled();

      /* Master switch. Off = wipe + every save path becomes a no-op. */
      const toggle = el('input', { type: 'checkbox' });
      toggle.checked = on;
      toggle.addEventListener('change', () => {
        if (!toggle.checked) {
          if (!confirm(T('st.storageOffConfirm'))) { toggle.checked = true; return; }
          HR.storageMode.set(false);
          U.toast(T('st.storageOffDone'), 6000);
        } else {
          HR.storageMode.set(true);
          U.toast(T('st.storageOnDone'), 4000);
        }
        HR.app.go('settings', { tab: 'storage' });
      });
      const usage = el('input', { type: 'checkbox' });
      usage.checked = !HR.storageMode || HR.storageMode.usageAllowed();
      usage.addEventListener('change', () => HR.storageMode.setUsage(usage.checked));

      wrap.appendChild(card(T('st.storageTitle'), T('st.storageNote'), [
        el('label', { class: 'inline' }, [toggle, document.createTextNode(' ' + T('st.storageToggle'))]),
        el('p', { class: 'note', text: T('st.storageFlagNote') }),
        el('label', { class: 'inline', style: 'margin-top:8px' }, [usage, document.createTextNode(' ' + T('st.usageToggle'))]),
        el('p', { class: 'note', text: T('st.usageNote') })
      ]));

      /* The inventory: every store, what it holds, how big, and its clear. */
      const body = el('div');
      const drawRows = async () => {
        const snaps = await HR.store.list().catch(() => []);
        const ctx = await HR.store.loadContext().catch(() => null);
        const rawKinds = ctx
          ? ['recon', 'vault', 'rules', 'granted', 'history', 'products', 'assignments', 'directory', 'fieldMapping']
              .filter(k => ctx[k]).length
          : 0;
        const rows = [
          { name: T('st.storeConfig'), what: T('st.storeConfigWhat'), size: fmtSize(lsSize('hr.config.v1')),
            clear: async () => { if (!confirm(T('st.resetConfirm'))) return; settingsDraft = null; HR.config.reset(); await HR.app.rebuildBusy(); HR.app.go('settings', { tab: 'storage' }); } },
          { name: T('st.storeBrand'), what: T('st.storeBrandWhat'), size: fmtSize(lsSize('hr.brand')),
            clear: () => { try { localStorage.removeItem('hr.brand'); } catch (e) { /* ignore */ }
              Object.assign(HR.brand.state, { icon: null, logo: null, logoLight: null, productName: '', org: '', preparedBy: '', date: '',
                accent: '', defaultTheme: '', welcome: '', footerText: '', contact: '' });
              HR.brand.detectAuto().then(() => { HR.brand.apply(); HR.app.applyChrome(); HR.app.go('settings', { tab: 'storage' }); }); } },
          { name: T('st.storePrefs'), what: T('st.storePrefsWhat'),
            size: fmtSize(lsSize('hr.nav.v1') + lsSize('hr.theme') + lsSize('hr.lang')),
            clear: () => { ['hr.nav.v1', 'hr.theme', 'hr.lang'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
              HR.app.go('settings', { tab: 'storage' }); } },
          { name: T('st.storeSnapshots'), what: T('st.storeSnapshotsWhat', { n: U.fmtInt(snaps.length) }), size: snaps.length ? U.fmtInt(snaps.length) : '—',
            clear: async () => { if (!confirm(T('st.clearSnapshotsConfirm', { n: U.fmtInt(snaps.length) }))) return;
              await HR.store.clear(); await HR.app.refreshSnapshots(); HR.app.go('settings', { tab: 'storage' }); } },
          { name: T('st.storeContext'), what: T('st.storeContextWhat', { n: U.fmtInt(rawKinds) }), size: rawKinds ? U.fmtInt(rawKinds) : '—',
            clear: async () => { if (!confirm(T('st.clearContextConfirm'))) return;
              await HR.store.clearContext(); HR.app.go('settings', { tab: 'storage' }); } }
        ];
        const t = el('table', { class: 'tbl' });
        t.appendChild(el('thead', {}, el('tr', {}, [
          el('th', { class: 'no-sort', text: T('st.storeCol') }),
          el('th', { class: 'no-sort', text: T('st.storeWhatCol') }),
          el('th', { class: 'no-sort num', text: T('st.storeSizeCol') }),
          el('th', { class: 'no-sort' })
        ])));
        const tb = el('tbody');
        rows.forEach(r => tb.appendChild(el('tr', {}, [
          el('td', {}, el('strong', { text: r.name })),
          el('td', {}, el('span', { class: 'note', text: r.what })),
          el('td', { class: 'num', text: r.size }),
          el('td', {}, el('button', { class: 'btn sm danger', text: T('st.storeClear'), onclick: r.clear }))
        ])));
        t.appendChild(tb);
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'tbl-wrap' }, t));
        body.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
          el('button', { class: 'btn danger', text: T('st.clearAll'), onclick: async () => {
            if (!confirm(T('st.clearAllConfirm'))) return;
            HR.storageMode.wipe();
            await HR.app.refreshSnapshots();
            U.toast(T('st.clearAllDone'), 5000);
            HR.app.go('settings', { tab: 'storage' });
          } }),
          el('span', { style: 'flex:1' }),
          el('span', { class: 'note', text: T('st.storageExports') })
        ]));
      };
      drawRows();
      wrap.appendChild(card(T('st.storesTitle'), T('st.storesNote'), body));
      return wrap;
    };

    const aboutCard = () => card(T('st.about'), null, [
      dl([
        [T('st.productName'), HR.brand.state.productName || T('app.title')],
        [T('st.aboutVersion'), 'v' + HR.changelog.VERSION]
      ]),
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { class: 'btn sm', text: T('st.viewChangelog'), onclick: () => drawerChangelog() }))
    ]);

    const brandingTab = () => grid([card(T('st.branding'), T('st.brandingNote'), [
      el('div', { class: 'brand-slots' }, [
        slotRow('icon', 'st.slotIcon', 'logo-sample'),
        slotRow('logo', 'st.slotLogo', 'logo-sample'),
        slotRow('logoLight', 'st.slotLogoLight', 'logo-sample')
      ]),
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        (() => {
          const i = el('input', { type: 'text', value: B.productName || '', placeholder: T('app.title'),
            oninput: e => { HR.brand.set({ productName: e.target.value }); HR.app.applyChrome(); } });
          i.style.minWidth = '220px';
          return el('label', { class: 'inline' }, [document.createTextNode(T('st.productName')), i]);
        })(),
        (() => {
          /* The accent: one color input; clearing returns to the app palette. */
          const c = el('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(B.accent) ? B.accent : '#2a78d6' });
          c.addEventListener('input', () => { HR.brand.set({ accent: c.value }); HR.brand.apply(); });
          const clr = el('button', { class: 'btn sm ghost', text: T('st.accentClear'),
            onclick: () => { HR.brand.set({ accent: '' }); HR.brand.apply(); HR.app.go('settings', { tab: 'branding' }); } });
          return el('label', { class: 'inline' }, [document.createTextNode(T('st.accent')), c, clr]);
        })(),
        (() => {
          const s = el('select', {}, [
            el('option', { value: '', text: T('st.defaultTheme.app'), selected: !B.defaultTheme }),
            el('option', { value: 'light', text: T('st.defaultTheme.light'), selected: B.defaultTheme === 'light' }),
            el('option', { value: 'dark', text: T('st.defaultTheme.dark'), selected: B.defaultTheme === 'dark' })
          ]);
          s.addEventListener('change', () => HR.brand.set({ defaultTheme: s.value }));
          return el('label', { class: 'inline' }, [document.createTextNode(T('st.defaultTheme')), s]);
        })()
      ]),
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        (() => {
          const i = el('input', { type: 'text', value: B.welcome || '', placeholder: T('st.welcomePh'),
            oninput: e => HR.brand.set({ welcome: e.target.value }) });
          i.style.minWidth = '420px';
          return el('label', { class: 'inline' }, [document.createTextNode(T('st.welcome')), i]);
        })()
      ]),
      el('p', { class: 'note', text: T('st.logoHint') }),
      el('p', { class: 'note', text: T('st.brandExtrasNote') })
    ]), aboutCard()]);

    f.appendChild(tabbed('settings', [
      { id: 'classification', label: T('st.tab.classification'), build: classificationTab },
      { id: 'pricing', label: T('st.tab.pricing'), build: pricingTab },
      { id: 'weights', label: T('st.tab.weights'), build: weightsTab },
      { id: 'matching', label: T('st.tab.matching'), build: matchingTab },
      { id: 'branding', label: T('st.tab.branding'), build: brandingTab },
      { id: 'storage', label: T('st.tab.storage'), build: storageTab }
    ], params));
    return f;
  }

  /* ========================================================= ACTIVITY ==== */
  /* What HelloID granted and what it did: the record of its own actions, which is the
     only evidence that separates "the identity system never touched this" from "it tried
     and could not". */
  function activityView(m, params) {
    const f = document.createDocumentFragment();
    const h = m.history, g = m.granted;

    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('act.title') }),
      el('p', { text: T('act.lead') })
    ])));

    if (!h && !g) {
      f.appendChild(card(null, null, el('p', { text: T('act.empty') })));
      return f;
    }

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('act.kpiActions'), h ? U.fmtInt(h.meta.rowCount) : '—',
        h ? T('act.kpiActionsFoot', { days: h.meta.days,
          from: h.meta.from ? U.fmtDate(h.meta.from).split(',')[0] : '—',
          to: h.meta.to ? U.fmtDate(h.meta.to).split(',')[0] : '—' }) : '', { small: true }),
      tile(T('act.kpiFailed'), h ? U.fmtInt(h.meta.failedCount) : '—', T('act.kpiFailedFoot'),
        { small: true, severity: h && h.meta.failedCount ? 'high' : 'good' }),
      tile(T('act.kpiBlocked'), h ? U.fmtInt(h.meta.blockedCount) : '—', T('act.kpiBlockedFoot'),
        { small: true, severity: h && h.meta.blockedCount ? 'medium' : 'good' }),
      tile(T('act.kpiGranted'), g ? U.fmtInt(g.meta.rowCount) : '—',
        g && g.empty ? T('act.grantedEmpty') : T('act.kpiGrantedFoot', { p: g ? g.meta.persons : 0 }),
        { small: true, severity: g && g.empty ? 'medium' : 'good' })
    );
    f.appendChild(k);

    /* What happened, what went wrong, and what is held now — three questions that were
       three quarters of a screen apart. Declared out here because the granted export can
       arrive without any history beside it. */
    const charts = el('div', {});
    const problems = el('div', {});
    const granted = el('div', {});

    if (h) {
      const gr = el('div', { class: 'grid g2', style: 'margin-top:14px' });

      /* Grants and revokes per day: the shape of how the tenant actually moves. */
      const labels = h.timeline.map(d => d.day.slice(5));
      gr.appendChild(card(T('act.timeline'), T('act.timelineNote'), C.line([
        { label: T('act.opGrant'), color: C.slot(3), points: h.timeline.map((d, i) => ({ x: i, y: d.grant })) },
        { label: T('act.opRevoke'), color: C.slot(2), points: h.timeline.map((d, i) => ({ x: i, y: d.revoke })) },
        { label: T('act.opFailed'), color: C.STATUS.critical, points: h.timeline.map((d, i) => ({ x: i, y: d.failed })) }
      ], labels, { height: 220 })));

      gr.appendChild(card(T('act.origins'), T('act.originsNote'), C.barList(
        h.origins.map(([name, n], i) => ({ label: name, value: n, color: C.slot((i % 8) + 1) })),
        { valueLabel: T('act.cActions') })));
      charts.appendChild(gr);

      const gr2 = el('div', { class: 'grid g2', style: 'margin-top:14px' });
      gr2.appendChild(card(T('act.operations'), null, C.stackedBar(
        Object.entries(h.operations).map(([op, n], i) => ({ label: op, value: n, color: C.slot((i % 8) + 1) })))));
      gr2.appendChild(card(T('act.results'), null, C.stackedBar(
        Object.entries(h.results).map(([res, n]) => ({
          label: res, value: n,
          color: /succeed/i.test(res) ? C.STATUS.good : /fail/i.test(res) ? C.STATUS.critical : C.STATUS.warning
        })))));
      charts.appendChild(gr2);

      if (h.failed.length) {
        problems.appendChild(el('div', {}, card(T('act.failures'), T('act.failuresNote'),
          HR.table.make({
            columns: [
              { key: 'person', label: T('c.person'), value: r => r.personRaw },
              { key: 'entitlement', label: T('ru.cEntitlement'), value: r => r.entitlement },
              { key: 'operation', label: T('act.cOperation'), value: r => r.operation },
              { key: 'result', label: T('act.cResult'), value: r => r.result,
                render: r => el('span', { class: 'sev critical', text: r.result }) },
              { key: 'when', label: T('act.cWhen'), value: r => r.createdOn ? +r.createdOn : 0,
                render: r => r.createdOn ? U.fmtDate(r.createdOn) : '—' },
              { key: 'origins', label: T('act.cOrigins'), value: r => r.origins.join(', ') }
            ],
            rows: h.failed, pageSize: 20, exportName: 'failed-actions',
            initialSort: { key: 'when', dir: -1 },
            search: (r, q) => (r.personRaw + ' ' + r.entitlement).toLowerCase().includes(q)
          }))));
      }

      if (h.churn.length) {
        problems.appendChild(el('div', {}, card(T('act.churn'), T('act.churnNote'),
          HR.table.make({
            columns: [
              { key: 'person', label: T('c.person'), value: c => c.sample.personRaw },
              { key: 'entitlement', label: T('ru.cEntitlement'), value: c => c.sample.entitlement },
              { key: 'flips', label: T('act.cFlips'), num: true, value: c => c.flips },
              { key: 'actions', label: T('act.cActions'), num: true, value: c => c.rows.length },
              { key: 'last', label: T('act.cWhen'),
                value: c => { const l = c.rows[c.rows.length - 1]; return l.createdOn ? +l.createdOn : 0; },
                render: c => { const l = c.rows[c.rows.length - 1]; return l.createdOn ? U.fmtDate(l.createdOn) : '—'; } }
            ],
            rows: h.churn, pageSize: 20, exportName: 'churning-entitlements',
            initialSort: { key: 'flips', dir: -1 },
            search: (c, q) => (c.sample.personRaw + ' ' + c.sample.entitlement).toLowerCase().includes(q)
          }))));
      }
    }

    if (g && !g.empty) {
      granted.appendChild(el('div', {}, card(T('act.grantedTable'),
        T('act.grantedTableNote', { n: g.meta.persons }), HR.table.make({
          columns: [
            { key: 'person', label: T('c.person'), value: r => r.personRaw },
            { key: 'entitlement', label: T('ru.cEntitlement'), value: r => r.entitlement },
            { key: 'system', label: T('c.system'), value: r => r.system },
            { key: 'changed', label: T('act.cChanged'), value: r => r.lastChangedOn ? +r.lastChangedOn : 0,
              render: r => r.lastChangedOn ? U.fmtDate(r.lastChangedOn) : '—' }
          ],
          rows: g.rows, pageSize: 25, exportName: 'granted-entitlements',
          initialSort: { key: 'changed', dir: -1 },
          search: (r, q) => (r.personRaw + ' ' + r.entitlement).toLowerCase().includes(q)
        }))));
    }

      f.appendChild(HR.viewkit.tabbed('activity', [
        { id: 'flow', label: T('act.tab.flow'), build: () => charts },
        { id: 'problems', label: T('act.tab.problems'),
          count: m.history ? m.history.meta.failedCount + m.history.meta.blockedCount : null,
          build: () => problems.childNodes.length ? problems
            : card(T('act.tab.problems'), null, el('p', { class: 'note', text: T('act.noProblems') })) },
        { id: 'granted', label: T('act.tab.granted'),
          count: m.granted && !m.granted.empty ? m.granted.meta.rowCount : null,
          build: () => granted.childNodes.length ? granted
            : card(T('act.tab.granted'), null, el('p', { class: 'note', text: T('act.grantedEmpty') })) }
      ], params));
    return f;
  }

  /* ===================================================== EXPLANATIONS ==== */
  function explainView(m, params) {
    const f = document.createDocumentFragment();
    const e = m.explanation;
    const s = e.summary;

    const inputs = [];
    if (e.inputs.rules) inputs.push(T('ex.inputRules'));
    if (e.inputs.vault) inputs.push(T('ex.inputVault'));
    if (e.inputs.bundles) inputs.push(T('ex.inputBundles'));

    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('ex.title') }),
      el('p', { text: T('ex.lead') })
    ])));

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('ex.kpiExplained'), U.fmtPct(s.share, 0),
        T('ex.kpiExplainedFoot', { n: U.fmtInt(s.explained), total: U.fmtInt(s.total) }),
        { severity: s.share > 0.8 ? 'good' : s.share > 0.5 ? 'medium' : 'high' }),
      tile(T('ex.kpiUnexplained'), U.fmtInt(s.unexplained),
        T('ex.kpiUnexplainedFoot', { n: s.accountsWithResidue }),
        { severity: s.unexplained ? 'high' : 'good' }),
      tile(T('ex.kpiStrong'), U.fmtInt(s.strong), T('ex.kpiStrongFoot'), { small: true, severity: 'good' }),
      tile(T('ex.kpiInputs'), String(inputs.length || 0),
        inputs.length ? inputs.join(' · ') : T('ex.inputNone'),
        { small: true, severity: inputs.length >= 2 ? 'good' : 'medium' })
    );
    f.appendChild(k);

    const missing = [];
    if (!e.inputs.rules) missing.push('rules');
    if (!e.inputs.vault) missing.push('vault');
    if (!e.inputs.history) missing.push('history');
    const note = partialNotice(missing);
    if (note) { note.style.marginTop = '14px'; f.appendChild(note); }

    /* The shape of the answer, the rows themselves, and what is left over. */
    const summary = el('div', {});
    const rows = el('div', {});
    const residue = el('div', {});
    const g = el('div', { class: 'grid g2', style: 'margin-top:14px' });

    /* what explains the rows */
    const kindColours = [C.slot(3), C.slot(1), C.slot(7), C.slot(4), C.slot(6), C.slot(5), C.slot(2), C.slot(8)];
    const mix = e.byKind.map(([kind, n], i) => ({
      label: T('ex.kind.' + kind) !== 'ex.kind.' + kind ? T('ex.kind.' + kind) : kind,
      value: n, color: kindColours[i % kindColours.length]
    }));
    if (s.unexplained) mix.push({ label: T('ex.unexplainedLabel'), value: s.unexplained, color: C.STATUS.critical });
    g.appendChild(card(T('ex.mix'), T('ex.mixNote'), C.stackedBar(mix)));

    /* explained share per issue type */
    const issueRows = Array.from(e.byIssue.entries()).map(([issue, b]) => ({ issue, b }));
    g.appendChild(card(T('ex.byIssue'), null, HR.table.make({
      columns: [
        { key: 'issue', label: T('ex.cIssue'), value: r => r.issue },
        { key: 'total', label: T('ex.cTotal'), num: true, value: r => r.b.total },
        { key: 'explained', label: T('ex.cExplained'), num: true, value: r => r.b.explained },
        { key: 'share', label: T('ex.cShare'), num: true, value: r => r.b.total ? r.b.explained / r.b.total : 0,
          render: r => U.fmtPct(r.b.total ? r.b.explained / r.b.total : 0, 0) },
        { key: 'strong', label: T('ex.cStrong'), num: true, value: r => r.b.strong }
      ], rows: issueRows, pageSize: 10, exportName: 'explained-by-issue'
    })));
    summary.appendChild(g);

    /* the residue: what nobody can account for */
    if (e.residueByAccount.length) {
      residue.appendChild(el('div', {}, card(T('ex.residue'), T('ex.residueNote'), HR.table.make({
        columns: [
          { key: 'account', label: T('ex.cAccount'), value: r => r.account.userName },
          { key: 'person', label: T('c.person'),
            render: r => r.account.personRaw ? el('span', { text: r.account.personName })
              : el('span', { class: 'sev critical', text: T('c.unowned') }) },
          { key: 'cls', label: T('c.class'), value: r => r.account.clsLabel },
          { key: 'rows', label: T('ex.cRows'), num: true, value: r => r.rows.length },
          { key: 'groupCount', label: T('ex.cGroups'), num: true,
            value: r => U.uniq(r.permissions.map(p => p.name)).length },
          /* The full list goes to the export and the tooltip; the cell shows enough to
             recognise the account without turning the row into a paragraph. */
          { key: 'groups', label: T('ex.cSample'),
            value: r => U.uniq(r.permissions.map(p => p.name)).join(', '),
            render: r => {
              const names = U.uniq(r.permissions.map(p => p.name));
              const shown = names.slice(0, 2).join(', ');
              const rest = names.length - 2;
              return el('span', { class: 'nowrap-cell', title: names.join(', ') }, [
                el('span', { class: 'nowrap-text', text: shown || '—' }),
                rest > 0 ? el('span', { class: 'pill', text: T('ex.andMore', { n: rest }) }) : null
              ]);
            } },
          { key: 'risk', label: T('c.risk'), num: true, value: r => r.account.riskScore, render: r => scoreBar(r.account.riskScore) }
        ],
        rows: e.residueByAccount, pageSize: 20, exportName: 'unexplained-rows',
        initialSort: { key: 'rows', dir: -1 },
        search: (r, q) => (r.account.userName + ' ' + r.account.personRaw).toLowerCase().includes(q),
        onRowClick: r => drawerAccount(r.account)
      }))));
    }

    /* every row, with its reason */
    const STRENGTH_SEV = { strong: 'good', likely: 'medium', weak: 'low' };
    rows.appendChild(el('div', {}, card(T('ex.table'), null, HR.table.make({
      columns: [
        { key: 'issue', label: T('ex.cIssue'), value: r => r.issue },
        { key: 'account', label: T('ex.cAccount'), value: r => r.record.userName },
        { key: 'permission', label: T('ex.cPermission'), value: r => r.record.permission || '—' },
        { key: 'kind', label: T('ex.cKind'),
          value: r => r.explanation ? T('ex.kind.' + r.explanation.kind) : T('ex.unexplainedLabel'),
          render: r => r.explanation
            ? el('span', { text: T('ex.kind.' + r.explanation.kind) })
            : el('span', { class: 'sev critical', text: T('ex.unexplainedLabel') }) },
        { key: 'strength', label: T('ex.cStrength'),
          value: r => r.strength || 'zz',
          render: r => r.strength
            ? el('span', { class: 'sev ' + STRENGTH_SEV[r.strength], text: T('ex.strength' + r.strength.charAt(0).toUpperCase() + r.strength.slice(1)) })
            : '—' },
        { key: 'detail', label: T('ex.cDetail'),
          value: r => r.explanation ? T('ex.kind.' + r.explanation.kind + '.d', r.explanation.params) : '',
          render: r => el('span', { class: 'trunc',
            title: r.explanation ? T('ex.kind.' + r.explanation.kind + '.d', r.explanation.params) : '',
            text: r.explanation ? T('ex.kind.' + r.explanation.kind + '.d', r.explanation.params) : '—' }) }
      ],
      rows: e.rows, pageSize: 30, exportName: 'explanations',
      searchPlaceholder: T('ac.searchPh'),
      search: (r, q) => (r.record.userName + ' ' + (r.record.permission || '') + ' ' +
        (r.explanation ? r.explanation.kind : '')).toLowerCase().includes(q),
      filters: [
        { key: 'issue', label: T('ex.cIssue'), options: U.uniq(e.rows.map(r => r.issue)).map(v => ({ value: v, label: v })),
          match: (r, v) => r.issue === v },
        { key: 'kind', label: T('ex.cKind'),
          options: e.byKind.map(([kind]) => ({ value: kind, label: T('ex.kind.' + kind) }))
            .concat([{ value: '__none', label: T('ex.unexplainedLabel') }]),
          match: (r, v) => v === '__none' ? !r.explanation : (r.explanation && r.explanation.kind === v) },
        { key: 'strength', label: T('ex.cStrength'),
          options: ['strong', 'likely', 'weak'].map(v => ({ value: v, label: T('ex.strength' + v.charAt(0).toUpperCase() + v.slice(1)) })),
          match: (r, v) => r.strength === v }
      ],
      onRowClick: r => { if (r.account) drawerAccount(r.account); }
    }))));


    f.appendChild(HR.viewkit.tabbed('explain', [
      { id: 'summary', label: T('ex.tab.summary'), build: () => summary },
      { id: 'rows', label: T('ex.tab.rows'), count: e.summary.total, build: () => rows },
      { id: 'residue', label: T('ex.tab.residue'), count: e.summary.unexplained,
        build: () => residue.childNodes.length ? residue
          : card(T('ex.tab.residue'), null, el('p', { class: 'note', text: T('ex.residueNone') })) }
    ], params));
    return f;
  }

  /* ==================================================== BUSINESS RULES ==== */
  /* The rule export next to the reconciliation export: what the model says should be
     granted, against what the target system hands out. */

  /**
   * Optimising the rules a tenant already runs, which is a different job from mining.
   *
   * Two halves that pull against each other: fewer rules for the same result, and more
   * rules to cover what none of them do. Both are proposals — nothing here is applied to
   * anything — and the first is priced in SOLL so the trade is visible rather than
   * implied.
   */
  function condenseRulesCard(m) {
    /* The lossless transpose is pure syntax over the rules themselves; only people
       counts and near-miss trades need an evaluation, so the card renders without one. */
    if (!m.ruleSet) return null;
    let c = null;
    try { c = HR.optimise.condenseRules(m, m.ruleSet, m.evaluation); } catch (e) { return null; }
    if (!c) return null;

    const s = c.summary;
    if (!c.proposals.length) {
      return card(T('op.cdTitle'), T('op.cdNote'), el('p', { class: 'note',
        text: T('op.cdNothing', { n: s.rules }) }));
    }

    return card(T('op.cdTitle'), T('op.cdNote'), [
      el('p', { text: T('op.cdLead', {
        before: s.rules, after: s.after, merges: s.merges,
        replaces: s.replaces, added: s.added }) }),
      m.evaluation ? null : el('p', { class: 'note', text: T('op.cdNoEval') }),
      HR.table.make({
        columns: [
          { key: 'cond', label: T('op.cCondition'), value: p => p.facet + ': ' + p.values.join(', '),
            render: p => el('span', {}, [
              el('span', { class: 'pill', text: p.facet }),
              el('span', { class: 'mono', text: ' ' + T('py.oneOf', { values: p.values.join(', ') }) })
            ]) },
          { key: 'replaces', label: T('op.cReplaces'), value: p => p.replaces, align: 'right' },
          { key: 'ents', label: T('py.cGrants'), value: p => p.entitlements.length, align: 'right' },
          { key: 'people', label: T('op.cPeople'), value: p => p.people.length, align: 'right',
            render: p => (m.evaluation || p.people.length)
              ? el('span', { text: U.fmtInt(p.people.length) })
              : el('span', { class: 'note', text: '—' }) },
          { key: 'trade', label: T('op.cTrade'), value: p => p.added.length,
            hint: T('op.cTradeHint'),
            render: p => p.added.length
              ? el('a', { href: '#', class: 'sev medium',
                  text: T('op.nPairs', { n: U.fmtInt(p.added.length) }),
                  onclick: e => { e.preventDefault(); drawerTrade(m, p); } })
              : el('span', { class: 'sev good', text: T('op.noTrade') }) },
          { key: 'rules', label: T('op.cRules'), sortable: false,
            render: p => el('span', { class: 'trunc', title: p.rules.map(r => r.name).join(', '),
              text: p.rules.map(r => r.name).join(', ') }) }
        ],
        rows: c.proposals, pageSize: 10, exportName: 'condensed-rules'
      }),
      el('div', { class: 'slot-actions' }, [
        el('button', { class: 'btn', text: T('op.cdExport'), onclick: () => {
          U.download('condensed-rules.csv', HR.optimise.toRulesCsv(c.proposals), 'text/csv');
          HR.usage.exported('condensed-rules');
        } })
      ]),
      el('p', { class: 'note', text: T('op.cdFoot', { max: c.maxTrade }) })
    ].filter(Boolean));
  }

  /** Exactly who would gain what, for a merge that is not free. */
  function drawerTrade(m, proposal) {
    const body = el('div', { class: 'stack' }, [
      el('p', { text: T('op.tradeLead', {
        n: proposal.added.length, rules: proposal.replaces,
        facet: proposal.facet, values: proposal.values.join(', ') }) }),
      HR.table.make({
        columns: [
          { key: 'person', label: T('py.cPerson'), value: r => r.person.displayName },
          { key: 'ent', label: T('py.cEntitlement'), value: r => r.ent.name },
          { key: 'dept', label: T('pp.department'),
            value: r => (r.person.primaryContract && r.person.primaryContract.department.name) || '' }
        ],
        rows: proposal.added, pageSize: 15, exportName: 'merge-trade-off'
      })
    ]);
    openDrawer(el('div', {}, [
      el('div', { text: T('op.tradeTitle') }),
      el('span', { class: 'note', text: proposal.rules.map(r => r.name).join(' · ') })
    ]), body);
  }

  /** What to add, ranked by the drift it would take out of the reconciliation. */
  function extendRulesCard(m) {
    if (!m.comparison || !m.vault) return null;
    let P = null, e = null;
    try { P = HR.pyramid.build(m); e = HR.optimise.extensions(m, m.comparison, P); }
    catch (err) { return null; }
    if (!e || !e.candidates.length) return null;

    return card(T('op.exTitle'), T('op.exNote'), [
      el('p', { text: T('op.exLead', {
        n: e.summary.candidates, ents: e.summary.entitlements,
        unmodelled: e.summary.unmodelled, drift: U.fmtInt(e.summary.drift),
        share: U.fmtPct(e.summary.share, 0) }) }),
      HR.table.make({
        columns: [
          { key: 'cond', label: T('op.cWho'),
            value: c => c.conds.map(x => (x.labels[0] || x.values[0])).join(' + ') || T('py.everyone') },
          { key: 'ents', label: T('op.cCovers'), value: c => c.entitlements.length, align: 'right' },
          { key: 'people', label: T('op.cPeople'), value: c => c.members.length, align: 'right' },
          { key: 'drift', label: T('op.cDrift'), value: c => c.drift, align: 'right',
            hint: T('op.cDriftHint') },
          { key: 'list', label: T('py.cGets'), sortable: false,
            render: c => el('span', { class: 'trunc',
              title: c.entitlements.map(x => x.perm && x.perm.name).filter(Boolean).join(', '),
              text: c.entitlements.map(x => x.perm && x.perm.name).filter(Boolean).join(', ') }) }
        ],
        rows: e.candidates, pageSize: 10, exportName: 'rule-additions'
      }),
      el('p', { class: 'note', text: T('op.exFoot') })
    ]);
  }

  function rulesView(m, params) {
    const f = document.createDocumentFragment();
    const c = m.comparison;

    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('ru.title') }),
        el('p', { text: T('ru.lead') })
      ]),
      c ? el('button', { class: 'btn sm', text: T('ru.clear'), onclick: () => {
        HR.app.state.ruleSet = null; HR.app.rebuildBusy().then(() => U.toast(T('toast.rulesCleared')));
      } }) : null
    ]));

    if (!c) {
      const note = partialNotice(['rules']);
      if (note) f.appendChild(note);
      f.appendChild(card(null, null, el('p', { text: T('ru.empty') })));
      f.appendChild(miningCard(m));
      return f;
    }

    const s = c.summary;
    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('ru.kpiRules'), U.fmtInt(s.rules), T('ru.kpiRulesFoot', { live: s.live, draft: s.draft }), { small: true }),
      tile(T('ru.kpiCoverage'), U.fmtPct(s.coverage, 0),
        T('ru.kpiCoverageFoot', { modelled: s.modelledPermissions, total: s.permissions }),
        { small: true, severity: s.coverage > 0.75 ? 'good' : s.coverage > 0.4 ? 'medium' : 'high' }),
      tile(T('ru.kpiUnmodelled'), U.fmtInt(s.unmanagedUnmodelled),
        T('ru.kpiUnmodelledFoot', { share: U.fmtPct(s.modelShare, 0) }),
        { small: true, severity: s.modelShare > 0.5 ? 'high' : 'medium' }),
      tile(T('ru.kpiStale'), U.fmtInt(s.staleCount),
        T('ru.kpiStaleFoot', { n: c.staleEntitlements.length }),
        { small: true, severity: s.staleCount ? 'high' : 'good' })
    );
    f.appendChild(k);

    /* Four questions, four sections: where the drift comes from, what the rules do,
       what is wrong with them, and how to make the set better. */
    const shape = el('div', {});
    /* ---- the split that decides where the work goes ---- */
    shape.appendChild(el('div', { class: 'grid', style: 'margin-top:14px' },
      card(T('ru.split'), T('ru.splitNote'), [
        C.stackedBar([
          { label: T('ru.splitModelled'), value: s.unmanagedModelled, color: C.slot(3) },
          { label: T('ru.splitDraft'), value: s.unmanagedDraft, color: C.STATUS.warning },
          { label: T('ru.splitUnmodelled'), value: s.unmanagedUnmodelled, color: C.STATUS.critical }
        ]),
        el('p', { class: 'note', text: T('ru.splitFoot') })
      ])));

    /* ---- every rule, against reality ---- */
    shape.appendChild(el('div', { style: 'margin-top:14px' }, card(T('ru.rulesTable'), T('ru.rulesTableNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('ru.cName'), value: r => r.rule.name },
        { key: 'status', label: T('ru.cStatus'), value: r => r.rule.status,
          render: r => el('span', { class: 'pill' + (r.live ? '' : ' removed'), text: r.rule.status }) },
        { key: 'persons', label: T('ru.cPersons'), num: true, hint: T('ru.cPersonsHint'),
          value: r => r.rule.personsEvaluated == null ? -1 : r.rule.personsEvaluated,
          render: r => r.rule.personsEvaluated == null ? '—' : U.fmtInt(r.rule.personsEvaluated) },
        { key: 'ent', label: T('ru.cEnt'), num: true, value: r => r.matched.length,
          render: r => U.fmtInt(r.matched.length) + (r.accountEntitlements.length ? ' + ' + T('ru.accountEnt') : '') },
        { key: 'stale', label: T('ru.cStale'), num: true, hint: T('ru.cStaleHint'), value: r => r.stale.length,
          render: r => r.stale.length ? el('span', { class: 'sev high', text: String(r.stale.length) }) : '—' },
        { key: 'holders', label: T('ru.cHolders'), num: true, hint: T('ru.cHoldersHint'), value: r => r.holderCount },
        { key: 'unmanaged', label: T('ru.cUnmanaged'), num: true, value: r => r.unmanagedRows },
        { key: 'scope', label: T('ru.cScope'),
          value: r => r.rule.scopingConditions.map(x => x.facet).join(', '),
          /* No scoping condition does not mean no condition: every rule carries the
             Person and time-frame clauses, so the honest reading is "everyone active". */
          render: r => r.rule.scopingConditions.length
            ? el('span', { class: 'trunc', title: r.rule.scopingConditions.map(x => x.raw).join(' · '),
                text: r.rule.scopingConditions.map(x => x.facet).join(', ') })
            : el('span', { class: 'note', title: r.rule.conditions.map(x => x.raw).join(' · '),
                text: T('ru.scopeAll') }) },
        m.evaluation ? { key: 'people', label: T('ru.cSelected'), num: true,
          value: r => (m.evaluation.perRule.get(r.rule.name) || { matched: [] }).matched.length } : null
      ].filter(Boolean),
      rows: c.perRule, pageSize: 25, exportName: 'business-rules',
      initialSort: { key: 'unmanaged', dir: -1 },
      search: (r, q) => (r.rule.name + ' ' + r.rule.raw.conditions).toLowerCase().includes(q),
      filters: [
        { key: 'status', label: T('ru.cStatus'),
          options: U.uniq(c.perRule.map(r => r.rule.status)).map(v => ({ value: v, label: v })),
          match: (r, v) => r.rule.status === v },
        { key: 'issue', label: T('ru.cFlag'), options: [
          { value: 'stale', label: T('ru.cStale') },
          { value: 'empty', label: T('ru.cPersons') + ' = 0' }
        ], match: (r, v) => v === 'stale' ? r.stale.length > 0 : r.rule.personsEvaluated === 0 }
      ],
      onRowClick: r => drawerRule(r, m)
    }))));

    /* ---- the backlog: groups nothing describes ---- */
    shape.appendChild(el('div', { style: 'margin-top:14px' }, card(T('ru.backlog'), T('ru.backlogNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('ru.cGroup'), value: r => r.perm.name },
        { key: 'cat', label: T('c.category'), value: r => r.perm.categoryLabel },
        { key: 'rows', label: T('ru.cRows'), num: true, value: r => r.unmanagedRows },
        { key: 'holders', label: T('c.holders'), num: true, value: r => r.perm.holderCount },
        { key: 'cost', label: T('c.totalMo'), num: true, value: r => r.perm.monthlyTotal || 0,
          render: r => r.perm.monthlyTotal ? U.fmtMoney(r.perm.monthlyTotal) : '—' },
        { key: 'risk', label: T('c.risk'), num: true, value: r => r.perm.riskScore, render: r => scoreBar(r.perm.riskScore) }
      ],
      rows: c.unmodelled, pageSize: 25, exportName: 'unmodelled-groups',
      initialSort: { key: 'rows', dir: -1 },
      search: (r, q) => r.perm.name.toLowerCase().includes(q),
      onRowClick: r => drawerPermission(r.perm, m)
    }))));

    const g2 = el('div', { class: 'grid g2', style: 'margin-top:14px' });

    if (c.staleEntitlements.length) {
      const rows = c.staleEntitlements.flatMap(h => h.stale.map(e => ({ rule: h.rule, ent: e })));
      g2.appendChild(card(T('ru.staleTable'), T('ru.staleTableNote'), HR.table.make({
        columns: [
          { key: 'rule', label: T('ru.cRule'), value: r => r.rule.name },
          { key: 'ent', label: T('ru.cEntitlement'), value: r => r.ent.name },
          { key: 'system', label: T('c.system'), value: r => r.ent.system }
        ], rows, pageSize: 12, exportName: 'stale-entitlements'
      })));
    }

    if (c.missingAttribution.length) {
      g2.appendChild(card(T('ru.attribution'), T('ru.attributionNote'), HR.table.make({
        columns: [
          { key: 'account', label: T('ru.cAccount'), value: r => r.userName },
          { key: 'perm', label: T('c.permission'), value: r => r.permission },
          { key: 'rule', label: T('ru.cRule'), value: r => r.rules.map(x => x.name).join(', '),
            render: r => r.rules.length
              ? el('span', { text: r.rules.map(x => x.name).join(', ') })
              : el('span', { class: 'sev medium', text: T('ru.noRule') }) }
        ], rows: c.missingAttribution, pageSize: 12, exportName: 'failed-grants'
      })));
    }

    if (c.overlapping.length) {
      g2.appendChild(card(T('ru.overlap'), T('ru.overlapNote'), HR.table.make({
        columns: [
          { key: 'name', label: T('ru.cGroup'), value: r => r.perm.name },
          { key: 'n', label: T('ru.cRuleCount'), num: true, value: r => r.rules.length },
          { key: 'rules', label: T('ru.cRule'), value: r => r.rules.map(x => x.name).join(', '),
            render: r => el('span', { class: 'trunc', title: r.rules.map(x => x.name).join(', '),
              text: r.rules.map(x => x.name).join(', ') }) }
        ], rows: c.overlapping, pageSize: 12, exportName: 'overlapping-rules'
      })));
    }
    if (g2.childNodes.length) shape.appendChild(g2);

    /* The point of the view: fewer rules for the same result, and rules for what none
       of them cover. */
    const condensed = condenseRulesCard(m);
    if (condensed) shape.appendChild(condensed);
    const extend = extendRulesCard(m);
    if (extend) shape.appendChild(extend);


    f.appendChild(HR.viewkit.tabbed('rules', [
      { id: 'coverage', label: T('ru.tab.coverage'), build: () => shape },
      { id: 'optimise', label: T('ru.tab.optimise'), build: () => {
        const wrap = el('div', {});
        const condensed = condenseRulesCard(m);
        if (condensed) wrap.appendChild(condensed);
        const extend = extendRulesCard(m);
        if (extend) wrap.appendChild(extend);
        if (!wrap.childNodes.length) {
          wrap.appendChild(card(T('op.none'), null, el('p', { class: 'note', text: T('op.noneNote') })));
        }
        return wrap;
      } },
      { id: 'mining', label: T('ru.tab.mining'), build: () => miningCard(m) }
    ], params));
    return f;
  }

  /**
   * Where proposals come from depends on what is loaded.
   *
   * Without a vault, the only thing to mine is which entitlements travel together —
   * real bundles, but nothing says who should get them, so every proposal still needs a
   * human to invent its condition. With a vault, the organisation's own attributes are
   * available and the pyramid mines rules that already carry their condition. Both in
   * one place, pointing at each other, so it is clear which one is the fallback.
   */
  function miningCard(m) {
    if (!m.vault) {
      const card1 = proposalsCard(m);
      card1.appendChild(el('p', { class: 'note', style: 'margin-top:10px' }, [
        document.createTextNode(T('ro.withoutVault') + ' '),
        el('a', { href: '#sources', text: T('ro.loadVault'),
          onclick: e => { e.preventDefault(); HR.app.go('sources'); } })
      ]));
      return card1;
    }

    let P = null;
    try { P = HR.pyramid.build(m); } catch (e) { /* falls back to the bundle card below */ }
    if (!P || P.unavailable) return proposalsCard(m);

    const s2 = P.summary;
    /* The condensed set is canonical: same count and same export as the Mining view. */
    let CD = null;
    try {
      CD = HR.pyramid.condensedOf(m, P);
      HR.pyramid.rankForCap(m, P, CD);     // ranks the set so the export reads best-first
    } catch (e) { CD = null; }
    const ruleCount = CD ? CD.summary.after + (P.ruleGroups.has(P.root) ? 1 : 0)
      : s2.rules + s2.combos;
    return card(T('ro.pyramidTitle'), T('ro.pyramidNote'), [
      el('p', { text: T('ro.pyramidLead', {
        rules: U.fmtInt(ruleCount),
        grants: U.fmtInt(s2.grants + s2.comboGrants),
        levels: P.levels.map(l => T('py.attr.' + l) || l).join(' \u203a ') || T('py.noLevels'),
        coverage: U.fmtPct(s2.coverage, 0)
      }) }),
      el('div', { class: 'slot-actions' }, [
        el('button', { class: 'btn primary', text: T('ro.openPyramid'),
          onclick: () => HR.app.go('mining') }),
        el('button', { class: 'btn', text: T('py.export'), onclick: () => {
          U.download('pyramid-rules.csv', CD
            ? HR.pyramid.condensedToRulesCsv(m, CD)
            : HR.pyramid.toRulesCsv(m, P), 'text/csv');
          HR.usage.exported('pyramid-rules');
        } })
      ]),
      el('p', { class: 'note', style: 'margin-top:10px', text: T('ro.bundlesSecondary') })
    ]);
  }

  /** Mined bundles, presented as rules someone could actually write. */
  function proposalsCard(m) {
    const mined = HR.roles.mine(m);
    if (!mined.proposals.length) {
      return card(T('ro.title'), T('ro.note'), el('p', { class: 'note', text: T('ro.none') }));
    }
    const body = el('div');
    body.appendChild(HR.table.make({
      columns: [
        { key: 'name', label: T('ro.cName'), value: p => p.suggestedName },
        { key: 'groups', label: T('ro.cGroups'), num: true, value: p => p.perms.length },
        { key: 'members', label: T('ro.cMembers'), num: true, value: p => p.support },
        { key: 'cohesion', label: T('ro.cCohesion'), num: true, hint: T('ro.cCohesionHint'),
          value: p => p.cohesion, render: p => U.fmtPct(p.cohesion, 0) },
        { key: 'assignments', label: T('ro.cAssignments'), num: true, hint: T('ro.cAssignmentsHint'),
          value: p => p.assignments },
        { key: 'exceptions', label: T('ro.cExceptions'), num: true, hint: T('ro.cExceptionsHint'),
          value: p => p.nearMiss.length, render: p => p.nearMiss.length || '—' },
        { key: 'cost', label: T('c.totalMo'), num: true, value: p => p.monthlyCost,
          render: p => p.monthlyCost ? U.fmtMoney(p.monthlyCost) : '—' },
        { key: 'list', label: T('ro.cGroups'), sortable: false,
          render: p => el('span', { class: 'trunc', title: p.perms.map(x => x.name).join(', '),
            text: p.perms.map(x => x.name).join(', ') }) }
      ],
      rows: mined.proposals, pageSize: 15, exportName: 'proposed-rules',
      initialSort: { key: 'assignments', dir: -1 },
      search: (p, q) => (p.suggestedName + ' ' + p.perms.map(x => x.name).join(' ')).toLowerCase().includes(q),
      onRowClick: p => drawerProposal(p, m)
    }));
    body.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', {
        class: 'btn sm', text: T('ro.export'),
        onclick: () => U.download('proposed-rules.csv',
          HR.roles.toRulesCsv(mined.proposals, m.systemList[0] ? m.systemList[0].name : ''),
          'text/csv;charset=utf-8')
      }),
      el('span', { class: 'note', text: T('ro.statsFoot', {
        proposals: mined.stats.proposals, bundles: mined.stats.bundlesFound,
        assignments: U.fmtInt(mined.stats.assignmentsCovered)
      }) })
    ]));
    return card(T('ro.title'), T('ro.note'), body);
  }

  /** One proposal: its groups, who holds the whole set, and who is one short. */
  function drawerProposal(p, m) {
    const head = el('div', {}, [
      el('h2', { text: p.suggestedName }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: p.perms.length + ' ' + T('ro.cGroups').toLowerCase() }),
        el('span', { class: 'pill', text: p.support + ' ' + T('ro.cMembers').toLowerCase() }),
        el('span', { class: 'pill', text: T('ro.cCohesion') + ' ' + U.fmtPct(p.cohesion, 0) })
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(el('p', { class: 'note', text: T('ro.conditionWarn') }));
    body.appendChild(card(T('ro.drawerGroups'), null, HR.table.make({
      columns: [
        { key: 'name', label: T('ru.cGroup'), value: x => x.name },
        { key: 'cat', label: T('c.category'), value: x => x.categoryLabel },
        { key: 'holders', label: T('c.holders'), num: true, value: x => x.holderCount },
        { key: 'cost', label: T('c.unitMo'), num: true, value: x => x.monthlyPrice || 0,
          render: x => x.monthlyPrice ? U.fmtMoney(x.monthlyPrice) : '—' }
      ], rows: p.perms, pageSize: 10, exportName: 'proposal-groups',
      onRowClick: x => drawerPermission(x, m)
    })));
    body.appendChild(card(T('ro.drawerMembers'), T('dr.accountsN', { n: p.members.length }), HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account') },
        { key: 'personName', label: T('c.person'),
          render: a => a.personRaw ? el('span', { text: a.personName }) : el('span', { class: 'sev critical', text: T('c.unowned') }) },
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'riskScore', label: T('c.risk'), num: true, render: a => scoreBar(a.riskScore) }
      ], rows: p.members, pageSize: 12, exportName: 'proposal-members',
      onRowClick: a => drawerAccount(a)
    })));
    if (p.nearMiss.length) {
      const permKeys = p.perms.map(x => x.key);
      body.appendChild(card(T('ro.drawerExceptions'), T('dr.accountsN', { n: p.nearMiss.length }), HR.table.make({
        columns: [
          { key: 'userName', label: T('c.account') },
          { key: 'missing', label: T('ro.cGroups'), sortable: false, render: a => {
            const gap = p.perms.find(x => !a.permKeys.has(x.key));
            return el('span', { class: 'sev medium', text: gap ? T('ro.missingGroup', { name: gap.name }) : '—' });
          } },
          { key: 'riskScore', label: T('c.risk'), num: true, render: a => scoreBar(a.riskScore) }
        ], rows: p.nearMiss, pageSize: 12, exportName: 'proposal-exceptions',
        onRowClick: a => drawerAccount(a)
      })));
    }
    openDrawer(head, body);
  }

  /** One rule: its conditions, what it grants, and what reality says about each group. */
  function drawerRule(row, m) {
    const r = row.rule;
    const head = el('div', {}, [
      el('h2', { text: r.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill' + (row.live ? '' : ' removed'), text: r.status }),
        el('span', { class: 'pill', text: T('ru.cPersons') + ': ' + (r.personsEvaluated == null ? '—' : r.personsEvaluated) }),
        el('span', { class: 'pill', text: T('ru.cHolders') + ': ' + row.holderCount })
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(dl([
      [T('ru.cStatus'), r.status],
      [T('c.category'), r.categories.join(', ') || '—'],
      [T('c.system'), r.systems.join(', ') || '—'],
      [T('ru.cUnmanaged'), U.fmtInt(row.unmanagedRows)],
      [T('dr.monthlyCost'), row.monthlyCost ? U.fmtMoney(row.monthlyCost) : '—']
    ]));

    body.appendChild(card(T('ru.cScope'), T('ru.scopeNote'), el('table', { class: 'cond-list' },
      r.conditions.map(cd => el('tr', {}, [
        el('td', {}, el('span', { class: 'pill', text: cd.facet })),
        el('td', { style: 'width:1%;white-space:nowrap' },
          cd.operator ? el('span', { class: 'pill muted', text: cd.operator }) : null),
        el('td', { class: 'mono', text: cd.values.join(', ') || '—' })
      ])))));

    body.appendChild(card(T('ru.cEnt'), T('dr.groupsN', { n: row.matched.length }), HR.table.make({
      columns: [
        { key: 'name', label: T('ru.cGroup'), value: x => x.perm.name },
        { key: 'holders', label: T('c.holders'), num: true, value: x => x.perm.holderCount },
        { key: 'unmanaged', label: T('ru.cUnmanaged'), num: true,
          value: x => x.perm.issues[m.ISSUE_PERM_UNMANAGED] || 0 },
        { key: 'risk', label: T('c.risk'), num: true, value: x => x.perm.riskScore }
      ], rows: row.matched, pageSize: 12, exportName: 'rule-' + r.name,
      onRowClick: x => drawerPermission(x.perm, m)
    })));

    if (row.stale.length) {
      body.appendChild(card(T('ru.staleTable'), T('ru.staleTableNote'),
        el('ul', { class: 'clean' }, row.stale.map(e => el('li', { class: 'mono', text: e.raw })))));
    }
    if (row.accountEntitlements.length) {
      body.appendChild(card(T('ru.accountEntTitle'), null,
        el('ul', { class: 'clean' }, row.accountEntitlements.map(e => el('li', { class: 'mono', text: e.raw })))));
    }

    /* Who this rule actually selects — the export-users-per-rule ask from the
       feedback board. Evaluation needs the vault; without it, say so. */
    if (m.evaluation) {
      const bucket = m.evaluation.perRule.get(r.name);
      if (bucket) {
        const contract = p => p.primaryContract || p.activeContracts[0] || p.contracts[0] || null;
        const refName = ref => (ref && ref.name) || '';
        const rows = bucket.matched.map(p => {
          const c = contract(p);
          return { name: p.displayName || p.externalId, externalId: p.externalId,
            department: c ? refName(c.department) : '', title: c ? refName(c.title) : '' };
        });
        body.appendChild(card(T('ru.peopleTitle'), T('ru.peopleNote', { n: rows.length }), HR.table.make({
          columns: [
            { key: 'name', label: T('c.person') },
            { key: 'externalId', label: T('pp.employeeId') },
            { key: 'department', label: T('no.dept') },
            { key: 'title', label: T('no.func') }
          ], rows, pageSize: 12, exportName: 'rule-' + r.name + '-people',
          search: (x, q) => (x.name + ' ' + x.externalId + ' ' + x.department + ' ' + x.title).toLowerCase().includes(q)
        })));
        if (bucket.indeterminate.length) {
          const d = el('details', {});
          d.appendChild(el('summary', { class: 'note',
            text: T('ru.peopleUnknown', { n: bucket.indeterminate.length }) }));
          d.appendChild(el('p', { class: 'note',
            text: bucket.indeterminate.slice(0, 150).map(p => p.displayName || p.externalId).join(', ') +
              (bucket.indeterminate.length > 150 ? ' …' : '') }));
          body.appendChild(d);
        }
      }
    } else if (!m.vault) {
      body.appendChild(el('p', { class: 'note', text: T('ru.peopleNeedsVault') }));
    }
    openDrawer(head, body);
  }

  /* Live pattern tester: a pattern, a target list, the matches. Used by the
     Settings matching tab; the old configuration review that also used it was
     replaced by the classification wizard (js/views-wizard.js). */
  function regexTester(m) {
    const wrap = el('div', { class: 'stack' });
    const input = el('input', { type: 'text', placeholder: T('rv.testerEmpty') });
    input.style.flex = '1';
    const target = el('select', {}, [
      el('option', { value: 'permission', text: T('rv.targetPermission') }),
      el('option', { value: 'account', text: T('rv.targetAccount') })
    ]);
    const out = el('div', {});
    const run = () => {
      out.innerHTML = '';
      if (!input.value.trim()) return;
      const res = HR.mine.test(input.value.trim(), target.value, m);
      if (!res.valid) {
        out.appendChild(el('p', { class: 'note sev high', text: res.error }));
        return;
      }
      out.append(
        el('p', { class: 'note', text: T('rv.matchCount', { n: U.fmtInt(res.count), total: U.fmtInt(res.total), pct: U.fmtPct(res.total ? res.count / res.total : 0, 0) }) +
          (res.everything ? ' · ' + T('rv.matchesEverything') : '') }),
        el('div', { class: 'mono trunc-multi', text: res.samples.join(', ') || T('rv.noMatch') })
      );
    };
    input.addEventListener('input', run);
    target.addEventListener('change', run);
    wrap.append(el('div', { class: 'row' }, [input, target]), out);
    run();
    return wrap;
  }

  /* ================================================================ DRAWERS */
  function openDrawer(title, body) {
    const d = document.getElementById('drawer');
    document.getElementById('drawer-title').innerHTML = '';
    document.getElementById('drawer-title').append(title);
    const b = document.getElementById('drawer-body');
    b.innerHTML = ''; b.appendChild(body); b.scrollTop = 0;
    collapseNotes(b);
    d.hidden = false; document.getElementById('drawer-scrim').hidden = false;
  }
  function closeDrawer() {
    document.getElementById('drawer').hidden = true;
    document.getElementById('drawer-scrim').hidden = true;
  }

  /* Release history straight from js/changelog.js — the same data the
     generated CHANGELOG.md is written from. */
  function drawerChangelog() {
    const head = el('div', {}, [
      el('h2', { text: T('app.changelog') }),
      el('div', { class: 'row' }, el('span', { class: 'pill', text: 'v' + HR.changelog.VERSION }))
    ]);
    const body = el('div', { class: 'stack' });
    HR.changelog.ENTRIES.forEach(entry => {
      body.appendChild(card(entry.version, entry.date,
        el('ul', { class: 'clean' }, entry.changes.map(c => el('li', { text: c })))));
    });
    openDrawer(head, body);
  }

  /* The classification detection is a guess; this select is the human's
     answer. An override is stored per account; "detected" clears it back to
     the layered engine's verdict. */
  function ecatControl(a) {
    const cats = HR.config.get().employeeCategories || [];
    const hasOverride = a.ecatSource === 'manual';
    const sel = el('select', {
      onchange: e => {
        HR.config.setEcatOverride(a.key, e.target.value || null);
        HR.app.rebuildBusy().then(() => {
          const na = HR.app.state.model.accounts.get(a.key);
          if (na) drawerAccount(na);
        });
      }
    }, [el('option', { value: '', text: T('dr.ecatAuto'), selected: !hasOverride })]
      .concat(cats.map(c => el('option', {
        value: c.id, text: HR.config.labelOf(c), selected: hasOverride && a.ecat === c.id }))));
    return el('span', { class: 'row' }, [
      sel,
      el('span', { class: 'note', text: T('dr.ecatSource.' + (a.ecatSource || 'default')) }),
      el('a', { href: '#', text: T('dr.ecatSettings'),
        onclick: e => { e.preventDefault(); closeDrawer(); HR.app.go('settings', { tab: 'classification' }); } })
    ]);
  }

  function drawerAccount(a, change) {
    const m = HR.app.state.model;
    const head = el('div', {}, [
      el('h2', { text: a.userName }),
      el('div', { class: 'row' }, [
        el('span', { class: 'sev ' + a.riskBand, text: T('app.riskShort') + ' ' + a.riskScore }),
        el('span', { class: 'pill', title: T('dr.ecatSource.' + (a.clsSource || 'default')), text: a.clsLabel }),
        a.ecatLabel ? el('span', { class: 'pill', title: T('dr.ecatSource.' + (a.ecatSource || 'default')),
          text: a.ecatLabel + (a.ecatMult !== 1 ? ' ×' + a.ecatMult : '') }) : null,
        el('span', { class: 'pill', text: T(a.enabled === false ? 'c.disabled' : 'c.enabled') }),
        a.orphan ? el('span', { class: 'pill removed', text: T('c.unowned') }) : el('span', { class: 'pill', text: a.personName })
      ])
    ]);

    const body = el('div', { class: 'stack' });
    const peerAcc = a.peerKey ? m.accounts.get(a.peerKey) : null;
    body.appendChild(dl([
      [T('c.system'), el('a', { href: '#', text: a.system, onclick: e => { e.preventDefault(); const sys = m.systemList.find(x => x.name === a.system); if (sys) drawerSystem(sys, m); } })],
      [T('c.displayName'), a.displayName],
      [T('c.person'), a.personRaw || T('dr.notLinked')],
      [T('c.empCategory'), ecatControl(a)],
      [T('dr.permsHeld'), String(a.permCount)],
      [T('dr.unmanagedAssign'), String(a.unmanagedPermCount)],
      [T('dr.missingEnt'), String(a.missingCount)],
      [T('dr.monthlyCost'), U.fmtMoney(a.monthlyCost)],
      [T('dr.closestPeer'), peerAcc
        ? el('a', { href: '#', text: peerAcc.userName + ' · ' + T('dr.overlap', { p: U.fmtPct(a.peerBest || 0, 0) }),
            onclick: e => { e.preventDefault(); drawerAccount(peerAcc); } })
        : (a.peerKey ? a.peerKey + ' · ' + T('dr.overlap', { p: U.fmtPct(a.peerBest || 0, 0) }) : T('dr.noPeer'))]
    ]));

    /* The person link, decidable in place: the matching workbench's card. */
    if (HR.matching && m.vault) body.appendChild(HR.matching.personLinkCard(m, a));

    body.appendChild(card(T('dr.whyScore'), T('dr.componentsSum', { n: a.riskScore }) + (a.riskRaw > a.riskScore ? ' · ' + T('dr.cappedFrom', { n: Math.round(a.riskRaw) }) : '')
      + (a.ecatMult && a.ecatMult !== 1 ? ' · ' + T('dr.ecatApplied', { m: a.ecatMult, cat: a.ecatLabel }) : ''),
      a.riskParts.length ? C.barList(a.riskParts.map(p => ({
        label: p.label, value: Math.round(p.value), color: C.STATUS[a.riskBand], note: p.detail,
        tip: '<div class="t-title">' + U.esc(p.label) + '</div><div class="t-row"><span>points</span><b>' +
          U.fmtNum(p.value, 1) + '</b></div>' + (p.detail ? '<div class="t-row"><span>' + U.esc(p.detail) + '</span></div>' : '')
      })), { valueLabel: T('c.points') }) : el('p', { class: 'note', text: T('dr.clean') })));

    if (change) {
      body.appendChild(card(T('dr.changedSince'), null, el('ul', { class: 'clean' },
        change.changes.map(c => el('li', { text: c.field + ': ' + (c.from === '' ? '' : c.from + ' → ') + c.to })))));
    }

    if (a.perms.length) {
      /* "Unique" = not held by the closest peer; the flag lives in the table
         instead of a second, redundant list of the same names above it. */
      const uniqueKeys = new Set((a.uniquePerms || []).map(p => p.key));
      body.appendChild(card(T('dr.entitlements'), T('dr.groupsN', { n: a.perms.length }), HR.table.make({
        columns: [
          { key: 'name', label: T('ct.group') },
          { key: 'categoryLabel', label: T('c.category') },
          { key: 'sensitivity', label: T('c.sensitivity'), num: true, render: r => U.fmtNum(r.sensitivity, 1) },
          { key: 'holderCount', label: T('c.holders'), num: true },
          { key: 'monthlyPrice', label: T('c.unitMo'), num: true, render: r => r.monthlyPrice ? U.fmtMoney(r.monthlyPrice) : '—' },
          { key: 'riskScore', label: T('c.risk'), num: true },
          uniqueKeys.size ? { key: 'unique', label: T('dr.uniqueCol'),
            value: r => uniqueKeys.has(r.key) ? 1 : 0,
            render: r => uniqueKeys.has(r.key)
              ? el('span', { class: 'pill', text: '✓' }) : document.createTextNode('') } : null
        ].filter(Boolean), rows: a.perms, pageSize: 15, exportName: 'account-' + a.userName + '-permissions',
        initialSort: { key: 'riskScore', dir: -1 },
        search: (r, q) => r.name.toLowerCase().includes(q),
        onRowClick: p => drawerPermission(p, m)
      })));
    }
    if (a.missingPerms.length) {
      body.appendChild(card(T('dr.missingEnt'), T('dr.missingList'),
        el('ul', { class: 'clean' }, a.missingPerms.map(p => el('li', { text: p.name })))));
    }

    body.appendChild(card(T('dr.sourceRows'), T('dr.csvLines', { n: a.records.length }), HR.table.make({
      columns: [
        { key: 'issue', label: T('dr.issue') },
        { key: 'permission', label: T('c.permission') },
        { key: 'resolution', label: T('dr.resolution') },
        { key: 'permissionPath', label: T('dr.path'), render: r => el('span', { class: 'trunc mono', title: r.permissionPath, text: r.permissionPath }) }
      ], rows: a.records, pageSize: 10, exportName: 'account-' + a.userName + '-rows'
    })));

    openDrawer(head, body);
  }

  /* One target system, judged: what it holds, what it costs, how risky it is
     and how much of it the rule model covers. */
  function drawerSystem(s, m) {
    m = m || HR.app.state.model;
    const head = el('div', {}, [
      el('h2', { text: s.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: T('sy.accountsN', { n: s.accountCount }) }),
        el('span', { class: 'pill', text: T('sy.permsN', { n: s.permissionCount }) }),
        s.monthlySpend ? el('span', { class: 'pill', text: U.fmtMoney(s.monthlySpend) + '/mo' }) : null,
        el('span', { class: 'sev ' + HR.config.severityOf(s.meanRisk), text: T('app.riskShort') + ' ' + Math.round(s.meanRisk) })
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(dl([
      [T('c.rowsCol'), U.fmtInt(s.rows)],
      [T('ov.accounts'), T('sy.accountsDetail', { n: s.accountCount, e: s.enabledAccounts, o: s.orphanAccounts, oe: s.orphanEnabled })],
      [T('pm.title'), T('sy.permsDetail', { n: s.permissionCount, rare: s.rare, priv: s.privileged })],
      [T('sy.unmanagedShare'), U.fmtInt(s.unmanagedRows) + ' (' + U.fmtPct(s.unmanagedShare, 0) + ')'],
      [T('dr.monthlyTotal'), U.fmtMoney(s.monthlySpend)],
      [T('dr.annualTotal'), U.fmtMoney(s.monthlySpend * 12)],
      [T('sy.meanRisk'), U.fmtNum(s.meanRisk, 0) + ' · ' + T('sy.maxRisk') + ' ' + U.fmtNum(s.maxRisk, 0)]
    ]));

    if (s.coverage && s.coverage.total) {
      const c = s.coverage;
      body.appendChild(card(T('sy.coverage'), T('sy.coverageNote'), [
        el('div', { class: 'row' }, [
          el('span', { class: 'pill ok', text: T('sy.covModelled', { n: c.modelled }) }),
          c.draftOnly ? el('span', { class: 'pill muted', text: T('sy.covDraft', { n: c.draftOnly }) }) : null,
          el('span', { class: 'pill ' + (c.unmodelled ? 'removed' : 'muted'), text: T('sy.covUnmodelled', { n: c.unmodelled }) })
        ]),
        scoreBar(Math.round(100 * c.modelled / c.total)),
        c.modelled === 0
          ? el('p', { class: 'note', text: T('sy.covNone') }) : null
      ]));
    }

    const top = m.permissionList.filter(p => p.system === s.name)
      .sort((a, b) => b.riskScore - a.riskScore || b.monthlyTotal - a.monthlyTotal);
    body.appendChild(card(T('sy.topPerms'), null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.permission') },
        { key: 'categoryLabel', label: T('c.category') },
        { key: 'holderCount', label: T('c.holders'), num: true },
        { key: 'monthlyTotal', label: T('c.costMo'), num: true, render: p => U.fmtMoney(p.monthlyTotal) },
        { key: 'riskScore', label: T('c.risk'), num: true, render: p => scoreBar(p.riskScore) }
      ], rows: top, pageSize: 10, exportName: 'system-' + s.name + '-permissions',
      search: (p, q) => p.name.toLowerCase().includes(q),
      onRowClick: p => drawerPermission(p, m)
    })));

    const issueRows = Object.keys(s.issues).sort((a, b) => s.issues[b] - s.issues[a])
      .map(k => [k, U.fmtInt(s.issues[k])]);
    if (issueRows.length) body.appendChild(card(T('sy.issues'), null, dl(issueRows)));

    openDrawer(head, body);
  }

  /* The classic role model's inverse view, in the permission drawer: which
     attribute roles this permission's holders sit in — the round-trip the old
     report solved with cross-tab navigation. */
  function classicRolesCard(p, m) {
    if (!m.vault || !HR.classic) return null;
    let C = null;
    try { C = HR.classic.build(m); } catch (e) { return null; }
    if (!C || C.unavailable) return null;
    const hits = HR.classic.rolesHolding(C, m, p.key).slice(0, 15);
    if (!hits.length) return null;
    const t = el('table', { class: 'tbl' });
    t.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { class: 'no-sort', text: T('cl.role') }),
      el('th', { class: 'no-sort num', text: T('cl.holdersOfRole') }),
      el('th', { class: 'no-sort', text: T('c.person') })])));
    const tb = el('tbody');
    hits.forEach(h => {
      const d = el('details', {});
      d.appendChild(el('summary', { class: 'note', text: String(h.count) }));
      d.appendChild(el('p', { class: 'note', text: h.names.slice(0, 100).join(', ') +
        (h.names.length > 100 ? ' …' : '') }));
      tb.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { text: h.role + ' ' }),
          el('span', { class: 'pill muted', text: T('cl.type.' + h.type) })]),
        el('td', { class: 'num', text: h.count + '/' + h.size }),
        el('td', {}, d)
      ]));
    });
    t.appendChild(tb);
    return card(T('cl.drawerTitle'), T('cl.drawerNote'), el('div', { class: 'tbl-wrap' }, t));
  }

  function drawerPermission(p, m) {
    m = m || HR.app.state.model;
    const holders = Array.from(p.holders).map(k => m.accounts.get(k)).filter(Boolean);
    const dirMeta = (() => {
      const d = HR.app.state.directory;
      return d && d.groupMeta ? d.groupMeta.get(p.name.toLowerCase()) : null;
    })();
    const head = el('div', {}, [
      el('h2', { text: p.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'sev ' + p.riskBand, text: T('app.riskShort') + ' ' + p.riskScore }),
        el('span', { class: 'pill', text: p.categoryLabel }),
        p.rare ? el('span', { class: 'pill removed', text: T('c.rare') }) : null,
        p.monthlyPrice ? el('span', { class: 'pill', text: U.fmtMoney(p.monthlyPrice) + '/holder/mo' }) : null,
        dirMeta && dirMeta.dynamic ? el('span', { class: 'pill warn', title: dirMeta.membershipRule,
          text: T('pm.badgeDynamic') }) : null,
        dirMeta && dirMeta.kind === 'resource' ? el('span', { class: 'pill ok',
          text: T('pm.badgeResource', { n: dirMeta.depth }) }) : null,
        dirMeta && dirMeta.kind === 'role' ? el('span', { class: 'pill muted',
          title: dirMeta.parentNames.join(', '),
          text: T('pm.badgeRole') }) : null
      ])
    ]);
    const body = el('div', { class: 'stack' });
    const note = HR.config.getPermNote(p.name);
    if (note) body.appendChild(el('p', { class: 'note', text: note }));
    body.appendChild(dl([
      [T('c.system'), el('a', { href: '#', text: p.system, onclick: e => { e.preventDefault(); const sys = m.systemList.find(x => x.name === p.system); if (sys) drawerSystem(sys, m); } })],
      [T('dr.dn'), el('span', { class: 'mono', text: p.path || '—' })],
      [T('dr.holders'), T('dr.holdersDetail', { n: p.holderCount, e: p.holdersEnabled, d: p.holdersDisabled })],
      [T('dr.heldByUnowned'), p.holdersOrphan + ' (' + U.fmtPct(p.orphanShare, 0) + ')'],
      [T('dr.monthlyTotal'), U.fmtMoney(p.monthlyTotal)],
      [T('dr.annualTotal'), U.fmtMoney(p.monthlyTotal * 12)],
      [T('dr.pSensitivity'), U.fmtNum(p.sensitivity, 1)],
      [T('dr.missingFor'), p.missingFor.size ? Array.from(p.missingFor).map(k => (m.accounts.get(k) || {}).userName).join(', ') : '—']
    ]));
    body.appendChild(card(T('dr.whyScore'), null, C.barList(p.riskParts.map(x => ({
      label: x.label, value: Math.round(x.value), color: C.STATUS[p.riskBand]
    })), { valueLabel: T('c.points') })));
    body.appendChild(card(T('dr.holders'), T('dr.holdersN', { n: holders.length }), HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account') },
        { key: 'personName', label: T('c.person'), render: r => r.personRaw ? el('span', { text: r.personName }) : el('span', { class: 'sev critical', text: T('c.unowned') }) },
        { key: 'enabled', label: T('c.state'), value: r => T(r.enabled === false ? 'c.disabled' : 'c.enabled') },
        /* Direct member or inherited via nesting — answerable only from the
           collector envelope, so the column appears only when one is loaded. */
        HR.app.state.directory ? { key: 'how', label: T('pm.howHeld'), sortable: false,
          render: r => {
            const hm = HR.app.state.directory.membership(r.userName, p.name);
            if (!hm) return el('span', { class: 'note', text: '—' });
            return hm.direct
              ? el('span', { class: 'pill ok', text: T('pm.howDirect') })
              : el('span', { class: 'note trunc', title: T('pm.howVia') + ' ' + hm.via.join(' > '),
                  text: T('pm.howVia') + ' ' + hm.via.join(' > ') });
          } } : null,
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ].filter(Boolean), rows: holders, pageSize: 20, exportName: 'permission-' + p.name + '-holders',
      initialSort: { key: 'riskScore', dir: -1 },
      search: (r, q) => (r.userName + ' ' + r.personRaw).toLowerCase().includes(q),
      onRowClick: a => drawerAccount(a)
    })));
    const clCard = classicRolesCard(p, m);
    if (clCard) body.appendChild(clCard);

    /* The description the import never carried: free text per entitlement,
       kept in the settings, shown here and as the name's tooltip in tables. */
    const ta = el('textarea', { rows: 2, placeholder: T('pm.notePh') });
    ta.style.width = '100%';
    ta.value = note;
    ta.onchange = () => {
      HR.config.setPermNote(p.name, ta.value);
      U.toast(T('pm.noteSaved'), 2500);
    };
    body.appendChild(card(T('pm.noteTitle'), T('pm.noteNote'), ta));
    openDrawer(head, body);
  }

  function drawerPerson(per, m) {
    const head = el('div', {}, [
      el('h2', { text: per.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: T('dr.accountsN', { n: per.accountCount }) }),
        el('span', { class: 'pill', text: U.fmtMoney(per.monthlyCost) + '/mo' })
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(card(T('pp.accounts'), null, HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account') },
        { key: 'clsLabel', label: T('c.class') },
        { key: 'enabled', label: T('c.state'), value: r => T(r.enabled === false ? 'c.disabled' : 'c.enabled') },
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ], rows: per.accounts, pageSize: 10, exportName: 'person-accounts',
      onRowClick: a => drawerAccount(a)
    })));
    const allPerms = U.uniq(per.accounts.flatMap(a => a.perms));
    body.appendChild(card(T('pp.combined'), T('pp.combinedNote', { n: allPerms.length }),
      entitlementTable(allPerms, per.accounts, m, 'entitlements-' + per.name)));
    openDrawer(head, body);
  }

  HR.views = {
    board: (m, params) => HR.board.view(m, params),
    rules: rulesView,
    explain: explainView,
    activity: activityView,
    overview, risk: riskView, cost: costView, accounts: accountsView,
    permissions: permissionsView, people: peopleView, diff: diffView,
    snapshots: snapshotsView, settings: settingsView, sources: sourcesView,
    openDrawer, closeDrawer, drawerAccount, drawerPermission, drawerPerson, drawerSystem, card, tile,
    missingFor, gatePage
  };

  /* What the split-out view files build with. Everything here was already shared inside
     this file; naming it makes the seam explicit rather than accidental. */
  HR.viewkit = {
    card, tile, scoreBar, dl, partialNotice, syntheticVaultNotice, personRow, peopleIndex, entitlementTable,
    openDrawer, closeDrawer, drawerAccount, drawerPermission, drawerVaultPerson, drawerSystem,
    drawerChangelog, STATE_SEV, stateLabel, offsetText, sourcesCard, tabbed,
    lead, info, explain, collapseNotes, fitNotice
  };
})(window.HR);
