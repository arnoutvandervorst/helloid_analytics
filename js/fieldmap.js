/* HelloID target-connector field mappings, imported and simulated.

   The v1 MappingFields JSON is the complete contract of a modern target
   connector: per target attribute, per provisioning action, either a fixed
   value, a Person field path, a Complex JavaScript expression, or None
   (declared but deliberately not written). Importing it here answers the
   question no HelloID screen answers before the run: WHAT WOULD AN UPDATE
   ACTUALLY CHANGE — every mapped attribute evaluated against the real
   population and diffed against what the collected AD/Entra directory holds
   today.

   Faithfulness notes that shaped this module:
   - `Value` is double-encoded (a JSON string containing JSON); `None` carries
     "null". Parse twice, tolerate already-plain values.
   - A field holds several disjoint action-sets; None on Update means the
     attribute is out of scope for drift, never "would become empty".
   - Complex mappings are real JavaScript ending in a bare call (or a bare
     expression). This is the one place the app executes imported code — by
     design, because simulating the connector faithfully IS executing its
     mapping. Containment: each field runs against a fresh copy of the Person
     (mappings in the wild mutate it), receives only the globals HelloID
     provides (Person, Iteration, deleteDiacriticalMarks), and every throw
     becomes a reported result instead of a broken run. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const HELPER_URL = 'github.com/Tools4everBV/HelloID-Lib-Prov-HelperFunctions';

  const looksLikeFieldMapping = data => !!data && data.Version === 'v1' &&
    Array.isArray(data.MappingFields);
  const looksLikeSourceMapping = data => !!data &&
    (Array.isArray(data.personMappings) || Array.isArray(data.contractMappings));

  /* ---- parsing ------------------------------------------------------------ */

  function decodeValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (e) { return raw; } // already plain
  }

  function parse(text, fileName) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Field mapping is not valid JSON: ' + e.message); }
    if (looksLikeSourceMapping(data)) throw new Error('SOURCE_MAPPING');
    if (!looksLikeFieldMapping(data)) {
      throw new Error('Not a HelloID field mapping (expected Version "v1" with MappingFields).');
    }
    const unique = new Set((data.UniqueFieldNames || []).map(n => String(n)));
    const warnings = [];
    const fields = (data.MappingFields || []).map(f => {
      const actions = (f.MappingActions || []).map(a => ({
        actions: (a.MapForActions || []).slice(),
        mode: a.MappingMode || 'None',
        value: a.MappingMode === 'None' ? null : decodeValue(a.Value),
        store: !!a.StoreInAccountData
      }));
      return {
        name: String(f.Name || ''),
        description: String(f.Description || ''),
        type: f.Type === 'Array' ? 'Array' : 'Text',
        unique: unique.has(f.Name),
        standard: actions.some(a => a.mode === 'Complex' &&
          typeof a.value === 'string' && a.value.includes(HELPER_URL)),
        actions
      };
    }).filter(f => f.name);
    if (!fields.length) warnings.push('Mapping contains no fields.');
    return {
      fileName: fileName || 'fieldMapping.json',
      fields,
      uniqueFieldNames: [...unique],
      warnings,
      counts: {
        fields: fields.length,
        complex: fields.filter(f => f.actions.some(a => a.mode === 'Complex')).length,
        updateScoped: fields.filter(f => {
          const s = actionFor(f, 'Update');
          return s && s.mode !== 'None';
        }).length,
        unique: unique.size
      }
    };
  }

  /** The action-set governing one provisioning action, or null when undeclared. */
  function actionFor(field, action) {
    return field.actions.find(a => a.actions.includes(action)) || null;
  }

  /* ---- evaluation --------------------------------------------------------- */

  /* HelloID's platform helper; same full-NFD strip the namegen lab uses,
     deliberately wider than the product's own (its gaps are a known
     complaint). */
  function deleteDiacriticalMarks(s) {
    return String(s === undefined || s === null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function pathGet(obj, path) {
    let cur = obj;
    for (const part of String(path || '').split('.')) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  /* The trailing bare call IS the mapping's return value; a bare expression
     has no call at all. Ported from the viga importer's wrapComplex. */
  function wrapComplex(code) {
    let body = String(code || '').trim();
    const rewritten = body.replace(/(^|\n)\s*([A-Za-z_$][\w$]*\s*\([^)]*\))\s*;?\s*$/,
      (m, pre, call) => pre + 'return ' + call + ';');
    if (rewritten !== body) return rewritten;
    if (!/\breturn\b/.test(body)) return 'return (' + body + ');';
    return body;
  }

  function clonePerson(p) {
    try { return structuredClone(p); }
    catch (e) { return JSON.parse(JSON.stringify(p)); }
  }

  /**
   * @returns {{value:*}|{error:string}} — Fixed passes the literal through
   * (a single space is a legitimate "empty but non-null" sentinel).
   */
  function evaluateField(field, actionSet, personObj, opts) {
    const iteration = (opts && opts.iteration) || 0;
    if (!actionSet || actionSet.mode === 'None') return { value: undefined, scope: 'none' };
    if (actionSet.mode === 'Fixed') return { value: actionSet.value };
    if (actionSet.mode === 'Field') {
      const path = String(actionSet.value || '');
      const v = pathGet({ Person: personObj }, path.startsWith('Person') ? path : 'Person.' + path);
      return { value: v };
    }
    // Complex — the function is compiled once per action-set and cached on it:
    // a 6000-user simulation would otherwise compile the same source per row.
    try {
      if (!actionSet._fn) {
        actionSet._fn = new Function('Person', 'Iteration', 'deleteDiacriticalMarks',
          wrapComplex(actionSet.value));
      }
      return { value: actionSet._fn(clonePerson(personObj), iteration, deleteDiacriticalMarks) };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* ---- the evaluation-side Person objects --------------------------------- */

  /**
   * Genuine PascalCase Persons when a real vault is loaded (the raw text is
   * kept precisely for cases like this); a reconstruction from the collected
   * directory otherwise — good fidelity for AD-source mappings, and the UI
   * says which one it got.
   */
  function personObjects(state) {
    if (state.vault && state.raw.vault) {
      try {
        const persons = JSON.parse(state.raw.vault).Persons || [];
        return { persons, reconstructed: false };
      } catch (e) { /* fall through to reconstruction */ }
    }
    const dir = state.directory;
    if (!dir) return { persons: [], reconstructed: false };
    const persons = dir.users.map(u => ({
      PersonId: u.id,
      ExternalId: String(u.employeeId || ''),
      DisplayName: u.displayName,
      Name: {
        GivenName: u.givenName || '', NickName: u.givenName || '',
        Initials: u.initials || '',
        FamilyName: u.surname || '', FamilyNamePrefix: '',
        FamilyNamePartner: '', FamilyNamePartnerPrefix: '',
        Convention: 'B'
      },
      Contact: {
        Business: {
          Email: u.mail || '',
          Phone: { Fixed: u.phone || '', Mobile: u.mobile || '' },
          Address: { Street: u.street || '', PostalCode: u.postalCode || '',
            Locality: u.city || '', Country: u.country || '' }
        },
        Personal: { Email: '' }
      },
      Custom: Object.assign({}, u.extensionAttributes || {}),
      PrimaryContract: {
        StartDate: u.hireDate || null, EndDate: null,
        Department: { DisplayName: u.department || '', ExternalId: u.department || '' },
        Title: { Name: u.title || '', Code: '', ExternalId: u.title || '' },
        Employer: { Name: u.company || '' }
      },
      PrimaryManager: { DisplayName: u.managerName || '', Email: '' },
      Accounts: {}
    }));
    return { persons, reconstructed: true };
  }

  /** Person.Accounts.<System> from the collected user — spaced and de-spaced keys. */
  function accountsFor(user, systemName) {
    const acc = {
      sAMAccountName: user.userName, userPrincipalName: user.upn || '',
      mail: user.mail || '', displayName: user.displayName || '',
      mailNickname: user.mailNickname || '', employeeId: user.employeeId || '',
      proxyAddresses: user.proxyAddresses || []
    };
    const out = {};
    out[systemName] = acc;
    out[systemName.replace(/\s+/g, '')] = acc;
    if (/entra|azure/i.test(systemName)) out.MicrosoftActiveDirectory = acc; // chained reads
    return out;
  }

  /* ---- the simulation ------------------------------------------------------ */

  /* Mapping field name -> where the collected directory keeps the current
     value. AD ldap names and Graph names both appear in real mappings. */
  const ATTR_ALIASES = {
    samaccountname: 'userName', userprincipalname: 'upn', upn: 'upn',
    sn: 'surname', surname: 'surname', givenname: 'givenName',
    displayname: 'displayName', mail: 'mail', mailnickname: 'mailNickname',
    proxyaddresses: 'proxyAddresses',
    employeeid: 'employeeId', employeenumber: 'employeeId',
    title: 'title', jobtitle: 'title',
    department: 'department', company: 'company', companyname: 'company',
    physicaldeliveryofficename: 'office', officelocation: 'office',
    telephonenumber: 'phone', businessphones: 'phone',
    mobile: 'mobile', mobilephone: 'mobile',
    streetaddress: 'street', l: 'city', city: 'city', st: 'state', state: 'state',
    postalcode: 'postalCode', c: 'country', country: 'country',
    info: 'notes', description: 'description', initials: 'initials',
    usagelocation: 'usageLocation', accountenabled: 'enabled',
    employeetype: 'employeeType'
  };

  function currentValueOf(user, fieldName) {
    const lower = fieldName.toLowerCase();
    const extM = /^extensionattribute(\d{1,2})$/.exec(lower);
    if (extM) {
      return { known: true, value: (user.extensionAttributes || {})['extensionAttribute' + extM[1]] };
    }
    const alias = ATTR_ALIASES[lower];
    if (!alias) return { known: false };
    return { known: true, value: user[alias] };
  }

  const normStr = v => String(v === undefined || v === null ? '' : v).trim();

  function sameValue(current, desired) {
    if (Array.isArray(desired) || Array.isArray(current)) {
      const set = a => new Set((Array.isArray(a) ? a : (a ? [a] : []))
        .map(x => normStr(x).toLowerCase()));
      const A = set(current), B = set(desired);
      return A.size === B.size && [...A].every(x => B.has(x));
    }
    const c = normStr(current), d = normStr(desired);
    const boolish = s => /^(true|false)$/i.test(s);
    if (boolish(c) || boolish(d) || typeof current === 'boolean' || typeof desired === 'boolean') {
      return normStr(current).toLowerCase() === normStr(desired).toLowerCase();
    }
    return c === d;
  }

  function simulate(mapping, state, opts) {
    const action = (opts && opts.action) || 'Update';
    const dir = state.directory;
    if (!dir) return { unavailable: 'no-directory' };
    const { persons, reconstructed } = personObjects(state);
    if (!persons.length) return { unavailable: 'no-persons' };

    /* join: person -> collected user */
    const byName = new Map();
    const byId = new Map();
    dir.users.forEach(u => {
      byName.set(String(u.userName).toLowerCase(), u);
      if (u.upn) byName.set(String(u.upn).toLowerCase().split('@')[0], u);
      byId.set(u.id, u);
    });
    const inScope = mapping.fields
      .map(f => ({ field: f, set: actionFor(f, action) }))
      .filter(x => x.set && x.set.mode !== 'None');

    const rows = [];
    const perField = new Map(inScope.map(x => [x.field.name,
      { name: x.field.name, mode: x.set.mode, evaluated: 0, changed: 0, errors: 0,
        noCounterpart: !currentValueOf(dir.users[0] || {}, x.field.name).known }]));
    let joined = 0;

    for (const raw of persons) {
      /* raw vault persons: find the collected account via Accounts[] userName;
         reconstructed persons: PersonId === directory user id */
      let user = byId.get(raw.PersonId) || null;
      if (!user && Array.isArray(raw.Accounts)) {
        for (const a of raw.Accounts) {
          const d = a.Data || {};
          user = byName.get(String(d.sAMAccountName || d.userName || d.UserName ||
            (d.userPrincipalName || '').split('@')[0] || '').toLowerCase());
          if (user) break;
        }
      }
      if (!user && raw.DisplayName) {
        user = dir.users.find(u => u.displayName === raw.DisplayName) || null; // last resort
      }
      if (!user) continue;
      joined++;

      const personObj = clonePerson(raw);
      /* HelloID exposes Accounts as an object keyed by system; the raw vault
         carries an array — replace it with the collected account's view so
         Person.Accounts.<System>.<attr> chains resolve. */
      personObj.Accounts = accountsFor(user, dir.system);

      const values = {};
      let anyChange = false;
      for (const { field, set } of inScope) {
        const res = evaluateField(field, set, personObj, { iteration: 0 });
        const agg = perField.get(field.name);
        agg.evaluated++;
        if (res.error) {
          agg.errors++;
          values[field.name] = { error: res.error };
          continue;
        }
        const cur = currentValueOf(user, field.name);
        const changed = cur.known ? !sameValue(cur.value, res.value) : false;
        if (changed) { agg.changed++; anyChange = true; }
        values[field.name] = {
          current: cur.known ? cur.value : undefined,
          desired: res.value, changed, known: cur.known
        };
      }
      rows.push({ user, person: raw, values, anyChange });
    }

    return {
      action, reconstructed, joined,
      total: persons.length,
      rows,
      perField: [...perField.values()].sort((a, b) => b.changed - a.changed || b.errors - a.errors),
      stats: {
        fieldsInScope: inScope.length,
        changes: U.sum([...perField.values()], f => f.changed),
        errors: U.sum([...perField.values()], f => f.errors),
        peopleChanged: rows.filter(r => r.anyChange).length
      }
    };
  }

  HR.fieldmap = { looksLikeFieldMapping, looksLikeSourceMapping, parse, actionFor,
    evaluateField, personObjects, accountsFor, simulate, wrapComplex,
    deleteDiacriticalMarks, ATTR_ALIASES };
})(window.HR);
