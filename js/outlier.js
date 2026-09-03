/* Identity outliers: how far one person's access is from anyone else's.

   Account risk answers "how dangerous is this account". This answers the question an
   access review asks first: does this person's access look like anybody's? Three
   things make it not, and each is scored 0–100 so the answer explains itself:

     peer distance    how little the person shares with their closest peer — the peer
                      search reuses the peer engine's Jaccard over entitlement sets
     standalone       the share of their entitlements no rule, product or baseline
                      hands out: access that arrived by hand and lives outside the model
     rare             the share of their entitlements held by fewer than one in a hundred
                      people (at least three), which nobody around them can vouch for

   The outlier score is the weighted mean (40 / 35 / 25). It is the same idea SailPoint
   sells as an outlier score, computed here from the reconciliation and the vault. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const WEIGHTS = { peer: 0.4, standalone: 0.35, rare: 0.25 };
  const HIGH = 70;

  /**
   * Everyone with access, scored. Cached on the model with the rest of the mining.
   * The peer search runs once over an inverted index rather than once per person
   * through the peer engine's per-call setup.
   */
  function build(model) {
    if (model._outliers) return model._outliers;
    const people = HR.peers ? HR.peers.population(model) : [];
    const out = { rows: [], byPerson: new Map(), summary: { people: people.length, high: 0, mean: 0 } };
    if (!people.length) { model._outliers = out; return out; }

    const cfg = Object.assign({}, HR.peers.DEFAULTS, HR.config.get().peers || {});
    /* What almost everybody holds says nothing about anybody. */
    const tally = new Map();
    people.forEach(p => p.ents.forEach(e => tally.set(e, (tally.get(e) || 0) + 1)));
    const common = new Set();
    tally.forEach((n, e) => { if (n / people.length >= cfg.ignoreCommon) common.add(e); });
    const rareBelow = Math.max(3, Math.ceil(people.length * 0.01));
    const rare = new Set();
    tally.forEach((n, e) => { if (n < rareBelow) rare.add(e); });

    /* Entitlement → people holding it, for the candidate search. */
    const holders = new Map();
    people.forEach(p => p.ents.forEach(e => { if (common.has(e)) return; if (!holders.has(e)) holders.set(e, []); holders.get(e).push(p); }));
    const meaningful = p => { const s = new Set(); p.ents.forEach(e => { if (!common.has(e)) s.add(e); }); return s; };
    const sets = new Map(people.map(p => [p, meaningful(p)]));

    /* Where each entitlement comes from, so "standalone" means what the reviewer means. */
    const explained = explainedIndex(model);

    for (const p of people) {
      const mine = sets.get(p);
      let best = 0, bestPeer = null;
      if (mine.size) {
        const seen = new Set();
        let scanned = 0;
        for (const e of mine) {
          for (const other of holders.get(e) || []) {
            if (other === p || seen.has(other)) continue;
            seen.add(other);
            if (++scanned > cfg.candidateCap) break;
            const theirs = sets.get(other);
            let shared = 0;
            mine.forEach(x => { if (theirs.has(x)) shared++; });
            const sim = shared / (mine.size + theirs.size - shared);
            if (sim > best) { best = sim; bestPeer = other; }
          }
          if (scanned > cfg.candidateCap) break;
        }
      }
      const ents = Array.from(p.ents);
      const standalone = ents.filter(e => !explained(p, e));
      const rareHeld = ents.filter(e => rare.has(e));
      const factors = {
        peer: { value: Math.round(100 * (1 - best)), peer: bestPeer, similarity: best },
        standalone: { value: ents.length ? Math.round(100 * standalone.length / ents.length) : 0, ents: standalone },
        rare: { value: ents.length ? Math.round(100 * rareHeld.length / ents.length) : 0, ents: rareHeld }
      };
      const score = Math.round(WEIGHTS.peer * factors.peer.value + WEIGHTS.standalone * factors.standalone.value + WEIGHTS.rare * factors.rare.value);
      const row = { person: p.person, people: p, score, factors, entitlements: ents.length };
      out.rows.push(row);
      out.byPerson.set(p.person.personId, row);
    }
    out.rows.sort((a, b) => b.score - a.score);
    out.summary.high = out.rows.filter(r => r.score >= HIGH).length;
    out.summary.mean = out.rows.length ? Math.round(U.sum(out.rows, r => r.score) / out.rows.length) : 0;
    model._outliers = out;
    return out;
  }

  /** (personRow, permKey) → whether a rule, a product or the baseline hands it out. */
  function explainedIndex(model) {
    const expected = new Map();
    if (model.provisioning) {
      model.provisioning.rows.forEach(row => {
        const s = new Set();
        (row.expected || []).forEach(x => { if (x.perm) s.add(x.perm.key); });
        expected.set(row.person.personId, s);
      });
    }
    let baseline = new Set();
    try {
      const py = HR.pyramid.build(model);
      if (py && py.baseline) py.baseline.grants.forEach(g => baseline.add(g.ent));
    } catch (e) { /* mining optional */ }
    return (p, key) => {
      if (baseline.has(key)) return true;
      const exp = expected.get(p.person.personId);
      if (exp && exp.has(key)) return true;
      if (model.productMapping) {
        for (const a of p.accounts || []) { if (a.personRaw && model.productMapping.lookup(a.personRaw, key)) return true; }
      }
      return false;
    };
  }

  HR.outlier = { build, WEIGHTS, HIGH };
})(window.HR);
