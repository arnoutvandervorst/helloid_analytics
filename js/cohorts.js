/* Roles from HR alone.

   The pyramid needs to see access: its levels are chosen by how much of the granted
   entitlements they explain. With only a vault loaded there is nothing to explain yet —
   but the condition half of a business rule needs no access at all. Which departments,
   titles and locations exist, and how they combine, is already in the contracts, and a
   consultant can draft the rule skeleton from that before a single target system is
   connected. Entitlements attach later, on aggregate, once the reconciliation arrives.

   That last step is what the proposal has to serve. Entitlements only attach cleanly
   to a group whose members are alike enough to share access, so a rule for everybody
   places everyone and says nothing, and a rule set is worth more the more specific it
   is. Two numbers carry that:

     placed       people under at least one rule that fits HelloID's rule cap — a rule
                  set that needs 260 rules is judged on the 100 it can actually have
     alike        how much of what decides access the rule pins down. Every attribute
                  carries a weight for how much it decides access — a job title most,
                  a department or team a fair amount, a location or contract type a
                  little. An attribute the rule conditions on counts in full; one it
                  leaves open counts by how much more the members agree on it than
                  everybody does (lift over the population). So a job-title rule is
                  alike across a hundred departments, because the title is the job;
                  a department rule is alike only if its people share a title too; a
                  rule for everyone is 0. An attribute nobody shares anywhere (a cost
                  centre per person) neither helps nor drags.

   Rule count is not a cost. More rules is more specific; the only limit is the cap.
   An attribute that cannot group even half the people at the minimum size — a cost
   centre per person — describes individuals, not roles. It is left out of the rules
   and out of the alikeness measure, and the view says so.

   Groups become rules the way HelloID can hold them:

     merge        sibling groups share one rule with a "one of" list as long as the
                  shared rule is still alike enough — three wards with the same titles
                  and the same site are one rule, not three. A ward of two joins its
                  siblings and is placed, where alone it was too small to defend.

   Not every person is worth the same slot. A person who joined, moved or left in the
   last year counts double — that is the join, move or leave a rule would have handled,
   and where a rule set pays. A person in the long tail of job titles counts half: the
   job titles are ordered by headcount, the ones that together hold 80% of people are
   the core — operational by construction, nurses and helpers and drivers — and the
   rest is the long tail: controllers, jurists, one-offs, project work, which is better
   served by self-service than by rules. No word list, no HR vocabulary: mass alone.
   How concentrated the titles are is itself the headline — healthcare puts 80% of its
   people in a few dozen titles, government spreads them over hundreds.

   Where the vault carries the department hierarchy, the hierarchy is the natural
   layering: a rule on a level-2 unit is a generic rule for the whole branch, a rule
   on a leaf department the specialisation. Each level becomes an attribute of its own
   (Org1, Org2, …); a combination holds at most one of them, and in alikeness the
   levels share the department's weight so the hierarchy counts once. HelloID cannot
   condition on "under Wijkzorg", but the walker spells it out as a "one of" list of
   every department beneath — which is exactly what the export writes.

   No real access model uses one attribute, so the proposal is built as a set: every
   merged rule from every combination is a candidate, and rules are taken layer by
   layer — every single-attribute rule worth a
   slot first, then the two-attribute rules that add something on top of them, then
   three — each by how much more alike it makes the people it covers than the rules
   already taken do. The cap is a depth budget spent from the top of that pyramid:
   what the mix ends up being — titles here, department-and-title there, department
   underneath — is what the data supports, and the cap decides how far down it goes.

   The rules carry a condition list and the people it selects, in the same shape the
   pyramid's condensed rules use, so the day access is loaded the two can be matched
   on identity. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '\u001f';

  /* Up to this many attributes per rule. */
  const MAX_ATTRS = 3;
  /* An attribute whose own cohorts place fewer people than this describes individuals. */
  const DESCRIBES_BELOW = 0.5;
  /* Rule caps the proposal is read off at. */
  const CAP_SWEEP = [50, 100, 200, 500, 1000];
  /* A rule must add at least this many "people made fully alike" — a quarter of a
     smallest group — or it is not worth a slot. */
  const MIN_GAIN_PER_SIZE = 0.25;
  /* A "one of" list that selects at least this share of the people its other conditions
     already select is that wider rule with a pointless list: it becomes the wider rule. */
  const GENERAL_ABOVE = 0.9;
  /* Merging is pairwise, so a context of 500 sibling cells would score 125,000 pairs and
     re-score on every merge. Beyond this many siblings only the largest seed the merge;
     the rest attach to the most alike group afterwards, one pass each. */
  const MERGE_SEEDS = 150;
  /* What a person is worth to the objective: the long tail counts half, a join, move
     or leave in the last year doubles. Overridable through cfg.cohorts.worth. */
  const WORTH = { tail: 0.5, flow: 2 };
  /* The values that together hold this share of people are the core; the rest is tail. */
  const CORE_SHARE = 0.8;
  const DAY = 86400000;

  const settings = () => Object.assign({ alikeFloor: 0.5, ignore: [], require: [], weight: {}, worth: {} },
    HR.config.get().cohorts || {});
  /* How much each attribute decides access when nothing can be measured: the job is
     what a role is, the department or team is where it is done, the rest is scope. */
  const DECIDES = { Title: 3, Team: 2, Department: 2, Division: 1, Employer: 1, Location: 1,
    CostCenter: 1, ContractType: 1 };

  /**
   * How much each attribute decides access, with where the number came from. A value
   * the user set wins; with a reconciliation loaded the rest is measured — how much of
   * the granted access rules on that attribute alone explain, scaled so the best
   * attribute is 3 and anything that explains something is at least 1; without access
   * the defaults stand. Cached on the model with the rest of the mining.
   */
  function decidesFor(model, opts) {
    const auto = !!(opts && opts.auto);             // what the value would be without the user's setting
    if (model && model._decides && !auto) return model._decides;
    const set = auto ? {} : settings().weight;
    const measured = model && (model.hasRecon || (model.granted && !model.granted.empty)) && HR.pyramid.explains
      ? HR.pyramid.explains(model) : null;
    const top = measured ? Math.max.apply(null, Object.values(measured.gains).concat([0])) : 0;
    const out = {};
    for (const a of Object.keys(HR.pyramid.ATTRIBUTES)) {
      const w = set[a];
      if (w !== undefined && w !== null && w !== '') out[a] = { value: +w, source: 'manual' };
      else if (measured && measured.gains[a] !== undefined) {
        const gain = measured.gains[a];
        out[a] = { value: top > 0 && gain > 0 ? Math.max(1, Math.round(3 * gain / top)) : 0, source: 'measured', gain };
      } else out[a] = { value: DECIDES[a] === undefined ? 1 : DECIDES[a], source: 'default' };
    }
    if (model && !auto) model._decides = out;
    return out;
  }
  /** The weights alone: attr → number. */
  function weightsFor(model) {
    const d = decidesFor(model);
    return Object.fromEntries(Object.keys(d).map(a => [a, d[a].value]));
  }
  const wOf = (weights, a) => (weights && weights[a] !== undefined ? weights[a] : (DECIDES[a] === undefined ? 1 : DECIDES[a]));
  const isOrg = a => a === 'Department' || /^Org\d+$/.test(a);

  /**
   * The department hierarchy as attributes: for every person, the ancestors of their
   * department as Org1 (just under the root), Org2, … Levels are offered when the tree
   * is hierarchical, the level has two or more values across at least half the people,
   * and it does not just rename the leaves. Returns the offered level names.
   */
  function orgLevels(model, people) {
    if (!HR.org || !HR.org.tree) return [];
    const tree = HR.org.tree(model.vault);
    if (!tree.meta.hierarchical) return [];
    let maxDepth = 0;
    for (const p of people) {
      if (!p.attrs.Department) continue;
      const node = tree.byId(p.attrs.Department) || tree.byId(p.labels.Department);
      if (!node) continue;
      const path = tree.pathOf(node);
      /* Skip the single root: it is everyone. path[0] = root, last = the leaf itself. */
      path.slice(1, -1).forEach((n, i) => {
        const key = 'Org' + (i + 1);
        p.attrs[key] = n.id; p.labels[key] = n.name; p.byId[key] = !!n.externalId;
      });
      maxDepth = Math.max(maxDepth, path.length - 2);
    }
    const levels = [];
    for (let d = 1; d <= maxDepth; d++) {
      const key = 'Org' + d;
      const have = people.filter(p => p.attrs[key]);
      if (have.length < people.length * 0.5) continue;
      const vals = new Set(have.map(p => p.attrs[key]));
      const leaves = new Set(have.map(p => p.attrs.Department));
      if (vals.size < 2 || vals.size === leaves.size) continue;
      levels.push(key);
    }
    return levels;
  }

  /** Share of `members` holding the most common value of `attr` (missing is a value). */
  function purity(members, attr) {
    const tally = new Map();
    for (const p of members) { const v = p.attrs[attr] || ''; tally.set(v, (tally.get(v) || 0) + 1); }
    let top = 0;
    tally.forEach(n => { if (n > top) top = n; });
    return members.length ? top / members.length : 0;
  }

  /* Population purity per attribute, kept per population: the pyramid asks for the
     alikeness of its own rules against the same people. */
  const bases = new WeakMap();
  function baseOf(people, attributes) {
    let base = bases.get(people);
    if (!base) { base = new Map(); bases.set(people, base); }
    for (const a of attributes) if (!base.has(a)) base.set(a, purity(people, a));
    return base;
  }

  /**
   * How much of what decides access the rule pins down: each attribute's weight, in
   * full when the rule conditions on it, by the members' lift over the population when
   * it leaves it open. Attributes everybody shares carry no information and are left
   * out; nothing to weigh means the group agrees on everything there is.
   */
  function alikeOf(people, members, fixed, attributes, weights) {
    const w = weights || weightsFor(null);
    const base = baseOf(people, attributes);
    const counted = attributes.filter(a => fixed.includes(a) || base.get(a) < 1);
    const total = U.sum(counted, a => wOf(w, a));
    if (!total) return 1;
    return U.sum(counted, a => wOf(w, a) * (fixed.includes(a) ? 1
      : Math.max(0, (purity(members, a) - base.get(a)) / (1 - base.get(a))))) / total;
  }

  /** Partition people by the values of `attrs`; a person missing any value is unplaced. */
  function partition(people, attrs, minSize) {
    const cells = new Map();
    let unplaced = 0;
    for (const p of people) {
      const values = attrs.map(a => p.attrs[a] || '');
      if (values.some(v => !v)) { unplaced++; continue; }
      const key = values.join(SEP);
      let cell = cells.get(key);
      if (!cell) {
        cell = { conds: attrs.map((a, i) => ({ attr: a, value: values[i], label: p.labels[a] || values[i], byId: !!p.byId[a] })),
          members: [] };
        cells.set(key, cell);
      }
      cell.members.push(p);
    }
    const all = Array.from(cells.values()).sort((a, b) => b.members.length - a.members.length);
    const placed = U.sum(all.filter(c => c.members.length >= minSize), c => c.members.length);
    return { attrs, cells: all, unplaced, placedShare: people.length ? placed / people.length : 0 };
  }

  /** Every subset of `items` with 1..k members, smaller subsets first. */
  function subsets(items, k) {
    const out = [];
    const walk = (start, acc) => {
      if (acc.length) out.push(acc.slice());
      if (acc.length === k) return;
      for (let i = start; i < items.length; i++) { acc.push(items[i]); walk(i + 1, acc); acc.pop(); }
    };
    walk(0, []);
    return out.sort((a, b) => a.length - b.length);
  }

  /* ------------------------------------------------------------------ merging */

  /** Per attribute, value → count over the members, with the largest count kept. */
  function profileOf(members, others) {
    const prof = new Map();
    for (const a of others) {
      const tally = new Map();
      for (const p of members) { const v = p.attrs[a] || ''; tally.set(v, (tally.get(v) || 0) + 1); }
      let top = 0; tally.forEach(n => { if (n > top) top = n; });
      tally.top = top;
      prof.set(a, tally);
    }
    return prof;
  }

  /** Add profile `b` into `a`, keeping the tops current. */
  function absorb(a, b, open) {
    for (const attr of open) {
      const ta = a.profile.get(attr), tb = b.profile.get(attr);
      tb.forEach((n, v) => { const m = (ta.get(v) || 0) + n; ta.set(v, m); if (m > ta.top) ta.top = m; });
    }
  }

  /** How alike the two groups would be as one rule, from their summed profiles —
      the same weighing as alikeOf. The pivot is not fixed by a list: a list of every
      title fixes nothing, so it counts by its lift like an open attribute. The top of
      the sum is found by walking only the smaller tally: a value absent from it can
      do no better than the larger tally's own top. */
  function similarity(a, b, fixed, others, base, weights) {
    const n = a.members.length + b.members.length;
    let total = U.sum(fixed, x => wOf(weights, x)), weight = total;
    for (const attr of others) {
      const g = base.get(attr);
      if (g >= 1) continue;
      let ta = a.profile.get(attr), tb = b.profile.get(attr);
      if (ta.size > tb.size) { const t = ta; ta = tb; tb = t; }
      let top = tb.top;
      ta.forEach((c, v) => { const m = c + (tb.get(v) || 0); if (m > top) top = m; });
      const w = wOf(weights, attr);
      weight += w;
      total += w * Math.max(0, (top / n - g) / (1 - g));
    }
    return weight ? total / weight : 1;
  }

  /** A small max-heap on `sim`, so merging stays n² log n rather than n³. */
  function heap() {
    const h = [];
    const up = i => { for (let p; i > 0 && h[i].sim > h[p = (i - 1) >> 1].sim; i = p) { const t = h[i]; h[i] = h[p]; h[p] = t; } };
    const down = i => {
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l].sim > h[m].sim) m = l;
        if (r < h.length && h[r].sim > h[m].sim) m = r;
        if (m === i) return;
        const t = h[i]; h[i] = h[m]; h[m] = t; i = m;
      }
    };
    return {
      push: x => { h.push(x); up(h.length - 1); },
      pop: () => { const top = h[0]; const last = h.pop(); if (h.length) { h[0] = last; down(0); } return top; },
      peek: () => h[0],
      get size() { return h.length; }
    };
  }

  /**
   * Merge sibling cells — same conditions except `pivot` — as long as the merged rule
   * stays at least `floor` alike, greedily most-alike-first, until no pair qualifies.
   * Small cells take part: a ward of two that joins its siblings is placed, where alone
   * it was too small to defend. Cells still under the minimum afterwards are left over.
   */
  function mergeSimilar(cells, fixed, pivot, others, base, floor, minSize, weights) {
    const contexts = new Map();
    for (const cell of cells) {
      const key = cell.conds.filter(c => c.attr !== pivot).map(c => c.value).join(SEP);
      if (!contexts.has(key)) contexts.set(key, []);
      contexts.get(key).push(cell);
    }

    const rules = [];
    let leftover = 0;
    contexts.forEach(siblings => {
      const contextPeople = U.sum(siblings, c => c.members.length);
      const open = others.concat([pivot]);
      const context = fixed.filter(a => a !== pivot);
      const all = siblings.map(cell => ({
        cells: [cell], members: cell.members.slice(), profile: profileOf(cell.members, open), alive: true, v: 0
      })).sort((x, y) => y.members.length - x.members.length);
      const groups = all.slice(0, MERGE_SEEDS);
      const rest = all.slice(MERGE_SEEDS);
      const merge = (a, b) => {
        b.alive = false;
        a.v++;
        a.cells = a.cells.concat(b.cells);
        a.members = a.members.concat(b.members);
        absorb(a, b, open);
      };
      if (groups.length > 1 && floor < 1) {
        const q = heap();
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const sim = similarity(groups[i], groups[j], context, open, base, weights);
            if (sim >= floor) q.push({ a: groups[i], b: groups[j], sim, va: 0, vb: 0 });
          }
        }
        while (q.size) {
          const top = q.pop();
          /* A pair scored before either side grew is stale: its score no longer describes
             the rule the merge would make. */
          if (!top.a.alive || !top.b.alive || top.a.v !== top.va || top.b.v !== top.vb) continue;
          const a = top.a;
          merge(a, top.b);
          for (const g of groups) {
            if (g === a || !g.alive) continue;
            const sim = similarity(a, g, context, open, base, weights);
            if (sim >= floor) q.push({ a, b: g, sim, va: a.v, vb: g.v });
          }
        }
      }
      /* The small cells past the seed limit: each joins the group it is most alike
         with, if that group stays above the floor. */
      for (const cell of rest) {
        let best = null, bestSim = floor;
        if (floor < 1) for (const g of groups) {
          if (!g.alive) continue;
          const sim = similarity(g, cell, context, open, base, weights);
          if (sim >= bestSim) { best = g; bestSim = sim; }
        }
        if (best) merge(best, cell); else groups.push(cell);
      }
      for (const g of groups) {
        if (!g.alive) continue;
        if (g.members.length < minSize) { leftover += g.members.length; continue; }
        const contextConds = g.cells[0].conds.filter(c => c.attr !== pivot);
        /* "Helpende in one of 73 departments" is Helpende; a list that selects nearly
           everyone its context selects is the context rule, the few cells it left out
           included — "except these five" is not a rule. With no context it would be a
           rule for everybody, which says nothing. */
        if (g.members.length >= GENERAL_ABOVE * contextPeople) {
          if (!contextConds.length) continue;
          rules.push({
            conds: contextConds.map(c => ({ attr: c.attr, values: [c.value], labels: [c.label], byId: c.byId })),
            members: siblings.flatMap(c => c.members), from: g.cells.length, generalised: true
          });
          continue;
        }
        const on = g.cells.map(cell => cell.conds.find(c => c.attr === pivot));
        /* Conditions in the attribute order of the level, so identical rules read and
           key the same whichever attribute was the pivot. */
        const conds = contextConds.map(c => ({ attr: c.attr, values: [c.value], labels: [c.label], byId: c.byId }))
          .concat([{ attr: pivot, values: on.map(c => c.value), labels: on.map(c => c.label), byId: on[0].byId }]);
        conds.sort((x, y) => fixed.indexOf(x.attr) - fixed.indexOf(y.attr));
        rules.push({ conds, members: g.members, from: g.cells.length });
      }
    });
    rules.sort((a, b) => b.members.length - a.members.length);
    return { rules, leftover };
  }

  /**
   * Where the mass sits: per attribute, the values ordered by headcount, the ones that
   * together hold CORE_SHARE of the people, and the size of the group a typical person
   * sits in (people-weighted median of their own value's headcount).
   */
  function massOf(people, attr) {
    /* By name, not by HR code: one job title carried under four codes is still one
       job, and splitting its headcount would drop it out of the core. */
    const tally = new Map();
    for (const p of people) { const v = p.labels[attr] || p.attrs[attr]; if (v) tally.set(v, (tally.get(v) || 0) + 1); }
    const ordered = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
    const withValue = U.sum(ordered, x => x[1]);
    const core = new Set();
    let running = 0;
    for (const [v, n] of ordered) { if (running >= withValue * CORE_SHARE) break; core.add(v); running += n; }
    /* Half the people sit in a value at least this big. */
    let seen = 0, typical = 0;
    for (const [, n] of ordered) { seen += n; if (seen >= withValue / 2) { typical = n; break; } }
    return { values: ordered.length, coreValues: core.size, core, withValue,
      coreShare: withValue ? running / withValue : 0, typical };
  }

  /**
   * What each person is worth to the objective, written onto the population: core or
   * long tail by their job title's headcount, and whether they joined, moved or left
   * within the last year.
   */
  function worthOf(model, people, mass) {
    const worth = Object.assign({}, WORTH, settings().worth);
    /* "Last year" counts from the vault's own horizon — the latest contract start that
       is not in the future — so an export from a while ago still shows its flow. Starts
       are facts; end dates are often plans, so they do not set the horizon. */
    const today = new Date();
    let now = null;
    for (const person of model.vault.persons) for (const c of person.contracts) {
      if (c.startDate && c.startDate <= today && (!now || c.startDate > now)) now = c.startDate;
    }
    now = now || today;
    const recent = d => d && (now - d) / DAY <= 365 && (now - d) >= -1;
    const moved = new Set();
    if (HR.workforce && HR.workforce.moves) {
      HR.workforce.moves(model.vault, now).forEach(mv => { if (mv.daysAgo >= 0 && mv.daysAgo <= 365) moved.add(mv.person); });
    }
    for (const p of people) {
      p.core = !!(p.labels.Title || p.attrs.Title) && mass.Title.core.has(p.labels.Title || p.attrs.Title);
      p.flow = recent(p.person.firstStart) || recent(p.person.lastEnd) || moved.has(p.person);
      p.worth = (p.core ? 1 : worth.tail) * (p.flow ? worth.flow : 1);
    }
  }

  /**
   * Every merged rule from every combination, as candidates for the proposal. Each
   * combination merges along its most fragmented attribute, the axis where "one of"
   * lists buy the most.
   */
  /** The attributes a rule really fixes: one value, not a list. */
  const fixedOf = r => r.conds.filter(c => c.values.length === 1).map(c => c.attr);

  /** Identity of a rule: its attributes and, per attribute, its sorted value list. */
  const ruleKey = r => r.conds.map(c => c.attr + '=' + c.values.slice().sort().join(SEPX)).sort().join('|');
  const SEPX = '\u001e';

  function pool(people, attributes, minSize, floor, cellsOf, required, weights) {
    const byKey = new Map();
    for (const attrs of subsets(attributes, MAX_ATTRS)) {
      if (!required.every(a => attrs.includes(a))) continue;
      /* Nested levels imply each other: one org attribute per combination. */
      if (attrs.filter(isOrg).length > 1) continue;
      const part = partition(people, attrs, minSize);
      const pivot = attrs.slice().sort((a, b) => cellsOf(b) - cellsOf(a))[0];
      const others = attributes.filter(a => !attrs.includes(a));
      const merged = mergeSimilar(part.cells, attrs, pivot, others, baseOf(people, attributes), floor, minSize, weights);
      merged.rules.forEach(r => {
        /* A generalised rule has fewer attributes than the combination that produced it. */
        r.attrs = r.conds.map(c => c.attr);
        if (!required.every(a => r.attrs.includes(a))) return;
        r.alike = alikeOf(people, r.members, fixedOf(r), attributes, weights);
        /* A single-attribute rule is a root: it holds the generic permissions, and its
           alikeness is what the rules built on it improve. Anything more specific must
           itself clear the floor — 449 people at 10% alike is not a role. A root that
           is not alike at all is a rule for everybody. */
        if (r.attrs.length > 1 ? r.alike < floor : r.alike <= 0) return;
        r.share = people.length ? r.members.length / people.length : 0;
        r.tailShare = U.sum(r.members, p => p.core ? 0 : 1) / r.members.length;
        r.flowShare = U.sum(r.members, p => p.flow ? 1 : 0) / r.members.length;
        const key = ruleKey(r);
        const seen = byKey.get(key);
        if (!seen || r.from > seen.from) byKey.set(key, r);
      });
    }
    return Array.from(byKey.values());
  }

  /**
   * The proposed rule set: greedy on the gain in alikeness, where every person counts
   * for the most alike rule that covers them and an unplaced person counts for nothing.
   * Lazy — a candidate's gain only shrinks as rules are taken, so a stale top entry is
   * re-scored and re-inserted rather than everything re-scored on every pick.
   */
  const splitOn = (people, pick, placed) => {
    const group = people.filter(pick);
    const n = group.filter(p => placed.has(p)).length;
    return { people: group.length, placed: n, placedShare: group.length ? n / group.length : 0 };
  };

  function propose(people, candidates, minSize, cap) {
    const current = new Map();
    /* Gain in people-alike, each person weighed by what they are worth. */
    const gainOf = r => { let g = 0; for (const p of r.members) g += (p.worth || 1) * Math.max(0, r.alike - (current.get(p) || 0)); return g; };
    candidates.forEach(r => { r.rank = 0; r.overCap = false; });

    const minGain = minSize * MIN_GAIN_PER_SIZE;
    const limit = Math.max(cap, CAP_SWEEP[CAP_SWEEP.length - 1]);
    const rules = [];
    const trail = [];
    let objective = 0;
    let taken = 0;
    /* Layer by layer, the top of the pyramid first: every single-attribute rule worth a
       slot, then the two-attribute rules that add something on top of them, then three.
       The cap is a depth budget spent from the top — it cuts drill-down evenly instead
       of spending its slots on one job title's every corner. Within a layer, by gain. */
    for (let depth = 1; depth <= MAX_ATTRS && rules.length < limit; depth++) {
      const q = heap();
      candidates.forEach(r => { if (r.attrs.length === depth) q.push({ r, sim: gainOf(r), v: taken }); });
      while (q.size && rules.length < limit) {
        const top = q.pop();
        const gain = gainOf(top.r);
        if (gain < minGain) { if (top.v === taken) break; continue; }
        /* Scored before the last pick and now beaten by the next entry: re-insert. */
        if (top.v !== taken && q.size && gain < q.peek().sim) { q.push({ r: top.r, sim: gain, v: taken }); continue; }
        const r = top.r;
        let fresh = 0;
        for (const p of r.members) {
          const was = current.get(p) || 0;
          /* The objective stays unweighted, so "alike" keeps its meaning as a mean. */
          if (r.alike > was) { if (!was) fresh++; objective += r.alike - was; current.set(p, r.alike); }
        }
        taken++;
        r.rank = taken; r.gain = gain; r.newPlaced = fresh; r.overCap = cap > 0 && taken > cap;
        rules.push(r);
        trail.push({ rank: taken, placedShare: people.length ? current.size / people.length : 0,
          alike: people.length ? objective / people.length : 0 });
      }
    }

    const at = n => trail[Math.min(n, trail.length) - 1] || { rank: 0, placedShare: 0, alike: 0 };
    const within = cap > 0 ? at(cap) : at(trail.length);
    const mixMap = new Map();
    rules.forEach(r => { if (r.overCap) return; const k = r.attrs.join(SEP); mixMap.set(k, (mixMap.get(k) || 0) + 1); });
    const mix = Array.from(mixMap.entries()).map(([k, count]) => ({ attrs: k.split(SEP), count }))
      .sort((a, b) => b.count - a.count);

    /* What each rule builds on: the widest chosen rule its conditions imply — the
       generic job-title rule under its department-and-title specialisations. The
       hierarchy the pyramid has by construction, read off a set that was chosen flat. */
    /* Implication by membership rather than by condition text, so a rule on a leaf
       department sits under the rule on the branch above it. */
    const memberSets = new Map(rules.map(r => [r, new Set(r.members)]));
    const implies = (r, p) => { const ps = memberSets.get(p); return r.members.every(m => ps.has(m)); };
    for (const r of rules) {
      r.parent = null;
      for (const p of rules) {
        /* A wider rule with fewer attributes, or — same attributes — a list that contains
           this rule's people: "Verzorgende IG" builds on "Verzorgende IG or nine others". */
        if (p === r || p.attrs.length > r.attrs.length || p.overCap !== r.overCap && p.overCap) continue;
        if (p.members.length <= r.members.length || !implies(r, p)) continue;
        if (!r.parent || p.attrs.length > r.parent.attrs.length ||
            (p.attrs.length === r.parent.attrs.length && p.rank < r.parent.rank)) r.parent = p;
      }
    }
    for (const r of rules) {
      let root = r; while (root.parent) root = root.parent;
      r.root = root;
      r.depth = 0; for (let p = r.parent; p; p = p.parent) r.depth++;
    }
    const families = rules.filter(r => !r.parent && !r.overCap)
      .map(root => ({ root, under: rules.filter(r => r.root === root && r !== root && !r.overCap).length }))
      .sort((a, b) => b.root.members.length - a.root.members.length);

    /* Who is placed, by what they are worth: core vs long tail, and recent flow. */
    const placedWithin = new Map();
    rules.forEach(r => { if (!r.overCap) r.members.forEach(p => placedWithin.set(p, 1)); });
    const groups = {
      core: splitOn(people, p => p.core, placedWithin),
      tail: splitOn(people, p => !p.core, placedWithin),
      flow: splitOn(people, p => p.flow, placedWithin)
    };

    return {
      rules, mix, families,
      capSweep: CAP_SWEEP.map(c => Object.assign({ cap: c, current: c === cap }, at(c))),
      summary: {
        core: groups.core, tail: groups.tail, flow: groups.flow,
        rules: Math.min(rules.length, cap > 0 ? cap : rules.length),
        overCap: rules.filter(r => r.overCap).length,
        placedShare: within.placedShare, alike: within.alike,
        lists: rules.filter(r => !r.overCap && r.conds.some(c => c.values.length > 1)).length,
        roots: families.length,
        under: U.sum(families, f => f.under),
        candidates: candidates.length
      }
    };
  }

  function build(model, opts) {
    if (model._cohorts && !(opts && opts.force)) return model._cohorts;
    if (!model.vault) return null;
    if (opts && opts.force) delete model._decides;
    const cfg = HR.config.get();
    const minSize = (cfg.pyramid && cfg.pyramid.minSize) || 5;
    const cap = HR.pyramid.ruleCap();
    const prefs = settings();

    const people = HR.pyramid.population(model, model.vault, model.granted);
    const levels = orgLevels(model, people);
    const offered = HR.pyramid.availableAttributes(people).concat(levels);
    /* Which attributes take part: what the data offers, minus what describes
       individuals, minus what the user switched off. The list itself is kept so the
       view can show the switches. */
    const excluded = [];
    const ignored = [];
    const cellsOf = {};
    const attributes = offered.filter(a => {
      const part = partition(people, [a], minSize);
      cellsOf[a] = part.cells.length;
      if (part.placedShare < DESCRIBES_BELOW) { excluded.push({ attr: a, placedShare: part.placedShare }); return false; }
      if (prefs.ignore.includes(a)) { ignored.push(a); return false; }
      return true;
    });
    const required = prefs.require.filter(a => attributes.includes(a));
    const decides = decidesFor(model);
    const weights = weightsFor(model);
    /* The hierarchy counts once: the department's weight is shared over its levels. */
    const orgAttrs = ['Department'].concat(levels);
    orgAttrs.forEach(a => { weights[a] = weights.Department / orgAttrs.length; });
    if (!attributes.length) {
      return { unavailable: 'no-attributes', people, offered, attributes: [], excluded, ignored, weights, decides };
    }

    const mass = { Title: massOf(people, 'Title'), Department: massOf(people, 'Department') };
    worthOf(model, people, mass);
    const proposal = propose(people,
      pool(people, attributes, minSize, prefs.alikeFloor, a => cellsOf[a], required, weights), minSize, cap);
    const result = {
      people, offered, attributes, excluded, ignored, required, weights, decides, mass, levels, minSize, cap,
      alikeFloor: prefs.alikeFloor, proposal,
      summary: Object.assign({ people: people.length }, proposal.summary)
    };
    model._cohorts = result;
    return result;
  }

  /** HelloID business-rule CSV with the conditions filled in and nothing granted yet. */
  function toRulesCsv(model, R) {
    /* A level above the leaves is not something HelloID can condition on; the walker
       spells it out as every department beneath that has people. */
    const tree = R.levels && R.levels.length && HR.org && HR.org.tree ? HR.org.tree(model.vault) : null;
    const beneath = id => {
      const node = tree && tree.byId(id);
      if (!node) return [id];
      const out = [];
      const walk = n => { if (n.people.length) out.push(n.externalId || n.name); n.children.forEach(walk); };
      walk(node);
      return out;
    };
    const condition = c => /^Org\d+$/.test(c.attr)
      ? 'Department.ExternalId, one of: ' + U.uniq(c.values.flatMap(beneath)).join(', ')
      : c.attr + (c.byId ? '.ExternalId' : '.Name') + ', one of: ' + c.values.join(', ');
    const name = c => c.labels.length > 1
      ? c.labels.slice(0, 3).join(' / ') + (c.labels.length > 3 ? '…' : '')
      : (c.labels[0] || c.values[0]);
    const rows = R.proposal.rules.slice().sort((a, b) => a.rank - b.rank).map(r => ({
      Name: HR.mine.ruleName('Rol', r.conds.map(name).join(' + ')),
      EntitlementCount: 0,
      PersonsLatestEvaluation: r.members.length,
      Categories: 'HR proposal|' + r.attrs.join(' + ') + (r.overCap ? '|Over rule cap' : ''),
      Status: 'proposal',
      Conditions: r.conds.map(condition).join('|'),
      Entitlements: ''
    }));
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  HR.cohorts = { build, toRulesCsv, alikeOf, weightsFor, decidesFor, isOrg, CAP_SWEEP };
})(window.HR);
