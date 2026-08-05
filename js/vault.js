/* HelloID Vault export: persons, their contracts, and the departments they sit in.

   Shape (JSON): { Persons: [...], Departments: [...] }

   A person carries identity (PersonId, ExternalId, DisplayName), state (Status.Blocked,
   Excluded), the accounts HelloID has correlated to them, a Custom bag, and one or more
   Contracts. Every attribute a business rule can condition on lives on the contract —
   Department, Title, Location, CostCenter, Employer, Type, dates — which is why this
   export is what makes rule conditions evaluable at all.

   DisplayName is "Name (ExternalId)", the same string the reconciliation export puts in
   its Person column, so the two join without fuzzy matching. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const str = v => (v == null ? '' : String(v)).trim();
  const date = v => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  /** Flatten a HelloID reference object ({ExternalId, Code, Name/DisplayName}) */
  function ref(o) {
    o = o || {};
    return {
      externalId: str(o.ExternalId),
      code: str(o.Code),
      name: str(o.Name || o.DisplayName),
      empty: !o || !Object.keys(o).length
    };
  }

  function looksLikeVault(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.Persons);
  }

  function normaliseContract(c, index, stats) {
    const d = v => {
      const parsed = date(v);
      if (stats && v && !parsed) stats.badDates++;
      return parsed;
    };
    return {
      index,
      externalId: str(c.ExternalId),
      startDate: d(c.StartDate),
      endDate: d(c.EndDate),
      type: ref(c.Type),
      department: ref(c.Department),
      title: ref(c.Title),
      location: ref(c.Location),
      costCenter: ref(c.CostCenter),
      costBearer: ref(c.CostBearer),
      employer: ref(c.Employer),
      team: ref(c.Team),
      division: ref(c.Division),
      organization: ref(c.Organization),
      manager: {
        personId: str((c.Manager || {}).PersonId),
        externalId: str((c.Manager || {}).ExternalId),
        displayName: str((c.Manager || {}).DisplayName)
      },
      details: c.Details || {},
      custom: c.Custom || {},
      sequence: (c.Details || {}).Sequence,
      displayOrderIndex: c.DisplayOrderIndex
    };
  }

  /**
   * @param {string} text raw JSON
   * @returns {{persons:Array, departments:Array, meta:Object, warnings:Array<string>}}
   */
  function parse(text, fileName) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Vault export is not valid JSON: ' + e.message); }
    if (!looksLikeVault(data)) {
      throw new Error('Not a HelloID Vault export — expected a JSON object with a Persons array.');
    }

    const warnings = [];
    const now = new Date();
    const health = { persons: data.Persons.length, badDates: 0, noIdentity: 0, noContract: 0 };

    const persons = data.Persons.map((p, i) => {
      const contracts = (p.Contracts || []).map((c, ci) => normaliseContract(c, ci, health));
      const primary = p.PrimaryContract && Object.keys(p.PrimaryContract).length
        ? normaliseContract(p.PrimaryContract, -1) : (contracts[0] || null);

      /* A contract counts as current when today sits inside its window; an open end date
         means it is still running. */
      const active = contracts.filter(c =>
        (!c.startDate || c.startDate <= now) && (!c.endDate || c.endDate >= now));

      const accounts = (p.Accounts || []).map(a => {
        const d = a.Data || {};
        return {
          systemId: str(a.SystemIdentifier),
          userName: str(d.sAMAccountName || d.userName || d.UserName || d.userPrincipalName),
          upn: str(d.userPrincipalName),
          displayName: str(d.displayName || d.DisplayName),
          data: d
        };
      });

      return {
        i,
        personId: str(p.PersonId),
        externalId: str(p.ExternalId),
        displayName: str(p.DisplayName),
        userName: str(p.UserName),
        name: p.Name || {},
        blocked: !!((p.Status || {}).Blocked),
        excluded: !!p.Excluded,
        skipProcessing: !!p.SkipProcessing,
        custom: p.Custom || {},
        contracts,
        activeContracts: active,
        primaryContract: primary,
        accounts,
        source: p.Source || {},
        /* Dates that decide joiner/leaver questions the reconciliation export cannot answer. */
        firstStart: contracts.reduce((min, c) => (c.startDate && (!min || c.startDate < min)) ? c.startDate : min, null),
        lastEnd: contracts.length && contracts.every(c => c.endDate)
          ? contracts.reduce((max, c) => (!max || c.endDate > max) ? c.endDate : max, null)
          : null
      };
    });

    const departments = (data.Departments || []).map(d => ({
      externalId: str(d.ExternalId),
      displayName: str(d.DisplayName),
      code: str(d.Code),
      parentExternalId: str(d.ParentExternalId),
      manager: {
        personId: str((d.Manager || {}).PersonId),
        externalId: str((d.Manager || {}).ExternalId),
        displayName: str((d.Manager || {}).DisplayName)
      }
    }));

    health.noContract = persons.filter(p => !p.contracts.length).length;
    if (health.noContract) warnings.push(health.noContract + ' person(s) have no contract; conditions on contract attributes cannot select them.');
    health.noIdentity = persons.filter(p => !p.displayName && !p.externalId && !p.personId).length;
    if (health.noIdentity) warnings.push(health.noIdentity + ' person(s) carry no display name, external id or person id.');
    if (health.badDates) warnings.push(health.badDates + ' contract date(s) could not be read.');

    return {
      persons, departments, warnings,
      byExternalId: new Map(persons.map(p => [p.externalId, p])),
      byDisplayName: new Map(persons.map(p => [p.displayName, p])),
      meta: {
        fileName: fileName || 'vault.json',
        personCount: persons.length,
        departmentCount: departments.length,
        contractCount: U.sum(persons, p => p.contracts.length),
        customFields: U.uniq(persons.flatMap(p => Object.keys(p.custom || {}))),
        contractCustomFields: U.uniq(persons.flatMap(p => p.contracts.flatMap(c => Object.keys(c.custom || {})))),
        health,
        fingerprint: HR.util.hash(text.length + '|' + persons.length + '|' + text.slice(0, 4096))
      }
    };
  }

  /** Index the accounts HelloID has correlated, so reconciliation rows can be matched. */
  function accountIndex(vault) {
    const byUserName = new Map();
    for (const p of vault.persons) {
      for (const a of p.accounts) {
        if (a.userName) byUserName.set(a.userName.toLowerCase(), { person: p, account: a });
        if (a.upn) byUserName.set(a.upn.toLowerCase().split('@')[0], { person: p, account: a });
      }
    }
    return byUserName;
  }

  const DAY = 86400000;

  /**
   * Where a person sits relative to their contracts, and by how far.
   * future  — nothing has started yet          (days until the first start)
   * current — a contract is running today      (days until the last end, if any)
   * past    — every contract has ended         (days since the last end)
   */
  function lifecycle(person, when) {
    const now = when || new Date();
    if (!person.contracts.length) return { state: 'unknown', days: null, date: null };

    const running = person.contracts.filter(c =>
      (!c.startDate || c.startDate <= now) && (!c.endDate || c.endDate >= now));
    if (running.length) {
      const ends = running.filter(c => c.endDate).map(c => c.endDate);
      if (!ends.length) return { state: 'current', days: null, date: null };
      const last = new Date(Math.max.apply(null, ends));
      return { state: 'current', days: Math.round((last - now) / DAY), date: last };
    }

    const starts = person.contracts.filter(c => c.startDate && c.startDate > now).map(c => c.startDate);
    if (starts.length) {
      const first = new Date(Math.min.apply(null, starts));
      return { state: 'future', days: Math.round((first - now) / DAY), date: first };
    }

    const ends = person.contracts.filter(c => c.endDate).map(c => c.endDate);
    if (!ends.length) return { state: 'unknown', days: null, date: null };
    const last = new Date(Math.max.apply(null, ends));
    return { state: 'past', days: Math.round((now - last) / DAY), date: last };
  }

  HR.vault = { parse, looksLikeVault, accountIndex, normaliseContract, lifecycle };
})(window.HR);
