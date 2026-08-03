/* Who has access like this person, and is that group anything?

   Every rule this tool mines claims a group of people should hold the same access. This
   asks the question from the other end: take one person, find whoever holds nearly the
   same entitlements, and look at what those people have in common. If they share a
   department or a job title, the access follows the organisation and a rule would be
   easy to write. If they are scattered across eight departments and six titles, the
   group is real but the organisation does not explain it — which is worth knowing before
   anybody writes a rule for it.

   The same comparison answers the personal question. Whatever the peer group nearly all
   holds and this person does not is what they are short of; whatever this person holds
   and almost none of them do is what they carry alone. Both are tunable, because how
   much agreement counts as "nearly all" is a judgement about the organisation.

   Similarity is Jaccard over entitlement sets, with an option to ignore what almost
   everybody has: a baseline shared by the whole organisation makes everyone look alike
   and hides the differences that matter. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const DEFAULTS = {
    minSimilarity: 0.5,     // below this they are not peers in any useful sense
    topN: 12,               // how many peers to consider
    consensus: 0.8,         // share of peers holding something before this person lacking it counts
    rare: 0.2,              // share of peers holding something below which this person carries it alone
    ignoreCommon: 0.9,      // entitlements this widely held add nothing to a comparison
    candidateCap: 400       // peers to score per person; the index keeps this well below it
  };

  const settings = () => Object.assign({}, DEFAULTS, HR.config.get().peers || {});

  /**
   * Everyone the miner can see access for, with their attributes.
   *
   * The pyramid already builds exactly this, so it is reused rather than rebuilt — the
   * two views should never disagree about who holds what.
   */
  function population(model) {
    if (!model.vault) return [];
    const people = HR.pyramid.population(model, model.vault, model.granted);
    return people.filter(p => p.ents.size > 0);
  }

  /**
   * Peers of one person, most similar first.
   *
   * Comparing everybody with everybody is quadratic and needless: two people with no
   * entitlement in common cannot be similar, so candidates come from the entitlements
   * this person actually holds.
   */
  function similar(people, person, opts) {
    const cfg = Object.assign({}, settings(), opts || {});

    /* What is so widely held that it says nothing about who you are. */
    const common = new Set();
    if (cfg.ignoreCommon < 1) {
      const tally = new Map();
      people.forEach(p => p.ents.forEach(e => tally.set(e, (tally.get(e) || 0) + 1)));
      tally.forEach((n, ent) => { if (n / people.length >= cfg.ignoreCommon) common.add(ent); });
    }
    const meaningful = set => {
      const out = new Set();
      set.forEach(e => { if (!common.has(e)) out.add(e); });
      return out;
    };

    const mine = meaningful(person.ents);
    if (!mine.size) return { peers: [], common, mine, cfg };

    /* Candidates: anybody sharing at least one entitlement that matters. */
    const byEnt = new Map();
    for (const other of people) {
      if (other === person) continue;
      for (const ent of other.ents) {
        if (common.has(ent) || !mine.has(ent)) continue;
        if (!byEnt.has(other)) byEnt.set(other, 0);
        byEnt.set(other, byEnt.get(other) + 1);
        break;
      }
    }

    const peers = [];
    for (const other of byEnt.keys()) {
      const theirs = meaningful(other.ents);
      let shared = 0;
      mine.forEach(e => { if (theirs.has(e)) shared++; });
      if (!shared) continue;
      const union = mine.size + theirs.size - shared;
      const similarity = union ? shared / union : 0;
      if (similarity < cfg.minSimilarity) continue;
      const onlyMine = [];
      const onlyTheirs = [];
      mine.forEach(e => { if (!theirs.has(e)) onlyMine.push(e); });
      theirs.forEach(e => { if (!mine.has(e)) onlyTheirs.push(e); });
      peers.push({ person: other, similarity, shared, onlyMine, onlyTheirs });
      if (peers.length > cfg.candidateCap) break;
    }
    peers.sort((a, b) => b.similarity - a.similarity);
    return { peers: peers.slice(0, cfg.topN), all: peers, common, mine, cfg };
  }

  /**
   * What the peer group has in common with itself, which is the sanity check.
   *
   * A group of people with matching access that also share a department is a rule
   * waiting to be written. The same group spread over eight departments is a pattern
   * nobody planned — still real, but it will not be expressible as a condition.
   */
  function cohesion(person, peers) {
    const facets = ['Department', 'Title', 'Location', 'ContractType', 'Employer', 'Manager'];
    const out = [];
    for (const attr of facets) {
      const mineValue = person.attrs[attr];
      const values = new Map();
      let matching = 0;
      for (const peer of peers) {
        const value = peer.person.labels[attr] || peer.person.attrs[attr];
        if (!value) continue;
        values.set(value, (values.get(value) || 0) + 1);
        if (mineValue && peer.person.attrs[attr] === mineValue) matching++;
      }
      if (!values.size) continue;
      out.push({
        attr,
        distinct: values.size,
        /* How many of the peers sit where this person sits. */
        matching,
        share: peers.length ? matching / peers.length : 0,
        top: Array.from(values.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      });
    }
    out.sort((a, b) => b.share - a.share);
    return out;
  }

  /**
   * What this person is short of, and what they carry alone.
   *
   * Both are relative to the peer group rather than to a rule, which is the point: it
   * needs no model, no vault attribute and no policy — only people who look like them.
   */
  function profile(person, peers, opts) {
    const cfg = Object.assign({}, settings(), opts || {});
    const tally = new Map();
    peers.forEach(peer => peer.person.ents.forEach(e => tally.set(e, (tally.get(e) || 0) + 1)));

    const under = [];
    const over = [];
    tally.forEach((n, ent) => {
      const share = peers.length ? n / peers.length : 0;
      if (share >= cfg.consensus && !person.ents.has(ent)) under.push({ ent, share, holders: n });
    });
    person.ents.forEach(ent => {
      const share = peers.length ? (tally.get(ent) || 0) / peers.length : 0;
      if (share <= cfg.rare) over.push({ ent, share, holders: tally.get(ent) || 0 });
    });
    under.sort((a, b) => b.share - a.share);
    over.sort((a, b) => a.share - b.share);
    return { under, over, peers: peers.length };
  }

  /**
   * Copying another person's access is the oldest bad habit in identity management, and
   * the reason is always the same: it copies the exceptions with the standard, so one
   * administrator's privileged group spreads through a department a hire at a time.
   *
   * The habit is not wrong because copying is wrong. It is wrong because nobody could
   * see what they were copying. With the peer group known, and with sensitivity and
   * price already attached to every entitlement, the same act splits into three:
   *
   *   standard  what nearly the whole peer group holds, carrying no risk flag and no
   *             licence cost — the part that is safe to grant on day one
   *   review    the peer group holds it, but it is privileged, sensitive or paid for;
   *             defensible to copy, never silently
   *   exclude   almost nobody in the group holds it, so it is somebody's exception and
   *             copying it is how exceptions become policy
   *
   * That is a defensible "copy user access", and it is the same list a joiner needs.
   */
  function copyPlan(model, peers, opts) {
    const cfg = Object.assign({}, settings(), opts || {});
    const tally = new Map();
    peers.forEach(peer => peer.person.ents.forEach(e => tally.set(e, (tally.get(e) || 0) + 1)));

    const standard = [];
    const review = [];
    const exclude = [];
    tally.forEach((holders, ent) => {
      const share = peers.length ? holders / peers.length : 0;
      const perm = model.permissions.get(ent);
      const price = perm ? (perm.monthlyPrice || 0) : 0;
      const sensitivity = perm ? (perm.sensitivity || 1) : 1;
      const reasons = [];
      if (price > 0) reasons.push('cost');
      if (sensitivity >= 1.6) reasons.push('sensitive');
      const row = { ent, perm, share, holders, price, sensitivity, reasons };

      if (share < cfg.consensus) exclude.push(row);
      else if (reasons.length) review.push(row);
      else standard.push(row);
    });

    const bySpread = (a, b) => b.share - a.share;
    standard.sort(bySpread);
    review.sort((a, b) => b.sensitivity - a.sensitivity || b.price - a.price);
    exclude.sort(bySpread);

    return {
      standard, review, exclude,
      summary: {
        standard: standard.length,
        review: review.length,
        exclude: exclude.length,
        monthlyStandard: U.sum(standard, r => r.price),
        monthlyReview: U.sum(review, r => r.price),
        /* What copying the whole person would have cost and carried. */
        monthlyIfCopiedWhole: U.sum(standard.concat(review, exclude), r => r.price),
        sensitiveIfCopiedWhole: standard.concat(review, exclude).filter(r => r.sensitivity >= 1.6).length
      }
    };
  }

  /** Everything about one person's neighbourhood, in one call. */
  function forPerson(model, person, opts) {
    const people = population(model);
    const target = people.find(p => p.person === person || p.person.personId === person.personId);
    if (!target) return null;
    const found = similar(people, target, opts);
    return {
      person: target,
      peers: found.peers,
      cohesion: cohesion(target, found.peers),
      profile: profile(target, found.peers, opts),
      copy: copyPlan(model, found.peers, opts),
      cfg: found.cfg,
      population: people.length
    };
  }

  HR.peers = { forPerson, similar, cohesion, profile, copyPlan, population, DEFAULTS };
})(window.HR);
