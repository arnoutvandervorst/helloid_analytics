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
    /* Per-item classification answers from the wizard: they win over every
       pattern rule, the way a corrected bank transaction stays corrected. */
    const catOverrides = HR.config.getCatOverrides();
    const clsOverrides = HR.config.getClsOverrides();
    const catFamilies = HR.config.getCatFamilies();
    const clsFamilies = HR.config.getClsFamilies();
    const categoryById = id => (cfg.categories || []).find(c => c.id === id) || null;
    const classById = id => (cfg.accountClasses || []).find(c => c.id === id) || null;

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
          enabled: r.enabled, personRaw: r.personRaw, personName: r.personRaw, personId: '',
          records: [], permKeys: new Set(), missingPermKeys: new Set(),
          issues: { total: 0 }, resolutions: {},
          flagged: { accountUnmanaged: false }
        };
        accounts.set(ak, a);
      }
      // Fill in details that may only appear on some of an account's rows.
      if (a.enabled == null && r.enabled != null) a.enabled = r.enabled;
      if (!a.personRaw && r.personRaw) { a.personRaw = r.personRaw; a.personName = r.personRaw; }
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
          /* item assignment > family assignment > built-in hint > fallback */
          let cat = null, catSource = 'default';
          const ov = catOverrides[r.permission];
          if (ov && categoryById(ov)) { cat = categoryById(ov); catSource = 'manual'; }
          if (!cat) {
            const fam = HR.wizard.famKeyOf(r.permission);
            if (fam) {
              const famId = catFamilies[HR.wizard.famStoreKey(r.system, fam)];
              if (famId && categoryById(famId)) { cat = categoryById(famId); catSource = 'family'; }
              if (!cat) {
                const hint = HR.mine.hintFor(fam);
                if (hint && categoryById(hint.hint)) { cat = categoryById(hint.hint); catSource = 'auto'; }
              }
            }
          }
          if (!cat) cat = cfg.categories[cfg.categories.length - 1];
          const price = HR.config.priceFor(r.permission, cat.id);
          p = {
            key: pk, system: r.system, name: r.permission, path: r.permissionPath,
            category: cat.id, categoryLabel: HR.config.labelOf(cat), sensitivity: cat.sensitivity, colorSlot: cat.color,
            categorySource: catSource,
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
          per = { key: r.personRaw, name: r.personRaw, externalId: '', accountKeys: new Set(), issues: 0 };
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
    /* Employee-category detection wants the vault before risk scoring runs, and the
       vault is already in opts here; only the exact-evidence lookup is built — the
       fuzzy correlation still happens later and does not feed the multiplier. */
    const vaultLookup = (opts && opts.vault) ? buildVaultLookup(opts.vault) : null;
    const matchDecisions = HR.config.getMatchBook().decisions;
    const ecatOverrides = HR.config.getEcatOverrides();
    for (const a of accounts.values()) {
      a.orphan = !a.personRaw;
      /* A human decision in the match book outranks what the export says: a
         confirmed or assigned account has an owner, an ownerless one is owner-
         less on purpose — neither may keep raising orphan findings. */
      const md = matchDecisions[a.key];
      a.matchDecision = md || null;
      a.ownerless = false;
      if (md) {
        if (md.decision === 'confirmed' || md.decision === 'assigned') {
          a.orphan = false;
          if (md.personName) { if (!a.personRaw) a.personRaw = md.personName; a.personName = md.personName; }
          a.matchSource = 'manual';
        } else if (md.decision === 'ownerless') {
          a.orphan = false;
          a.ownerless = true;
        }
      }
      a.permCount = a.permKeys.size;
      a.missingCount = a.missingPermKeys.size;
      a.unmanagedPermCount = a.issues[ISSUE_PERM_UNMANAGED] || 0;
      a.perms = Array.from(a.permKeys).map(k => permissions.get(k)).filter(Boolean);
      a.missingPerms = Array.from(a.missingPermKeys).map(k => permissions.get(k)).filter(Boolean);
      a.licences = a.perms.filter(p => p.category === 'licence');
      a.privileged = a.perms.filter(p => p.category === 'privileged' || p.category === 'server');
      a.monthlyCost = U.sum(a.perms, p => p.monthlyPrice || 0);
      a.maxSensitivity = a.perms.reduce((m, p) => Math.max(m, p.sensitivity), 0);

      /* Both classification axes run through one layered engine; they differ only
         in which evidence leads. A class is what the account is — its own name
         first, what it holds second. A category is who it works for — the linked
         contract first. */
      const ctx = {
        Vault: vaultCategoryStrings(a, vaultLookup),
        Account: [a.userName, a.displayName || ''],
        Group: a.perms.map(p => p.name)
      };
      /* item assignment > cohort assignment > name hint > privileged
         membership > fallback. The membership step replaces the old
         group-pattern layer: an account holding privileged entitlements is an
         admin account, whatever its name says, unless assigned otherwise. */
      let clsRow = null, clsSource = 'default';
      const clsOv = clsOverrides[a.key];
      if (clsOv && classById(clsOv)) { clsRow = classById(clsOv); clsSource = 'manual'; }
      if (!clsRow) {
        const co = HR.wizard.cohortKeyOf(a.userName);
        if (co) {
          const famId = clsFamilies[HR.wizard.famStoreKey(a.system, co)];
          if (famId && classById(famId)) { clsRow = classById(famId); clsSource = 'family'; }
          if (!clsRow) {
            const hint = HR.mine.classHintFor(co.slice(2));
            if (hint && classById(hint.id)) { clsRow = classById(hint.id); clsSource = 'auto'; }
          }
        }
      }
      if (!clsRow && a.privileged.length && classById('admin')) {
        clsRow = classById('admin'); clsSource = 'membership';
      }
      if (!clsRow) clsRow = cfg.accountClasses[cfg.accountClasses.length - 1];
      a.cls = clsRow.id;
      a.clsLabel = HR.config.labelOf(clsRow);
      a.clsWeight = clsRow.weight > 0 ? clsRow.weight : 1;
      a.clsSource = clsSource;
      const ec = classifyByLayers(cfg.employeeCategories || [], ['Vault', 'Account', 'Group'], ctx);
      a.ecat = ec.row ? ec.row.id : '';
      a.ecatLabel = ec.row ? HR.config.labelOf(ec.row) : '';
      a.ecatMult = ec.row && ec.row.multiplier > 0 ? ec.row.multiplier : 1;
      a.ecatSource = ec.source;
      /* A human's per-account correction outranks every detection layer. */
      const ov = ecatOverrides[a.key];
      const ovRow = ov ? (cfg.employeeCategories || []).find(r => r.id === ov) : null;
      if (ovRow) {
        a.ecat = ovRow.id;
        a.ecatLabel = HR.config.labelOf(ovRow);
        a.ecatMult = ovRow.multiplier > 0 ? ovRow.multiplier : 1;
        a.ecatSource = 'manual';
      }
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
      /* The model builds from whichever exports are present; views that can only
         speak about reconciliation rows check this rather than assuming them. */
      hasRecon: records.length > 0,
      accountList: Array.from(accounts.values()),
      permissionList: Array.from(permissions.values()),
      personList: Array.from(persons.values()),
      systemList: Array.from(systems.values()),
      ISSUE_ACCOUNT, ISSUE_PERM_UNMANAGED, ISSUE_PERM_MISSING
    };

    if (HR.sod) HR.sod.evaluate(model);   // toxic combinations feed the account risk below
    HR.risk.score(model);         // adds risk fields to accounts/permissions + model.risk
    HR.cost.compute(model);       // adds model.cost

    /* The permission suppliers as first-class citizens: per-system spend, risk
       and hygiene, so a system can be judged rather than read as a name column. */
    for (const s of model.systemList) {
      const accs = model.accountList.filter(a => a.system === s.name);
      const perms = model.permissionList.filter(p => p.system === s.name);
      s.enabledAccounts = accs.filter(a => a.enabled !== false).length;
      s.orphanAccounts = accs.filter(a => a.orphan).length;
      s.orphanEnabled = accs.filter(a => a.orphan && a.enabled !== false).length;
      s.monthlySpend = U.sum(perms, p => p.monthlyTotal);
      s.rare = perms.filter(p => p.rare).length;
      s.privileged = perms.filter(p => p.category === 'privileged' || p.category === 'server').length;
      s.unmanagedRows = s.issues[ISSUE_PERM_UNMANAGED] || 0;
      s.unmanagedShare = s.rows ? s.unmanagedRows / s.rows : 0;
      const r = (model.risk.bySystem || []).find(x => x.key === s.name);
      s.meanRisk = r ? r.meanRisk : 0;
      s.maxRisk = r ? r.maxRisk : 0;
      s.critical = r ? r.critical : 0;
      s.high = r ? r.high : 0;
    }

    model.findings = HR.findings.run(model);

    /* A business-rule export turns "unmanaged" into two different problems, so the
       comparison runs before the summary and contributes its own findings. */
    const ruleSet = opts && opts.ruleSet;
    const vault = opts && opts.vault;
    const granted = opts && opts.granted;
    const history = opts && opts.history;
    const products = opts && opts.products;
    const assignments = opts && opts.assignments;
    /* The collected AD/Entra export, for checks that need the directory's own
       shape (group nesting, last sign-ins) rather than the reconciliation's. */
    if (opts && opts.directory) model.directory = opts.directory;
    if (granted) model.granted = granted;
    if (history) model.history = history;
    if (granted || history) {
      /* What HelloID granted, and what it tried to do — the evidence that separates
         "outside the identity system" from "the identity system put it there". */
      model.activity = HR.activity.reconcile(model, granted, history);
      model.findings = model.findings.concat(HR.findings.runActivity(model));
    }
    if (vault) {
      model.vault = vault;
      /* The vault as data rather than as input: what is missing, dangling or dead in it
         weakens every check that leans on it. */
      model.orgQuality = HR.org.quality(vault);
      model.findings = model.findings.concat(HR.findings.runVaultQuality(model));
      /* Who did these unowned accounts belong to? Answerable only with person data. */
      model.correlation = HR.correlate.matchUnowned(model, vault);
      model.linkedAccounts = HR.correlate.linkAccounts(model, vault, model.correlation);
      model.findings = model.findings.concat(HR.findings.runCorrelation(model));
    }
    if (ruleSet) {
      model.ruleSet = ruleSet;
      model.comparison = HR.compare.compare(model, ruleSet);

      /* Rule coverage per system: a connector whose permissions no rule touches
         is a whole system outside the model — worth naming as such. */
      for (const s of model.systemList) {
        const rows = model.comparison.permissionRows.filter(r => r.perm.system === s.name);
        s.coverage = {
          modelled: rows.filter(r => r.state === 'modelled').length,
          draftOnly: rows.filter(r => r.state === 'draft-only').length,
          unmodelled: rows.filter(r => r.state === 'unmodelled').length,
          total: rows.length
        };
      }

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

    /* Nedap workbench findings live off the config book, not an import — they
       speak only when a book has been loaded there. */
    model.findings = model.findings.concat(HR.findings.runNedap(model));

    /* Runs last: every other input is an ingredient of an explanation. */
    model.explanation = HR.explain.build(model);
    model.findings = model.findings.concat(HR.findings.runExplanation(model));

    model.findings.sort((a, b) => HR.util.severityRank(a.severity) - HR.util.severityRank(b.severity) ||
      (b.impactMonthly || 0) - (a.impactMonthly || 0) || b.count - a.count);
    /* Second cost pass: the buckets that need the vault, directory and history. */
    if (HR.cost.hidden) {
      try { HR.cost.hidden(model); model.findings = model.findings.concat(HR.findings.runHidden(model)); }
      catch (e) { console.error(e); }
    }
    model.summary = summarise(model);
    /* The compliance score travels with the summary, so every snapshot keeps it and
       the trend can be drawn. policy.js loads later, so this is a runtime lookup. */
    if (HR.policy && model.hasRecon) {
      try { Object.assign(model.summary, HR.policy.summaryOf(model)); } catch (e) { console.error(e); }
    }
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
  /* ---- employee category ---------------------------------------------------
     Exact vault evidence only: the vault's own Accounts[] usernames, and person
     display names for matching the reconciliation's Person column. Fuzzy name
     correlation is deliberately not used here — a risk multiplier should not
     ride on a guessed identity. */
  function buildVaultLookup(vault) {
    const norm = s => (s || '').trim().toLowerCase();
    const byUser = new Map(), byName = new Map();
    for (const p of vault.persons) {
      for (const acc of p.accounts) if (acc.userName) byUser.set(norm(acc.userName), p);
      if (p.displayName) byName.set(norm(p.displayName), p);
      if (p.userName) byUser.set(norm(p.userName), p);
    }
    return { byUser, byName, norm };
  }

  /* What the person's paperwork calls them, as matchable text: contract Type and
     Employer of the running contracts — or of every contract when none runs, so a
     leaver keeps the category their access belonged to. */
  function vaultCategoryStrings(a, lookup) {
    if (!lookup) return null;
    const person = lookup.byUser.get(lookup.norm(a.userName)) ||
      lookup.byName.get(lookup.norm(a.personRaw)) ||
      lookup.byName.get(lookup.norm(a.displayName));
    if (!person) return null;
    const contracts = person.activeContracts.length ? person.activeContracts : person.contracts;
    const out = [];
    for (const c of contracts) {
      if (c.type && c.type.name) out.push(c.type.name);
      if (c.type && c.type.code) out.push(c.type.code);
      if (c.employer && c.employer.name) out.push(c.employer.name);
    }
    return out;
  }

  /* One layered engine for every classification axis. Layers run in the order the
     axis trusts its evidence; within a layer the configured row order decides,
     like every other pattern list in Settings. The last row of a list is the
     fallback and is never pattern-matched — it catches what no layer claimed. */
  const LAYER_SOURCE = { Vault: 'vault', Account: 'name', Group: 'membership' };

  function classifyByLayers(list, order, ctx) {
    const rows = list.slice(0, -1);
    for (const layer of order) {
      const strings = ctx[layer];
      if (!strings || !strings.length) continue;
      for (const row of rows) {
        const rx = row['_rx' + layer];
        if (rx && strings.some(s => rx.test(s))) return { row, source: LAYER_SOURCE[layer] };
      }
    }
    return { row: list[list.length - 1], source: 'default' };
  }

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
