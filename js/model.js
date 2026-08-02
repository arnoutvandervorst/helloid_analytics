/* Builds the object graph from normalised records: accounts <-> permissions <-> persons.
   Rows are not equal: an "Account unmanaged" row describes an identity, a permission row
   describes one edge of that identity's entitlement graph. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const ISSUE_ACCOUNT = 'Account unmanaged';
  const ISSUE_PERM_UNMANAGED = 'Permission unmanaged';
  const ISSUE_PERM_MISSING = 'Permission missing';

  const KEY_SEP = '\u001f';
  const accountKey = (system, userName) => system + KEY_SEP + userName;
  const permissionKey = (system, name) => system + KEY_SEP + name;

  function build(records, opts) {
    const cfg = HR.config.get();
    const accounts = new Map();
    const permissions = new Map();
    const persons = new Map();
    const systems = new Map();

    const akey = r => accountKey(r.system, r.userName);
    const pkey = r => permissionKey(r.system, r.permission);

    for (const r of records) {
      /* ---- account node ---- */
      const ak = akey(r);
      let a = accounts.get(ak);
      if (!a) {
        a = {
          key: ak, system: r.system, userName: r.userName,
          displayName: r.accountDisplayName || r.userName,
          enabled: r.enabled, personRaw: r.personRaw, personName: r.personName, personId: r.personId,
          records: [], permKeys: new Set(), missingPermKeys: new Set(),
          issues: { total: 0 }, resolutions: {},
          flagged: { accountUnmanaged: false }
        };
        accounts.set(ak, a);
      }
      // Fill in details that may only appear on some of an account's rows.
      if (a.enabled == null && r.enabled != null) a.enabled = r.enabled;
      if (!a.personRaw && r.personRaw) { a.personRaw = r.personRaw; a.personName = r.personName; a.personId = r.personId; }
      if (!a.displayName && r.accountDisplayName) a.displayName = r.accountDisplayName;
      a.records.push(r);
      a.issues[r.issue] = (a.issues[r.issue] || 0) + 1;
      a.issues.total++;
      a.resolutions[r.resolution] = (a.resolutions[r.resolution] || 0) + 1;
      if (r.issue === ISSUE_ACCOUNT) a.flagged.accountUnmanaged = true;

      /* ---- permission node ---- */
      if (r.permission) {
        const pk = pkey(r);
        let p = permissions.get(pk);
        if (!p) {
          const cat = HR.config.categoryFor(r.permission);
          const price = HR.config.priceFor(r.permission);
          p = {
            key: pk, system: r.system, name: r.permission, path: r.permissionPath,
            category: cat.id, categoryLabel: HR.config.labelOf(cat), sensitivity: cat.sensitivity, colorSlot: cat.color,
            monthlyPrice: price.monthly, priceLabel: price.entry ? price.entry.label : null,
            holders: new Set(), holdersEnabled: 0, holdersDisabled: 0, holdersOrphan: 0,
            missingFor: new Set(), issues: {}, records: []
          };
          permissions.set(pk, p);
        }
        p.records.push(r);
        p.issues[r.issue] = (p.issues[r.issue] || 0) + 1;
        if (r.issue === ISSUE_PERM_MISSING) { p.missingFor.add(ak); a.missingPermKeys.add(pk); }
        else { p.holders.add(ak); a.permKeys.add(pk); }
      }

      /* ---- person node ---- */
      if (r.personRaw) {
        let per = persons.get(r.personRaw);
        if (!per) {
          per = { key: r.personRaw, name: r.personName, externalId: r.personId, accountKeys: new Set(), issues: 0 };
          persons.set(r.personRaw, per);
        }
        per.accountKeys.add(ak);
        per.issues++;
      }

      /* ---- system rollup ---- */
      let s = systems.get(r.system);
      if (!s) { s = { name: r.system, rows: 0, accounts: new Set(), permissions: new Set(), issues: {} }; systems.set(r.system, s); }
      s.rows++; s.accounts.add(ak); if (r.permission) s.permissions.add(pkey(r));
      s.issues[r.issue] = (s.issues[r.issue] || 0) + 1;
    }

    /* ---- derived per-account attributes ---- */
    for (const a of accounts.values()) {
      const cls = HR.config.accountClassFor(a.userName, a.displayName);
      a.cls = cls.id; a.clsLabel = HR.config.labelOf(cls); a.clsWeight = cls.weight;
      a.orphan = !a.personRaw;
      a.permCount = a.permKeys.size;
      a.missingCount = a.missingPermKeys.size;
      a.unmanagedPermCount = a.issues[ISSUE_PERM_UNMANAGED] || 0;
      a.perms = Array.from(a.permKeys).map(k => permissions.get(k)).filter(Boolean);
      a.missingPerms = Array.from(a.missingPermKeys).map(k => permissions.get(k)).filter(Boolean);
      a.licences = a.perms.filter(p => p.category === 'licence');
      a.privileged = a.perms.filter(p => p.category === 'privileged' || p.category === 'server');
      a.monthlyCost = U.sum(a.perms, p => p.monthlyPrice || 0);
      a.maxSensitivity = a.perms.reduce((m, p) => Math.max(m, p.sensitivity), 0);
    }

    /* ---- permission holder stats ---- */
    for (const p of permissions.values()) {
      for (const ak of p.holders) {
        const a = accounts.get(ak);
        if (!a) continue;
        if (a.enabled === false) p.holdersDisabled++; else p.holdersEnabled++;
        if (a.orphan) p.holdersOrphan++;
      }
      p.holderCount = p.holders.size;
      p.rare = p.holderCount <= cfg.rarityThreshold;
      p.monthlyTotal = (p.monthlyPrice || 0) * p.holderCount;
    }

    /* ---- peer similarity (entitlement outlier detection) ---- */
    computePeerSimilarity(accounts, permissions);

    /* ---- person rollups ---- */
    for (const per of persons.values()) {
      per.accounts = Array.from(per.accountKeys).map(k => accounts.get(k)).filter(Boolean);
      per.accountCount = per.accounts.length;
      per.permCount = U.sum(per.accounts, a => a.permCount);
      per.monthlyCost = U.sum(per.accounts, a => a.monthlyCost);
      per.enabledAccounts = per.accounts.filter(a => a.enabled !== false).length;
    }

    for (const s of systems.values()) { s.accountCount = s.accounts.size; s.permissionCount = s.permissions.size; }

    const model = {
      records, accounts, permissions, persons, systems,
      accountList: Array.from(accounts.values()),
      permissionList: Array.from(permissions.values()),
      personList: Array.from(persons.values()),
      systemList: Array.from(systems.values()),
      ISSUE_ACCOUNT, ISSUE_PERM_UNMANAGED, ISSUE_PERM_MISSING
    };

    HR.risk.score(model);         // adds risk fields to accounts/permissions + model.risk
    HR.cost.compute(model);       // adds model.cost
    model.findings = HR.findings.run(model);

    /* A business-rule export turns "unmanaged" into two different problems, so the
       comparison runs before the summary and contributes its own findings. */
    const ruleSet = opts && opts.ruleSet;
    const vault = opts && opts.vault;
    const granted = opts && opts.granted;
    const history = opts && opts.history;
    const catalogue = opts && opts.catalogue;
    const products = opts && opts.products;
    const assignments = opts && opts.assignments;
    if (catalogue) model.catalogue = catalogue;
    if (granted) model.granted = granted;
    if (history) model.history = history;
    if (catalogue) model.findings = model.findings.concat(HR.findings.runCatalogue(model));
    if (granted || history) {
      /* What HelloID granted, and what it tried to do — the evidence that separates
         "outside the identity system" from "the identity system put it there". */
      model.activity = HR.activity.reconcile(model, granted, history);
      model.findings = model.findings.concat(HR.findings.runActivity(model));
    }
    if (vault) {
      model.vault = vault;
      /* Who did these unowned accounts belong to? Answerable only with person data. */
      model.correlation = HR.correlate.matchUnowned(model, vault);
      model.linkedAccounts = HR.correlate.linkAccounts(model, vault, model.correlation);
      model.findings = model.findings.concat(HR.findings.runCorrelation(model));
    }
    if (ruleSet) {
      model.comparison = HR.compare.compare(model, ruleSet);

      /* With person data the conditions stop being decoration: rules can be evaluated,
         which turns group-level drift into per-person over- and under-provisioning. */
      if (vault) {
        model.evaluation = HR.evaluate.evaluateAll(ruleSet, vault, { includeDrafts: true });
        model.provisioning = HR.compare.provisioning(model, ruleSet, vault, model.evaluation, model.correlation);
      }
      model.findings = model.findings
        .concat(HR.findings.runComparison(model))
        .concat(model.provisioning ? HR.findings.runVault(model) : [])
        .sort((a, b) => HR.util.severityRank(a.severity) - HR.util.severityRank(b.severity) ||
          (b.impactMonthly || 0) - (a.impactMonthly || 0) || b.count - a.count);
    }
    if (assignments || products) {
      /* Service Automation: what people requested and were given, which the
         reconciliation export never mentions. */
      if (products) model.products = products;
      if (assignments) {
        model.assignments = assignments;
        model.productHolders = HR.products.linkHolders(assignments, model, vault, model.correlation);
      }
      if (products) {
        model.productMatch = HR.products.matchProducts(products, assignments, model,
          model.productHolders, granted, HR.config.get().products);
      }
      if (assignments) {
        /* Only the confirmed map explains anything; proposals stay proposals. */
        model.productMapping = HR.products.applyMapping(model, assignments,
          model.productHolders, HR.config.getMap());
        model.findings = model.findings.concat(HR.findings.runProducts(model));
      }
    }

    /* Runs last: every other input is an ingredient of an explanation. */
    model.explanation = HR.explain.build(model);
    model.findings = model.findings.concat(HR.findings.runExplanation(model));

    model.findings.sort((a, b) => HR.util.severityRank(a.severity) - HR.util.severityRank(b.severity) ||
      (b.impactMonthly || 0) - (a.impactMonthly || 0) || b.count - a.count);
    model.summary = summarise(model);
    return model;
  }

  /**
   * For every account, find its closest peer by Jaccard similarity of entitlement sets.
   *
   * Comparing every pair is quadratic and blows up past a few thousand accounts, so
   * candidates come from an index of each account's *rarest* permissions: two accounts
   * with a genuinely similar profile almost always share at least one uncommon group,
   * while ubiquitous groups (which carry no identifying signal) are skipped. Accounts
   * whose only overlap is a ubiquitous group therefore read as having no peer — which
   * is the honest answer: nothing in the data distinguishes them.
   */
  function computePeerSimilarity(accounts, permissions) {
    const RARE_PER_ACCOUNT = 5;      // index each account under its 5 least common groups
    const MAX_HOLDERS = 400;         // groups above this are treated as ubiquitous
    const MAX_CANDIDATES = 400;      // per account, cheapest candidate lists first

    const list = Array.from(accounts.values()).filter(a => a.permCount > 0);
    for (const a of list) { a.peerBest = null; a.peerKey = null; a.outlier = 0; a.uniquePerms = []; }
    if (list.length < 2) return;

    /* index: permission -> accounts that count it among their rarest */
    const index = new Map();
    for (const a of list) {
      const rare = a.perms
        .filter(p => p.holderCount <= MAX_HOLDERS)
        .sort((x, y) => x.holderCount - y.holderCount)
        .slice(0, RARE_PER_ACCOUNT);
      a._rareKeys = rare.map(p => p.key);
      for (const k of a._rareKeys) {
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(a);
      }
    }

    for (const a of list) {
      const seen = new Set();
      const lists = a._rareKeys.map(k => index.get(k) || []).sort((x, y) => x.length - y.length);
      let best = 0, bestPeer = null, checked = 0, compared = 0;
      for (const bucket of lists) {
        for (const b of bucket) {
          if (b === a || seen.has(b.key)) continue;
          seen.add(b.key);
          if (++checked > MAX_CANDIDATES) break;
          compared++;
          // intersect by walking the smaller set
          const [small, large] = a.permCount <= b.permCount ? [a, b] : [b, a];
          let shared = 0;
          for (const k of small.permKeys) if (large.permKeys.has(k)) shared++;
          const jac = shared / (a.permCount + b.permCount - shared);
          if (jac > best) { best = jac; bestPeer = b; }
        }
        if (checked > MAX_CANDIDATES) break;
      }
      /* No candidate at all means every group this account holds is ubiquitous —
         that is "not comparable", not "maximally unusual", so the signal stays empty. */
      a.peerBest = compared ? best : null;
      a.peerKey = bestPeer ? bestPeer.key : null;
      a.outlier = compared ? 1 - best : null;
      a.uniquePerms = bestPeer ? a.perms.filter(p => !bestPeer.permKeys.has(p.key)) : [];
      delete a._rareKeys;
    }
  }

  function summarise(m) {
    const accs = m.accountList;
    const enabled = accs.filter(a => a.enabled !== false);
    const disabled = accs.filter(a => a.enabled === false);
    const orphans = accs.filter(a => a.orphan);
    const issueCounts = U.counts(m.records, r => r.issue);
    return {
      rows: m.records.length,
      systems: m.systemList.length,
      accounts: accs.length,
      enabledAccounts: enabled.length,
      disabledAccounts: disabled.length,
      persons: m.personList.length,
      permissions: m.permissionList.length,
      orphanAccounts: orphans.length,
      orphanEnabled: orphans.filter(a => a.enabled !== false).length,
      unmanagedPermissionRows: issueCounts.get(ISSUE_PERM_UNMANAGED) || 0,
      unmanagedAccountRows: issueCounts.get(ISSUE_ACCOUNT) || 0,
      missingPermissionRows: issueCounts.get(ISSUE_PERM_MISSING) || 0,
      issueCounts: Object.fromEntries(issueCounts),
      excludedRows: m.records.filter(r => r.resolution && r.resolution !== 'None').length,
      coverage: accs.length ? (accs.length - orphans.length) / accs.length : 0,
      riskScore: m.risk.overall,
      riskBand: HR.config.severityOf(m.risk.overall),
      monthlyCost: m.cost.totalMonthly,
      wasteMonthly: m.cost.wasteMonthly,
      remediationCost: m.cost.remediationCost,
      criticalFindings: m.findings.filter(f => f.severity === 'critical').length,
      highFindings: m.findings.filter(f => f.severity === 'high').length
    };
  }

  HR.model = { build, accountKey, permissionKey };
})(window.HR);
