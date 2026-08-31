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
    HR.app.render();
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
          ? el('span', { class: 'pill ' + (row.pass ? 'ok' : 'removed'),
              text: row.pass ? T('po.met') : T('po.notMet') })
          : el('span', { class: 'pill muted', text: T('po.off') }),
        el('strong', { text: T('po.p.' + id) }),
        el('span', { class: 'mono', text: fmtVal(row) }),
        el('span', { class: 'note', text: fmtLimit(row) })
      );
    }

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

    const lines = [head, el('p', { class: 'note', style: 'margin:2px 0 0',
      text: T('po.p.' + id + '.d') })];
    if (row.applicable && row.on && !row.pass) {
      lines.push(el('p', { class: 'note', style: 'margin:2px 0 0' }, [
        el('span', { class: 'sev medium', text: T('po.improve') }),
        document.createTextNode(' ' + T('po.p.' + id + '.fix'))
      ]));
    }
    return el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' }, lines);
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
        T('po.kScoreFoot', { passed: s.passed, n: s.evaluated }),
        { severity: score >= 1 ? 'good' : score >= 0.7 ? 'medium' : 'high' }),
      tile(T('po.kMet'), U.fmtInt(s.passed), T('po.kMetFoot'), { severity: 'good', small: true }),
      tile(T('po.kNotMet'), U.fmtInt(s.failed), T('po.kNotMetFoot'),
        { severity: s.failed ? 'high' : 'good', small: true }),
      tile(T('po.kWaiting'), U.fmtInt(ev.rows.filter(r => !r.applicable).length),
        T('po.kWaitingFoot'), { small: true })
    ]));

    f.appendChild(card(T('po.cardTitle'), T('po.cardNote'),
      el('div', {}, ev.rows.map(row => policyLine(m, row)))));
    f.appendChild(el('p', { class: 'note', style: 'margin-top:10px', text: T('po.foot') }));
    return f;
  }

  HR.views.policies = policiesView;
})(window.HR);
