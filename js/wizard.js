/* Classification by mining, not by filters.

   Permissions and accounts are classified from what is actually in the data:
   every name is placed in a mined family (its prefix convention, per system),
   and classification is a stored answer per family or per single item — the
   way a banking app categorises transactions. The old pattern-filter lists
   are gone; the built-in knowledge (PRIV means privileged, adm- means admin
   account) lives in the hint vocabulary in js/mine.js and classifies
   automatically until an answer says otherwise.

   Resolution order (implemented in js/model.js with the system known, and in
   config.categoryFor without it):
     per-item assignment  >  family assignment  >  built-in hint  >  fallback
   plus, for accounts, a membership heuristic: an account holding privileged
   entitlements is an admin account unless assigned otherwise.

   Employee categories (who the account works for) are a different axis and
   keep their layered vault/name/membership patterns. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const SEP = '';

  /* ------------------------------------------------------- family identity */

  /** The family a permission name belongs to: its prefix token, uppercased.
      Deterministic and total — this is identity, not a threshold. */
  function famKeyOf(name) {
    const m = /^([A-Za-z][A-Za-z0-9#]{1,11})[-_. ]/.exec(String(name || ''));
    return m ? m[1].toUpperCase() : null;
  }

  /** The cohort an account name belongs to: a short leading token before a
      separator ('s:adm'), or a short hinted trailing token ('e:tst'). */
  function cohortKeyOf(userName) {
    const name = String(userName || '');
    const parts = name.split(/([-_.\s]+)/);
    if (parts.length < 3) return null;
    const head = parts[0], sep = parts[1];
    if (head && head.length <= 6 && (HR.mine.classHintFor(head) || sep !== '.')) {
      return 's:' + head.toLowerCase();
    }
    const tail = parts[parts.length - 1];
    if (tail && tail.length <= 6 && HR.mine.classHintFor(tail)) {
      return 'e:' + tail.toLowerCase();
    }
    return null;
  }

  const famStoreKey = (system, fam) => system + SEP + fam;

  /* ------------------------------------------------------------- examine */

  /**
   * The whole estate, partitioned: every permission in exactly one family or
   * in the stray list; every account in a cohort or outside them. Each family
   * carries its current resolved answer and where it came from.
   */
  function examine(model) {
    const cfg = HR.config.get();
    const catFams = cfg.catFamilies || {};
    const clsFams = cfg.clsFamilies || {};

    /* ---- permissions ---- */
    const famMap = new Map();
    const permStrays = [];
    for (const p of model.permissionList) {
      const fam = famKeyOf(p.name);
      if (!fam) { permStrays.push(p); continue; }
      const key = famStoreKey(p.system, fam);
      let g = famMap.get(key);
      if (!g) {
        const assigned = catFams[key] || null;
        const hint = HR.mine.hintFor(fam);
        g = {
          key, system: p.system, prefix: fam, members: [],
          assigned,
          hintId: hint && (cfg.categories || []).some(c => c.id === hint.hint) ? hint.hint : null,
          sensitivity: hint ? hint.sensitivity : null
        };
        g.current = assigned || g.hintId || 'other';
        g.source = assigned ? 'family' : (g.hintId ? 'auto' : 'none');
        famMap.set(key, g);
      }
      g.members.push(p);
    }
    const permFamilies = Array.from(famMap.values());
    permFamilies.forEach(g => {
      g.count = g.members.length;
      g.overrides = g.members.filter(p => p.categorySource === 'manual').length;
      g.samples = g.members.slice(0, 4).map(p => p.name);
    });
    permFamilies.sort((a, b) =>
      (a.source === 'none' ? 0 : 1) - (b.source === 'none' ? 0 : 1) || b.count - a.count);

    /* ---- accounts ---- */
    const coMap = new Map();
    for (const a of model.accountList) {
      const co = cohortKeyOf(a.userName);
      if (!co) continue;
      const key = famStoreKey(a.system, co);
      let g = coMap.get(key);
      if (!g) {
        const assigned = clsFams[key] || null;
        const hint = HR.mine.classHintFor(co.slice(2));
        g = {
          key, system: a.system, token: co.slice(2), kind: co.slice(0, 1) === 's' ? 'starts' : 'ends',
          members: [], assigned,
          hintId: hint && (cfg.accountClasses || []).some(c => c.id === hint.id) ? hint.id : null,
          weight: hint ? hint.weight : null
        };
        g.current = assigned || g.hintId || 'user';
        g.source = assigned ? 'family' : (g.hintId ? 'auto' : 'none');
        coMap.set(key, g);
      }
      g.members.push(a);
    }
    /* Cohorts that neither carry an answer nor a hint and are tiny are noise,
       not a question — personal names split into countless one-off heads. */
    const floor = Math.max(2, Math.round(model.accountList.length * 0.01));
    const accountFamilies = Array.from(coMap.values())
      .filter(g => g.assigned || g.hintId || g.members.length >= floor);
    accountFamilies.forEach(g => {
      g.count = g.members.length;
      g.overrides = g.members.filter(a => a.clsSource === 'manual').length;
      g.samples = g.members.slice(0, 4).map(a => a.userName);
    });
    accountFamilies.sort((a, b) =>
      (a.source === 'none' ? 0 : 1) - (b.source === 'none' ? 0 : 1) || b.count - a.count);

    const unmappedPerms = model.permissionList.filter(p =>
      p.category === 'other' && p.categorySource !== 'manual');
    const bySource = list => {
      const out = {};
      list.forEach(x => { out[x] = (out[x] || 0) + 1; });
      return out;
    };

    return {
      permFamilies,
      permStrays: permStrays.sort((a, b) => (b.holderCount || 0) - (a.holderCount || 0)),
      accountFamilies,
      prices: HR.mine.suggest(model).prices,
      unmapped: {
        permissions: unmappedPerms.length,
        families: permFamilies.filter(g => g.source === 'none').length,
        cohorts: accountFamilies.filter(g => g.source === 'none').length
      },
      coverage: {
        permissions: model.permissionList.length,
        permSources: bySource(model.permissionList.map(p => p.categorySource || 'default')),
        accounts: model.accountList.length,
        clsSources: bySource(model.accountList.map(a => a.clsSource || 'default'))
      }
    };
  }

  /* --------------------------------------------------------------- apply */

  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /**
   * Write the decisions in one save. Family answers land in the assignment
   * maps; item answers in the override maps; a new category/class becomes a
   * definition row (before the fallback). No patterns anywhere.
   *
   * decisions = {
   *   newCategories: [{ label, sensitivity }], newClasses: [{ label, weight }],
   *   permFamilies:  [{ key, categoryId }],    permItems: [{ name, categoryId }],
   *   accFamilies:   [{ key, classId }],       accItems:  [{ key, classId }],
   *   prices:        [{ label, pattern, price }]
   * }
   */
  function apply(decisions) {
    const cfg = HR.config.clone(HR.config.get());

    const before = (list, stopId, row) => {
      const at = list.findIndex(r => r.id === stopId);
      list.splice(at < 0 ? list.length : at, 0, row);
    };
    (decisions.newCategories || []).forEach(d => {
      if (!cfg.categories.some(c => c.id === 'mined-' + slug(d.label))) {
        before(cfg.categories, 'other',
          { id: 'mined-' + slug(d.label), label: d.label, sensitivity: d.sensitivity || 1.0, color: 2 });
      }
    });
    (decisions.newClasses || []).forEach(d => {
      if (!cfg.accountClasses.some(c => c.id === 'mined-' + slug(d.label))) {
        before(cfg.accountClasses, 'user',
          { id: 'mined-' + slug(d.label), label: d.label, weight: d.weight || 1.2 });
      }
    });

    cfg.catFamilies = cfg.catFamilies || {};
    (decisions.permFamilies || []).forEach(d => {
      if (d.categoryId) cfg.catFamilies[d.key] = d.categoryId;
      else delete cfg.catFamilies[d.key];
    });
    cfg.clsFamilies = cfg.clsFamilies || {};
    (decisions.accFamilies || []).forEach(d => {
      if (d.classId) cfg.clsFamilies[d.key] = d.classId;
      else delete cfg.clsFamilies[d.key];
    });
    cfg.catOverrides = cfg.catOverrides || {};
    (decisions.permItems || []).forEach(d => {
      if (d.categoryId) cfg.catOverrides[d.name] = d.categoryId;
      else delete cfg.catOverrides[d.name];
    });
    cfg.clsOverrides = cfg.clsOverrides || {};
    (decisions.accItems || []).forEach(d => {
      if (d.classId) cfg.clsOverrides[d.key] = d.classId;
      else delete cfg.clsOverrides[d.key];
    });

    (decisions.prices || []).forEach(d => {
      cfg.priceBook.unshift({
        label: d.label, classification: HR.config.categoryFor(d.label).id,
        pattern: d.pattern, price: d.price, unit: 'month'
      });
    });

    HR.config.save(cfg);
    return {
      families: (decisions.permFamilies || []).length + (decisions.accFamilies || []).length,
      items: (decisions.permItems || []).length + (decisions.accItems || []).length,
      prices: (decisions.prices || []).length
    };
  }

  HR.wizard = { examine, apply, famKeyOf, cohortKeyOf, famStoreKey };
})(window.HR);
