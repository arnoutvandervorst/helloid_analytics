/* The classic role model, ported from the helloid_old_role_model report.

   Attribute roles (Everyone / Department / Job title / Department+Job title)
   over the correlated population, each listing the permissions its members
   hold with RELEVANCE (share of the role holding it) and LIFT (relevance
   against the org-wide baseline — a 90% relevance means little for a group
   90% of the whole organisation holds), plus the two exception lists per
   permission: who is in the role but misses it, and who holds it from outside
   the role. De-facto clusters find account populations whose access groups
   together regardless of HR attributes; a cluster whose members do not share
   a dominant department/title is DISCOVERED — access the org chart does not
   predict.

   Sources here instead of the old tool's raw exports: vault persons and
   contracts, the shared person→account index, and account.permKeys from the
   reconciliation or directory import. Mining-hygiene exclusions apply, like
   in every other engine. Org-unit roll-up from the old tool is not ported
   (it hung on a tenant-specific Custom.hierarchie field). */
(function (HR) {
  'use strict';

  const U = HR.util;

  function cfgOf() {
    return Object.assign({
      minRoleMembers: 3,     // occupants_threshold
      minRelevance: 50,      // relevance_threshold (%)
      globalPct: 90,         // Global-role relevance floor (%)
      similarityPct: 90,     // role-to-role Jaccard (%)
      maxRoles: 100,
      clusterSim: 0.6,
      clusterMin: 5
    }, HR.config.get().classic || {});
  }

  const contractRef = o => {
    o = o || {};
    return { id: String(o.externalId || o.code || '').trim(), name: String(o.name || '').trim() };
  };

  function build(model, opts) {
    if (model._classic && !(opts && opts.force)) return model._classic;
    if (!model.vault) return null;
    const cfg = cfgOf();
    const ex = HR.mine.exclusion(model);

    /* ---- the population: persons with at least one account, holding the
       union of their accounts' permissions ---- */
    const index = HR.correlate.personAccountIndex(model, model.vault, model.correlation);
    const people = [];
    for (const person of model.vault.persons) {
      const entry = index.get(person.personId);
      const accounts = entry ? entry.accounts : [];
      if (!accounts.length) continue;
      const perms = new Set();
      accounts.forEach(a => a.permKeys.forEach(k => { if (!ex.skip(k)) perms.add(k); }));
      const active = person.activeContracts.length ? person.activeContracts : [];
      const primary = person.primaryContract || active[0] || null;
      people.push({
        person, name: person.displayName || person.externalId,
        accounts, perms,
        contracts: active.map(c => ({ dept: contractRef(c.department), title: contractRef(c.title) })),
        primaryDept: primary ? contractRef(primary.department).name : '',
        primaryTitle: primary ? contractRef(primary.title).name : ''
      });
    }
    const total = people.length;
    if (!total) return (model._classic = { unavailable: 'no-population' });

    /* ---- org-wide baseline per permission ---- */
    const holderCount = new Map();
    people.forEach(p => p.perms.forEach(k => holderCount.set(k, (holderCount.get(k) || 0) + 1)));
    const baseline = k => 100 * (holderCount.get(k) || 0) / total;

    /* ---- role sets from active contracts ---- */
    const defs = new Map(); // 'type\u0000name' -> {type, name, members:Set(people idx)}
    const addTo = (type, name, pi) => {
      if (!name) return;
      const key = type + '\u0000' + name;
      let d = defs.get(key);
      if (!d) { d = { type, name, members: new Set() }; defs.set(key, d); }
      d.members.add(pi);
    };
    people.forEach((p, pi) => {
      addTo('global', 'global', pi);
      p.contracts.forEach(c => {
        addTo('department', c.dept.name, pi);
        addTo('title', c.title.name, pi);
        if (c.dept.name && c.title.name) addTo('combo', c.dept.name + ' - ' + c.title.name, pi);
      });
    });

    let roles = [];
    for (const d of defs.values()) {
      if (d.type !== 'global' && d.members.size < cfg.minRoleMembers) continue;
      roles.push({ type: d.type, name: d.name, members: d.members, count: d.members.size });
    }
    roles.sort((a, b) => (a.type !== 'global') - (b.type !== 'global') || b.count - a.count ||
      a.name.localeCompare(b.name));

    /* ---- per-role permissions: relevance, lift, exceptions ---- */
    for (const role of roles) {
      const members = [...role.members].map(pi => people[pi]);
      const floor = role.type === 'global' ? cfg.globalPct : cfg.minRelevance;
      const counts = new Map();
      members.forEach(p => p.perms.forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
      const perms = [];
      for (const [k, count] of counts) {
        const relevance = 100 * count / members.length;
        if (relevance < floor) continue;
        const base = baseline(k);
        perms.push({
          key: k,
          name: (model.permissions.get(k) || {}).name || k,
          count, relevance, baseline: base,
          lift: base ? relevance / base : 0,
          global: false,
          missing: members.filter(p => !p.perms.has(k)).map(p => p.name).sort()
        });
      }
      perms.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));
      role.permissions = perms;
      role.accounts = U.sum(members, p => p.accounts.length);
    }

    /* combo gate: a Department+Title role earns its place only by adding a
       permission neither parent role reaches. */
    const permsByRole = new Map(roles.map(r => [r.type + '\u0000' + r.name,
      new Set(r.permissions.map(p => p.key))]));
    roles = roles.filter(r => {
      if (r.type !== 'combo') return true;
      const cut = r.name.indexOf(' - ');
      const parent = new Set([
        ...(permsByRole.get('department\u0000' + r.name.slice(0, cut)) || []),
        ...(permsByRole.get('title\u0000' + r.name.slice(cut + 3)) || [])
      ]);
      return r.permissions.some(p => !parent.has(p.key));
    });

    if (cfg.maxRoles > 0) {
      const kept = []; let n = 0;
      for (const r of roles) {
        if (r.type === 'global') { kept.push(r); continue; }
        if (n < cfg.maxRoles) { kept.push(r); n++; }
      }
      roles = kept;
    }

    /* global collapse: what everyone gets is noise inside every other role */
    const globalRole = roles.find(r => r.type === 'global');
    const globalKeys = new Set(globalRole ? globalRole.permissions.map(p => p.key) : []);
    roles.forEach(r => r.permissions.forEach(p => {
      p.global = r.type === 'global' || globalKeys.has(p.key);
    }));

    /* outside lists: who holds the permission without being in the role */
    for (const role of roles) {
      for (const perm of role.permissions) {
        perm.outside = people
          .filter((p, pi) => !role.members.has(pi) && p.perms.has(perm.key))
          .map(p => p.name).sort();
      }
    }

    /* cumulative coverage, in display order — the Global role is excluded
       (it touches everyone by definition and would pin the running total). */
    const touched = new Set();
    for (const role of roles) {
      if (role.type !== 'global') role.members.forEach(pi => touched.add(pi));
      role.cumulative = 100 * touched.size / total;
    }

    /* role-to-role similarity */
    const detailed = roles.filter(r => r.type !== 'global');
    roles.forEach(r => { r.similarTo = []; });
    for (const role of detailed) {
      for (const other of detailed) {
        if (other === role) continue;
        let inter = 0;
        role.members.forEach(pi => { if (other.members.has(pi)) inter++; });
        const union = role.count + other.count - inter;
        const pct = union ? Math.round(100 * inter / union) : 0;
        if (pct >= cfg.similarityPct) role.similarTo.push({ pct, name: other.name });
      }
      role.similarTo.sort((a, b) => b.pct - a.pct);
    }

    /* ---- de-facto clusters ---- */
    const relevant = new Set([...holderCount.keys()]
      .filter(k => !globalKeys.has(k) && holderCount.get(k) >= 3));
    let members = people
      .map((p, pi) => ({ pi, p, mset: new Set([...p.perms].filter(k => relevant.has(k))) }))
      .filter(m => m.mset.size >= 3)
      .sort((a, b) => b.mset.size - a.mset.size);
    const SAMPLE_ABOVE = 4000;
    if (members.length > SAMPLE_ABOVE) {
      const stride = Math.ceil(members.length / SAMPLE_ABOVE);
      members = members.filter((_, i) => i % stride === 0);
    }
    const protoClusters = [];
    const jac = (a, b) => {
      let inter = 0;
      a.forEach(k => { if (b.has(k)) inter++; });
      const union = a.size + b.size - inter;
      return union ? inter / union : 0;
    };
    for (const m of members) {
      let placed = false;
      for (const c of protoClusters) {
        if (jac(m.mset, c.leader) >= cfg.clusterSim) { c.members.push(m); placed = true; break; }
      }
      if (!placed) protoClusters.push({ leader: m.mset, members: [m] });
    }
    const clusters = [];
    for (const c of protoClusters) {
      if (c.members.length < cfg.clusterMin) continue;
      const counts = new Map();
      c.members.forEach(m => m.mset.forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
      const common = [...counts.entries()]
        .filter(([, n]) => n / c.members.length >= 0.8)
        .map(([k, n]) => ({ key: k, name: (model.permissions.get(k) || {}).name || k,
          share: Math.round(100 * n / c.members.length) }))
        .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
      if (common.length < 3) continue;
      const attrCounts = new Map();
      c.members.forEach(m => {
        const key = m.p.primaryDept + '\u0000' + m.p.primaryTitle;
        attrCounts.set(key, (attrCounts.get(key) || 0) + 1);
      });
      let topKey = '', top = 0;
      attrCounts.forEach((n, k) => { if (n > top) { top = n; topKey = k; } });
      const [dept, title] = topKey.split('\u0000');
      const purity = top / c.members.length;
      clusters.push({
        size: c.members.length,
        common,
        dominantDepartment: dept, dominantTitle: title,
        purity: Math.round(100 * purity),
        discovered: purity < 0.6,
        members: c.members.map(m => m.p.name).sort()
      });
    }
    clusters.sort((a, b) => (b.discovered - a.discovered) || b.size - a.size);

    model._classic = { people, total, roles, clusters, globalKeys, cfg };
    return model._classic;
  }

  /** The inverse view for one permission: which classic roles its holders sit in. */
  function rolesHolding(classic, model, permKey) {
    if (!classic || !classic.roles) return [];
    const hits = [];
    for (const role of classic.roles) {
      if (role.type === 'global') continue;
      let names = [];
      role.members.forEach(pi => {
        const p = classic.people[pi];
        if (p.perms.has(permKey)) names.push(p.name);
      });
      if (!names.length) continue;
      hits.push({ role: role.name, type: role.type, count: names.length,
        size: role.count, names: names.sort() });
    }
    hits.sort((a, b) => b.count - a.count);
    return hits;
  }

  HR.classic = { build, rolesHolding };
})(window.HR);
