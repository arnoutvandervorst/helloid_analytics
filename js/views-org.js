/* The organisation walker and the role pyramid.

   Split out of views.js, which had grown past three and a half thousand lines. These use
   the shared building blocks views.js publishes on HR.viewkit rather than importing
   anything: the page has no module system by design, so the seam is an object rather
   than an import list. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, C = HR.charts;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, scoreBar, dl, partialNotice, personRow, peopleIndex,
    drawerPermission, drawerVaultPerson, openDrawer, STATE_SEV, stateLabel } = HR.viewkit;

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
  HR.views.org = orgView;
  HR.views.pyramid = pyramidView;
})(window.HR);
