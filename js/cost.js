/* Cost model: what the entitlement drift actually costs, and what is recoverable.
   Prices come from the editable price book in Settings; anything unpriced counts as €0
   rather than being guessed, so totals are a floor, never an inflated estimate. */
(function (HR) {
  'use strict';

  const U = HR.util;

  function compute(model) {
    const cfg = HR.config.get();
    const eff = cfg.effort;

    const priced = model.permissionList.filter(p => p.monthlyPrice > 0);
    const totalMonthly = U.sum(priced, p => p.monthlyTotal);

    /* --- spend breakdowns --- */
    const bySku = priced.map(p => ({
      key: p.key, name: p.name, label: p.priceLabel || p.categoryLabel, category: p.categoryLabel,
      unit: p.monthlyPrice, holders: p.holderCount,
      enabled: p.holdersEnabled, disabled: p.holdersDisabled, orphan: p.holdersOrphan,
      monthly: p.monthlyTotal, annual: p.monthlyTotal * 12
    })).sort((a, b) => b.monthly - a.monthly);

    const byCategory = Array.from(U.by(priced, p => p.categoryLabel).entries())
      .map(([k, list]) => ({ key: k, monthly: U.sum(list, p => p.monthlyTotal), items: list.length }))
      .sort((a, b) => b.monthly - a.monthly);

    /* --- recoverable waste, bucketed by confidence --- */
    const disabledHolders = model.accountList.filter(a => a.enabled === false && a.monthlyCost > 0);
    const disabledWaste = U.sum(disabledHolders, a => a.monthlyCost);

    const stacked = model.accountList
      .filter(a => a.licences.length > 1)
      .map(a => {
        const prices = a.licences.map(l => l.monthlyPrice || 0).sort((x, y) => y - x);
        return { account: a, skus: a.licences.map(l => l.name), monthly: U.sum(prices.slice(1)) };
      })
      .filter(x => x.monthly > 0)
      .sort((a, b) => b.monthly - a.monthly);
    const stackedWaste = U.sum(stacked, x => x.monthly);

    const orphanEnabled = model.accountList.filter(a => a.orphan && a.enabled !== false && a.monthlyCost > 0);
    const orphanExposure = U.sum(orphanEnabled, a => a.monthlyCost);

    /* Unmanaged spend: priced entitlements assigned outside the HelloID model.
       Not waste by itself — it is spend the IAM system does not control. */
    let unmanagedSpend = 0;
    for (const p of priced) {
      const unmanaged = p.issues[model.ISSUE_PERM_UNMANAGED] || 0;
      unmanagedSpend += p.monthlyPrice * unmanaged;
    }

    /* Deduplicate: a disabled account's stacked SKUs are already in disabledWaste. */
    const disabledKeys = new Set(disabledHolders.map(a => a.key));
    const stackedWasteNet = U.sum(stacked.filter(x => !disabledKeys.has(x.account.key)), x => x.monthly);

    const wasteMonthly = disabledWaste + stackedWasteNet;

    /* --- remediation effort --- */
    const counts = {
      unmanagedPerms: model.records.filter(r => r.issue === model.ISSUE_PERM_UNMANAGED).length,
      unmanagedAccounts: model.records.filter(r => r.issue === model.ISSUE_ACCOUNT).length,
      missingPerms: model.records.filter(r => r.issue === model.ISSUE_PERM_MISSING).length,
      privilegedReviews: model.accountList.filter(a => a.privileged.length > 0).length
    };
    const minutes =
      counts.unmanagedPerms * eff.minutesPerUnmanagedPermission +
      counts.unmanagedAccounts * eff.minutesPerUnmanagedAccount +
      counts.missingPerms * eff.minutesPerMissingPermission +
      counts.privilegedReviews * eff.minutesPerPrivilegedReview;
    const remediationCost = (minutes / 60) * eff.hourlyRate;

    const unpriced = model.permissionList.filter(p => !p.monthlyPrice).length;

    model.cost = {
      totalMonthly, totalAnnual: totalMonthly * 12,
      bySku, byCategory,
      pricedPermissions: priced.length, unpricedPermissions: unpriced,
      disabledWaste, disabledHolders,
      stacked, stackedWaste, stackedWasteNet,
      orphanExposure, orphanEnabled,
      unmanagedSpend,
      wasteMonthly, wasteAnnual: wasteMonthly * 12,
      remediation: { minutes, hours: minutes / 60, cost: remediationCost, counts, rate: eff.hourlyRate },
      remediationCost,
      /* Simple payback: labour to clean up vs. recurring saving. */
      paybackMonths: wasteMonthly > 0 ? remediationCost / wasteMonthly : null
    };
    return model.cost;
  }

  /**
   * The costs the headline never counts: money that is already burning without a row
   * in the waste bucket. Every one of these joins data the model already holds; none
   * is added to the recoverable figure, because "recoverable" must stay defensible.
   * Runs after the vault, directory and history are in, so it is a second pass.
   */
  function hidden(model) {
    const cfg = HR.config.get();
    const eff = cfg.effort;
    const c = model.cost || compute(model);
    const DAY = 86400000;
    const now = new Date();
    const h = {};

    /* Dormant licences: an enabled directory user nobody has seen sign in for the
       dormant period, still paying for what it holds. Needs the collector's lastLogon. */
    const dormantDays = ((cfg.policies || {})['dormant-accounts'] || {}).p || 90;
    if (model.directory && model.directory.users.some(u => u.lastLogon)) {
      const byUser = new Map(model.accountList.map(a => [String(a.userName || '').toLowerCase(), a]));
      const rows = [];
      for (const u of model.directory.users) {
        if (u.enabled === false || !u.lastLogon) continue;
        const days = Math.round((now - u.lastLogon) / DAY);
        if (days < dormantDays) continue;
        const a = byUser.get(String(u.userName || '').toLowerCase());
        if (a && a.monthlyCost > 0) rows.push({ account: a, days, monthly: a.monthlyCost });
      }
      rows.sort((x, y) => y.monthly - x.monthly);
      h.dormant = { available: true, monthly: U.sum(rows, r => r.monthly), rows, days: dormantDays };
    } else h.dormant = { available: false, monthly: 0, rows: [], days: dormantDays };

    /* Leaver burn: what a leaver's priced access has cost since the contract ended,
       and what it still costs per month. */
    if (model.vault && HR.workforce) {
      const res = HR.workforce.leavers(model, model.vault);
      const rows = res.rows.filter(r => r.monthlyCost > 0).map(r => ({
        person: r.person, days: Math.max(0, r.life.days || 0), monthly: r.monthlyCost,
        toDate: r.monthlyCost * Math.max(0, r.life.days || 0) / 30, accounts: r.accounts
      }));
      rows.sort((x, y) => y.toDate - x.toDate);
      h.leavers = { available: true, monthly: U.sum(rows, r => r.monthly), toDate: U.sum(rows, r => r.toDate), rows };
    } else h.leavers = { available: false, monthly: 0, toDate: 0, rows: [] };

    /* Duplicate accounts: the second and later account of one person, costed; the
       cheapest is assumed to be the one they need. */
    if (model.linkedAccounts && model.linkedAccounts.groups) {
      const rows = [];
      for (const g of model.linkedAccounts.groups) {
        const all = [g.primary].concat(g.secondary || []).map(x => x.account || x).filter(Boolean);
        if (all.length < 2) continue;
        const priced = all.filter(a => a.monthlyCost > 0).sort((x, y) => y.monthlyCost - x.monthlyCost);
        if (priced.length < 2) continue;
        const extra = priced.slice(0, -1);   // keep the cheapest
        rows.push({ person: g.person, accounts: all, extra, monthly: U.sum(extra, a => a.monthlyCost) });
      }
      rows.sort((x, y) => y.monthly - x.monthly);
      h.duplicates = { available: true, monthly: U.sum(rows, r => r.monthly), rows };
    } else h.duplicates = { available: false, monthly: 0, rows: [] };

    /* Unmatched: enabled accounts no person owns, costed — spend nobody is accountable
       for. The same accounts as the exposure bucket, framed for the department owner. */
    h.unmatched = { available: true, monthly: c.orphanExposure, rows: c.orphanEnabled };

    /* Manual run-rate: what the history says people do by hand every month, and the
       rework after failed or blocked actions, at the loaded hourly rate. */
    if (model.history && !model.history.empty) {
      const hist = model.history;
      const from = hist.meta.from, to = hist.meta.to;
      const months = from && to ? Math.max(1, (to - from) / (DAY * 30.4)) : 1;
      const manual = hist.rows.filter(r => r.origins.some(o => /manual/i.test(o))).length;
      const failed = hist.failed.length + hist.blocked.length;
      const perMonth = { manual: manual / months, failed: failed / months };
      const minutes = perMonth.manual * eff.minutesPerManualAction + perMonth.failed * eff.minutesPerFailedAction;
      h.manual = { available: true, monthly: (minutes / 60) * eff.hourlyRate, perMonth, months, minutes };
    } else h.manual = { available: false, monthly: 0, perMonth: { manual: 0, failed: 0 }, months: 0, minutes: 0 };

    /* Onboarding delay: joiners who waited longer than the joiner service level, at a
       rate the organisation states itself — 0 means the bucket names the days, not euros. */
    const joinerDays = (cfg.sla && cfg.sla.joinerDays) || 7;
    if (model.vault && model.history && HR.workforce && HR.workforce.onboardingLatency) {
      const lat = HR.workforce.onboardingLatency(model.vault, model.history);
      if (lat) {
        const late = lat.rows.filter(r => r.days > joinerDays);
        const idleDays = U.sum(late, r => r.days - joinerDays);
        h.onboarding = { available: true, rate: eff.idleDayCost || 0, joinerDays, late: late.length, idleDays,
          monthly: (eff.idleDayCost || 0) * idleDays / Math.max(1, (model.history.meta.to - model.history.meta.from) / (DAY * 30.4) || 12), rows: late };
      } else h.onboarding = { available: false, rate: eff.idleDayCost || 0, joinerDays, late: 0, idleDays: 0, monthly: 0, rows: [] };
    } else h.onboarding = { available: false, rate: eff.idleDayCost || 0, joinerDays, late: 0, idleDays: 0, monthly: 0, rows: [] };

    /* True-up: purchased seats against assigned, per price-book row that states seats. */
    const trueup = [];
    (cfg.priceBook || []).forEach(row => {
      if (!(row.seats > 0)) return;
      const perms = model.permissionList.filter(p => p.priceLabel === row.label);
      const assigned = U.sum(perms, p => p.holdersEnabled || 0);
      const over = Math.max(0, row.seats - assigned), under = Math.max(0, assigned - row.seats);
      trueup.push({ label: row.label, price: row.price, seats: row.seats, assigned, over, under,
        shelfware: over * row.price, renewal: row.renewal || '', commitment: row.commitment || null,
        daysToRenewal: row.renewal ? Math.round((new Date(row.renewal) - now) / DAY) : null, perms });
    });
    h.trueup = { rows: trueup, shelfware: U.sum(trueup, r => r.shelfware), under: U.sum(trueup, r => r.under) };

    h.hiddenMonthly = h.dormant.monthly + h.leavers.monthly + h.duplicates.monthly + h.manual.monthly + h.onboarding.monthly;
    c.hidden = h;
    return h;
  }

  HR.cost = { compute, hidden };
})(window.HR);
