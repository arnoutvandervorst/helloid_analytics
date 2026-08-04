/* Improving the rule set a tenant already runs.

   Mining proposes a model from scratch. This does the other job: take the rules HelloID
   has today, and make them fewer and further-reaching without changing what they hand
   out more than the owner agrees to.

   Two halves, and they pull in opposite directions.

   Condensing. HelloID conditions take lists, so two rules differing in one department
   and granting the same thing are one rule. Merging is only free when the rules grant
   exactly the same entitlements; the interesting merges are the near-misses, where one
   rule grants something the other does not. Those are still worth doing — one rule
   instead of four is worth an entitlement handed to eleven more people — but only if
   somebody sees the price. So every merge is scored in SOLL: the person-entitlement
   pairs the rules would produce after the merge, against what they produce now. Nothing
   is applied; the trade is listed and exported.

   Extending. Whatever the rules do not model is what the reconciliation keeps reporting
   as unmanaged. Mining already knows which groups travel with a department or a title,
   so the ones covering entitlements no rule grants are the additions that would raise
   coverage, ranked by how much drift each would take out of the report. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '';

  /**
   * What the rules would grant if HelloID evaluated them now.
   *
   * SOLL — the intended state — is the union over live rules of "everybody this rule
   * selects" × "everything this rule grants". It needs the vault to know who a condition
   * selects, so without one this returns nothing rather than guessing.
   */
  function soll(model, ruleSet, evaluation) {
    const pairs = new Set();
    const byRule = new Map();
    if (!evaluation) return { pairs, byRule, available: false };

    evaluation.perRule.forEach(row => {
      const rule = row.rule;
      if (!(rule.status === 'published' || rule.status === 'enabled')) return;
      const people = row.matched || [];
      const ents = rule.entitlements.filter(e => !e.isAccount);
      byRule.set(rule, { people, ents });
      for (const person of people) {
        for (const ent of ents) pairs.add(person.personId + SEP + ent.name);
      }
    });
    return { pairs, byRule, available: true };
  }

  /* Two conditions are the same when they address the same facet with the same operator
     and the same values; the values are sorted because a list has no order. */
  const condKey = c => (c.facet || '') + '|' + (c.operator || '') + '|' +
    (c.values || []).slice().sort().join(',');

  const entKey = ents => ents.map(e => e.name).slice().sort().join(SEP);

  /**
   * Merge rules that differ in exactly one condition.
   *
   * The naive merge — take every rule in a group and union its conditions — is a
   * disaster: seven department rules become one that grants every department's groups to
   * everybody, five and a half thousand grants nobody asked for. What works is the
   * transpose. Within a group of siblings, each entitlement is asked which values grant
   * it, and every distinct answer becomes one rule listing those values. That is lossless
   * by construction: a person receives an entitlement after the merge exactly when some
   * rule granted it to them before.
   *
   * Where a near-miss would collapse several rules into one for a handful of extra
   * grants, that is offered too — separately, priced in SOLL pairs, and only under the
   * ceiling the settings allow. Nothing is applied; the trade is listed and exported.
   */
  function condenseRules(model, ruleSet, evaluation, opts) {
    const cfg = Object.assign({ maxTrade: 25 }, HR.config.get().optimise || {}, opts || {});
    const live = ruleSet.rules.filter(r => r.status === 'published' || r.status === 'enabled');
    const current = soll(model, ruleSet, evaluation);
    const peopleOf = rule => {
      const row = evaluation ? evaluation.perRule.get(rule.name) : null;
      return row ? (row.matched || []) : [];
    };

    /* Siblings: same conditions but one, which is the axis they can merge along. */
    const groups = new Map();
    for (const rule of live) {
      const conds = rule.conditions.filter(c => c && c.facet);
      if (!conds.length) continue;
      conds.forEach((pivot, i) => {
        const rest = conds.filter((_, j) => j !== i);
        const key = pivot.facet + SEP + rest.map(condKey).sort().join(' & ');
        if (!groups.has(key)) groups.set(key, { facet: pivot.facet, rest, members: [] });
        groups.get(key).members.push({ rule, pivot });
      });
    }

    const proposals = [];
    const spent = new Set();

    groups.forEach(group => {
      const members = group.members.filter(m => !spent.has(m.rule));
      if (members.length < 2) return;

      /* Which values grant each entitlement. */
      const holdersOf = new Map();
      members.forEach(m => m.rule.entitlements.forEach(e => {
        if (e.isAccount) return;
        if (!holdersOf.has(e.name)) holdersOf.set(e.name, { ent: e, who: [] });
        holdersOf.get(e.name).who.push(m);
      }));

      const byValueSet = new Map();
      holdersOf.forEach(entry => {
        const key = entry.who.map(m => (m.pivot.values || []).join(',')).sort().join(SEP);
        if (!byValueSet.has(key)) byValueSet.set(key, { who: entry.who, ents: [] });
        byValueSet.get(key).ents.push(entry.ent);
      });

      /* A saving only exists when the transpose produces fewer rules than it consumed. */
      if (byValueSet.size < members.length) {
        members.forEach(m => spent.add(m.rule));
        byValueSet.forEach(entry => {
          /* A "merge" of one rule is that rule; only propose where something combines. */
          if (entry.who.length < 2) return;
          proposals.push(makeProposal(group, entry.who, entry.ents, peopleOf, current, 'lossless'));
        });
        return;
      }

      /* Otherwise: would merging the whole group anyway be cheap enough to be worth it? */
      const ents = Array.from(holdersOf.values()).map(e => e.ent);
      const candidate = makeProposal(group, members, ents, peopleOf, current, 'trade');
      if (candidate.added.length <= cfg.maxTrade) {
        members.forEach(m => spent.add(m.rule));
        proposals.push(candidate);
      }
    });

    proposals.sort((a, b) => (b.replaces - a.replaces) || (a.added.length - b.added.length));
    const replaced = U.sum(proposals, p => p.replaces);

    return {
      proposals, current, maxTrade: cfg.maxTrade,
      summary: {
        rules: live.length,
        merges: proposals.length,
        replaces: replaced,
        after: live.length - replaced + proposals.length,
        lossless: proposals.filter(p => p.kind === 'lossless').length,
        added: U.sum(proposals, p => p.added.length),
        removed: 0
      }
    };
  }

  /** One merge: the union of its conditions, what it grants, and what that changes. */
  function makeProposal(group, members, ents, peopleOf, current, kind) {
    const values = U.uniq(members.flatMap(m => m.pivot.values || []));

    const people = [];
    const seen = new Set();
    members.forEach(m => peopleOf(m.rule).forEach(p => {
      if (seen.has(p.personId)) return;
      seen.add(p.personId);
      people.push(p);
    }));

    /* The price: pairs this rule would create that no current rule creates. */
    const added = [];
    people.forEach(person => ents.forEach(ent => {
      if (!current.pairs.has(person.personId + SEP + ent.name)) added.push({ person, ent });
    }));

    return {
      kind, facet: group.facet, values,
      rules: members.map(m => m.rule),
      keep: group.rest,
      entitlements: ents,
      people,
      replaces: members.length,
      added,
      /* A union never withdraws: everyone selected before is selected now. */
      removed: []
    };
  }

  /**
   * Which mined rules would cover what the current rules do not.
   *
   * The comparison already knows which entitlements no rule grants and how much drift
   * each accounts for; mining already knows which group would explain them. Matching the
   * two gives a ranked list of additions — and the ranking is the drift they remove,
   * because that is what the reconciliation will stop reporting.
   */
  function extensions(model, comparison, pyramid) {
    if (!comparison || !pyramid) return null;

    const unmodelled = new Set(comparison.unmodelled.map(p => p.perm.key));
    const drift = new Map();
    comparison.permissionRows.forEach(row => drift.set(row.perm.key, row.unmanagedRows || 0));

    const candidates = [];
    const add = (conds, grants, source, members) => {
      const covering = grants.filter(g => unmodelled.has(g.ent));
      if (!covering.length) return;
      candidates.push({
        source, conds, members,
        entitlements: covering.map(g => ({
          perm: model.permissions.get(g.ent), coverage: g.coverage, holders: g.holders
        })),
        drift: U.sum(covering, g => drift.get(g.ent) || 0)
      });
    };

    pyramid.ruleGroups.forEach((grants, node) => {
      if (!node.path.length) return;
      add(node.path.map(p => ({ attr: p.attr, values: [p.value], labels: [p.label], byId: p.byId })),
        grants, 'pyramid', node.members);
    });
    pyramid.comboGroups.forEach(group =>
      add(group.conds.map(c => ({ attr: c.attr, values: [c.value], labels: [c.label], byId: c.byId })),
        group.rules, 'combo', group.members));
    if (pyramid.baseline && pyramid.baseline.grants.length) {
      add([], pyramid.baseline.grants, 'baseline', pyramid.baseline.members);
    }

    candidates.sort((a, b) => b.drift - a.drift);

    /* Candidates overlap: the same entitlement is covered by several of them, so summing
       their drift counts the same rows repeatedly and reports more than exists. What can
       actually be taken out of the report is the drift of the entitlements covered, once. */
    const covered = new Set();
    candidates.forEach(c => c.entitlements.forEach(e => { if (e.perm) covered.add(e.perm.key); }));
    const reachable = U.sum(Array.from(covered), key => drift.get(key) || 0);

    return {
      candidates,
      summary: {
        candidates: candidates.length,
        entitlements: covered.size,
        drift: reachable,
        unmodelled: unmodelled.size,
        /* What share of the reported drift these additions would account for. */
        share: comparison.summary.totalUnmanaged ? reachable / comparison.summary.totalUnmanaged : 0
      }
    };
  }

  /** The merged rules, in the export shape, ready to review beside the originals. */
  function toRulesCsv(proposals) {
    const rows = proposals.map(p => ({
      Name: 'Samengevoegd - ' + p.rules[0].name,
      EntitlementCount: p.entitlements.length,
      PersonsLatestEvaluation: p.people.length,
      Categories: p.kind === 'lossless' ? 'Condensed' : 'Condensed (trade-off)',
      Status: 'proposal',
      Conditions: p.keep.map(c => c.raw)
        .concat([p.facet + ', one of: ' + p.values.join(', ')]).join('|'),
      Entitlements: p.entitlements.map(e => e.raw).join('|')
    }));
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  HR.optimise = { soll, condenseRules, extensions, toRulesCsv };
})(window.HR);
