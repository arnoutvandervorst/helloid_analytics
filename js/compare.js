/* Joins a business-rule export against a reconciliation export.

   The question this answers: for every entitlement the target system actually hands out,
   is there a business rule that says it should? That splits the drift in two, and the two
   halves need opposite responses:

     modelled   — a rule already grants this group, yet the assignment is unmanaged.
                  The model is right and something else is wrong: the rule is draft, or
                  its conditions do not select these people.
     unmodelled — no rule grants it at all. This is a gap in the model itself, and the
                  ranked list of these is the "write these rules next" backlog.

   Rules stack, so an entitlement counts as modelled when any rule grants it; there is no
   precedence to resolve. Conditions are read but not evaluated — that needs the person
   data the reconciliation export does not carry. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const norm = s => String(s || '').trim().toLowerCase();

  /* A rule entitlement and a reconciliation permission are the same thing when their
     distinguished paths match; where the export carries no path (Exchange, TOPdesk,
     Azure) fall back to system + display name. */
  const pathKey = (system, path) => norm(system) + '' + norm(path);
  const nameKey = (system, name) => norm(system) + '' + norm(name);

  function compare(model, ruleSet) {
    const rules = ruleSet.rules;

    /* ---- index the reconciliation side ---- */
    const byPath = new Map(), byName = new Map();
    for (const p of model.permissionList) {
      if (p.path) byPath.set(pathKey(p.system, p.path), p);
      byName.set(nameKey(p.system, p.name), p);
    }
    const findPermission = ent => {
      if (ent.path) {
        const hit = byPath.get(pathKey(ent.system, ent.path));
        if (hit) return hit;
      }
      return byName.get(nameKey(ent.system, ent.name)) || null;
    };

    /* ---- walk every rule, attaching what reality says about its entitlements ---- */
    const grantedBy = new Map();          // permission key -> [rule, ...]
    const perRule = rules.map(rule => {
      const matched = [], stale = [], accountEntitlements = [];
      for (const ent of rule.entitlements) {
        if (ent.isAccount) { accountEntitlements.push(ent); continue; }
        const perm = findPermission(ent);
        if (perm) {
          matched.push({ ent, perm });
          if (!grantedBy.has(perm.key)) grantedBy.set(perm.key, []);
          grantedBy.get(perm.key).push(rule);
        } else {
          stale.push(ent);
        }
      }
      const holders = new Set();
      matched.forEach(m => m.perm.holders.forEach(h => holders.add(h)));
      const unmanagedRows = U.sum(matched, m => m.perm.issues[model.ISSUE_PERM_UNMANAGED] || 0);
      const missingRows = U.sum(matched, m => m.perm.issues[model.ISSUE_PERM_MISSING] || 0);

      return {
        rule,
        matched, stale, accountEntitlements,
        holderCount: holders.size,
        holders,
        unmanagedRows,
        missingRows,
        monthlyCost: U.sum(matched, m => m.perm.monthlyPrice || 0),
        /* A published rule that selects nobody, or selects people whose accounts do not
           hold what it grants, is worth a look — but only the first is unambiguous. */
        dead: rule.personsEvaluated === 0,
        live: rule.status === 'published' || rule.status === 'enabled'
      };
    });

    /* ---- and the reverse view: which permissions no rule mentions ---- */
    const permissionRows = model.permissionList.map(p => {
      const granting = grantedBy.get(p.key) || [];
      const live = granting.filter(r => r.status === 'published' || r.status === 'enabled');
      return {
        perm: p,
        rules: granting,
        liveRules: live,
        state: !granting.length ? 'unmodelled' : (live.length ? 'modelled' : 'draft-only'),
        unmanagedRows: p.issues[model.ISSUE_PERM_UNMANAGED] || 0,
        missingRows: p.issues[model.ISSUE_PERM_MISSING] || 0
      };
    });

    const unmodelled = permissionRows.filter(r => r.state === 'unmodelled')
      .sort((a, b) => b.unmanagedRows - a.unmanagedRows || b.perm.riskScore - a.perm.riskScore);
    const draftOnly = permissionRows.filter(r => r.state === 'draft-only');
    const modelled = permissionRows.filter(r => r.state === 'modelled');

    /* ---- attribute every failed grant to the rule that should have delivered it ---- */
    const missingAttribution = [];
    for (const record of model.records) {
      if (record.issue !== model.ISSUE_PERM_MISSING) continue;
      const perm = model.permissions.get(HR.model.permissionKey(record.system, record.permission));
      const granting = perm ? (grantedBy.get(perm.key) || []) : [];
      missingAttribution.push({
        userName: record.userName,
        person: record.personName,
        permission: record.permission,
        rules: granting
      });
    }

    /* ---- groups granted by several rules: fine when rules stack, but worth seeing ---- */
    const overlapping = Array.from(grantedBy.entries())
      .filter(([, rs]) => rs.length > 1)
      .map(([key, rs]) => ({ perm: model.permissions.get(key), rules: rs }))
      .filter(x => x.perm)
      .sort((a, b) => b.rules.length - a.rules.length);

    /* ---- headline coverage ---- */
    const totalUnmanaged = U.sum(permissionRows, r => r.unmanagedRows);
    const unmanagedModelled = U.sum(modelled, r => r.unmanagedRows);
    const unmanagedDraft = U.sum(draftOnly, r => r.unmanagedRows);
    const unmanagedUnmodelled = U.sum(unmodelled, r => r.unmanagedRows);

    const staleEntitlements = perRule.filter(r => r.stale.length);
    const deadLive = perRule.filter(r => r.live && r.dead);
    const draftWithHolders = perRule.filter(r => !r.live && r.holderCount > 0);

    return {
      ruleSet,
      perRule,
      permissionRows,
      unmodelled, draftOnly, modelled,
      missingAttribution,
      overlapping,
      staleEntitlements,
      deadLive,
      draftWithHolders,
      summary: {
        rules: rules.length,
        live: perRule.filter(r => r.live).length,
        draft: perRule.filter(r => !r.live).length,
        entitlements: U.sum(perRule, r => r.matched.length + r.stale.length),
        staleCount: U.sum(staleEntitlements, r => r.stale.length),
        permissions: model.permissionList.length,
        modelledPermissions: modelled.length,
        unmodelledPermissions: unmodelled.length,
        coverage: model.permissionList.length ? modelled.length / model.permissionList.length : 0,
        totalUnmanaged,
        unmanagedModelled,
        unmanagedDraft,
        unmanagedUnmodelled,
        /* The split that decides where the work goes. */
        scopeShare: totalUnmanaged ? (unmanagedModelled + unmanagedDraft) / totalUnmanaged : 0,
        modelShare: totalUnmanaged ? unmanagedUnmodelled / totalUnmanaged : 0,
        missingAttributed: missingAttribution.filter(m => m.rules.length).length,
        missingUnattributed: missingAttribution.filter(m => !m.rules.length).length
      }
    };
  }

  HR.compare = { compare };
})(window.HR);
