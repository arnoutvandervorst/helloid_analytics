/* Evaluates business-rule conditions against Vault persons.

   Until a vault export is loaded, conditions can only be read. With one, each clause can
   be resolved against real attributes, which turns "this rule grants X" into "these
   people should hold X" — and that is what makes over- and under-provisioning visible
   per person instead of per group.

   Two design choices keep the result trustworthy:

     - A clause whose facet this engine does not recognise makes the rule *indeterminate*
       for that person, never silently true. An unknown condition is a reason to abstain,
       not to assume a match.
     - Contract-scoped facets (department, title, location, type) match when *any* contract
       satisfies them, which is how HelloID stacks multi-contract people. The contract must
       also be within the rule's time frame, when it declares one. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();

  /* facet name -> how to read the candidate values off a person/contract.
     Each returns an array of strings; contract-scoped readers get one contract. */
  const CONTRACT_FACETS = {
    'department.externalid': c => [c.department.externalId],
    'department.displayname': c => [c.department.name],
    'department.name': c => [c.department.name],
    'department': c => [c.department.name, c.department.externalId],
    'departments': c => [c.department.name, c.department.externalId],
    'title.externalid': c => [c.title.externalId],
    'title.code': c => [c.title.code],
    'title.name': c => [c.title.name],
    'title': c => [c.title.name, c.title.code, c.title.externalId],
    'titles': c => [c.title.name, c.title.code, c.title.externalId],
    'location.name': c => [c.location.name],
    'location.externalid': c => [c.location.externalId],
    'location.code': c => [c.location.code],
    'type.code': c => [c.type.code],
    'type.description': c => [c.type.name],
    'type': c => [c.type.code, c.type.name],
    'costcenter.code': c => [c.costCenter.code],
    'costcenter.externalid': c => [c.costCenter.externalId],
    'costcenter.name': c => [c.costCenter.name],
    'employer.code': c => [c.employer.code],
    'employer.externalid': c => [c.employer.externalId],
    'employer.name': c => [c.employer.name],
    'division.name': c => [c.division.name],
    'team.name': c => [c.team.name],
    'organization.name': c => [c.organization.name]
  };

  const PERSON_FACETS = {
    'externalid': p => [p.externalId],
    'displayname': p => [p.displayName],
    'username': p => [p.userName]
  };

  /** "Custom.Vrijgesteld" / "Person.Custom.Geblokkeerd" / "Contract.Custom.X" */
  function customReader(facet) {
    const m = norm(facet).match(/^(?:person\.)?custom\.(.+)$/);
    if (!m) return null;
    const field = m[1];
    return {
      scope: 'person',
      read: p => {
        const bag = p.custom || {};
        const key = Object.keys(bag).find(k => norm(k) === field);
        return key == null ? [] : [bag[key]];
      }
    };
  }
  function contractCustomReader(facet) {
    const m = norm(facet).match(/^contract\.custom\.(.+)$/);
    if (!m) return null;
    const field = m[1];
    return {
      scope: 'contract',
      read: c => {
        const bag = c.custom || {};
        const key = Object.keys(bag).find(k => norm(k) === field);
        return key == null ? [] : [bag[key]];
      }
    };
  }

  /** Apply the operator carried on the facet to the values found. */
  function applyOperator(operator, found, wanted) {
    const have = found.map(norm).filter(v => v !== '');
    const want = wanted.map(norm).filter(v => v !== '');
    switch ((operator || 'one of').toLowerCase()) {
      case 'one of':
        return have.some(v => want.includes(v));
      case 'not':
        return !have.some(v => want.includes(v));
      /* "not only" excludes a person whose *every* value is in the list, while allowing
         someone who also has something else — the flag is disqualifying on its own. */
      case 'not only':
        return !(have.length > 0 && have.every(v => want.includes(v)));
      case 'is empty':
        return have.length === 0;
      case 'is not empty':
        return have.length > 0;
      case 'contains':
        return have.some(v => want.some(w => v.includes(w)));
      case 'starts with':
        return have.some(v => want.some(w => v.startsWith(w)));
      default:
        return null;                       // unknown operator: abstain
    }
  }

  /** "days before start of the contract: 14, days after end of the contract: 90" */
  function parseTimeFrame(values) {
    const text = (values || []).join(', ');
    const before = /before[^:]*:\s*(-?\d+)/i.exec(text);
    const after = /after[^:]*:\s*(-?\d+)/i.exec(text);
    return {
      daysBeforeStart: before ? parseInt(before[1], 10) : 0,
      daysAfterEnd: after ? parseInt(after[1], 10) : 0
    };
  }

  const DAY = 86400000;

  /** Is this contract inside its rule window on the given date? */
  function contractInWindow(contract, frame, when) {
    const from = contract.startDate ? new Date(contract.startDate.getTime() - (frame.daysBeforeStart || 0) * DAY) : null;
    const to = contract.endDate ? new Date(contract.endDate.getTime() + (frame.daysAfterEnd || 0) * DAY) : null;
    if (from && when < from) return false;
    if (to && when > to) return false;
    return true;
  }

  /**
   * Evaluate one rule against one person.
   * @returns {{matches:boolean|null, clauses:Array, contracts:Array}} matches === null when
   *          a clause could not be evaluated, so the caller can report "unknown" honestly.
   */
  function evaluateRule(rule, person, when) {
    when = when || new Date();
    const clauses = [];
    let indeterminate = false;

    /* The time frame decides which contracts are in play for every other clause. */
    const frameClause = rule.conditions.find(c => c.timeFrame);
    const frame = frameClause ? parseTimeFrame(frameClause.values) : { daysBeforeStart: 0, daysAfterEnd: 0 };
    const eligible = person.contracts.filter(c => contractInWindow(c, frame, when));
    if (frameClause) {
      clauses.push({
        facet: frameClause.facet, operator: null, raw: frameClause.raw,
        result: eligible.length > 0,
        detail: eligible.length + ' of ' + person.contracts.length + ' contracts in window'
      });
    }

    for (const cond of rule.conditions) {
      if (cond.timeFrame) continue;
      const facet = norm(cond.facet);

      /* "Person: active" — the state flags HelloID keeps on the person itself. */
      if (facet === 'person') {
        const wants = cond.values.map(norm);
        let ok = true;
        if (wants.includes('active')) ok = !person.blocked && !person.excluded;
        else if (wants.includes('blocked')) ok = person.blocked;
        else if (wants.includes('excluded')) ok = person.excluded;
        else ok = null;
        if (ok === null) indeterminate = true;
        clauses.push({ facet: cond.facet, operator: cond.operator, raw: cond.raw, result: ok,
          detail: person.blocked ? 'blocked' : person.excluded ? 'excluded' : 'active' });
        continue;
      }

      const personCustom = customReader(cond.facet);
      const contractCustom = contractCustomReader(cond.facet);
      const contractReader = CONTRACT_FACETS[facet];
      const personReader = PERSON_FACETS[facet];

      let result = null, detail = '';
      if (contractCustom) {
        const found = eligible.flatMap(c => contractCustom.read(c));
        result = applyOperator(cond.operator, found, cond.values);
        detail = found.join(', ') || '—';
      } else if (personCustom) {
        const found = personCustom.read(person);
        result = applyOperator(cond.operator, found, cond.values);
        detail = found.join(', ') || '—';
      } else if (contractReader) {
        /* Any eligible contract satisfying the clause is enough; for negative operators
           every eligible contract has to satisfy it, which falls out of the same call
           when applied per contract. */
        const negative = /^not/.test(cond.operator || '');
        const perContract = eligible.map(c => applyOperator(cond.operator, contractReader(c), cond.values));
        result = perContract.length === 0 ? false
          : negative ? perContract.every(Boolean) : perContract.some(Boolean);
        detail = U.uniq(eligible.flatMap(c => contractReader(c)).filter(Boolean)).join(', ') || '—';
      } else if (personReader) {
        const found = personReader(person);
        result = applyOperator(cond.operator, found, cond.values);
        detail = found.join(', ') || '—';
      } else {
        indeterminate = true;                                  // facet not recognised
        detail = 'facet not recognised';
      }

      if (result === null) indeterminate = true;
      clauses.push({ facet: cond.facet, operator: cond.operator, raw: cond.raw, result, detail });
    }

    const decided = clauses.every(c => c.result === true);
    return {
      matches: indeterminate ? null : decided,
      clauses,
      contracts: eligible
    };
  }

  /**
   * Evaluate every live rule against every person.
   * @returns {{perPerson:Map, perRule:Map, stats:Object}}
   */
  function evaluateAll(ruleSet, vault, opts) {
    const when = (opts && opts.when) || new Date();
    const includeDrafts = !!(opts && opts.includeDrafts);
    const rules = ruleSet.rules.filter(r =>
      includeDrafts || r.status === 'published' || r.status === 'enabled');

    const perPerson = new Map();
    const perRule = new Map(rules.map(r => [r.name, { rule: r, matched: [], indeterminate: [], blockingClauses: U.counts([]) }]));

    for (const person of vault.persons) {
      const matchedRules = [];
      const unknownRules = [];
      for (const rule of rules) {
        const res = evaluateRule(rule, person, when);
        const bucket = perRule.get(rule.name);
        if (res.matches === true) { matchedRules.push({ rule, res }); bucket.matched.push(person); }
        else if (res.matches === null) { unknownRules.push({ rule, res }); bucket.indeterminate.push(person); }
        else {
          /* Record which clause did the excluding: that is the answer to "why does this
             rule select nobody". */
          const blocker = res.clauses.find(c => c.result === false);
          if (blocker) bucket.blockingClauses.set(blocker.facet, (bucket.blockingClauses.get(blocker.facet) || 0) + 1);
        }
      }
      perPerson.set(person.personId, { person, matchedRules, unknownRules });
    }

    const evaluated = rules.length;
    return {
      perPerson, perRule, when, rulesEvaluated: evaluated,
      stats: {
        persons: vault.persons.length,
        rules: evaluated,
        personsWithRule: Array.from(perPerson.values()).filter(x => x.matchedRules.length).length,
        personsIndeterminate: Array.from(perPerson.values()).filter(x => !x.matchedRules.length && x.unknownRules.length).length,
        rulesMatchingNobody: Array.from(perRule.values()).filter(x => !x.matched.length).length
      }
    };
  }

  HR.evaluate = { evaluateRule, evaluateAll, applyOperator, parseTimeFrame, contractInWindow };
})(window.HR);
