/* Board report: the same analysis, written for people who do not run the IAM system.
   Renders as A4 pages and prints straight to PDF. No jargon, no score without a sentence
   explaining what it means, every number tied to a decision. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, C = HR.charts;
  const T = (k, p) => HR.i18n.t(k, p);

  /* --------------------------------------------------------------- content */

  /** Business-language themes, each derived from the technical findings. */
  function themes(m) {
    const s = m.summary, c = m.cost, F = id => m.findings.find(f => f.id === id);
    const cnt = id => (F(id) || {}).count || 0;
    const accounts = n => n + ' ' + T('bd.accountsWord');

    const orphanEnabled = s.orphanEnabled;
    const privOrphan = cnt('privileged-orphan');
    const disabledLicensed = cnt('disabled-licensed');
    const stacked = cnt('stacked-licences');
    const gapRule = F('security-control-gap');
    const overEnt = cnt('over-entitled');
    const external = cnt('external-accounts');

    return [
      { id: 'ownership', name: T('bd.th.ownership'), meaning: T('bd.th.ownership.m'),
        status: orphanEnabled > 20 ? 'bad' : orphanEnabled ? 'watch' : 'good',
        scale: accounts(orphanEnabled) },
      { id: 'privileged', name: T('bd.th.privileged'), meaning: T('bd.th.privileged.m'),
        status: privOrphan ? 'bad' : 'good', scale: accounts(privOrphan) },
      { id: 'leavers', name: T('bd.th.leavers'), meaning: T('bd.th.leavers.m'),
        status: disabledLicensed > 10 ? 'bad' : disabledLicensed ? 'watch' : 'good',
        scale: accounts(disabledLicensed) + ' · ' + U.fmtMoney(c.disabledWaste) + ' ' + T('bd.perMonth') },
      { id: 'doublelic', name: T('bd.th.doublelic'), meaning: T('bd.th.doublelic.m'),
        status: stacked > 10 ? 'bad' : stacked ? 'watch' : 'good',
        scale: accounts(stacked) + ' · ' + U.fmtMoney(c.stackedWasteNet) + ' ' + T('bd.perMonth') },
      { id: 'rules', name: T('bd.th.rules'), meaning: T('bd.th.rules.m'),
        status: s.unmanagedPermissionRows > 500 ? 'bad' : s.unmanagedPermissionRows ? 'watch' : 'good',
        scale: T('bd.th.rules.scale', { n: U.fmtInt(s.unmanagedPermissionRows) }) },
      { id: 'baseline', name: T('bd.th.baseline'), meaning: T('bd.th.baseline.m'),
        status: gapRule ? 'bad' : 'good',
        scale: gapRule ? T('bd.th.baseline.scale', { n: gapRule.entities.length }) : T('bd.th.baseline.ok') },
      { id: 'accumulation', name: T('bd.th.accumulation'), meaning: T('bd.th.accumulation.m'),
        status: overEnt ? 'watch' : 'good', scale: accounts(overEnt) },
      { id: 'external', name: T('bd.th.external'), meaning: T('bd.th.external.m'),
        status: external ? 'watch' : 'good', scale: accounts(external) }
    ].concat(ruleTheme(m));
  }

  /* Only when a business-rule export was loaded alongside the reconciliation one. */
  function ruleTheme(m) {
    const c = m.comparison;
    if (!c) return [];
    const s = c.summary;
    return [{
      id: 'rules',
      name: T('bd.th.rules2'),
      meaning: T('bd.th.rules2.m'),
      status: s.coverage > 0.75 ? 'good' : s.coverage > 0.4 ? 'watch' : 'bad',
      scale: T('bd.th.rules2.scale', {
        pct: U.fmtPct(s.coverage, 0), live: s.live, rules: s.rules
      })
    }];
  }

  /** Recommendations, ordered by urgency then by money returned. */
  function actions(m) {
    const F = id => m.findings.find(f => f.id === id);
    const eff = HR.config.get().effort;
    const out = [];
    const add = (when, key, hours, saving, severity) => {
      if (!when) return;
      out.push({ title: T('bd.ac.' + key), why: T('bd.ac.' + key + '.why'), hours, saving, severity });
    };

    const disabled = F('disabled-licensed');
    add(disabled, 'leavers', disabled ? disabled.count * eff.minutesPerUnmanagedAccount / 60 : 0,
      disabled ? disabled.annualImpact : 0, 'high');

    const priv = F('privileged-orphan');
    add(priv, 'priv', priv ? priv.count * eff.minutesPerPrivilegedReview / 60 : 0, 0, 'critical');

    const stacked = F('stacked-licences');
    add(stacked, 'stacked', stacked ? stacked.count * 0.25 : 0, stacked ? stacked.annualImpact : 0, 'high');

    const gap = F('security-control-gap');
    add(gap, 'baseline', gap ? gap.entities.length * 2 : 0, 0, 'high');

    const orph = F('enabled-orphan');
    add(orph, 'orphans', orph ? orph.count * eff.minutesPerUnmanagedAccount / 60 : 0, 0, 'high');

    add(m.summary.unmanagedPermissionRows > 0, 'rules',
      m.summary.unmanagedPermissionRows * eff.minutesPerUnmanagedPermission / 60, 0, 'medium');

    const over = F('over-entitled');
    add(over, 'overent', over ? over.count * 0.5 : 0, 0, 'medium');

    const c = m.comparison;
    if (c && c.summary.unmanagedUnmodelled > 0) {
      const eff = HR.config.get().effort;
      out.push({
        title: T('bd.ac.model'),
        why: T('bd.ac.model.why', { share: U.fmtPct(c.summary.modelShare, 0) }),
        hours: c.summary.unmodelledPermissions * (eff.minutesPerUnmanagedPermission / 60),
        saving: 0,
        severity: 'high'
      });
    }

    out.forEach(a => { a.cost = a.hours * eff.hourlyRate; });
    return out.sort((a, b) => U.severityRank(a.severity) - U.severityRank(b.severity) || b.saving - a.saving);
  }

  function verdict(m) {
    const score = m.summary.riskScore;
    const band = score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 20 ? 'medium' : 'low';
    return T('bd.verdict.' + band);
  }

  /* --------------------------------------------------------------- render */

  /* Every sheet ends with the brand footer when one is set: a printed pack
     gets split, and a single forwarded page should still carry the line. */
  const page = (children, cls) => el('section', { class: 'sheet ' + (cls || '') },
    (HR.demo.isOn() ? [demoStrip()] : []).concat(children)
      .concat(HR.brand.state.footerText
        ? [el('div', { class: 'brand-foot', text: HR.brand.state.footerText })] : []));

  /* On every page rather than the cover alone: a board pack gets split, and a single
     forwarded page must still say the figures on it describe nobody. */
  const demoStrip = () => el('div', { class: 'demo-strip' }, [
    el('strong', { text: T('demo.badge') }),
    el('span', { text: T('demo.printNote', { date: (HR.app.state.demo || {}).generatedOn || '\u2014' }) })
  ]);

  function statusPill(status) {
    const label = T(status === 'good' ? 'bd.good' : status === 'watch' ? 'bd.watch' : 'bd.bad');
    const sev = status === 'good' ? 'good' : status === 'watch' ? 'medium' : 'critical';
    return el('span', { class: 'sev ' + sev, text: label });
  }

  function bigNumber(value, label, sub, tone) {
    return el('div', { class: 'bignum' + (tone ? ' tone-' + tone : '') }, [
      el('div', { class: 'bn-value', text: value }),
      el('div', { class: 'bn-label', text: label }),
      sub ? el('div', { class: 'bn-sub', text: sub }) : null
    ]);
  }

  function view(m) {
    const f = document.createDocumentFragment();
    const B = HR.brand.state;

    /* --- controls (never printed) --- */
    const controls = el('div', { class: 'board-controls' });
    const field = (labelKey, key, phKey) => {
      const i = el('input', {
        type: 'text', value: (key === 'date' ? HR.brand.reportDate() : B[key]) || '',
        placeholder: phKey ? T(phKey) : '',
        oninput: e => { HR.brand.set({ [key]: e.target.value }); paint(); }
      });
      i.style.minWidth = '170px';
      return el('label', { class: 'inline' }, [document.createTextNode(T(labelKey)), i]);
    };
    controls.append(
      field('bd.org', 'org', 'bd.orgPh'),
      field('bd.prepared', 'preparedBy', 'bd.preparedPh'),
      field('bd.date', 'date'),
      field('bd.contact', 'contact', 'bd.contactPh'),
      field('bd.footer', 'footerText', 'bd.footerPh'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn primary', text: T('bd.exportPdf'), onclick: () => { HR.usage.exported('pdf-print'); window.print(); } }),
      el('span', { class: 'note', text: T('bd.printHint') })
    );
    f.appendChild(controls);

    const paper = el('div', { class: 'paper' });
    f.appendChild(paper);

    function paint() {
      const s = m.summary, c = m.cost, st = HR.app.state;
      paper.innerHTML = '';

      /* ============ page 1 — cover + one-page summary ============ */
      const logo = el('span', { class: 'cover-chip' }, HR.brand.mark('logoLight', 'cover-mark'));
      paper.appendChild(page([
        el('div', { class: 'cover-head' }, [
          logo,
          el('div', {}, [
            el('h1', { class: 'cover-title', text: T('bd.title') }),
            el('div', { class: 'cover-sub', text: T('bd.subtitle') })
          ])
        ]),
        el('dl', { class: 'cover-meta' }, [
          el('dt', { text: T('bd.org') }), el('dd', { text: B.org || '—' }),
          el('dt', { text: T('bd.date') }), el('dd', { text: HR.brand.reportDate() }),
          el('dt', { text: T('bd.prepared') }), el('dd', { text: B.preparedBy || '—' }),
          B.contact ? el('dt', { text: T('bd.contact') }) : null,
          B.contact ? el('dd', { text: B.contact }) : null,
          el('dt', { text: T('bd.source') }), el('dd', {
            text: ((st.snapshots.find(x => x.id === st.currentSnapshotId) || {}).name || '—') +
              ' · ' + T('bd.records', { n: U.fmtInt(s.rows) }) + ' · ' + m.systemList.map(x => x.name).join(', ')
          })
        ]),
        el('div', { class: 'verdict tone-' + (s.riskScore >= 70 ? 'bad' : s.riskScore >= 45 ? 'watch' : 'good') }, [
          el('div', { class: 'verdict-label', text: T('bd.verdictLabel') }),
          el('div', { class: 'verdict-score' }, [
            el('span', { class: 'vs-num', text: String(s.riskScore) }),
            el('span', { class: 'vs-den', text: '/100' })
          ]),
          el('p', { class: 'verdict-text', text: verdict(m) })
        ]),
        el('h2', { class: 'sheet-h', text: T('bd.execSummary') }),
        el('div', { class: 'bignums' }, [
          bigNumber(U.fmtInt(s.accounts), T('bd.kpiAccounts'), T('bd.kpiAccountsSub', { n: U.fmtInt(s.persons) })),
          bigNumber(U.fmtPct(s.coverage, 0), T('bd.kpiOwner'), T('bd.kpiOwnerSub', { n: s.orphanAccounts }),
            s.coverage > 0.9 ? 'good' : s.coverage > 0.7 ? 'watch' : 'bad'),
          bigNumber(U.fmtMoney(c.totalAnnual, { compact: true }), T('bd.kpiCost'),
            U.fmtMoney(c.totalMonthly) + ' ' + T('bd.perMonth')),
          bigNumber(U.fmtMoney(c.wasteAnnual, { compact: true }), T('bd.kpiRecoverable'),
            T('bd.kpiRecoverableSub'), c.wasteAnnual > 0 ? 'watch' : 'good')
        ]),
        el('p', { class: 'lead', text: T('bd.lead') })
      ], 'cover'));

      /* ============ page 2 — findings table ============ */
      const tbl = el('table', { class: 'board-tbl' });
      tbl.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: T('bd.theme') }), el('th', { text: T('c.status') }),
        el('th', { text: T('bd.scale') }), el('th', { text: T('bd.meaning') })
      ])));
      const tb = el('tbody');
      themes(m).forEach(x => tb.appendChild(el('tr', {}, [
        el('td', {}, el('strong', { text: x.name })),
        el('td', {}, statusPill(x.status)),
        el('td', { class: 'nowrap', text: x.scale }),
        el('td', { text: x.meaning })
      ])));
      tbl.appendChild(tb);
      paper.appendChild(page([
        el('h2', { class: 'sheet-h', text: T('bd.secFindings') }),
        tbl,
        el('p', { class: 'footnote', text: T('bd.findingsFoot') })
      ]));

      /* ============ page 3 — money ============ */
      const buckets = [
        { label: T('bd.leakDisabled'), value: c.disabledWaste, color: C.STATUS.critical },
        { label: T('bd.leakDouble'), value: c.stackedWasteNet, color: C.STATUS.serious },
        { label: T('bd.leakUnowned'), value: c.orphanExposure, color: C.STATUS.warning }
      ];
      paper.appendChild(page([
        el('h2', { class: 'sheet-h', text: T('bd.secMoney') }),
        el('div', { class: 'bignums three' }, [
          bigNumber(U.fmtMoney(c.totalAnnual, { compact: true }), T('bd.moneyCurrent'), T('bd.perYear')),
          bigNumber(U.fmtMoney(c.wasteAnnual, { compact: true }), T('bd.moneyRecoverable'), T('bd.perYear'), 'watch'),
          bigNumber(U.fmtMoney(c.remediationCost, { compact: true }), T('bd.moneyCleanup'),
            U.fmtNum(c.remediation.hours, 0) + ' ' + T('bd.hours'))
        ]),
        el('p', { class: 'lead', text: T('bd.moneyLead') +
          (c.paybackMonths ? ' ' + T('bd.moneyPayback', { n: U.fmtNum(c.paybackMonths, 1) }) : '') }),
        el('h3', { class: 'sheet-h3', text: T('bd.moneyLeaks') }),
        C.barList(buckets, { format: v => U.fmtMoney(v) + ' ' + T('bd.perMonth'), valueLabel: T('bd.perMonth') }),
        el('p', { class: 'footnote', text: T('bd.moneyFoot') })
      ]));

      /* ============ page 4 — change since baseline ============ */
      const d = st.diff;
      const changeChildren = [el('h2', { class: 'sheet-h', text: T('bd.secChange') })];
      if (!d) {
        changeChildren.push(el('p', { class: 'lead', text: T('bd.noBaseline') }));
      } else {
        const rows = [
          [T('bd.mOverall'), d.summary.riskScore, v => String(Math.round(v))],
          [T('bd.mUnowned'), d.summary.orphanAccounts, U.fmtInt],
          [T('bd.mGrants'), d.summary.unmanagedPermissionRows, U.fmtInt],
          [T('bd.mCostMo'), d.summary.monthlyCost, U.fmtMoney],
          [T('bd.mRecoverableMo'), d.summary.wasteMonthly, U.fmtMoney]
        ];
        const t2 = el('table', { class: 'board-tbl' });
        t2.appendChild(el('thead', {}, el('tr', {}, [
          el('th', { text: T('bd.measure') }),
          el('th', { class: 'num', text: T('bd.prevReview') }),
          el('th', { class: 'num', text: T('bd.nowCol') }),
          el('th', { class: 'num', text: T('bd.changeCol') })
        ])));
        const tb2 = el('tbody');
        rows.forEach(([label, delta, fmt]) => {
          const better = delta.change < 0;
          tb2.appendChild(el('tr', {}, [
            el('td', { text: label }),
            el('td', { class: 'num', text: fmt(delta.was) }),
            el('td', { class: 'num', text: fmt(delta.now) }),
            el('td', {
              class: 'num ' + (delta.change === 0 ? '' : better ? 'tone-good' : 'tone-bad'),
              text: delta.change === 0 ? '—' : (delta.change > 0 ? '+' : '−') + fmt(Math.abs(delta.change))
            })
          ]));
        });
        t2.appendChild(tb2);
        changeChildren.push(
          el('p', { class: 'lead', text: T('bd.changeLead', { name: st.baselineSnapshot.name, date: U.fmtDate(st.baselineSnapshot.importedAt) }) }),
          t2,
          el('p', { class: 'footnote', text: T('bd.changeFoot') })
        );

        /* With more than two imports there is a direction, not just a difference, and
           the direction is the sentence a board actually remembers. */
        const history = st.snapshots.slice().sort((a, b) => a.importedAt - b.importedAt);
        if (history.length >= 3) {
          const first = history[0], latest = history[history.length - 1];
          const driftThen = first.summary.unmanagedPermissionRows || 0;
          const driftNow = latest.summary.unmanagedPermissionRows || 0;
          const pct = driftThen ? Math.round((driftNow - driftThen) / driftThen * 100) : 0;
          changeChildren.push(el('p', { class: 'lead', text: T('bd.trendLine', {
            n: history.length,
            since: U.fmtDate(first.importedAt).split(',')[0],
            drift: (pct > 0 ? '+' : '') + pct + '%',
            risk: first.summary.riskScore + ' \u2192 ' + latest.summary.riskScore,
            spend: U.fmtMoney(first.summary.monthlyCost || 0) + ' \u2192 ' + U.fmtMoney(latest.summary.monthlyCost || 0)
          }) }));
        }
      }
      paper.appendChild(page(changeChildren));

      /* ============ page 5 — recommendations ============ */
      /* ============ policy guidelines ============ */
      const pol = HR.policy.evaluate(m);
      if (pol.summary.evaluated) {
        const ps = pol.summary;
        const pt = el('table', { class: 'board-tbl' });
        pt.appendChild(el('thead', {}, el('tr', {}, [
          el('th', { text: T('bd.polGuideline') }),
          el('th', { text: T('bd.polActual') }),
          el('th', { text: T('bd.polLimit') }),
          el('th', { text: T('c.status') })
        ])));
        const ptb = el('tbody');
        pol.rows.filter(r => r.applicable && r.on).forEach(r => {
          const pct = r.def.unit === 'pct';
          ptb.appendChild(el('tr', {}, [
            el('td', {}, el('strong', { text: T('po.p.' + r.def.id) })),
            el('td', { class: 'num nowrap', text: pct ? U.fmtNum(r.value, 1) + '%' : U.fmtInt(r.value) }),
            el('td', { class: 'num nowrap', text: (r.def.dir === 'max' ? '≤ ' : '≥ ') +
              (pct ? U.fmtNum(r.threshold, 1) + '%' : U.fmtInt(r.threshold)) }),
            el('td', {}, statusPill(r.pass ? 'good' : 'bad'))
          ]));
        });
        pt.appendChild(ptb);
        paper.appendChild(page([
          el('h2', { class: 'sheet-h', text: T('bd.polTitle') }),
          el('p', { class: 'lead', text: T('bd.polLead', {
            passed: ps.passed, n: ps.evaluated, score: U.fmtPct(ps.score, 0) }) }),
          pt,
          el('p', { class: 'footnote', text: T('bd.polFoot') })
        ]));
      }

      const t3 = el('table', { class: 'board-tbl' });
      t3.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: '#' }), el('th', { text: T('bd.action') }),
        el('th', { class: 'num', text: T('bd.effort') }), el('th', { class: 'num', text: T('bd.saving') }),
        el('th', { text: T('bd.owner') })
      ])));
      const tb3 = el('tbody');
      actions(m).forEach((a, i) => tb3.appendChild(el('tr', {}, [
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', {}, [el('strong', { text: a.title }), el('div', { class: 'why', text: a.why })]),
        el('td', { class: 'num nowrap', text: U.fmtNum(a.hours, 0) + ' ' + T('bd.hours') }),
        el('td', { class: 'num nowrap', text: a.saving ? U.fmtMoney(a.saving) : '—' }),
        el('td', { class: 'owner-cell', text: '' })
      ])));
      t3.appendChild(tb3);
      paper.appendChild(page([
        el('h2', { class: 'sheet-h', text: T('bd.secActions') }),
        el('p', { class: 'lead', text: T('bd.actionsLead') }),
        t3,
        el('p', { class: 'footnote', text: T('bd.actionsFoot', { rate: U.fmtMoney(HR.config.get().effort.hourlyRate) }) })
      ]));

      /* ============ page 6 — method ============ */
      paper.appendChild(page([
        el('h2', { class: 'sheet-h', text: T('bd.secMethod') }),
        el('p', { class: 'lead', text: T('bd.methodLead') }),
        el('ul', { class: 'method' }, [1, 2, 3, 4, 5].map(i => el('li', { text: T('bd.method' + i) }))
          .concat(m.comparison ? [el('li', { text: T('bd.method6') })] : [])),
        el('p', { class: 'footnote', text: T('bd.methodFoot') })
      ]));
    }

    paint();
    return f;
  }

  HR.board = { view };
})(window.HR);
