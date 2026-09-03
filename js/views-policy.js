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
  const refPills = def => Object.keys(def.refs || {}).map(fw =>
    el('span', { class: 'pill mono', title: T('po.fw.' + fw), text: fwLabel[fw] + ' ' + def.refs[fw] }));

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

  function policyLine(m, row) {
    const id = row.def.id;
    const head = el('div', { class: 'row', style: 'gap:10px;align-items:center;flex-wrap:wrap' });

    if (!row.applicable) {
      head.append(
        el('span', { class: 'pill muted', text: T('po.needs') }),
        el('strong', { text: T('po.p.' + id) }),
        el('span', { class: 'note', text: T('po.needsNote', {
          list: row.missing.map(n => T('po.need.' + n)).join(', ') }) })
      );
    } else {
      head.append(
        row.on
          ? el('span', { class: 'pill ' + (row.status === 'met' ? 'ok' : row.status === 'accepted' ? 'warn' : 'removed'),
              text: T('po.status.' + row.status) })
          : el('span', { class: 'pill muted', text: T('po.off') }),
        el('span', { class: 'sev ' + row.severity, text: T('po.sev.' + row.severity) }),
        el('strong', { text: T('po.p.' + id) }),
        el('span', { class: 'mono', text: fmtVal(row) }),
        el('span', { class: 'note', text: fmtLimit(row) })
      );
    }
    refPills(row.def).forEach(p => head.appendChild(p));

    /* threshold input */
    const tIn = el('input', { type: 'number', min: 0, step: row.def.unit === 'pct' ? 0.5 : 1,
      value: row.threshold });
    tIn.style.width = '72px';
    tIn.onchange = () => change(m, id, { t: Math.max(0, +tIn.value || 0) });
    head.appendChild(el('label', { class: 'inline' }, [
      document.createTextNode(T('po.limitLabel')), tIn,
      document.createTextNode(row.def.unit === 'pct' ? '%' : '')
    ]));

    if (row.def.paramDef !== undefined) {
      const pIn = el('input', { type: 'number', min: 1, step: 1, value: row.param });
      pIn.style.width = '64px';
      pIn.onchange = () => change(m, id, { p: Math.max(1, Math.round(+pIn.value || 1)) });
      head.appendChild(el('label', { class: 'inline' }, [
        document.createTextNode(T('po.paramLabel.' + id)), pIn
      ]));
    }

    const onIn = el('input', { type: 'checkbox' });
    onIn.checked = row.on;
    onIn.onchange = () => change(m, id, { on: onIn.checked });
    head.appendChild(el('label', { class: 'inline' }, [onIn,
      document.createTextNode(T('po.countLabel'))]));

    if (row.applicable && row.affected.length) {
      head.appendChild(el('a', { href: '#', text: T('po.affectedN', { n: U.fmtInt(row.affected.length) }),
        onclick: e => { e.preventDefault(); openAffected(m, row); } }));
    }

    /* Who owns the control and by when — the two fields an audit asks for first. */
    const owner = el('input', { type: 'text', value: row.owner || '', placeholder: T('po.owner') });
    owner.style.width = '150px';
    owner.onchange = () => change(m, id, { owner: owner.value.trim() });
    const due = el('input', { type: 'date', value: row.due || '' });
    due.onchange = () => change(m, id, { due: due.value });
    head.append(
      el('label', { class: 'inline' }, [document.createTextNode(T('po.owner')), owner]),
      el('label', { class: 'inline' }, [document.createTextNode(T('po.due')), due])
    );
    if (row.def.finding) {
      head.appendChild(el('a', { href: '#', class: 'note', text: T('po.seeFinding'),
        onclick: e => { e.preventDefault(); HR.app.go('risk', { tab: 'findings' }); } }));
    }

    const lines = [head, el('p', { class: 'note', style: 'margin:2px 0 0',
      text: T('po.p.' + id + '.d') })];
    /* The exception form stays folded until asked for: fourteen open forms is noise. */
    const foldedForm = () => {
      const holder = el('div', {});
      const open = el('a', { href: '#', class: 'note', text: T('po.exOpen'), onclick: e => {
        e.preventDefault(); holder.innerHTML = ''; holder.appendChild(exceptionForm(m, row));
      } });
      holder.appendChild(el('p', { class: 'note', style: 'margin:2px 0 0' }, [open]));
      return holder;
    };
    if (row.applicable && row.on && row.status === 'notMet') {
      lines.push(el('p', { class: 'note', style: 'margin:2px 0 0' }, [
        el('span', { class: 'sev medium', text: T('po.improve') }),
        document.createTextNode(' ' + T('po.p.' + id + '.fix'))
      ]));
      lines.push(foldedForm());
    }
    if (row.applicable && row.status === 'accepted') {
      lines.push(el('p', { class: 'note', style: 'margin:2px 0 0', text: T('po.exAccepted', {
        until: row.exception.until, by: row.exception.by || '\u2014', why: row.exception.why || '\u2014' }) }));
      lines.push(foldedForm());
    }
    if (row.changes && row.changes.length) {
      const last = row.changes[row.changes.length - 1];
      lines.push(el('p', { class: 'note', style: 'margin:2px 0 0', title: row.changes.slice(-5).map(c =>
        c.at.slice(0, 10) + ' ' + c.field + ': ' + JSON.stringify(c.from) + ' \u2192 ' + JSON.stringify(c.to)).join('\n'),
        text: T('po.lastChange', { at: last.at.slice(0, 10), field: last.field }) }));
    }
    return el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' }, lines);
  }

  /** The whole scorecard as one file: what an audit takes away. */
  function scorecardRows(ev) {
    return ev.rows.map(r => ({
      id: r.def.id, control: T('po.p.' + r.def.id), severity: r.severity || r.def.severity || '',
      nis2: (r.def.refs || {}).nis2 || '', iso27001: (r.def.refs || {}).iso27001 || '', bio: (r.def.refs || {}).bio || '',
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
})(window.HR);
