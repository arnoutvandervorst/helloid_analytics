/* Rule engine. Each rule turns the graph into a finding: what, how bad, how many,
   what it costs, and what to do about it. Rules return null when they do not apply.
   All prose comes from the i18n dictionary under the fi.<rule-id>.* keys. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const T = (k, p) => HR.i18n.t(k, p);

  /** Fill in the four standard prose fields for a rule id. */
  function prose(id, params, whyKey) {
    return {
      title: T('fi.' + id + '.title', params),
      what: T('fi.' + id + '.what', params),
      why: T(whyKey || ('fi.' + id + '.why'), params),
      fix: T('fi.' + id + '.fix', params)
    };
  }

  const RULES = [
    /* ---------------------------------------------------------------- identity */
    function privilegedOrphans(m) {
      const hits = m.accountList.filter(a => a.orphan && a.enabled !== false && a.privileged.length);
      if (!hits.length) return null;
      return Object.assign({
        id: 'privileged-orphan', severity: 'critical', category: T('fi.cat.identity'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: a.privileged.map(p => p.name).join(', ') })),
        impactMonthly: U.sum(hits, a => a.monthlyCost)
      }, prose('privileged-orphan', { n: hits.length }));
    },

    function enabledOrphans(m) {
      const hits = m.accountList.filter(a => a.orphan && a.enabled !== false && !a.privileged.length);
      if (!hits.length) return null;
      return Object.assign({
        id: 'enabled-orphan', severity: 'high', category: T('fi.cat.identity'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.detailClassPerms', { cls: a.clsLabel, n: a.permCount }) })),
        impactMonthly: U.sum(hits, a => a.monthlyCost)
      }, prose('enabled-orphan', { n: hits.length }));
    },

    function externalAccounts(m) {
      const hits = m.accountList.filter(a => a.cls === 'external' && a.enabled !== false);
      if (!hits.length) return null;
      return Object.assign({
        id: 'external-accounts', severity: 'high', category: T('fi.cat.identity'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: (a.orphan ? T('fi.detailUnowned') : '') + T('fi.detailPerms', { n: a.permCount }) })),
        impactMonthly: U.sum(hits, a => a.monthlyCost)
      }, prose('external-accounts', { n: hits.length }));
    },

    function testAccounts(m) {
      const hits = m.accountList.filter(a => a.cls === 'test' && a.enabled !== false);
      if (!hits.length) return null;
      return Object.assign({
        id: 'test-accounts', severity: 'medium', category: T('fi.cat.identity'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.detailPerms', { n: a.permCount }) })),
        impactMonthly: U.sum(hits, a => a.monthlyCost)
      }, prose('test-accounts', { n: hits.length }));
    },

    function serviceAccountsUnmanaged(m) {
      const hits = m.accountList.filter(a => a.cls === 'service' && a.orphan);
      if (!hits.length) return null;
      return Object.assign({
        id: 'service-unmanaged', severity: 'medium', category: T('fi.cat.identity'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.detailPerms', { n: a.permCount }) })),
        impactMonthly: 0
      }, prose('service-unmanaged', { n: hits.length }));
    },

    /* ---------------------------------------------------------------- dormant */
    function disabledStillLicensed(m) {
      const hits = m.accountList.filter(a => a.enabled === false && a.monthlyCost > 0);
      if (!hits.length) return null;
      return Object.assign({
        id: 'disabled-licensed', severity: 'high', category: T('fi.cat.cost'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.detailLicences', { list: a.licences.map(l => l.name).join(', '), amount: U.fmtMoney(a.monthlyCost) }) })),
        impactMonthly: U.sum(hits, a => a.monthlyCost),
        recoverable: true
      }, prose('disabled-licensed', { n: hits.length }));
    },

    function disabledStillEntitled(m) {
      const hits = m.accountList.filter(a => a.enabled === false && a.permCount > 0 && a.monthlyCost === 0);
      if (!hits.length) return null;
      return Object.assign({
        id: 'disabled-entitled', severity: 'medium', category: T('fi.cat.hygiene'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.detailPerms', { n: a.permCount }) })),
        impactMonthly: 0
      }, prose('disabled-entitled', { n: hits.length }));
    },

    /* ------------------------------------------------------------ entitlements */
    function privilegedUnmanaged(m) {
      const perms = m.permissionList.filter(p =>
        (p.category === 'privileged' || p.category === 'server') &&
        (p.issues[m.ISSUE_PERM_UNMANAGED] || 0) > 0);
      if (!perms.length) return null;
      const assignments = U.sum(perms, p => p.issues[m.ISSUE_PERM_UNMANAGED] || 0);
      return Object.assign({
        id: 'privileged-unmanaged', severity: 'critical', category: T('fi.cat.entitlements'),
        entities: perms.map(p => ({ type: 'permission', key: p.key, label: p.name,
          detail: T('fi.detailHolders', { n: p.holderCount, o: p.holdersOrphan }) })),
        impactMonthly: 0
      }, prose('privileged-unmanaged', { a: assignments, g: perms.length }));
    },

    function securityControlGap(m) {
      /* A security-category group held by most of the population is a baseline control;
         accounts missing it are the exception worth looking at. */
      const pop = m.accountList.filter(a => a.enabled !== false && a.cls === 'user');
      if (pop.length < 20) return null;
      const gaps = [];
      for (const p of m.permissionList) {
        if (p.category !== 'security') continue;
        const holders = pop.filter(a => a.permKeys.has(p.key));
        const cov = holders.length / pop.length;
        if (cov < 0.25 || cov > 0.98) continue;          // not a baseline, or already universal
        gaps.push({ perm: p, coverage: cov, missing: pop.filter(a => !a.permKeys.has(p.key)) });
      }
      if (!gaps.length) return null;
      gaps.sort((a, b) => b.coverage - a.coverage);
      return Object.assign({
        id: 'security-control-gap', severity: 'high', category: T('fi.cat.entitlements'),
        entities: gaps.map(g => ({ type: 'permission', key: g.perm.key, label: g.perm.name,
          detail: T('fi.security-control-gap.detail', { cov: U.fmtPct(g.coverage, 0), n: g.missing.length }) })),
        impactMonthly: 0,
        extra: { gaps }
      }, prose('security-control-gap', { n: gaps.length }));
    },

    function missingEntitlements(m) {
      const rows = m.records.filter(r => r.issue === m.ISSUE_PERM_MISSING);
      if (!rows.length) return null;
      const byPerm = U.by(rows, r => r.permission);
      const sensitive = Array.from(byPerm.keys()).some(name => {
        const c = HR.config.categoryFor(name);
        return c.id === 'security' || c.id === 'privileged';
      });
      return Object.assign({
        id: 'missing-entitlements', severity: sensitive ? 'high' : 'medium', category: T('fi.cat.service'),
        entities: Array.from(byPerm.entries()).map(([name, rs]) => ({
          type: 'permission', key: HR.model.permissionKey(rs[0].system, name), label: name,
          detail: T('fi.missing-entitlements.detail', {
            n: rs.length, list: rs.slice(0, 6).map(r => r.userName).join(', ') + (rs.length > 6 ? '…' : '')
          })
        })),
        impactMonthly: 0
      }, prose('missing-entitlements', { n: rows.length },
        sensitive ? 'fi.missing-entitlements.whySensitive' : 'fi.missing-entitlements.why'));
    },

    function overEntitled(m) {
      const withPerms = m.accountList.filter(a => a.permCount > 0).sort((a, b) => b.permCount - a.permCount);
      if (withPerms.length < 20) return null;
      const cut = withPerms[Math.floor(withPerms.length * 0.05)].permCount;
      const hits = withPerms.filter(a => a.permCount > cut);
      if (!hits.length) return null;
      return Object.assign({
        id: 'over-entitled', severity: 'medium', category: T('fi.cat.entitlements'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.over-entitled.detail', { n: a.permCount, r: a.riskScore }) })),
        impactMonthly: 0
      }, prose('over-entitled', { n: hits.length, cut: cut }));
    },

    function peerOutliers(m) {
      const hits = m.accountList
        .filter(a => a.permCount >= 3 && a.outlier > 0.65 && a.uniquePerms.length)
        .sort((a, b) => b.outlier - a.outlier).slice(0, 60);
      if (!hits.length) return null;
      return Object.assign({
        id: 'peer-outlier', severity: 'medium', category: T('fi.cat.entitlements'),
        entities: hits.map(a => ({ type: 'account', key: a.key, label: a.userName,
          detail: T('fi.peer-outlier.detail', { p: Math.round((a.peerBest || 0) * 100), n: a.uniquePerms.length }) })),
        impactMonthly: 0
      }, prose('peer-outlier', { n: hits.length }));
    },

    function rareSensitive(m) {
      const hits = m.permissionList.filter(p => p.rare && p.sensitivity >= 1.5 && p.holderCount > 0);
      if (!hits.length) return null;
      return Object.assign({
        id: 'rare-sensitive', severity: 'medium', category: T('fi.cat.entitlements'),
        entities: hits.map(p => ({ type: 'permission', key: p.key, label: p.name,
          detail: Array.from(p.holders).map(k => m.accounts.get(k)).filter(Boolean).map(a => a.userName).join(', ') })),
        impactMonthly: 0
      }, prose('rare-sensitive', { n: hits.length }));
    },

    /* ------------------------------------------------------------------- cost */
    function stackedLicences(m) {
      const st = m.cost.stacked;
      if (!st.length) return null;
      return Object.assign({
        id: 'stacked-licences', severity: 'high', category: T('fi.cat.cost'),
        entities: st.map(x => ({ type: 'account', key: x.account.key, label: x.account.userName,
          detail: T('fi.stacked-licences.detail', { skus: x.skus.join(' + '), amount: U.fmtMoney(x.monthly) }) })),
        impactMonthly: m.cost.stackedWasteNet,
        recoverable: true
      }, prose('stacked-licences', { n: st.length }));
    },

    function unmanagedSpend(m) {
      if (m.cost.unmanagedSpend <= 0) return null;
      return Object.assign({
        id: 'unmanaged-spend', severity: 'medium', category: T('fi.cat.cost'),
        entities: m.cost.bySku.filter(s => s.monthly > 0).slice(0, 20).map(s => ({
          type: 'permission', key: s.key, label: s.name,
          detail: T('fi.unmanaged-spend.detail', { n: s.holders, amount: U.fmtMoney(s.monthly) })
        })),
        impactMonthly: m.cost.unmanagedSpend
      }, prose('unmanaged-spend', { amount: U.fmtMoney(m.cost.unmanagedSpend) }));
    },

    function unpricedPermissions(m) {
      if (!m.cost.unpricedPermissions) return null;
      return Object.assign({
        id: 'unpriced', severity: 'info', category: T('fi.cat.dataQuality'),
        entities: [], count: m.cost.unpricedPermissions, impactMonthly: 0
      }, prose('unpriced', { n: m.cost.unpricedPermissions, total: m.permissionList.length }));
    },

    function excluded(m) {
      const rows = m.records.filter(r => r.resolution && r.resolution !== 'None');
      if (!rows.length) return null;
      const byRes = U.counts(rows, r => r.resolution);
      return Object.assign({
        id: 'excluded', severity: 'info', category: T('fi.cat.dataQuality'),
        entities: rows.slice(0, 50).map(r => ({ type: 'account', key: HR.model.accountKey(r.system, r.userName),
          label: r.userName, detail: r.resolution + ' · ' + (r.permission || r.issue) })),
        impactMonthly: 0
      }, prose('excluded', {
        n: rows.length,
        list: Array.from(byRes.entries()).map(([k, v]) => k + ' ×' + v).join(', ')
      }));
    }
  ];

  function run(model) {
    const out = [];
    for (const rule of RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('finding rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out.sort((a, b) =>
      U.severityRank(a.severity) - U.severityRank(b.severity) ||
      (b.impactMonthly || 0) - (a.impactMonthly || 0) ||
      b.count - a.count);
  }

  HR.findings = { run, RULES };
})(window.HR);
