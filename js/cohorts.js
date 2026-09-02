/* Roles from HR alone.

   The pyramid needs to see access: its levels are chosen by how much of the granted
   entitlements they explain. With only a vault loaded there is nothing to explain yet —
   but the condition half of a business rule needs no access at all. Which departments,
   titles and locations exist, and how they combine, is already in the contracts, and a
   consultant can draft the rule skeleton from that before a single target system is
   connected. Entitlements attach later, on aggregate, once the reconciliation arrives.

   So this asks a different question of the same attributes: not "which order explains
   access" but "which attribute, or pair of attributes, cuts the population into cohorts
   large enough to defend as a rule". Every single attribute and every pair is scored on
   the same few numbers, all shown, so the ranking is something a reader can argue with:

     placed       people who land in a cohort of at least the minimum size
     distinct     how many roles the cohorts really tell apart: four cohorts of equal
                  size count as four, one big one with three tails as barely more than
                  one. Placed × distinct is the score — fine-grained, but defendable.
     cohorts      how many rules that takes — the 100-rule cap is never far away
     left over    people in cohorts too small to carry a rule, or missing the attribute
     follows      a pair whose second attribute barely splits the first: a team that is
                  nested inside its department adds a condition and no information

   The cohorts of the chosen attributes are the candidate roles: a condition list and
   the people it selects, in the same shape the pyramid's condensed rules use, so the
   day access is loaded the two can be matched on identity. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '';

  /* A pair whose cells add fewer than this share on top of the better single attribute
     is that attribute wearing a second condition. */
  const FOLLOWS_BELOW = 0.1;
  /* "Rules for 80%": how many of the largest cohorts it takes to place this share. */
  const ECONOMY_SHARE = 0.8;

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
    const usable = all.filter(c => c.members.length >= minSize);
    const placed = U.sum(usable, c => c.members.length);
    const sizes = usable.map(c => c.members.length);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    /* People-weighted count of cohorts (exp of the entropy over the placed people). */
    let h = 0;
    for (const n of sizes) { const q = n / placed; h -= q * Math.log(q); }
    const distinct = placed ? Math.exp(h) : 0;
    const placedShare = people.length ? placed / people.length : 0;
    let running = 0, rulesFor80 = 0;
    for (const c of all) {
      if (running >= people.length * ECONOMY_SHARE) break;
      running += c.members.length; rulesFor80++;
    }
    return {
      attrs, cells: all, usable,
      counts: { cells: all.length, usable: usable.length, placed, unplaced, placedShare,
        leftover: people.length - placed, median, rulesFor80, distinct,
        score: placedShare * distinct }
    };
  }

  function build(model, opts) {
    if (model._cohorts && !(opts && opts.force)) return model._cohorts;
    if (!model.vault) return null;
    const cfg = HR.config.get();
    const minSize = (cfg.pyramid && cfg.pyramid.minSize) || 5;

    const people = HR.pyramid.population(model, model.vault, model.granted);
    const attributes = HR.pyramid.availableAttributes(people);
    if (!attributes.length) return { unavailable: 'no-attributes', people, attributes: [], candidates: [] };

    const singles = new Map(attributes.map(a => [a, partition(people, [a], minSize)]));
    const candidates = Array.from(singles.values());
    for (let i = 0; i < attributes.length; i++) {
      for (let j = i + 1; j < attributes.length; j++) {
        const pair = partition(people, [attributes[i], attributes[j]], minSize);
        /* Which parent the pair follows, if either: the one whose cell count it barely
           exceeds. Measured on all cells, not usable ones — nesting is a fact about the
           data, not about the minimum size. */
        const parents = [attributes[i], attributes[j]].map(a => singles.get(a));
        const wider = parents[0].counts.cells >= parents[1].counts.cells ? parents[0] : parents[1];
        const adds = pair.counts.cells - wider.counts.cells;
        pair.counts.adds = adds;
        if (adds <= wider.counts.cells * FOLLOWS_BELOW) pair.follows = wider.attrs[0];
        candidates.push(pair);
      }
    }

    /* Highest score first; among equals, fewer rules; a pair that only follows its
       parent sorts below that parent. */
    candidates.sort((a, b) =>
      (a.follows ? 1 : 0) - (b.follows ? 1 : 0) ||
      b.counts.score - a.counts.score ||
      a.counts.usable - b.counts.usable);
    const suggestion = candidates[0].attrs;
    const stored = (cfg.cohorts && cfg.cohorts.levels || []).filter(a => attributes.includes(a));
    const levels = stored.length ? stored : suggestion;
    const chosen = candidates.find(c => c.attrs.join() === levels.join()) || partition(people, levels, minSize);

    const cohorts = chosen.usable.map(c => ({
      conds: c.conds, members: c.members,
      share: people.length ? c.members.length / people.length : 0
    }));

    const result = {
      people, attributes, candidates, suggestion, levels, chosen, cohorts, minSize,
      summary: {
        people: people.length,
        cohorts: cohorts.length,
        placed: chosen.counts.placed,
        placedShare: chosen.counts.placedShare,
        leftover: chosen.counts.leftover,
        rulesFor80: chosen.counts.rulesFor80
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
