/* Role mining over the organisation's own shape.

   The bundle miner in roles.js asks "which entitlements travel together?" and answers
   without knowing anything about people. That finds real bundles, but it cannot say who
   should get them, so every proposal still needs a human to invent a condition.

   This does the opposite. It takes the attributes HR already maintains — employer,
   department, title, location, contract type — and orders them from broad to specific
   into a pyramid. Every person lands in exactly one path down that pyramid, and an
   entitlement that nearly everyone under a node holds becomes a rule *at that node*.
   Rules are placed as high as they hold, and never repeated below, so the model reads
   the way an access model is written by hand: everyone gets these, this department adds
   those, this title adds one more.

   What the pyramid cannot explain is as interesting as what it can:
     under-entitled   people in a node who lack what their node grants
     pollution        access nobody around them has, held by one person
     combinations     patterns that cut across the hierarchy — a title that gets the
                      same tool in every department — mined separately and added on top

   The approach is adopted from the role-analytics prototype; what is new here is that
   the entitlement weights come from this tool's own category sensitivity and price book,
   so the pyramid is pulled toward the attributes that govern expensive and dangerous
   access rather than treating every group as equal. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '';

  /* Attributes a business rule can actually condition on, read off the contract HelloID
     treats as primary. Adding one here makes it available as a pyramid level. */
  const ATTRIBUTES = {
    Employer: c => c && c.employer.name,
    Division: c => c && c.division.name,
    Department: c => c && (c.department.name || c.department.externalId),
    Team: c => c && c.team.name,
    Title: c => c && c.title.name,
    Location: c => c && c.location.name,
    CostCenter: c => c && (c.costCenter.name || c.costCenter.code),
    ContractType: c => c && c.type.name,
    Manager: c => c && c.manager.displayName
  };

  const primary = person => person.primaryContract || person.contracts[0] || null;

  /**
   * People with the entitlements they actually hold.
   *
   * Access comes from the reconciliation (what exists in the target system) and, when
   * loaded, from HelloID's own granted export. A person with no account contributes
   * nothing but still counts as a member: a node where half the people hold nothing is
   * a node whose rule would be wrong.
   */
  function population(model, vault, granted) {
    const index = HR.correlate.personAccountIndex(model, vault, model.correlation);
    const people = [];

    for (const person of vault.persons) {
      const entry = index.get(person.personId);
      const accounts = entry ? entry.accounts : [];
      const ents = new Set();
      for (const account of accounts) account.permKeys.forEach(k => ents.add(k));
      if (granted && !granted.empty) {
        const rows = granted.byPerson.get(person.displayName) || [];
        rows.forEach(r => ents.add(HR.model.permissionKey(r.system, r.entitlement)));
      }
      const contract = primary(person);
      const attrs = {};
      for (const name in ATTRIBUTES) attrs[name] = String(ATTRIBUTES[name](contract) || '').trim();
      people.push({ person, accounts, ents, attrs, name: person.displayName });
    }
    return people;
  }

  /** Attributes worth offering as levels: at least two distinct values, mostly filled. */
  function availableAttributes(people, minFill) {
    const floor = minFill == null ? 0.5 : minFill;
    return Object.keys(ATTRIBUTES).filter(name => {
      const values = people.map(p => p.attrs[name]).filter(Boolean);
      return values.length >= people.length * floor && new Set(values).size >= 2;
    });
  }

  /* An entitlement's weight decides how hard it pulls the pyramid. Sensitivity and price
     are what this tool already knows about a permission, so a licence nobody should hold
     twice and a domain-admin group outrank a printer group without a second taxonomy. */
  function weightOf(model, permKey) {
    const perm = model.permissions.get(permKey);
    if (!perm) return 1;
    const price = perm.monthlyPrice || 0;
    return (perm.sensitivity || 1) * (1 + Math.min(price / 20, 2));
  }

  function mkNode(id, level, path, parent, label) {
    return { id, level, path, parent, label, members: [], rules: [], ruleEnts: new Set(), children: [] };
  }

  /**
   * Place every person in the tree the levels describe, then place rules as high as they
   * hold. `threshold` is the share of a node's members that must hold an entitlement;
   * `minSize` keeps a node of two people from minting rules nobody can defend.
   */
  function mine(people, levels, opts) {
    opts = Object.assign({ threshold: 0.9, minSize: 5, weight: () => 1 }, opts || {});
    const nodes = new Map();
    const root = mkNode('root', 0, [], null, null);
    nodes.set('root', root);

    for (const person of people) {
      let cur = root;
      cur.members.push(person);
      person.chain = [root];
      levels.forEach((attr, i) => {
        const value = person.attrs[attr] || '';
        const id = cur.id + SEP + attr + '=' + value;
        if (!nodes.has(id)) {
          const node = mkNode(id, i + 1, cur.path.concat([{ attr, value }]), cur, value);
          nodes.set(id, node);
          cur.children.push(node);
        }
        cur = nodes.get(id);
        cur.members.push(person);
        person.chain.push(cur);
      });
    }

    for (const node of nodes.values()) {
      node.entCount = new Map();
      for (const m of node.members) for (const e of m.ents) node.entCount.set(e, (node.entCount.get(e) || 0) + 1);
    }

    /* Top-down: an entitlement granted at an ancestor is never restated below. */
    const rules = [];
    const byLevel = Array.from(nodes.values())
      .sort((a, b) => a.level - b.level || b.members.length - a.members.length);
    for (const node of byLevel) {
      if (node.members.length < opts.minSize) continue;
      for (const [ent, count] of node.entCount) {
        const coverage = count / node.members.length;
        if (coverage < opts.threshold) continue;
        let inherited = false;
        for (let a = node.parent; a; a = a.parent) if (a.ruleEnts.has(ent)) { inherited = true; break; }
        if (inherited) continue;
        const missing = node.members.filter(m => !m.ents.has(ent));
        const rule = { node, ent, coverage, holders: count, missing, weight: opts.weight(ent) };
        node.rules.push(rule);
        node.ruleEnts.add(ent);
        rules.push(rule);
      }
    }

    /* Groups too small to carry a rule. Without this number a level that adds nothing
       looks like a level that found nothing, and the two have different fixes. */
    const tooSmall = Array.from(nodes.values())
      .filter(n => n.level > 0 && n.members.length && n.members.length < opts.minSize);

    return {
      nodes, root, rules, levels: levels.slice(),
      tooSmall,
      skippedPeople: U.sum(tooSmall, n => n.members.length)
    };
  }

  /**
   * Fold a mined model (plus any accepted combination rules) back onto the people, and
   * account for every assignment: explained, missing, or unexplained.
   */
  function account(people, mined, comboRules, opts) {
    opts = Object.assign({ pollutionBelow: 0.1, weight: () => 1 }, opts || {});
    for (const person of people) {
      person.explained = new Set();
      for (const node of person.chain || []) node.ruleEnts.forEach(e => person.explained.add(e));
      person.deepest = (person.chain || [])[(person.chain || []).length - 1] || mined.root;
    }
    (comboRules || []).forEach(rule =>
      rule.members.forEach(m => { if (m.ents.has(rule.ent)) m.explained.add(rule.ent); }));

    const pollution = [];
    for (const person of people) {
      for (const ent of person.ents) {
        if (person.explained.has(ent)) continue;
        const node = person.deepest;
        const coverage = (node.entCount.get(ent) || 0) / (node.members.length || 1);
        pollution.push({
          person, ent, node, coverage, weight: opts.weight(ent),
          /* Held by nobody else nearby, so it travelled with the person rather than
             with the job — the classic accumulation an org-shaped model exposes. */
          isolated: coverage <= opts.pollutionBelow
        });
      }
    }

    const under = [];
    mined.rules.forEach(r => r.missing.forEach(m =>
      under.push({ person: m, ent: r.ent, node: r.node, coverage: r.coverage, rule: r })));
    (comboRules || []).forEach(r => r.missing.forEach(m =>
      under.push({ person: m, ent: r.ent, node: null, combo: r, coverage: r.coverage, rule: r })));

    const totalAssignments = U.sum(people, p => p.ents.size);
    const explainedCount = U.sum(people, p => {
      let n = 0;
      p.ents.forEach(e => { if (p.explained.has(e)) n++; });
      return n;
    });
    const totalWeight = U.sum(people, p => {
      let w = 0; p.ents.forEach(e => { w += opts.weight(e); }); return w;
    });
    const explainedWeight = U.sum(people, p => {
      let w = 0; p.ents.forEach(e => { if (p.explained.has(e)) w += opts.weight(e); }); return w;
    });

    return {
      pollution, under, totalAssignments, explainedCount,
      coverage: totalAssignments ? explainedCount / totalAssignments : 0,
      weightedCoverage: totalWeight ? explainedWeight / totalWeight : 0,
      isolated: pollution.filter(p => p.isolated).length
    };
  }

  /**
   * Which attributes, in which order?
   *
   * Greedy: add the attribute that buys the most weighted coverage, stop when nothing
   * buys enough to justify another level. The order that falls out is the order the
   * organisation actually uses, which is rarely the order somebody would guess.
   */
  function suggestLevels(people, candidates, opts) {
    opts = Object.assign({ maxLevels: 4, minGain: 0.004, threshold: 0.9, minSize: 5, weight: () => 1 }, opts || {});
    const chosen = [];
    const steps = [];
    let current = account(people, mine(people, [], opts), null, opts).weightedCoverage;
    const base = current;

    for (let depth = 0; depth < opts.maxLevels; depth++) {
      let best = null, bestCoverage = current;
      for (const attr of candidates) {
        if (chosen.includes(attr)) continue;
        const trial = account(people, mine(people, chosen.concat([attr]), opts), null, opts).weightedCoverage;
        if (trial > bestCoverage + opts.minGain) { bestCoverage = trial; best = attr; }
      }
      if (!best) break;
      steps.push({ attr: best, gain: bestCoverage - current, coverage: bestCoverage });
      chosen.push(best);
      current = bestCoverage;
    }
    return { levels: chosen, coverage: current, base, steps };
  }

  /**
   * Rules that cut across the pyramid: a set of attribute values, not a path.
   *
   * Only worth adding when they explain assignments the pyramid does not, so candidates
   * are scored by *new* weighted coverage and taken greedily, re-scoring as earlier
   * rules absorb what they explain.
   */
  function mineCombos(people, mined, opts) {
    opts = Object.assign({ maxConditions: 2, minGain: 3, threshold: 0.9, minSize: 5,
      attributes: [], weight: () => 1, limit: 200 }, opts || {});

    const groups = new Map();
    for (const p of people) {
      const pairs = opts.attributes.map(a => [a, p.attrs[a]]).filter(x => x[1]);
      const combos = [];
      for (let i = 0; i < pairs.length; i++) {
        combos.push([pairs[i]]);
        if (opts.maxConditions >= 2) {
          for (let j = i + 1; j < pairs.length; j++) {
            combos.push([pairs[i], pairs[j]]);
            if (opts.maxConditions >= 3) {
              for (let k = j + 1; k < pairs.length; k++) combos.push([pairs[i], pairs[j], pairs[k]]);
            }
          }
        }
      }
      for (const conds of combos) {
        const key = conds.map(c => c[0] + '=' + c[1]).join('|');
        let g = groups.get(key);
        if (!g) { g = { conds: conds.map(c => ({ attr: c[0], value: c[1] })), members: [] }; groups.set(key, g); }
        g.members.push(p);
      }
    }

    const candidates = [];
    for (const g of groups.values()) {
      if (g.members.length < opts.minSize) continue;
      const tally = new Map();
      for (const m of g.members) for (const e of m.ents) tally.set(e, (tally.get(e) || 0) + 1);
      for (const [ent, count] of tally) {
        const coverage = count / g.members.length;
        if (coverage < opts.threshold) continue;
        const w = opts.weight(ent);
        let gain = 0;
        for (const m of g.members) if (m.ents.has(ent) && !m.explained.has(ent)) gain += w;
        if (gain >= opts.minGain) candidates.push({ group: g, ent, coverage, holders: count, gain });
      }
    }
    candidates.sort((a, b) => b.gain - a.gain || a.group.conds.length - b.group.conds.length);

    /* Lazy greedy: a candidate's gain can only shrink as rules are accepted, so a stale
       top entry is re-scored and re-inserted rather than trusted. */
    const taken = new Map();
    const gainNow = (group, ent) => {
      const w = opts.weight(ent);
      let n = 0;
      for (const m of group.members) {
        if (m.ents.has(ent) && !m.explained.has(ent) && !(taken.get(m) || new Set()).has(ent)) n += w;
      }
      return n;
    };

    const rules = [];
    while (candidates.length && rules.length < opts.limit) {
      const top = candidates.shift();
      const now = gainNow(top.group, top.ent);
      if (now < opts.minGain) continue;
      if (candidates.length && now < candidates[0].gain) {
        top.gain = now;
        let lo = 0, hi = candidates.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; candidates[mid].gain > now ? lo = mid + 1 : hi = mid; }
        candidates.splice(lo, 0, top);
        continue;
      }
      for (const m of top.group.members) {
        if (!m.ents.has(top.ent)) continue;
        if (!taken.has(m)) taken.set(m, new Set());
        taken.get(m).add(top.ent);
      }
      rules.push({
        kind: 'combo', conds: top.group.conds, ent: top.ent, members: top.group.members,
        coverage: top.coverage, holders: top.holders, gain: now,
        missing: top.group.members.filter(m => !m.ents.has(top.ent))
      });
    }
    return rules;
  }

  /**
   * The whole thing, from a model with a vault to a rule set with its accounting.
   * Cached on the model: mining is the most expensive analysis this tool runs.
   */
  function build(model, opts) {
    if (model._pyramid && !(opts && opts.force)) return model._pyramid;
    if (!model.vault) return null;

    const cfg = Object.assign({ threshold: 0.9, minSize: 5, maxLevels: 4, combos: true,
      maxConditions: 2, minComboGain: 3, pollutionBelow: 0.1 },
      (HR.config.get().pyramid || {}), opts || {});

    const weight = permKey => weightOf(model, permKey);
    const people = population(model, model.vault, model.granted);
    const attributes = availableAttributes(people);
    if (!attributes.length) {
      return { unavailable: 'no-attributes', people, attributes: [] };
    }

    const suggestion = suggestLevels(people, attributes,
      { maxLevels: cfg.maxLevels, threshold: cfg.threshold, minSize: cfg.minSize, weight });
    const levels = (cfg.levels && cfg.levels.length ? cfg.levels : suggestion.levels)
      .filter(a => attributes.includes(a));

    const mined = mine(people, levels, { threshold: cfg.threshold, minSize: cfg.minSize, weight });
    let stats = account(people, mined, null, { pollutionBelow: cfg.pollutionBelow, weight });

    let combos = [];
    if (cfg.combos && levels.length) {
      combos = mineCombos(people, mined, {
        maxConditions: cfg.maxConditions, minGain: cfg.minComboGain, threshold: cfg.threshold,
        minSize: cfg.minSize, attributes, weight
      });
      if (combos.length) stats = account(people, mined, combos, { pollutionBelow: cfg.pollutionBelow, weight });
    }

    const result = {
      people, attributes, suggestion, levels, combos, weight,
      nodes: mined.nodes, root: mined.root, rules: mined.rules,
      tooSmall: mined.tooSmall, skippedPeople: mined.skippedPeople,
      threshold: cfg.threshold, minSize: cfg.minSize,
      stats,
      summary: {
        people: people.length,
        levels: levels.length,
        rules: mined.rules.length,
        combos: combos.length,
        coverage: stats.coverage,
        weightedCoverage: stats.weightedCoverage,
        assignments: stats.totalAssignments,
        explained: stats.explainedCount,
        under: stats.under.length,
        pollution: stats.pollution.length,
        isolated: stats.isolated,
        tooSmall: mined.tooSmall.length,
        rulesPerLevel: levels.map((_, i) =>
          mined.rules.filter(r => r.node.level === i + 1).length)
      }
    };
    model._pyramid = result;
    return result;
  }

  /** The mined model as a HelloID business-rule export, ready to review and load back. */
  function toRulesCsv(model, pyramid) {
    const rows = [];
    const label = node => node.path.map(p => p.attr + ': ' + (p.value || '(empty)')).join(' / ') || 'Everyone';
    const entName = key => {
      const perm = model.permissions.get(key);
      return perm ? (perm.system + ' - ' + perm.name + (perm.path ? ' (' + perm.path + ')' : '')) : key;
    };
    const byNode = new Map();
    pyramid.rules.forEach(r => {
      if (!byNode.has(r.node)) byNode.set(r.node, []);
      byNode.get(r.node).push(r);
    });
    byNode.forEach((rules, node) => {
      rows.push({
        Name: 'Piramide - ' + label(node),
        EntitlementCount: rules.length,
        PersonsLatestEvaluation: node.members.length,
        Categories: 'Pyramid',
        Status: 'proposal',
        Conditions: node.path.map(p => p.attr + '.Name, one of: ' + p.value).join('|'),
        Entitlements: rules.map(r => entName(r.ent)).join('|')
      });
    });
    (pyramid.combos || []).forEach(rule => {
      rows.push({
        Name: 'Combinatie - ' + rule.conds.map(c => c.value).join(' + '),
        EntitlementCount: 1,
        PersonsLatestEvaluation: rule.members.length,
        Categories: 'Combination',
        Status: 'proposal',
        Conditions: rule.conds.map(c => c.attr + '.Name, one of: ' + c.value).join('|'),
        Entitlements: entName(rule.ent)
      });
    });
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  HR.pyramid = { build, mine, account, suggestLevels, mineCombos, population,
    availableAttributes, toRulesCsv, ATTRIBUTES };
})(window.HR);
