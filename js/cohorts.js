/* Roles from HR alone.

   The pyramid needs to see access: its levels are chosen by how much of the granted
   entitlements they explain. With only a vault loaded there is nothing to explain yet —
   but the condition half of a business rule needs no access at all. Which departments,
   titles and locations exist, and how they combine, is already in the contracts, and a
   consultant can draft the rule skeleton from that before a single target system is
   connected. Entitlements attach later, on aggregate, once the reconciliation arrives.

   That last step is what the score has to serve. Entitlements only attach cleanly to a
   cohort whose members are alike enough to share access, so a rule for everybody places
   everyone and says nothing, and a rule set is worth more the more specific it is. So
   every single attribute, every pair and every triple is scored on two numbers, both
   shown, so the ranking is something a reader can argue with:

     placed       people who land in a cohort of at least the minimum size — counted
                  over the largest cohorts that fit HelloID's rule cap, because a rule
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
     score        placed × alike — as specific as the data allows while the cohorts
                  stay large enough to defend and few enough to fit

   Rule count is not a cost. More cohorts is more specific; the only limit is the cap,
   and it enters the score only through the people the cohorts past it cannot place.

     follows      a candidate whose extra attribute barely splits a narrower one: a team
                  nested inside its department adds a condition and no information

   An attribute that cannot group even half the people at the minimum size — a cost
   centre per person — describes individuals, not roles. It is left out of the
   candidates and out of the alikeness measure, and the view says so.

   The chosen attributes then become rules, the way HelloID can hold them:

     merge        sibling cohorts share one rule with a "one of" list as long as the
                  shared rule is still alike enough — three wards with the same titles
                  and the same site are one rule, not three. A ward of two joins its
                  siblings and is placed, where alone it was too small to defend.
     ladder       with two or more attributes, a wide rule sits under the specific one,
                  because HelloID rules stack: the department rule catches whoever the
                  department-and-title rule cannot.

   No real access model uses one attribute, so the proposal is built as a set rather
   than picked as a combination: every merged rule from every combination is a
   candidate, and rules are taken one at a time by how much more alike they make the
   people they cover than the rules already taken do. A wide rule that places many
   people from nothing wins early; a specific rule that lifts a department's nurses
   from "alike as a department" to "alike as nurses" follows; what the mix ends up
   being — titles here, department-and-title there, department underneath — is what
   the data supports, and the cap decides where it stops.

   The rules carry a condition list and the people it selects, in the same shape the
   pyramid's condensed rules use, so the day access is loaded the two can be matched
   on identity. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '\u001f';

  /* A candidate whose cells add fewer than this share on top of its widest narrower
     candidate is that candidate wearing an extra condition. */
  const FOLLOWS_BELOW = 0.1;
  /* Up to this many attributes per candidate. */
  const MAX_ATTRS = 3;
  /* An attribute whose own cohorts place fewer people than this describes individuals. */
  const DESCRIBES_BELOW = 0.5;
  /* Smallest-group sizes the sweep tries. */
  const SWEEP_SIZES = [3, 5, 8, 10, 15, 20, 25];
  /* Rule caps the proposal is read off at. */
  const CAP_SWEEP = [50, 100, 200, 500, 1000];
  /* A rule must add at least this many "people made fully alike" — a quarter of a
     smallest group — or it is not worth a slot. */
  const MIN_GAIN_PER_SIZE = 0.25;
  /* A "one of" list that selects at least this share of the people its other conditions
     already select is that wider rule with a pointless list: it becomes the wider rule. */
  const GENERAL_ABOVE = 0.9;

  const settings = () => Object.assign({ alikeFloor: 0.5, ladder: true, ignore: [], require: [], weight: {} },
    HR.config.get().cohorts || {});
  /* How much each attribute decides access, by default: the job is what a role is,
     the department or team is where it is done, the rest is scope. Editable. */
  const DECIDES = { Title: 3, Team: 2, Department: 2, Division: 1, Employer: 1, Location: 1,
    CostCenter: 1, ContractType: 1 };
  const weightOf = a => {
    const w = settings().weight[a];
    return w === undefined || w === null ? (DECIDES[a] === undefined ? 1 : DECIDES[a]) : +w;
  };

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
  function alikeOf(people, members, fixed, attributes) {
    const base = baseOf(people, attributes);
    const counted = attributes.filter(a => fixed.includes(a) || base.get(a) < 1);
    const total = U.sum(counted, weightOf);
    if (!total) return 1;
    return U.sum(counted, a => weightOf(a) * (fixed.includes(a) ? 1
      : Math.max(0, (purity(members, a) - base.get(a)) / (1 - base.get(a))))) / total;
  }

  /** Partition people by the values of `attrs`; a person missing any value is unplaced. */
  function partition(people, attrs, minSize, attributes, cap) {
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
    const usable = all.filter(c => c.members.length >= minSize);
    usable.forEach((c, i) => { c.rank = i + 1; });
    /* Largest first, so what fits under the cap is the best the cap allows. */
    const within = cap > 0 ? usable.slice(0, cap) : usable;
    const placed = U.sum(within, c => c.members.length);
    const sizes = within.map(c => c.members.length);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    const placedShare = people.length ? placed / people.length : 0;

    for (const c of usable) c.alike = alikeOf(people, c.members, attrs, attributes);
    const alike = placed ? U.sum(within, c => c.members.length * c.alike) / placed : 0;

    return {
      attrs, cells: all, usable,
      counts: { cells: all.length, usable: usable.length, overCap: usable.length - within.length,
        placed, unplaced, placedShare, leftover: people.length - placed, median, alike,
        score: placedShare * alike }
    };
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

  /** Per attribute, value → count over the members. */
  function profileOf(members, others) {
    const prof = new Map();
    for (const a of others) {
      const tally = new Map();
      for (const p of members) { const v = p.attrs[a] || ''; tally.set(v, (tally.get(v) || 0) + 1); }
      prof.set(a, tally);
    }
    return prof;
  }

  /** How alike the two groups would be as one rule, from their summed profiles —
      the same weighing as alikeOf. The pivot is not fixed by a list: a list of every
      title fixes nothing, so it counts by its lift like an open attribute. */
  function similarity(a, b, fixed, others, base) {
    const n = a.members.length + b.members.length;
    let total = U.sum(fixed, weightOf), weight = total;
    for (const attr of others) {
      const g = base.get(attr);
      if (g >= 1) continue;
      const ta = a.profile.get(attr), tb = b.profile.get(attr);
      let top = 0;
      ta.forEach((c, v) => { const m = c + (tb.get(v) || 0); if (m > top) top = m; });
      tb.forEach((c, v) => { if (!ta.has(v) && c > top) top = c; });
      const w = weightOf(attr);
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
  function mergeSimilar(cells, fixed, pivot, others, base, floor, minSize) {
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
      const groups = siblings.map(cell => ({
        cells: [cell], members: cell.members.slice(), profile: profileOf(cell.members, open), alive: true, v: 0
      }));
      if (groups.length > 1 && floor < 1) {
        const q = heap();
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const sim = similarity(groups[i], groups[j], context, open, base);
            if (sim >= floor) q.push({ a: groups[i], b: groups[j], sim, va: 0, vb: 0 });
          }
        }
        while (q.size) {
          const top = q.pop();
          /* A pair scored before either side grew is stale: its score no longer describes
             the rule the merge would make. */
          if (!top.a.alive || !top.b.alive || top.a.v !== top.va || top.b.v !== top.vb) continue;
          const a = top.a, b = top.b;
          b.alive = false;
          a.v++;
          a.cells = a.cells.concat(b.cells);
          a.members = a.members.concat(b.members);
          for (const attr of open) {
            const ta = a.profile.get(attr);
            b.profile.get(attr).forEach((n, v) => ta.set(v, (ta.get(v) || 0) + n));
          }
          for (const g of groups) {
            if (g === a || !g.alive) continue;
            const sim = similarity(a, g, context, open, base);
            if (sim >= floor) q.push({ a, b: g, sim, va: a.v, vb: g.v });
          }
        }
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

  /* --------------------------------------------------------------- the rules */

  /**
   * The chosen attributes as a rule set: one level per prefix when the ladder is on
   * (widest attribute first, so the department rule sits under the department-and-title
   * rule), each level merged along its last attribute, then ranked against the cap.
   */
  function rulesFor(people, chosen, attributes, minSize, cap, opts, cellsOf) {
    const order = opts.ladder && chosen.length > 1
      ? chosen.slice().sort((a, b) => cellsOf(a) - cellsOf(b))
      : chosen.slice();
    const levels = opts.ladder && chosen.length > 1
      ? order.map((_, i) => order.slice(0, i + 1))
      : [order];

    const rules = [];
    let before = 0, leftover = 0;
    levels.forEach((attrs, i) => {
      const part = partition(people, attrs, minSize, attributes, 0);
      const pivot = attrs[attrs.length - 1];
      const others = attributes.filter(a => !attrs.includes(a));
      const merged = mergeSimilar(part.cells, attrs, pivot, others, baseOf(people, attributes), opts.alikeFloor, minSize);
      if (i === levels.length - 1) { before = part.counts.cells; leftover = merged.leftover + part.counts.unplaced; }
      merged.rules.forEach(r => {
        /* On a ladder the generalised rule is the level above, already there. */
        if (r.generalised && i > 0) return;
        r.level = i + 1;
        r.alike = alikeOf(people, r.members, fixedOf(r), attributes);
        r.share = people.length ? r.members.length / people.length : 0;
        rules.push(r);
      });
    });

    /* Wide rules first — they are what places people — then the specific ones. */
    rules.sort((a, b) => a.level - b.level || b.members.length - a.members.length);
    rules.forEach((r, i) => { r.rank = i + 1; r.overCap = cap > 0 && r.rank > cap; });

    /* Every person's deepest rule that fits the cap decides where they are placed and
       how alike they are to the people they share it with. */
    const deepest = new Map();
    for (const r of rules) {
      if (r.overCap) continue;
      for (const p of r.members) { const d = deepest.get(p); if (!d || r.level > d.level) deepest.set(p, r); }
    }
    const placed = deepest.size;
    let specific = 0, alikeSum = 0;
    deepest.forEach(r => { if (r.level === levels.length) specific++; alikeSum += r.alike; });

    return {
      levels, rules,
      summary: {
        before, after: rules.length,
        lists: rules.filter(r => r.conds.some(c => c.values.length > 1)).length,
        overCap: rules.filter(r => r.overCap).length,
        placed, placedShare: people.length ? placed / people.length : 0,
        leftover: people.length - placed,
        specific, specificShare: placed ? specific / placed : 0,
        alike: placed ? alikeSum / placed : 0
      }
    };
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

  function pool(people, attributes, minSize, floor, cellsOf, required) {
    const byKey = new Map();
    for (const attrs of subsets(attributes, MAX_ATTRS)) {
      if (!required.every(a => attrs.includes(a))) continue;
      const part = partition(people, attrs, minSize, attributes, 0);
      const pivot = attrs.slice().sort((a, b) => cellsOf(b) - cellsOf(a))[0];
      const others = attributes.filter(a => !attrs.includes(a));
      const merged = mergeSimilar(part.cells, attrs, pivot, others, baseOf(people, attributes), floor, minSize);
      merged.rules.forEach(r => {
        /* A generalised rule has fewer attributes than the combination that produced it. */
        r.attrs = r.conds.map(c => c.attr);
        if (!required.every(a => r.attrs.includes(a))) return;
        r.alike = alikeOf(people, r.members, fixedOf(r), attributes);
        /* A single-attribute rule is a root: it holds the generic permissions, and its
           alikeness is what the rules built on it improve. Anything more specific must
           itself clear the floor — 449 people at 10% alike is not a role. A root that
           is not alike at all is a rule for everybody. */
        if (r.attrs.length > 1 ? r.alike < floor : r.alike <= 0) return;
        r.share = people.length ? r.members.length / people.length : 0;
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
  function propose(people, candidates, minSize, cap) {
    const current = new Map();
    const gainOf = r => { let g = 0; for (const p of r.members) g += Math.max(0, r.alike - (current.get(p) || 0)); return g; };
    const q = heap();
    candidates.forEach(r => { r.rank = 0; r.overCap = false; q.push({ r, sim: gainOf(r), v: 0 }); });

    const minGain = minSize * MIN_GAIN_PER_SIZE;
    const limit = Math.max(cap, CAP_SWEEP[CAP_SWEEP.length - 1]);
    const rules = [];
    const trail = [];
    let objective = 0;
    let taken = 0;
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
        if (r.alike > was) { if (!was) fresh++; current.set(p, r.alike); }
      }
      taken++;
      objective += gain;
      r.rank = taken; r.gain = gain; r.newPlaced = fresh; r.overCap = cap > 0 && taken > cap;
      rules.push(r);
      trail.push({ rank: taken, placedShare: people.length ? current.size / people.length : 0,
        alike: people.length ? objective / people.length : 0 });
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
    const implies = (r, p) => p.conds.every(pc => {
      const rc = r.conds.find(c => c.attr === pc.attr);
      return rc && rc.values.every(v => pc.values.includes(v));
    });
    for (const r of rules) {
      r.parent = null;
      for (const p of rules) {
        if (p === r || p.attrs.length >= r.attrs.length || p.overCap !== r.overCap && p.overCap) continue;
        if (!implies(r, p)) continue;
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

    return {
      rules, mix, families,
      capSweep: CAP_SWEEP.map(c => Object.assign({ cap: c, current: c === cap }, at(c))),
      summary: {
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
    const cfg = HR.config.get();
    const minSize = (cfg.pyramid && cfg.pyramid.minSize) || 5;
    const cap = HR.pyramid.ruleCap();
    const prefs = settings();

    const people = HR.pyramid.population(model, model.vault, model.granted);
    const offered = HR.pyramid.availableAttributes(people);
    /* Which attributes take part: what the data offers, minus what describes
       individuals, minus what the user switched off. The list itself is kept so the
       view can show the switches. */
    const excluded = [];
    const ignored = [];
    const attributes = offered.filter(a => {
      const share = partition(people, [a], minSize, [], 0).counts.placedShare;
      if (share < DESCRIBES_BELOW) { excluded.push({ attr: a, placedShare: share }); return false; }
      if (prefs.ignore.includes(a)) { ignored.push(a); return false; }
      return true;
    });
    const required = prefs.require.filter(a => attributes.includes(a));
    if (!attributes.length) {
      return { unavailable: 'no-attributes', people, offered, attributes: [], candidates: [], excluded, ignored };
    }

    const byKey = new Map();
    const of = attrs => {
      const key = attrs.join(SEP);
      if (!byKey.has(key)) byKey.set(key, partition(people, attrs, minSize, attributes, cap));
      return byKey.get(key);
    };
    const candidates = subsets(attributes, MAX_ATTRS).map(attrs => {
      const c = of(attrs);
      if (attrs.length > 1) {
        /* The widest narrower candidate: drop one attribute at a time and keep the one
           with the most cells. Measured on all cells, not usable ones — nesting is a
           fact about the data, not about the minimum size. */
        let wider = null;
        attrs.forEach((_, i) => {
          const sub = of(attrs.filter((__, j) => j !== i));
          if (!wider || sub.counts.cells > wider.counts.cells) wider = sub;
        });
        c.counts.adds = c.counts.cells - wider.counts.cells;
        if (c.counts.adds <= wider.counts.cells * FOLLOWS_BELOW) c.follows = wider.attrs;
      }
      return c;
    });

    /* Highest score first; among equals, the more specific; a candidate that only
       follows a narrower one sorts below it. */
    candidates.sort((a, b) =>
      (a.follows ? 1 : 0) - (b.follows ? 1 : 0) ||
      b.counts.score - a.counts.score ||
      b.counts.usable - a.counts.usable);
    const suggestion = candidates[0].attrs;
    const stored = (prefs.levels || []).filter(a => attributes.includes(a));
    const levels = stored.length ? stored : suggestion;
    const chosen = candidates.find(c => c.attrs.join() === levels.join()) || of(levels);

    const cellsOf = a => of([a]).counts.cells;
    const set = rulesFor(people, levels, attributes, minSize, cap, prefs, cellsOf);
    const proposal = propose(people, pool(people, attributes, minSize, prefs.alikeFloor, cellsOf, required), minSize, cap);

    const result = {
      people, offered, attributes, excluded, ignored, required, candidates, suggestion, levels, chosen, minSize, cap,
      weights: Object.fromEntries(offered.map(a => [a, weightOf(a)])),
      alikeFloor: prefs.alikeFloor, ladder: prefs.ladder && levels.length > 1,
      rules: set.rules, ruleLevels: set.levels, proposal,
      summary: Object.assign({ people: people.length }, set.summary)
    };
    model._cohorts = result;
    return result;
  }

  /** What the smallest group costs: the chosen attributes at every size the sweep tries. */
  function sweep(model) {
    if (model._cohortsSweep) return model._cohortsSweep;
    const R = build(model);
    if (!R || R.unavailable) return [];
    const prefs = settings();
    const cellsOf = a => partition(R.people, [a], 1, [], 0).counts.cells;
    const rows = U.uniq(SWEEP_SIZES.concat([R.minSize])).sort((a, b) => a - b).map(minSize => {
      const set = minSize === R.minSize ? { summary: R.summary }
        : rulesFor(R.people, R.levels, R.attributes, minSize, R.cap, prefs, cellsOf);
      return Object.assign({ minSize, current: minSize === R.minSize }, set.summary);
    });
    model._cohortsSweep = rows;
    return rows;
  }

  /** HelloID business-rule CSV with the conditions filled in and nothing granted yet. */
  function toRulesCsv(model, R, set) {
    const condition = c => c.attr + (c.byId ? '.ExternalId' : '.Name') + ', one of: ' + c.values.join(', ');
    const name = c => c.labels.length > 1
      ? c.labels.slice(0, 3).join(' / ') + (c.labels.length > 3 ? '…' : '')
      : (c.labels[0] || c.values[0]);
    const proposal = !!set;
    const rows = (set || R.rules).slice().sort((a, b) => a.rank - b.rank).map(r => ({
      Name: HR.mine.ruleName('Rol', r.conds.map(name).join(' + ')),
      EntitlementCount: 0,
      PersonsLatestEvaluation: r.members.length,
      Categories: (proposal ? 'HR proposal|' + r.attrs.join(' + ') : 'HR cohort' + (R.ladder ? '|Level ' + r.level : '')) +
        (r.overCap ? '|Over rule cap' : ''),
      Status: 'proposal',
      Conditions: r.conds.map(condition).join('|'),
      Entitlements: ''
    }));
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  HR.cohorts = { build, sweep, toRulesCsv, alikeOf, weightOf, SWEEP_SIZES, CAP_SWEEP };
})(window.HR);
