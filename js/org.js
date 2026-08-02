/* The organisation as HR describes it, and whether that description holds together.

   Two things live here.

   The walker builds the department hierarchy from the vault — parent links where the
   export has them, contract data where it does not — so the structure can be travelled
   one level at a time: headcount here, headcount below, sub-departments, managers, job
   titles present. Every other view in this tool starts from an account or an
   entitlement; this one starts from the organisation, which is the shape a business
   owner recognises and the shape a rule condition is written against.

   The sanity checks read the same data the other way round. A vault is the input every
   evaluation, correlation and pyramid level depends on, so a gap in it silently weakens
   all of them: a person with no department is a person no department rule can select,
   and a job title held only by people whose contracts ended is a title that will never
   match again. What makes these findable is that they are anomalies rather than
   absences — an attribute is missing here and filled almost everywhere else. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const DAY = 86400000;

  /* Facets a rule condition can address. `of` reads the value from a contract; a person
     scores as "filled" when any of their contracts carries it. */
  const FACETS = {
    department: { label: 'Department', of: c => c.department.name || c.department.externalId },
    title: { label: 'Title', of: c => c.title.name },
    location: { label: 'Location', of: c => c.location.name },
    costCenter: { label: 'Cost centre', of: c => c.costCenter.name || c.costCenter.code },
    employer: { label: 'Employer', of: c => c.employer.name },
    type: { label: 'Contract type', of: c => c.type.name },
    manager: { label: 'Manager', of: c => c.manager.displayName },
    division: { label: 'Division', of: c => c.division.name },
    team: { label: 'Team', of: c => c.team.name }
  };

  const contractsOf = person => person.contracts || [];
  const isEnded = (contract, now) => !!contract.endDate && contract.endDate < now;

  /**
   * The department tree.
   *
   * A vault export may carry Departments with parent links, contracts that name a
   * department and nothing else, or both. All three produce a walkable tree; only the
   * first produces a deep one, and the view says which it got rather than implying a
   * flat organisation is the real shape.
   */
  function tree(vault, when) {
    const now = when || new Date();
    const nodes = new Map();

    const add = (externalId, name) => {
      const id = String(externalId || name || '').trim();
      if (!id) return null;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id, externalId: String(externalId || ''), name: String(name || externalId || ''),
          parentId: null, children: [], people: [], titles: new Map(),
          managers: new Map(), costCentres: new Set(), fromExport: false
        });
      }
      return nodes.get(id);
    };

    for (const d of vault.departments || []) {
      const node = add(d.externalId, d.displayName || d.externalId);
      if (!node) continue;
      node.fromExport = true;
      node.parentId = d.parentExternalId || null;
      if (d.manager && d.manager.displayName) {
        node.managers.set(d.manager.displayName, (node.managers.get(d.manager.displayName) || 0) + 1);
      }
    }

    /* People land on the department of each contract that is running today; a person
       with two contracts genuinely sits in two places. */
    for (const person of vault.persons) {
      const seen = new Set();
      for (const c of contractsOf(person)) {
        if (isEnded(c, now)) continue;
        if (c.startDate && c.startDate > now) continue;
        const node = add(c.department.externalId || c.department.name, c.department.name || c.department.externalId);
        if (!node || seen.has(node.id)) continue;
        seen.add(node.id);
        node.people.push({ person, contract: c });
        if (c.title.name) node.titles.set(c.title.name, (node.titles.get(c.title.name) || 0) + 1);
        if (c.manager.displayName) node.managers.set(c.manager.displayName, (node.managers.get(c.manager.displayName) || 0) + 1);
        if (c.costCenter.code || c.costCenter.name) node.costCentres.add(c.costCenter.code || c.costCenter.name);
      }
    }

    /* Link children; a parent that does not exist is a dangling reference, not a root. */
    const dangling = [];
    for (const node of nodes.values()) {
      if (!node.parentId) continue;
      const parent = nodes.get(node.parentId);
      if (parent) parent.children.push(node);
      else dangling.push(node);
    }
    const roots = Array.from(nodes.values()).filter(n => !n.parentId || !nodes.has(n.parentId));

    const subtreeCount = node => node.people.length +
      node.children.reduce((sum, c) => sum + subtreeCount(c), 0);
    const subtreeDepartments = node =>
      node.children.reduce((sum, c) => sum + 1 + subtreeDepartments(c), 0);

    const pathOf = node => {
      const out = [];
      for (let n = node; n; n = n.parentId ? nodes.get(n.parentId) : null) {
        out.unshift(n);
        if (out.length > 32) break;                 // a cycle in the export, not a hierarchy
      }
      return out;
    };

    return {
      nodes, roots, dangling,
      subtreeCount, subtreeDepartments, pathOf,
      byId: id => nodes.get(id) || null,
      meta: {
        departments: nodes.size,
        fromExport: Array.from(nodes.values()).filter(n => n.fromExport).length,
        hierarchical: Array.from(nodes.values()).some(n => n.children.length),
        depth: Math.max.apply(null, [0].concat(Array.from(nodes.values()).map(n => pathOf(n).length))),
        withoutManager: Array.from(nodes.values()).filter(n => !n.managers.size).length,
        people: U.sum(Array.from(nodes.values()), n => n.people.length)
      }
    };
  }

  /** Every job title, where it occurs, and whether anybody currently holds it. */
  function titles(vault, when) {
    const now = when || new Date();
    const map = new Map();
    for (const person of vault.persons) {
      for (const c of contractsOf(person)) {
        const name = c.title.name;
        if (!name) continue;
        if (!map.has(name)) {
          map.set(name, {
            name, contracts: 0, active: 0, ended: 0, future: 0,
            persons: new Set(), departments: new Set(), lastEnd: null
          });
        }
        const t = map.get(name);
        t.contracts++;
        t.persons.add(person.personId);
        if (c.department.name) t.departments.add(c.department.name);
        if (isEnded(c, now)) {
          t.ended++;
          if (!t.lastEnd || c.endDate > t.lastEnd) t.lastEnd = c.endDate;
        } else if (c.startDate && c.startDate > now) t.future++;
        else t.active++;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.active - a.active || b.contracts - a.contracts);
  }

  /**
   * Sanity checks on the vault itself.
   *
   * The useful ones are comparative. "Some people have no cost centre" is a fact about
   * how a tenant works; "eleven people have no cost centre while 96% of their colleagues
   * do" is a data problem with a list attached. So each facet is scored by how filled it
   * is overall, and only facets the organisation clearly maintains produce findings.
   */
  function quality(vault, opts) {
    opts = Object.assign({ fillFloor: 0.8, horizonDays: 90, when: null }, opts || {});
    const now = opts.when || new Date();
    const persons = vault.persons;

    /* ---- attribute fill, per facet ---- */
    const facets = [];
    for (const key of Object.keys(FACETS)) {
      const def = FACETS[key];
      const withContract = persons.filter(p => contractsOf(p).length);
      const filled = [];
      const missing = [];
      for (const person of withContract) {
        const has = contractsOf(person).some(c => String(def.of(c) || '').trim());
        (has ? filled : missing).push(person);
      }
      const total = withContract.length;
      const fill = total ? filled.length / total : 0;
      facets.push({
        key, label: def.label, fill, filled: filled.length, missing,
        total,
        /* Maintained almost everywhere, absent for a few: that gap is the finding. */
        anomalous: fill >= opts.fillFloor && missing.length > 0 && fill < 1
      });
    }

    /* ---- titles that only exist on contracts that ended ---- */
    const titleRows = titles(vault, now);
    const deadTitles = titleRows.filter(t => t.contracts > 0 && t.active === 0 && t.future === 0);

    /* ---- structure ---- */
    const structure = tree(vault, now);
    const departmentsWithoutManager = Array.from(structure.nodes.values())
      .filter(n => n.people.length && !n.managers.size);
    const danglingParents = structure.dangling;

    /* Departments people are in that the Departments list never declares: the rule
       author picks from the list, so a department missing from it cannot be addressed. */
    const declared = new Set((vault.departments || []).map(d => String(d.externalId || '')).filter(Boolean));
    const undeclared = [];
    if (declared.size) {
      for (const node of structure.nodes.values()) {
        if (!node.people.length) continue;
        if (node.externalId && !declared.has(node.externalId)) undeclared.push(node);
      }
    }

    /* ---- contracts ---- */
    const noContract = persons.filter(p => !contractsOf(p).length);
    const backwards = [];
    const openEnded = [];
    const farFuture = [];
    for (const person of persons) {
      for (const c of contractsOf(person)) {
        if (c.startDate && c.endDate && c.endDate < c.startDate) backwards.push({ person, contract: c });
        if (!c.startDate && !c.endDate) openEnded.push({ person, contract: c });
        if (c.startDate && (c.startDate - now) / DAY > 365) farFuture.push({ person, contract: c });
      }
    }

    /* ---- identity ---- */
    const byExternal = U.by(persons.filter(p => p.externalId), p => p.externalId);
    const duplicateIds = Array.from(byExternal.entries())
      .filter(entry => entry[1].length > 1)
      .map(entry => ({ externalId: entry[0], persons: entry[1] }));
    const noExternalId = persons.filter(p => !p.externalId);

    /* ---- the joiner/mover/leaver window ----
       A contract about to end and a contract about to start are the two moments where
       access is wrong on purpose for a while. Both are in the vault already; nothing in
       the reconciliation can see them coming. */
    const endingSoon = [];
    const startingSoon = [];
    for (const person of persons) {
      for (const c of contractsOf(person)) {
        if (c.endDate && !isEnded(c, now)) {
          const days = Math.round((c.endDate - now) / DAY);
          if (days <= (opts.horizonDays || 90)) endingSoon.push({ person, contract: c, days });
        }
        if (c.startDate && c.startDate > now) {
          const days = Math.round((c.startDate - now) / DAY);
          if (days <= (opts.horizonDays || 90)) startingSoon.push({ person, contract: c, days });
        }
      }
    }
    endingSoon.sort((a, b) => a.days - b.days);
    startingSoon.sort((a, b) => a.days - b.days);

    /* People HelloID has been told to leave alone. Their access is unmanaged by design,
       which is worth separating from access that is unmanaged by accident. */
    const flagged = persons.filter(p => p.blocked || p.excluded || p.skipProcessing);

    /* Two contracts running at once is legitimate and makes every "the person's
       department" statement ambiguous — including the ones rules are written against. */
    const multiContract = persons.filter(p => contractsOf(p).filter(c =>
      (!c.startDate || c.startDate <= now) && (!c.endDate || c.endDate >= now)).length > 1);

    /* Everyone whose contracts have all ended, which is what makes an account a leaver's
       account rather than an unowned one. */
    const ended = persons.filter(p => contractsOf(p).length &&
      contractsOf(p).every(c => isEnded(c, now)));

    return {
      facets,
      anomalousFacets: facets.filter(f => f.anomalous),
      titles: titleRows,
      deadTitles,
      structure,
      departmentsWithoutManager,
      danglingParents,
      undeclared,
      noContract, backwards, openEnded, farFuture,
      duplicateIds, noExternalId, ended,
      endingSoon, startingSoon, flagged, multiContract,
      summary: {
        persons: persons.length,
        contracts: U.sum(persons, p => contractsOf(p).length),
        departments: structure.meta.departments,
        titles: titleRows.length,
        deadTitles: deadTitles.length,
        anomalies: facets.filter(f => f.anomalous).length,
        missingValues: U.sum(facets.filter(f => f.anomalous), f => f.missing.length),
        noContract: noContract.length,
        duplicateIds: duplicateIds.length,
        ended: ended.length,
        endingSoon: endingSoon.length,
        startingSoon: startingSoon.length,
        flagged: flagged.length,
        multiContract: multiContract.length
      }
    };
  }

  HR.org = { tree, titles, quality, FACETS };
})(window.HR);
