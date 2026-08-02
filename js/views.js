/* All views. Each render function returns a DocumentFragment / element that app.js
   mounts into #view-root. State lives in HR.app.state. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, C = HR.charts;
  const T = (k, p) => HR.i18n.t(k, p);

  /* ------------------------------------------------------------- primitives */
  function card(title, note, children, cls) {
    const c = el('div', { class: 'card ' + (cls || '') });
    if (title) c.appendChild(el('h2', {}, [document.createTextNode(title), note ? el('span', { class: 'card-note', text: note }) : null]));
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
    if (foot) footRow.append(document.createTextNode(foot));
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
  function sourcesCard(m) {
    const st = HR.app.state;
    const now = Date.now();
    const days = ts => ts ? Math.round((now - ts) / 86400000) : null;
    const rows = [];

    const snapshot = st.snapshots.find(x => x.id === st.currentSnapshotId);
    rows.push({
      kind: T('src.recon'), loaded: snapshot ? snapshot.importedAt : null,
      dataDate: null,
      detail: T('src.reconDetail', { rows: U.fmtInt(m.summary.rows), accounts: m.summary.accounts }),
      file: snapshot ? snapshot.fileName : (st.parsed ? st.parsed.meta.fileName : '—'),
      loadedOnly: true
    });
    if (st.ruleSet) rows.push({
      kind: T('src.rules'), loaded: st.importedAt.rules, dataDate: null,
      detail: T('src.rulesDetail', { n: st.ruleSet.rules.length,
        live: st.ruleSet.rules.filter(r => r.status === 'published' || r.status === 'enabled').length }),
      file: st.ruleSet.meta.fileName, loadedOnly: true
    });
    if (st.vault) rows.push({
      kind: T('src.vault'), loaded: st.importedAt.vault, dataDate: null,
      detail: T('src.vaultDetail', { n: st.vault.persons.length, c: st.vault.meta.contractCount }),
      file: st.vault.meta.fileName, loadedOnly: true
    });
    if (st.granted) rows.push({
      kind: T('src.granted'), loaded: st.importedAt.granted,
      dataDate: st.granted.meta.lastChange ? +st.granted.meta.lastChange : null,
      detail: st.granted.empty ? T('act.grantedEmpty') : T('src.grantedDetail', { n: U.fmtInt(st.granted.meta.rowCount) }),
      file: st.granted.meta.fileName
    });
    if (st.catalogue) rows.push({
      kind: T('src.catalogue'), loaded: st.importedAt.catalogue, dataDate: null,
      detail: T('src.catalogueDetail', { n: U.fmtInt(st.catalogue.meta.rowCount), gone: st.catalogue.meta.orphanedCount }),
      file: st.catalogue.meta.fileName, loadedOnly: true
    });
    if (st.products) rows.push({
      kind: T('src.products'), loaded: st.importedAt.products, dataDate: null,
      detail: T('src.productsDetail', { n: st.products.meta.rowCount, tasks: st.products.meta.withActions }),
      file: st.products.meta.fileName, loadedOnly: true
    });
    if (st.assignments) rows.push({
      kind: T('src.assignments'), loaded: st.importedAt.assignments,
      dataDate: st.assignments.meta.to ? +st.assignments.meta.to : null,
      detail: T('src.assignmentsDetail', { n: U.fmtInt(st.assignments.meta.rowCount),
        open: U.fmtInt(st.assignments.meta.openCount) }),
      file: st.assignments.meta.fileName
    });
    if (st.history) rows.push({
      kind: T('src.history'), loaded: st.importedAt.history,
      dataDate: st.history.meta.to ? +st.history.meta.to : null,
      detail: T('src.historyDetail', { n: U.fmtInt(st.history.meta.rowCount),
        days: st.history.meta.activeDays, span: st.history.meta.spanDays == null ? '—' : st.history.meta.spanDays }),
      file: st.history.meta.fileName
    });

    /* The spread between the newest and oldest evidence is what makes a comparison lie. */
    const dataDates = rows.map(r => r.dataDate).filter(Boolean);
    const loadDates = rows.map(r => r.loaded).filter(Boolean);
    const spreadDays = loadDates.length > 1
      ? Math.round((Math.max.apply(null, loadDates) - Math.min.apply(null, loadDates)) / 86400000) : 0;
    const oldest = dataDates.length ? Math.min.apply(null, dataDates) : null;

    const missing = [];
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
            : el('span', { class: 'note', text: '—' }) }
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
    { kind: 'recon',     accept: '.csv', required: true },
    { kind: 'vault',     accept: '.json' },
    { kind: 'rules',     accept: '.csv' },
    { kind: 'granted',   accept: '.csv' },
    { kind: 'history',   accept: '.csv' },
    { kind: 'catalogue', accept: '.csv' },
    { kind: 'products', accept: '.json' },
    { kind: 'assignments', accept: '.csv' }
  ];

  function slotState(kind) {
    const st = HR.app.state;
    switch (kind) {
      case 'recon': {
        if (!st.model) return null;
        const snap = st.snapshots.find(x => x.id === st.currentSnapshotId);
        return {
          file: snap ? snap.fileName : (st.parsed ? st.parsed.meta.fileName : '—'),
          loaded: snap ? snap.importedAt : null,
          detail: T('src.reconDetail', { rows: U.fmtInt(st.model.summary.rows), accounts: st.model.summary.accounts })
        };
      }
      case 'rules':
        return st.ruleSet && { file: st.ruleSet.meta.fileName, loaded: st.importedAt.rules,
          detail: T('src.rulesDetail', { n: st.ruleSet.rules.length,
            live: st.ruleSet.rules.filter(r => r.status === 'published' || r.status === 'enabled').length }) };
      case 'vault':
        return st.vault && { file: st.vault.meta.fileName, loaded: st.importedAt.vault,
          detail: T('src.vaultDetail', { n: st.vault.persons.length, c: st.vault.meta.contractCount }) };
      case 'granted':
        return st.granted && { file: st.granted.meta.fileName, loaded: st.importedAt.granted,
          detail: st.granted.empty ? T('act.grantedEmpty')
            : T('src.grantedDetail', { n: U.fmtInt(st.granted.meta.rowCount) }) };
      case 'history':
        return st.history && { file: st.history.meta.fileName, loaded: st.importedAt.history,
          detail: T('src.historyDetail', { n: U.fmtInt(st.history.meta.rowCount),
            days: st.history.meta.activeDays,
            span: st.history.meta.spanDays == null ? '—' : st.history.meta.spanDays }) };
      case 'products':
        return st.products && { file: st.products.meta.fileName, loaded: st.importedAt.products,
          detail: T('src.productsDetail', { n: st.products.meta.rowCount,
            tasks: st.products.meta.withActions }) };
      case 'assignments':
        return st.assignments && { file: st.assignments.meta.fileName, loaded: st.importedAt.assignments,
          detail: T('src.assignmentsDetail', { n: U.fmtInt(st.assignments.meta.rowCount),
            open: U.fmtInt(st.assignments.meta.openCount) }) };
      case 'catalogue':
        return st.catalogue && { file: st.catalogue.meta.fileName, loaded: st.importedAt.catalogue,
          detail: T('src.catalogueDetail', { n: U.fmtInt(st.catalogue.meta.rowCount),
            gone: st.catalogue.meta.orphanedCount }) };
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

  function sourceSlot(slot) {
    const st = slotState(slot.kind);
    const days = st && st.loaded ? Math.round((Date.now() - st.loaded) / 86400000) : null;

    const head = el('div', { class: 'slot-head' }, [
      el('span', { class: 'sev ' + (st ? 'good' : (slot.required ? 'high' : 'none')) }),
      el('strong', { text: T('src.' + slot.kind) }),
      el('span', { class: 'pill ' + (st ? 'ok' : 'muted'),
        text: st ? T('src.slotLoaded') : (slot.required ? T('src.slotRequired') : T('src.slotOptional')) })
    ]);

    const body = st
      ? el('div', {}, [
          el('div', { class: 'mono ellipsis', text: st.file }),
          el('div', { class: 'note', text: st.detail }),
          el('div', { class: 'note', text: st.loaded
            ? (days === 0 ? T('src.today') : T('src.daysAgo', { n: U.fmtInt(days) })) + ' · ' + U.fmtDate(st.loaded)
            : T('src.noDate') })
        ])
      : el('div', {}, [
          el('div', { class: 'note', text: T('src.slot.' + slot.kind + '.unlocks') }),
          el('div', { class: 'note', text: T('src.slot.' + slot.kind + '.where') })
        ]);

    const actions = el('div', { class: 'slot-actions' }, [
      pickButton(st ? T('src.replace') : T('src.choose'), slot.accept, st ? '' : 'primary',
        f => HR.app.importFileAs(f, slot.kind)),
      st && slot.kind !== 'recon'
        ? el('button', { class: 'btn ghost', text: T('src.remove'),
            onclick: () => HR.app.clearSource(slot.kind) })
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


  /* ================================================================ PRODUCTS

     HelloID does not record which entitlement a Service Automation product hands out.
     The tool proposes matches by name and by who holds what; a person confirms them.
     Only confirmed mappings explain anything, and the map exports so the next analyst
     — or the next tenant review — does not start from nothing.                       */

  function productsView(m) {
    const f = document.createDocumentFragment();
    const A = m.assignments, P = m.products, match = m.productMatch;
    const map = HR.config.getMap();

    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('pr.title') }),
        el('p', { text: A
          ? T('pr.lead', { n: U.fmtInt(A.meta.openCount), products: A.meta.products, users: A.meta.users })
          : T('pr.leadNoAssignments') })
      ])
    ]));

    if (!P && !A) {
      f.appendChild(card(T('pr.none'), null, el('p', { class: 'note', text: T('pr.noneNote') })));
      return f;
    }

    /* Why the proposals look the way they do, before anybody reads them as fact. */
    if (match && match.reasons.length) {
      f.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: T('pr.whyTitle') }),
        el('ul', { class: 'note' }, match.reasons.map(r => el('li', { text: T('pr.why.' + r) })))
      ]));
    }

    if (A) {
      const tiles = el('div', { class: 'grid g4', style: 'margin-bottom:14px' });
      tiles.append(
        tile(T('pr.kOpen'), U.fmtInt(A.meta.openCount), T('pr.kOpenFoot', { returned: A.meta.returned })),
        tile(T('pr.kMapped'), U.fmtInt(Object.keys(map).length) + '/' + U.fmtInt(P ? P.meta.rowCount : 0),
          T('pr.kMappedFoot'), { severity: Object.keys(map).length ? 'good' : 'medium' }),
        tile(T('pr.kSelfApproved'), U.fmtInt(A.meta.selfApproved), T('pr.kSelfApprovedFoot'),
          { severity: A.meta.selfApproved ? 'high' : 'good' }),
        tile(T('pr.kLinked'), m.productHolders
          ? U.fmtInt(m.productHolders.stats.linked) + '/' + U.fmtInt(m.productHolders.stats.users) : '—',
          T('pr.kLinkedFoot'), { severity: m.productHolders && m.productHolders.stats.unlinked ? 'medium' : 'good' })
      );
      f.appendChild(tiles);
    }

    /* ---- the map itself ---- */
    const toolbar = el('div', { class: 'slot-actions', style: 'margin-bottom:10px' }, [
      el('button', { class: 'btn', text: T('pr.exportMap'), onclick: () => {
        U.download('product-map.json', HR.config.exportMap(), 'application/json');
        HR.usage.exported('product-map');
      } }),
      el('button', { class: 'btn', text: T('pr.exportMapCsv'), onclick: () =>
        U.download('product-map.csv', HR.config.exportMapCsv(), 'text/csv') }),
      el('button', { class: 'btn ghost danger', text: T('pr.clearMap'), onclick: () => {
        Object.keys(HR.config.getMap()).forEach(k => HR.config.setMapping(k, null));
        HR.app.rebuild();
      } })
    ]);

    const rows = (P ? P.rows : []).map(product => {
      const assignments = A ? (A.byProduct.get(product.name.toLowerCase()) || []) : [];
      const open = assignments.filter(a => !a.returnDate);
      const mapped = map[product.name] || [];
      const proposals = match ? (match.byProduct.get(product.name.toLowerCase()) || []) : [];
      return { product, open: open.length, mapped, proposals };
    });

    const table = HR.table.make({
      columns: [
        { key: 'name', label: T('pr.cProduct'), value: r => r.product.name,
          render: r => el('a', { href: '#', text: r.product.name,
            onclick: e => { e.preventDefault(); drawerProduct(m, r); } }) },
        { key: 'holders', label: T('pr.cHolders'), value: r => r.open, align: 'right' },
        { key: 'risk', label: T('pr.cRisk'), value: r => r.product.riskFactor || 0, align: 'right',
          render: r => r.product.riskFactor
            ? el('span', { class: 'sev ' + (r.product.riskFactor >= 7 ? 'high' : 'low'),
                text: String(r.product.riskFactor) })
            : el('span', { class: 'note', text: '—' }) },
        { key: 'price', label: T('pr.cPrice'), value: r => r.product.price || 0, align: 'right',
          render: r => r.product.price == null
            ? el('span', { class: 'note', text: '—' })
            : el('span', { text: U.fmtMoney(r.product.price) }) },
        { key: 'return', label: T('pr.cReturn'), value: r => r.product.returnOnUserDisable ? 1 : 0,
          render: r => el('span', { class: 'sev ' + (r.product.returnOnUserDisable ? 'good' : 'medium'),
            text: r.product.returnOnUserDisable ? T('pr.yes') : T('pr.no') }) },
        { key: 'mapped', label: T('pr.cMapped'), value: r => r.mapped.length,
          render: r => r.mapped.length
            ? el('span', { class: 'pill ok', text: r.mapped.map(x => x.permission).join(', ').slice(0, 60) })
            : (r.proposals.length
                ? el('span', { class: 'pill muted', text: T('pr.nProposals', { n: r.proposals.length }) })
                : el('span', { class: 'note', text: '—' })) }
      ],
      rows, pageSize: 25, exportName: 'products'
    });

    f.appendChild(card(T('pr.mapTitle'), T('pr.mapNote'), [toolbar, table]));
    return f;
  }

  /** One product: what it costs, who holds it, and what it maps to. */
  function drawerProduct(m, row) {
    const product = row.product;
    const map = HR.config.getMap();
    const body = document.createDocumentFragment();

    body.appendChild(dl([
      [T('pr.dSku'), product.sku || '—'],
      [T('pr.dCategories'), product.categories.join(', ') || '—'],
      [T('pr.dOwner'), product.resourceOwner || '—'],
      [T('pr.dWorkflow'), product.approvalWorkflow || '—'],
      [T('pr.dRisk'), product.riskFactor ? String(product.riskFactor) : '—'],
      [T('pr.dPrice'), product.price == null ? '—' : U.fmtMoney(product.price)],
      [T('pr.dTimeLimit'), !product.hasTimeLimit ? T('pr.no')
        : (product.ownershipDays
            ? T('pr.dDays', { n: U.fmtInt(product.ownershipDays), raw: U.fmtInt(product.ownershipMinutes) })
            : T('pr.dRaw', { n: U.fmtInt(product.ownershipMinutes) }))],
      [T('pr.dReturn'), product.returnOnUserDisable ? T('pr.yes') : T('pr.no')],
      [T('pr.dHolders'), U.fmtInt(row.open)]
    ]));

    const repaint = () => { HR.views.closeDrawer(); HR.app.rebuild(); };

    /* ---- confirmed ---- */
    const confirmed = map[product.name] || [];
    const confirmedList = el('div', {}, confirmed.length
      ? confirmed.map(e => el('div', { class: 'slot-actions' }, [
          el('span', { class: 'mono', text: (e.system ? e.system + ' · ' : '') + e.permission }),
          el('button', { class: 'btn sm ghost', text: T('pr.remove'), onclick: () => {
            HR.config.setMapping(product.name,
              confirmed.filter(x => !(x.system === e.system && x.permission === e.permission)));
            repaint();
          } })
        ]))
      : [el('p', { class: 'note', text: T('pr.noMapping') })]);
    body.appendChild(card(T('pr.confirmed'), null, confirmedList));

    /* ---- proposals ---- */
    const proposals = row.proposals.filter(p =>
      !confirmed.some(c => c.permission === p.perm.name && c.system === p.perm.system));
    body.appendChild(card(T('pr.proposals'), T('pr.proposalsNote'),
      proposals.length ? proposals.map(p => el('div', { class: 'slot-actions' }, [
        el('span', {}, [
          el('span', { class: 'mono', text: p.perm.name }),
          el('span', { class: 'note', text: ' ' + T('pr.score', {
            score: U.fmtNum(p.nameScore, 2), tokens: p.shared.join(', ') }) }),
          p.overlap == null
            ? el('span', { class: 'note', text: ' · ' + T('pr.noOverlapData') })
            : el('span', { class: 'sev ' + (p.verdict === 'corroborated' ? 'good' : 'medium'),
                text: ' ' + T('pr.overlap', { pct: U.fmtPct(p.overlap, 0) }) })
        ]),
        el('button', { class: 'btn sm primary', text: T('pr.confirm'), onclick: () => {
          HR.config.setMapping(product.name, confirmed.concat([{
            system: p.perm.system, permission: p.perm.name, source: 'proposal'
          }]));
          repaint();
        } })
      ])) : el('p', { class: 'note', text: T('pr.noProposals') })));

    /* ---- manual ---- */
    const input = el('input', { type: 'search', placeholder: T('pr.searchPh'), style: 'flex:1 1 auto' });
    const results = el('div', {});
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) return;
      m.permissionList.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8).forEach(p => {
        results.appendChild(el('div', { class: 'slot-actions' }, [
          el('span', { class: 'mono', text: p.name }),
          el('span', { class: 'note', text: T('pr.holders', { n: p.holders.size }) }),
          el('button', { class: 'btn sm', text: T('pr.add'), onclick: () => {
            HR.config.setMapping(product.name, (HR.config.getMap()[product.name] || []).concat([
              { system: p.system, permission: p.name, source: 'manual' }
            ]));
            repaint();
          } })
        ]));
      });
    });
    body.appendChild(card(T('pr.manual'), T('pr.manualNote'),
      [el('div', { class: 'slot-actions' }, [input]), results]));

    /* ---- holders ---- */
    const A = m.assignments;
    const list = A ? (A.byProduct.get(product.name.toLowerCase()) || []).filter(a => !a.returnDate) : [];
    if (list.length) {
      body.appendChild(card(T('pr.holdersTitle'), null, HR.table.make({
        columns: [
          { key: 'user', label: T('pr.cUser'), value: a => a.userName },
          { key: 'requested', label: T('pr.cRequested'), value: a => a.requestedAt ? +a.requestedAt : 0,
            render: a => el('span', { text: a.requestedAt ? U.fmtDate(a.requestedAt).split(',')[0] : '—' }) },
          { key: 'approver', label: T('pr.cApprover'), value: a => a.approvedBy || '',
            render: a => a.selfApproved
              ? el('span', { class: 'sev high', text: T('pr.selfApproved') })
              : el('span', { text: a.approvedBy || T('pr.unrecorded') }) }
        ],
        rows: list, pageSize: 10, exportName: 'holders-' + product.name
      })));
    }

    openDrawer(el('div', {}, [
      el('div', { text: product.name }),
      el('span', { class: 'note', text: product.description.slice(0, 140) })
    ]), body);
  }


  /* ============================================================ ORGANISATION

     The structure HR maintains, travelled one level at a time. Everything else in this
     tool starts from an account or an entitlement; a department head starts from their
     department, and a rule condition is written against this shape rather than against
     a group name.                                                                     */

  let orgCursor = null;

  function orgView(m) {
    const f = document.createDocumentFragment();
    if (!m.vault) {
      f.appendChild(partialNotice(['vault']));
      return f;
    }
    const q = m.orgQuality;
    const tree = q.structure;

    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('org.title') }),
        el('p', { text: T('org.lead', {
          departments: tree.meta.departments, people: U.fmtInt(tree.meta.people),
          titles: q.titles.length }) })
      ])
    ]));

    if (!tree.meta.hierarchical) {
      /* A flat list is what the export gave, not what the organisation is. */
      f.appendChild(el('p', { class: 'note', style: 'margin-bottom:12px', text: T('org.flat') }));
    }

    const node = orgCursor ? tree.byId(orgCursor) : null;
    const crumb = el('div', { class: 'crumbs' }, [
      el('button', { class: 'btn sm' + (node ? '' : ' primary'), text: T('org.whole'),
        onclick: () => { orgCursor = null; HR.app.render(); } })
    ]);
    if (node) {
      tree.pathOf(node).forEach((n, i, all) => {
        crumb.append(el('span', { class: 'note', text: '›' }),
          el('button', { class: 'btn sm' + (i === all.length - 1 ? ' primary' : ''), text: n.name,
            onclick: () => { orgCursor = n.id; HR.app.render(); } }));
      });
    }
    f.appendChild(crumb);

    /* ---- stat row for wherever we are ---- */
    const stats = el('div', { class: 'grid g4', style: 'margin:12px 0' });
    if (node) {
      const managers = Array.from(node.managers.keys());
      stats.append(
        tile(T('org.here'), U.fmtInt(node.people.length), T('org.hereFoot')),
        tile(T('org.below'), U.fmtInt(tree.subtreeCount(node)),
          T('org.belowFoot', { n: tree.subtreeDepartments(node) })),
        tile(T('org.titlesHere'), U.fmtInt(node.titles.size), T('org.titlesFoot')),
        tile(T('org.manager'), managers.length ? managers[0] : '—',
          managers.length > 1 ? T('org.managersFoot', { n: managers.length }) : T('org.managerFoot'),
          { severity: managers.length ? 'good' : 'medium' })
      );
    } else {
      stats.append(
        tile(T('org.people'), U.fmtInt(tree.meta.people), T('org.peopleFoot')),
        tile(T('org.departments'), U.fmtInt(tree.meta.departments),
          T('org.departmentsFoot', { n: tree.roots.length })),
        tile(T('org.titlesAll'), U.fmtInt(q.titles.length), T('org.titlesAllFoot')),
        tile(T('org.noManager'), U.fmtInt(q.departmentsWithoutManager.length), T('org.noManagerFoot'),
          { severity: q.departmentsWithoutManager.length ? 'medium' : 'good' })
      );
    }
    f.appendChild(stats);

    /* ---- go deeper ---- */
    const kids = node ? node.children : tree.roots;
    if (kids.length) {
      const maxCount = Math.max.apply(null, kids.map(k => tree.subtreeCount(k)).concat([1]));
      const cards = el('div', { class: 'grid g3' }, kids
        .slice()
        .sort((a, b) => tree.subtreeCount(b) - tree.subtreeCount(a))
        .map(k => {
          const count = tree.subtreeCount(k);
          const subs = tree.subtreeDepartments(k);
          const bar = el('span', { class: 'scorebar' });
          const fill = el('i');
          fill.style.width = (count / maxCount * 100) + '%';
          fill.style.background = C.slot(1);
          bar.appendChild(fill);
          return el('div', { class: 'card click org-card', onclick: () => { orgCursor = k.id; HR.app.render(); } }, [
            el('div', { class: 'slot-head' }, [
              el('strong', { text: k.name }),
              el('span', { class: 'note mono', text: k.externalId || '' })
            ]),
            el('div', { class: 'note' }, [
              document.createTextNode(T('org.cardPeople', { n: U.fmtInt(count) }) +
                (subs ? ' · ' + T('org.cardSubs', { n: subs }) : '')),
              k.managers.size ? document.createTextNode(' · ' + Array.from(k.managers.keys())[0])
                : el('span', { class: 'sev medium org-flag', text: T('org.cardNoManager') })
            ]),
            bar
          ]);
        }));
      f.appendChild(card(node ? T('org.deeper') : T('org.top'), null, cards));
    }

    /* ---- people right here ---- */
    if (node && node.people.length) {
      const index = peopleIndex(m);
      const rows = node.people.map(entry => ({
        person: entry.person, contract: entry.contract,
        life: HR.vault.lifecycle(entry.person)
      }));
      f.appendChild(card(T('org.peopleIn', { name: node.name, n: node.people.length }), null,
        HR.table.make({
          columns: [
            { key: 'name', label: T('org.cPerson'), value: r => r.person.displayName,
              render: r => el('a', { href: '#', text: r.person.displayName,
                onclick: e => { e.preventDefault(); drawerVaultPerson(personRow(m, r.person, index), m); } }) },
            { key: 'id', label: T('org.cId'), value: r => r.person.externalId },
            { key: 'title', label: T('org.cTitle'), value: r => r.contract.title.name || '' },
            { key: 'type', label: T('org.cType'), value: r => r.contract.type.name || '' },
            { key: 'state', label: T('org.cState'), value: r => r.life.state,
              render: r => el('span', { class: 'sev ' + STATE_SEV[r.life.state],
                text: stateLabel(r.life.state) }) }
          ],
          rows, pageSize: 15, exportName: 'org-' + node.name
        })));
    }

    /* ---- job titles across the whole organisation ---- */
    if (!node) {
      f.appendChild(card(T('org.titlesTitle'), T('org.titlesNote'), HR.table.make({
        columns: [
          { key: 'name', label: T('org.cTitleName'), value: t => t.name },
          { key: 'active', label: T('org.cActive'), value: t => t.active, align: 'right' },
          { key: 'ended', label: T('org.cEnded'), value: t => t.ended, align: 'right' },
          { key: 'persons', label: T('org.cPersons'), value: t => t.persons.size, align: 'right' },
          { key: 'departments', label: T('org.cDepartments'), value: t => t.departments.size, align: 'right' },
          { key: 'state', label: T('org.cTitleState'), value: t => (t.active ? 1 : 0),
            render: t => t.active
              ? el('span', { class: 'sev good', text: T('org.titleLive') })
              : el('span', { class: 'sev medium', text: T('org.titleDead', {
                  date: t.lastEnd ? U.fmtDate(t.lastEnd).split(',')[0] : '—' }) }) }
        ],
        rows: q.titles, pageSize: 15, exportName: 'job-titles'
      })));

      f.appendChild(vaultQualityCard(m));
    }
    return f;
  }

  /** What is missing from the vault, measured against what it usually contains. */
  function vaultQualityCard(m) {
    const q = m.orgQuality;
    const rows = q.facets.slice().sort((a, b) => b.fill - a.fill);
    return card(T('org.qualityTitle'), T('org.qualityNote'), [
      HR.table.make({
        columns: [
          { key: 'facet', label: T('org.cFacet'), value: r => r.label },
          { key: 'fill', label: T('org.cFill'), value: r => r.fill,
            render: r => scoreBar(Math.round(r.fill * 100)) },
          { key: 'missing', label: T('org.cMissing'), value: r => r.missing.length, align: 'right' },
          { key: 'verdict', label: T('org.cVerdict'), value: r => r.anomalous ? 1 : 0,
            render: r => r.anomalous
              ? el('span', { class: 'sev high', text: T('org.gap') })
              : (r.fill === 0
                  ? el('span', { class: 'note', text: T('org.unused') })
                  : (r.fill === 1 ? el('span', { class: 'sev good', text: T('org.complete') })
                    : el('span', { class: 'note', text: T('org.partial') }))) }
        ],
        rows, pageSize: 10, exportName: 'vault-attributes'
      }),
      el('p', { class: 'note', style: 'margin-top:8px', text: T('org.qualityFoot', {
        persons: U.fmtInt(q.summary.persons), contracts: U.fmtInt(q.summary.contracts),
        ended: U.fmtInt(q.summary.ended) }) })
    ]);
  }

  /* ================================================================= PYRAMID */


  /**
   * The pyramid, drawn.
   *
   * The table below it lists rules; this says what the shape of the model is — how many
   * groups each level splits the organisation into, how many rules sit at that level,
   * and how much access it accounts for. Narrow at the top because everyone is one
   * group; wider below because each level divides it further.
   */
  /* Below half the organisation it is not a floor, so the slider does not go there. */
  const BASELINE_SLIDER_MIN = 0.5;

  /** Why there is no baseline, with the ceiling that decides it. */
  function baselineEmptyText(m, P) {
    const b = P.baseline;
    const widest = b && b.widest;
    const name = widest ? ((m.permissions.get(widest.ent) || {}).name || widest.ent) : null;
    if (!widest) return T('py.baselineNoData');
    /* The slider stops at 50%: below that a "baseline" is a rule most people would not
       match, which is not a baseline. So when the ceiling is under the slider's floor,
       telling somebody to lower the threshold sends them after something they cannot
       reach — the answer there is more data, not a looser bar. */
    const key = widest.coverage < BASELINE_SLIDER_MIN ? 'py.baselineUnreachable' : 'py.baselineEmpty';
    return T(key, {
      threshold: U.fmtPct(b.threshold, 0),
      widest: U.fmtPct(widest.coverage, 0),
      floor: U.fmtPct(BASELINE_SLIDER_MIN, 0),
      name: name
    });
  }

  function pyramidDiagram(m, P) {
    const levels = P.levels;
    const bands = [];
    const rulesAt = level => P.rules.filter(r => r.node.level === level);

    for (let level = 0; level <= levels.length; level++) {
      const nodes = Array.from(P.nodes.values()).filter(n => n.level === level);
      const sized = nodes.filter(n => n.members.length);
      const grants = rulesAt(level);
      /* Rules as HelloID counts them: one per group, granting several entitlements. */
      const rules = new Set(grants.map(r => r.node)).size;
      const covered = U.sum(grants, r => r.holders);
      bands.push({
        level,
        attr: level === 0 ? null : levels[level - 1],
        groups: sized.length,
        rules,
        grants: grants.length,
        covered,
        biggest: sized.reduce((max, n) => Math.max(max, n.members.length), 0),
        median: sized.length
          ? sized.map(n => n.members.length).sort((a, b) => a - b)[Math.floor(sized.length / 2)] : 0
      });
    }

    const maxRules = Math.max.apply(null, bands.map(b => b.rules).concat([1]));
    const wrap = el('div', { class: 'pyramid' });

    bands.forEach((b, i) => {
      /* Width follows the level, not the data: the shape is the point, the numbers are
         printed inside it. */
      const width = 34 + (bands.length === 1 ? 66 : (i / (bands.length - 1)) * 62);
      const band = el('div', { class: 'pyr-band' + (b.rules ? '' : ' empty') });
      band.style.width = width + '%';
      band.append(
        el('span', { class: 'pyr-level', text: 'L' + b.level }),
        el('span', { class: 'pyr-attr',
          text: b.attr ? (T('py.attr.' + b.attr) || b.attr) : T('py.everyone') }),
        el('span', { class: 'pyr-groups',
          /* An empty baseline is a threshold decision, not an absence of data, and
             greying the band out said neither. */
          text: b.level === 0
            ? (b.rules ? T('py.oneGroup') : baselineEmptyText(m, P))
            : T('py.groups', { n: U.fmtInt(b.groups) }) }),
        el('span', { class: 'pyr-rules' + (b.rules ? '' : ' none'),
          text: b.rules
            ? T('py.rulesHereGrants', { n: U.fmtInt(b.rules), grants: U.fmtInt(b.grants) })
            : T('py.rulesHere', { n: 0 }) })
      );
      /* A bar inside the band, so levels can be compared without reading the numbers. */
      const bar = el('span', { class: 'pyr-bar' });
      const fill = el('i');
      fill.style.width = (b.rules / maxRules * 100) + '%';
      bar.appendChild(fill);
      band.appendChild(bar);
      band.title = b.level === 0
        ? T('py.bandRootTip', { rules: b.rules })
        : T('py.bandTip', { groups: b.groups, biggest: b.biggest, median: b.median, rules: b.rules });
      wrap.appendChild(band);
    });

    if (P.combos && P.combos.length) {
      const across = el('div', { class: 'pyr-across' }, [
        el('span', { class: 'pyr-level', text: '⇄' }),
        el('span', { class: 'pyr-attr', text: T('py.acrossTitle') }),
        el('span', { class: 'pyr-groups', text: T('py.acrossNote') }),
        el('span', { class: 'pyr-rules', text: T('py.rulesHereGrants', {
          n: U.fmtInt(P.summary.combos), grants: U.fmtInt(P.summary.comboGrants) }) })
      ]);
      wrap.appendChild(across);
    }

    /* What the shape costs and buys, in one line under it. */
    const s = P.summary;
    wrap.appendChild(el('p', { class: 'note pyr-foot', text: T('py.diagramFoot', {
      levels: levels.length,
      groups: U.fmtInt(Array.from(P.nodes.values()).filter(n => n.level === levels.length && n.members.length).length),
      coverage: U.fmtPct(s.coverage, 0)
    }) }));
    if (P.summary.tooSmall) {
      /* Otherwise a level that adds no rules reads as a level that found nothing. */
      wrap.appendChild(el('p', { class: 'note pyr-foot', text: T('py.tooSmall', {
        groups: U.fmtInt(P.summary.tooSmall), people: U.fmtInt(P.skippedPeople),
        min: P.minSize
      }) }));
    }
    return wrap;
  }


  /**
   * The access journey: the pyramid travelled one group at a time.
   *
   * The rules table says what the model concluded. This says how it got there — for the
   * group you are standing in, which entitlements are already a rule, which are
   * inherited from above, which are held by enough people to become one, and which are
   * held by so few that they are noise. That classification is the whole argument of the
   * model, and it is only legible per group.
   */
  let journeyId = 'root';

  function pyramidJourney(m, P) {
    const node = P.nodes.get(journeyId) || P.root;
    const cfg = Object.assign({ threshold: 0.9, pollutionBelow: 0.1 }, HR.config.get().pyramid || {});

    const crumbs = [];
    for (let n = node; n; n = n.parent) crumbs.unshift(n);

    const bar = el('div', { class: 'crumbs' });
    crumbs.forEach((n, i) => {
      if (i) bar.appendChild(el('span', { class: 'note', text: '›' }));
      bar.appendChild(el('button', {
        class: 'btn sm' + (n === node ? ' primary' : ''),
        text: n.label || T('py.everyone'),
        onclick: () => { journeyId = n.id; HR.app.render(); }
      }));
    });

    /* Entitlements this group holds, and what the model does with each. */
    const inherited = new Set();
    for (let a = node.parent; a; a = a.parent) a.ruleEnts.forEach(e => inherited.add(e));

    const rows = Array.from(node.entCount.entries()).map(entry => {
      const ent = entry[0], count = entry[1];
      const coverage = count / (node.members.length || 1);
      const state = node.ruleEnts.has(ent) ? 'rule'
        : inherited.has(ent) ? 'inherited'
        : coverage >= cfg.threshold ? 'minable'
        : coverage <= cfg.pollutionBelow ? 'noise' : 'partial';
      return { perm: m.permissions.get(ent), ent, count, coverage, state };
    }).sort((a, b) => b.coverage - a.coverage);

    const avg = node.members.length
      ? U.sum(node.members, x => x.ents.size) / node.members.length : 0;
    const parentAvg = node.parent && node.parent.members.length
      ? U.sum(node.parent.members, x => x.ents.size) / node.parent.members.length : null;
    const under = P.stats.under.filter(x => x.node === node).length;
    const pollution = P.stats.pollution.filter(x => x.person.deepest === node).length;

    const stats = el('div', { class: 'grid g4', style: 'margin:12px 0' });
    stats.append(
      tile(T('py.jPeople'), U.fmtInt(node.members.length),
        node.parent ? T('py.jOfParent', { n: U.fmtInt(node.parent.members.length) }) : T('py.jWhole')),
      tile(T('py.jAverage'), U.fmtNum(avg, 1),
        parentAvg == null ? T('py.jNoParent')
          : T('py.jVsParent', { delta: (avg - parentAvg >= 0 ? '+' : '') + U.fmtNum(avg - parentAvg, 1) })),
      tile(T('py.jRulesHere'), node.rules.length ? '1' : '0',
        T('py.jGrantsHere', { n: U.fmtInt(node.rules.length), inherited: U.fmtInt(inherited.size) })),
      tile(T('py.jGaps'), U.fmtInt(under), T('py.jPollution', { n: U.fmtInt(pollution) }),
        { severity: under ? 'medium' : 'good' })
    );

    /* Where to go next. */
    const children = (node.children || []).slice()
      .sort((a, b) => b.members.length - a.members.length);
    const kidsWrap = children.length
      ? el('div', { class: 'grid g3', style: 'margin-bottom:12px' }, children.map(k => {
          const share = node.members.length ? k.members.length / node.members.length : 0;
          const bar2 = el('span', { class: 'scorebar' });
          const fill = el('i');
          fill.style.width = (share * 100) + '%';
          fill.style.background = C.slot(1);
          bar2.appendChild(fill);
          return el('div', { class: 'card click org-card', onclick: () => { journeyId = k.id; HR.app.render(); } }, [
            el('div', { class: 'slot-head' }, [
              el('strong', { text: k.label || T('py.empty') }),
              el('span', { class: 'note mono', text: k.rules.length ? T('py.nGrants', { n: k.rules.length }) : '' })
            ]),
            el('div', { class: 'note', text: T('py.jMembers', { n: U.fmtInt(k.members.length) }) }),
            bar2
          ]);
        }))
      : null;

    const legend = el('div', { class: 'slot-actions', style: 'margin-bottom:8px' }, [
      el('span', { class: 'sev good', text: T('py.st.rule') }),
      el('span', { class: 'sev info', text: T('py.st.inherited') }),
      el('span', { class: 'sev medium', text: T('py.st.minable') }),
      el('span', { class: 'sev low', text: T('py.st.partial') }),
      el('span', { class: 'sev high', text: T('py.st.noise') })
    ]);

    const table = HR.table.make({
      columns: [
        { key: 'ent', label: T('py.cEntitlement'), value: r => r.perm ? r.perm.name : r.ent,
          render: r => r.perm
            ? el('a', { href: '#', text: r.perm.name,
                onclick: e => { e.preventDefault(); drawerPermission(r.perm, m); } })
            : el('span', { text: r.ent }) },
        { key: 'holders', label: T('py.cHolders'), value: r => r.count, align: 'right' },
        { key: 'coverage', label: T('py.cOfGroup'), value: r => r.coverage,
          render: r => scoreBar(Math.round(r.coverage * 100)) },
        { key: 'state', label: T('py.cVerdict'), value: r => r.state,
          render: r => el('span', {
            class: 'sev ' + ({ rule: 'good', inherited: 'info', minable: 'medium',
              partial: 'low', noise: 'high' })[r.state],
            text: T('py.st.' + r.state) }) }
      ],
      rows, pageSize: 12, exportName: 'journey'
    });

    return card(T('py.journeyTitle'), T('py.journeyNote'),
      [bar, stats, kidsWrap, legend, table].filter(Boolean));
  }

  /** One mined rule: its condition, what it grants, and who does not have it yet. */
  function drawerPyramidRule(m, P, row) {
    const body = document.createDocumentFragment();
    body.appendChild(dl([
      [T('py.dCondition'), row.level === 0 ? T('py.dNoCondition') : row.conditions],
      [T('py.dLevel'), row.level === 99 ? T('py.combo')
        : row.level === 0 ? T('py.baselineTag') : 'L' + row.level],
      [T('py.dMembers'), U.fmtInt(row.members)],
      [T('py.dGrants'), U.fmtInt(row.entitlements)]
    ]));

    body.appendChild(card(T('py.dEntitlements'), T('py.dEntitlementsNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('py.cEntitlement'), value: g => (m.permissions.get(g.ent) || {}).name || g.ent,
          render: g => {
            const perm = m.permissions.get(g.ent);
            return perm
              ? el('a', { href: '#', text: perm.name,
                  onclick: e => { e.preventDefault(); drawerPermission(perm, m); } })
              : el('span', { text: g.ent });
          } },
        { key: 'holders', label: T('py.cHolders'), value: g => g.holders, align: 'right' },
        { key: 'coverage', label: T('py.cOfGroup'), value: g => g.coverage,
          render: g => scoreBar(Math.round(g.coverage * 100)) },
        { key: 'missing', label: T('py.cLackingIt'), value: g => g.missing.length, align: 'right',
          render: g => g.missing.length
            ? el('span', { class: 'sev medium', text: String(g.missing.length) })
            : el('span', { class: 'note', text: '0' }) }
      ],
      rows: row.grants, pageSize: 12, exportName: 'rule-entitlements'
    })));

    /* Who the rule would change something for, which is the work it implies. */
    const missing = [];
    row.grants.forEach(g => g.missing.forEach(person =>
      missing.push({ person, ent: m.permissions.get(g.ent), coverage: g.coverage })));
    if (missing.length) {
      body.appendChild(card(T('py.dMissingTitle'), T('py.dMissingNote'), HR.table.make({
        columns: [
          { key: 'person', label: T('py.cPerson'), value: r => r.person.name },
          { key: 'ent', label: T('py.cLacks'), value: r => r.ent ? r.ent.name : '',
            render: r => el('span', { text: r.ent ? r.ent.name : '—' }) },
          { key: 'coverage', label: T('py.cPeers'), value: r => r.coverage,
            render: r => el('span', { text: U.fmtPct(r.coverage, 0) }) }
        ],
        rows: missing, pageSize: 10, exportName: 'rule-missing'
      })));
    }

    openDrawer(el('div', {}, [
      el('div', { text: row.name }),
      el('span', { class: 'note', text: T('py.dHeadNote', {
        n: row.entitlements, people: U.fmtInt(row.members) }) })
    ]), el('div', { class: 'stack' }, [body]));
  }


  /**
   * The two miners on the same scale, plus HelloID's own when its report is loaded.
   *
   * Coverage is the goal, so it leads; rules are the price and follow. The pyramid is
   * kept because it is legible and nests the way an organisation describes itself, but
   * where it loses on coverage that is stated rather than hidden.
   */

  /**
   * The baseline, and the people who fall short of it.
   *
   * An entitlement nearly everybody holds is not optional for the few who lack it: it is
   * the floor, and whoever is under it is either a gap to close or evidence the floor is
   * not really a floor. HelloID's own miner produces the same list as a by-product of
   * proposing the rule, and it is the half that gets acted on first — cleanup before
   * policy.
   */
  function baselineCard(m, P) {
    const b = P.baseline;
    if (!b) return null;

    const cfg = HR.config.get().pyramid || {};
    const slider = () => {
      const value = b.threshold;
      const out = el('span', { class: 'mono', text: U.fmtPct(value, 0) });
      const input = el('input', { type: 'range', min: BASELINE_SLIDER_MIN, max: 1, step: 0.01, value: value });
      input.addEventListener('input', e => { out.textContent = U.fmtPct(+e.target.value, 0); });
      input.addEventListener('change', e => {
        const c = HR.config.get();
        c.pyramid = Object.assign({}, c.pyramid, { baselineThreshold: +e.target.value });
        HR.config.save(c);
        delete m._pyramid;
        HR.app.render();
      });
      return el('label', { class: 'inline' }, [document.createTextNode(T('py.blThreshold')), input, out]);
    };

    if (!b.grants.length) {
      /* Saying "no baseline" without saying why invites the wrong conclusion: on a
         reconciliation export alone there cannot be one. */
      return card(T('py.blTitle'), T('py.blNote'), [
        el('p', { text: baselineEmptyText(m, P) }),
        el('p', { class: 'note', text: m.granted && !m.granted.empty
          ? T('py.blNoneWithGranted') : T('py.blNoneReconOnly') }),
        slider()
      ]);
    }

    const outside = b.outside.map(o => ({
      person: o.person,
      name: o.person.name,
      department: o.person.labels.Department || o.person.attrs.Department || '—',
      missing: o.missing,
      count: o.missing.length
    }));

    return card(T('py.blTitle'), T('py.blNote'), [
      el('div', { class: 'grid g4' }, [
        tile(T('py.blEntitlements'), U.fmtInt(b.summary.entitlements), T('py.blEntitlementsFoot')),
        tile(T('py.blComplete'), U.fmtInt(b.summary.complete),
          T('py.blCompleteFoot', { n: U.fmtInt(b.summary.people) }), { severity: 'good' }),
        tile(T('py.blOutside'), U.fmtInt(b.summary.outside),
          T('py.blOutsideFoot', { share: U.fmtPct(b.summary.outsideShare, 0) }),
          { severity: b.summary.outside ? 'medium' : 'good' }),
        tile(T('py.blGaps'), U.fmtInt(b.summary.gaps), T('py.blGapsFoot'),
          { severity: b.summary.gaps ? 'medium' : 'good' })
      ]),
      slider(),
      HR.table.make({
        columns: [
          { key: 'name', label: T('py.cEntitlement'), value: g => (m.permissions.get(g.ent) || {}).name || g.ent,
            render: g => {
              const perm = m.permissions.get(g.ent);
              return perm ? el('a', { href: '#', text: perm.name,
                onclick: e => { e.preventDefault(); drawerPermission(perm, m); } })
                : el('span', { text: g.ent });
            } },
          { key: 'coverage', label: T('py.blHeldBy'), value: g => g.coverage,
            render: g => scoreBar(Math.round(g.coverage * 100)) },
          { key: 'missing', label: T('py.blLacking'), value: g => g.missing.length, align: 'right',
            render: g => g.missing.length
              ? el('span', { class: 'sev medium', text: String(g.missing.length) })
              : el('span', { class: 'note', text: '0' }) }
        ],
        rows: b.grants, pageSize: 8, exportName: 'baseline'
      }),
      outside.length ? card(T('py.blOutsideTitle'), T('py.blOutsideNote'), HR.table.make({
        columns: [
          { key: 'name', label: T('py.cPerson'), value: r => r.name,
            render: r => el('a', { href: '#', text: r.name, onclick: e => {
              e.preventDefault(); drawerVaultPerson(personRow(m, r.person.person), m);
            } }) },
          { key: 'department', label: T('org.cTitle'), value: r => r.department },
          { key: 'count', label: T('py.blMissingCount'), value: r => r.count, align: 'right' },
          { key: 'missing', label: T('py.blMissingWhat'), sortable: false,
            render: r => el('span', { class: 'trunc',
              title: r.missing.map(e => (m.permissions.get(e) || {}).name || e).join(', '),
              text: r.missing.map(e => (m.permissions.get(e) || {}).name || e).join(', ') }) }
        ],
        rows: outside, pageSize: 10, exportName: 'outside-baseline'
      })) : null
    ].filter(Boolean));
  }

  function coverageCard(m, P) {
    let G = null;
    try { G = HR.pyramid.greedy(m); } catch (e) { return null; }
    if (!G || !G.rules.length) return null;

    const rows = [
      { method: T('py.cfPyramid'), rules: P.summary.rules + P.summary.combos,
        coverage: P.summary.coverage, perRule: P.summary.perRule, own: true },
      { method: T('py.cfGreedy'), rules: G.summary.rules,
        coverage: G.summary.coverage, perRule: G.summary.perRule, own: true, greedy: G }
    ];
    rows.sort((a, b) => b.coverage - a.coverage);

    const sweep = HR.pyramid.sweep(m);
    const best = sweep.reduce((a, b) => (b.coverage > a.coverage ? b : a), sweep[0]);

    return card(T('py.cfTitle'), T('py.cfNote'), [
      HR.table.make({
        columns: [
          { key: 'method', label: T('py.cfMethod'), value: r => r.method },
          { key: 'coverage', label: T('py.cfCoverage'), value: r => r.coverage,
            render: r => scoreBar(Math.round(r.coverage * 100)) },
          { key: 'rules', label: T('py.cfRules'), value: r => r.rules, align: 'right' },
          { key: 'perRule', label: T('py.cfPerRule'), value: r => r.perRule, align: 'right',
            render: r => el('span', { text: U.fmtNum(r.perRule, 1) }) }
        ],
        rows, pageSize: 5, exportName: 'mining-comparison'
      }),
      el('p', { class: 'note', style: 'margin-top:10px', text: T('py.cfExplain') }),
      el('div', { class: 'slot-actions' }, [
        el('button', { class: 'btn', text: T('py.cfExport'), onclick: () => {
          U.download('coverage-first-rules.csv', HR.pyramid.greedyToRulesCsv(m, G), 'text/csv');
          HR.usage.exported('coverage-first-rules');
        } })
      ]),
      card(T('py.swTitle'), T('py.swNote'), HR.table.make({
        columns: [
          { key: 'threshold', label: T('py.swThreshold'), value: r => r.threshold,
            render: r => el('span', { class: 'mono' + (r.threshold === P.threshold ? ' pill ok' : ''),
              text: U.fmtPct(r.threshold, 0) }) },
          { key: 'coverage', label: T('py.cfCoverage'), value: r => r.coverage,
            render: r => scoreBar(Math.round(r.coverage * 100)) },
          { key: 'rules', label: T('py.cfRules'), value: r => r.rules, align: 'right' },
          { key: 'exceptions', label: T('py.swExceptions'), value: r => r.exceptions, align: 'right',
            hint: T('py.swExceptionsHint') }
        ],
        rows: sweep, pageSize: 8, exportName: 'threshold-sweep',
        initialSort: { key: 'threshold', dir: -1 }
      })),
      el('p', { class: 'note', text: T('py.swBest', {
        threshold: U.fmtPct(best.threshold, 0), coverage: U.fmtPct(best.coverage, 0),
        rules: best.rules, exceptions: U.fmtInt(best.exceptions) }) })
    ]);
  }

  function pyramidView(m) {
    const f = document.createDocumentFragment();
    if (!m.vault) {
      const note = partialNotice(['vault']);
      if (note) f.appendChild(note);
      f.appendChild(card(T('py.title'), null, [
        el('p', { text: T('py.needsVault') }),
        el('div', { class: 'slot-actions' }, [
          el('button', { class: 'btn primary', text: T('py.goImport'),
            onclick: () => HR.app.go('sources') }),
          el('button', { class: 'btn', text: T('py.goBundles'),
            onclick: () => HR.app.go('rules') })
        ])
      ]));
      /* The fallback, in the view that would otherwise be empty. */
      f.appendChild(proposalsCard(m));
      return f;
    }

    let P;
    try { P = HR.pyramid.build(m); } catch (e) { P = null; }
    if (!P || P.unavailable) {
      f.appendChild(card(T('py.title'), null, el('p', { class: 'note', text: T('py.unavailable') })));
      return f;
    }

    const s = P.summary;
    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('py.title') }),
        el('p', { text: T('py.lead', {
          levels: P.levels.map(l => T('py.attr.' + l) || l).join(' › ') || T('py.noLevels'),
          people: U.fmtInt(s.people) }) })
      ]),
      el('button', { class: 'btn', text: T('py.export'), onclick: () => {
        U.download('pyramid-rules.csv', HR.pyramid.toRulesCsv(m, P), 'text/csv');
        HR.usage.exported('pyramid-rules');
      } })
    ]));

    /* What the coverage figures are measured over. Its own line, full width: inside the
       header flex it wrapped against the export button and read as an afterthought. */
    f.appendChild(el('p', { class: 'note scope-note',
      text: T(m.granted && !m.granted.empty ? 'py.scopeFull' : 'py.scopeRecon') }));

    const tiles = el('div', { class: 'grid g4', style: 'margin-bottom:14px' });
    tiles.append(
      tile(T('py.kRules'), U.fmtInt(s.rules + s.combos),
        T('py.kRulesFoot', { grants: U.fmtInt(s.grants + s.comboGrants) })),
      tile(T('py.kCoverage'), U.fmtPct(s.coverage, 0),
        T('py.kCoverageFoot', { explained: U.fmtInt(s.explained), total: U.fmtInt(s.assignments) }),
        { severity: s.coverage > 0.6 ? 'good' : s.coverage > 0.3 ? 'medium' : 'high' }),
      tile(T('py.kUnder'), U.fmtInt(s.under), T('py.kUnderFoot'),
        { severity: s.under ? 'medium' : 'good', onClick: () => HR.app.go('pyramid', { tab: 'under' }) }),
      tile(T('py.kPollution'), U.fmtInt(s.pollution), T('py.kPollutionFoot', { isolated: U.fmtInt(s.isolated) }),
        { severity: 'medium' })
    );
    f.appendChild(tiles);

    /* ---- the levels, and what each one bought ---- */
    const cfg = HR.config.get();
    const chips = el('div', { class: 'slot-actions' });
    const setLevels = levels => {
      const c = HR.config.get();
      c.pyramid = Object.assign({}, c.pyramid, { levels });
      HR.config.save(c);
      delete m._pyramid;
      HR.app.render();
    };
    P.levels.forEach((attr, i) => {
      chips.appendChild(el('span', { class: 'pill solid' }, [
        el('span', { class: 'mono', text: 'L' + (i + 1) + ' ' }),
        document.createTextNode(T('py.attr.' + attr) || attr),
        el('button', { class: 'btn sm ghost', text: '↑', title: T('py.up'), onclick: () => {
          if (!i) return;
          const next = P.levels.slice();
          next[i - 1] = P.levels[i]; next[i] = P.levels[i - 1];
          setLevels(next);
        } }),
        el('button', { class: 'btn sm ghost', text: '✕', title: T('py.remove'),
          onclick: () => setLevels(P.levels.filter((_, j) => j !== i)) })
      ]));
    });
    const remaining = P.attributes.filter(a => !P.levels.includes(a));
    if (remaining.length) {
      const sel = el('select', {}, [el('option', { value: '', text: T('py.addLevel') })]
        .concat(remaining.map(a => el('option', { value: a, text: T('py.attr.' + a) || a }))));
      sel.addEventListener('change', e => { if (e.target.value) setLevels(P.levels.concat([e.target.value])); });
      chips.appendChild(sel);
    }
    if (P.suggestion.levels.length && P.suggestion.levels.join() !== P.levels.join()) {
      chips.appendChild(el('button', { class: 'btn sm primary', text: T('py.useSuggested'),
        onclick: () => setLevels(P.suggestion.levels) }));
    }

    /* The two numbers that decide how granular the model can get. They were fixed, and
       the minimum group size in particular made deeper levels look useless: a department
       splits into titles of two or three people, all of which a floor of five discards. */
    const slider = (labelKey, key, min, max, step, format) => {
      const value = P[key];
      const out = el('span', { class: 'mono', text: format(value) });
      const input = el('input', { type: 'range', min: min, max: max, step: step, value: value });
      input.addEventListener('input', e => { out.textContent = format(+e.target.value); });
      input.addEventListener('change', e => {
        const c = HR.config.get();
        c.pyramid = Object.assign({}, c.pyramid, { [key]: +e.target.value });
        HR.config.save(c);
        delete m._pyramid;
        HR.app.render();
      });
      return el('label', { class: 'inline' }, [document.createTextNode(T(labelKey)), input, out]);
    };
    const knobs = el('div', { class: 'slot-actions' }, [
      slider('py.threshold', 'threshold', 0.5, 1, 0.01, v => U.fmtPct(v, 0)),
      slider('py.minSize', 'minSize', 1, 25, 1, v => U.fmtInt(v))
    ]);

    f.appendChild(card(T('py.levelsTitle'), T('py.levelsNote'), [
      pyramidDiagram(m, P),
      chips,
      knobs,
      el('p', { class: 'note', style: 'margin-top:10px', text: P.suggestion.steps.length
        ? T('py.suggestion', {
            steps: P.suggestion.steps.map(x => (T('py.attr.' + x.attr) || x.attr) +
              ' +' + U.fmtNum(x.gain * 100, 1) + 'pp').join(', '),
            coverage: U.fmtPct(P.suggestion.coverage, 0) })
        : T('py.noSuggestion') })
    ]));

    const bl = baselineCard(m, P);
    if (bl) f.appendChild(bl);
    const cov = coverageCard(m, P);
    if (cov) f.appendChild(cov);
    f.appendChild(pyramidJourney(m, P));

    /* ---- the rules, as rules ----
       One row per condition, the way HelloID stores them and the way the export writes
       them. Listing a row per granted entitlement made the table disagree with the CSV
       it produces and made a two-level model look like hundreds of rules. */
    const ruleRows = Array.from(P.ruleGroups.entries()).map(entry => {
      const node = entry[0], grants = entry[1];
      const isBaseline = node.level === 0;
      return {
        kind: isBaseline ? 'baseline' : 'pyramid',
        name: isBaseline
          ? T('py.baselineRuleName')
          : 'Piramide - ' + node.path.map(x => (T('py.attr.' + x.attr) || x.attr) + ': ' +
            (x.label || x.value || T('py.empty'))).join(' / '),
        conditions: node.path.map(x => (T('py.attr.' + x.attr) || x.attr) +
          (x.byId ? '.ExternalId' : '.Name') + ' = ' + (x.value || T('py.empty')) +
          (x.label && x.label !== x.value ? ' (' + x.label + ')' : '')).join('  ∧  ') || T('py.everyone'),
        level: node.level,
        members: node.members.length,
        grants: grants,
        entitlements: grants.length,
        /* The weakest entitlement in the rule decides how safe the rule is. */
        minCoverage: Math.min.apply(null, grants.map(g => g.coverage)),
        missing: new Set(grants.flatMap(g => g.missing)).size,
        node: node
      };
    }).concat(Array.from(P.comboGroups.values()).map(group => ({
      kind: 'combo',
      name: 'Combinatie - ' + group.conds.map(c => c.label || c.value).join(' + '),
      conditions: group.conds.map(c => (T('py.attr.' + c.attr) || c.attr) +
        (c.byId ? '.ExternalId' : '.Name') + ' = ' + c.value +
        (c.label && c.label !== c.value ? ' (' + c.label + ')' : '')).join('  ∧  '),
      level: 99,
      members: group.members.length,
      grants: group.rules,
      entitlements: group.rules.length,
      minCoverage: Math.min.apply(null, group.rules.map(g => g.coverage)),
      missing: new Set(group.rules.flatMap(g => g.missing)).size,
      node: null
    })));

    f.appendChild(card(T('py.rulesTitle'), T('py.rulesNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('py.cRule'), value: r => r.name,
          render: r => el('a', { href: '#', text: r.name,
            onclick: e => { e.preventDefault(); drawerPyramidRule(m, P, r); } }) },
        { key: 'level', label: T('py.cLevel'), value: r => r.level,
          render: r => r.level === 99
            ? el('span', { class: 'pill muted', text: T('py.combo') })
            : r.level === 0
              ? el('span', { class: 'pill ok', text: T('py.baselineTag') })
              : el('span', { class: 'mono', text: 'L' + r.level }) },
        { key: 'members', label: T('py.cGroup'), value: r => r.members, align: 'right' },
        { key: 'entitlements', label: T('py.cGrants'), value: r => r.entitlements, align: 'right' },
        { key: 'coverage', label: T('py.cWeakest'), value: r => r.minCoverage,
          hint: T('py.cWeakestHint'), render: r => scoreBar(Math.round(r.minCoverage * 100)) },
        { key: 'missing', label: T('py.cMissingPeople'), value: r => r.missing, align: 'right',
          render: r => r.missing
            ? el('span', { class: 'sev medium', text: String(r.missing) })
            : el('span', { class: 'note', text: '0' }) },
        { key: 'list', label: T('py.cGets'), sortable: false,
          render: r => el('span', { class: 'trunc',
            title: r.grants.map(g => (m.permissions.get(g.ent) || {}).name || g.ent).join(', '),
            text: r.grants.map(g => (m.permissions.get(g.ent) || {}).name || g.ent).join(', ') }) }
      ],
      rows: ruleRows, pageSize: 15, exportName: 'pyramid-rules',
      /* By level, so the rules an added level produces are visible rather than buried. */
      initialSort: { key: 'level', dir: 1 }
    })));

    /* ---- what the model says is wrong ---- */
    const under = P.stats.under.slice(0, 400).map(u => ({
      person: u.person.name, ent: m.permissions.get(u.ent), coverage: u.coverage,
      where: u.node ? (u.node.path.map(x => x.label || x.value).join(' › ') || T('py.everyone'))
        : u.combo.conds.map(c => c.label || c.value).join(' + ')
    }));
    if (under.length) {
      f.appendChild(card(T('py.underTitle'), T('py.underNote'), HR.table.make({
        columns: [
          { key: 'person', label: T('py.cPerson'), value: r => r.person },
          { key: 'where', label: T('py.cBecause'), value: r => r.where },
          { key: 'ent', label: T('py.cLacks'), value: r => r.ent ? r.ent.name : '',
            render: r => el('span', { text: r.ent ? r.ent.name : '—' }) },
          { key: 'coverage', label: T('py.cPeers'), value: r => r.coverage,
            render: r => el('span', { text: U.fmtPct(r.coverage, 0) }) }
        ],
        rows: under, pageSize: 12, exportName: 'under-entitled'
      })));
    }

    const isolated = P.stats.pollution.filter(p => p.isolated).slice(0, 400).map(p => ({
      person: p.person.name, ent: m.permissions.get(p.ent), coverage: p.coverage,
      where: p.node.path.map(x => x.label || x.value).join(' › ') || T('py.everyone')
    }));
    if (isolated.length) {
      f.appendChild(card(T('py.pollutionTitle'), T('py.pollutionNote'), HR.table.make({
        columns: [
          { key: 'person', label: T('py.cPerson'), value: r => r.person },
          { key: 'where', label: T('py.cIn'), value: r => r.where },
          { key: 'ent', label: T('py.cHolds'), value: r => r.ent ? r.ent.name : '',
            render: r => el('span', { text: r.ent ? r.ent.name : '—' }) },
          { key: 'coverage', label: T('py.cPeers'), value: r => r.coverage,
            render: r => el('span', { text: U.fmtPct(r.coverage, 0) }) }
        ],
        rows: isolated, pageSize: 12, exportName: 'pollution'
      })));
    }
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
      tile(T('ov.accounts'), U.fmtInt(s.accounts), T('ov.enabledDisabled', { e: s.enabledAccounts, d: s.disabledAccounts }), { small: true, delta: bDelta('accounts') }),
      tile(T('ov.coverage'), U.fmtPct(s.coverage, 0), T('ov.coverageFoot'), { small: true, severity: s.coverage > .9 ? 'good' : 'medium' }),
      tile(T('ov.licenceSpend'), U.fmtMoney(s.monthlyCost) + '/mo', T('ov.pricedGroups', { n: m.cost.pricedPermissions }), { small: true, delta: bDelta('monthlyCost'), deltaFormat: U.fmtMoney }),
      tile(T('ov.cleanup'), U.fmtMoney(m.cost.remediationCost), T('ov.cleanupFoot', { h: Math.round(m.cost.remediation.hours), rate: U.fmtMoney(m.cost.remediation.rate) }), { small: true })
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

    if (m.systemList.length > 1) {
      f.appendChild(el('div', { class: 'grid' }, card(T('ov.systems'), null, HR.table.make({
        columns: [
          { key: 'name', label: T('c.system') },
          { key: 'accountCount', label: T('ov.accounts'), num: true },
          { key: 'permissionCount', label: T('pm.title'), num: true },
          { key: 'rows', label: T('c.rowsCol'), num: true }
        ], rows: m.systemList, pageSize: 20, exportName: 'systems'
      }))));
    }
    return f;
  }

  /* =================================================================== RISK */
  function riskView(m) {
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

    const g = el('div', { class: 'grid g2' }); g.style.marginTop = '14px';
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
      initialSort: { key: 'meanRisk', dir: -1 }
    })));
    f.appendChild(g);

    /* findings */
    const list = el('div', { class: 'stack' }); list.style.marginTop = '14px';
    list.appendChild(el('div', { class: 'row' }, [
      el('h2', { text: T('rk.findings', { n: m.findings.length }) }),
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
    f.appendChild(list);

    f.appendChild(el('div', { class: 'grid' }, card(T('rk.topPerms'), T('rk.topPermsNote'), HR.table.make({
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
    }))));

    return f;
  }

  function findingCard(fd, m) {
    const d = el('details', { class: 'finding' });
    const sum = el('summary');
    sum.append(
      el('span', { class: 'sev ' + fd.severity, text: T('c.' + fd.severity) }),
      el('span', { class: 'f-title', text: fd.title }),
      el('span', { class: 'pill', text: fd.category }),
      el('span', { class: 'pill solid', text: T(fd.count === 1 ? 'rk.item' : 'rk.items', { n: fd.count }) }),
      fd.impactMonthly ? el('span', { class: 'pill', text: U.fmtMoney(fd.impactMonthly) + '/mo · ' + T(fd.recoverable ? 'rk.recoverable' : 'rk.atStake') }) : null
    );
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
  function costView(m) {
    const f = document.createDocumentFragment();
    const c = m.cost;
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('ct.title') }),
      el('p', { text: T('ct.lead') })
    ])));

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('ov.licenceSpend'), U.fmtMoney(c.totalMonthly) + '/mo', T('ov.perYear', { amount: U.fmtMoney(c.totalAnnual) }), { delta: bDelta('monthlyCost'), deltaFormat: U.fmtMoney }),
      tile(T('ct.recoverableNow'), U.fmtMoney(c.wasteMonthly) + '/mo', T('ov.perYear', { amount: U.fmtMoney(c.wasteAnnual) }), { severity: c.wasteMonthly ? 'high' : 'good' }),
      tile(T('ct.outsideControl'), U.fmtMoney(c.unmanagedSpend) + '/mo', T('ct.outsideControlFoot'), { severity: 'medium' }),
      tile(T('ov.cleanup'), U.fmtMoney(c.remediationCost), T('ct.cleanupFoot', { h: Math.round(c.remediation.hours) }) + (c.paybackMonths ? ' · ' + T('ct.payback', { n: U.fmtNum(c.paybackMonths, 1) }) : ''), { small: true })
    );
    f.appendChild(k);

    const g = el('div', { class: 'grid g2' }); g.style.marginTop = '14px';

    /* waste buckets */
    const buckets = [
      { label: T('ct.bucketDisabled'), value: c.disabledWaste, n: c.disabledHolders.length, color: C.STATUS.critical, hard: true },
      { label: T('ct.bucketStacked'), value: c.stackedWasteNet, n: c.stacked.length, color: C.STATUS.serious, hard: true },
      { label: T('ct.bucketOrphan'), value: c.orphanExposure, n: c.orphanEnabled.length, color: C.STATUS.warning, hard: false }
    ];
    g.appendChild(card(T('ct.leaks'), T('ct.leaksNote'), [
      C.barList(buckets.map(b => ({ label: b.label, value: b.value, color: b.color, note: T('ct.bucketFoot', { n: b.n }) })),
        { format: v => U.fmtMoney(v), valueLabel: T('c.perMonth') }),
      el('p', { class: 'note', text: T('ct.leaksNote2') })
    ]));

    /* savings scenario */
    g.appendChild(card(T('ct.scenario'), null, savingsScenario(m)));

    g.appendChild(card(T('ct.byCategory'), null, C.barList(c.byCategory.map(x => ({
      label: x.key, value: x.monthly, color: C.slot(4), note: T('ct.groupsN', { n: x.items })
    })), { format: v => U.fmtMoney(v), valueLabel: T('c.perMonth') })));

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
    f.appendChild(g);

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
        { key: 'clsLabel', label: T('c.class') },
        { key: 'enabled', label: T('c.state'), value: r => T(r.enabled === false ? 'c.disabled' : 'c.enabled'), render: r => el('span', { class: 'pill', text: T(r.enabled === false ? 'c.disabled' : 'c.enabled') }) },
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'unmanagedPermCount', label: T('c.unmanaged'), num: true },
        { key: 'missingCount', label: T('c.missing'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) },
        { key: 'outlier', label: T('c.outlier'), num: true, render: r => r.outlier == null ? '—' : U.fmtPct(r.outlier, 0), hint: T('ac.outlierHint') },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ],
      rows, pageSize: 40, exportName: 'accounts',
      initialSort: { key: 'riskScore', dir: -1 },
      searchPlaceholder: T('ac.searchPh'),
      search: (r, q) => (r.userName + ' ' + r.displayName + ' ' + r.personRaw + ' ' + r.clsLabel).toLowerCase().includes(q) ||
        r.perms.some(p => p.name.toLowerCase().includes(q)),
      filters: [
        { key: 'state', label: T('c.state'), options: [{ value: 'enabled', label: T('c.enabled') }, { value: 'disabled', label: T('c.disabled') }], match: (r, v) => (v === 'disabled') === (r.enabled === false) },
        { key: 'owner', label: T('c.owner'), options: [{ value: 'owned', label: T('c.linked') }, { value: 'orphan', label: T('c.unowned') }], match: (r, v) => (v === 'orphan') === !!r.orphan },
        { key: 'cls', label: T('c.class'), options: U.uniq(m.accountList.map(a => a.clsLabel)).map(v => ({ value: v, label: v })), match: (r, v) => r.clsLabel === v },
        { key: 'band', label: T('c.risk'), options: ['critical', 'high', 'medium', 'low'].map(v => ({ value: v, label: T('c.' + v) })), match: (r, v) => r.riskBand === v }
      ],
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

    f.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.permission') },
        { key: 'categoryLabel', label: T('c.category') },
        { key: 'sensitivity', label: T('c.sensitivity'), num: true, render: r => U.fmtNum(r.sensitivity, 1) },
        { key: 'holderCount', label: T('c.holders'), num: true },
        { key: 'holdersEnabled', label: T('c.enabled'), num: true },
        { key: 'holdersDisabled', label: T('c.disabled'), num: true },
        { key: 'holdersOrphan', label: T('c.unowned'), num: true },
        { key: 'monthlyPrice', label: T('c.unitMo'), num: true, render: r => r.monthlyPrice ? U.fmtMoney(r.monthlyPrice) : '—' },
        { key: 'monthlyTotal', label: T('c.totalMo'), num: true, render: r => r.monthlyTotal ? U.fmtMoney(r.monthlyTotal) : '—' },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ],
      rows: m.permissionList, pageSize: 40, exportName: 'permissions',
      initialSort: { key: 'riskScore', dir: -1 },
      searchPlaceholder: T('pm.searchPh'),
      search: (r, q) => (r.name + ' ' + r.path + ' ' + r.categoryLabel).toLowerCase().includes(q),
      filters: [
        { key: 'cat', label: T('c.category'), options: U.uniq(m.permissionList.map(p => p.categoryLabel)).map(v => ({ value: v, label: v })), match: (r, v) => r.categoryLabel === v },
        { key: 'rare', label: T('c.rarity'), options: [{ value: 'rare', label: T('c.rare') }, { value: 'common', label: T('c.common') }], match: (r, v) => (v === 'rare') === !!r.rare },
        { key: 'priced', label: T('c.priced'), options: [{ value: 'yes', label: T('c.yes') }, { value: 'no', label: T('c.no') }], match: (r, v) => (v === 'yes') === (r.monthlyPrice > 0) }
      ],
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

    const counts = U.counts(rows, r => r.life.state);
    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('pp.persons'), U.fmtInt(rows.length), T('pp.personsFoot'), { small: true }),
      tile(T('pp.stateCurrent'), U.fmtInt(counts.get('current') || 0), T('pp.contracts'), { small: true, severity: 'good' }),
      tile(T('pp.statePast'), U.fmtInt(counts.get('past') || 0), T('pp.statePast'), { small: true, severity: (counts.get('past') || 0) ? 'critical' : 'good' }),
      tile(T('pp.stateFuture'), U.fmtInt(counts.get('future') || 0), T('pp.stateFuture'), { small: true, severity: 'info' })
    );
    f.appendChild(k);

    f.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.person'), value: r => r.person.displayName },
        { key: 'externalId', label: T('c.employeeId'), value: r => r.person.externalId },
        { key: 'state', label: T('pp.state'), value: r => r.life.state,
          render: r => el('span', { class: 'sev ' + STATE_SEV[r.life.state], text: stateLabel(r.life.state) }) },
        { key: 'offset', label: T('pp.offset'), num: true, hint: T('pp.offsetHint'),
          value: r => r.life.state === 'past' ? -(r.life.days || 0) : (r.life.days == null ? 1e9 : r.life.days),
          render: r => offsetText(r.life) },
        { key: 'contracts', label: T('pp.contracts'), num: true, value: r => r.person.contracts.length },
        { key: 'department', label: T('pp.department'), value: r => r.department },
        { key: 'title', label: T('pp.jobTitle'), value: r => r.title },
        { key: 'accounts', label: T('pp.accounts'), num: true, value: r => r.accounts.length },
        { key: 'perms', label: T('c.perms'), num: true, value: r => r.perms.length },
        { key: 'cost', label: T('c.costMo'), num: true, value: r => r.monthlyCost, render: r => U.fmtMoney(r.monthlyCost) },
        { key: 'risk', label: T('pp.maxRisk'), num: true, value: r => r.maxRisk, render: r => r.accounts.length ? scoreBar(r.maxRisk) : '—' }
      ],
      rows, pageSize: 40, exportName: 'people',
      initialSort: { key: 'state', dir: 1 },
      search: (r, q) => (r.person.displayName + ' ' + r.person.externalId + ' ' + r.department + ' ' + r.title +
        ' ' + r.accounts.map(a => a.userName).join(' ')).toLowerCase().includes(q),
      filters: [
        { key: 'state', label: T('pp.state'),
          options: ['current', 'past', 'future', 'unknown'].map(v => ({ value: v, label: T('pp.state' + v.charAt(0).toUpperCase() + v.slice(1)) })),
          match: (r, v) => r.life.state === v },
        { key: 'accounts', label: T('pp.accounts'),
          options: [{ value: 'with', label: '1+' }, { value: 'without', label: '0' }],
          match: (r, v) => (v === 'with') === (r.accounts.length > 0) }
      ],
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
        { key: 'externalId', label: T('c.employeeId') },
        { key: 'accountCount', label: T('pp.accounts'), num: true },
        { key: 'enabledAccounts', label: T('c.enabled'), num: true },
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'monthlyCost', label: T('c.costMo'), num: true, render: r => U.fmtMoney(r.monthlyCost) },
        { key: 'maxRisk', label: T('pp.maxRisk'), num: true, value: r => Math.max(0, ...r.accounts.map(a => a.riskScore)), render: r => scoreBar(Math.max(0, ...r.accounts.map(a => a.riskScore))) }
      ],
      rows: m.personList, pageSize: 40, exportName: 'people',
      initialSort: { key: 'permCount', dir: -1 },
      search: (r, q) => (r.name + ' ' + r.externalId).toLowerCase().includes(q),
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
    body.appendChild(dl([
      [T('c.employeeId'), p.externalId || '—'],
      [T('pp.department'), row.department || '—'],
      [T('pp.jobTitle'), row.title || '—'],
      [T('dr.monthlyCost'), U.fmtMoney(row.monthlyCost)]
    ]));

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
  function settingsView() {
    const cfg = HR.config.clone(HR.config.get());
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('st.title') }),
        el('p', { text: T('st.lead') }),
        el('p', { class: 'note', text: T('st.persistNote') })
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: T('st.save'), onclick: () => { HR.config.save(cfg); HR.app.rebuild(); U.toast(T('toast.settingsSaved')); } }),
        el('button', { class: 'btn', text: T('st.reset'), onclick: () => { if (confirm(T('st.resetConfirm'))) { HR.config.reset(); HR.app.rebuild(); HR.app.go('settings'); } } }),
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
              HR.app.applyChrome(); HR.app.rebuild(); HR.app.go('settings');
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
          .concat([el('th', { class: 'no-sort num', text: opts && opts.target ? T('rv.matches') : '' }), el('th', { class: 'no-sort' })]))));
        const tb = el('tbody');
        list.forEach((item, idx) => {
          const tr = el('tr');
          fields.forEach(fl => {
            const td = el('td', { class: fl.num ? 'num' : '' });
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
            tr.appendChild(td);
          });
          if (opts && opts.target && HR.app.state.model) {
            const res = HR.mine.test(item.pattern, opts.target, HR.app.state.model);
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

    const g = el('div', { class: 'grid' });

    g.appendChild(editableList(T('st.priceBook'), T('st.priceBookNote'),
      cfg.priceBook,
      [{ key: 'label', label: T('st.label') }, { key: 'pattern', label: T('st.pattern') },
       { key: 'price', label: T('st.price'), num: true, step: '0.01' }],
      () => ({ label: 'New SKU', pattern: '^LIC-', price: 0, unit: 'month' }), { target: 'permission' }));

    g.appendChild(editableList(T('st.categories'), T('st.categoriesNote'),
      cfg.categories,
      [{ key: 'label', label: T('c.category'), translated: true }, { key: 'pattern', label: T('st.patternShort') }, { key: 'sensitivity', label: T('st.sensitivity'), num: true, step: '0.1' }],
      () => ({ id: 'custom' + Date.now(), label: 'New category', pattern: '^X', sensitivity: 1, color: 2 }), { target: 'permission' }));

    g.appendChild(editableList(T('st.classes'), T('st.classesNote'),
      cfg.accountClasses,
      [{ key: 'label', label: T('c.class'), translated: true }, { key: 'pattern', label: T('st.patternShort') }, { key: 'weight', label: T('st.weight'), num: true, step: '0.1' }],
      () => ({ id: 'custom' + Date.now(), label: 'New class', pattern: '^X', weight: 1 }), { target: 'account' }));

    const numField = (obj, key, label, step) => {
      const w = el('label', { class: 'inline' });
      const i = el('input', { type: 'number', value: obj[key], step: step || 'any', oninput: e => obj[key] = parseFloat(e.target.value) || 0 });
      i.style.width = '90px';
      w.append(document.createTextNode(label), i);
      return w;
    };

    g.appendChild(card(T('st.riskWeights'), T('st.riskWeightsNote'), el('div', { class: 'row' }, [
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
    ])));

    g.appendChild(card(T('st.effort'), T('st.effortNote'), el('div', { class: 'row' }, [
      numField(cfg.effort, 'hourlyRate', T('st.hourlyRate')),
      numField(cfg.effort, 'minutesPerUnmanagedPermission', T('st.minPerm')),
      numField(cfg.effort, 'minutesPerUnmanagedAccount', T('st.minAccount')),
      numField(cfg.effort, 'minutesPerMissingPermission', T('st.minMissing')),
      numField(cfg.effort, 'minutesPerPrivilegedReview', T('st.minPriv'))
    ])));

    g.appendChild(card(T('st.thresholds'), null, el('div', { class: 'row' }, [
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
    ])));

    /* ---- account-to-person matching, with the effect of the current numbers ---- */
    (() => {
      const c = cfg.correlation;
      const m = HR.app.state.model;
      const stats = (m && m.vault) ? HR.correlate.attributionStats(m, m.vault, m.correlation) : null;
      const toggle = (key, labelKey) => {
        const box = el('input', { type: 'checkbox', checked: c[key], onchange: e => c[key] = e.target.checked });
        return el('label', { class: 'inline' }, [box, document.createTextNode(T(labelKey))]);
      };
      const weight = (key, labelKey) => {
        const i = el('input', { type: 'number', value: c.weights[key], step: '5',
          oninput: e => c.weights[key] = parseFloat(e.target.value) || 0 });
        i.style.width = '80px';
        return el('label', { class: 'inline' }, [document.createTextNode(T(labelKey)), i]);
      };
      const threshold = el('input', { type: 'number', value: c.strongThreshold, step: '5',
        oninput: e => c.strongThreshold = parseFloat(e.target.value) || 0 });
      threshold.style.width = '80px';

      g.appendChild(card(T('st.matching'), T('st.matchingNote'), [
        el('div', { class: 'row' }, [
          toggle('useVaultCorrelation', 'st.mUseVault'),
          toggle('useReconPerson', 'st.mUseRecon'),
          toggle('useNameMatch', 'st.mUseName'),
          el('label', { class: 'inline' }, [document.createTextNode(T('st.mThreshold')), threshold])
        ]),
        el('div', { class: 'row', style: 'margin-top:10px' }, [
          weight('vaultCorrelated', 'st.wVaultCorrelated'),
          weight('displayNameExact', 'st.wDisplayExact'),
          weight('employeeIdInUsername', 'st.wEmployeeId'),
          weight('displayNameContains', 'st.wDisplayContains'),
          weight('surnameInUsername', 'st.wSurname'),
          weight('firstAndSurnameInUsername', 'st.wFirstSurname'),
          weight('initialBeforeSurname', 'st.wInitial')
        ]),
        stats ? el('p', { class: 'note', style: 'margin-top:10px', text: T('st.mStats', {
          attributed: U.fmtInt(stats.attributed), total: U.fmtInt(stats.accounts),
          vault: U.fmtInt(stats.byLayer.vault || 0), recon: U.fmtInt(stats.byLayer.recon || 0),
          name: U.fmtInt(stats.byLayer.name || 0), left: U.fmtInt(stats.unattributed)
        }) }) : el('p', { class: 'note', style: 'margin-top:10px', text: T('st.mNoVault') })
      ]));
    })();

    if (HR.app.state.model) {
      g.appendChild(card(T('rv.tester'), T('rv.testerNote'), regexTester(HR.app.state.model)));
    }

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
    g.appendChild(card(T('st.branding'), T('st.brandingNote'), [
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
        })()
      ]),
      el('p', { class: 'note', text: T('st.logoHint') })
    ]));

    f.appendChild(g);
    return f;
  }

  /* ========================================================= ACTIVITY ==== */
  /* What HelloID granted and what it did: the record of its own actions, which is the
     only evidence that separates "the identity system never touched this" from "it tried
     and could not". */
  function activityView(m) {
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
      f.appendChild(gr);

      const gr2 = el('div', { class: 'grid g2', style: 'margin-top:14px' });
      gr2.appendChild(card(T('act.operations'), null, C.stackedBar(
        Object.entries(h.operations).map(([op, n], i) => ({ label: op, value: n, color: C.slot((i % 8) + 1) })))));
      gr2.appendChild(card(T('act.results'), null, C.stackedBar(
        Object.entries(h.results).map(([res, n]) => ({
          label: res, value: n,
          color: /succeed/i.test(res) ? C.STATUS.good : /fail/i.test(res) ? C.STATUS.critical : C.STATUS.warning
        })))));
      f.appendChild(gr2);

      if (h.failed.length) {
        f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('act.failures'), T('act.failuresNote'),
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
        f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('act.churn'), T('act.churnNote'),
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
      f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('act.grantedTable'),
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
    return f;
  }

  /* ===================================================== EXPLANATIONS ==== */
  function explainView(m) {
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
    f.appendChild(g);

    /* the residue: what nobody can account for */
    if (e.residueByAccount.length) {
      f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('ex.residue'), T('ex.residueNote'), HR.table.make({
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
    f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('ex.table'), null, HR.table.make({
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

    return f;
  }

  /* ==================================================== BUSINESS RULES ==== */
  /* The rule export next to the reconciliation export: what the model says should be
     granted, against what the target system hands out. */
  function rulesView(m) {
    const f = document.createDocumentFragment();
    const c = m.comparison;

    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('ru.title') }),
        el('p', { text: T('ru.lead') })
      ]),
      c ? el('button', { class: 'btn sm', text: T('ru.clear'), onclick: () => {
        HR.app.state.ruleSet = null; HR.app.rebuild(); U.toast(T('toast.rulesCleared'));
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

    /* ---- the split that decides where the work goes ---- */
    f.appendChild(el('div', { class: 'grid', style: 'margin-top:14px' },
      card(T('ru.split'), T('ru.splitNote'), [
        C.stackedBar([
          { label: T('ru.splitModelled'), value: s.unmanagedModelled, color: C.slot(3) },
          { label: T('ru.splitDraft'), value: s.unmanagedDraft, color: C.STATUS.warning },
          { label: T('ru.splitUnmodelled'), value: s.unmanagedUnmodelled, color: C.STATUS.critical }
        ]),
        el('p', { class: 'note', text: T('ru.splitFoot') })
      ])));

    /* ---- every rule, against reality ---- */
    f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('ru.rulesTable'), T('ru.rulesTableNote'), HR.table.make({
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
          render: r => el('span', { class: 'trunc', title: r.rule.scopingConditions.map(x => x.raw).join(' · '),
            text: r.rule.scopingConditions.map(x => x.facet).join(', ') || '—' }) }
      ],
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
    f.appendChild(el('div', { style: 'margin-top:14px' }, card(T('ru.backlog'), T('ru.backlogNote'), HR.table.make({
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
    if (g2.childNodes.length) f.appendChild(g2);
    f.appendChild(miningCard(m));
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
    return card(T('ro.pyramidTitle'), T('ro.pyramidNote'), [
      el('p', { text: T('ro.pyramidLead', {
        rules: U.fmtInt(s2.rules + s2.combos),
        grants: U.fmtInt(s2.grants + s2.comboGrants),
        levels: P.levels.map(l => T('py.attr.' + l) || l).join(' \u203a ') || T('py.noLevels'),
        coverage: U.fmtPct(s2.coverage, 0)
      }) }),
      el('div', { class: 'slot-actions' }, [
        el('button', { class: 'btn primary', text: T('ro.openPyramid'),
          onclick: () => HR.app.go('pyramid') }),
        el('button', { class: 'btn', text: T('py.export'), onclick: () => {
          U.download('pyramid-rules.csv', HR.pyramid.toRulesCsv(m, P), 'text/csv');
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

    body.appendChild(card(T('ru.cScope'), null, el('ul', { class: 'clean' },
      r.conditions.map(cd => el('li', {}, [
        el('strong', { text: cd.facet }),
        cd.operator ? el('span', { class: 'pill', text: cd.operator }) : null,
        el('span', { class: 'note', text: ' ' + cd.values.join(', ') })
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
        el('ul', { class: 'clean' }, row.stale.map(e => el('li', { text: e.raw })))));
    }
    if (row.accountEntitlements.length) {
      body.appendChild(card(T('ru.accountEnt'), null,
        el('ul', { class: 'clean' }, row.accountEntitlements.map(e => el('li', { text: e.raw })))));
    }
    openDrawer(head, body);
  }

  /* ============================================== CONFIGURATION REVIEW ==== */
  /* Shown once per import (unless switched off): what the current settings do and do
     not describe about this particular export, plus rules mined from its own naming. */
  function reviewView(m) {
    const f = document.createDocumentFragment();
    const sug = HR.app.state.review || HR.mine.suggest(m);
    const cfg = HR.config.clone(HR.config.get());
    const picked = { categories: new Set(), classes: new Set(), prices: new Set() };

    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('rv.title') }),
      el('p', { text: T('rv.lead') })
    ])));

    const c = sug.coverage;
    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('rv.covCategorised'), U.fmtPct(c.categorisedPct, 0),
        T('rv.covCategorisedFoot', { n: c.permissions - c.categorised }),
        { small: true, severity: c.categorisedPct > 0.9 ? 'good' : 'medium' }),
      tile(T('rv.covClassified'), U.fmtPct(c.classifiedPct, 0),
        T('rv.covClassifiedFoot', { n: c.accounts - c.classified }), { small: true }),
      tile(T('rv.covPriced'), U.fmtInt(c.priced),
        T('rv.covPricedFoot', { n: c.priceable }), { small: true, severity: c.priceable ? 'medium' : 'good' }),
      tile(T('rv.covSpend'), U.fmtMoney(c.pricedSpend) + '/mo', T('rv.covSpendFoot'), { small: true })
    );
    f.appendChild(k);

    /* ---- one proposal table per rule type ---- */
    const proposalTable = (kind, rows, valueField, valueLabel, targetType) => {
      if (!rows.length) return null;
      const body = el('div');
      const t = el('table', { class: 'tbl' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { class: 'no-sort', text: '' }),
        el('th', { class: 'no-sort', text: T('st.label') }),
        el('th', { class: 'no-sort', text: T('st.patternShort') }),
        el('th', { class: 'no-sort num', text: valueLabel }),
        el('th', { class: 'no-sort num', text: T('rv.matches') }),
        el('th', { class: 'no-sort', text: T('rv.examples') })
      ])));
      const tb = el('tbody');
      rows.forEach((row, i) => {
        const check = el('input', { type: 'checkbox', onchange: e => {
          if (e.target.checked) picked[kind].add(i); else picked[kind].delete(i);
        } });
        const patternInput = el('input', { type: 'text', value: row.pattern,
          oninput: e => { row.pattern = e.target.value; refreshMatch(); } });
        patternInput.style.minWidth = '190px';
        const valueInput = el('input', { type: 'number', step: '0.1', value: row[valueField],
          oninput: e => row[valueField] = parseFloat(e.target.value) || 0 });
        valueInput.style.width = '80px';
        const matchCell = el('td', { class: 'num' });
        const refreshMatch = () => {
          const res = HR.mine.test(row.pattern, targetType, m);
          matchCell.textContent = res.valid ? U.fmtInt(res.count) : '!';
          matchCell.title = res.valid ? (res.everything ? T('rv.matchesEverything') : '') : res.error;
          matchCell.className = 'num' + (!res.valid || res.everything ? ' tone-warn' : '');
        };
        refreshMatch();
        tb.appendChild(el('tr', {}, [
          el('td', {}, check),
          el('td', {}, [el('strong', { text: row.label }),
            row.hint ? el('span', { class: 'pill', text: T('cat.' + row.hint) !== 'cat.' + row.hint ? T('cat.' + row.hint) : row.hint }) : null]),
          el('td', {}, patternInput),
          el('td', { class: 'num' }, valueInput),
          matchCell,
          el('td', {}, el('span', { class: 'trunc mono', title: row.samples.join(', '), text: row.samples.join(', ') }))
        ]));
      });
      t.appendChild(tb);
      body.appendChild(el('div', { class: 'tbl-wrap' }, t));
      body.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { class: 'btn sm', text: T('rv.selectAll'), onclick: () => {
          body.querySelectorAll('input[type=checkbox]').forEach((cb, i) => {
            if (!cb.checked) { cb.checked = true; picked[kind].add(i); }
          });
        } }),
        el('button', { class: 'btn sm', text: T('rv.selectNone'), onclick: () => {
          body.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
          picked[kind].clear();
        } })
      ]));
      return body;
    };

    const stack = el('div', { class: 'stack', style: 'margin-top:14px' });
    const catBody = proposalTable('categories', sug.categories, 'sensitivity', T('st.sensitivity'), 'permission');
    if (catBody) stack.appendChild(card(T('rv.secCategories'), T('rv.secCategoriesNote'), catBody));
    const clsBody = proposalTable('classes', sug.classes, 'weight', T('st.weight'), 'account');
    if (clsBody) stack.appendChild(card(T('rv.secClasses'), T('rv.secClassesNote'), clsBody));
    const priceBody = proposalTable('prices', sug.prices, 'price', T('st.price'), 'permission');
    if (priceBody) stack.appendChild(card(T('rv.secPrices'), T('rv.secPricesNote'), priceBody));
    if (!catBody && !clsBody && !priceBody) {
      stack.appendChild(card(T('rv.secNone'), null, el('p', { class: 'note', text: T('rv.secNoneBody') })));
    }
    stack.appendChild(card(T('rv.tester'), T('rv.testerNote'), regexTester(m)));
    f.appendChild(stack);

    /* ---- apply ---- */
    const skip = el('input', { type: 'checkbox', onchange: e => { cfg.skipReview = e.target.checked; } });
    f.appendChild(el('div', { class: 'row', style: 'margin-top:16px' }, [
      el('button', { class: 'btn primary', text: T('rv.apply'), onclick: () => {
        /* Order matters: mined rules are more specific than the catch-all, so they go
           in front of it and keep the shipped defaults ahead of them. */
        const insertBefore = (list, id, items) => {
          const at = list.findIndex(x => x.id === id);
          list.splice(at < 0 ? list.length : at, 0, ...items);
        };
        insertBefore(cfg.categories, 'other', Array.from(picked.categories).map(i => {
          const r = sug.categories[i];
          return { id: 'mined-' + r.label.toLowerCase(), label: r.label, pattern: r.pattern, sensitivity: r.sensitivity, color: 2 };
        }));
        insertBefore(cfg.accountClasses, 'user', Array.from(picked.classes).map(i => {
          const r = sug.classes[i];
          return { id: 'mined-' + r.label.toLowerCase(), label: r.label, pattern: r.pattern, weight: r.weight };
        }));
        cfg.priceBook.unshift(...Array.from(picked.prices).map(i => {
          const r = sug.prices[i];
          return { label: r.label, pattern: r.pattern, price: r.price, unit: 'month' };
        }));
        HR.config.save(cfg);
        HR.app.state.review = null;
        HR.app.rebuild();
        U.toast(T('toast.settingsSaved'));
        HR.app.go('overview');
      } }),
      el('button', { class: 'btn', text: T('rv.skip'), onclick: () => {
        HR.config.save(cfg);
        HR.app.state.review = null;
        HR.app.go('overview');
      } }),
      el('label', { class: 'inline' }, [skip, document.createTextNode(T('rv.dontAsk'))])
    ]));
    return f;
  }

  /** Live regex check against the imported names — pattern in, matches out. */
  function regexTester(m) {
    const wrap = el('div');
    const input = el('input', { type: 'text', placeholder: '^APP-', oninput: () => run() });
    input.style.minWidth = '260px';
    const target = el('select', { onchange: () => run() });
    target.append(el('option', { value: 'permission', text: T('rv.targetPermission') }),
                  el('option', { value: 'account', text: T('rv.targetAccount') }));
    const out = el('div', { style: 'margin-top:10px' });
    function run() {
      out.innerHTML = '';
      if (!input.value.trim()) {                       // empty box tests nothing
        out.appendChild(el('p', { class: 'note', text: T('rv.testerEmpty') }));
        return;
      }
      const res = HR.mine.test(input.value, target.value, m);
      if (!res.valid) {
        out.appendChild(el('p', { class: 'note tone-warn', text: T('rv.invalid', { msg: res.error }) }));
        return;
      }
      out.append(
        el('p', { class: 'note', text: T('rv.matchCount', { n: U.fmtInt(res.count), total: U.fmtInt(res.total), pct: U.fmtPct(res.total ? res.count / res.total : 0, 0) }) +
          (res.everything ? ' · ' + T('rv.matchesEverything') : '') }),
        el('div', { class: 'mono trunc-multi', text: res.samples.join(', ') || T('rv.noMatch') })
      );
    }
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
    d.hidden = false; document.getElementById('drawer-scrim').hidden = false;
  }
  function closeDrawer() {
    document.getElementById('drawer').hidden = true;
    document.getElementById('drawer-scrim').hidden = true;
  }

  function drawerAccount(a, change) {
    const m = HR.app.state.model;
    const head = el('div', {}, [
      el('h2', { text: a.userName }),
      el('div', { class: 'row' }, [
        el('span', { class: 'sev ' + a.riskBand, text: T('app.riskShort') + ' ' + a.riskScore }),
        el('span', { class: 'pill', text: a.clsLabel }),
        el('span', { class: 'pill', text: T(a.enabled === false ? 'c.disabled' : 'c.enabled') }),
        a.orphan ? el('span', { class: 'pill removed', text: T('c.unowned') }) : el('span', { class: 'pill', text: a.personName })
      ])
    ]);

    const body = el('div', { class: 'stack' });
    body.appendChild(dl([
      [T('c.system'), a.system],
      [T('c.displayName'), a.displayName],
      [T('c.person'), a.personRaw || T('dr.notLinked')],
      [T('c.employeeId'), a.personId || '—'],
      [T('dr.permsHeld'), String(a.permCount)],
      [T('dr.unmanagedAssign'), String(a.unmanagedPermCount)],
      [T('dr.missingEnt'), String(a.missingCount)],
      [T('dr.monthlyCost'), U.fmtMoney(a.monthlyCost)],
      [T('dr.closestPeer'), a.peerKey ? (m.accounts.get(a.peerKey) ? m.accounts.get(a.peerKey).userName : a.peerKey) + ' · ' + T('dr.overlap', { p: U.fmtPct(a.peerBest || 0, 0) }) : T('dr.noPeer')],
      [T('dr.uniqueEnt'), a.uniquePerms && a.uniquePerms.length ? a.uniquePerms.map(p => p.name).join(', ') : '—']
    ]));

    body.appendChild(card(T('dr.whyScore'), T('dr.componentsSum', { n: a.riskScore }) + (a.riskRaw > a.riskScore ? ' · ' + T('dr.cappedFrom', { n: Math.round(a.riskRaw) }) : ''),
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
      body.appendChild(card(T('dr.entitlements'), T('dr.groupsN', { n: a.perms.length }), HR.table.make({
        columns: [
          { key: 'name', label: T('ct.group') },
          { key: 'categoryLabel', label: T('c.category') },
          { key: 'sensitivity', label: T('c.sensitivity'), num: true, render: r => U.fmtNum(r.sensitivity, 1) },
          { key: 'holderCount', label: T('c.holders'), num: true },
          { key: 'monthlyPrice', label: T('c.unitMo'), num: true, render: r => r.monthlyPrice ? U.fmtMoney(r.monthlyPrice) : '—' },
          { key: 'riskScore', label: T('c.risk'), num: true }
        ], rows: a.perms, pageSize: 15, exportName: 'account-' + a.userName + '-permissions',
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

  function drawerPermission(p, m) {
    m = m || HR.app.state.model;
    const holders = Array.from(p.holders).map(k => m.accounts.get(k)).filter(Boolean);
    const head = el('div', {}, [
      el('h2', { text: p.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'sev ' + p.riskBand, text: T('app.riskShort') + ' ' + p.riskScore }),
        el('span', { class: 'pill', text: p.categoryLabel }),
        p.rare ? el('span', { class: 'pill removed', text: T('c.rare') }) : null,
        p.monthlyPrice ? el('span', { class: 'pill', text: U.fmtMoney(p.monthlyPrice) + '/holder/mo' }) : null
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(dl([
      [T('c.system'), p.system],
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
        { key: 'permCount', label: T('c.perms'), num: true },
        { key: 'riskScore', label: T('c.risk'), num: true, render: r => scoreBar(r.riskScore) }
      ], rows: holders, pageSize: 20, exportName: 'permission-' + p.name + '-holders',
      initialSort: { key: 'riskScore', dir: -1 },
      search: (r, q) => (r.userName + ' ' + r.personRaw).toLowerCase().includes(q),
      onRowClick: a => drawerAccount(a)
    })));
    openDrawer(head, body);
  }

  function drawerPerson(per, m) {
    const head = el('div', {}, [
      el('h2', { text: per.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: per.externalId || T('dr.noId') }),
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
    review: reviewView,
    rules: rulesView,
    explain: explainView,
    activity: activityView,
    overview, risk: riskView, cost: costView, accounts: accountsView,
    permissions: permissionsView, people: peopleView, diff: diffView,
    snapshots: snapshotsView, settings: settingsView, sources: sourcesView, products: productsView,
    org: orgView, pyramid: pyramidView,
    openDrawer, closeDrawer, drawerAccount, drawerPermission, drawerPerson, drawerProduct, card, tile
  };
})(window.HR);
