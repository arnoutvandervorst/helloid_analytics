/* Evidence: what administrators decided in HelloID, read from the audit log.

   The compliance page says whether a control is met; this page says who decided the
   exceptions to it — which reconciliation issues were excluded, by whom, why and until
   when; which threshold was waved through; which rule was published with which
   entitlements. It is the part of an audit that used to be "ask the administrator". */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, drawerAccount, tabbed, partialNotice } = HR.viewkit;

  const day = d => d ? U.fmtDate(d).split(',')[0] : '—';
  const who = r => r.userName || '—';

  /** The account in the model an exclusion points at, when the reconciliation is loaded. */
  function accountOf(m, x) {
    if (!m || !m.hasRecon) return null;
    const sys = String(x.system || '').toLowerCase();
    const local = x.account;
    return m.accountList.find(a => HR.fit.localOf(a.userName) === local && (!sys || String(a.system).toLowerCase() === sys)) || null;
  }

  /** Does the account still hold the excluded permission today? null when it cannot be told. */
  function stillHeld(m, x, account) {
    if (!account) return null;
    if (x.accountLevel) return account.enabled !== false;
    const want = String(x.permission || '').toLowerCase();
    return account.perms.some(p => String(p.name || '').toLowerCase() === want);
  }

  /* ------------------------------------------------------------ decisions */
  function decisionsTab(m, audit) {
    const now = new Date();
    const wrap = el('div', {});
    const active = audit.exclusions.filter(x => !x.until || x.until >= now);
    const expired = audit.exclusions.filter(x => x.until && x.until < now);
    const noReason = audit.exclusions.filter(x => !String(x.comment || '').trim());
    wrap.appendChild(el('div', { class: 'grid g4', style: 'margin-bottom:14px' }, [
      tile(T('au.kExclusions'), U.fmtInt(audit.exclusions.length), T('au.kExclusionsFoot', { active: U.fmtInt(active.length), expired: U.fmtInt(expired.length) }),
        { severity: noReason.length ? 'medium' : 'good' }),
      tile(T('au.kNoReason'), U.fmtInt(noReason.length), T('au.kNoReasonFoot'), { severity: noReason.length ? 'high' : 'good', small: true }),
      tile(T('au.kThresholds'), U.fmtInt(audit.thresholds.length), T('au.kThresholdsFoot'), { small: true }),
      tile(T('au.kUnmanaged'), U.fmtInt(audit.entitlements.filter(r => /unmanage/i.test(r.action)).length), T('au.kUnmanagedFoot'), { small: true })
    ]));

    const rows = audit.exclusions.map(x => {
      const account = accountOf(m, x);
      return Object.assign({ _account: account, _held: stillHeld(m, x, account), _expired: !!(x.until && x.until < now) }, x);
    });
    wrap.appendChild(card(T('au.exclusionsTitle'), T('au.exclusionsNote'), HR.table.make({
      columns: [
        { key: 'at', label: T('au.cWhen'), value: r => r.at ? +r.at : 0, render: r => el('span', { class: 'nowrap', text: day(r.at) }) },
        { key: 'who', label: T('au.cWho'), value: who },
        { key: 'person', label: T('c.person'), value: r => r.person || '' },
        { key: 'account', label: T('c.account'), value: r => r.accountUserName || '' },
        { key: 'system', label: T('c.system'), value: r => r.system || '' },
        { key: 'permission', label: T('c.permission'), value: r => r.accountLevel ? T('au.wholeAccount') : (r.permission || '') },
        { key: 'issue', label: T('au.cIssue'), value: r => r.issue || '' },
        { key: 'until', label: T('au.cUntil'), value: r => r.until ? +r.until : 0,
          render: r => el('span', { class: 'nowrap' + (r._expired ? ' sev medium' : ''), text: r.until ? day(r.until) : '—' }) },
        { key: 'comment', label: T('au.cReason'), value: r => r.comment || '',
          render: r => String(r.comment || '').trim() ? el('span', { text: r.comment }) : el('span', { class: 'sev high', text: T('au.noReason') }) },
        { key: 'held', label: T('au.cHeld'), value: r => r._held === null ? -1 : r._held ? 1 : 0,
          render: r => r._held === null ? el('span', { class: 'note', text: '—' })
            : el('span', { class: 'pill ' + (r._held ? 'warn' : 'ok'), text: T(r._held ? 'au.heldYes' : 'au.heldNo') }) }
      ],
      rows, pageSize: 25, exportName: 'helloid-exclusions', initialSort: { key: 'at', dir: -1 },
      search: (r, q) => [r.person, r.accountUserName, r.permission, r.comment, r.userName].join(' ').toLowerCase().includes(q),
      onRowClick: r => { if (r._account) drawerAccount(r._account); }
    })));

    wrap.appendChild(card(T('au.thresholdsTitle'), T('au.thresholdsNote'), HR.table.make({
      columns: [
        { key: 'at', label: T('au.cWhen'), value: r => r.at ? +r.at : 0, render: r => el('span', { class: 'nowrap', text: day(r.at) }) },
        { key: 'who', label: T('au.cWho'), value: who },
        { key: 'system', label: T('c.system'), value: r => r.systemName || '' },
        { key: 'action', label: T('au.cAction'), value: r => r.action || '' },
        { key: 'what', label: T('au.cWhat'), value: r => r.description || '' }
      ],
      rows: audit.thresholds, pageSize: 10, exportName: 'helloid-thresholds', initialSort: { key: 'at', dir: -1 }
    })));

    const unm = audit.entitlements.filter(r => /unmanage/i.test(r.action));
    if (unm.length) wrap.appendChild(card(T('au.unmanagedTitle'), T('au.unmanagedNote'), HR.table.make({
      columns: [
        { key: 'at', label: T('au.cWhen'), value: r => r.at ? +r.at : 0, render: r => el('span', { class: 'nowrap', text: day(r.at) }) },
        { key: 'who', label: T('au.cWho'), value: who },
        { key: 'person', label: T('c.person'), value: r => r.person || '' },
        { key: 'system', label: T('c.system'), value: r => r.systemName || '' },
        { key: 'ent', label: T('au.cEntitlement'), value: r => r.entitlement || '' }
      ],
      rows: unm, pageSize: 10, exportName: 'helloid-unmanaged', initialSort: { key: 'at', dir: -1 }
    })));
    return wrap;
  }

  /* --------------------------------------------------------- rule changes */
  function rulesTab(m, audit) {
    const wrap = el('div', {});
    const pubs = audit.rules.filter(r => /publish/i.test(r.action || ''));
    const byRule = new Map();
    pubs.forEach(r => { const k = r.ruleName || r.ruleId || '?'; if (!byRule.has(k)) byRule.set(k, []); byRule.get(k).push(r); });
    wrap.appendChild(el('div', { class: 'grid g4', style: 'margin-bottom:14px' }, [
      tile(T('au.kPublishes'), U.fmtInt(pubs.length), T('au.kPublishesFoot', { n: U.fmtInt(byRule.size) })),
      tile(T('au.kEntAdded'), U.fmtInt(U.sum(pubs, r => r.addedEntitlementsCount || 0)), T('au.kEntAddedFoot'), { small: true }),
      tile(T('au.kEntRemoved'), U.fmtInt(U.sum(pubs, r => r.removedEntitlementsCount || 0)), T('au.kEntRemovedFoot'), { small: true }),
      tile(T('au.kOtherChanges'), U.fmtInt(audit.rules.length - pubs.length + audit.systemChanges.length), T('au.kOtherChangesFoot'), { small: true })
    ]));
    wrap.appendChild(card(T('au.rulesTitle'), T('au.rulesNote'), HR.table.make({
      columns: [
        { key: 'at', label: T('au.cWhen'), value: r => r.at ? +r.at : 0, render: r => el('span', { class: 'nowrap', text: day(r.at) }) },
        { key: 'who', label: T('au.cWho'), value: who },
        { key: 'rule', label: T('au.cRule'), value: r => r.ruleName || r.ruleId || '' },
        { key: 'added', label: '+', value: r => r.addedEntitlementsCount || 0, align: 'right',
          render: r => el('span', { class: r.addedEntitlementsCount ? 'sev good' : 'note', text: String(r.addedEntitlementsCount || 0) }) },
        { key: 'removed', label: '−', value: r => r.removedEntitlementsCount || 0, align: 'right',
          render: r => el('span', { class: r.removedEntitlementsCount ? 'sev high' : 'note', text: String(r.removedEntitlementsCount || 0) }) },
        { key: 'scope', label: T('au.cScope'), value: r => r.currentPersonsInScopeCount || 0, align: 'right',
          render: r => el('span', { text: U.fmtInt(r.currentPersonsInScopeCount || 0) + (r.personsAddedToScopeCount || r.personsRemovedFromScopeCount
            ? ' (' + (r.personsAddedToScopeCount ? '+' + U.fmtInt(r.personsAddedToScopeCount) : '') + (r.personsRemovedFromScopeCount ? ' −' + U.fmtInt(r.personsRemovedFromScopeCount) : '') + ')' : '') }) },
        { key: 'cond', label: T('au.cCondition'), value: r => r.currentConditionSummary || '',
          render: r => el('span', { class: 'note', text: String(r.currentConditionSummary || '').replace(/\n/g, ' ') }) }
      ],
      rows: pubs, pageSize: 25, exportName: 'helloid-rule-publishes', initialSort: { key: 'at', dir: -1 },
      search: (r, q) => [r.ruleName, r.userName, (r.addedEntitlements || []).join(' ')].join(' ').toLowerCase().includes(q),
      onRowClick: r => ruleDrawer(byRule.get(r.ruleName || r.ruleId || '?') || [r], r.ruleName || r.ruleId || '?')
    })));
    if (audit.systemChanges.length) wrap.appendChild(card(T('au.systemTitle'), T('au.systemNote'), HR.table.make({
      columns: [
        { key: 'at', label: T('au.cWhen'), value: r => r.at ? +r.at : 0, render: r => el('span', { class: 'nowrap', text: day(r.at) }) },
        { key: 'who', label: T('au.cWho'), value: who },
        { key: 'system', label: T('c.system'), value: r => r.systemName || '' },
        { key: 'area', label: T('au.cArea'), value: r => r.area || r.context || '' },
        { key: 'what', label: T('au.cWhat'), value: r => r.description || '' }
      ],
      rows: audit.systemChanges, pageSize: 10, exportName: 'helloid-system-changes', initialSort: { key: 'at', dir: -1 }
    })));
    return wrap;
  }

  function ruleDrawer(list, name) {
    const sorted = list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    HR.viewkit.openDrawer(el('div', {}, [el('div', { class: 'drawer-title', text: name }),
      el('div', { class: 'note', text: T('au.ruleTimeline', { n: U.fmtInt(sorted.length) }) })]),
      el('ul', { class: 'clean' }, sorted.map(r => el('li', {}, [
        el('strong', { text: day(r.at) + ' · ' + who(r) }),
        el('div', { class: 'note', text: T('au.ruleScope', { n: U.fmtInt(r.currentPersonsInScopeCount || 0), ents: U.fmtInt(r.currentSelectedEntitlementsCount || 0) }) }),
        (r.addedEntitlements || []).length ? el('div', { text: '+ ' + r.addedEntitlements.join(', ') }) : null,
        (r.removedEntitlements || []).length ? el('div', { text: '− ' + r.removedEntitlements.join(', ') }) : null,
        r.currentConditionSummary ? el('pre', { class: 'note', style: 'white-space:pre-wrap;margin:4px 0 0', text: r.currentConditionSummary }) : null
      ].filter(Boolean)))));
  }

  /* --------------------------------------------------------- who did what */
  function actorsTab(m, audit) {
    const actors = HR.audit.actors(audit);
    const CTX = ['reconciliation', 'thresholds', 'rules', 'entitlements', 'evaluations', 'systemChanges', 'imports'];
    return card(T('au.actorsTitle'), T('au.actorsNote'), HR.table.make({
      columns: [{ key: 'name', label: T('au.cWho'), value: a => a.name },
        { key: 'total', label: T('au.cTotal'), value: a => a.total, align: 'right' }]
        .concat(CTX.map(c => ({ key: c, label: T('au.ctx.' + c), value: a => a.contexts[c] || 0, align: 'right',
          render: a => el('span', { class: a.contexts[c] ? '' : 'note', text: String(a.contexts[c] || 0) }) }))),
      rows: actors, pageSize: 25, exportName: 'helloid-actors', initialSort: { key: 'total', dir: -1 }
    }));
  }

  function auditView(m, params) {
    const f = document.createDocumentFragment();
    const audit = HR.app.state.audit;
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('au.title') }),
      el('p', { text: T('au.lead') })
    ])));
    if (!audit) { f.appendChild(partialNotice(['audit'])); return f; }
    const meta = audit.meta;
    f.appendChild(el('p', { class: 'note', 'data-lead': '1', text: T('au.window', { tenant: meta.tenant.name || '—', from: day(meta.first), to: day(meta.last), n: U.fmtInt(meta.rowCount) })
      + (m && m.hasRecon ? '' : ' ' + T('au.noRecon')) }));
    f.appendChild(tabbed('audit', [
      { id: 'decisions', label: T('au.tab.decisions'), count: audit.exclusions.length + audit.thresholds.length, build: () => decisionsTab(m, audit) },
      { id: 'rules', label: T('au.tab.rules'), count: audit.rules.filter(r => /publish/i.test(r.action || '')).length, build: () => rulesTab(m, audit) },
      { id: 'actors', label: T('au.tab.actors'), build: () => actorsTab(m, audit) }
    ], params));
    return f;
  }

  HR.views.audit = auditView;
})(window.HR);
