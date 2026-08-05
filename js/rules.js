/* HelloID business-rule export: parsing and normalisation.
   Header: Name,EntitlementCount,PersonsLatestEvaluation,Categories,Status,Conditions,Entitlements

   Two fields carry structure inside one CSV cell, both pipe-separated:

     Conditions    "Person: active|Time frame: days before start ...: 14, days after ...: 90|
                    Department.ExternalId, one of: 1200, 1300"
     Entitlements  "Microsoft Active Directory - Account|
                    Microsoft Active Directory - APP-Intranet (avo.local/Demoset/Groups/APP-Intranet)"

   Rules stack: a person matching several rules receives the union of their
   entitlements, so an entitlement counts as modelled when *any* rule grants it. */
(function (HR) {
  'use strict';

  const RULE_HEADERS = ['name', 'entitlementcount', 'personslatestevaluation', 'categories',
    'status', 'conditions', 'entitlements'];

  /** Does this parsed CSV look like a rules export rather than a reconciliation one? */
  function looksLikeRules(header) {
    const norm = header.map(h => String(h || '').toLowerCase().replace(/[^a-z]/g, ''));
    return RULE_HEADERS.filter(h => norm.includes(h)).length >= 5;
  }

  /* Operators appear appended to the facet, before the colon: "Department.ExternalId, one of" */
  const OPERATORS = ['one of', 'not only', 'not', 'is empty', 'is not empty', 'contains', 'starts with'];

  /** "Department.ExternalId, one of: 1200, 1300" -> {facet, operator, values, raw} */
  function parseCondition(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const idx = text.indexOf(':');
    if (idx < 0) return { facet: text, operator: null, values: [], raw: text };

    let key = text.slice(0, idx).trim();
    const rest = text.slice(idx + 1).trim();

    let operator = null;
    for (const op of OPERATORS) {
      const suffix = ', ' + op;
      if (key.toLowerCase().endsWith(suffix)) {
        operator = op;
        key = key.slice(0, -suffix.length).trim();
        break;
      }
    }

    /* "Time frame" keeps sub-clauses of the form "days before ...: 14, days after ...: 90",
       which must not be split on the comma like a value list. */
    const isTimeFrame = /^time ?frame$/i.test(key);
    const unquote = v => v.replace(/^['"]|['"]$/g, '').trim();
    const values = isTimeFrame ? [rest]
      : rest.split(',').map(v => unquote(v.trim())).filter(Boolean);

    return { facet: key, operator, values, raw: text, timeFrame: isTimeFrame };
  }

  /** "Microsoft Active Directory - APP-X (avo.local/OU/APP-X)" -> normalised entitlement */
  function parseEntitlement(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const sep = text.indexOf(' - ');
    const system = sep > 0 ? text.slice(0, sep).trim() : '';
    const remainder = sep > 0 ? text.slice(sep + 3).trim() : text;

    /* A rule that grants "<System> - Account" provisions the account itself, not a group. */
    if (/^account$/i.test(remainder)) {
      return { system, name: 'Account', path: '', isAccount: true, raw: text };
    }
    /* Path-aware: "Team (Amsterdam)" keeps its brackets, "APP-X (domain/OU/APP-X)" splits. */
    const sp = HR.parse.splitPath(remainder);
    return {
      system,
      name: sp.name,
      path: sp.path,
      isAccount: false,
      raw: text
    };
  }

  const splitCell = cell => String(cell || '').split('|').map(s => s.trim()).filter(Boolean);

  /**
   * @param {string} text raw CSV
   * @returns {{rules:Array, meta:Object, warnings:Array<string>}}
   */
  function parse(text, fileName) {
    const delim = HR.parse.sniffDelim(text);
    const grid = HR.parse.parseDelimited(text, delim)
      .filter(r => r.length && !(r.length === 1 && r[0].trim() === ''));
    if (!grid.length) throw new Error('Rules export is empty.');

    const header = grid[0].map(h => h.trim());
    if (!looksLikeRules(header)) {
      throw new Error('Not a business-rule export — expected columns Name, Status, Conditions, Entitlements. Found: ' + header.join(', '));
    }
    const col = {};
    header.forEach((h, i) => { col[h.toLowerCase().replace(/[^a-z]/g, '')] = i; });
    const get = (row, key) => col[key] == null ? '' : (row[col[key]] || '').trim();

    const rules = [];
    const warnings = [];
    let skipped = 0;
    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const name = get(row, 'name');
      if (!name) { skipped++; continue; }
      const entitlements = splitCell(get(row, 'entitlements')).map(parseEntitlement).filter(Boolean);
      const conditions = splitCell(get(row, 'conditions')).map(parseCondition).filter(Boolean);
      const declared = parseInt(get(row, 'entitlementcount'), 10);
      const persons = parseInt(get(row, 'personslatestevaluation'), 10);

      if (!isNaN(declared) && declared !== entitlements.length) {
        warnings.push('Rule "' + name + '" declares ' + declared + ' entitlements but lists ' + entitlements.length + '.');
      }

      rules.push({
        i: rules.length,
        name,
        status: (get(row, 'status') || 'unknown').toLowerCase(),
        categories: splitCell(get(row, 'categories')),
        personsEvaluated: isNaN(persons) ? null : persons,
        entitlementCount: isNaN(declared) ? entitlements.length : declared,
        entitlements,
        conditions,
        /* Conditions beyond the two every rule carries decide how narrow a rule is. */
        scopingConditions: conditions.filter(c => !/^person$/i.test(c.facet) && !c.timeFrame),
        systems: HR.util.uniq(entitlements.map(e => e.system).filter(Boolean)),
        raw: { conditions: get(row, 'conditions'), entitlements: get(row, 'entitlements') }
      });
    }
    if (!rules.length) throw new Error('Rules export contained a header but no rules.');
    if (skipped) warnings.push(skipped + ' row(s) skipped: no rule name on the line.');

    return {
      rules,
      warnings,
      meta: {
        fileName: fileName || 'rules.csv',
        delimiter: delim,
        ruleCount: rules.length,
        health: { dataRows: grid.length - 1, kept: rules.length, skippedEmpty: skipped, shortRows: 0 },
        fingerprint: HR.util.hash(text.length + '|' + rules.length + '|' + text.slice(0, 4096))
      }
    };
  }

  HR.rules = { parse, looksLikeRules, parseCondition, parseEntitlement };
})(window.HR);
