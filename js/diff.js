/* Compares two builds of the model — "what changed since the last reconciliation run".
   Both sides are full models, so the diff can speak in accounts and entitlements
   rather than in row counts. */
(function (HR) {
  'use strict';

  const U = HR.util, T = (k, p) => HR.i18n.t(k, p);

  function compare(current, baseline) {
    const acc = diffAccounts(current, baseline);
    const perm = diffPermissions(current, baseline);
    const findings = diffFindings(current, baseline);
    const summary = diffSummary(current.summary, baseline.summary);
    const cost = {
      totalMonthly: delta(current.cost.totalMonthly, baseline.cost.totalMonthly),
      wasteMonthly: delta(current.cost.wasteMonthly, baseline.cost.wasteMonthly),
      unmanagedSpend: delta(current.cost.unmanagedSpend, baseline.cost.unmanagedSpend),
      remediationCost: delta(current.cost.remediationCost, baseline.cost.remediationCost)
    };
    return {
      summary, accounts: acc, permissions: perm, findings, cost,
      risk: delta(current.risk.overall, baseline.risk.overall),
      headline: headline(acc, perm, summary)
    };
  }

  const delta = (a, b) => ({ now: a, was: b, change: (a || 0) - (b || 0),
    pct: b ? ((a - b) / Math.abs(b)) : (a ? 1 : 0) });

  function diffSummary(a, b) {
    const keys = ['rows', 'accounts', 'enabledAccounts', 'disabledAccounts', 'persons', 'permissions',
      'orphanAccounts', 'orphanEnabled', 'unmanagedPermissionRows', 'unmanagedAccountRows',
      'missingPermissionRows', 'riskScore', 'monthlyCost', 'wasteMonthly'];
    const out = {};
    keys.forEach(k => out[k] = delta(a[k], b[k]));
    return out;
  }

  function diffAccounts(cur, base) {
    const added = [], removed = [], changed = [];
    for (const a of cur.accountList) {
      const b = base.accounts.get(a.key);
      if (!b) { added.push({ account: a, reason: T('df.reasonNew') }); continue; }
      const permsAdded = a.perms.filter(p => !b.permKeys.has(p.key));
      const permsRemoved = b.perms.filter(p => !a.permKeys.has(p.key));
      const changes = [];
      if (a.enabled !== b.enabled) changes.push({ field: T('df.fieldEnabled'), from: b.enabled, to: a.enabled });
      if ((a.personRaw || '') !== (b.personRaw || '')) changes.push({ field: T('df.fieldPerson'), from: b.personRaw || '—', to: a.personRaw || '—' });
      if (permsAdded.length) changes.push({ field: T('df.fieldGranted'), from: '', to: permsAdded.map(p => p.name).join(', ') });
      if (permsRemoved.length) changes.push({ field: T('df.fieldRevoked'), from: permsRemoved.map(p => p.name).join(', '), to: '' });
      if (a.riskScore !== b.riskScore) changes.push({ field: T('df.fieldRisk'), from: b.riskScore, to: a.riskScore });
      if (changes.length) changed.push({
        account: a, previous: b, changes,
        permsAdded, permsRemoved,
        riskDelta: a.riskScore - b.riskScore,
        costDelta: a.monthlyCost - b.monthlyCost
      });
    }
    for (const b of base.accountList) if (!cur.accounts.has(b.key)) removed.push({ account: b, reason: T('df.reasonGone') });

    changed.sort((x, y) => Math.abs(y.riskDelta) - Math.abs(x.riskDelta) ||
      (y.permsAdded.length + y.permsRemoved.length) - (x.permsAdded.length + x.permsRemoved.length));
    added.sort((x, y) => y.account.riskScore - x.account.riskScore);
    removed.sort((x, y) => y.account.riskScore - x.account.riskScore);
    return { added, removed, changed };
  }

  function diffPermissions(cur, base) {
    const added = [], removed = [], moved = [];
    for (const p of cur.permissionList) {
      const q = base.permissions.get(p.key);
      if (!q) { added.push(p); continue; }
      if (p.holderCount !== q.holderCount) moved.push({ perm: p, was: q.holderCount, now: p.holderCount, change: p.holderCount - q.holderCount });
    }
    for (const q of base.permissionList) if (!cur.permissions.has(q.key)) removed.push(q);
    moved.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return { added, removed, moved };
  }

  function diffFindings(cur, base) {
    const baseById = new Map(base.findings.map(f => [f.id, f]));
    const rows = cur.findings.map(f => {
      const b = baseById.get(f.id);
      return {
        id: f.id, title: f.title, severity: f.severity,
        now: f.count, was: b ? b.count : 0, change: f.count - (b ? b.count : 0),
        impactNow: f.impactMonthly || 0, impactWas: b ? (b.impactMonthly || 0) : 0,
        isNew: !b
      };
    });
    for (const b of base.findings) if (!cur.findings.some(f => f.id === b.id)) {
      rows.push({ id: b.id, title: b.title, severity: b.severity, now: 0, was: b.count,
        change: -b.count, impactNow: 0, impactWas: b.impactMonthly || 0, resolved: true });
    }
    return rows.sort((a, b) => U.severityRank(a.severity) - U.severityRank(b.severity) || Math.abs(b.change) - Math.abs(a.change));
  }

  function headline(acc, perm, summary) {
    const bits = [];
    if (acc.added.length) bits.push(T('df.hlNewAccounts', { n: acc.added.length }));
    if (acc.removed.length) bits.push(T('df.hlGone', { n: acc.removed.length }));
    if (acc.changed.length) bits.push(T('df.hlChanged', { n: acc.changed.length }));
    const grants = U.sum(acc.changed, c => c.permsAdded.length);
    const revokes = U.sum(acc.changed, c => c.permsRemoved.length);
    if (grants) bits.push(T('df.hlGrants', { n: grants }));
    if (revokes) bits.push(T('df.hlRevokes', { n: revokes }));
    if (perm.added.length) bits.push(T('df.hlNewGroups', { n: perm.added.length }));
    return bits.length ? bits.join(' · ') : T('df.hlNothing');
  }

  HR.diff = { compare };
})(window.HR);
