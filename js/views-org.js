/* The organisation walker and the role pyramid.

   Split out of views.js, which had grown past three and a half thousand lines. These use
   the shared building blocks views.js publishes on HR.viewkit rather than importing
   anything: the page has no module system by design, so the seam is an object rather
   than an import list. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, C = HR.charts;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, scoreBar, dl, partialNotice, syntheticVaultNotice, personRow, peopleIndex,
    drawerPermission, drawerVaultPerson, openDrawer, STATE_SEV, stateLabel } = HR.viewkit;

  /* ============================================================ ORGANISATION

     The structure HR maintains, travelled one level at a time. Everything else in this
     tool starts from an account or an entitlement; a department head starts from their
     department, and a rule condition is written against this shape rather than against
     a group name.                                                                     */

  let orgCursor = null;

  function orgView(m, params) {
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
    const synNote = syntheticVaultNotice(m);
    if (synNote) f.appendChild(synNote);

    if (!tree.meta.hierarchical) {
      /* A flat list is what the export gave, not what the organisation is. */
      f.appendChild(el('p', { class: 'note', style: 'margin-bottom:12px', text: T('org.flat') }));
    }

    const walk = el('div', {});
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
    walk.appendChild(crumb);

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
    walk.appendChild(stats);

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
      walk.appendChild(card(node ? T('org.deeper') : T('org.top'), null, cards));
    }

    /* ---- people right here ---- */
    if (node && node.people.length) {
      const index = peopleIndex(m);
      const rows = node.people.map(entry => ({
        person: entry.person, contract: entry.contract,
        life: HR.vault.lifecycle(entry.person)
      }));
      walk.appendChild(card(T('org.peopleIn', { name: node.name, n: node.people.length }), null,
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
    const quality = el('div', {});
    quality.appendChild(card(T('org.titlesTitle'), T('org.titlesNote'), HR.table.make({
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
    quality.appendChild(vaultQualityCard(m));

    f.appendChild(HR.viewkit.tabbed('org', [
      { id: 'walk', label: T('org.tab.walk'), build: () => walk },
      { id: 'scorecards', label: T('org.tab.scorecards'), build: () => {
        /* A fragment, not a wrapper div: the tab-body spacing rules address the
           scorecard's own children, and a wrapper would put them out of reach. */
        const f = document.createDocumentFragment();
        f.appendChild(scorecardCard(m, tree));
        const bf = busFactorCard(m);
        if (bf) f.appendChild(bf);
        return f;
      } },
      { id: 'workforce', label: T('org.tab.workforce'), build: () => workforceCard(m) },
      { id: 'attest', label: T('org.tab.attest'), build: () => attestCard(m) },
      { id: 'leavers', label: T('org.tab.leavers'), build: () => leaversCard(m) },
      { id: 'quality', label: T('org.tab.quality'), count: q.summary.anomalies + q.summary.deadTitles,
        build: () => quality }
    ], params));
    return f;
  }




  /** The pack, readable before it is a file: same rows, same order, same evidence. */
  function drawerAttestPack(m, pack) {
    const SEV = { unexplained: 'high', none: 'high', common: 'low',
      product: 'info', baseline: 'good', rule: 'good' };
    const body = el('div', { class: 'stack' });

    body.appendChild(el('div', { class: 'grid g4' }, [
      HR.viewkit.tile(T('wf.cReports'), U.fmtInt(pack.summary.reports), ''),
      HR.viewkit.tile(T('at.cEnts'), U.fmtInt(pack.summary.entitlements), ''),
      HR.viewkit.tile(T('at.cUnexplained'), U.fmtInt(pack.summary.unexplained), '',
        { severity: pack.summary.unexplained ? 'medium' : 'good', small: true }),
      HR.viewkit.tile(T('sc.cSpend'), U.fmtMoney(pack.summary.monthly), '', { small: true })
    ]));

    body.appendChild(HR.table.make({
      columns: [
        { key: 'person', label: T('py.cPerson'), value: r => r.person.displayName,
          render: r => el('span', {}, [
            document.createTextNode(r.person.displayName + ' '),
            r.life.state !== 'current'
              ? el('span', { class: 'sev medium', text: stateLabel(r.life.state) }) : null
          ].filter(Boolean)) },
        { key: 'ent', label: T('py.cEntitlement'), value: r => r.perm ? r.perm.name : '',
          render: r => r.perm
            ? el('a', { href: '#', text: r.perm.name,
                onclick: e => { e.preventDefault(); drawerPermission(r.perm, m); } })
            : el('span', { class: 'note', text: '—' }) },
        { key: 'sensitive', label: T('at.cSensitive'), value: r => r.perm && r.perm.sensitivity >= 1.6 ? 1 : 0,
          render: r => r.perm && r.perm.sensitivity >= 1.6
            ? el('span', { class: 'sev high', text: '●' }) : el('span', { text: '' }) },
        { key: 'cost', label: T('c.costMo'), value: r => r.perm ? (r.perm.monthlyPrice || 0) : 0,
          align: 'right',
          render: r => r.perm && r.perm.monthlyPrice
            ? el('span', { text: U.fmtMoney(r.perm.monthlyPrice) })
            : el('span', { class: 'note', text: '—' }) },
        { key: 'how', label: T('at.cHow'), value: r => r.reason.text,
          render: r => el('span', { class: 'sev ' + (SEV[r.reason.kind] || 'low'),
            text: r.reason.text }) }
      ],
      rows: pack.rows, pageSize: 15, exportName: 'attestation-preview',
      search: (r, q) => ((r.person.displayName + ' ' + (r.perm ? r.perm.name : '') + ' ' +
        r.reason.text).toLowerCase().includes(q))
    }));

    body.appendChild(el('div', { class: 'slot-actions' }, [
      el('button', { class: 'btn primary', text: T('at.export'), onclick: () => {
        const safe = pack.manager.name.replace(/[^\w.-]+/g, '_').slice(0, 60);
        U.download('attestation-' + safe + '.csv', HR.attest.toCsv(m, [pack]), 'text/csv');
        HR.usage.exported('attestation-pack');
      } })
    ]));

    openDrawer(el('div', {}, [
      el('div', {}, [
        document.createTextNode(pack.manager.name + ' '),
        pack.manager.stale ? el('span', { class: 'sev critical', text: T('at.staleTag') }) : null
      ].filter(Boolean)),
      el('span', { class: 'note', text: T('at.previewNote', {
        n: pack.rows.length, unexplained: pack.summary.unexplained }) })
    ]), body);
  }

  /**
   * Attestation packs: the review, assembled.
   *
   * An access review stalls on assembly, not judgement. Each manager gets one file —
   * their people, everything each holds, cost, sensitivity, and the best available
   * answer to "why do they have this" — with an empty Decision column, because that
   * column is the review. Unexplained rows sort first: they are the reading order.
   */
  function attestCard(m) {
    const wrap = el('div', {});
    let a = null;
    try { a = HR.attest.build(m); } catch (e) {
      wrap.appendChild(card(T('at.title'), null, el('p', { class: 'note', text: String(e && e.message || e) })));
      return wrap;
    }
    if (!a) {
      wrap.appendChild(card(T('at.title'), null, el('p', { class: 'note', text: T('at.needsManagers') })));
      return wrap;
    }

    wrap.appendChild(el('div', { class: 'grid g4' }, [
      tile(T('at.kManagers'), U.fmtInt(a.summary.managers), T('at.kManagersFoot')),
      tile(T('at.kRows'), U.fmtInt(a.summary.rows), T('at.kRowsFoot')),
      tile(T('at.kUnexplained'), U.fmtInt(a.summary.unexplained), T('at.kUnexplainedFoot'),
        { severity: a.summary.unexplained ? 'medium' : 'good' }),
      tile(T('at.kStale'), U.fmtInt(a.summary.stale), T('at.kStaleFoot'),
        { severity: a.summary.stale ? 'critical' : 'good' })
    ]));

    wrap.appendChild(card(T('at.tableTitle'), T('at.tableNote'), [
      HR.table.make({
        columns: [
          { key: 'manager', label: T('wf.cManager'), value: p => p.manager.name,
            render: p => el('span', {}, [
              el('a', { href: '#', text: p.manager.name,
                onclick: e => { e.preventDefault(); drawerAttestPack(m, p); } }),
              document.createTextNode(' '),
              p.manager.stale ? el('span', { class: 'sev critical', text: T('at.staleTag') }) : null
            ].filter(Boolean)) },
          { key: 'reports', label: T('wf.cReports'), value: p => p.summary.reports, align: 'right' },
          { key: 'ents', label: T('at.cEnts'), value: p => p.summary.entitlements, align: 'right' },
          { key: 'unexplained', label: T('at.cUnexplained'), value: p => p.summary.unexplained,
            align: 'right', hint: T('at.cUnexplainedHint'),
            render: p => p.summary.unexplained
              ? el('span', { class: 'sev medium', text: String(p.summary.unexplained) })
              : el('span', { class: 'note', text: '0' }) },
          { key: 'sensitive', label: T('at.cSensitive'), value: p => p.summary.sensitive, align: 'right' },
          { key: 'monthly', label: T('sc.cSpend'), value: p => p.summary.monthly, align: 'right',
            render: p => el('span', { text: U.fmtMoney(p.summary.monthly) }) },
          { key: 'export', label: '', sortable: false,
            render: p => el('button', { class: 'btn sm', text: T('at.export'), onclick: () => {
              const safe = p.manager.name.replace(/[^\w.-]+/g, '_').slice(0, 60);
              U.download('attestation-' + safe + '.csv', HR.attest.toCsv(m, [p]), 'text/csv');
              HR.usage.exported('attestation-pack');
            } }) }
        ],
        rows: a.packs, pageSize: 15, exportName: 'attestation-overview'
      }),
      el('div', { class: 'slot-actions' }, [
        el('button', { class: 'btn primary', text: T('at.exportAll'), onclick: () => {
          U.download('attestation-packs.csv', HR.attest.toCsv(m, a.packs), 'text/csv');
          HR.usage.exported('attestation-all');
        } })
      ]),
      el('p', { class: 'note', text: T('at.foot') })
    ]));
    return wrap;
  }

  /**
   * The workforce section: the contract history read as history.
   *
   * Flow, movers and their residue, manager routing, onboarding latency, creep, and the
   * cost of the hiring pipeline — none of which any per-system report can say.
   */
  function workforceCard(m) {
    const wrap = el('div', {});
    const vault = m.vault;

    /* ---- flow ---- */
    const fl = HR.workforce.flow(vault);
    if (fl.series.length >= 2) {
      wrap.appendChild(card(T('wf.flowTitle'), T('wf.flowNote', {
        joined: U.fmtInt(fl.summary.joined), left: U.fmtInt(fl.summary.left),
        months: fl.summary.months,
        tenure: fl.summary.medianTenure != null ? U.fmtNum(fl.summary.medianTenure, 1) : '—' }),
        C.line([
          { label: T('wf.joiners'), color: C.slot(3),
            points: fl.series.map((s, i) => ({ x: i, y: s.joined })) },
          { label: T('wf.leavers'), color: C.STATUS.critical,
            points: fl.series.map((s, i) => ({ x: i, y: s.left })) }
        ], fl.series.map(s => s.month.slice(2)))));
    }
    if (fl.departments.length) {
      wrap.appendChild(card(T('wf.attritionTitle'), T('wf.attritionNote'), HR.table.make({
        columns: [
          { key: 'dept', label: T('pp.department'), value: d => d.dept },
          { key: 'current', label: T('sc.cPeople'), value: d => d.current, align: 'right' },
          { key: 'left', label: T('wf.cLeft12'), value: d => d.left12, align: 'right' },
          { key: 'attrition', label: T('wf.cAttrition'), value: d => d.attrition,
            hint: T('wf.cAttritionHint'),
            render: d => el('span', { class: d.attrition >= 0.25 ? 'sev high' : '',
              text: U.fmtPct(d.attrition, 0) }) },
          { key: 'tenure', label: T('wf.cTenure'), value: d => d.medianTenure || 0, align: 'right',
            render: d => el('span', { text: d.medianTenure != null ? U.fmtNum(d.medianTenure, 1) : '—' }) }
        ],
        rows: fl.departments, pageSize: 10, exportName: 'attrition',
        initialSort: { key: 'attrition', dir: -1 }
      })));
    }

    /* ---- movers and residue ---- */
    const res = HR.workforce.moverResidue(m, vault);
    if (res) {
      const body = [el('p', { text: T('wf.moversLead', {
        moves: U.fmtInt(res.summary.moves), dept: U.fmtInt(res.summary.deptMoves),
        withResidue: U.fmtInt(res.summary.withResidue), ents: U.fmtInt(res.summary.residueEnts) }) })];
      if (res.rows.length) {
        body.push(HR.table.make({
          columns: [
            { key: 'person', label: T('py.cPerson'), value: r => r.move.person.displayName,
              render: r => el('a', { href: '#', text: r.move.person.displayName,
                onclick: e => { e.preventDefault(); drawerVaultPerson(personRow(m, r.move.person), m); } }) },
            { key: 'from', label: T('wf.cFrom'), value: r => r.move.from.dept },
            { key: 'to', label: T('wf.cTo'), value: r => r.move.to.dept },
            { key: 'when', label: T('wf.cWhen'), value: r => r.move.daysAgo, align: 'right',
              render: r => el('span', { text: T('wf.daysAgo', { n: U.fmtInt(r.move.daysAgo) }) }) },
            { key: 'residue', label: T('wf.cResidue'), value: r => r.residue.length, align: 'right',
              hint: T('wf.cResidueHint'),
              render: r => el('span', { class: 'sev medium', text: String(r.residue.length) }) },
            { key: 'what', label: T('wf.cWhat'), sortable: false,
              render: r => el('span', { class: 'trunc',
                title: r.residue.map(e => (m.permissions.get(e) || {}).name || e).join(', '),
                text: r.residue.map(e => (m.permissions.get(e) || {}).name || e).join(', ') }) }
          ],
          rows: res.rows, pageSize: 10, exportName: 'mover-residue'
        }));
        /* The checklist is the deliverable: one row per former-department entitlement,
           routed to the current manager, decision column empty on purpose. */
        body.push(el('p', { style: 'margin-top:10px' }, el('button', {
          class: 'btn sm', text: T('wf.residuePack'),
          onclick: () => {
            HR.usage.exported('mover-residue-pack');
            U.download('mover-revoke-checklist.csv', HR.workforce.residueCsv(m, res), 'text/csv;charset=utf-8');
          }
        })));
      } else {
        body.push(el('p', { class: 'note', text: T('wf.noResidue') }));
      }
      wrap.appendChild(card(T('wf.moversTitle'), T('wf.moversNote'), body));
    }

    /* ---- managers ---- */
    const mg = HR.workforce.managers(vault);
    if (mg.rows.length) {
      const body = [el('div', { class: 'grid g4' }, [
        tile(T('wf.kManagers'), U.fmtInt(mg.summary.managers),
          T('wf.kManagersFoot', { median: mg.summary.medianSpan })),
        tile(T('wf.kWide'), U.fmtInt(mg.summary.wide), T('wf.kWideFoot'),
          { severity: mg.summary.wide ? 'medium' : 'good' }),
        tile(T('wf.kStale'), U.fmtInt(mg.summary.stale),
          T('wf.kStaleFoot', { n: U.fmtInt(mg.summary.affectedReports) }),
          { severity: mg.summary.stale ? 'critical' : 'good' }),
        tile(T('wf.kMax'), U.fmtInt(mg.summary.maxSpan), T('wf.kMaxFoot'))
      ])];
      if (mg.stale.length) {
        body.push(card(T('wf.staleTitle'), T('wf.staleNote'), HR.table.make({
          columns: [
            { key: 'name', label: T('wf.cManager'), value: r => r.name },
            { key: 'span', label: T('wf.cReports'), value: r => r.span, align: 'right' },
            { key: 'people', label: T('wf.cWho'), sortable: false,
              render: r => el('span', { class: 'trunc',
                title: r.reports.map(p => p.displayName).join(', '),
                text: r.reports.map(p => p.displayName).join(', ') }) }
          ],
          rows: mg.stale, pageSize: 8, exportName: 'stale-managers'
        })));
      }
      wrap.appendChild(card(T('wf.managersTitle'), T('wf.managersNote'), body));
    }

    /* ---- onboarding latency ---- */
    const lat = HR.workforce.onboardingLatency(vault, m.history);
    if (lat) {
      wrap.appendChild(card(T('wf.latencyTitle'), T('wf.latencyNote'), [
        el('div', { class: 'grid g4' }, [
          tile(T('wf.kJoiners'), U.fmtInt(lat.summary.joiners), T('wf.kJoinersFoot')),
          tile(T('wf.kMedianLat'), T('wf.days', { n: U.fmtInt(lat.summary.median) }),
            T('wf.kMedianLatFoot')),
          tile(T('wf.kBeforeStart'), U.fmtInt(lat.summary.beforeStart), T('wf.kBeforeStartFoot'),
            { severity: 'good' }),
          tile(T('wf.kOverWeek'), U.fmtInt(lat.summary.overWeek), T('wf.kOverWeekFoot'),
            { severity: lat.summary.overWeek ? 'high' : 'good' })
        ]),
        HR.table.make({
          columns: [
            { key: 'person', label: T('py.cPerson'), value: r => r.person.displayName },
            { key: 'dept', label: T('pp.department'), value: r => r.dept },
            { key: 'start', label: T('wf.cStart'), value: r => +r.start,
              render: r => el('span', { text: U.fmtDate(r.start).split(',')[0] }) },
            { key: 'days', label: T('wf.cLatency'), value: r => r.days, align: 'right',
              render: r => el('span', { class: r.days > 7 ? 'sev high' : r.days <= 0 ? 'sev good' : '',
                text: T('wf.days', { n: U.fmtInt(r.days) }) }) }
          ],
          rows: lat.rows, pageSize: 8, exportName: 'onboarding-latency'
        })
      ]));
    }

    /* ---- creep ---- */
    const cr = HR.workforce.creep(m, vault);
    if (cr) {
      wrap.appendChild(card(T('wf.creepTitle'),
        T('wf.creepNote', { slope: U.fmtNum(cr.slope, 1), mean: U.fmtNum(cr.mean, 1) }),
        C.scatter(cr.points.map(p => ({
          x: Math.round(p.x * 10) / 10, y: p.y, r: 4,
          color: C.slot(1),
          tip: '<div class="t-title">' + U.esc(p.holder.name) + '</div>' +
            '<div class="t-row"><span>' + T('wf.cTenure') + '</span><b>' + U.fmtNum(p.x, 1) + '</b></div>' +
            '<div class="t-row"><span>' + T('dr.permsHeld') + '</span><b>' + p.y + '</b></div>'
        })), { xLabel: T('wf.creepX'), yLabel: T('dr.permsHeld'), height: 260 })));
    }

    /* ---- forecast ---- */
    const fc = HR.workforce.forecast(m, vault);
    if (fc) {
      wrap.appendChild(card(T('wf.forecastTitle'), T('wf.forecastNote'), [
        el('p', { text: T('wf.forecastLead', {
          n: U.fmtInt(fc.summary.starters), days: fc.summary.horizonDays,
          monthly: U.fmtMoney(fc.summary.monthly) }) }),
        HR.table.make({
          columns: [
            { key: 'person', label: T('py.cPerson'), value: r => r.person.displayName },
            { key: 'dept', label: T('pp.department'), value: r => r.dept },
            { key: 'days', label: T('wf.cStartsIn'), value: r => r.days, align: 'right',
              render: r => el('span', { text: T('wf.days', { n: U.fmtInt(r.days) }) }) },
            { key: 'monthly', label: T('wf.cExpected'), value: r => r.monthly, align: 'right',
              hint: T('wf.cExpectedHint'),
              render: r => el('span', { text: U.fmtMoney(r.monthly) + (r.estimated ? ' *' : '') }) }
          ],
          rows: fc.rows, pageSize: 8, exportName: 'licence-forecast',
          onRowClick: r => drawerForecast(m, vault, r)
        }),
        el('p', { class: 'note', text: T('wf.forecastFoot') })
      ]));
    }

    if (!wrap.childNodes.length) {
      wrap.appendChild(card(T('wf.title'), null, el('p', { class: 'note', text: T('wf.empty') })));
    }
    return wrap;
  }

  /**
   * One future starter, zoomed in: the entitlement set the people already in that seat
   * hold today. The department cohort sets the floor; the same-title subset, when it is
   * big enough to mean anything, sharpens it. Shares are facts about current colleagues,
   * so the forecast needs no model — only the honesty to say how big the cohort was.
   */
  function drawerForecast(m, vault, row) {
    const fx = HR.workforce.expectedAccess(m, vault, row.contract);
    const title = row.contract.title.name || row.contract.title.code || '';

    const head = el('div', {}, [
      el('h2', { text: row.person.displayName }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: T('wf.efStarts', { n: U.fmtInt(row.days) }) }),
        el('span', { class: 'pill', text: row.dept || '—' }),
        title ? el('span', { class: 'pill', text: title }) : null
      ])
    ]);

    const body = el('div', { class: 'stack' });
    if (!m.hasRecon && !m.granted) body.appendChild(partialNotice(['recon']));

    if (!fx.deptSize) {
      body.appendChild(card(T('wf.efTitle'), null,
        el('p', { class: 'note', text: T('wf.efNone', { dept: row.dept || '—' }) })));
      openDrawer(head, body);
      return;
    }

    body.appendChild(dl([
      [T('wf.efCohort'), T('wf.efCohortDetail', { n: U.fmtInt(fx.deptSize), dept: row.dept || '—' })],
      [T('wf.efTitleCohort'), fx.useTitle
        ? T('wf.efTitleDetail', { n: U.fmtInt(fx.titleSize), title: title })
        : T('wf.efTitleTooSmall')],
      [T('wf.efLikelySet'), T('wf.efLikelyDetail', {
        n: U.fmtInt(fx.likely.length), monthly: U.fmtMoney(fx.monthly) })]
    ]));

    body.appendChild(card(T('wf.efTitle'), T('wf.efNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('ct.group'), value: r => r.perm.name },
        { key: 'category', label: T('c.category'), value: r => r.perm.categoryLabel },
        { key: 'dept', label: T('wf.efDeptShare'), num: true, value: r => r.deptShare,
          render: r => el('span', { text: U.fmtPct(r.deptShare, 0) }) },
        { key: 'title', label: T('wf.efTitleShare'), num: true,
          value: r => r.titleShare == null ? -1 : r.titleShare,
          render: r => r.titleShare == null
            ? el('span', { class: 'note', text: '—' })
            : el('span', { text: U.fmtPct(r.titleShare, 0) }) },
        { key: 'price', label: T('c.unitMo'), num: true, value: r => r.perm.monthlyPrice || 0,
          render: r => r.perm.monthlyPrice ? el('span', { text: U.fmtMoney(r.perm.monthlyPrice) }) : el('span', { class: 'note', text: '—' }) }
      ],
      rows: fx.rows, pageSize: 15,
      initialSort: { key: fx.useTitle ? 'title' : 'dept', dir: -1 },
      exportName: 'entitlement-forecast-' + (row.person.externalId || row.person.displayName),
      onRowClick: r => drawerPermission(r.perm, m)
    })));
    body.appendChild(el('p', { class: 'note', text: T('wf.efFoot') }));

    openDrawer(head, body);
  }

  /**
   * Proof of deprovisioning. Every leaver, including the clean ones — an assurance
   * report that only lists problems proves nothing about the rest — with the file an
   * auditor actually asks for behind one button.
   */
  function leaversCard(m) {
    const wrap = el('div', { class: 'stack' });
    if (!m.hasRecon && !m.granted) wrap.appendChild(partialNotice(['recon']));

    const res = HR.workforce.leavers(m, m.vault);
    if (!res.rows.length) {
      wrap.appendChild(card(T('lv.title'), null, el('p', { class: 'note', text: T('lv.none') })));
      return wrap;
    }

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('lv.kLeavers'), U.fmtInt(res.summary.leavers), T('lv.kLeaversFoot'), { small: true }),
      tile(T('lv.kEnabled'), U.fmtInt(res.summary.withEnabled), T('lv.kEnabledFoot'),
        { small: true, severity: res.summary.withEnabled ? 'critical' : 'good' }),
      tile(T('lv.kAccess'), U.fmtInt(res.summary.withAccess), T('lv.kAccessFoot'),
        { small: true, severity: res.summary.withAccess ? 'high' : 'good' }),
      tile(T('lv.kSpend'), U.fmtMoney(res.summary.monthly), T('lv.kSpendFoot'),
        { small: true, severity: res.summary.monthly ? 'medium' : 'good' })
    );
    wrap.appendChild(k);

    wrap.appendChild(card(T('lv.title'), T('lv.note'), [
      el('p', { text: T('lv.lead', { n: U.fmtInt(res.summary.leavers),
        clean: U.fmtInt(res.summary.clean) }) }),
      HR.table.make({
        columns: [
          { key: 'person', label: T('py.cPerson'), value: r => r.person.displayName },
          { key: 'dept', label: T('pp.department'), value: r => r.department },
          { key: 'end', label: T('lv.cEnd'), value: r => r.life.date ? +r.life.date : 0,
            render: r => el('span', { text: r.life.date ? r.life.date.toISOString().slice(0, 10) : '—' }) },
          { key: 'days', label: T('lv.cDays'), value: r => r.life.days || 0, align: 'right' },
          { key: 'accounts', label: T('pp.accounts'), value: r => r.accounts.length, align: 'right' },
          { key: 'enabled', label: T('c.enabled'), value: r => r.enabledAccounts, align: 'right',
            render: r => el('span', { class: r.enabledAccounts ? 'sev critical' : 'note',
              text: String(r.enabledAccounts) }) },
          { key: 'ents', label: T('c.perms'), value: r => r.entCount, align: 'right',
            render: r => el('span', { class: r.entCount ? 'sev high' : 'note', text: String(r.entCount) }) },
          { key: 'cost', label: T('c.costMo'), value: r => r.monthlyCost, align: 'right',
            render: r => U.fmtMoney(r.monthlyCost) }
        ],
        rows: res.rows, pageSize: 15, exportName: 'leavers',
        search: (r, q) => (r.person.displayName + ' ' + r.department).toLowerCase().includes(q),
        onRowClick: r => drawerVaultPerson(personRow(m, r.person), m)
      }),
      el('p', { style: 'margin-top:10px' }, el('button', {
        class: 'btn sm', text: T('lv.pack'),
        onclick: () => {
          HR.usage.exported('leaver-assurance');
          U.download('leaver-assurance.csv', HR.workforce.leaversCsv(m, res), 'text/csv;charset=utf-8');
        }
      })),
      el('p', { class: 'note', text: T('lv.foot') })
    ]));
    return wrap;
  }

  /**
   * The bus factor: access that walks out with one person. Department-sole holders of
   * entitlements almost nobody else holds anywhere.
   */
  function busFactorCard(m) {
    const bf = HR.scorecard.busFactor(m);
    if (!bf) return null;
    const body = [el('p', { text: T('bf.lead', { n: U.fmtInt(bf.summary.rows),
      people: U.fmtInt(bf.summary.people), depts: U.fmtInt(bf.summary.departments) }) })];
    if (bf.rows.length) {
      body.push(HR.table.make({
        columns: [
          { key: 'dept', label: T('pp.department'), value: r => r.dept },
          { key: 'ent', label: T('ct.group'), value: r => r.perm.name,
            render: r => el('a', { href: '#', text: r.perm.name,
              onclick: e => { e.preventDefault(); drawerPermission(r.perm, m); } }) },
          { key: 'person', label: T('bf.cOnly'), value: r => r.person.displayName,
            render: r => el('a', { href: '#', text: r.person.displayName,
              onclick: e => { e.preventDefault(); drawerVaultPerson(personRow(m, r.person), m); } }) },
          { key: 'org', label: T('bf.cOrg'), value: r => r.orgHolders, align: 'right',
            hint: T('bf.cOrgHint') },
          { key: 'sens', label: T('c.sensitivity'), value: r => r.perm.sensitivity, align: 'right',
            render: r => el('span', { class: r.perm.sensitivity >= 1.6 ? 'sev high' : '',
              text: U.fmtNum(r.perm.sensitivity, 1) }) },
          { key: 'cost', label: T('c.unitMo'), value: r => r.perm.monthlyPrice || 0, align: 'right',
            render: r => r.perm.monthlyPrice ? el('span', { text: U.fmtMoney(r.perm.monthlyPrice) })
              : el('span', { class: 'note', text: '—' }) }
        ],
        rows: bf.rows, pageSize: 12, exportName: 'bus-factor',
        search: (r, q) => (r.dept + ' ' + r.perm.name + ' ' + r.person.displayName).toLowerCase().includes(q)
      }));
    } else {
      body.push(el('p', { class: 'note', text: T('bf.none') }));
    }
    body.push(el('p', { class: 'note', text: T('bf.foot') }));
    return card(T('bf.title'), T('bf.note'), body);
  }

  /**
   * The league table: every department on the numbers a manager answers for.
   *
   * HelloID reports per system because that is how provisioning is built; nobody owns a
   * system. Cutting the same data by department turns totals into comparisons, and the
   * comparison is what makes a number actionable — spend per head only means something
   * next to the other departments' spend per head.
   */
  function scorecardCard(m, tree) {
    let sc = null;
    try { sc = HR.scorecard.build(m); } catch (e) { return card(T('sc.title'), null,
      el('p', { class: 'note', text: String(e && e.message || e) })); }
    if (!sc) return card(T('sc.title'), null, el('p', { class: 'note', text: T('sc.needsVault') }));

    const wrap = el('div', {});
    const s = sc.summary;

    wrap.appendChild(el('div', { class: 'grid g4' }, [
      tile(T('sc.kDepartments'), U.fmtInt(s.departments), T('sc.kDepartmentsFoot', { n: U.fmtInt(s.people) })),
      tile(T('sc.kSpend'), U.fmtMoney(s.monthlyCost) + '/mo',
        sc.medianCostPerHead != null
          ? T('sc.kSpendFoot', { median: U.fmtMoney(sc.medianCostPerHead) }) : ''),
      tile(T('sc.kDrift'), U.fmtInt(s.driftRows), T('sc.kDriftFoot')),
      tile(T('sc.kLeavers'), U.fmtInt(s.leaversWithAccess),
        T('sc.kLeaversFoot', { cost: U.fmtMoney(s.leaverCost) }),
        { severity: s.leaversWithAccess ? 'critical' : 'good' })
    ]));

    /* What to look at first, said in words before the table asks for reading. */
    if (sc.outliers.length) {
      wrap.appendChild(card(T('sc.outliersTitle'), null,
        el('ul', { class: 'clean' }, sc.outliers.slice(0, 5).map(o => el('li', { class: 'note' }, [
          el('span', { class: 'sev ' + (o.why === 'leavers' ? 'critical' : 'medium') }),
          document.createTextNode(' '),
          el('strong', { text: o.row.name || o.row.key }),
          document.createTextNode(' \u2014 ' + (o.why === 'cost'
            ? T('sc.outlierCost', { factor: U.fmtNum(o.factor, 1),
                head: U.fmtMoney(o.row.costPerHead) })
            : T('sc.outlierLeavers', { n: o.row.leaversWithAccess,
                cost: U.fmtMoney(o.row.leaverCost) })))
        ])))));
    }

    const label = r => r.key === sc.UNASSIGNED ? T('sc.unassigned')
      : r.key === sc.UNOWNED ? T('sc.unowned') : r.name;

    const goWalk = r => {
      if (r.key === sc.UNASSIGNED || r.key === sc.UNOWNED) return;
      const node = Array.from(tree.nodes.values())
        .find(n => n.name === r.key || n.id === r.key);
      if (!node) return;
      orgCursor = node.id;
      HR.app.go('org', { tab: 'walk' });
    };

    wrap.appendChild(card(T('sc.tableTitle'), T('sc.tableNote'), HR.table.make({
      columns: [
        { key: 'dept', label: T('pp.department'), value: r => label(r),
          render: r => (r.key === sc.UNASSIGNED || r.key === sc.UNOWNED)
            ? el('span', { class: 'note', text: label(r) })
            : el('a', { href: '#', text: label(r),
                onclick: e => { e.preventDefault(); goWalk(r); } }) },
        { key: 'people', label: T('sc.cPeople'), value: r => r.people, align: 'right' },
        { key: 'accounts', label: T('sc.cAccounts'), value: r => r.accounts, align: 'right' },
        { key: 'cost', label: T('sc.cSpend'), value: r => r.monthlyCost, align: 'right',
          render: r => el('span', { text: U.fmtMoney(r.monthlyCost) }) },
        { key: 'head', label: T('sc.cPerHead'), value: r => r.costPerHead || 0, align: 'right',
          hint: T('sc.cPerHeadHint'),
          render: r => {
            if (r.costPerHead == null) return el('span', { class: 'note', text: '\u2014' });
            const hot = sc.medianCostPerHead && r.people >= 3 && r.costPerHead > sc.medianCostPerHead * 2;
            return el('span', { class: hot ? 'sev high' : '', text: U.fmtMoney(r.costPerHead) });
          } },
        { key: 'drift', label: T('sc.cDrift'), value: r => r.driftRows, align: 'right',
          hint: T('sc.cDriftHint') },
        { key: 'baseline', label: T('sc.cBaseline'), value: r => r.outsideBaseline, align: 'right',
          hint: T('sc.cBaselineHint'),
          render: r => r.outsideBaseline
            ? el('span', { class: 'sev medium', text: String(r.outsideBaseline) })
            : el('span', { class: 'note', text: '0' }) },
        { key: 'leavers', label: T('sc.cLeavers'), value: r => r.leaversWithAccess, align: 'right',
          render: r => r.leaversWithAccess
            ? el('span', { class: 'sev critical', text: String(r.leaversWithAccess) })
            : el('span', { class: 'note', text: '0' }) },
        { key: 'risk', label: T('sc.cRisk'), value: r => Math.round(r.avgRisk), align: 'right',
          render: r => scoreBar(Math.round(r.avgRisk)) }
      ],
      rows: sc.rows, pageSize: 20, exportName: 'department-scorecards',
      initialSort: { key: 'cost', dir: -1 }
    })));

    wrap.appendChild(el('p', { class: 'note', text: T('sc.foot') }));
    return wrap;
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

  /* Conditions as prose in a cell, one per line in the drawer: "∧" is precise and
     unreadable, and stacking them is what makes a two-condition rule legible at all. */
  const conditionText = row => row.conds && row.conds.length
    ? row.conds.map(c => (T('py.attr.' + c.attr) || c.attr) + ' = ' +
        (c.label || c.value || T('py.empty'))).join(T('py.and'))
    : T('py.everyone');

  function conditionList(row) {
    if (!row.conds || !row.conds.length) {
      return el('p', { class: 'note', text: T('py.dNoCondition') });
    }
    return el('table', { class: 'cond-list' }, row.conds.map(c => el('tr', {}, [
      el('td', {}, el('span', { class: 'pill', text: (T('py.attr.' + c.attr) || c.attr) +
        ' · ' + c.field })),
      el('td', { class: 'mono', text: c.value || T('py.empty') }),
      el('td', { class: 'note', text: c.label && c.label !== c.value ? c.label : '' })
    ])));
  }

  /**
   * The same model with "one of" conditions, which is what HelloID actually allows.
   *
   * Fewer rules for the same access is the whole point, so the saving leads and the
   * merged rules are shown as they would be written. Where nothing merges that is a fact
   * about the tenant — every group grants something of its own — and it is said outright.
   */
  function condensedCard(m, P) {
    let c = null;
    try { c = HR.pyramid.condense(m, P); } catch (e) { return null; }
    if (!c || !c.rules.length) return null;

    const s = c.summary;
    const condText = rule => rule.conds.map(x => (T('py.attr.' + x.attr) || x.attr) +
      (x.values.length > 1
        ? ' ' + T('py.oneOf', { values: x.labels.join(', ') })
        : ' = ' + (x.labels[0] || x.values[0]))).join(T('py.and'));

    const body = [
      el('p', { text: s.saved
        ? T('py.cdLead', { before: s.before, after: s.after, share: U.fmtPct(s.share, 0),
            lists: s.withLists, widest: s.widest })
        : T('py.cdNothing', { n: s.before }) })
    ];

    if (s.withLists) {
      body.push(HR.table.make({
        columns: [
          { key: 'conds', label: T('py.cRule'), value: r => condText(r) },
          { key: 'from', label: T('py.cdFrom'), value: r => r.from, align: 'right',
            hint: T('py.cdFromHint') },
          { key: 'members', label: T('py.cGroup'), value: r => r.members.length, align: 'right' },
          { key: 'grants', label: T('py.cGrants'), value: r => r.grants.length, align: 'right' },
          { key: 'list', label: T('py.cGets'), sortable: false,
            render: r => el('span', { class: 'trunc',
              title: r.grants.map(g => (m.permissions.get(g.ent) || {}).name || g.ent).join(', '),
              text: r.grants.map(g => (m.permissions.get(g.ent) || {}).name || g.ent).join(', ') }) }
        ],
        rows: c.rules.filter(r => r.conds.some(x => x.values.length > 1)),
        pageSize: 10, exportName: 'condensed-rules'
      }));
      body.push(el('div', { class: 'slot-actions' }, [
        el('button', { class: 'btn', text: T('py.cdExport'), onclick: () => {
          U.download('condensed-rules.csv', HR.pyramid.condensedToRulesCsv(m, c), 'text/csv');
          HR.usage.exported('condensed-rules');
        } })
      ]));
      body.push(el('p', { class: 'note', text: T('py.cdLossless') }));
    }
    return card(T('py.cdTitle'), T('py.cdNote'), body);
  }

  /** One mined rule: its condition, what it grants, and who does not have it yet. */
  function drawerPyramidRule(m, P, row) {
    const body = document.createDocumentFragment();
    body.appendChild(card(T('py.dCondition'), T('py.dConditionNote'), conditionList(row)));
    body.appendChild(dl([
      [T('py.dLevel'), row.level === 99 ? T('py.kind.' + row.kind)
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

  function pyramidView(m, params) {
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

    const synNote = syntheticVaultNotice(m);
    if (synNote) f.appendChild(synNote);

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

    const levelsCard = card(T('py.levelsTitle'), T('py.levelsNote'), [
      pyramidDiagram(m, P),
      chips,
      knobs,
      el('p', { class: 'note', text: T('py.knobsNote') }),
      el('p', { class: 'note', style: 'margin-top:10px', text: P.suggestion.steps.length
        ? T('py.suggestion', {
            steps: P.suggestion.steps.map(x => (T('py.attr.' + x.attr) || x.attr) +
              ' +' + U.fmtNum(x.gain * 100, 1) + 'pp').join(', '),
            coverage: U.fmtPct(P.suggestion.coverage, 0) })
        : T('py.noSuggestion') })
    ]);

    /* Sections rather than one long scroll, and only the one on screen is built —
       mining a section is not free. */
    f.appendChild(HR.viewkit.tabbed('mining', [
      { id: 'model', label: T('py.tab.model'), build: () => {
        const wrap = el('div', {});
        wrap.appendChild(levelsCard);
        const bl = baselineCard(m, P);
        if (bl) wrap.appendChild(bl);
        return wrap;
      } },
      { id: 'rules', label: T('py.tab.rules'), count: P.summary.rules + P.summary.combos,
        build: () => {
          const wrap = el('div', {});
          wrap.appendChild(minedRulesCard());
          const cd = condensedCard(m, P);
          if (cd) wrap.appendChild(cd);
          return wrap;
        } },
      { id: 'journey', label: T('py.tab.journey'), build: () => pyramidJourney(m, P) },
      { id: 'coverage', label: T('py.tab.coverage'), build: () => coverageCard(m, P) || el('div', {}) },
      { id: 'gaps', label: T('py.tab.gaps'), count: P.summary.under + P.summary.isolated,
        build: () => gapsCard() }
    ], params));
    return f;

    /* ---- the sections ---- */

    function minedRulesCard() {
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
        conds: node.path.map(x => ({ attr: x.attr, field: x.byId ? 'ExternalId' : 'Name',
          value: x.value, label: x.label })),
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
      conds: group.conds.map(c => ({ attr: c.attr, field: c.byId ? 'ExternalId' : 'Name',
        value: c.value, label: c.label })),
      level: 99,
      members: group.members.length,
      grants: group.rules,
      entitlements: group.rules.length,
      minCoverage: Math.min.apply(null, group.rules.map(g => g.coverage)),
      missing: new Set(group.rules.flatMap(g => g.missing)).size,
      node: null
    })));

    return card(T('py.rulesTitle'), T('py.rulesNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('py.cRule'), value: r => r.name,
          render: r => el('a', { href: '#', text: r.name, title: conditionText(r),
            onclick: e => { e.preventDefault(); drawerPyramidRule(m, P, r); } }) },
        { key: 'level', label: T('py.cLevel'), value: r => r.level,
          render: r => r.level === 99
            ? el('span', { class: 'pill muted', text: T('py.kind.' + r.kind) })
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
    }));
    }

    function gapsCard() {
    const wrap = el('div', {});
    /* ---- what the model says is wrong ---- */
    const under = P.stats.under.slice(0, 400).map(u => ({
      person: u.person.name, ent: m.permissions.get(u.ent), coverage: u.coverage,
      where: u.node ? (u.node.path.map(x => x.label || x.value).join(' › ') || T('py.everyone'))
        : u.combo.conds.map(c => c.label || c.value).join(' + ')
    }));
    if (under.length) {
      wrap.appendChild(card(T('py.underTitle'), T('py.underNote'), HR.table.make({
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
      wrap.appendChild(card(T('py.pollutionTitle'), T('py.pollutionNote'), HR.table.make({
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
    if (!wrap.childNodes.length) {
      wrap.appendChild(card(T('py.gapsNone'), null,
        el('p', { class: 'note', text: T('py.gapsNoneNote') })));
    }
    return wrap;
    }
  }
  HR.views.org = orgView;
  HR.views.mining = pyramidView;
  /* The view was called the role pyramid before it was one of two miners; old hashes
     and pinned favourites still point at that name. */
  HR.views.pyramid = pyramidView;
})(window.HR);
