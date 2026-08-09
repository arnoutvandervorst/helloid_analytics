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
    f.appendChild(tabbed('conventions', [
      { id: 'accounts', label: T('cv.tab.accounts'),
        count: res.usernames.summary.mixed || null, build: () => accountsTab(m, res.usernames) },
      { id: 'entitlements', label: T('cv.tab.entitlements'),
        count: res.entitlements.summary.strays || null, build: () => entitlementsTab(m, res.entitlements) }
    ], params));
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
  const familyPattern = prefix => '^' + HR.mine.escapeRx(prefix) + '(?=[-_. ]|$)';
  const suffixPattern = sfx => '[-_.]' + HR.mine.escapeRx(sfx) + '$';

  const rulePatternExists = pattern =>
    HR.config.get().categories.some(c => c.pattern === pattern);

  function addCategoryRule(label, pattern, sensitivity) {
    const cfg = HR.config.clone(HR.config.get());
    /* Mined rules are more specific than the catch-all, so they go in front of it —
       the same placement the import review uses. */
    const at = cfg.categories.findIndex(c => c.id === 'other');
    cfg.categories.splice(at < 0 ? cfg.categories.length : at, 0, {
      id: 'mined-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label, pattern, sensitivity, color: 2
    });
    HR.config.save(cfg);
    HR.app.rebuild();
    U.toast(T('cv.ruleAdded', { label }), 5000);
  }

  function ruleCell(label, pattern, sensitivity) {
    if (rulePatternExists(pattern)) return el('span', { class: 'pill ok', text: T('cv.ruleExists') });
    return el('button', {
      class: 'btn sm', text: T('cv.addRule'),
      onclick: e => { e.stopPropagation(); addCategoryRule(label, pattern, sensitivity); }
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
                return ruleCell(r.prefix, familyPattern(r.prefix), hint ? hint.sensitivity : 1.0);
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
              render: r => ruleCell(r.suffix, suffixPattern(r.suffix), 1.0) }
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
    const pattern = familyPattern(f.prefix);
    const head = el('div', {}, [
      el('h2', { text: f.prefix + (sys.sep || '') + '…' }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: U.fmtInt(f.count) + ' ' + T('pm.title').toLowerCase() }),
        d ? el('span', { class: d.other ? 'pill removed' : 'pill', text: d.label + ' · ' + U.fmtPct(d.share, 0) }) : null,
        el('span', { class: 'pill', text: T('cv.cSens') + ' ' + U.fmtNum(meanSens(f.perms), 1) }),
        ruleCell(f.prefix, pattern, hint ? hint.sensitivity : 1.0)
      ])
    ]);
    const body = el('div', { class: 'stack' });
    body.appendChild(el('p', { class: 'note', text: T('cv.familyPattern', { pattern }) }));
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

  HR.views.conventions = conventionsView;
})(window.HR);
