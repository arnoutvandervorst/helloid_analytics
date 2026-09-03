/* Do the imports belong together?

   Every slot takes any file, so a vault from one customer and a reconciliation from
   another build a model without complaint — and every number downstream is quietly
   wrong. Nothing in the files says which tenant they came from, but the sources
   overlap in ways that are high when they do belong together and near zero when they
   do not: the vault's people hold the reconciliation's accounts, the rules' departments
   exist in the vault, the granted export's people are vault people. This measures
   those overlaps per pair of loaded sources and names the pairs that fail.

   Judged only when both sides have enough to judge; a pair with a handful of items on
   one side reads "too few to tell" rather than a verdict. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const MIN_ITEMS = 20;
  const OK = 0.5, WEAK = 0.15;

  const level = (share, aSize, bSize, min) =>
    Math.min(aSize, bSize) < (min || MIN_ITEMS) ? 'small' : share >= OK ? 'ok' : share >= WEAK ? 'weak' : 'mismatch';
  const norm = s => String(s || '').trim().toLowerCase();
  /* "Jane Doe (123456)" → name and id; a bare name or a bare id also works. */
  const personBits = raw => {
    const m = String(raw || '').match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    return m ? { name: m[1].trim(), id: m[2].trim() } : { name: String(raw || '').trim(), id: '' };
  };
  /* Account names compare on the local part: jdoe, jdoe@corp.local and CORP\jdoe are one. */
  const localOf = s => norm(s).replace(/^.*\\/, '').replace(/@.*$/, '');

  function pair(key, aSize, bSize, matched, of, unmatched, min) {
    const share = of ? matched / of : 0;
    return { key, a: key.split('-')[0], b: key.split('-')[1], aSize, bSize, matched, of, share,
      level: level(share, aSize, bSize, min), sample: (unmatched || []).slice(0, 3) };
  }

  /** Share of `items` (strings) found in `has(item)`, with a sample of the misses. */
  function overlap(key, items, has, aSize, bSize, min) {
    const misses = [];
    let matched = 0;
    items.forEach((it, i) => { if (has(it, i)) matched++; else if (misses.length < 3) misses.push(it); });
    return pair(key, aSize, bSize, matched, items.length, misses, min);
  }
  /* A rule set conditions on a handful of values and grants a few dozen entitlements;
     that is enough to judge. */
  const MIN_RULE_ITEMS = 8;

  function vaultPeopleIndex(vault) {
    const names = new Set(), ids = new Set();
    for (const p of vault.persons) { names.add(norm(p.displayName)); if (p.externalId) ids.add(norm(p.externalId)); }
    return raw => { const b = personBits(raw); return ids.has(norm(b.id)) || names.has(norm(b.name)); };
  }

  /* The vault's values per facet, keyed the way a rule condition names them. */
  function vaultFacets(vault) {
    const sets = new Map();
    const put = (facet, v) => { if (!v) return; if (!sets.has(facet)) sets.set(facet, new Set()); sets.get(facet).add(norm(v)); };
    const refs = { Department: 'department', Title: 'title', Location: 'location', CostCenter: 'costCenter',
      Employer: 'employer', Team: 'team', Division: 'division', Type: 'type', ContractType: 'type' };
    for (const p of vault.persons) for (const c of p.contracts || []) {
      for (const facet in refs) {
        const o = c[refs[facet]];
        if (!o) continue;
        put(facet + '.ExternalId', o.externalId || o.code);
        put(facet + '.Name', o.name);
        put(facet + '.Code', o.code);
      }
    }
    return sets;
  }

  function check(state, model) {
    const pairs = [];
    const vault = state.vault;
    const recon = model && model.hasRecon ? model : null;

    if (recon && vault) {
      const index = HR.correlate.personAccountIndex(model, vault, model.correlation);
      const with_ = vault.persons.filter(p => { const e = index.get(p.personId); return e && e.accounts.length; }).length;
      const of = Math.min(vault.persons.length, model.persons.size);
      pairs.push(pair('recon-vault', model.persons.size, vault.persons.length, Math.min(with_, of), of, []));
    }
    for (const kind of ['granted', 'history']) {
      const src = state[kind];
      if (src && vault && src.byPerson && src.byPerson.size) {
        const people = Array.from(src.byPerson.keys());
        pairs.push(overlap(kind + '-vault', people, vaultPeopleIndex(vault), people.length, vault.persons.length));
      }
    }
    if (state.granted && recon && state.granted.byEntitlement && state.granted.byEntitlement.size) {
      const ents = Array.from(state.granted.byEntitlement.values()).map(rows => rows[0]);
      const have = new Set(model.permissionList.map(p => norm(HR.model.permissionKey(p.system, p.name))));
      pairs.push(overlap('granted-recon', ents.map(r => r.system + ' - ' + r.entitlement),
        (_, i) => have.has(norm(HR.model.permissionKey(ents[i].system, ents[i].entitlement))),
        ents.length, model.permissionList.length));
    }
    if (state.ruleSet && vault) {
      const facets = vaultFacets(vault);
      const values = [];
      state.ruleSet.rules.forEach(r => r.conditions.forEach(c => {
        if (!facets.has(c.facet)) return;
        c.values.forEach(v => values.push({ facet: c.facet, v, label: c.facet + ': ' + v }));
      }));
      pairs.push(overlap('rules-vault', values.map(x => x.label),
        (_, i) => facets.get(values[i].facet).has(norm(values[i].v)), values.length, vault.persons.length, MIN_RULE_ITEMS));
    }
    if (state.ruleSet && recon) {
      const ents = [];
      state.ruleSet.rules.forEach(r => r.entitlements.forEach(e => { if (e.name && !e.isAccount) ents.push(e); }));
      const have = new Set(model.permissionList.map(p => norm(p.system) + '|' + norm(p.name)));
      const haveName = new Set(model.permissionList.map(p => norm(p.name)));
      pairs.push(overlap('rules-recon', ents.map(e => e.system + ' - ' + e.name),
        (_, i) => have.has(norm(ents[i].system) + '|' + norm(ents[i].name)) || haveName.has(norm(ents[i].name)),
        ents.length, model.permissionList.length, MIN_RULE_ITEMS));
    }
    if (state.directory && recon && state.directory.users) {
      const accounts = new Set(model.accountList.map(a => localOf(a.userName)));
      const users = state.directory.users.map(u => u.userName);
      pairs.push(overlap('directory-recon', users, u => accounts.has(localOf(u)), users.length, model.accountList.length));
    }
    if (state.assignments && recon && state.assignments.rows) {
      const accounts = new Set(model.accountList.map(a => localOf(a.userName)));
      const users = U.uniq(state.assignments.rows.map(r => r.userName).filter(Boolean));
      if (users.length) pairs.push(overlap('assignments-recon', users, u => accounts.has(localOf(u)), users.length, model.accountList.length));
    }

    if (state.audit && state.audit.provisioning.length) {
      const people = U.uniq(state.audit.provisioning.map(r => r.personDisplayName).filter(Boolean));
      if (vault && people.length) pairs.push(overlap('audit-vault', people, vaultPeopleIndex(vault), people.length, vault.persons.length));
      if (recon && people.length) {
        /* Recon persons are keyed by their raw "Name (id)" string, the same form the audit log uses. */
        const names = new Set(Array.from(model.persons.keys()).map(norm));
        const ids = new Set(Array.from(model.persons.keys()).map(k => norm(personBits(k).id)).filter(Boolean));
        pairs.push(overlap('audit-recon', people, raw => { const b = personBits(raw); return ids.has(norm(b.id)) || names.has(norm(raw)) || names.has(norm(b.name)); },
          people.length, model.persons.size));
      }
    }

    const order = { mismatch: 0, weak: 1, ok: 2, small: 3 };
    const judged = pairs.filter(p => p.level !== 'small');
    const worst = judged.length ? judged.reduce((w, p) => order[p.level] < order[w] ? p.level : w, 'ok') : null;
    return { pairs, worst, mismatches: pairs.filter(p => p.level === 'mismatch') };
  }

  HR.fit = { check, personBits, localOf };
})(window.HR);
