/* Naming conventions: what the account and group names say about the tenant's history.

   Split out like the other view files: built on HR.viewkit, no module system by design. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, tabbed, drawerAccount, drawerPermission } = HR.viewkit;

  function conventionsView(m, params) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('cv.title') }),
      el('p', { text: T('cv.lead') })
    ])));

    const res = HR.conventions.build(m);
    const dir = HR.app.state.directory;
    const ng = dir ? HR.conventions.namegen(dir.users) : null;
    f.appendChild(tabbed('conventions', [
      { id: 'accounts', label: T('cv.tab.accounts'),
        count: res.usernames.summary.mixed || null, build: () => accountsTab(m, res.usernames) },
      { id: 'entitlements', label: T('cv.tab.entitlements'),
        count: res.entitlements.summary.strays || null, build: () => entitlementsTab(m, res.entitlements) },
      res.attributes ? { id: 'attributes', label: T('cv.tab.attributes'),
        count: res.attributes.summary.candidates || null, build: () => attributesTab(m, res.attributes) } : null,
      (ng || (dir && dir.meta.tenant)) ? { id: 'namegen', label: T('cv.tab.namegen'),
        build: () => namegenTab(dir, ng) } : null
    ].filter(Boolean), params));
    return f;
  }

  /* ------------------------------------------------------------- usernames */
  function accountsTab(m, un) {
    const wrap = document.createDocumentFragment();

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('cv.kSystems'), U.fmtInt(un.summary.systems), T('cv.kSystemsFoot'), { small: true }),
      tile(T('cv.kMixed'), U.fmtInt(un.summary.mixed), T('cv.kMixedFoot'),
        { small: true, severity: un.summary.mixed ? 'medium' : 'good' }),
      tile(T('cv.kStyles'), U.fmtInt(un.summary.styles), T('cv.kStylesFoot'), { small: true }),
      tile(T('cv.kAccounts'), U.fmtInt(m.accountList.length), T('cv.kAccountsFoot'), { small: true })
    );
    wrap.appendChild(k);

    for (const sys of un.systems) {
      const topClass = st => {
        const c = Array.from(st.classes.entries()).sort((a, b) => b[1] - a[1])[0];
        return c ? c[0] : '—';
      };
      wrap.appendChild(card(sys.system, T('cv.sysNote', { n: U.fmtInt(sys.total), styles: sys.styles.length }), [
        sys.mixed
          ? el('div', { class: 'notice' }, [
              el('strong', { text: T('cv.mixedFlag') }),
              el('span', { text: ' ' + T('cv.mixedWhy', { n: sys.major.length }) })
            ])
          : null,
        HR.table.make({
          columns: [
            { key: 'sig', label: T('cv.cStyle'), render: r => el('span', { class: 'mono', text: r.sig || '—' }) },
            { key: 'count', label: T('ov.accounts'), num: true },
            { key: 'share', label: T('cv.cShare'), num: true, value: r => r.share,
              render: r => el('span', {
                class: r.share >= 0.10 && r !== sys.styles[0] ? 'sev medium' : '',
                text: U.fmtPct(r.share, 1) }) },
            { key: 'enabled', label: T('c.enabled'), num: true },
            { key: 'cls', label: T('c.class'), value: r => topClass(r) },
            { key: 'examples', label: T('cv.cExamples'), sortable: false,
              render: r => el('span', { class: 'mono trunc', title: r.examples.join(', '),
                text: r.examples.slice(0, 4).join(', ') }) }
          ],
          rows: sys.styles, pageSize: 10, exportName: 'username-styles-' + sys.system,
          onRowClick: r => drawerStyle(m, sys.system, r)
        }),
        el('p', { class: 'note', text: T('cv.styleFoot') })
      ].filter(Boolean)));
    }
    return wrap;
  }

  /** Every account written in one style — the cohort a migration left behind. */
  function drawerStyle(m, system, style) {
    const head = el('div', {}, [
      el('h2', { text: system + ' · ' + (style.sig || '—') }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: T('cv.drCount', { n: U.fmtInt(style.count) }) }),
        el('span', { class: 'pill', text: U.fmtPct(style.share, 1) })
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(card(null, null, HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account'), render: r => el('span', { class: 'mono', text: r.userName }) },
        { key: 'personName', label: T('c.person'), render: r => r.personRaw ? el('span', { text: r.personName }) : el('span', { class: 'sev critical', text: T('c.unowned') }) },
        { key: 'clsLabel', label: T('c.class') },
        { key: 'enabled', label: T('c.state'), value: r => T(r.enabled === false ? 'c.disabled' : 'c.enabled') },
        { key: 'permCount', label: T('c.perms'), num: true }
      ],
      rows: style.accounts, pageSize: 15, exportName: 'style-' + system,
      search: (r, q) => (r.userName + ' ' + (r.personRaw || '')).toLowerCase().includes(q),
      onRowClick: a => drawerAccount(a)
    })));
    HR.viewkit.openDrawer(head, body);
  }

  /* ---------------------------------------------------------- entitlements */

  /* The families and suffixes are not just history — they are the vocabulary the
     permission taxonomy should be written in. Each one can become a category rule;
     the row shows how the current settings already carve it, so a family that is
     100% uncategorised is a visible classification gap. */
  /* Rules mined here land as structured matchers, not regex — the separator is
     known per system, so "starts with ORG-" says exactly what the lookahead said. */
  const familySpec = (prefix, sep) => ({ op: 'starts', value: prefix + (sep || '') });
  const suffixSpec = (sfx, sep) => ({ op: 'ends', value: (sep || '-') + sfx });

  const rulePatternExists = pattern =>
    HR.config.get().categories.some(c => c.pattern === pattern);

  function addCategoryRule(label, spec, sensitivity) {
    const cfg = HR.config.clone(HR.config.get());
    /* Mined rules are more specific than the catch-all, so they go in front of it —
       the same placement the import review uses. */
    const at = cfg.categories.findIndex(c => c.id === 'other');
    cfg.categories.splice(at < 0 ? cfg.categories.length : at, 0, {
      id: 'mined-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label, pattern: HR.config.compileMatch(spec), match: spec, sensitivity, color: 2
    });
    HR.config.save(cfg);
    HR.app.rebuildBusy().then(() => U.toast(T('cv.ruleAdded', { label }), 5000));
  }

  function ruleCell(label, spec, sensitivity) {
    if (rulePatternExists(HR.config.compileMatch(spec))) return el('span', { class: 'pill ok', text: T('cv.ruleExists') });
    return el('button', {
      class: 'btn sm', text: T('cv.addRule'),
      onclick: e => { e.stopPropagation(); addCategoryRule(label, spec, sensitivity); }
    });
  }

  /** Where a set of permissions lands in the current taxonomy: [label, share, isCatchAll]. */
  function dominantCategory(perms) {
    const per = new Map();
    perms.forEach(p => {
      if (!per.has(p.categoryLabel)) per.set(p.categoryLabel, { n: 0, other: p.category === 'other' });
      per.get(p.categoryLabel).n++;
    });
    const top = Array.from(per.entries()).sort((a, b) => b[1].n - a[1].n)[0];
    return top ? { label: top[0], share: top[1].n / perms.length, other: top[1].other } : null;
  }

  const meanSens = perms => perms.length ? U.sum(perms, p => p.sensitivity) / perms.length : 0;

  /* Share of names that follow a family scheme, written in that scheme's dominant
     casing — one factual number for "how healthy is this naming", no weighting. */
  const disciplineOf = sys => sys.total
    ? Math.max(0, (sys.familyShare * sys.total - sys.offCase) / sys.total) : 1;
  const disciplineSeverity = d => d >= 0.9 ? 'good' : d >= 0.7 ? 'medium' : 'high';

  function entitlementsTab(m, en) {
    const wrap = document.createDocumentFragment();

    const totalNames = U.sum(en.systems, s => s.total);
    const inScheme = U.sum(en.systems, s => Math.round(disciplineOf(s) * s.total));
    const discipline = totalNames ? inScheme / totalNames : 1;

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('cv.kDiscipline'), U.fmtPct(discipline, 0), T('cv.kDisciplineFoot'),
        { small: true, severity: disciplineSeverity(discipline) }),
      tile(T('cv.kFamilies'), U.fmtInt(en.summary.families), T('cv.kFamiliesFoot'), { small: true }),
      tile(T('cv.kStrays'), U.fmtInt(en.summary.strays), T('cv.kStraysFoot'),
        { small: true, severity: en.summary.strays ? 'medium' : 'good' }),
      tile(T('cv.kOffCase'), U.fmtInt(en.summary.offCase), T('cv.kOffCaseFoot'),
        { small: true, severity: en.summary.offCase ? 'medium' : 'good' })
    );
    wrap.appendChild(k);

    for (const sys of en.systems) {
      const blocks = [];
      blocks.push(el('p', { text: T('cv.entLead', {
        share: U.fmtPct(sys.familyShare, 0),
        sep: sys.sep ? '"' + sys.sep + '"' : '—',
        families: sys.families.length }) }));
      const disc = disciplineOf(sys);
      blocks.push(el('p', { class: 'note' }, [
        el('span', { class: 'sev ' + disciplineSeverity(disc), text: U.fmtPct(disc, 0) }),
        document.createTextNode(' ' + T('cv.discLine', {
          n: U.fmtInt(Math.round(disc * sys.total)), total: U.fmtInt(sys.total) }))
      ]));

      if (sys.families.length) {
        blocks.push(HR.table.make({
          columns: [
            { key: 'prefix', label: T('cv.cFamily'), render: r => el('span', { class: 'mono', text: r.prefix + (sys.sep || '') + '…' }) },
            { key: 'count', label: T('pm.title'), num: true },
            { key: 'share', label: T('cv.cShare'), num: true, value: r => r.count / sys.total,
              render: r => U.fmtPct(r.count / sys.total, 1) },
            { key: 'category', label: T('cv.cCategory'), value: r => { const d = dominantCategory(r.perms); return d ? d.label : '—'; },
              render: r => {
                const d = dominantCategory(r.perms);
                if (!d) return el('span', { text: '—' });
                return el('span', { class: d.other ? 'sev medium' : 'pill',
                  text: d.label + (d.share < 1 ? ' · ' + U.fmtPct(d.share, 0) : '') });
              } },
            { key: 'sens', label: T('cv.cSens'), num: true, value: r => meanSens(r.perms),
              render: r => U.fmtNum(meanSens(r.perms), 1) },
            { key: 'suffixes', label: T('cv.cSuffixes'), sortable: false,
              render: r => el('span', { class: 'trunc', text: Array.from(r.suffixes.entries())
                .sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0] + ' ×' + x[1]).join('  ') || '—' }) },
            { key: 'offCase', label: T('cv.cOffCase'), num: true,
              render: r => r.offCase
                ? el('span', { class: 'sev medium', text: String(r.offCase) })
                : el('span', { class: 'note', text: '0' }) },
            { key: 'rule', label: '', sortable: false, render: r => {
                const hint = HR.mine.hintFor(r.prefix);
                return ruleCell(r.prefix, familySpec(r.prefix, sys.sep), hint ? hint.sensitivity : 1.0);
              } }
          ],
          rows: sys.families, pageSize: 8, exportName: 'ent-families-' + sys.system,
          onRowClick: r => drawerFamily(m, sys, r)
        }));
      }

      if (sys.vocab.length) {
        blocks.push(el('h3', { text: T('cv.suffixTitle') }));
        blocks.push(HR.table.make({
          columns: [
            { key: 'suffix', label: T('cv.cSuffix'), render: r => el('span', { class: 'mono', text: '…' + (sys.sep || '-') + r.suffix }) },
            { key: 'count', label: T('pm.title'), num: true },
            { key: 'families', label: T('cv.cFamiliesCol'), num: true },
            { key: 'rule', label: '', sortable: false,
              render: r => ruleCell(r.suffix, suffixSpec(r.suffix, sys.sep), 1.0) }
          ],
          rows: sys.vocab.slice(0, 12), pageSize: 12, exportName: 'ent-suffixes-' + sys.system
        }));
      }

      if (sys.strays.length) {
        blocks.push(el('h3', { text: T('cv.straysTitle', { n: U.fmtInt(sys.strays.length) }) }));
        blocks.push(HR.table.make({
          columns: [
            { key: 'name', label: T('ct.group'), value: r => r.perm.name,
              render: r => el('span', { class: 'mono', text: r.perm.name }) },
            { key: 'why', label: T('cv.cWhy'), value: r => r.why,
              render: r => el('span', { class: 'pill' + (r.why === 'nearFamily' ? ' removed' : ''),
                text: T('cv.why.' + r.why) }) },
            { key: 'holders', label: T('c.holders'), num: true, value: r => r.perm.holderCount }
          ],
          rows: sys.strays, pageSize: 10, exportName: 'ent-strays-' + sys.system,
          search: (r, q) => r.perm.name.toLowerCase().includes(q),
          onRowClick: r => drawerPermission(r.perm, m)
        }));
      }
      blocks.push(el('p', { class: 'note', text: T('cv.entFoot') }));
      wrap.appendChild(card(sys.system, T('cv.entNote', { n: U.fmtInt(sys.total) }), blocks));
    }
    return wrap;
  }

  /** One family opened up: every member, how it classifies today, and the rule action. */
  function drawerFamily(m, sys, f) {
    const d = dominantCategory(f.perms);
    const hint = HR.mine.hintFor(f.prefix);
    const spec = familySpec(f.prefix, sys.sep);
    const head = el('div', {}, [
      el('h2', { text: f.prefix + (sys.sep || '') + '…' }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: U.fmtInt(f.count) + ' ' + T('pm.title').toLowerCase() }),
        d ? el('span', { class: d.other ? 'pill removed' : 'pill', text: d.label + ' · ' + U.fmtPct(d.share, 0) }) : null,
        el('span', { class: 'pill', text: T('cv.cSens') + ' ' + U.fmtNum(meanSens(f.perms), 1) }),
        ruleCell(f.prefix, spec, hint ? hint.sensitivity : 1.0)
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(el('p', { class: 'note', text: T('cv.familyRule', { value: spec.value }) }));
    body.appendChild(card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('ct.group'), render: r => el('span', { class: 'mono', text: r.name }) },
        { key: 'categoryLabel', label: T('c.category') },
        { key: 'sensitivity', label: T('c.sensitivity'), num: true, render: r => U.fmtNum(r.sensitivity, 1) },
        { key: 'holderCount', label: T('c.holders'), num: true },
        { key: 'riskScore', label: T('c.risk'), num: true }
      ],
      rows: f.perms, pageSize: 15, exportName: 'family-' + f.prefix,
      initialSort: { key: 'holderCount', dir: -1 },
      search: (r, q) => r.name.toLowerCase().includes(q),
      onRowClick: p => drawerPermission(p, m)
    })));
    HR.viewkit.openDrawer(head, body);
  }

  /* ----------------------------------------------------------- attributes */
  /* What the paperwork can carry: per attribute the fill and spread, and the
     value→group pairs strong enough to become a business-rule condition or a
     connector mapping. The floors and the lift filter live in conventions.js. */
  function attributesTab(m, at) {
    const wrap = document.createDocumentFragment();

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('cv.kAttrs'), U.fmtInt(at.summary.attributes), T('cv.kAttrsFoot'), { small: true }),
      tile(T('cv.kUsable'), U.fmtInt(at.summary.usable), T('cv.kUsableFoot'),
        { small: true, severity: at.summary.usable ? 'good' : 'medium' }),
      tile(T('cv.kCandidates'), U.fmtInt(at.summary.candidates), T('cv.kCandidatesFoot'),
        { small: true, severity: at.summary.candidates ? 'good' : 'none' }),
      tile(T('pp.persons'), U.fmtInt(at.summary.persons), T('cv.kIndexedFoot', { n: U.fmtInt(at.summary.indexed) }), { small: true })
    );
    wrap.appendChild(k);

    wrap.appendChild(card(T('cv.attrTitle'), T('cv.attrNote'), HR.table.make({
      columns: [
        { key: 'key', label: T('cv.cAttr'), render: r => el('span', { class: r.custom ? 'mono' : '', text: r.key }) },
        { key: 'fillPct', label: T('cv.cFill'), num: true, value: r => r.fillPct,
          render: r => el('span', { class: r.fillPct >= 0.5 ? '' : 'sev medium', text: U.fmtPct(r.fillPct, 0) }) },
        { key: 'distinct', label: T('cv.cDistinct'), num: true },
        { key: 'top', label: T('cv.cTopValues'), sortable: false,
          render: r => el('span', { class: 'trunc', title: r.top.slice(0, 12).map(x => x.value + ' ×' + x.n).join(', '),
            text: r.top.slice(0, 5).map(x => x.value + ' ×' + x.n).join('  ') }) }
      ],
      rows: at.fields, pageSize: 25, exportName: 'attributes',
      initialSort: { key: 'fillPct', dir: -1 },
      onRowClick: r => drawerAttribute(r)
    })));

    if (at.candidates.length) {
      wrap.appendChild(card(T('cv.candTitle'), T('cv.candNote'), HR.table.make({
        columns: [
          { key: 'attribute', label: T('cv.cAttr') },
          { key: 'value', label: T('cv.cValue'), render: r => el('span', { class: 'mono', text: r.value }) },
          { key: 'group', label: T('ct.group'), render: r => el('span', { class: 'mono', text: r.group }) },
          { key: 'n', label: T('cv.cHoldsIt'), num: true, value: r => r.n,
            render: r => U.fmtInt(r.n) + ' / ' + U.fmtInt(r.m) },
          { key: 'share', label: T('cv.cShare'), num: true, value: r => r.share,
            render: r => U.fmtPct(r.share, 0) },
          { key: 'lift', label: T('cv.cLift'), num: true, render: r => '×' + U.fmtNum(r.lift, 1),
            hint: T('cv.liftHint') }
        ],
        rows: at.candidates, pageSize: 20, exportName: 'rule-candidates',
        search: (r, q) => (r.attribute + ' ' + r.value + ' ' + r.group).toLowerCase().includes(q)
      })));
    } else if (!at.summary.indexed) {
      wrap.appendChild(el('div', { class: 'notice' }, [
        el('strong', { text: T('cv.noIndex') }),
        el('span', { text: ' ' + T('cv.noIndexWhy') })
      ]));
    }
    return wrap;
  }

  /** One attribute opened up: its full value distribution. */
  function drawerAttribute(f) {
    const head = el('div', {}, [
      el('h2', { text: f.key }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: U.fmtPct(f.fillPct, 0) + ' ' + T('cv.cFill').toLowerCase() }),
        el('span', { class: 'pill', text: U.fmtInt(f.distinct) + ' ' + T('cv.cDistinct').toLowerCase() })
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(card(null, null, HR.table.make({
      columns: [
        { key: 'value', label: T('cv.cValue'), render: r => el('span', { class: 'mono', text: r.value }) },
        { key: 'n', label: T('pp.persons'), num: true }
      ],
      rows: f.top, pageSize: 25, exportName: 'attribute-' + f.key,
      initialSort: { key: 'n', dir: -1 },
      search: (r, q) => r.value.toLowerCase().includes(q)
    })));
    HR.viewkit.openDrawer(head, body);
  }

  /* ------------------------------------------------------- name generation */
  /* The connector intake, answered from the tenant instead of from memory: the
     connection facts, the dominant convention per generated field rendered with
     the intake's own example person, and the countable yes/no facts. */
  const NG_SAMPLE = { first: 'janine', f: 'j', last: 'vandenboele', bare: 'boele', vd: 'vdboele' };
  const NG_DN_SAMPLE = {
    'first last': 'Janine van den Boele',
    'last, first': 'van den Boele, Janine',
    'givennames last': 'Hendrika Cornelia van den Boele',
    'first bare': 'Janine Boele'
  };

  function ngExample(id) {
    const sep = (id.match(/[.\-_+]/) || [''])[0];
    const tokens = sep ? id.split(sep) : [id];
    return tokens.map(t => NG_SAMPLE[t] || t).join(sep === '+' ? '' : sep);
  }
  function ngLabel(id) {
    return id.replace(/first|last|bare|vd|f/g, t => T('cv.ng.tok.' + t)).replace(/\+/g, '·');
  }

  function namegenTab(dir, ng) {
    const wrap = document.createDocumentFragment();
    const tenant = dir.meta.tenant;

    if (tenant) {
      wrap.appendChild(card(T('cv.ngTenant'), T('cv.ngTenantNote'), el('dl', { class: 'kv' }, [
        [T('cv.ngTenantId'), tenant.tenantId],
        [T('cv.ngInitialDomain'), tenant.initialDomain],
        [T('cv.ngDefaultDomain'), tenant.defaultDomain],
        [T('cv.ngDomains'), (tenant.verifiedDomains || []).join(', ')]
      ].filter(x => x[1]).flatMap(([k, v]) => [
        el('dt', { text: k }), el('dd', {}, el('span', { class: 'mono', text: v }))
      ]))));
    }

    if (ng) {
      const rows = ng.fields.map(f => ({
        field: T('cv.ng.field.' + f.key),
        best: f.res.best, total: f.res.total, exceptions: f.res.exceptions,
        iterated: f.res.iterated, maxIter: f.res.maxIter,
        runners: f.res.ranked.slice(1)
      }));
      if (ng.displayName.ranked.length) {
        const d = ng.displayName;
        rows.push({
          field: T('cv.ng.field.displayName'),
          best: d.ranked[0], total: d.total, exceptions: d.total - d.matched,
          iterated: 0, maxIter: 0, runners: d.ranked.slice(1), dn: true
        });
      }
      wrap.appendChild(card(T('cv.ngFieldsTitle'), T('cv.ngFieldsNote'), HR.table.make({
        columns: [
          { key: 'field', label: T('cv.ngField') },
          { key: 'best', label: T('cv.ngConvention'), sortable: false, render: r => r.best
              ? el('span', { class: 'mono', title: r.dn ? r.best.id : ngLabel(r.best.id),
                  text: r.dn ? (NG_DN_SAMPLE[r.best.id] || r.best.id) : ngExample(r.best.id) })
              : el('span', { class: 'note', text: '—' }) },
          { key: 'pct', label: T('cv.ngCoverage'), num: true, value: r => r.best ? r.best.pct : 0,
            render: r => r.best
              ? el('span', { class: 'sev ' + (r.best.pct >= 0.8 ? 'good' : r.best.pct >= 0.5 ? 'medium' : 'high'),
                  text: U.fmtPct(r.best.pct, 0) })
              : el('span', { text: '—' }) },
          { key: 'runners', label: T('cv.ngRunners'), sortable: false,
            render: r => el('span', { class: 'note trunc', text: r.runners.length
              ? r.runners.map(x => (r.dn ? (NG_DN_SAMPLE[x.id] || x.id) : ngExample(x.id)) + ' ×' + x.n).join('  ') : '—' }) },
          { key: 'iterated', label: T('cv.ngIter'), num: true,
            render: r => r.iterated ? U.fmtInt(r.iterated) + ' · max ' + r.maxIter : '0' },
          { key: 'exceptions', label: T('cv.ngExc'), num: true,
            render: r => r.exceptions
              ? el('span', { class: 'sev medium', text: U.fmtInt(r.exceptions) })
              : el('span', { class: 'note', text: '0' }) }
        ],
        rows, pageSize: 10, exportName: 'name-generation'
      })));

      const pct = (n, m) => m ? U.fmtInt(n) + ' / ' + U.fmtInt(m) + ' · ' + U.fmtPct(n / m, 0) : '—';
      const factRows = [
        [T('cv.ngUpnEqMail'), pct(ng.upnEqMail.n, ng.upnEqMail.m)],
        [T('cv.ngUpnDomains'), ng.upnDomains.slice(0, 4).map(([d, n]) => d + ' ×' + U.fmtInt(n)).join(' · ')],
        [T('cv.ngMailDomains'), ng.mailDomains.slice(0, 4).map(([d, n]) => d + ' ×' + U.fmtInt(n)).join(' · ')],
        ng.proxies.users ? [T('cv.ngPrimaryEqMail'), pct(ng.proxies.primaryEqMail, ng.proxies.users)] : null,
        ng.proxies.aliasDomains.length ? [T('cv.ngAliasDomains'),
          ng.proxies.aliasDomains.slice(0, 5).map(([d, n]) => d + ' ×' + U.fmtInt(n)).join(' · ')] : null,
        [T('cv.ngManagerFill'), pct(ng.managerFill.n, ng.managerFill.m)],
        ng.usage.length ? [T('cv.ngUsage'), ng.usage.slice(0, 4).map(([v, n]) => v + ' ×' + U.fmtInt(n)).join(' · ')] : null,
        ng.synced ? [T('cv.ngSynced'), U.fmtInt(ng.synced)] : null
      ].filter(Boolean);
      wrap.appendChild(card(T('cv.ngFacts'), T('cv.ngFactsNote'), el('dl', { class: 'kv' },
        factRows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]))));
      wrap.appendChild(el('p', { class: 'note', text: T('cv.ngFoot', {
        n: U.fmtInt(ng.parts), total: U.fmtInt(ng.users) }) }));
    } else {
      wrap.appendChild(el('div', { class: 'notice' }, [
        el('strong', { text: T('cv.ngNoParts') }),
        el('span', { text: ' ' + T('cv.ngNoPartsWhy') })
      ]));
    }
    return wrap;
  }

  HR.views.conventions = conventionsView;
})(window.HR);
