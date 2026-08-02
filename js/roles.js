/* Candidate-role mining: turns the unmodelled backlog into proposed business rules.

   The backlog says *which* groups no rule describes. It does not say how to describe
   them, and writing one rule per group would be the wrong answer — access travels in
   bundles. This finds the bundles: sets of groups that the same accounts hold together,
   often enough that a single rule would cover them all.

   Method is frequent-itemset mining (apriori, level-wise with pruning). Two things
   matter for the result to be useful rather than merely true:

     - Rank on cohesion, not frequency. The most frequent bundles are the groups
       everyone has (mailbox, printer, MFA); they are already a "rule" in the trivial
       sense and say nothing about roles. Cohesion — how often the rarest member of a
       bundle drags the rest along — is what identifies a real cluster.
     - Keep maximal bundles. Every subset of a frequent bundle is itself frequent, so
       without this the list is the same role repeated at every size.

   What this cannot infer is the *condition*: which department or title should receive
   the bundle. That lives in HR data neither export carries, so a proposal names the
   entitlements and leaves the scope for a human. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const DEFAULTS = {
    minSupport: 4,          // accounts that must share a bundle
    maxShare: 0.60,         // groups held by more than this share are population-wide
    minBundle: 2,           // smallest bundle worth proposing
    maxBundle: 8,
    maxCandidatesPerLevel: 4000,
    sampleAbove: 5000,      // mine a sample past this many accounts; the signal is statistical
    supportFloorShare: 0.005,
    maxProposals: 40,
    maxPerFamily: 2      // the same unit described twice is enough
  };

  /**
   * @param {Object} model built model; uses model.comparison when a rule export is loaded
   * @param {Object} [opts]
   * @returns {{proposals:Array, stats:Object}}
   */
  function mine(model, opts) {
    /* Mining is the most expensive thing in the app and its result only changes when the
       model does, so it is computed once and kept on the model. */
    if (!opts && model._roles) return model._roles;
    const o = Object.assign({}, DEFAULTS, opts || {});
    const all = model.accountList.filter(a => a.permCount >= o.minBundle);

    /* Past a few thousand accounts the pairwise work grows faster than the insight does.
       A stride sample keeps the bundles that matter and the interface responsive; the
       sample is reported so nobody reads the counts as a census. */
    const sampled = all.length > o.sampleAbove;
    const stride = sampled ? Math.ceil(all.length / o.sampleAbove) : 1;
    const accounts = sampled ? all.filter((_, i) => i % stride === 0) : all;
    const N = accounts.length;
    /* A bundle shared by four accounts means something in a population of 400 and
       nothing in a population of 40,000. */
    o.minSupport = Math.max(o.minSupport, Math.round(all.length * o.supportFloorShare));
    if (N < o.minSupport) return { proposals: [], stats: { accounts: N, skipped: 'too few accounts' } };

    /* Only mine what no rule already describes: proposing a rule for covered access
       would be noise. Without a rule export, everything is fair game. */
    const covered = new Set();
    if (model.comparison) {
      model.comparison.permissionRows
        .filter(r => r.state !== 'unmodelled')
        .forEach(r => covered.add(r.perm.key));
    }

    const eligible = new Set();
    for (const p of model.permissionList) {
      if (covered.has(p.key)) continue;
      if (p.holderCount < o.minSupport) continue;
      if (p.holderCount / N > o.maxShare) continue;   // held by nearly everyone: no signal
      eligible.add(p.key);
    }

    const sets = accounts
      .map(a => ({ account: a, items: Array.from(a.permKeys).filter(k => eligible.has(k)).sort() }))
      .filter(s => s.items.length >= o.minBundle);
    if (!sets.length) return { proposals: [], stats: { accounts: N, eligible: eligible.size, skipped: 'no eligible groups' } };

    const support = new Map();                        // bundle key -> [accountIdx]
    const keyOf = arr => arr.join('');

    /* level 1 */
    let level = new Map();
    sets.forEach((s, i) => s.items.forEach(item => {
      if (!level.has(item)) level.set(item, []);
      level.get(item).push(i);
    }));
    for (const [k, v] of level) if (v.length < o.minSupport) level.delete(k);
    level.forEach((v, k) => support.set(k, v));

    const levels = [new Map(level)];
    for (let size = 2; size <= o.maxBundle; size++) {
      const prev = Array.from(levels[levels.length - 1].keys()).map(k => k.split(''));
      if (prev.length < 2) break;
      const next = new Map();
      let generated = 0;
      for (let i = 0; i < prev.length && generated < o.maxCandidatesPerLevel; i++) {
        for (let j = i + 1; j < prev.length && generated < o.maxCandidatesPerLevel; j++) {
          /* join step: two (k-1)-sets sharing their first k-2 items */
          const a = prev[i], b = prev[j];
          let shared = true;
          for (let x = 0; x < size - 2; x++) if (a[x] !== b[x]) { shared = false; break; }
          if (!shared) continue;
          const merged = a.concat(b[size - 2]).sort();
          const key = keyOf(merged);
          if (next.has(key)) continue;
          generated++;
          const rowsA = support.get(keyOf(a)) || [];
          const rowsB = support.get(keyOf(b)) || [];
          const setB = new Set(rowsB);
          const rows = rowsA.filter(r => setB.has(r));
          if (rows.length >= o.minSupport) { next.set(key, rows); support.set(key, rows); }
        }
      }
      if (!next.size) break;
      levels.push(next);
    }

    /* ---- keep maximal bundles only ---- */
    const bundles = [];
    levels.forEach((lvl, idx) => {
      if (idx + 1 < o.minBundle) return;
      lvl.forEach((rows, key) => bundles.push({ key, items: key.split(''), rows }));
    });
    /* Every subset of a frequent bundle is frequent, so the raw list repeats each role
       at every size. Keep the largest form, and a smaller one only when it reaches a
       materially wider population — "16 share four groups, 24 share two of them". */
    bundles.sort((x, y) => y.items.length - x.items.length || y.rows.length - x.rows.length);
    const kept = [];
    for (const cand of bundles) {
      cand.itemSet = new Set(cand.items);
      /* Compare against the *widest* bundle this overlaps, not the first one found:
         measuring against a narrow relative would let every subset through. */
      let widest = 0;
      for (const k of kept) {
        const shared = cand.items.filter(i => k.itemSet.has(i)).length;
        if (shared / cand.items.length >= 0.8) widest = Math.max(widest, k.rows.length);
      }
      if (widest && cand.rows.length < widest * 1.5) continue;
      kept.push(cand);
    }

    /* ---- score and describe ---- */
    const proposals = kept.map(b => {
      const perms = b.items.map(k => model.permissions.get(k)).filter(Boolean);
      const minHolders = Math.min.apply(null, perms.map(p => p.holderCount));
      const cohesion = minHolders ? b.rows.length / minHolders : 0;
      const members = b.rows.map(i => sets[i].account);
      const assignments = b.rows.length * perms.length;

      /* Accounts holding most of the bundle but not all: the exceptions a rule would
         either absorb or expose. */
      const nearMiss = [];
      for (const s of sets) {
        const have = b.items.filter(i => s.account.permKeys.has(i)).length;
        if (have === perms.length - 1 && perms.length >= 3) nearMiss.push(s.account);
      }

      /* Group names usually carry the unit they belong to; the shared token is the
         best name we can honestly propose. */
      const PREFIX = /^(APP|FS|TEAM|MBX|ROLE|ROL|LIC|SEC|PRINT|WIFI|VPN|SRV|DB|LOG|ADMIN|PRIV)$/;
      const tokenCounts = U.counts(perms
        .flatMap(p => U.uniq(p.name.split(/[-_.]/).filter(t => t.length > 1).map(t => t.toUpperCase())))
        .filter(t => !PREFIX.test(t)));
      /* The token most of the bundle shares names it better than one they all share:
         a bundle spanning two units still belongs to the unit that dominates it. */
      const ranked = Array.from(tokenCounts.entries())
        .filter(([, n]) => n >= Math.ceil(perms.length / 2))
        .sort((a, b2) => b2[1] - a[1] || b2[0].length - a[0].length);
      const sharedToken = ranked.length ? ranked[0][0] : '';

      return {
        perms, members, nearMiss,
        support: b.rows.length,
        cohesion,
        assignments,
        monthlyCost: U.sum(perms, p => (p.monthlyPrice || 0)) * b.rows.length,
        maxSensitivity: perms.reduce((m, p) => Math.max(m, p.sensitivity), 0),
        suggestedName: sharedToken || perms[0].name.split(/[-_.]/).slice(0, 2).join('-'),
        systems: U.uniq(perms.map(p => p.system)),
        /* Ranking: how much drift this converts, weighted by how tight the bundle is. */
        score: b.rows.length * perms.length * Math.pow(cohesion, 2)
      };
    })
      .filter(p => p.perms.length >= o.minBundle && p.cohesion >= 0.5)
      .sort((a, b) => b.score - a.score);

    /* Bundles that differ by one group still describe the same role. Overlap alone does
       not catch them — three of four shared reads as distinct — so cap each family by
       the unit its names point at, and keep the strongest forms. */
    const perFamily = new Map();
    const deduped = proposals.filter(p => {
      const family = p.suggestedName || '—';
      const n = (perFamily.get(family) || 0) + 1;
      perFamily.set(family, n);
      return n <= o.maxPerFamily;
    }).slice(0, o.maxProposals);

    const coveredAssignments = U.sum(deduped, p => p.assignments);
    const result = {
      proposals: deduped,
      stats: {
        accounts: N,
        population: all.length,
        sampled: sampled,
        eligibleGroups: eligible.size,
        bundlesFound: kept.length,
        proposals: deduped.length,
        assignmentsCovered: coveredAssignments,
        minSupport: o.minSupport
      }
    };
    if (!opts) model._roles = result;
    return result;
  }

  /** Proposals in the shape of a HelloID rule export, so they can be reviewed side by side. */
  function toRulesCsv(proposals, systemFallback) {
    const rows = proposals.map(p => ({
      Name: 'Voorstel - ' + p.suggestedName,
      EntitlementCount: p.perms.length,
      PersonsLatestEvaluation: 0,
      Categories: '',
      Status: 'proposal',
      /* Left blank on purpose: the condition needs person data this export lacks. */
      Conditions: '',
      Entitlements: p.perms
        .map(x => (x.system || systemFallback) + ' - ' + x.name + (x.path ? ' (' + x.path + ')' : ''))
        .join('|')
    }));
    return HR.util.toCSV(rows, ['Name', 'EntitlementCount', 'PersonsLatestEvaluation',
      'Categories', 'Status', 'Conditions', 'Entitlements']);
  }

  HR.roles = { mine, toRulesCsv, DEFAULTS };
})(window.HR);
