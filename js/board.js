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
      out.push({ title: T('bd.ac.' + key), why: T('bd.ac.' + key + '.why'), hours, saving, severity,
        owner: ACTION_CONTROL[key] ? (HR.policy.settingsFor(ACTION_CONTROL[key]).owner || '') : '' });
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

  /* Every source behind the pack, with the file it came in under and how old it is:
     the auditor's first question is "what was this measured on". */
  function scope(m) {
    const st = HR.app.state;
    const snap = st.snapshots.find(x => x.id === st.currentSnapshotId);
    const rows = [];
    if (snap || st.parsed) rows.push({ kind: T('src.recon'), file: snap ? snap.fileName : (st.parsed ? st.parsed.meta.fileName : '—'),
      loaded: snap ? snap.importedAt : st.importedAt.recon, asOf: null });
    const one = (k, src, asOf) => { if (src) rows.push({ kind: T('src.' + k), file: src.meta.fileName, loaded: st.importedAt[k], asOf: asOf || null }); };
    one('rules', st.ruleSet);
    if (st.vault) {
      /* The vault's horizon: the latest contract start that is not in the future. */
      const today = new Date(); let horizon = null;
      for (const p of st.vault.persons) for (const c of p.contracts || []) {
        if (c.startDate && c.startDate <= today && (!horizon || c.startDate > horizon)) horizon = c.startDate;
      }
      one('vault', st.vault, horizon ? +horizon : null);
    }
    one('directory', st.directory, st.directory && st.directory.meta.collectedAt);
    one('granted', st.granted, st.granted && st.granted.meta.lastChange ? +st.granted.meta.lastChange : null);
    one('history', st.history, st.history && st.history.meta.to ? +st.history.meta.to : null);
    one('products', st.products);
    one('assignments', st.assignments, st.assignments && st.assignments.meta.to ? +st.assignments.meta.to : null);
    return rows;
  }

  /** Short hash of the settings that produced the figures: price book, weights, limits. */
  const fingerprint = () => U.hash(HR.config.exportJson().replace(/"exportedAt":[^,]*,/, ''));

  const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;

  /** Findings the snapshots have carried for longer than `days`. */
  function agedFindings(m, days) {
    const seen = HR.app.state.findingsSeen || {};
    const now = Date.now();
    return m.findings.filter(f => seen[f.id] && (now - seen[f.id].first) / 86400000 > days)
      .map(f => ({ finding: f, days: Math.round((now - seen[f.id].first) / 86400000) }));
  }

  /* An action's owner is the owner of the control that measures the same thing. */
  const ACTION_CONTROL = { leavers: 'disabled-licensed', priv: 'privileged-unowned', orphans: 'unowned-enabled',
    rules: 'unmanaged-share', overent: 'over-provisioned', baseline: 'rule-coverage', stacked: 'disabled-licensed' };

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
      el('button', { class: 'btn', text: T('bd.exportHtml'), onclick: () => {
        U.download('board-report.html', htmlFile(paper), 'text/html'); HR.usage.exported('board-html');
      } }),
      el('button', { class: 'btn', text: T('bd.exportJson'), onclick: () => {
        U.download('board-report.json', JSON.stringify(pack(m), null, 2), 'application/json'); HR.usage.exported('board-json');
      } }),
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

      /* ============ page 1b — scope and sign-off ============ */
      const sc = scope(m);
      const scopeTbl = el('table', { class: 'board-tbl' });
      scopeTbl.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: T('bd.scopeSource') }), el('th', { text: T('bd.scopeFile') }),
        el('th', { text: T('bd.scopeLoaded') }), el('th', { text: T('bd.scopeAsOf') })
      ])));
      scopeTbl.appendChild(el('tbody', {}, sc.map(r => el('tr', {}, [
        el('td', {}, el('strong', { text: r.kind })),
        el('td', { class: 'mono', text: r.file || '—' }),
        el('td', { class: 'nowrap', text: r.loaded ? U.fmtDate(r.loaded).split(',')[0] : '—' }),
        el('td', { class: 'nowrap', text: r.asOf ? U.fmtDate(r.asOf).split(',')[0] : '—' })
      ]))));
      const signRow = key => el('div', { class: 'sign-row' }, [
        el('span', { class: 'sign-label', text: T(key) }),
        el('span', { class: 'sign-line' }), el('span', { class: 'sign-line short' })
      ]);
      paper.appendChild(page([
        el('h2', { class: 'sheet-h', text: T('bd.secScope') }),
        el('p', { class: 'lead', text: T('bd.scopeLead', { systems: m.systemList.map(x => x.name).join(', ') || '—', n: m.systemList.length }) }),
        scopeTbl,
        el('p', { class: 'why', text: T('bd.scopeFingerprint', { hash: fingerprint() }) }),
        el('h3', { class: 'sheet-h3', text: T('bd.secSignoff') }),
        el('div', { class: 'sign-head' }, [el('span'), el('span', { text: T('bd.signName') }), el('span', { text: T('bd.signDate') })]),
        signRow('bd.signPrepared'), signRow('bd.signReviewed'), signRow('bd.signApproved'),
        el('p', { class: 'footnote', text: T('bd.signFoot') })
      ]));

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
        (() => {
          const aged = agedFindings(m, 90);
          return aged.length ? el('p', { class: 'lead', text: T('bd.findingsAged', { n: aged.length,
            list: aged.slice(0, 5).map(a => a.finding.title + ' (' + a.days + ' d)').join(', ') }) }) : null;
        })(),
        el('p', { class: 'footnote', text: T('bd.findingsFoot') })
      ].filter(Boolean)));

      /* ============ page 3 — money ============ */
      const h = c.hidden;
      const buckets = [
        { label: T('bd.leakDisabled'), value: c.disabledWaste, color: C.STATUS.critical },
        { label: T('bd.leakDouble'), value: c.stackedWasteNet, color: C.STATUS.serious },
        { label: T('bd.leakUnowned'), value: c.orphanExposure, color: C.STATUS.warning }
      ].concat(h ? [
        { label: T('ct.hLeavers'), value: h.leavers.monthly, color: C.STATUS.critical },
        { label: T('ct.hDormant'), value: h.dormant.monthly, color: C.STATUS.serious },
        { label: T('ct.hDuplicates'), value: h.duplicates.monthly, color: C.STATUS.warning },
        { label: T('ct.hManual'), value: h.manual.monthly, color: C.slot(4) }
      ].filter(b => b.value > 0) : []).concat(h && h.trueup.shelfware ? [{ label: T('ct.shelfware'), value: h.trueup.shelfware, color: C.slot(2) }] : []);
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
        h && h.hiddenMonthly ? el('p', { class: 'lead', text: T('bd.moneyHidden', { amount: U.fmtMoney(h.hiddenMonthly * 12, { compact: true }), toDate: U.fmtMoney(h.leavers.toDate, { compact: true }) }) }) : null,
        el('p', { class: 'footnote', text: T('bd.moneyFoot') + (h ? ' ' + T('bd.moneyHiddenFoot') : '') })
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

      /* ============ departments ============ */
      if (m.vault && HR.scorecard) {
        const scd = HR.scorecard.build(m);
        const rows = scd.departments.filter(r => r.people > 0).sort((a, b) => b.people - a.people).slice(0, 25);
        if (rows.length) {
          const med = scd.medianCostPerHead;
          const dt = el('table', { class: 'board-tbl' });
          dt.appendChild(el('thead', {}, el('tr', {}, [
            el('th', { text: T('pp.department') }), el('th', { class: 'num', text: T('sc.cPeople') }),
            el('th', { class: 'num', text: T('sc.cPerHead') }), el('th', { class: 'num', text: T('bd.dVsMedian') }),
            el('th', { class: 'num', text: T('sc.cLeavers') }), el('th', { class: 'num', text: T('bd.dDrift') }),
            el('th', { class: 'num', text: T('sc.cRisk') })
          ])));
          dt.appendChild(el('tbody', {}, rows.map(r => {
            const ratio = med && r.costPerHead != null ? r.costPerHead / med : null;
            return el('tr', {}, [
              el('td', {}, el('strong', { text: r.name || r.key })),
              el('td', { class: 'num', text: U.fmtInt(r.people) }),
              el('td', { class: 'num nowrap', text: r.costPerHead == null ? '—' : U.fmtMoney(r.costPerHead) }),
              el('td', { class: 'num nowrap ' + (ratio > 2 ? 'tone-bad' : ratio > 1.3 ? 'tone-watch' : ''), text: ratio == null ? '—' : (ratio > 1 ? '+' : '') + Math.round((ratio - 1) * 100) + '%' }),
              el('td', { class: 'num ' + (r.leaversWithAccess ? 'tone-bad' : ''), text: U.fmtInt(r.leaversWithAccess) }),
              el('td', { class: 'num', text: r.driftPerHead == null ? '—' : U.fmtNum(r.driftPerHead, 1) }),
              el('td', { class: 'num', text: String(Math.round(r.avgRisk)) })
            ]);
          })));
          paper.appendChild(page([
            el('h2', { class: 'sheet-h', text: T('bd.secDepartments') }),
            el('p', { class: 'lead', text: T('bd.deptLead', { n: scd.summary.departments, median: med == null ? '—' : U.fmtMoney(med),
              outliers: scd.outliers.length }) }),
            dt,
            el('p', { class: 'footnote', text: T('bd.deptFoot') })
          ]));
        }
      }

      /* ============ joiners · movers · leavers ============ */
      if (m.vault && HR.workforce) {
        const sla = HR.config.get().sla || {};
        const jml = [];
        const lat = HR.workforce.onboardingLatency(m.vault, m.history);
        if (lat) {
          const days = lat.rows.map(r => r.days).sort((a, b) => a - b);
          jml.push({ what: T('bd.jJoiners'), n: lat.summary.joiners, p50: percentile(days, 0.5), p90: percentile(days, 0.9),
            breaches: lat.rows.filter(r => r.days > sla.joinerDays).length, sla: T('bd.slaDays', { n: sla.joinerDays }) });
        }
        const mv = HR.workforce.moverResidue(m, m.vault, { maxDays: null });
        if (mv) {
          const days = mv.rows.map(r => r.move.daysAgo || 0).sort((a, b) => a - b);
          jml.push({ what: T('bd.jMovers'), n: mv.summary.deptMoves, p50: percentile(days, 0.5), p90: percentile(days, 0.9),
            breaches: mv.rows.filter(r => (r.move.daysAgo || 0) > sla.moverDays).length, sla: T('bd.slaDays', { n: sla.moverDays }),
            sub: T('bd.jResidue', { n: mv.summary.withResidue, ents: mv.summary.residueEnts }) });
        }
        const lv = HR.workforce.leavers(m, m.vault);
        if (lv.summary.leavers) {
          const late = lv.rows.filter(r => r.enabledAccounts);
          const days = late.map(r => r.life.days || 0).sort((a, b) => a - b);
          jml.push({ what: T('bd.jLeavers'), n: lv.summary.leavers, p50: percentile(days, 0.5), p90: percentile(days, 0.9),
            breaches: late.filter(r => (r.life.days || 0) > sla.leaverDays).length, sla: T('bd.slaDays', { n: sla.leaverDays }),
            sub: T('bd.jLeaversOpen', { n: lv.summary.withEnabled, money: U.fmtMoney(lv.summary.monthly) }) });
        }
        if (jml.length) {
          const jt = el('table', { class: 'board-tbl' });
          jt.appendChild(el('thead', {}, el('tr', {}, [
            el('th', { text: T('bd.jFlow') }), el('th', { class: 'num', text: T('bd.jCount') }),
            el('th', { text: T('bd.jSla') }), el('th', { class: 'num', text: T('bd.jP50') }),
            el('th', { class: 'num', text: T('bd.jP90') }), el('th', { class: 'num', text: T('bd.jBreaches') }), el('th', { text: T('c.status') })
          ])));
          jt.appendChild(el('tbody', {}, jml.map(r => el('tr', {}, [
            el('td', {}, [el('strong', { text: r.what }), r.sub ? el('div', { class: 'why', text: r.sub }) : null].filter(Boolean)),
            el('td', { class: 'num', text: U.fmtInt(r.n) }),
            el('td', { class: 'nowrap', text: r.sla }),
            el('td', { class: 'num nowrap', text: r.p50 == null ? '—' : r.p50 + ' d' }),
            el('td', { class: 'num nowrap', text: r.p90 == null ? '—' : r.p90 + ' d' }),
            el('td', { class: 'num ' + (r.breaches ? 'tone-bad' : 'tone-good'), text: U.fmtInt(r.breaches) }),
            el('td', {}, statusPill(r.breaches ? 'bad' : 'good'))
          ]))));
          paper.appendChild(page([
            el('h2', { class: 'sheet-h', text: T('bd.secJml') }),
            el('p', { class: 'lead', text: T('bd.jmlLead') }),
            jt,
            el('p', { class: 'footnote', text: T('bd.jmlFoot') + (lat ? '' : ' ' + T('bd.jmlNoHistory')) })
          ]));
        }
      }

      /* ============ access review ============ */
      if (m.vault && HR.attest) {
        let at = null;
        try { at = HR.attest.build(m); } catch (e) { at = null; }
        if (at && at.packs.length) {
          const cov = HR.attest.coverage(m, at.packs);
          const byMgr = at.packs.slice().sort((a, b) => b.summary.entitlements - a.summary.entitlements).slice(0, 15);
          const decided = HR.attest.decisions();
          const mt = el('table', { class: 'board-tbl' });
          mt.appendChild(el('thead', {}, el('tr', {}, [
            el('th', { text: T('wf.cManager') }), el('th', { class: 'num', text: T('wf.cReports') }),
            el('th', { class: 'num', text: T('at.cEnts') }), el('th', { class: 'num', text: T('bd.aDecided') }),
            el('th', { class: 'num', text: T('at.cUnexplained') })
          ])));
          mt.appendChild(el('tbody', {}, byMgr.map(pk => {
            const done = pk.rows.filter(r => r.perm && decided[HR.attest.decisionKey(r.account, r.perm)]).length;
            return el('tr', {}, [
              el('td', {}, el('strong', { text: pk.manager.name })),
              el('td', { class: 'num', text: U.fmtInt(pk.summary.reports) }),
              el('td', { class: 'num', text: U.fmtInt(pk.summary.entitlements) }),
              el('td', { class: 'num', text: U.fmtInt(done) }),
              el('td', { class: 'num ' + (pk.summary.unexplained ? 'tone-watch' : ''), text: U.fmtInt(pk.summary.unexplained) })
            ]);
          })));
          paper.appendChild(page([
            el('h2', { class: 'sheet-h', text: T('bd.secReview') }),
            el('div', { class: 'bignums' }, [
              bigNumber(U.fmtPct(cov.share, 0), T('at.kCoverage'), T('at.kCoverageFoot', { n: U.fmtInt(cov.allDone), of: U.fmtInt(cov.all), months: cov.months }),
                cov.share >= 0.9 ? 'good' : cov.share >= 0.5 ? 'watch' : 'bad'),
              bigNumber(U.fmtPct(cov.privShare, 0), T('at.kPrivCoverage'), T('at.kPrivCoverageFoot', { n: U.fmtInt(cov.privDone), of: U.fmtInt(cov.priv) }),
                cov.privShare >= 1 ? 'good' : cov.privShare >= 0.5 ? 'watch' : 'bad'),
              bigNumber(U.fmtInt(cov.revokePending), T('at.kRevoke'), T('at.kRevokeFoot'), cov.revokePending ? 'watch' : 'good'),
              bigNumber(U.fmtInt(at.summary.managers), T('at.kManagers'), T('at.kManagersFoot'))
            ]),
            el('p', { class: 'lead', text: T('bd.reviewLead', { months: cov.months }) }),
            mt,
            el('p', { class: 'footnote', text: T('bd.reviewFoot') })
          ]));
        }
      }

      /* ============ HelloID operations — from the audit log ============ */
      if (m.audit && HR.audit.health) {
        const h = HR.audit.health(m.audit);
        const A = m.audit;
        const noReason = A.exclusions.filter(x => !String(x.comment || '').trim()).length;
        const ft = el('table', { class: 'board-tbl' });
        ft.appendChild(el('thead', {}, el('tr', {}, [el('th', { text: T('c.system') }), el('th', { text: T('au.cAction') }), el('th', { text: T('au.cMessage') }),
          el('th', { class: 'num', text: T('au.cTimes') }), el('th', { class: 'num', text: T('au.cPeople') })])));
        ft.appendChild(el('tbody', {}, h.failures.groups.slice(0, 8).map(g => el('tr', {}, [
          el('td', { text: g.system }), el('td', { class: 'nowrap', text: g.action }), el('td', { text: g.message }),
          el('td', { class: 'num', text: U.fmtInt(g.count) }), el('td', { class: 'num', text: U.fmtInt(g.people.length) })]))));
        paper.appendChild(page([
          el('h2', { class: 'sheet-h', text: T('bd.secOps') }),
          el('div', { class: 'bignums' }, [
            bigNumber(U.fmtPct(h.failures.recentRate, 1), T('bd.opsFailRate'), T('bd.opsFailRateSub', { n: U.fmtInt(h.failures.recentFailed) }),
              h.failures.recentRate > 0.05 ? 'bad' : h.failures.recentRate > 0.02 ? 'watch' : 'good'),
            bigNumber(h.evaluations.ageDays == null ? '—' : String(h.evaluations.ageDays), T('bd.opsEvalAge'), T('bd.opsEvalAgeSub', { n: U.fmtInt(h.evaluations.starts) }),
              h.evaluations.ageDays == null || h.evaluations.ageDays > 7 ? 'bad' : h.evaluations.ageDays > 1 ? 'watch' : 'good'),
            bigNumber(U.fmtInt(h.imports.failedRecent), T('bd.opsImportFail'), T('bd.opsImportFailSub', { n: U.fmtInt(h.imports.runs) }), h.imports.failedRecent ? 'bad' : 'good'),
            bigNumber(U.fmtInt(h.incidents.open.length), T('bd.opsIncidents'), T('bd.opsIncidentsSub', { n: U.fmtInt(h.incidents.distinct) }), h.incidents.agentDown ? 'bad' : h.incidents.open.length ? 'watch' : 'good')
          ]),
          el('p', { class: 'lead', text: T('bd.opsLead', { from: A.meta.first ? U.fmtDate(A.meta.first).split(',')[0] : '—', to: A.meta.last ? U.fmtDate(A.meta.last).split(',')[0] : '—',
            actions: U.fmtInt(h.failures.actions), exclusions: U.fmtInt(A.exclusions.length), noReason: U.fmtInt(noReason), thresholds: U.fmtInt(A.thresholds.length),
            publishes: U.fmtInt(A.rules.filter(r => /publish/i.test(r.action || '')).length), actors: U.fmtInt(HR.audit.actors(A).length) }) }),
          el('h3', { class: 'sheet-h3', text: T('bd.opsFailures') }),
          ft,
          el('p', { class: 'footnote', text: T('bd.opsFoot') })
        ]));
      }

      /* ============ page 5 — recommendations ============ */
      /* ============ policy guidelines ============ */
      const pol = HR.policy.evaluate(m);
      if (pol.summary.evaluated) {
        const ps = pol.summary;
        const pt = el('table', { class: 'board-tbl' });
        pt.appendChild(el('thead', {}, el('tr', {}, [
          el('th', { text: T('bd.polSeverity') }),
          el('th', { text: T('bd.polGuideline') }),
          el('th', { text: T('bd.polRefs') }),
          el('th', { text: T('bd.polActual') }),
          el('th', { text: T('bd.polLimit') }),
          el('th', { text: T('c.status') }),
          el('th', { text: T('po.owner') }),
          el('th', { text: T('po.due') })
        ])));
        const ptb = el('tbody');
        const order = HR.policy.SEVERITIES;
        pol.rows.filter(r => r.applicable && r.on)
          .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || (a.pass ? 1 : 0) - (b.pass ? 1 : 0))
          .forEach(r => {
            const pct = r.def.unit === 'pct';
            const refs = Object.keys(r.def.refs || {}).map(fw => ({ nis2: 'NIS2', iso27001: 'ISO', bio: 'BIO' })[fw] + ' ' + r.def.refs[fw]).join(' · ');
            ptb.appendChild(el('tr', {}, [
              el('td', { class: 'nowrap', text: T('po.sev.' + r.severity) }),
              el('td', {}, el('strong', { text: T('po.p.' + r.def.id) })),
              el('td', { text: refs }),
              el('td', { class: 'num nowrap', text: pct ? U.fmtNum(r.value, 1) + '%' : U.fmtInt(r.value) }),
              el('td', { class: 'num nowrap', text: (r.def.dir === 'max' ? '≤ ' : '≥ ') +
                (pct ? U.fmtNum(r.threshold, 1) + '%' : U.fmtInt(r.threshold)) }),
              el('td', {}, r.status === 'accepted'
                ? el('span', { class: 'nowrap', text: T('po.status.accepted') + ' \u2192 ' + r.exception.until })
                : statusPill(r.pass ? 'good' : 'bad')),
              el('td', { text: r.owner || '' }),
              el('td', { class: 'nowrap', text: r.due || '' })
            ]));
            /* The evidence sentence spans the row: how this measurement backs the articles. */
            const ev = HR.frameworks.evidenceOf(r.def);
            if (ev) ptb.appendChild(el('tr', { class: 'sub' }, el('td', { colspan: '8', class: 'why', text: ev })));
          });
        pt.appendChild(ptb);
        const sevLine = order.map(sev => T('po.sev.' + sev) + ' ' + ps.bySeverity[sev].passed + '/' + ps.bySeverity[sev].of).join(' \u00b7 ');
        paper.appendChild(page([
          el('h2', { class: 'sheet-h', text: T('bd.polTitle') }),
          el('p', { class: 'lead', text: T('bd.polLead', {
            passed: ps.passed, n: ps.evaluated, score: U.fmtPct(ps.score, 0) }) + ' ' + T('bd.polBySeverity', { line: sevLine }) }),
          pt,
          el('p', { class: 'footnote', text: T('bd.polFoot') + ' ' + T('bd.polRefsFoot') })
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
        el('td', { class: 'owner-cell', text: a.owner || '' })
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

      /* ============ appendix — the articles behind the references ============ */
      if (HR.views.policyShowRefs && HR.views.policyShowRefs() && pol.summary.evaluated) {
        const used = HR.frameworks.usedRefs(pol.rows.filter(r => r.applicable && r.on).map(r => r.def));
        paper.appendChild(page([
          el('h2', { class: 'sheet-h', text: T('bd.secFrameworks') }),
          el('p', { class: 'lead', text: T('bd.fwLead') }),
          el('dl', { class: 'fw-appendix' }, used.flatMap(r => [
            el('dt', {}, [el('span', { class: 'mono', text: r.label + ' ' + r.ref + ' \u2014 ' }), el('strong', { text: r.title }),
              el('span', { class: 'fw-tag', text: T(r.official ? 'po.fwOfficial' : 'po.fwDescribed') })]),
            el('dd', { text: r.about })
          ])),
          el('p', { class: 'footnote', text: T('bd.fwFoot', { sources: Object.values(HR.frameworks.META).map(x => x.label + ': ' + x.source).join(' \u00b7 ') }) })
        ]));
      }
    }

    paint();
    return f;
  }

  /* The printed sheets as one file: styles inlined, nothing fetched, so it can be
     mailed and archived and still open in ten years. */
  function htmlFile(paper) {
    const css = Array.from(document.styleSheets).map(sh => {
      try { return Array.from(sh.cssRules).map(r => r.cssText).join('\n'); } catch (e) { return ''; }
    }).join('\n');
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    return '<!doctype html>\n<html lang="' + HR.i18n.lang + '" data-theme="' + theme + '"><head><meta charset="utf-8">' +
      '<title>' + U.esc(T('bd.title')) + ' \u2014 ' + U.esc(HR.brand.reportDate()) + '</title>' +
      '<style>' + css + '\nbody{margin:0;background:#fff}.board-controls{display:none}</style></head>' +
      '<body><div class="view-board"><div class="paper">' + paper.innerHTML + '</div></div></body></html>';
  }

  /** The machine-readable twin of the printed pack. */
  function pack(m) {
    const st = HR.app.state, s = m.summary, c = m.cost;
    const pol = HR.policy.evaluate(m);
    const out = {
      kind: 'helloid-sidekick-report', version: 1, generatedAt: new Date().toISOString(),
      organisation: HR.brand.state.org || null, reportDate: HR.brand.reportDate(), settingsFingerprint: fingerprint(),
      scope: scope(m).map(r => ({ source: r.kind, file: r.file, loadedAt: r.loaded ? new Date(r.loaded).toISOString() : null, asOf: r.asOf ? new Date(r.asOf).toISOString() : null })),
      systems: m.systemList.map(x => x.name),
      summary: s,
      themes: themes(m).map(t => ({ name: t.name, status: t.status, scale: t.scale })),
      cost: { monthly: c.totalMonthly, annual: c.totalAnnual, recoverableAnnual: c.wasteAnnual, cleanup: c.remediationCost, hidden: c.hidden ? {
        monthly: c.hidden.hiddenMonthly, leaversToDate: c.hidden.leavers.toDate, dormant: c.hidden.dormant.monthly,
        duplicates: c.hidden.duplicates.monthly, manual: c.hidden.manual.monthly, shelfware: c.hidden.trueup.shelfware } : null },
      compliance: { score: pol.summary.score, passed: pol.summary.passed, evaluated: pol.summary.evaluated, bySeverity: pol.summary.bySeverity,
        controls: pol.rows.filter(r => r.applicable && r.on).map(r => ({ id: r.def.id, severity: r.severity, refs: r.def.refs || {},
          refTitles: HR.frameworks.refsOf(r.def).map(x => ({ framework: x.fw, ref: x.ref, title: x.title })), evidence: HR.frameworks.evidenceOf(r.def),
          value: r.value, threshold: r.threshold, dir: r.def.dir, unit: r.def.unit, status: r.status, owner: r.owner || null, due: r.due || null,
          exception: r.exception || null })) },
      findings: m.findings.map(f => ({ id: f.id, severity: f.severity, count: f.count, openSince: st.findingsSeen && st.findingsSeen[f.id] ? new Date(st.findingsSeen[f.id].first).toISOString() : null })),
      departments: s.departments || [],
      actions: actions(m).map(a => ({ title: a.title, hours: Math.round(a.hours), saving: a.saving, severity: a.severity, owner: a.owner || null }))
    };
    if (m.audit && HR.audit.health) {
      const h = HR.audit.health(m.audit);
      out.operations = { window: { from: m.audit.meta.first, to: m.audit.meta.last }, actions: h.failures.actions, failed: h.failures.failed, failedRate30d: h.failures.recentRate,
        imports: { runs: h.imports.runs, failed: h.imports.failed, failedRecent: h.imports.failedRecent }, evaluations: { starts: h.evaluations.starts, ageDays: h.evaluations.ageDays, last: h.evaluations.last },
        incidents: { distinct: h.incidents.distinct, open: h.incidents.open.length }, exclusions: m.audit.exclusions.length,
        exclusionsWithoutReason: m.audit.exclusions.filter(x => !String(x.comment || '').trim()).length, thresholdApprovals: m.audit.thresholds.length,
        rulePublishes: m.audit.rules.filter(r => /publish/i.test(r.action || '')).length };
    }
    if (m.vault && HR.workforce) {
      try {
        const lv = HR.workforce.leavers(m, m.vault);
        const lat = HR.workforce.onboardingLatency(m.vault, m.history);
        const mv = HR.workforce.moverResidue(m, m.vault, { maxDays: null });
        out.jml = { leavers: lv.summary, leaverBreaches: s.leaverBreaches || 0, joiners: lat ? lat.summary : null, movers: mv ? mv.summary : null };
      } catch (e) { /* optional */ }
      try { const at = HR.attest.build(m); out.attestation = Object.assign({ managers: at.summary.managers }, HR.attest.coverage(m, at.packs)); } catch (e) { /* optional */ }
    }
    return out;
  }

  HR.board = { view, pack };
})(window.HR);
