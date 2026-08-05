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
  function entitlementsTab(m, en) {
    const wrap = document.createDocumentFragment();

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('cv.kFamilies'), U.fmtInt(en.summary.families), T('cv.kFamiliesFoot'), { small: true }),
      tile(T('cv.kStrays'), U.fmtInt(en.summary.strays), T('cv.kStraysFoot'),
        { small: true, severity: en.summary.strays ? 'medium' : 'good' }),
      tile(T('cv.kOffCase'), U.fmtInt(en.summary.offCase), T('cv.kOffCaseFoot'),
        { small: true, severity: en.summary.offCase ? 'medium' : 'good' }),
      tile(T('cv.kEnts'), U.fmtInt(m.permissionList.length), T('cv.kEntsFoot'), { small: true })
    );
    wrap.appendChild(k);

    for (const sys of en.systems) {
      const blocks = [];
      blocks.push(el('p', { text: T('cv.entLead', {
        share: U.fmtPct(sys.familyShare, 0),
        sep: sys.sep ? '"' + sys.sep + '"' : '—',
        families: sys.families.length }) }));

      if (sys.families.length) {
        blocks.push(HR.table.make({
          columns: [
            { key: 'prefix', label: T('cv.cFamily'), render: r => el('span', { class: 'mono', text: r.prefix + (sys.sep || '') + '…' }) },
            { key: 'count', label: T('pm.title'), num: true },
            { key: 'share', label: T('cv.cShare'), num: true, value: r => r.count / sys.total,
              render: r => U.fmtPct(r.count / sys.total, 1) },
            { key: 'suffixes', label: T('cv.cSuffixes'), sortable: false,
              render: r => el('span', { class: 'trunc', text: Array.from(r.suffixes.entries())
                .sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0] + ' ×' + x[1]).join('  ') || '—' }) },
            { key: 'offCase', label: T('cv.cOffCase'), num: true,
              render: r => r.offCase
                ? el('span', { class: 'sev medium', text: String(r.offCase) })
                : el('span', { class: 'note', text: '0' }) }
          ],
          rows: sys.families, pageSize: 8, exportName: 'ent-families-' + sys.system
        }));
      }

      if (sys.vocab.length) {
        blocks.push(el('p', { class: 'note', text: T('cv.vocab', {
          list: sys.vocab.slice(0, 10).map(v => v.suffix + ' ×' + U.fmtInt(v.count)).join(' · ') }) }));
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

  HR.views.conventions = conventionsView;
})(window.HR);
