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
     treats as primary. Adding one here makes it available as a pyramid level.

     Each returns the value to group on and the label to show. Grouping happens on the
     external id wherever the vault carries one, because that is what survives HR
     renaming a department or a job title — the same reason HelloID's own mining
     conditions on externalId. The name is kept for display only, so a renamed
     department changes what the rule is called and not who it selects. */
  const ATTRIBUTES = {
    Employer: c => c && ref(c.employer),
    Division: c => c && ref(c.division),
    Department: c => c && ref(c.department),
    Team: c => c && ref(c.team),
    Title: c => c && ref(c.title),
    Location: c => c && ref(c.location),
    CostCenter: c => c && ref(c.costCenter),
    ContractType: c => c && ref(c.type)
    /* Manager is deliberately NOT an attribute: who your manager is derives
       from department/team rather than describing the person, and a rule
       conditioned on a manager silently selects nobody the day that manager
       leaves. Stored level choices naming Manager are filtered out on build. */
  };

  /** A HelloID reference: id if there is one, name for the reader. */
  function ref(o) {
    if (!o) return null;
    const id = String(o.externalId || o.code || '').trim();
    const name = String(o.name || '').trim();
    if (!id && !name) return null;
    return { value: id || name, label: name || id, byId: !!id };
  }

  const primary = person => person.primaryContract || person.contracts[0] || null;

  /**
   * Who the miner reasons about.
   *
   * A person with no account holds nothing, and counting them drags every share down: on
   * a real tenant the most widely held entitlement sat at 46% of everybody and 85% of
   * everybody with access, which is the difference between finding a baseline and
   * concluding the organisation has none. Mining therefore runs over people the
   * reconciliation can actually see access for, and reports how many it set aside —
   * those people are not ignored, they are the subject of their own finding.
   */
  const withAccess = people => people.filter(p => p.ents.size > 0);

  /**
   * The baseline: what everybody gets.
   *
   * Every organisation has a floor — the mailbox, the intranet, the endpoint controls —
   * and it should be one rule with no condition rather than the same entitlements
   * restated under every department. It gets its own threshold because the floor is
   * never quite universal: somebody is always missing MFA, and holding the baseline to
   * the same bar as a departmental rule either loses it entirely or hides the people who
   * fall through it.
   *
   * Who those people are is the interesting half. An entitlement 96% of the organisation
   * holds is not optional for the other 4%; it is a gap with names attached.
   */
  function baseline(all, threshold) {
    const people = withAccess(all);
    const tally = new Map();
    for (const person of people) for (const ent of person.ents) tally.set(ent, (tally.get(ent) || 0) + 1);

    const grants = [];
    let widest = null;
    for (const [ent, holders] of tally) {
      const coverage = people.length ? holders / people.length : 0;
      /* The ceiling, whether or not anything clears the bar: "nothing qualifies" is not
         actionable, "the most widely held thing reaches 47%" is. */
      if (!widest || coverage > widest.coverage) widest = { ent, holders, coverage };
      if (coverage < threshold) continue;
      grants.push({ ent, holders, coverage, missing: people.filter(p => !p.ents.has(ent)) });
    }
    grants.sort((a, b) => b.coverage - a.coverage);

    /* Everyone short of the floor, with what they are short of. */
    const shortBy = new Map();
    grants.forEach(g => g.missing.forEach(person => {
      if (!shortBy.has(person)) shortBy.set(person, []);
      shortBy.get(person).push(g.ent);
    }));
    const outside = Array.from(shortBy.entries())
      .map(entry => ({ person: entry[0], missing: entry[1] }))
      .sort((a, b) => b.missing.length - a.missing.length);

    return {
      grants, outside, widest,
      threshold,
      members: people,
      summary: {
        entitlements: grants.length,
        people: people.length,
        withoutAccess: all.length - people.length,
        outside: outside.length,
        outsideShare: people.length ? outside.length / people.length : 0,
        gaps: U.sum(grants, g => g.missing.length),
        complete: people.length - outside.length
      }
    };
  }

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
    const ex = HR.mine.exclusion(model);
    const people = [];

    for (const person of vault.persons) {
      const entry = index.get(person.personId);
      const accounts = entry ? entry.accounts : [];
      const ents = new Set();
      for (const account of accounts) account.permKeys.forEach(k => { if (!ex.skip(k)) ents.add(k); });
      if (granted && !granted.empty) {
        const rows = granted.byPerson.get(person.displayName) || [];
        rows.forEach(r => {
          const k = HR.model.permissionKey(r.system, r.entitlement);
          if (!ex.skip(k)) ents.add(k);
        });
      }
      const contract = primary(person);
      const attrs = {};
      const labels = {};
      const byId = {};
      for (const name in ATTRIBUTES) {
        const got = ATTRIBUTES[name](contract);
        attrs[name] = got ? String(got.value) : '';
        labels[name] = got ? String(got.label) : '';
        byId[name] = !!(got && got.byId);
      }
      people.push({ person, accounts, ents, attrs, labels, byId, name: person.displayName });
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
        const label = person.labels[attr] || value;
        const id = cur.id + SEP + attr + '=' + value;
        if (!nodes.has(id)) {
          const node = mkNode(id, i + 1, cur.path.concat([
            { attr, value, label, byId: !!person.byId[attr] }
          ]), cur, label);
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
   * The goal is coverage: the share of entitlement grants the model accounts for. Rule
   * count matters, but as a cost rather than an objective — a model that explains more
   * with more rules is still the better model, and the frontier below shows what each
   * level cost. So the greedy step maximises plain coverage, and uses weighted coverage
   * only to break ties, where the tie-break prefers the attribute that governs the more
   * sensitive and more expensive access; when that is level too, the attribute whose
   * groups are more alike on everything else wins — the same alikeness the HR-only
   * miner scores on, because a group that agrees on more is a group access attaches to.
   */
  function suggestLevels(people, candidates, opts) {
    opts = Object.assign({ maxLevels: 4, minGain: 0.004, threshold: 0.9, minSize: 3, weight: () => 1 }, opts || {});
    const chosen = [];
    const steps = [];
    const measure = levels => {
      const mined = mine(people, levels, opts);
      const stats = account(people, mined, null, opts);
      /* How alike the deepest groups are, weighted by members — the leaves of the tree
         the levels describe, over the people they place. */
      const leaves = Array.from(mined.nodes.values())
        .filter(n => n.level === levels.length && n.members.length >= opts.minSize);
      const placed = U.sum(leaves, n => n.members.length);
      stats.alike = placed && HR.cohorts
        ? U.sum(leaves, n => n.members.length * HR.cohorts.alikeOf(people, n.members, levels, candidates)) / placed
        : 0;
      return stats;
    };
    let current = measure([]);
    const base = current.coverage;

    for (let depth = 0; depth < opts.maxLevels; depth++) {
      let best = null, bestStats = current;
      for (const attr of candidates) {
        if (chosen.includes(attr)) continue;
        const trial = measure(chosen.concat([attr]));
        const tied = Math.abs(trial.coverage - bestStats.coverage) <= opts.minGain;
        const better = trial.coverage > bestStats.coverage + opts.minGain ||
          (tied && trial.weightedCoverage > bestStats.weightedCoverage + opts.minGain) ||
          (tied && Math.abs(trial.weightedCoverage - bestStats.weightedCoverage) <= opts.minGain &&
           best && trial.alike > bestStats.alike);
        if (better) { bestStats = trial; best = attr; }
      }
      if (!best) break;
      steps.push({ attr: best, gain: bestStats.coverage - current.coverage, coverage: bestStats.coverage,
        alike: bestStats.alike });
      chosen.push(best);
      current = bestStats;
    }
    return {
      levels: chosen, coverage: current.coverage, weightedCoverage: current.weightedCoverage,
      alike: current.alike, base, steps
    };
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
      const pairs = opts.attributes.map(a => [a, p.attrs[a], p.labels[a], !!p.byId[a]]).filter(x => x[1]);
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
        if (!g) {
          g = { conds: conds.map(c => ({ attr: c[0], value: c[1], label: c[2] || c[1], byId: c[3] })), members: [] };
          groups.set(key, g);
        }
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
   * Coverage first: rules chosen for what they still explain.
   *
   * The pyramid is a hierarchy, and a hierarchy costs coverage. "Department then Title"
   * can only mine a title inside a department, so a job title that gets the same access
   * in every department has to be rediscovered once per department or not at all. That
   * is a real limitation, and on a tenant where access follows job titles across the
   * organisation it loses to a flat miner outright.
   *
   * So when coverage is the goal, this ignores the hierarchy: every attribute value and
   * every pair of them is a candidate condition, and rules are taken greedily by how many
   * assignments they explain that nothing chosen so far explains. The baseline is seeded
   * first by construction rather than by competition — it is the rule an administrator
   * writes anyway, and everything after it should be what the baseline does not cover.
   *
   * The pyramid keeps its own value: it is legible, it nests the way an organisation
   * describes itself, and its levels are what a person can argue about. This is the
   * answer when the question is coverage rather than structure.
   */
  function greedy(model, opts) {
    const cfg = Object.assign({ threshold: 0.9, baselineThreshold: 0.9, minSize: 3,
      maxConditions: 2, maxRules: 400, minGain: 2 },
      (HR.config.get().pyramid || {}), opts || {});
    /* Precomputed: weight() runs in every tally's inner loop. */
    const wCache = new Map(model.permissionList.map(pm => [pm.key, weightOf(model, pm.key)]));
    const weight = permKey => wCache.get(permKey) || 1;
    const everybody = population(model, model.vault, model.granted);
    const people = withAccess(everybody);
    const attributes = availableAttributes(people);

    /* Every group a condition of one or two attribute values can select. */
    const groups = new Map();
    for (const person of people) {
      const pairs = attributes.map(a => [a, person.attrs[a], person.labels[a], !!person.byId[a]])
        .filter(x => x[1]);
      const combos = [];
      for (let i = 0; i < pairs.length; i++) {
        combos.push([pairs[i]]);
        if (cfg.maxConditions >= 2) {
          for (let j = i + 1; j < pairs.length; j++) combos.push([pairs[i], pairs[j]]);
        }
      }
      for (const conds of combos) {
        const key = conds.map(c => c[0] + '=' + c[1]).join(' & ');
        let g = groups.get(key);
        if (!g) {
          g = { key, conds: conds.map(c => ({ attr: c[0], value: c[1], label: c[2] || c[1], byId: c[3] })), members: [] };
          groups.set(key, g);
        }
        g.members.push(person);
      }
    }

    /* Within each group, the entitlements uniform enough to be a rule. */
    const candidates = [];
    for (const g of groups.values()) {
      if (g.members.length < cfg.minSize) continue;
      const tally = new Map();
      for (const m of g.members) for (const e of m.ents) tally.set(e, (tally.get(e) || 0) + 1);
      const ents = [];
      for (const [ent, count] of tally) {
        if (count / g.members.length >= cfg.threshold) {
          ents.push({ ent, holders: count, coverage: count / g.members.length });
        }
      }
      if (ents.length) candidates.push({ group: g, ents });
    }

    const explained = new Map(people.map(p => [p, new Set()]));
    const chosen = [];

    const base = baseline(everybody, cfg.baselineThreshold);
    if (base.grants.length) {
      base.grants.forEach(g =>
        people.forEach(p => { if (p.ents.has(g.ent)) explained.get(p).add(g.ent); }));
      chosen.push({
        everyone: true, conds: [], members: people, baseline: base,
        grants: base.grants, gain: U.sum(base.grants, g => g.holders)
      });
    }

    const gainOf = candidate => {
      let n = 0;
      for (const e of candidate.ents) {
        for (const m of candidate.group.members) {
          if (m.ents.has(e.ent) && !explained.get(m).has(e.ent)) n++;
        }
      }
      return n;
    };

    /* Rescoring every candidate on every pick made selection quadratic — twelve seconds
       at a hundred thousand rows. Gains only shrink as rules are accepted, so a stale
       top entry is re-scored and re-inserted instead: the same lazy greedy the
       combination miner uses, and the answer is identical. */
    candidates.forEach(c => { c.gain = gainOf(c); });
    candidates.sort((a, b) => b.gain - a.gain);

    while (chosen.length < cfg.maxRules && candidates.length) {
      const top = candidates.shift();
      if (top.gain < cfg.minGain) break;
      const current = gainOf(top);
      if (current < cfg.minGain) continue;
      if (candidates.length && current < candidates[0].gain) {
        top.gain = current;
        let lo = 0, hi = candidates.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; candidates[mid].gain > current ? lo = mid + 1 : hi = mid; }
        candidates.splice(lo, 0, top);
        continue;
      }
      const best = top;
      /* Only the entitlements that still add something; the rest are already covered. */
      const grants = best.ents.filter(e =>
        best.group.members.some(m => m.ents.has(e.ent) && !explained.get(m).has(e.ent)));
      for (const e of grants) {
        for (const m of best.group.members) if (m.ents.has(e.ent)) explained.get(m).add(e.ent);
      }
      chosen.push({
        everyone: false,
        conds: best.group.conds,
        members: best.group.members,
        grants: grants.map(e => ({ ent: e.ent, holders: e.holders, coverage: e.coverage,
          missing: best.group.members.filter(m => !m.ents.has(e.ent)) })),
        gain: current
      });
    }

    const total = U.sum(people, p => p.ents.size);
    const covered = U.sum(people, p => explained.get(p).size);
    const totalWeight = U.sum(people, p => { let w = 0; p.ents.forEach(e => { w += weight(e); }); return w; });
    const coveredWeight = U.sum(people, p => {
      let w = 0; explained.get(p).forEach(e => { w += weight(e); }); return w;
    });

    return {
      rules: chosen, people, attributes, explained, baseline: base,
      summary: {
        rules: chosen.length,
        withoutAccess: everybody.length - people.length,
        grants: U.sum(chosen, r => r.grants.length),
        assignments: total,
        explained: covered,
        coverage: total ? covered / total : 0,
        weightedCoverage: totalWeight ? coveredWeight / totalWeight : 0,
        perRule: chosen.length ? covered / chosen.length : 0
      }
    };
  }

  /**
   * What the rule threshold costs and buys.
   *
   * The threshold is the single most consequential setting in the miner and the least
   * visible: at 90% a rule must be nearly universal in its group, which is safe and
   * leaves a lot of access unexplained; at 75% the same organisation is largely covered
   * by rules that each carry a handful of exceptions. HelloID's own miner sits at the
   * loose end and reports the exceptions, which is why its coverage looks better than
   * ours on the same data.
   *
   * Neither is right in general. Sweeping the range and showing coverage against the
   * exceptions it implies turns a hidden constant into a decision somebody can make.
   */
  function sweep(model, thresholds) {
    const list = thresholds || [0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
    return list.map(threshold => {
      const g = greedy(model, { threshold });
      const exceptions = U.sum(g.rules, r => U.sum(r.grants, x => x.missing.length));
      return {
        threshold,
        rules: g.summary.rules,
        coverage: g.summary.coverage,
        perRule: g.summary.perRule,
        grants: g.summary.grants,
        /* Every exception is a person a rule would grant something they do not have
           today: either a gap to fill or a reason the rule is wrong. */
        exceptions
      };
    });
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

    /* Precomputed: weight() runs in every tally's inner loop. */
    const wCache = new Map(model.permissionList.map(pm => [pm.key, weightOf(model, pm.key)]));
    const weight = permKey => wCache.get(permKey) || 1;
    const everybody = population(model, model.vault, model.granted);
    const people = withAccess(everybody);
    const attributes = availableAttributes(people);
    if (!attributes.length) {
      return { unavailable: 'no-attributes', people, attributes: [] };
    }

    const suggestion = suggestLevels(people, attributes,
      { maxLevels: cfg.maxLevels, threshold: cfg.threshold, minSize: cfg.minSize, weight });
    const levels = (cfg.levels && cfg.levels.length ? cfg.levels : suggestion.levels)
      .filter(a => attributes.includes(a));

    const base = baseline(people, cfg.baselineThreshold == null ? 0.9 : cfg.baselineThreshold);
    const mined = mine(people, levels, { threshold: cfg.threshold, minSize: cfg.minSize, weight });

    /* The baseline is a rule at the root, whatever the level threshold says: it is
       written once and inherited by everything below. */
    base.grants.forEach(g => {
      if (mined.root.ruleEnts.has(g.ent)) return;
      const rule = { node: mined.root, ent: g.ent, coverage: g.coverage, holders: g.holders,
        missing: g.missing, weight: weight(g.ent), baseline: true };
      mined.root.rules.push(rule);
      mined.root.ruleEnts.add(g.ent);
      mined.rules.unshift(rule);
    });
    let stats = account(people, mined, null, { pollutionBelow: cfg.pollutionBelow, weight });

    let combos = [];
    if (cfg.combos && levels.length) {
      combos = mineCombos(people, mined, {
        maxConditions: cfg.maxConditions, minGain: cfg.minComboGain, threshold: cfg.threshold,
        minSize: cfg.minSize, attributes, weight
      });
      if (combos.length) stats = account(people, mined, combos, { pollutionBelow: cfg.pollutionBelow, weight });
    }

    /* A HelloID rule is one condition granting a list of entitlements, and rules stack,
       so an entitlement granted higher up is never restated below. Counting one "rule"
       per granted entitlement therefore overstates the model by an order of magnitude:
       what an administrator actually creates is one rule per group. Both numbers are
       kept — the groups are the rules, the grants are their contents. */
    const ruleGroups = new Map();
    mined.rules.forEach(r => {
      if (!ruleGroups.has(r.node)) ruleGroups.set(r.node, []);
      ruleGroups.get(r.node).push(r);
    });

    /* Combination rules condense the same way: identical conditions are one rule. */
    const comboGroups = new Map();
    combos.forEach(c => {
      const key = c.conds.map(x => x.attr + '=' + x.value).sort().join('|');
      if (!comboGroups.has(key)) comboGroups.set(key, { conds: c.conds, members: c.members, rules: [] });
      comboGroups.get(key).rules.push(c);
    });

    const result = {
      people, attributes, suggestion, levels, combos, weight,
      ruleGroups, comboGroups,
      nodes: mined.nodes, root: mined.root, rules: mined.rules, baseline: base,
      tooSmall: mined.tooSmall, skippedPeople: mined.skippedPeople,
      threshold: cfg.threshold, minSize: cfg.minSize,
      stats,
      summary: {
        people: people.length,
        withoutAccess: everybody.length - people.length,
        levels: levels.length,
        /* What you would create in HelloID... */
        rules: ruleGroups.size,
        combos: comboGroups.size,
        /* ...and what those rules hand out between them. */
        grants: mined.rules.length,
        comboGrants: combos.length,
        coverage: stats.coverage,
        weightedCoverage: stats.weightedCoverage,
        assignments: stats.totalAssignments,
        explained: stats.explainedCount,
        under: stats.under.length,
        pollution: stats.pollution.length,
        isolated: stats.isolated,
        tooSmall: mined.tooSmall.length,
        baselineEntitlements: base.summary.entitlements,
        outsideBaseline: base.summary.outside,
        /* The number the whole exercise is judged on. */
        perRule: ruleGroups.size ? stats.explainedCount / ruleGroups.size : 0,
        rulesPerLevel: levels.map((_, i) =>
          mined.rules.filter(r => r.node.level === i + 1).length)
      }
    };
    model._pyramid = result;
    return result;
  }

  /**
   * Condense sibling rules into "one of" conditions.
   *
   * The pyramid gives every attribute value its own node, so three job titles in a
   * department become three rules even where they hand out the same access. HelloID does
   * not require that: a condition takes a list, and one rule can read
   * "Department = Zorg AND Title one of (A, B, C)".
   *
   * Merging only rules that grant exactly the same set is too strict to be useful — on a
   * real tenant nothing matches. So the siblings are transposed instead: for every group
   * of rules that differ in one attribute, each entitlement is asked which values grant
   * it, and every distinct answer becomes one rule listing those values. Two titles
   * sharing four of five entitlements produce one rule for the four and one for the odd
   * one out, rather than two rules repeating four.
   *
   * This deliberately breaks the pyramid's shape. The nesting is what found the rules,
   * not something the rules have to keep — and nobody maintaining a rule set thanks you
   * for the hierarchy that produced it.
   */
  const SEPX = '\u001e';

  /** Canonical identity of one generalized condition: attr, keying, sorted values. */
  const vkey = c => c.attr + (c.byId ? '#id' : '#nm') + ':' + c.values.slice().sort().join(SEPX);

  /** Rules with identical conditions are one HelloID rule; fold them. */
  function foldDuplicates(rules) {
    const byConds = new Map();
    for (const rule of rules) {
      const key = rule.conds.map(vkey).sort().join('|');
      const seen = byConds.get(key);
      if (!seen) { byConds.set(key, rule); continue; }
      rule.grants.forEach(g => { if (!seen.grants.some(x => x.ent === g.ent)) seen.grants.push(g); });
      seen.members = U.uniq(seen.members.concat(rule.members));
      seen.sources = seen.sources.concat(rule.sources);
      seen.from += rule.from;
    }
    return Array.from(byConds.values());
  }

  /**
   * Merge sibling rules along every axis, and keep merging until nothing merges.
   *
   * One pass along one axis is not enough: after "Title one of (A, B)" absorbs two
   * title rules, the result can be a sibling of the same merge in the next department
   * over, and that second merge only exists once the first has happened. Each applied
   * merge strictly reduces the rule count, so iterating to the fixpoint terminates;
   * the pass cap is a belt over those braces.
   *
   * Rules arrive generalized: every condition is {attr, values[], labels[], byId}.
   * Two rules are siblings when they agree on every condition but one, and that one
   * keys the same way — an ExternalId list never unions with a name list.
   */
  function mergeFixpoint(flat, axes) {
    let rules = foldDuplicates(flat);

    for (let pass = 0, changed = true; changed && pass < 20; pass++) {
      changed = false;
      for (const axis of axes) {
        const groups = new Map();
        rules.forEach((rule, i) => {
          const pivot = rule.conds.find(c => c.attr === axis);
          if (!pivot) return;
          const context = rule.conds.filter(c => c.attr !== axis).map(vkey).sort().join('|') +
            '|' + (pivot.byId ? 'id' : 'nm');
          if (!groups.has(context)) groups.set(context, []);
          groups.get(context).push({ rule, i, pivot });
        });

        const consumed = new Set();
        const emitted = [];
        groups.forEach(siblings => {
          if (siblings.length < 2) return;

          /* Which value lists grant each entitlement — the transpose. */
          const holdersOf = new Map();
          siblings.forEach(s => s.rule.grants.forEach(g => {
            if (!holdersOf.has(g.ent)) holdersOf.set(g.ent, []);
            holdersOf.get(g.ent).push(s);
          }));

          /* Entitlements granted by the same set of value lists become one rule. */
          const byValueSet = new Map();
          holdersOf.forEach((who, ent) => {
            const key = who.map(s => vkey(s.pivot)).sort().join('|');
            if (!byValueSet.has(key)) byValueSet.set(key, { who, ents: [] });
            byValueSet.get(key).ents.push(ent);
          });
          if (byValueSet.size >= siblings.length) return;   // no saving on this axis

          const context = siblings[0].rule.conds.filter(c => c.attr !== axis);
          byValueSet.forEach(entry => {
            /* value -> label through the union keeps the two lists aligned. */
            const labelOf = new Map();
            entry.who.forEach(s => s.pivot.values.forEach((v, k) =>
              labelOf.set(v, s.pivot.labels[k] || v)));
            const values = Array.from(labelOf.keys());
            const members = U.uniq(entry.who.flatMap(s => s.rule.members));
            /* Sibling populations are disjoint — one value per attribute per person —
               so holders add up and coverage is recomputed over the union. */
            const grants = entry.ents.map(ent => {
              const parts = entry.who.map(s => s.rule.grants.find(g => g.ent === ent));
              const holders = U.sum(parts, g => g.holders);
              return { ent, holders,
                coverage: members.length ? holders / members.length : 0,
                missing: parts.flatMap(g => g.missing || []) };
            });
            emitted.push({
              conds: context.map(c => ({ attr: c.attr, values: c.values.slice(),
                labels: c.labels.slice(), byId: c.byId }))
                .concat([{ attr: axis, values, labels: values.map(v => labelOf.get(v)),
                  byId: entry.who[0].pivot.byId }]),
              grants, members,
              from: U.sum(entry.who, s => s.rule.from),
              sources: entry.who.flatMap(s => s.rule.sources)
            });
          });
          siblings.forEach(s => consumed.add(s.i));
          changed = true;
        });

        if (consumed.size) {
          rules = foldDuplicates(rules.filter((_, i) => !consumed.has(i)).concat(emitted));
        }
      }
    }
    return rules;
  }

  function condense(model, pyramid) {
    /* Every mined rule as a flat generalized condition list, whatever produced it,
       carrying its origin so a merged rule can still name the rules it replaced. */
    const flat = [];
    pyramid.ruleGroups.forEach((grants, node) => {
      if (!node.path.length) return;                 // the baseline has no condition to merge
      flat.push({
        conds: node.path.map(p => ({ attr: p.attr, values: [p.value], labels: [p.label || p.value], byId: p.byId })),
        grants: grants.slice(), members: node.members.slice(), from: 1,
        sources: [{ kind: 'pyramid', level: node.level,
          conds: node.path.map(p => ({ attr: p.attr, value: p.value, label: p.label, byId: p.byId })),
          members: node.members.length, grants: grants.length }]
      });
    });
    pyramid.comboGroups.forEach(group => flat.push({
      conds: group.conds.map(c => ({ attr: c.attr, values: [c.value], labels: [c.label || c.value], byId: c.byId })),
      grants: group.rules.slice(), members: group.members.slice(), from: 1,
      sources: [{ kind: 'combo', level: null,
        conds: group.conds.map(c => ({ attr: c.attr, value: c.value, label: c.label, byId: c.byId })),
        members: group.members.length, grants: group.rules.length }]
    }));

    const before = flat.length;
    const merged = mergeFixpoint(flat, U.uniq(pyramid.levels.concat(pyramid.attributes)));

    merged.sort((a, b) => b.members.length - a.members.length);
    const withLists = merged.filter(r => r.conds.some(c => c.values.length > 1));
    return {
      rules: merged, before,
      /* The baseline travels with the condensed set so its export is complete. */
      root: { grants: (pyramid.ruleGroups.get(pyramid.root) || []).slice(),
        members: pyramid.root.members.length },
      summary: {
        before,
        after: merged.length,
        saved: before - merged.length,
        share: before ? (before - merged.length) / before : 0,
        withLists: withLists.length,
        widest: merged.reduce((max, r) =>
          Math.max(max, Math.max.apply(null, r.conds.map(c => c.values.length))), 1),
        /* Coverage must not move: the same entitlements reach the same people. */
        grants: U.sum(merged, r => r.grants.length)
      }
    };
  }

  /** The condensed set is the canonical output; every consumer shares one run. */
  function condensedOf(model, pyramid) {
    if (!pyramid._condensed) pyramid._condensed = condense(model, pyramid);
    return pyramid._condensed;
  }

  /** The coverage-first set condenses the same way; the everyone-rule has no axis. */
  function condenseGreedy(model, result) {
    if (result._condensed) return result._condensed;
    const kept = [];
    const flat = [];
    result.rules.forEach(rule => {
      if (rule.everyone || !rule.conds.length) {
        kept.push({ everyone: true, conds: [], grants: rule.grants,
          members: rule.members, from: 1, sources: [] });
        return;
      }
      flat.push({
        conds: rule.conds.map(c => ({ attr: c.attr, values: [c.value], labels: [c.label || c.value], byId: c.byId })),
        grants: rule.grants.slice(), members: rule.members.slice(), from: 1,
        sources: [{ kind: 'coverage', level: null,
          conds: rule.conds.map(c => ({ attr: c.attr, value: c.value, label: c.label, byId: c.byId })),
          members: rule.members.length, grants: rule.grants.length }]
      });
    });
    const before = kept.length + flat.length;
    const merged = mergeFixpoint(flat, result.attributes);
    merged.sort((a, b) => b.members.length - a.members.length);
    const rules = kept.concat(merged);
    result._condensed = {
      rules, before,
      summary: {
        before,
        after: rules.length,
        saved: before - rules.length,
        share: before ? (before - rules.length) / before : 0,
        grants: U.sum(rules, r => r.grants.length)
      }
    };
    return result._condensed;
  }

  /** The rule cap HelloID enforces (softly): default 100, 0 = ranking off. */
  function ruleCap() {
    const v = (HR.config.get().mining || {}).ruleCap;
    const n = v === undefined || v === null || v === '' ? 100 : +v;
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  /**
   * Rank the condensed rules against HelloID's rule cap.
   *
   * HelloID allows about a hundred business rules, so when the miner proposes
   * more, the order matters: the best {cap} rules should be the ones that
   * explain the most access. Ranking is greedy: the baseline takes rank 1
   * (one rule, the widest coverage there is), then each next rank goes to the
   * rule that explains the most assignments nothing ranked above it explains.
   * Every rule keeps its rank; whatever lands past the cap is still shown,
   * marked as over it.
   */
  function rankForCap(model, pyramid, condensed) {
    if (condensed._rank) return condensed._rank;
    const cap = ruleCap();

    const covered = new Set();
    const pairsOf = (grants, members) => {
      const out = [];
      for (const g of grants) for (const m of members) {
        if (m.ents.has(g.ent)) out.push(m.person.personId + SEP + g.ent);
      }
      return out;
    };

    let rank = 0;
    const baseGrants = pyramid.ruleGroups.get(pyramid.root);
    if (baseGrants && baseGrants.length) {
      rank = 1;                                        // the baseline occupies one slot
      pairsOf(baseGrants, pyramid.root.members).forEach(p => covered.add(p));
    }
    const basePairs = covered.size;

    const remaining = condensed.rules.map(r => ({ rule: r, pairs: pairsOf(r.grants, r.members) }));
    let capPairs = cap > 0 && rank >= cap ? covered.size : null;
    while (remaining.length) {
      let best = -1, bestGain = -1;
      for (let i = 0; i < remaining.length; i++) {
        let gain = 0;
        for (const p of remaining[i].pairs) if (!covered.has(p)) gain++;
        if (best < 0 || gain > bestGain ||
            (gain === bestGain &&
             remaining[i].rule.members.length > remaining[best].rule.members.length)) {
          best = i; bestGain = gain;
        }
      }
      const pick = remaining.splice(best, 1)[0];
      rank++;
      pick.rule.rank = rank;
      pick.rule.capGain = bestGain;
      pick.rule.withinCap = cap === 0 || rank <= cap;
      for (const p of pick.pairs) covered.add(p);
      if (cap > 0 && rank === cap) capPairs = covered.size;
    }
    if (capPairs === null) capPairs = covered.size;    // fewer rules than the cap, or no cap

    const total = pyramid.stats.totalAssignments || 1;
    const ranked = condensed.rules.slice().sort((a, b) => a.rank - b.rank);
    condensed._rank = {
      ranked, cap,
      total: rank,
      overCap: cap > 0 ? ranked.filter(r => !r.withinCap).length : 0,
      basePairs,
      capCoverage: capPairs / total,
      fullCoverage: covered.size / total
    };
    return condensed._rank;
  }

  /** The condensed set, in the export shape HelloID reads back. */
  function condensedToRulesCsv(model, condensed) {
    const entName = key => {
      const perm = model.permissions.get(key);
      return perm ? (perm.system + ' - ' + perm.name + (perm.path ? ' (' + perm.path + ')' : '')) : key;
    };
    const rows = [];
    /* The baseline first: one rule with no condition, the floor everything inherits. */
    if (condensed.root && condensed.root.grants.length) {
      rows.push({
        Name: HR.mine.ruleName('Basis', 'Everyone'),
        EntitlementCount: condensed.root.grants.length,
        PersonsLatestEvaluation: condensed.root.members,
        Categories: 'Baseline',
        Status: 'proposal',
        Conditions: '',
        Entitlements: condensed.root.grants.map(g => entName(g.ent)).join('|')
      });
    }
    /* In rank order when ranked, so the file reads best-first; whatever sits
       past HelloID's rule cap carries an extra category saying so. */
    const ordered = condensed.rules.slice()
      .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
    rows.push.apply(rows, ordered.map(rule => ({
      Name: HR.mine.ruleName('Voorstel', rule.conds.map(c =>
        (c.labels.length > 1 ? c.labels.slice(0, 3).join(' / ') + (c.labels.length > 3 ? '\u2026' : '')
          : (c.labels[0] || c.values[0]))).join(' + ')),
      EntitlementCount: rule.grants.length,
      PersonsLatestEvaluation: rule.members.length,
      Categories: (rule.conds.some(c => c.values.length > 1) ? 'Condensed' : 'Mined') +
        (rule.withinCap === false ? '|Over rule cap' : ''),
      Status: 'proposal',
      /* "one of" already takes a list; this is the shape HelloID writes itself. */
      Conditions: rule.conds.map(c =>
        c.attr + (c.byId ? '.ExternalId' : '.Name') + ', one of: ' + c.values.join(', ')).join('|'),
      Entitlements: rule.grants.map(g => entName(g.ent)).join('|')
    })));
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  /** The coverage-first rule set — condensed, see condenseGreedy — in the same shape. */
  function greedyToRulesCsv(model, condensed) {
    const entName = key => {
      const perm = model.permissions.get(key);
      return perm ? (perm.system + ' - ' + perm.name + (perm.path ? ' (' + perm.path + ')' : '')) : key;
    };
    /* Already in marginal-gain order by construction; index = rank. */
    const cap = ruleCap();
    const rows = condensed.rules.map((rule, i) => ({
      Name: rule.everyone
        ? 'Basis - Alle medewerkers'
        : HR.mine.ruleName('Voorstel', rule.conds.map(c =>
            (c.labels.length > 1 ? c.labels.slice(0, 3).join(' / ') + (c.labels.length > 3 ? '…' : '')
              : (c.labels[0] || c.values[0]))).join(' + ')),
      EntitlementCount: rule.grants.length,
      PersonsLatestEvaluation: rule.members.length,
      Categories: (rule.conds.some(c => c.values.length > 1) ? 'Condensed' : 'Mined') +
        (cap && i >= cap ? '|Over rule cap' : ''),
      Status: 'proposal',
      Conditions: rule.conds.map(c =>
        c.attr + (c.byId ? '.ExternalId' : '.Name') + ', one of: ' + c.values.join(', ')).join('|'),
      Entitlements: rule.grants.map(g => entName(g.ent)).join('|')
    }));
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  /** The mined model as a HelloID business-rule export, ready to review and load back. */
  function toRulesCsv(model, pyramid) {
    const rows = [];
    const label = node => node.path.map(p => p.attr + ': ' + (p.label || p.value || '(empty)')).join(' / ') || 'Everyone';
    /* ExternalId where we grouped on one: a rule keyed on a name stops selecting anybody
       the day HR renames the department. */
    const condition = p => p.attr + (p.byId ? '.ExternalId' : '.Name') + ', one of: ' + p.value;
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
        Name: HR.mine.ruleName('Piramide', label(node)),
        EntitlementCount: rules.length,
        PersonsLatestEvaluation: node.members.length,
        Categories: 'Pyramid',
        Status: 'proposal',
        Conditions: node.path.map(condition).join('|'),
        Entitlements: rules.map(r => entName(r.ent)).join('|')
      });
    });
    /* One rule per distinct condition, granting everything that condition implies. */
    (pyramid.comboGroups ? Array.from(pyramid.comboGroups.values()) : []).forEach(group => {
      rows.push({
        /* A rule with one condition is not a combination; naming it one in the export
           would carry the mistake into HelloID. */
        Name: HR.mine.ruleName(group.conds.length > 1 ? 'Combinatie' : 'Voorstel',
          group.conds.map(c => c.label || c.value).join(' + ')),
        EntitlementCount: group.rules.length,
        PersonsLatestEvaluation: group.members.length,
        Categories: group.conds.length > 1 ? 'Combination' : 'Single attribute',
        Status: 'proposal',
        Conditions: group.conds.map(c =>
          c.attr + (c.byId ? '.ExternalId' : '.Name') + ', one of: ' + c.value).join('|'),
        Entitlements: group.rules.map(r => entName(r.ent)).join('|')
      });
    });
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  HR.pyramid = { build, mine, account, suggestLevels, mineCombos, population, greedy,
    sweep, baseline, condense, condensedOf, condenseGreedy, condensedToRulesCsv,
    rankForCap, ruleCap, availableAttributes, toRulesCsv, greedyToRulesCsv, ATTRIBUTES };
})(window.HR);
