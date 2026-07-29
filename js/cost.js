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

  HR.cost = { compute };
})(window.HR);
