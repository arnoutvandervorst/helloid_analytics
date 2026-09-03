/* Risk scoring. Every account gets an explainable 0-100 score built from named
   components, so the drawer can show exactly why an account ranks where it does. */
(function (HR) {
  'use strict';

  const U = HR.util, T = (k, p) => HR.i18n.t(k, p);

  function score(model) {
    const cfg = HR.config.get();
    const R = cfg.risk;

    for (const a of model.accountList) scoreAccount(a, cfg, R, model);
    for (const p of model.permissionList) scorePermission(p, model, cfg);

    const accs = model.accountList;
    const n = accs.length || 1;
    const bands = U.counts(accs, a => a.riskBand);
    const highPlus = (bands.get('critical') || 0) + (bands.get('high') || 0);
    const meanWeighted = U.sum(accs, a => a.riskScore * a.clsWeight) / U.sum(accs, a => a.clsWeight);
    const coverage = accs.length ? accs.filter(a => !a.orphan).length / accs.length : 1;

    const overall = U.clamp(Math.round(
      0.40 * meanWeighted +
      0.35 * (100 * highPlus / n) +
      0.25 * (100 * (1 - coverage))
    ), 0, 100);

    model.risk = {
      overall,
      formula: [
        { label: T('rk.formulaWeightedMean'), weight: 0.40, value: meanWeighted },
        { label: T('rk.formulaShareHigh'), weight: 0.35, value: 100 * highPlus / n },
        { label: T('rk.formulaCoverage'), weight: 0.25, value: 100 * (1 - coverage) }
      ],
      bands: Object.fromEntries(bands),
      byClass: rollup(accs, a => a.clsLabel),
      byEmployeeCategory: rollup(accs, a => a.ecatLabel || '—'),
      bySystem: rollup(accs, a => a.system),
      topAccounts: accs.slice().sort((x, y) => y.riskRaw - x.riskRaw).slice(0, 25),
      topPermissions: model.permissionList.slice().sort((x, y) => y.riskScore - x.riskScore).slice(0, 25)
    };
    return model.risk;
  }

  function rollup(accs, keyFn) {
    const m = U.by(accs, keyFn);
    return Array.from(m.entries()).map(([k, list]) => ({
      key: k,
      accounts: list.length,
      meanRisk: U.sum(list, a => a.riskScore) / list.length,
      maxRisk: list.reduce((mx, a) => Math.max(mx, a.riskScore), 0),
      critical: list.filter(a => a.riskBand === 'critical').length,
      high: list.filter(a => a.riskBand === 'high').length,
      monthlyCost: U.sum(list, a => a.monthlyCost)
    })).sort((a, b) => b.meanRisk - a.meanRisk);
  }

  function scoreAccount(a, cfg, R, model) {
    const parts = [];
    const add = (label, value, detail, noMult) => { if (value > 0.01) parts.push({ label, value, detail, noMult }); };

    /* --- identity-level exposure (scaled by account class) --- */
    let identity = 0;
    if (a.flagged.accountUnmanaged) identity += R.issueWeights['Account unmanaged'] || 0;
    if (a.orphan && a.enabled !== false) identity += R.orphanEnabledBonus;
    const hasPriv = a.privileged.length > 0;
    if (a.orphan && hasPriv) identity += R.privilegedOrphanBonus;
    if (identity > 0) {
      const scaled = identity * a.clsWeight;
      add(T('rc.identity'), scaled,
        [a.flagged.accountUnmanaged ? T('rc.identityUnmanaged') : null,
         a.orphan && a.enabled !== false ? T('rc.identityEnabled') : null,
         a.orphan && hasPriv ? T('rc.identityPriv') : null,
         a.clsWeight !== 1 ? a.clsLabel + ' ×' + a.clsWeight : null].filter(Boolean).join(', '), true);
    }

    /* --- dormant-but-entitled --- */
    if (a.enabled === false && a.permCount > 0) {
      add(T('rc.disabledEntitled'), R.disabledWithEntitlementsBonus,
        T('rc.disabledEntitledD', { n: a.permCount }));
      if (a.licences.length) add(T('rc.disabledLicensed'), R.disabledWithLicenceBonus,
        a.licences.map(l => l.name).join(', '));
    }

    /* --- unmanaged entitlements, with diminishing returns --- */
    const un = a.unmanagedPermCount;
    if (un > 0) {
      const w = R.issueWeights['Permission unmanaged'] || 0;
      const base = w * Math.min(un, 5) + w * Math.sqrt(Math.max(0, un - 5));
      const avgSens = a.perms.length ? U.sum(a.perms, p => p.sensitivity) / a.perms.length : 1;
      const sensMult = U.clamp(avgSens, 0.6, 2.5);
      add(T('rc.drift'), Math.min(base * sensMult, R.unmanagedPermCap || 22),
        T('rc.driftD', { n: un, s: avgSens.toFixed(2) }));
    }

    /* --- entitlements the person should have but does not --- */
    if (a.missingCount > 0) {
      const w = R.issueWeights['Permission missing'] || 0;
      add(T('rc.missing'), Math.min(w * a.missingCount, w * 3),
        a.missingPerms.map(p => p.name).join(', '));
    }

    /* --- rarity: entitlements almost nobody else holds --- */
    if (a.permCount) {
      const rare = a.perms.filter(p => p.rare);
      if (rare.length) {
        const shareRare = rare.length / a.permCount;
        add(T('rc.rare'), R.rarityBonus * Math.min(1, shareRare * 2),
          T('rc.rareD', { n: rare.length, t: cfg.rarityThreshold, list: rare.slice(0, 5).map(p => p.name).join(', ') }));
      }
    }

    /* --- peer-group outlier --- */
    if (a.permCount >= 3 && a.peerBest != null && a.outlier > 0.4) {
      add(T('rc.outlier'), R.outlierBonus * ((a.outlier - 0.4) / 0.6),
        T('rc.outlierD', { p: Math.round((a.peerBest || 0) * 100) }));
    }

    /* --- toxic combination: two things one account should never hold together --- */
    if (HR.sod && model && model._sod && (R.toxicBonus || 0) > 0) {
      const w = HR.sod.weightOf(model, a);
      if (w > 0) add(T('rc.toxic'), R.toxicBonus * w, T('rc.toxicD', { n: model._sod.perAccount.get(a.key).length }));
    }

    /* --- duplicate licence SKUs on one account --- */
    if (a.licences.length > 1) {
      add(T('rc.stacked'), R.stackedLicenceBonus,
        a.licences.map(l => l.name).join(' + '));
    }

    /* Who the account works for scales what it holds: the employee-category
       multiplier applies to the entitlement components, not to the identity
       component — ownership risk is the same whoever the owner would be. */
    const mult = a.ecatMult || 1;
    if (mult !== 1) for (const p of parts) if (!p.noMult) p.value *= mult;

    const raw = U.sum(parts, p => p.value);
    a.riskParts = parts.sort((x, y) => y.value - x.value);
    a.riskRaw = raw;
    a.riskScore = Math.round(U.clamp(raw, 0, R.accountCap));
    a.riskBand = HR.config.severityOf(a.riskScore);
    return a.riskScore;
  }

  function scorePermission(p, model, cfg) {
    const orphanShare = p.holderCount ? p.holdersOrphan / p.holderCount : 0;
    const disabledShare = p.holderCount ? p.holdersDisabled / p.holderCount : 0;
    const unmanaged = p.issues[model.ISSUE_PERM_UNMANAGED] || 0;
    const reach = Math.log2(1 + p.holderCount) / Math.log2(1 + Math.max(2, model.accountList.length));

    const parts = [
      { label: T('dr.pSensitivity'), value: (p.sensitivity / 3) * 45 },
      { label: T('dr.pUnmanaged'), value: p.holderCount ? 25 * (unmanaged / p.holderCount) : 0 },
      { label: T('dr.pUnowned'), value: 20 * orphanShare },
      { label: T('dr.pDisabled'), value: 10 * disabledShare },
      { label: T('dr.pReach'), value: 15 * reach },
      { label: T('dr.pRare'), value: p.rare && p.sensitivity >= 1.5 ? 8 : 0 }
    ].filter(x => x.value > 0.01);

    p.riskParts = parts.sort((a, b) => b.value - a.value);
    p.riskScore = Math.round(U.clamp(U.sum(parts, x => x.value), 0, 100));
    p.riskBand = HR.config.severityOf(p.riskScore);
    p.orphanShare = orphanShare;
    p.disabledShare = disabledShare;
    return p.riskScore;
  }

  HR.risk = { score, scoreAccount, scorePermission };
})(window.HR);
