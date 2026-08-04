/* Attestation packs: "review your people's access" as a file a manager can actually use.

   An access review stalls on assembly, not on judgement. The reviewing manager needs one
   list: my people, everything each of them holds, what it costs, whether it is
   sensitive, and why they have it — and a column to write keep or revoke in. HelloID
   holds all of the raw material and none of the assembly; tenants buy a separate product
   for it or paste spreadsheets by hand.

   This tool already knows all of it. The vault says who reports to whom. The
   reconciliation and granted exports say who holds what. The rules, the product map, the
   baseline and the mined model say why. A pack is those answers joined per manager, with
   the unexplained rows flagged — because "no rule, no product, not common in the
   department" is exactly the row a reviewer should read first.

   The reason column states evidence, not certainty: a rule names its rule, a product its
   approval, the department share its percentage. What cannot be explained says so. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const T = (k, p) => HR.i18n.t(k, p);

  /**
   * Why does this person hold this entitlement? Best available answer, labelled.
   */
  function reasonResolver(model) {
    /* Rules: what the evaluation says each person is entitled to. */
    const expected = new Map();          // personId -> Map(permKey -> rule names)
    if (model.provisioning) {
      model.provisioning.rows.forEach(row => {
        const map = new Map();
        (row.expected || []).forEach(x => {
          if (x.perm) map.set(x.perm.key, (x.rules || row.matchedRules || []).map(r => r.name));
        });
        expected.set(row.person.personId, map);
      });
    }

    /* The floor. */
    let baseline = new Set();
    let deptShare = new Map();           // person -> Map(permKey -> share in own dept)
    try {
      const pyramid = HR.pyramid.build(model);
      if (pyramid && pyramid.baseline) {
        pyramid.baseline.grants.forEach(g => baseline.add(g.ent));
      }
      if (pyramid && pyramid.people) {
        const byDept = new Map();
        pyramid.people.forEach(p => {
          const d = p.labels.Department || p.attrs.Department;
          if (!d) return;
          if (!byDept.has(d)) byDept.set(d, []);
          byDept.get(d).push(p);
        });
        const deptTally = new Map();
        byDept.forEach((members, dept) => {
          const tally = new Map();
          members.forEach(p => p.ents.forEach(e => tally.set(e, (tally.get(e) || 0) + 1)));
          deptTally.set(dept, { tally, size: members.length });
        });
        pyramid.people.forEach(p => {
          const d = p.labels.Department || p.attrs.Department;
          const t = d && deptTally.get(d);
          if (t) deptShare.set(p.person.personId, { tally: t.tally, size: t.size });
        });
      }
    } catch (e) { /* mining optional */ }

    return function reason(person, personRaw, permKey, perm) {
      const exp = expected.get(person.personId);
      if (exp && exp.has(permKey)) {
        const rules = exp.get(permKey);
        return { kind: 'rule', text: T('at.rRule', { rule: rules.slice(0, 2).join(', ') || '?' }) };
      }
      if (model.productMapping && personRaw) {
        const hit = model.productMapping.lookup(personRaw, permKey);
        if (hit) return { kind: 'product', text: T('at.rProduct', { product: hit.product }) };
      }
      if (baseline.has(permKey)) return { kind: 'baseline', text: T('at.rBaseline') };
      const share = deptShare.get(person.personId);
      if (share && perm) {
        const n = share.tally.get(permKey) || 0;
        if (share.size >= 3 && n / share.size >= 0.5) {
          return { kind: 'common', text: T('at.rCommon', { pct: U.fmtPct(n / share.size, 0) }) };
        }
      }
      return { kind: 'unexplained', text: T('at.rNone') };
    };
  }

  /**
   * One pack per manager: their current reports, everything each holds, and why.
   */
  function build(model) {
    if (!model.vault) return null;
    const managers = HR.workforce.managers(model.vault);
    if (!managers.rows.length) return null;

    const index = HR.correlate.personAccountIndex(model, model.vault, model.correlation);
    const reason = reasonResolver(model);
    const now = new Date();

    const packs = managers.rows.map(mgr => {
      const rows = [];
      let unexplained = 0, sensitive = 0, monthly = 0;

      for (const person of mgr.reports) {
        const entry = index.get(person.personId);
        const accounts = entry ? entry.accounts : [];
        const contract = person.primaryContract || person.contracts[0] || null;
        const life = HR.vault.lifecycle(person, now);

        if (!accounts.length) {
          rows.push({
            person, life, contract, account: null, perm: null,
            reason: { kind: 'none', text: T('at.rNoAccount') }
          });
          continue;
        }
        for (const account of accounts) {
          for (const permKey of account.permKeys) {
            const perm = model.permissions.get(permKey);
            const why = reason(person, account.personRaw, permKey, perm);
            if (why.kind === 'unexplained') unexplained++;
            if (perm && perm.sensitivity >= 1.6) sensitive++;
            monthly += perm ? (perm.monthlyPrice || 0) : 0;
            rows.push({ person, life, contract, account, perm, reason: why });
          }
        }
      }

      /* The rows a reviewer must read first, first. */
      const order = { unexplained: 0, none: 1, common: 2, product: 3, baseline: 4, rule: 5 };
      rows.sort((a, b) => (order[a.reason.kind] ?? 9) - (order[b.reason.kind] ?? 9) ||
        a.person.displayName.localeCompare(b.person.displayName));

      return {
        manager: mgr, rows,
        summary: {
          reports: mgr.reports.length,
          entitlements: rows.filter(r => r.perm).length,
          unexplained, sensitive,
          monthly
        }
      };
    }).sort((a, b) => b.summary.unexplained - a.summary.unexplained);

    return {
      packs,
      summary: {
        managers: packs.length,
        rows: U.sum(packs, p => p.rows.length),
        unexplained: U.sum(packs, p => p.summary.unexplained),
        stale: packs.filter(p => p.manager.stale).length
      }
    };
  }

  /** The file itself. The Decision column ships empty on purpose: it is the review. */
  function toCsv(model, packs) {
    const rows = [];
    for (const pack of packs) {
      for (const r of pack.rows) {
        rows.push({
          Manager: pack.manager.name,
          ManagerStatus: pack.manager.stale ? T('at.staleTag') : '',
          Person: r.person.displayName,
          EmployeeId: r.person.externalId || '',
          Department: r.contract ? (r.contract.department.name || r.contract.department.externalId || '') : '',
          Title: r.contract ? (r.contract.title.name || '') : '',
          ContractState: r.life.state,
          Account: r.account ? r.account.userName : '',
          AccountEnabled: r.account ? (r.account.enabled === false ? 'false' : 'true') : '',
          System: r.perm ? r.perm.system : '',
          Entitlement: r.perm ? r.perm.name : '',
          Sensitive: r.perm && r.perm.sensitivity >= 1.6 ? 'yes' : '',
          MonthlyCost: r.perm && r.perm.monthlyPrice ? r.perm.monthlyPrice.toFixed(2) : '',
          HowGranted: r.reason.text,
          Decision: '',
          Comment: ''
        });
      }
    }
    return U.toCSV(rows, ['Manager', 'ManagerStatus', 'Person', 'EmployeeId', 'Department',
      'Title', 'ContractState', 'Account', 'AccountEnabled', 'System', 'Entitlement',
      'Sensitive', 'MonthlyCost', 'HowGranted', 'Decision', 'Comment']);
  }

  HR.attest = { build, toCsv };
})(window.HR);
