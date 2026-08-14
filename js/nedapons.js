/* Nedap ONS workbench logic. Customers feed the HelloID Nedap ONS target
   connector from the "NEDAP - Matrices functies deskundigheden" Excel workbook:
   two scope-mapping tabs (teams / locations) and the Medewerkers-koppeling tab
   are exported by hand to CSV, with hidden helper formulas translating names to
   IDs. This module replaces that: parse the workbook once, keep an editable
   "book" in config, validate against the imported vault, and build the three
   connector CSVs deterministically.

   The book stores what the workbook stores — NAMES. IDs resolve through the
   lookup lists (which the workbook also carries) at export/validation time, so
   an unresolved name is a visible finding instead of a silent broken formula.

   Matching semantics mirror ons_auth_manage/helloid connector scripts: a scope
   row matches a contract when the department equals AND the title equals or is
   empty (wildcard). CSV shapes follow the legacy HelloID mapping CSVs:
   Department.ExternalId;Title.ExternalId;NedapTeamIds;AllEmployees (teams),
   same with NedapLocationIds;AllClients (locations), and the Medewerkers tab
   column-for-column. */
(function () {
  'use strict';

  const SHEETS = {
    teamMapping: 'Mapping Teams (Mw bereik)',
    locationMapping: 'Mapping Locaties (Clnt bereik)',
    employees: 'Medewerkers koppeling',
    roles: 'Autorisatierollen',
    hrDepartments: 'HR Afdelingen',
    hrTitles: 'HR Functies',
    nedapTeams: 'Teams Nedap',
    nedapLocations: 'Locatiegram Nedap',
    expertiseProfiles: 'Deskundigheid Nedap',
    weeksheetProfiles: 'Weekkaartprofiel Nedap'
  };

  const EMP_HEADERS = ['Title.ExternalId', 'Functie HR', 'Department.ExternalId', 'Afdeling HR',
    'educationId', 'Deskundigheidsprofiel (Importcode)', 'registrationProfile', 'Weekkaartprofiel',
    'clusterId', 'Team naam', 'clusterName'];

  function emptyBook() {
    return {
      lookups: { departments: [], titles: [], teams: [], locations: [], expertiseProfiles: [], weeksheetProfiles: [] },
      teamMappings: [], locationMappings: [], employees: [], roles: []
    };
  }

  function isEmptyBook(book) {
    if (!book) return true;
    if (book.started) return false; // blank start: an empty book on purpose
    const l = book.lookups || {};
    return !(book.teamMappings || []).length && !(book.locationMappings || []).length &&
      !(book.employees || []).length && !(book.roles || []).length &&
      !Object.keys(l).some(k => (l[k] || []).length);
  }

  const cell = (row, i) => String((row && row[i]) !== undefined ? row[i] : '').trim();
  const isJa = v => /^ja$/i.test(v);

  /* ---- workbook -> book ---------------------------------------------------- */

  function parseScopeSheet(rows, colRe, out, errors, sheetKey) {
    const header = rows[0] || [];
    const nameCols = [];
    for (let c = 3; c < header.length; c++) if (colRe.test(cell(header, c))) nameCols.push(c);
    if (!nameCols.length) {
      errors.push({ key: 'no.err.noNameCols', args: { sheet: SHEETS[sheetKey] } });
      return;
    }
    for (let r = 1; r < rows.length; r++) {
      const dept = cell(rows[r], 0), title = cell(rows[r], 1);
      const names = nameCols.map(c => cell(rows[r], c)).filter(Boolean);
      if (!dept && !title && !names.length) continue;
      out.push({ dept, title, all: isJa(cell(rows[r], 2)), names });
    }
  }

  function parseLookupSheet(rows, fields) {
    const out = [];
    for (let r = 1; r < (rows || []).length; r++) {
      const item = {};
      fields.forEach((f, i) => { item[f] = cell(rows[r], i); });
      if (item[fields[0]]) out.push(item);
    }
    return out;
  }

  function parseWorkbook(sheets) {
    const book = emptyBook();
    const errors = [];
    const get = key => sheets.get(SHEETS[key]) || null;

    const primary = ['teamMapping', 'locationMapping', 'employees'].filter(k => get(k));
    if (!primary.length) {
      errors.push({ key: 'no.err.noPrimarySheets' });
      return { book, errors };
    }
    ['hrDepartments', 'hrTitles', 'nedapTeams', 'nedapLocations'].forEach(k => {
      if (!get(k)) errors.push({ key: 'no.err.missingLookup', args: { sheet: SHEETS[k] } });
    });

    book.lookups.departments = parseLookupSheet(get('hrDepartments'), ['name', 'code', 'id']);
    book.lookups.titles = parseLookupSheet(get('hrTitles'), ['name', 'code', 'id']);
    book.lookups.teams = parseLookupSheet(get('nedapTeams'), ['name', 'identificationNo', 'id']);
    book.lookups.locations = parseLookupSheet(get('nedapLocations'), ['name', 'identificationNo', 'id']);
    book.lookups.expertiseProfiles = parseLookupSheet(get('expertiseProfiles'), ['name', 'code']);
    book.lookups.weeksheetProfiles = parseLookupSheet(get('weeksheetProfiles'), ['name']);

    if (get('teamMapping')) {
      parseScopeSheet(get('teamMapping'), /^nedap team \d+$/i,
        book.teamMappings = [], errors, 'teamMapping');
      book.teamMappings.forEach(m => { m.teamNames = m.names; delete m.names; });
    }
    if (get('locationMapping')) {
      parseScopeSheet(get('locationMapping'), /^nedap locatie \d+$/i,
        book.locationMappings = [], errors, 'locationMapping');
      book.locationMappings.forEach(m => { m.locationNames = m.names; delete m.names; });
    }

    const emp = get('employees');
    if (emp) {
      const header = (emp[0] || []).map(h => String(h).trim());
      const col = name => header.findIndex(h =>
        h === name || (name === EMP_HEADERS[5] && /^deskundigheidsprofiel/i.test(h)));
      const idx = EMP_HEADERS.map(col);
      if (idx[0] === -1) {
        errors.push({ key: 'no.err.missingColumn', args: { sheet: SHEETS.employees, column: EMP_HEADERS[0] } });
      } else {
        const f = ['titleId', 'titleName', 'deptId', 'deptName', 'educationId', 'expertiseName',
          'registrationProfile', 'weeksheetName', 'clusterId', 'teamName', 'clusterName'];
        for (let r = 1; r < emp.length; r++) {
          const row = {};
          f.forEach((name, i) => { row[name] = idx[i] === -1 ? '' : cell(emp[r], idx[i]); });
          if (Object.keys(row).some(k => row[k])) book.employees.push(row);
        }
      }
    }

    const roles = get('roles');
    if (roles) {
      const header = roles[0] || [];
      const funcCols = [];
      for (let c = 6; c < header.length; c++) if (/^functie \d+$/i.test(cell(header, c))) funcCols.push(c);
      for (let r = 1; r < roles.length; r++) {
        const name = cell(roles[r], 0);
        if (!name) continue;
        book.roles.push({
          name,
          standaardBereik: isJa(cell(roles[r], 1)),
          rolBereik: isJa(cell(roles[r], 2)),
          mijnRooster: isJa(cell(roles[r], 3)),
          mijnPlanning: isJa(cell(roles[r], 4)),
          notes: cell(roles[r], 5),
          functies: funcCols.map(c => cell(roles[r], c)).filter(Boolean)
        });
      }
    }

    return { book, errors };
  }

  /* ---- name -> id resolution ----------------------------------------------- */

  function index(list, key) {
    const map = new Map();
    (list || []).forEach(item => { if (item[key]) map.set(String(item[key]).toLowerCase(), item); });
    return map;
  }

  function resolver(book) {
    /* By name first, by id second: imported connector CSVs carry raw IDs, and
       until somebody names them in the lookup lists the ID doubles as the
       display value. The byId fallback keeps such rows exporting correctly. */
    const pair = list => ({ byName: index(list, 'name'), byId: index(list, 'id') });
    const deps = pair(book.lookups.departments);
    const tits = pair(book.lookups.titles);
    const teams = pair(book.lookups.teams);
    const locs = pair(book.lookups.locations);
    const find = (p, n) => n ? p.byName.get(n.toLowerCase()) || p.byId.get(n.toLowerCase()) || null : null;
    return {
      dept: n => find(deps, n), title: n => find(tits, n),
      team: n => find(teams, n), location: n => find(locs, n)
    };
  }

  /* ---- connector CSVs ------------------------------------------------------ */

  function csvField(v, delim) {
    v = String(v === undefined || v === null ? '' : v);
    return (v.includes(delim) || v.includes('"') || v.includes('\n') || v.includes('\r'))
      ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csvText(headers, rows, delim) {
    return [headers, ...rows].map(r => r.map(f => csvField(f, delim)).join(delim)).join('\r\n') + '\r\n';
  }

  function buildScopeCsv(mappings, nameKey, resolveTarget, idHeader, flagHeader, res, delim) {
    const errors = [];
    const rows = [];
    mappings.forEach((m, i) => {
      const dept = res.dept(m.dept);
      const title = m.title ? res.title(m.title) : null;
      if (!dept) { errors.push({ key: 'no.err.unresolvedDept', args: { row: i + 1, name: m.dept } }); return; }
      if (m.title && !title) { errors.push({ key: 'no.err.unresolvedTitle', args: { row: i + 1, name: m.title } }); return; }
      const ids = [];
      for (const name of m[nameKey]) {
        const t = resolveTarget(name);
        if (!t) { errors.push({ key: 'no.err.unresolvedTarget', args: { row: i + 1, name } }); return; }
        ids.push(t.id);
      }
      /* Official connector format writes the flag as "true" or leaves it empty. */
      rows.push([dept.id, title ? title.id : '', ids.join(','), m.all ? 'true' : '']);
    });
    return {
      csv: csvText(['HelloIDPrimaryLookupKey', 'HelloIDSecondaryLookupKey', idHeader, flagHeader], rows, delim),
      rows: rows.length, errors
    };
  }

  function buildTeamsCsv(book, delim) {
    const res = resolver(book);
    return buildScopeCsv(book.teamMappings, 'teamNames', res.team, 'NedapTeamIds', 'AllEmployees', res, delim || ';');
  }
  function buildLocationsCsv(book, delim) {
    const res = resolver(book);
    return buildScopeCsv(book.locationMappings, 'locationNames', res.location, 'NedapLocationIds', 'AllClients', res, delim || ';');
  }
  function buildEmployeesCsv(book, delim) {
    const f = ['titleId', 'titleName', 'deptId', 'deptName', 'educationId', 'expertiseName',
      'registrationProfile', 'weeksheetName', 'clusterId', 'teamName', 'clusterName'];
    const rows = book.employees.map(e => f.map(k => e[k] || ''));
    return { csv: csvText(EMP_HEADERS, rows, delim || ';'), rows: rows.length, errors: [] };
  }

  /* ---- connector CSV import ------------------------------------------------

     The reverse direction: a running connector's Mapping-Teams.csv /
     Mapping-Locations.csv carries raw IDs (that is what the API takes), while
     the editors here work in names. Accepted headers are the official
     HelloIDPrimaryLookupKey / HelloIDSecondaryLookupKey / NedapTeamIds
     [/ AllEmployees] family (the flag column may be unnamed, legacy style) and
     the Department.ExternalId / Title.ExternalId variant. IDs translate to
     names through the lookup lists; IDs the lists do not know are added to
     them as id-named entries, so the rows edit and export correctly from a
     blank start and pick up readable names the moment somebody fills them in. */

  function parseCsvRows(text, delim) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let field = '', row = [], q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"' && field === '') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.some(f => f.trim() !== '')) rows.push(row);
    }
    return rows;
  }

  const MAPPING_HEADS = {
    primary: ['helloidprimarylookupkey', 'department.externalid'],
    secondary: ['helloidsecondarylookupkey', 'title.externalid'],
    teams: 'nedapteamids', locations: 'nedaplocationids'
  };

  /** null when the text is not a mapping CSV; otherwise which area it feeds. */
  function sniffMappingCsv(text) {
    text = text || '';
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const line = text.split(/\r?\n/, 1)[0].toLowerCase();
    const delim = line.includes(';') ? ';' : ',';
    const cols = line.split(delim).map(s => s.trim().replace(/^"|"$/g, ''));
    if (!MAPPING_HEADS.primary.some(h => cols.includes(h))) return null;
    if (cols.includes(MAPPING_HEADS.teams)) return { area: 'teams', delim };
    if (cols.includes(MAPPING_HEADS.locations)) return { area: 'locations', delim };
    return null;
  }

  function parseMappingCsv(text) {
    const sniff = sniffMappingCsv(text);
    if (!sniff) return { errors: [{ key: 'no.err.csvHeader' }] };
    const raw = parseCsvRows(text, sniff.delim);
    const header = raw[0].map(s => s.trim().toLowerCase());
    const col = names => header.findIndex(h => names.includes(h));
    const pIdx = col(MAPPING_HEADS.primary);
    const sIdx = col(MAPPING_HEADS.secondary);
    const idIdx = header.indexOf(MAPPING_HEADS[sniff.area]);
    const rows = [];
    const errors = [];
    raw.slice(1).forEach((r, i) => {
      const key = (r[pIdx] || '').trim();
      if (!key) { errors.push({ key: 'no.err.csvNoKey', args: { row: i + 2 } }); return; }
      const ids = (r[idIdx] || '').split(',').map(s => s.trim()).filter(Boolean);
      /* The flag either has its own header (AllEmployees/AllClients) or, in
         current-format files, rides unnamed as the column after the IDs. */
      const flagField = r.slice(idIdx + 1).map(s => (s || '').trim()).find(Boolean) || '';
      rows.push({
        key,
        titleKey: sIdx === -1 ? '' : (r[sIdx] || '').trim(),
        ids,
        all: /^true$/i.test(flagField)
      });
    });
    return { area: sniff.area, rows, errors };
  }

  /** Merge a parsed mapping CSV into the book: that area's rows are replaced. */
  function applyMappingImport(book, parsed) {
    const res = resolver(book);
    let added = 0;
    /* The resolver indexes are built once; values added mid-import land in a
       local cache so a key repeated across rows is only added once. */
    const fresh = new Map();
    const ensure = (list, resolveFn, value) => {
      const hit = resolveFn(value);
      if (hit) return hit.name;
      let cache = fresh.get(list);
      if (!cache) { cache = new Map(); fresh.set(list, cache); }
      const k = value.toLowerCase();
      if (cache.has(k)) return cache.get(k);
      list.push(list === book.lookups.teams || list === book.lookups.locations
        ? { name: value, identificationNo: '', id: value }
        : { name: value, code: '', id: value });
      added++;
      cache.set(k, value);
      return value;
    };
    const nameKey = parsed.area === 'teams' ? 'teamNames' : 'locationNames';
    const targetList = parsed.area === 'teams' ? book.lookups.teams : book.lookups.locations;
    const targetRes = parsed.area === 'teams' ? res.team : res.location;
    const mapped = parsed.rows.map(r => ({
      dept: ensure(book.lookups.departments, res.dept, r.key),
      title: r.titleKey ? ensure(book.lookups.titles, res.title, r.titleKey) : '',
      all: r.all,
      [nameKey]: r.ids.map(id => ensure(targetList, targetRes, id))
    }));
    if (parsed.area === 'teams') book.teamMappings = mapped;
    else book.locationMappings = mapped;
    return { area: parsed.area, rows: mapped.length, added };
  }

  /* ---- validation ("sanity") ----------------------------------------------- */

  // Vault-side department/title identity sets, by ExternalId AND by display
  // name, so both the ID-carrying Medewerkers rows and the name-carrying
  // mapping rows can be checked against HR reality.
  function vaultSets(vault) {
    const out = { deptIds: new Set(), deptNames: new Set(), titleIds: new Set(), titleNames: new Set(), any: false };
    if (!vault || !vault.persons) return out;
    vault.persons.forEach(p => (p.contracts || []).forEach(c => {
      if (c.department && c.department.externalId) { out.deptIds.add(c.department.externalId); out.any = true; }
      if (c.department && c.department.name) { out.deptNames.add(c.department.name.toLowerCase()); out.any = true; }
      if (c.title && c.title.externalId) { out.titleIds.add(c.title.externalId); out.any = true; }
      if (c.title && c.title.name) { out.titleNames.add(c.title.name.toLowerCase()); out.any = true; }
    }));
    return out;
  }

  function checkScopeArea(area, mappings, nameKey, resolveTarget, res, hr, issues) {
    const push = (rule, severity, i, m, args) =>
      issues.push({ rule, severity, area, row: i, dept: m.dept, title: m.title,
        msgKey: 'no.chk.' + rule, msgArgs: args || {} });
    const seen = new Map();
    const wildcardByDept = new Map();
    mappings.forEach(m => { if (!m.title) wildcardByDept.set(m.dept.toLowerCase(), m); });

    mappings.forEach((m, i) => {
      const key = m.dept.toLowerCase() + '\u0000' + m.title.toLowerCase();
      if (seen.has(key)) push('duplicate-row', 'warning', i, m, { other: seen.get(key) + 1 });
      else seen.set(key, i);

      if (!res.dept(m.dept)) push('unresolved-name', 'warning', i, m, { name: m.dept });
      if (m.title && !res.title(m.title)) push('unresolved-name', 'warning', i, m, { name: m.title });
      m[nameKey].forEach(n => { if (!resolveTarget(n)) push('unresolved-name', 'warning', i, m, { name: n }); });

      if (m.all && m[nameKey].length) push('redundant-ids', 'warning', i, m, { n: m[nameKey].length });
      if (!m.all && !m[nameKey].length) push('empty-grant', 'info', i, m);

      if (m.title) {
        const w = wildcardByDept.get(m.dept.toLowerCase());
        if (w && (w.all || (!m.all && m[nameKey].every(n => w[nameKey].includes(n))))) {
          push('covered-by-wildcard', 'warning', i, m);
        }
      }

      if (hr.any) {
        const d = res.dept(m.dept);
        if (!hr.deptNames.has(m.dept.toLowerCase()) && !(d && hr.deptIds.has(String(d.id)))) {
          push('unknown-hr', 'warning', i, m, { name: m.dept });
        }
        if (m.title) {
          const t = res.title(m.title);
          if (!hr.titleNames.has(m.title.toLowerCase()) && !(t && hr.titleIds.has(String(t.id)))) {
            push('unknown-hr', 'warning', i, m, { name: m.title });
          }
        }
      }
    });
  }

  function checkBook(book, vault) {
    const issues = [];
    if (isEmptyBook(book)) return issues;
    const res = resolver(book);
    const hr = vaultSets(vault);

    checkScopeArea('teams', book.teamMappings, 'teamNames', res.team, res, hr, issues);
    checkScopeArea('locations', book.locationMappings, 'locationNames', res.location, res, hr, issues);

    const expertiseCodes = new Set(book.lookups.expertiseProfiles.map(p => p.code).filter(Boolean));
    const expertiseNames = new Set(book.lookups.expertiseProfiles.map(p => p.name.toLowerCase()));
    const weeksheetNames = new Set(book.lookups.weeksheetProfiles.map(p => p.name.toLowerCase()));
    const empSeen = new Map();
    book.employees.forEach((e, i) => {
      const push = (rule, severity, args) =>
        issues.push({ rule, severity, area: 'employees', row: i, dept: e.deptName, title: e.titleName,
          msgKey: 'no.chk.' + rule, msgArgs: args || {} });
      const key = e.titleId + '\u0000' + e.deptId;
      const prior = empSeen.get(key);
      if (prior !== undefined) {
        const p = book.employees[prior];
        if (p.weeksheetName !== e.weeksheetName) push('weeksheet-conflict', 'warning', { other: prior + 1 });
        else push('duplicate-row', 'warning', { other: prior + 1 });
      } else empSeen.set(key, i);
      if (e.educationId && expertiseCodes.size && !expertiseCodes.has(e.educationId)) {
        push('unresolved-name', 'warning', { name: e.educationId });
      }
      if (e.expertiseName && expertiseNames.size && !expertiseNames.has(e.expertiseName.toLowerCase())) {
        push('unresolved-name', 'warning', { name: e.expertiseName });
      }
      if (e.weeksheetName && weeksheetNames.size && !weeksheetNames.has(e.weeksheetName.toLowerCase())) {
        push('unresolved-name', 'warning', { name: e.weeksheetName });
      }
      if (hr.any) {
        if (e.deptId && !hr.deptIds.has(e.deptId) && !(e.deptName && hr.deptNames.has(e.deptName.toLowerCase()))) {
          push('unknown-hr', 'warning', { name: e.deptName || e.deptId });
        }
        if (e.titleId && !hr.titleIds.has(e.titleId) && !(e.titleName && hr.titleNames.has(e.titleName.toLowerCase()))) {
          push('unknown-hr', 'warning', { name: e.titleName || e.titleId });
        }
      }
    });

    const roleSeen = new Map();
    book.roles.forEach((r, i) => {
      const push = (rule, severity, args) =>
        issues.push({ rule, severity, area: 'roles', row: i, dept: '', title: r.name,
          msgKey: 'no.chk.' + rule, msgArgs: args || {} });
      const key = r.name.toLowerCase();
      if (roleSeen.has(key)) push('duplicate-row', 'warning', { other: roleSeen.get(key) + 1 });
      else roleSeen.set(key, i);
      r.functies.forEach(f => { if (!res.title(f)) push('unresolved-name', 'warning', { name: f }); });
      if (!r.functies.length) push('empty-grant', 'info');
    });

    return issues;
  }

  /* ---- coverage + simulator ------------------------------------------------ */

  // A scope row matches a contract when the department equals AND the title
  // equals or the row is title-wildcard — the connector's semantics. Rows and
  // contracts may know names, IDs or both; either identity matching counts.
  function rowMatches(m, c, res) {
    const d = res.dept(m.dept);
    const deptOk = (d && c.departmentId && String(d.id) === String(c.departmentId)) ||
      (m.dept && c.department && m.dept.toLowerCase() === c.department.toLowerCase());
    if (!deptOk) return false;
    if (!m.title) return true;
    const t = res.title(m.title);
    return (t && c.titleId && String(t.id) === String(c.titleId)) ||
      (c.title && m.title.toLowerCase() === c.title.toLowerCase());
  }

  function personContracts(p) {
    // Running contracts drive provisioning; fall back to all contracts for
    // people with none running (same choice model.js makes for employers).
    const list = (p.activeContracts && p.activeContracts.length) ? p.activeContracts : (p.contracts || []);
    return list.map(c => ({
      department: (c.department && c.department.name) || '',
      departmentId: (c.department && c.department.externalId) || '',
      title: (c.title && c.title.name) || '',
      titleId: (c.title && c.title.externalId) || ''
    })).filter(c => c.department || c.departmentId || c.title || c.titleId);
  }

  function coverage(book, vault) {
    const out = { total: 0, uncovered: [] };
    if (!vault || !vault.persons || isEmptyBook(book)) return out;
    if (!book.teamMappings.length && !book.locationMappings.length) return out;
    const res = resolver(book);
    const scopeRows = [...book.teamMappings, ...book.locationMappings];
    vault.persons.forEach(p => {
      const contracts = personContracts(p);
      if (!contracts.length) return;
      out.total++;
      const hit = contracts.some(c => scopeRows.some(m => rowMatches(m, c, res)));
      if (!hit) out.uncovered.push({ person: p, contracts });
    });
    return out;
  }

  function effectiveFor(contracts, book) {
    const res = resolver(book);
    const scope = (mappings, nameKey) => {
      const names = new Map(); // name -> {ids, sources}
      let all = false;
      const sources = [];
      mappings.forEach((m, i) => {
        if (!contracts.some(c => rowMatches(m, c, res))) return;
        sources.push({ row: i, dept: m.dept, title: m.title });
        all = all || m.all;
        m[nameKey].forEach(n => {
          const e = names.get(n) || { name: n, rows: [] };
          e.rows.push(i);
          names.set(n, e);
        });
      });
      return { names: [...names.values()], all, sources };
    };
    const teams = scope(book.teamMappings, 'teamNames');
    const locations = scope(book.locationMappings, 'locationNames');

    const employees = book.employees.map((e, i) => ({ e, i })).filter(({ e }) =>
      contracts.some(c =>
        (e.deptId && c.departmentId && e.deptId === c.departmentId) ||
        (e.deptName && c.department && e.deptName.toLowerCase() === c.department.toLowerCase())
      ) && contracts.some(c =>
        (e.titleId && c.titleId && e.titleId === c.titleId) ||
        (e.titleName && c.title && e.titleName.toLowerCase() === c.title.toLowerCase())
      ));

    const roles = book.roles.map((r, i) => ({ r, i })).filter(({ r }) =>
      r.functies.some(f => contracts.some(c => {
        const t = res.title(f);
        return (t && c.titleId && String(t.id) === String(c.titleId)) ||
          (c.title && f.toLowerCase() === c.title.toLowerCase());
      })));

    const matched = teams.sources.length || locations.sources.length || employees.length || roles.length;
    return { teams, locations, employees, roles, matched: !!matched };
  }

  window.HR = window.HR || {};
  window.HR.nedapons = {
    SHEETS, EMP_HEADERS, emptyBook, isEmptyBook, parseWorkbook, resolver,
    buildTeamsCsv, buildLocationsCsv, buildEmployeesCsv,
    sniffMappingCsv, parseMappingCsv, applyMappingImport,
    checkBook, coverage, effectiveFor, personContracts
  };
})();
