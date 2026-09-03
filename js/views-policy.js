/* The Policies view: the organisation's quality guidelines as adjustable
   thresholds, the score they produce, and per guideline the people and
   accounts behind the number. The engine lives in js/policy.js; this file
   only renders it and writes threshold changes back to the settings. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, openDrawer, drawerAccount, drawerPermission, drawerVaultPerson,
    personRow, partialNotice } = HR.viewkit;

  const fmtVal = r => r.def.unit === 'pct' ? U.fmtNum(r.value, 1) + '%' : U.fmtInt(r.value);
  const fmtLimit = r => (r.def.dir === 'max' ? '≤ ' : '≥ ') +
    (r.def.unit === 'pct' ? U.fmtNum(r.threshold, 1) + '%' : U.fmtInt(r.threshold));

  function openAffected(m, row) {
    const label = x => x.kind === 'account' ? x.a.userName
      : x.kind === 'perm' ? x.perm.name : (x.person.displayName || x.person.externalId);
    const sub = x => x.kind === 'account' ? (x.a.personName || T('c.unowned'))
      : x.kind === 'perm' ? x.perm.system : T('c.person');
    openDrawer(el('div', {}, [
      el('div', { text: T('po.p.' + row.def.id) }),
      el('span', { class: 'note', text: T('po.affectedHead', { n: row.affected.length }) })
    ]), el('div', { class: 'stack' }, HR.table.make({
      columns: [
        { key: 'label', label: T('po.cWho'), value: label },
        { key: 'sub', label: T('po.cContext'), value: sub }
      ],
      rows: row.affected, pageSize: 15, exportName: 'policy-' + row.def.id,
      search: (x, q) => (label(x) + ' ' + sub(x)).toLowerCase().includes(q),
      onRowClick: x => {
        if (x.kind === 'account') drawerAccount(x.a);
        else if (x.kind === 'perm') drawerPermission(x.perm, m);
        else drawerVaultPerson(personRow(m, x.person), m);
      }
    })));
  }

  function change(m, id, patch) {
    HR.policy.set(id, patch);
    delete m._policy;
    /* The summary carries the score into snapshots and deltas; keep it current. */
    try { Object.assign(m.summary, HR.policy.summaryOf(m)); } catch (e) { /* not scoreable yet */ }
    HR.app.render();
  }

  const fwLabel = { nis2: 'NIS2', iso27001: 'ISO 27001', bio: 'BIO' };
  const refPills = (def, onclick) => Object.keys(def.refs || {}).map(fw =>
    el('button', { class: 'pill mono' + (onclick ? ' clickable' : ''), title: T('po.fw.' + fw), text: fwLabel[fw] + ' ' + def.refs[fw], onclick }));

  /* "Show framework references" is a reading preference, kept per browser. */
  const SHOW_REFS = 'policy.showRefs';
  const showRefs = () => { try { return localStorage.getItem(SHOW_REFS) === '1'; } catch (e) { return false; } };
  const setShowRefs = on => { try { localStorage.setItem(SHOW_REFS, on ? '1' : '0'); } catch (e) { /* private window */ } };

  /** What the articles ask and how this control evidences them. */
  function refsBlock(def) {
    const ev = HR.frameworks.evidenceOf(def);
    return el('div', { class: 'ctl-fwtext' }, [
      ev ? el('p', {}, [el('strong', { text: T('po.fwEvidence') + ' ' }), document.createTextNode(ev)]) : null
    ].concat(HR.frameworks.refsOf(def).map(r => el('div', { class: 'fw-ref' }, [
      el('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, [
        el('span', { class: 'mono', text: r.label + ' ' + r.ref }),
        el('strong', { text: r.title }),
        el('span', { class: 'fw-tag', text: T(r.official ? 'po.fwOfficial' : 'po.fwDescribed') }),
        r.source ? el('a', { href: r.source, target: '_blank', rel: 'noopener noreferrer', class: 'note', text: T('po.fwSource') }) : null
      ].filter(Boolean)),
      el('p', { class: 'fw-about', text: r.about })
    ]))).filter(Boolean));
  }

  /* Accepting a failing control as a known risk: until when, by whom, why. */
  function exceptionForm(m, row) {
    const ex = row.exception || {};
    const until = el('input', { type: 'date', value: ex.until || '' });
    const by = el('input', { type: 'text', value: ex.by || '', placeholder: T('po.exBy') });
    const why = el('input', { type: 'text', value: ex.why || '', placeholder: T('po.exWhy') });
    why.style.minWidth = '260px';
    const save = el('button', { class: 'btn sm primary', text: T('c.save'), onclick: () => {
      if (!until.value) return;
      change(m, row.def.id, { exception: { until: until.value, by: by.value.trim(), why: why.value.trim() } });
    } });
    const clear = el('button', { class: 'btn sm ghost', text: T('po.exClear'),
      onclick: () => change(m, row.def.id, { exception: null }) });
    return el('div', { class: 'slot-actions', style: 'margin-top:6px' }, [
      el('span', { class: 'note', text: T('po.exTitle') }),
      el('label', { class: 'inline' }, [document.createTextNode(T('po.exUntil')), until]),
      by, why, save, row.exception ? clear : null
    ].filter(Boolean));
  }

  /* One control, three columns: what it is and why; where we stand against the limit;
     who owns it and by when. Editing (limit, switch, owner, due, exception) folds
     behind one link so the page reads as a scorecard, not a form. */
  function policyLine(m, row) {
    const id = row.def.id;
    const wrap = el('div', { class: 'ctl' + (row.applicable && row.on && row.status === 'notMet' ? ' open' : '') });

    /* --- column 1: what --- */
    const status = !row.applicable
      ? el('span', { class: 'pill muted', text: T('po.needs') })
      : !row.on ? el('span', { class: 'pill muted', text: T('po.off') })
      : el('span', { class: 'pill ' + (row.status === 'met' ? 'ok' : row.status === 'accepted' ? 'warn' : 'removed'),
          text: T('po.status.' + row.status) });
    const what = el('div', { class: 'ctl-what' }, [
      el('div', { class: 'row', style: 'gap:8px;align-items:center' }, [
        status,
        el('span', { class: 'sev ' + (row.def.severity || 'medium'), title: T('po.sev.' + (row.def.severity || 'medium')) }),
        el('strong', { text: T('po.p.' + id) })
      ]),
      el('p', { class: 'note ctl-desc', text: T('po.p.' + id + '.d') }),
      el('div', { class: 'ctl-refs' }, refPills(row.def, () => { block.hidden = !block.hidden; }))
    ]);
    const block = refsBlock(row.def);
    block.hidden = !showRefs();
    what.appendChild(block);
    if (!row.applicable) {
      what.appendChild(el('p', { class: 'note', text: T('po.needsNote', { list: row.missing.map(n => T('po.need.' + n)).join(', ') }) }));
    }
    if (row.applicable && row.on && row.status === 'notMet') {
      what.appendChild(el('p', { class: 'note ctl-fix' }, [
        el('span', { class: 'sev medium', text: T('po.improve') }),
        document.createTextNode(' ' + T('po.p.' + id + '.fix'))
      ]));
    }
    if (row.applicable && row.status === 'accepted') {
      what.appendChild(el('p', { class: 'note ctl-fix', text: T('po.exAccepted', {
        until: row.exception.until, by: row.exception.by || '—', why: row.exception.why || '—' }) }));
    }

    /* --- column 2: now vs limit --- */
    const stand = el('div', { class: 'ctl-stand' });
    if (row.applicable) {
      const pct = row.def.unit === 'pct';
      stand.appendChild(el('div', { class: 'ctl-now mono', text: fmtVal(row) }));
      stand.appendChild(el('div', { class: 'note', text: T('po.limitIs', { limit: fmtLimit(row) }) }));
      if (pct) {
        const cap = Math.max(row.threshold, row.value, 1);
        stand.appendChild(el('div', { class: 'ctl-gauge' }, [
          el('i', { class: row.met ? 'ok' : 'bad', style: 'width:' + Math.min(100, 100 * row.value / cap) + '%' }),
          el('b', { style: 'left:' + Math.min(100, 100 * row.threshold / cap) + '%', title: fmtLimit(row) })
        ]));
      }
      if (row.affected.length) {
        stand.appendChild(el('a', { href: '#', class: 'ctl-affected', text: T('po.affectedN', { n: U.fmtInt(row.affected.length) }),
          onclick: e => { e.preventDefault(); openAffected(m, row); } }));
      }
    }

    /* --- column 3: who, by when, and the fold --- */
    const who = el('div', { class: 'ctl-who' });
    who.appendChild(el('div', { class: 'ctl-kv' }, [
      el('span', { class: 'note', text: T('po.owner') }),
      el('span', { text: row.owner || '—' })
    ]));
    who.appendChild(el('div', { class: 'ctl-kv' }, [
      el('span', { class: 'note', text: T('po.due') }),
      el('span', { text: row.due || '—' })
    ]));
    if (row.def.finding) {
      who.appendChild(el('a', { href: '#', class: 'note', text: T('po.seeFinding'),
        onclick: e => { e.preventDefault(); HR.app.go('risk', { tab: 'findings' }); } }));
    }
    const editor = el('div', { class: 'ctl-edit', hidden: true });
    const editLink = el('a', { href: '#', class: 'note', text: T('po.edit') + ' ▾', onclick: e => {
      e.preventDefault(); editor.hidden = !editor.hidden;
      editLink.textContent = T('po.edit') + (editor.hidden ? ' ▾' : ' ▴');
    } });
    who.appendChild(editLink);
    wrap.append(what, stand, who);

    /* --- the fold: limit, switch, owner, due, exception, log --- */
    const tIn = el('input', { type: 'number', min: 0, step: row.def.unit === 'pct' ? 0.5 : 1, value: row.threshold });
    tIn.style.width = '72px';
    tIn.onchange = () => change(m, id, { t: Math.max(0, +tIn.value || 0) });
    const controls = el('div', { class: 'slot-actions' }, [
      el('label', { class: 'inline' }, [document.createTextNode(T('po.limitLabel')), tIn,
        document.createTextNode(row.def.unit === 'pct' ? '%' : '')])
    ]);
    if (row.def.paramDef !== undefined) {
      const pIn = el('input', { type: 'number', min: 1, step: 1, value: row.param });
      pIn.style.width = '64px';
      pIn.onchange = () => change(m, id, { p: Math.max(1, Math.round(+pIn.value || 1)) });
      controls.appendChild(el('label', { class: 'inline' }, [document.createTextNode(T('po.paramLabel.' + id)), pIn]));
    }
    const onIn = el('input', { type: 'checkbox' });
    onIn.checked = row.on;
    onIn.onchange = () => change(m, id, { on: onIn.checked });
    controls.appendChild(el('label', { class: 'inline' }, [onIn, document.createTextNode(T('po.countLabel'))]));
    const owner = el('input', { type: 'text', value: row.owner || '', placeholder: T('po.owner') });
    owner.style.width = '150px';
    owner.onchange = () => change(m, id, { owner: owner.value.trim() });
    const due = el('input', { type: 'date', value: row.due || '' });
    due.onchange = () => change(m, id, { due: due.value });
    controls.append(
      el('label', { class: 'inline' }, [document.createTextNode(T('po.owner')), owner]),
      el('label', { class: 'inline' }, [document.createTextNode(T('po.due')), due])
    );
    editor.appendChild(controls);
    if (row.applicable && (row.status === 'notMet' || row.status === 'accepted')) editor.appendChild(exceptionForm(m, row));
    if (row.changes && row.changes.length) {
      const last = row.changes[row.changes.length - 1];
      editor.appendChild(el('p', { class: 'note', style: 'margin:4px 0 0', title: row.changes.slice(-5).map(c =>
        c.at.slice(0, 10) + ' ' + c.field + ': ' + JSON.stringify(c.from) + ' → ' + JSON.stringify(c.to)).join('\n'),
        text: T('po.lastChange', { at: last.at.slice(0, 10), field: last.field }) }));
    }
    wrap.appendChild(editor);
    return wrap;
  }

  /** The whole scorecard as one file: what an audit takes away. */
  function scorecardRows(ev) {
    return ev.rows.map(r => ({
      id: r.def.id, control: T('po.p.' + r.def.id), severity: r.severity || r.def.severity || '',
      nis2: (r.def.refs || {}).nis2 || '', iso27001: (r.def.refs || {}).iso27001 || '', bio: (r.def.refs || {}).bio || '',
      refTitles: HR.frameworks.refsOf(r.def).map(x => x.label + ' ' + x.ref + ' ' + x.title).join('; '),
      evidence: HR.frameworks.evidenceOf(r.def),
      value: r.applicable ? (r.def.unit === 'pct' ? U.fmtNum(r.value, 1) + '%' : U.fmtInt(r.value)) : '',
      limit: fmtLimit(r), status: r.applicable ? (r.on ? r.status : 'off') : 'waiting',
      owner: r.owner || '', due: r.due || '',
      exceptionUntil: r.exception ? r.exception.until : '', exceptionBy: r.exception ? r.exception.by : '', exceptionWhy: r.exception ? r.exception.why : '',
      affected: r.applicable ? r.affected.length : ''
    }));
  }

  function policiesView(m) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('po.title') }),
      el('p', { text: T('po.lead') })
    ])));

    if (!m || !m.summary) {
      const note = partialNotice(['recon']);
      if (note) f.appendChild(note);
      f.appendChild(card(null, null, el('p', { text: T('po.empty') })));
      return f;
    }

    const ev = HR.policy.evaluate(m);
    const s = ev.summary;
    const score = s.score;
    f.appendChild(el('div', { class: 'grid g4', style: 'margin-bottom:14px' }, [
      tile(T('po.kScore'), U.fmtPct(score, 0),
        T('po.kScoreFoot', { passed: s.passed, n: s.evaluated }) + ' \u00b7 ' + T('po.kScoreWeighted'),
        { severity: score >= 1 ? 'good' : score >= 0.7 ? 'medium' : 'high', delta: HR.app.state.diff && HR.app.state.diff.summary.policyScore
          ? { change: Math.round(100 * HR.app.state.diff.summary.policyScore.change) } : undefined, deltaFormat: v => v + 'pp' }),
      tile(T('po.kCritical'), U.fmtInt(s.criticalOpen),
        s.worstOpen ? T('po.kCriticalFoot', { control: T('po.p.' + s.worstOpen.def.id) }) : T('po.kCriticalNone'),
        { severity: s.criticalOpen ? 'critical' : 'good', small: true }),
      tile(T('po.kAccepted'), U.fmtInt(s.accepted),
        s.nextExpiry ? T('po.kAcceptedFoot', { until: s.nextExpiry }) : T('po.kAcceptedNone'),
        { severity: s.accepted ? 'medium' : 'good', small: true }),
      tile(T('po.kWaiting'), U.fmtInt(ev.rows.filter(r => !r.applicable).length),
        T('po.kWaitingFoot'), { small: true })
    ]));

    /* Which framework's articles to show — a control with no article for it hides. */
    const fw = (HR.app.state.params && HR.app.state.params.fw) || '';
    const chips = el('div', { class: 'slot-actions', style: 'margin-bottom:8px' },
      [['', T('c.all')]].concat(HR.policy.FRAMEWORKS.map(k => [k, fwLabel[k]])).map(([k, label]) =>
        el('button', { class: 'btn sm' + (fw === k ? ' primary' : ''), text: label,
          onclick: () => HR.app.go('policies', { fw: k }) })));
    chips.appendChild(el('button', { class: 'btn sm' + (showRefs() ? ' primary' : ''), text: T(showRefs() ? 'po.hideRefs' : 'po.showRefs'),
      onclick: () => { setShowRefs(!showRefs()); HR.app.render(); } }));
    chips.appendChild(el('span', { class: 'spacer' }));
    chips.appendChild(el('button', { class: 'btn sm', text: T('po.exportScorecard'), onclick: () => {
      U.download('compliance-scorecard.csv', U.toCSV(scorecardRows(ev)), 'text/csv;charset=utf-8');
      HR.usage.exported('compliance-scorecard');
    } }));
    chips.appendChild(el('button', { class: 'btn sm ghost', text: 'JSON', onclick: () => {
      U.download('compliance-scorecard.json', JSON.stringify({ generatedAt: new Date().toISOString(),
        score: s.score, passed: s.passed, evaluated: s.evaluated, bySeverity: s.bySeverity, rows: scorecardRows(ev) }, null, 2), 'application/json');
      HR.usage.exported('compliance-scorecard-json');
    } }));

    /* Critical first, then the rest; inside a group, failing before passing. */
    const shown = ev.rows.filter(r => !fw || (r.def.refs && r.def.refs[fw]));
    const groups = HR.policy.SEVERITIES.map(sev => ({ sev, rows: shown.filter(r => (r.def.severity || 'medium') === sev)
      .sort((a, b) => (a.status === 'notMet' ? 0 : 1) - (b.status === 'notMet' ? 0 : 1)) })).filter(g => g.rows.length);
    f.appendChild(card(T('po.cardTitle'), T('po.cardNote'), [chips].concat(groups.map(g => el('div', {}, [
      el('h3', { style: 'margin:14px 0 4px' }, [el('span', { class: 'sev ' + g.sev, text: T('po.sev.' + g.sev) }),
        document.createTextNode(' ' + T('po.groupFoot', { n: U.fmtInt(g.rows.length), open: U.fmtInt(g.rows.filter(r => r.applicable && r.on && r.status === 'notMet').length) }))]),
      el('div', {}, g.rows.map(row => policyLine(m, row)))
    ])))));
    f.appendChild(el('p', { class: 'note', style: 'margin-top:10px', text: T('po.foot') }));
    return f;
  }

  HR.views.policies = policiesView;
  HR.views.policyShowRefs = showRefs;
})(window.HR);
