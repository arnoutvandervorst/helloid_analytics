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


  /* ---------------------------------------------------------------------------
     Comparison findings — only produced when a business-rule export is loaded.
     These are the ones that say what to do to the rules themselves. */
  const COMPARISON_RULES = [
    function staleEntitlements(m) {
      const c = m.comparison;
      const hits = c.staleEntitlements;
      if (!hits.length) return null;
      const total = U.sum(hits, h => h.stale.length);
      return Object.assign({
        id: 'rule-stale-entitlement', severity: 'high', category: T('fi.cat.rules'),
        entities: hits.flatMap(h => h.stale.map(e => ({
          type: 'rule', key: h.rule.name, label: h.rule.name,
          detail: T('fi.rule-stale-entitlement.detail', { ent: e.name, system: e.system || '—' })
        }))),
        impactMonthly: 0
      }, prose('rule-stale-entitlement', { n: total, r: hits.length }));
    },

    function draftRulesCoveringDrift(m) {
      const c = m.comparison;
      const hits = c.draftWithHolders;
      if (!hits.length) return null;
      const rows = U.sum(hits, h => h.unmanagedRows);
      return Object.assign({
        id: 'rule-draft-live', severity: 'high', category: T('fi.cat.rules'),
        entities: hits.map(h => ({
          type: 'rule', key: h.rule.name, label: h.rule.name,
          detail: T('fi.rule-draft-live.detail', {
            status: h.rule.status, holders: h.holderCount, rows: h.unmanagedRows
          })
        })),
        impactMonthly: 0
      }, prose('rule-draft-live', { n: hits.length, rows: rows }));
    },

    function rulesMatchingNobody(m) {
      const c = m.comparison;
      const hits = c.deadLive.filter(h => h.holderCount > 0);
      if (!hits.length) return null;
      return Object.assign({
        id: 'rule-evaluates-empty', severity: 'medium', category: T('fi.cat.rules'),
        entities: hits.map(h => ({
          type: 'rule', key: h.rule.name, label: h.rule.name,
          detail: T('fi.rule-evaluates-empty.detail', {
            holders: h.holderCount,
            scope: h.rule.scopingConditions.map(s => s.facet).join(', ') || '—'
          })
        })),
        impactMonthly: 0
      }, prose('rule-evaluates-empty', { n: hits.length }));
    },

    function unmodelledDrift(m) {
      const c = m.comparison;
      const hits = c.unmodelled.filter(u => u.unmanagedRows > 0);
      if (!hits.length) return null;
      return Object.assign({
        id: 'rule-unmodelled', severity: 'high', category: T('fi.cat.rules'),
        entities: hits.slice(0, 60).map(u => ({
          type: 'permission', key: u.perm.key, label: u.perm.name,
          detail: T('fi.rule-unmodelled.detail', {
            rows: u.unmanagedRows, holders: u.perm.holderCount,
            cost: u.perm.monthlyTotal ? U.fmtMoney(u.perm.monthlyTotal) + '/mo' : '—'
          })
        })),
        impactMonthly: U.sum(hits, u => u.perm.monthlyTotal || 0)
      }, prose('rule-unmodelled', {
        n: hits.length,
        rows: U.sum(hits, u => u.unmanagedRows),
        share: U.fmtPct(c.summary.modelShare, 0)
      }));
    },

    function failedGrantsWithRule(m) {
      const hits = m.comparison.missingAttribution.filter(x => x.rules.length);
      if (!hits.length) return null;
      return Object.assign({
        id: 'rule-grant-not-delivered', severity: 'high', category: T('fi.cat.rules'),
        entities: hits.map(x => ({
          type: 'account', key: HR.model.accountKey(m.systemList[0] ? m.systemList[0].name : '', x.userName),
          label: x.userName,
          detail: T('fi.rule-grant-not-delivered.detail', {
            perm: x.permission, rule: x.rules.map(r => r.name).join(', ')
          })
        })),
        impactMonthly: 0
      }, prose('rule-grant-not-delivered', { n: hits.length }));
    }
  ];

  function runComparison(model) {
    const out = [];
    for (const rule of COMPARISON_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('comparison rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }


  /* ---------------------------------------------------------------------------
     Vault findings — only when a vault export makes conditions evaluable. */
  const VAULT_RULES = [
    function ruleSelectsNobody(m) {
      const ev = m.evaluation;
      const dead = [];
      for (const [, b] of ev.perRule) {
        if (b.matched.length || !b.rule.scopingConditions.length) continue;
        const blockers = Array.from(b.blockingClauses.entries()).sort((x, y) => y[1] - x[1]);
        dead.push({ rule: b.rule, blockers });
      }
      if (!dead.length) return null;
      return Object.assign({
        id: 'vault-rule-selects-nobody', severity: 'high', category: T('fi.cat.rules'),
        entities: dead.map(d => ({
          type: 'rule', key: d.rule.name, label: d.rule.name,
          detail: T('fi.vault-rule-selects-nobody.detail', {
            clause: d.blockers.length ? d.blockers[0][0] : '—',
            n: d.blockers.length ? d.blockers[0][1] : 0
          })
        })),
        impactMonthly: 0
      }, prose('vault-rule-selects-nobody', { n: dead.length }));
    },

    function evaluationDisagrees(m) {
      const ev = m.evaluation;
      const rows = [];
      for (const [, b] of ev.perRule) {
        const declared = b.rule.personsEvaluated;
        if (declared == null) continue;
        const ours = b.matched.length;
        /* Small differences are timing; a large one means the rule has not been
           evaluated since the data changed, or the conditions read differently here. */
        if (Math.abs(ours - declared) >= Math.max(5, declared * 0.25)) {
          rows.push({ rule: b.rule, ours, declared });
        }
      }
      if (!rows.length) return null;
      return Object.assign({
        id: 'vault-evaluation-drift', severity: 'medium', category: T('fi.cat.rules'),
        entities: rows.map(r => ({
          type: 'rule', key: r.rule.name, label: r.rule.name,
          detail: T('fi.vault-evaluation-drift.detail', { ours: r.ours, declared: r.declared })
        })),
        impactMonthly: 0
      }, prose('vault-evaluation-drift', { n: rows.length }));
    },

    function overProvisioned(m) {
      const rows = m.provisioning.rows.filter(r => r.extra.length);
      if (!rows.length) return null;
      /* "Extra" is measured against the rules that exist. Where the rule set describes
         only a fraction of the groups in use, almost everything reads as extra — true,
         but a statement about the rule set rather than about these people. */
      const coverage = m.comparison ? m.comparison.summary.coverage : 1;
      const thin = coverage < 0.5;
      return Object.assign({
        id: 'vault-over-provisioned', severity: thin ? 'medium' : 'high', category: T('fi.cat.entitlements'),
        entities: rows.slice(0, 80).map(r => ({
          type: 'account', key: r.accounts[0] ? r.accounts[0].key : r.person.personId,
          label: r.person.displayName,
          detail: T('fi.vault-over-provisioned.detail', {
            n: r.extra.length, list: r.extra.slice(0, 4).map(p => p.name).join(', ')
          })
        })),
        impactMonthly: U.sum(rows, r => r.extraCost)
      }, prose('vault-over-provisioned', {
        n: rows.length, total: U.sum(rows, r => r.extra.length),
        coverage: U.fmtPct(coverage, 0)
      }, thin ? 'fi.vault-over-provisioned.whyThin' : 'fi.vault-over-provisioned.why'));
    },

    function underProvisioned(m) {
      const rows = m.provisioning.rows.filter(r => r.missing.length);
      if (!rows.length) return null;
      return Object.assign({
        id: 'vault-under-provisioned', severity: 'medium', category: T('fi.cat.service'),
        entities: rows.slice(0, 80).map(r => ({
          type: 'account', key: r.accounts[0] ? r.accounts[0].key : r.person.personId,
          label: r.person.displayName,
          detail: T('fi.vault-under-provisioned.detail', {
            n: r.missing.length, list: r.missing.slice(0, 4).map(x => x.perm.name).join(', ')
          })
        })),
        impactMonthly: 0
      }, prose('vault-under-provisioned', {
        n: rows.length, total: U.sum(rows, r => r.missing.length)
      }));
    },

    function leaversStillEnabled(m) {
      const rows = m.provisioning.leavers;
      if (!rows.length) return null;
      return Object.assign({
        id: 'vault-leaver-enabled', severity: 'critical', category: T('fi.cat.identity'),
        entities: rows.map(r => ({
          type: 'account', key: r.accounts[0].key, label: r.person.displayName,
          detail: T('fi.vault-leaver-enabled.detail', {
            date: r.endedOn ? U.fmtDate(r.endedOn).split(',')[0] : '—',
            accounts: r.accounts.map(a => a.userName).join(', ')
          })
        })),
        impactMonthly: U.sum(rows, r => U.sum(r.accounts, a => a.monthlyCost))
      }, prose('vault-leaver-enabled', { n: rows.length }));
    },

    function correlationMismatch(m) {
      const rows = m.provisioning.miscorrelated;
      if (!rows.length) return null;
      return Object.assign({
        id: 'vault-correlation-mismatch', severity: 'medium', category: T('fi.cat.dataQuality'),
        entities: rows.map(r => ({
          type: 'account', key: r.account.key, label: r.account.userName,
          detail: T('fi.vault-correlation-mismatch.detail', { person: r.person.displayName })
        })),
        impactMonthly: 0
      }, prose('vault-correlation-mismatch', { n: rows.length }));
    },

    function personsWithoutAccount(m) {
      const rows = m.provisioning.accountless.filter(p => p.activeContracts.length);
      if (!rows.length) return null;
      return Object.assign({
        id: 'vault-no-account', severity: 'medium', category: T('fi.cat.service'),
        entities: rows.slice(0, 80).map(p => ({
          type: 'person', key: p.personId, label: p.displayName,
          detail: T('fi.vault-no-account.detail', {
            dept: p.primaryContract ? (p.primaryContract.department.name || p.primaryContract.department.externalId || '—') : '—'
          })
        })),
        impactMonthly: 0
      }, prose('vault-no-account', { n: rows.length }));
    }
  ];

  const CORRELATION_RULES = [
    function formerEmployeeAccounts(m) {
      const c = m.correlation;
      const hits = c.former;
      if (!hits.length) return null;
      const enabled = hits.filter(h => h.stillEnabled);
      return Object.assign({
        id: 'correlate-former-employee', severity: enabled.length ? 'critical' : 'high',
        category: T('fi.cat.identity'),
        entities: hits.map(h => ({
          type: 'account', key: h.account.key, label: h.account.userName,
          detail: T('fi.correlate-former-employee.detail', {
            person: h.person.displayName,
            date: h.endedOn ? U.fmtDate(h.endedOn).split(',')[0] : '—',
            days: h.daysSinceEnd == null ? '—' : U.fmtInt(h.daysSinceEnd),
            state: T(h.stillEnabled ? 'c.enabled' : 'c.disabled'),
            evidence: h.evidence.join(', ')
          })
        })),
        impactMonthly: U.sum(hits, h => h.monthlyCost),
        recoverable: true
      }, prose('correlate-former-employee', { n: hits.length, enabled: enabled.length }));
    },

    function unownedMatchedToCurrent(m) {
      const hits = m.correlation.matches.filter(h => !h.former);
      if (!hits.length) return null;
      return Object.assign({
        id: 'correlate-current-employee', severity: 'medium', category: T('fi.cat.dataQuality'),
        entities: hits.map(h => ({
          type: 'account', key: h.account.key, label: h.account.userName,
          detail: T('fi.correlate-current-employee.detail', {
            person: h.person.displayName, evidence: h.evidence.join(', ')
          })
        })),
        impactMonthly: 0
      }, prose('correlate-current-employee', { n: hits.length }));
    },

    function secondaryAccounts(m) {
      const groups = (m.linkedAccounts || { groups: [] }).groups.filter(g => g.unlinkedSecondary.length);
      if (!groups.length) return null;
      const priv = groups.filter(g => g.privileged.length).length;
      return Object.assign({
        id: 'correlate-secondary-account', severity: priv ? 'high' : 'medium',
        category: T('fi.cat.identity'),
        entities: groups.flatMap(g => g.unlinkedSecondary.map(x => ({
          type: 'account', key: x.account.key, label: x.account.userName,
          detail: T('fi.correlate-secondary-account.detail', {
            person: g.person.displayName,
            main: g.primary.account.userName,
            cls: x.account.clsLabel
          })
        }))),
        impactMonthly: 0
      }, prose('correlate-secondary-account', {
        n: U.sum(groups, g => g.unlinkedSecondary.length), p: groups.length
      }));
    },

    function ambiguousOwners(m) {
      const hits = m.correlation.ambiguous;
      if (!hits.length) return null;
      return Object.assign({
        id: 'correlate-ambiguous', severity: 'low', category: T('fi.cat.dataQuality'),
        entities: hits.map(h => ({
          type: 'account', key: h.account.key, label: h.account.userName,
          detail: T('fi.correlate-ambiguous.detail', {
            list: h.candidates.map(c => c.person.displayName).join(' / ')
          })
        })),
        impactMonthly: 0
      }, prose('correlate-ambiguous', { n: hits.length }));
    }
  ];

  const ACTIVITY_RULES = [
    function failedActions(m) {
      const h = m.history;
      if (!h || !h.failed.length) return null;
      const byEnt = U.by(h.failed, r => r.entitlement);
      return Object.assign({
        id: 'activity-failed', severity: 'high', category: T('fi.cat.provisioning'),
        entities: Array.from(byEnt.entries())
          .sort((a, b) => b[1].length - a[1].length)
          .map(([name, list]) => ({
            type: 'permission', key: HR.model.permissionKey(list[0].system, name), label: name,
            detail: T('fi.activity-failed.detail', {
              n: list.length, op: U.uniq(list.map(r => r.operation)).join('/'),
              last: list[list.length - 1].createdOn ? U.fmtDate(list[list.length - 1].createdOn).split(',')[0] : '—'
            })
          })),
        impactMonthly: 0
      }, prose('activity-failed', { n: h.failed.length, ent: byEnt.size }));
    },

    function blockedActions(m) {
      const h = m.history;
      if (!h || !h.blocked.length) return null;
      const byPerson = U.by(h.blocked, r => r.personRaw);
      return Object.assign({
        id: 'activity-blocked', severity: 'medium', category: T('fi.cat.provisioning'),
        entities: Array.from(byPerson.entries())
          .sort((a, b) => b[1].length - a[1].length).slice(0, 60)
          .map(([person, list]) => ({
            type: 'person', key: person, label: person || '—',
            detail: T('fi.activity-blocked.detail', {
              n: list.length, origins: U.uniq(list.flatMap(r => r.origins)).join(', ')
            })
          })),
        impactMonthly: 0
      }, prose('activity-blocked', { n: h.blocked.length, p: byPerson.size }));
    },

    function churningEntitlements(m) {
      const h = m.history;
      if (!h || !h.churn.length) return null;
      return Object.assign({
        id: 'activity-churn', severity: 'medium', category: T('fi.cat.rules'),
        entities: h.churn.slice(0, 60).map(c => ({
          type: 'permission',
          key: HR.model.permissionKey(c.sample.system, c.sample.entitlement),
          label: c.sample.entitlement,
          detail: T('fi.activity-churn.detail', { person: c.sample.personRaw, n: c.flips })
        })),
        impactMonthly: 0
      }, prose('activity-churn', { n: h.churn.length }));
    },

    function grantedButAbsent(m) {
      const g = m.granted;
      if (!g || g.empty) return null;
      const missing = [];
      const byPersonRaw = new Map();
      for (const a of m.accountList) if (!byPersonRaw.has(a.personRaw)) byPersonRaw.set(a.personRaw, a);
      for (const r of g.rows) {
        const account = byPersonRaw.get(r.personRaw);
        if (!account) continue;
        const perm = m.permissions.get(HR.model.permissionKey(r.system, r.entitlement));
        if (!perm || !account.permKeys.has(perm.key)) missing.push({ row: r, account: account });
      }
      if (!missing.length) return null;
      return Object.assign({
        id: 'activity-granted-absent', severity: 'high', category: T('fi.cat.provisioning'),
        entities: missing.slice(0, 60).map(x => ({
          type: 'account', key: x.account.key, label: x.account.userName,
          detail: T('fi.activity-granted-absent.detail', { ent: x.row.entitlement })
        })),
        impactMonthly: 0
      }, prose('activity-granted-absent', { n: missing.length }));
    }
  ];


  /* ------------------------------------------------------- Service Automation */
  const PRODUCT_RULES = [
    /* The control the approval workflow exists to provide, bypassed by the requester. */
    function selfApproved(m) {
      const hits = m.assignments.rows.filter(a => a.selfApproved);
      if (!hits.length) return null;
      return Object.assign({
        id: 'product-self-approved', severity: 'high', category: T('fi.cat.process'),
        entities: hits.slice(0, 80).map(a => ({
          type: 'product', key: a.id, label: a.productName,
          detail: T('fi.product-self-approved.detail', {
            user: a.userName, date: a.approvedAt ? U.fmtDate(a.approvedAt).split(',')[0] : '\u2014' })
        })),
        impactMonthly: 0
      }, prose('product-self-approved', {
        n: hits.length, users: new Set(hits.map(a => a.userName)).size
      }));
    },

    /* Ownership that outlived its own time limit: HelloID knows the duration and the
       assignment is still open past it. */
    function pastOwnershipDuration(m) {
      const now = Date.now();
      const hits = [];
      for (const a of m.assignments.open) {
        const p = m.products && m.products.byName.get(a.productName.toLowerCase());
        /* Only where the limit converts to whole days; an ambiguous unit is not a
           basis for telling somebody their access is overdue. */
        if (!p || !p.hasTimeLimit || !p.ownershipDays) continue;
        const start = a.approvedAt || a.requestedAt;
        if (!start) continue;
        const days = Math.round((now - start) / 86400000);
        if (days > p.ownershipDays) hits.push({ a, p, days });
      }
      if (!hits.length) return null;
      hits.sort((x, y) => y.days - x.days);
      return Object.assign({
        id: 'product-past-duration', severity: 'high', category: T('fi.cat.process'),
        entities: hits.slice(0, 80).map(h => ({
          type: 'product', key: h.a.id, label: h.a.productName,
          detail: T('fi.product-past-duration.detail', {
            user: h.a.userName, days: U.fmtInt(h.days), limit: U.fmtInt(h.p.ownershipDays) })
        })),
        impactMonthly: 0
      }, prose('product-past-duration', { n: hits.length }));
    },

    /* Held for years with nothing recorded since. Not wrong by itself — but it is the
       set nobody has looked at, and the export says how long. */
    function heldLong(m) {
      const cfg = HR.config.get().products || {};
      const limit = cfg.staleDays || 730;
      const now = Date.now();
      const hits = m.assignments.open.filter(a => {
        const start = a.approvedAt || a.requestedAt;
        return start && (now - start) / 86400000 > limit;
      });
      if (!hits.length) return null;
      const oldest = hits.reduce((max, a) => {
        const d = Math.round((now - (a.approvedAt || a.requestedAt)) / 86400000);
        return d > max ? d : max;
      }, 0);
      return Object.assign({
        id: 'product-long-held', severity: 'medium', category: T('fi.cat.hygiene'),
        entities: hits.slice(0, 80).map(a => ({
          type: 'product', key: a.id, label: a.productName,
          detail: T('fi.product-long-held.detail', {
            user: a.userName,
            years: U.fmtNum(((now - (a.approvedAt || a.requestedAt)) / 31557600000), 1) })
        })),
        impactMonthly: 0
      }, prose('product-long-held', {
        n: hits.length, total: m.assignments.open.length,
        limit: limit, years: U.fmtNum(oldest / 365.25, 1)
      }));
    },

    /* A product that does not return when the user is disabled keeps whatever it granted
       after the person is gone — and the reconciliation cannot tell you which ones. */
    function noReturnOnDisable(m) {
      if (!m.products) return null;
      const hits = m.assignments.open.filter(a => {
        const p = m.products.byName.get(a.productName.toLowerCase());
        return p && !p.returnOnUserDisable;
      });
      if (!hits.length) return null;
      const products = U.uniq(hits.map(a => a.productName));
      return Object.assign({
        id: 'product-no-return-on-disable', severity: 'medium', category: T('fi.cat.process'),
        entities: products.slice(0, 80).map(name => ({
          type: 'product', key: name, label: name,
          detail: T('fi.product-no-return-on-disable.detail', {
            n: hits.filter(a => a.productName === name).length })
        })),
        impactMonthly: 0
      }, prose('product-no-return-on-disable', { n: hits.length, products: products.length }));
    },

    /* HelloID's own risk factor, applied to who actually holds the thing. */
    function riskyHolders(m) {
      if (!m.products) return null;
      const cfg = HR.config.get().products || {};
      const floor = cfg.riskFactorFloor || 7;
      const hits = m.assignments.open.filter(a => {
        const p = m.products.byName.get(a.productName.toLowerCase());
        return p && p.riskFactor >= floor;
      });
      if (!hits.length) return null;
      return Object.assign({
        id: 'product-high-risk', severity: 'high', category: T('fi.cat.access'),
        entities: hits.slice(0, 80).map(a => {
          const p = m.products.byName.get(a.productName.toLowerCase());
          return {
            type: 'product', key: a.id, label: a.productName,
            detail: T('fi.product-high-risk.detail', { user: a.userName, risk: p.riskFactor })
          };
        }),
        impactMonthly: 0
      }, prose('product-high-risk', {
        n: hits.length, people: new Set(hits.map(a => a.userName)).size, floor: floor
      }));
    },

    /* Someone left, and their self-service holdings did not. */
    function heldByFormerEmployee(m) {
      if (!m.productHolders || !m.vault) return null;
      const now = new Date();
      const hits = [];
      for (const a of m.assignments.open) {
        const link = m.productHolders.byUser.get(a.userName.toLowerCase());
        if (!link || !link.person) continue;
        const life = HR.vault.lifecycle(link.person, now);
        if (life.state === 'past') hits.push({ a, person: link.person, days: life.days });
      }
      if (!hits.length) return null;
      return Object.assign({
        id: 'product-holder-left', severity: 'critical', category: T('fi.cat.access'),
        entities: hits.slice(0, 80).map(h => ({
          type: 'product', key: h.a.id, label: h.a.productName,
          detail: T('fi.product-holder-left.detail', {
            person: h.person.displayName, days: U.fmtInt(h.days) })
        })),
        impactMonthly: 0
      }, prose('product-holder-left', {
        n: hits.length, people: new Set(hits.map(h => h.person.personId)).size
      }));
    },

    /* Assignments whose holder cannot be tied to a person at all: the products are held
       by a login this analysis cannot place. */
    function unlinkedHolders(m) {
      if (!m.productHolders) return null;
      const stats = m.productHolders.stats;
      if (!stats.unlinked) return null;
      const unlinked = Array.from(m.assignments.byUser.keys())
        .filter(u => !m.productHolders.byUser.has(u));
      return Object.assign({
        id: 'product-unlinked-holder', severity: 'low', category: T('fi.cat.dataQuality'),
        entities: unlinked.slice(0, 80).map(u => ({
          type: 'product', key: u, label: u,
          detail: T('fi.product-unlinked-holder.detail', {
            n: (m.assignments.byUser.get(u) || []).length })
        })),
        impactMonthly: 0
      }, prose('product-unlinked-holder', { n: unlinked.length, total: stats.users }));
    },

    /* No approver recorded. Auto-approval is a legitimate configuration; not being able
       to tell it apart from an unrecorded one is the finding. */
    function approvalUnrecorded(m) {
      const hits = m.assignments.rows.filter(a => !a.approvedBy);
      if (!hits.length || hits.length === m.assignments.rows.length && m.assignments.rows.length < 5) return null;
      return Object.assign({
        id: 'product-approval-unrecorded', severity: 'info', category: T('fi.cat.dataQuality'),
        entities: U.uniq(hits.map(a => a.productName)).slice(0, 80).map(name => ({
          type: 'product', key: name, label: name,
          detail: T('fi.product-approval-unrecorded.detail', {
            n: hits.filter(a => a.productName === name).length })
        })),
        impactMonthly: 0
      }, prose('product-approval-unrecorded', {
        n: hits.length, total: m.assignments.rows.length,
        share: U.fmtPct(hits.length / m.assignments.rows.length, 0)
      }));
    }
  ];


  /* ------------------------------------------------------- the vault as data */
  const VAULT_QUALITY_RULES = [
    /* An attribute nearly everyone has and a few do not: not a policy, a gap. */
    function attributeGaps(m) {
      const facets = m.orgQuality.anomalousFacets;
      if (!facets.length) return null;
      const entities = [];
      facets.forEach(f => f.missing.slice(0, 20).forEach(person => entities.push({
        type: 'person', key: person.personId, label: person.displayName,
        detail: T('fi.vault-attribute-gap.detail', { facet: f.label, fill: U.fmtPct(f.fill, 0) })
      })));
      return Object.assign({
        id: 'vault-attribute-gap', severity: 'high', category: T('fi.cat.dataQuality'),
        entities: entities.slice(0, 80), count: U.sum(facets, f => f.missing.length), impactMonthly: 0
      }, prose('vault-attribute-gap', {
        n: U.sum(facets, f => f.missing.length),
        facets: facets.map(f => f.label + ' (' + U.fmtPct(f.fill, 0) + ')').join(', ')
      }));
    },

    /* A title only on ended contracts can never select anybody again. */
    function titlesOnlyOnEndedContracts(m) {
      const hits = m.orgQuality.deadTitles;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-dead-title', severity: 'medium', category: T('fi.cat.dataQuality'),
        entities: hits.slice(0, 80).map(t => ({
          type: 'title', key: t.name, label: t.name,
          detail: T('fi.vault-dead-title.detail', {
            n: t.ended, date: t.lastEnd ? U.fmtDate(t.lastEnd).split(',')[0] : '\u2014' })
        })),
        impactMonthly: 0
      }, prose('vault-dead-title', { n: hits.length }));
    },

    /* Departments with people and nobody named as manager: no approver, no reviewer. */
    function departmentsWithoutManager(m) {
      const hits = m.orgQuality.departmentsWithoutManager;
      if (!hits.length) return null;
      const total = m.orgQuality.structure.meta.departments;
      return Object.assign({
        id: 'vault-no-manager', severity: 'medium', category: T('fi.cat.process'),
        entities: hits.slice(0, 80).map(n => ({
          type: 'department', key: n.id, label: n.name,
          detail: T('fi.vault-no-manager.detail', { n: n.people.length })
        })),
        impactMonthly: 0
      }, prose('vault-no-manager', { n: hits.length, total: total }));
    },

    /* People sit in a department the Departments list never declares, so no rule
       condition picking from that list can reach them. */
    function undeclaredDepartments(m) {
      const hits = m.orgQuality.undeclared;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-undeclared-department', severity: 'high', category: T('fi.cat.dataQuality'),
        entities: hits.slice(0, 80).map(n => ({
          type: 'department', key: n.id, label: n.name || n.id,
          detail: T('fi.vault-undeclared-department.detail', { n: n.people.length })
        })),
        impactMonthly: 0
      }, prose('vault-undeclared-department', {
        n: hits.length, people: U.sum(hits, x => x.people.length)
      }));
    },

    function personsWithoutContract(m) {
      const hits = m.orgQuality.noContract;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-no-contract', severity: 'high', category: T('fi.cat.dataQuality'),
        entities: hits.slice(0, 80).map(p => ({
          type: 'person', key: p.personId, label: p.displayName,
          detail: T('fi.vault-no-contract.detail')
        })),
        impactMonthly: 0
      }, prose('vault-no-contract', { n: hits.length, total: m.orgQuality.summary.persons }));
    },

    function contractDatesBackwards(m) {
      const hits = m.orgQuality.backwards;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-contract-backwards', severity: 'medium', category: T('fi.cat.dataQuality'),
        entities: hits.slice(0, 80).map(h => ({
          type: 'person', key: h.person.personId, label: h.person.displayName,
          detail: T('fi.vault-contract-backwards.detail', {
            start: U.fmtDate(h.contract.startDate).split(',')[0],
            end: U.fmtDate(h.contract.endDate).split(',')[0] })
        })),
        impactMonthly: 0
      }, prose('vault-contract-backwards', { n: hits.length }));
    },

    function duplicateExternalIds(m) {
      const hits = m.orgQuality.duplicateIds;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-duplicate-id', severity: 'critical', category: T('fi.cat.dataQuality'),
        entities: hits.slice(0, 80).map(d => ({
          type: 'person', key: d.externalId, label: d.externalId,
          detail: d.persons.map(p => p.displayName).join(' / ')
        })),
        impactMonthly: 0
      }, prose('vault-duplicate-id', { n: hits.length }));
    },

    /* Still named as manager, already gone: every approval aimed at them stalls. */
    function staleManagers(m) {
      let mg = null;
      try { mg = HR.workforce.managers(m.vault); } catch (e) { return null; }
      if (!mg || !mg.stale.length) return null;
      return Object.assign({
        id: 'vault-stale-manager', severity: 'high', category: T('fi.cat.process'),
        entities: mg.stale.slice(0, 80).map(r => ({
          type: 'person', key: r.name, label: r.name,
          detail: T('fi.vault-stale-manager.detail', { n: r.span })
        })),
        impactMonthly: 0
      }, prose('vault-stale-manager', {
        n: mg.stale.length, reports: mg.summary.affectedReports
      }));
    },

    /* Contracts about to end: the only warning a reconciliation cannot give, because
       everything it reports has already happened. */
    function contractsEndingSoon(m) {
      const hits = m.orgQuality.endingSoon;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-contract-ending', severity: 'medium', category: T('fi.cat.process'),
        entities: hits.slice(0, 80).map(h => ({
          type: 'person', key: h.person.personId, label: h.person.displayName,
          detail: T('fi.vault-contract-ending.detail', {
            days: h.days, date: U.fmtDate(h.contract.endDate).split(',')[0],
            dept: h.contract.department.name || '\u2014' })
        })),
        impactMonthly: 0
      }, prose('vault-contract-ending', {
        n: hits.length, people: new Set(hits.map(h => h.person.personId)).size,
        soonest: hits[0].days
      }));
    },

    function contractsStartingSoon(m) {
      const hits = m.orgQuality.startingSoon;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-contract-starting', severity: 'info', category: T('fi.cat.process'),
        entities: hits.slice(0, 80).map(h => ({
          type: 'person', key: h.person.personId, label: h.person.displayName,
          detail: T('fi.vault-contract-starting.detail', {
            days: h.days, date: U.fmtDate(h.contract.startDate).split(',')[0],
            dept: h.contract.department.name || '\u2014' })
        })),
        impactMonthly: 0
      }, prose('vault-contract-starting', {
        n: hits.length, people: new Set(hits.map(h => h.person.personId)).size
      }));
    },

    /* HelloID has been told to leave these people alone, so their access is outside the
       identity system on purpose — which is not the same as by accident. */
    function flaggedPersons(m) {
      const hits = m.orgQuality.flagged;
      if (!hits.length) return null;
      const label = p => [
        p.blocked ? T('fi.flag.blocked') : null,
        p.excluded ? T('fi.flag.excluded') : null,
        p.skipProcessing ? T('fi.flag.skip') : null
      ].filter(Boolean).join(', ');
      return Object.assign({
        id: 'vault-flagged-person', severity: 'medium', category: T('fi.cat.process'),
        entities: hits.slice(0, 80).map(p => ({
          type: 'person', key: p.personId, label: p.displayName, detail: label(p)
        })),
        impactMonthly: 0
      }, prose('vault-flagged-person', {
        n: hits.length, total: m.orgQuality.summary.persons
      }));
    },

    /* Two contracts running at once: legitimate, and it makes "their department"
       ambiguous for every rule written against one. */
    function multipleActiveContracts(m) {
      const hits = m.orgQuality.multiContract;
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-multi-contract', severity: 'low', category: T('fi.cat.dataQuality'),
        entities: hits.slice(0, 80).map(p => ({
          type: 'person', key: p.personId, label: p.displayName,
          detail: T('fi.vault-multi-contract.detail', {
            n: p.activeContracts.length,
            depts: U.uniq(p.activeContracts.map(c => c.department.name).filter(Boolean)).join(', ') || '\u2014' })
        })),
        impactMonthly: 0
      }, prose('vault-multi-contract', { n: hits.length }));
    },

    /* A current employee with no account anywhere: the joiner half of the problem this
       tool otherwise only sees from the leaver end. */
    function activePersonsWithoutAccount(m) {
      if (!m.vault) return null;
      const index = HR.correlate.personAccountIndex(m, m.vault, m.correlation);
      const now = new Date();
      const hits = m.vault.persons.filter(p => {
        if (!p.contracts.length) return false;
        const life = HR.vault.lifecycle(p, now);
        if (life.state !== 'current') return false;
        const entry = index.get(p.personId);
        return !entry || !entry.accounts.length;
      });
      if (!hits.length) return null;
      return Object.assign({
        id: 'vault-person-no-account', severity: 'high', category: T('fi.cat.access'),
        entities: hits.slice(0, 80).map(p => {
          const c = p.primaryContract || p.contracts[0];
          return {
            type: 'person', key: p.personId, label: p.displayName,
            detail: T('fi.vault-person-no-account.detail', {
              dept: (c && c.department.name) || '\u2014',
              since: c && c.startDate ? U.fmtDate(c.startDate).split(',')[0] : '\u2014' })
          };
        }),
        impactMonthly: 0
      }, prose('vault-person-no-account', {
        n: hits.length, total: m.vault.persons.length
      }));
    }
  ];


  function runVaultQuality(model) {
    const out = [];
    for (const rule of VAULT_QUALITY_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('vault-quality rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  function runProducts(model) {
    const out = [];
    for (const rule of PRODUCT_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('product rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  function runActivity(model) {
    const out = [];
    for (const rule of ACTIVITY_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('activity rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  const EXPLANATION_RULES = [
    function unexplainedRows(m) {
      const e = m.explanation;
      if (!e.unexplained.length) return null;
      const groups = e.residueByAccount;
      return Object.assign({
        id: 'explain-residue', severity: 'medium', category: T('fi.cat.dataQuality'),
        entities: groups.slice(0, 80).map(g => ({
          type: 'account', key: g.account.key, label: g.account.userName,
          detail: T('fi.explain-residue.detail', {
            n: g.rows.length,
            list: U.uniq(g.permissions.map(p => p.name)).slice(0, 3).join(', ') || g.rows[0].issue
          })
        })),
        impactMonthly: 0
      }, prose('explain-residue', {
        n: e.unexplained.length,
        share: U.fmtPct(1 - e.summary.share, 0),
        accounts: groups.length
      }));
    }
  ];

  function runExplanation(model) {
    const out = [];
    for (const rule of EXPLANATION_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('explanation rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  function runCorrelation(model) {
    const out = [];
    for (const rule of CORRELATION_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('correlation rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  /* --- Nedap ONS workbench ---------------------------------------------------
     Only speaks when a Nedap book is loaded. The book is config, not an import,
     so these rules read it directly; the vault (when present) supplies the HR
     reality the mappings are checked against. */
  const NEDAP_RULES = [
    /* People no scope mapping reaches: HelloID has nothing to provision. */
    function nedapUncoveredPeople(m) {
      const cov = HR.nedapons.coverage(HR.config.getNedapBook(), m.vault);
      if (!cov.uncovered.length) return null;
      return Object.assign({
        id: 'nedap-uncovered', severity: 'high', category: T('fi.cat.nedap'),
        entities: cov.uncovered.slice(0, 80).map(u => ({
          type: 'person', key: u.person.personId, label: u.person.displayName,
          detail: u.contracts.map(c => (c.department || c.departmentId) + (c.title ? ' · ' + c.title : '')).join('; ')
        })),
        count: cov.uncovered.length, impactMonthly: 0
      }, prose('nedap-uncovered', { n: cov.uncovered.length, total: cov.total }));
    },

    /* Names the lookup lists cannot resolve: the CSV row silently drops. */
    function nedapUnresolvedNames(m) {
      const issues = HR.nedapons.checkBook(HR.config.getNedapBook(), m.vault)
        .filter(i => i.rule === 'unresolved-name');
      if (!issues.length) return null;
      return Object.assign({
        id: 'nedap-unresolved', severity: 'high', category: T('fi.cat.nedap'),
        entities: issues.slice(0, 80).map(i => ({
          type: 'mapping', key: i.area + ':' + i.row, label: (i.dept || '—') + ' / ' + (i.title || T('no.allTitles')),
          detail: T('no.area.' + i.area) + ' · ' + T(i.msgKey, i.msgArgs)
        })),
        count: issues.length, impactMonthly: 0
      }, prose('nedap-unresolved', { n: issues.length }));
    },

    /* The rest of the lint: wildcards that swallow rows, redundant grants,
       duplicates, conflicts, names unknown to the imported vault. */
    function nedapLint(m) {
      const issues = HR.nedapons.checkBook(HR.config.getNedapBook(), m.vault)
        .filter(i => i.rule !== 'unresolved-name' && i.severity === 'warning');
      if (!issues.length) return null;
      return Object.assign({
        id: 'nedap-lint', severity: 'medium', category: T('fi.cat.nedap'),
        entities: issues.slice(0, 80).map(i => ({
          type: 'mapping', key: i.area + ':' + i.row + ':' + i.rule,
          label: (i.dept || '—') + ' / ' + (i.title || T('no.allTitles')),
          detail: T('no.area.' + i.area) + ' · ' + T(i.msgKey, i.msgArgs)
        })),
        count: issues.length, impactMonthly: 0
      }, prose('nedap-lint', { n: issues.length }));
    }
  ];

  function runNedap(model) {
    if (HR.nedapons.isEmptyBook(HR.config.getNedapBook())) return [];
    const out = [];
    for (const rule of NEDAP_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('nedap rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  function runVault(model) {
    const out = [];
    for (const rule of VAULT_RULES) {
      let f = null;
      try { f = rule(model); } catch (e) { console.error('vault rule failed:', rule.name, e); }
      if (!f) continue;
      if (f.count == null) f.count = f.entities.length;
      f.annualImpact = (f.impactMonthly || 0) * 12;
      out.push(f);
    }
    return out;
  }

  HR.findings = { run, runComparison, runVault, runCorrelation, runExplanation, runActivity, runProducts,
    runVaultQuality, runNedap,
    RULES, COMPARISON_RULES, VAULT_RULES, CORRELATION_RULES, EXPLANATION_RULES,
    ACTIVITY_RULES, PRODUCT_RULES, VAULT_QUALITY_RULES, NEDAP_RULES };
})(window.HR);
