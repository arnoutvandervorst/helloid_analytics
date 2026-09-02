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
     alike        how much more the members of a cohort resemble each other, on the
                  attributes the cohort does not fix, than everybody does: 0 for a rule
                  for everyone, 1 for a cohort that agrees on everything else. Measured
                  as lift over the population, so an attribute nobody shares anywhere
                  (a cost centre per person) neither helps nor drags.
     score        placed × alike — as specific as the data allows while the cohorts
                  stay large enough to defend and few enough to fit

   Rule count is not a cost. More cohorts is more specific; the only limit is the cap,
   and it enters the score only through the people the cohorts past it cannot place.

     follows      a candidate whose extra attribute barely splits a narrower one: a team
                  nested inside its department adds a condition and no information

   An attribute that cannot group even half the people at the minimum size — a cost
   centre per person — describes individuals, not roles. It is left out of the
   candidates and out of the alikeness measure, and the view says so.

   The cohorts of the chosen attributes are the candidate roles: a condition list and
   the people it selects, in the same shape the pyramid's condensed rules use, so the
   day access is loaded the two can be matched on identity. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '';

  /* A candidate whose cells add fewer than this share on top of its widest narrower
     candidate is that candidate wearing an extra condition. */
  const FOLLOWS_BELOW = 0.1;
  /* Up to this many attributes per candidate. */
  const MAX_ATTRS = 3;
  /* An attribute whose own cohorts place fewer people than this describes individuals. */
  const DESCRIBES_BELOW = 0.5;

  /** Share of `members` holding the most common value of `attr` (missing is a value). */
  function purity(members, attr) {
    const tally = new Map();
    for (const p of members) { const v = p.attrs[attr] || ''; tally.set(v, (tally.get(v) || 0) + 1); }
    let top = 0;
    tally.forEach(n => { if (n > top) top = n; });
    return members.length ? top / members.length : 0;
  }

  /** Partition people by the values of `attrs`; a person missing any value is unplaced. */
  function partition(people, attrs, minSize, others, base, cap) {
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

    /* Alike: lift of each other attribute's purity over its purity across everybody,
       averaged per cohort, then weighted by members over the placed people. */
    const rest = others.filter(a => !attrs.includes(a) && base.get(a) < 1);
    for (const c of usable) {
      c.alike = rest.length
        ? U.sum(rest, a => Math.max(0, (purity(c.members, a) - base.get(a)) / (1 - base.get(a)))) / rest.length
        : 1;
    }
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

  function build(model, opts) {
    if (model._cohorts && !(opts && opts.force)) return model._cohorts;
    if (!model.vault) return null;
    const cfg = HR.config.get();
    const minSize = (cfg.pyramid && cfg.pyramid.minSize) || 5;
    const cap = HR.pyramid.ruleCap();

    const people = HR.pyramid.population(model, model.vault, model.granted);
    const offered = HR.pyramid.availableAttributes(people);
    const base = new Map(offered.map(a => [a, purity(people, a)]));
    const excluded = [];
    const attributes = offered.filter(a => {
      const share = partition(people, [a], minSize, [], base, 0).counts.placedShare;
      if (share >= DESCRIBES_BELOW) return true;
      excluded.push({ attr: a, placedShare: share });
      return false;
    });
    if (!attributes.length) return { unavailable: 'no-attributes', people, attributes: [], candidates: [], excluded };

    const byKey = new Map();
    const of = attrs => {
      const key = attrs.join(SEP);
      if (!byKey.has(key)) byKey.set(key, partition(people, attrs, minSize, attributes, base, cap));
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
    const stored = (cfg.cohorts && cfg.cohorts.levels || []).filter(a => attributes.includes(a));
    const levels = stored.length ? stored : suggestion;
    const chosen = candidates.find(c => c.attrs.join() === levels.join()) || of(levels);

    const cohorts = chosen.usable.map(c => ({
      conds: c.conds, members: c.members, alike: c.alike, rank: c.rank,
      overCap: cap > 0 && c.rank > cap,
      share: people.length ? c.members.length / people.length : 0
    }));

    const result = {
      people, attributes, excluded, candidates, suggestion, levels, chosen, cohorts, minSize, cap,
      summary: {
        people: people.length,
        cohorts: cohorts.length,
        placed: chosen.counts.placed,
        placedShare: chosen.counts.placedShare,
        leftover: chosen.counts.leftover,
        alike: chosen.counts.alike,
        overCap: chosen.counts.overCap
      }
    };
    model._cohorts = result;
    return result;
  }

  /** HelloID business-rule CSV with the conditions filled in and nothing granted yet. */
  function toRulesCsv(model, cohorts) {
    const condition = c => c.attr + (c.byId ? '.ExternalId' : '.Name') + ', one of: ' + c.value;
    const rows = cohorts.cohorts.map(r => ({
      Name: HR.mine.ruleName('Rol', r.conds.map(c => c.label || c.value).join(' / ')),
      EntitlementCount: 0,
      PersonsLatestEvaluation: r.members.length,
      Categories: 'HR cohort',
      Status: 'proposal',
      Conditions: r.conds.map(condition).join('|'),
      Entitlements: ''
    }));
    return U.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation', 'Categories',
      'Status', 'Conditions', 'Entitlements']);
  }

  HR.cohorts = { build, toRulesCsv };
})(window.HR);
