/* CSV parsing + normalisation of a HelloID reconciliation export. */
(function (HR) {
  'use strict';

  /**
   * Decode a file into text before any parsing happens.
   *
   * Reading everything as UTF-8 is wrong often enough to matter: Windows PowerShell 5.1
   * writes UTF-16LE from Export-Csv by default, and older tooling still emits CP1252.
   * Both produce a file that parses "successfully" into mangled names, which is worse
   * than failing outright — so the encoding is detected rather than assumed.
   *
   * @param {ArrayBuffer|Uint8Array} buffer
   * @returns {{text:string, encoding:string}}
   */
  function decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    /* A byte-order mark settles it outright. */
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8 (BOM)' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le (BOM)' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be (BOM)' };
    }

    /* No BOM: UTF-16 text is full of NUL bytes, and which half of each pair they land in
       gives away the byte order. ASCII-heavy CSV makes this reliable. */
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
    let nullEven = 0, nullOdd = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) { if (i % 2) nullOdd++; else nullEven++; }
    }
    const nulls = nullEven + nullOdd;
    if (nulls > sample.length / 8) {
      const le = nullOdd >= nullEven;
      return {
        text: new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes),
        encoding: le ? 'utf-16le' : 'utf-16be'
      };
    }

    /* Otherwise assume UTF-8, but verify: a strict decode that throws means the file is
       a single-byte encoding, and CP1252 is the one these exports come in. */
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch (e) {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    }
  }

  /** RFC4180 parser: quoted fields, embedded delimiters/newlines, CRLF, BOM. */
  function parseDelimited(text, delim) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = '', i = 0, inQ = false;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** Guess the delimiter from the header line — Dutch exports often use ';'. */
  function sniffDelim(text) {
    const line = text.split(/\r?\n/, 1)[0] || '';
    const cands = [',', ';', '\t', '|'];
    let best = ',', bestN = -1;
    for (const d of cands) {
      const n = parseDelimited(line + '\n', d)[0].length;
      if (n > bestN) { bestN = n; best = d; }
    }
    return best;
  }

  /* Canonical field -> accepted header spellings (lowercased, non-alnum stripped). */
  const ALIASES = {
    system: ['system', 'systemname', 'targetsystem', 'systeem'],
    person: ['person', 'persondisplayname', 'persoon', 'employee'],
    accountDisplayName: ['accountdisplayname', 'accountname', 'displayname'],
    accountUserName: ['accountusername', 'username', 'samaccountname', 'userprincipalname', 'accountlogin'],
    accountEnabled: ['accountenabled', 'enabled', 'isenabled', 'accountactive'],
    permission: ['permissiondisplayname', 'permission', 'permissionname', 'entitlement'],
    permissionConfig: ['permissionconfigurationdisplayname', 'permissionconfiguration', 'configuration'],
    subPermission: ['subpermissiondisplayname', 'subpermission'],
    issue: ['issue', 'issuetype', 'finding'],
    resolution: ['resolution', 'resolutiontype', 'action']
  };

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function mapHeaders(header) {
    const map = {};
    header.forEach((h, idx) => {
      const k = norm(h);
      for (const field in ALIASES) if (ALIASES[field].includes(k)) { map[field] = idx; return; }
    });
    return map;
  }

  const TRUE_SET = new Set(['true', '1', 'yes', 'y', 'ja', 'enabled', 'active', 'waar']);
  const FALSE_SET = new Set(['false', '0', 'no', 'n', 'nee', 'disabled', 'inactive', 'onwaar']);
  function parseBool(v) {
    const s = String(v || '').trim().toLowerCase();
    if (TRUE_SET.has(s)) return true;
    if (FALSE_SET.has(s)) return false;
    return null;
  }

  /* "Karin Aarts (500038)" -> {name, externalId} ; "APP-X (avo.local/OU/APP-X)" -> {name, path} */
  function splitParenthetical(raw) {
    const s = String(raw || '').trim();
    if (!s) return { name: '', extra: '' };
    const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!m) return { name: s, extra: '' };
    return { name: m[1].trim(), extra: m[2].trim() };
  }

  /* A trailing parenthetical is a location only when it looks like one — a DN, an OU
     path, a UNC path or a dotted domain. "Team (Amsterdam)" is a name with brackets in
     it, and splitting it would corrupt both halves and break the rule join. */
  const PATHISH = /[\/\\=]|^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
  function splitPath(raw) {
    const s = String(raw || '').trim();
    if (!s) return { name: '', path: '' };
    const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && PATHISH.test(m[2].trim())) return { name: m[1].trim(), path: m[2].trim() };
    return { name: s, path: '' };
  }

  /** Header-only check, so a file can be routed without parsing 50k rows first. */
  function looksLikeRecon(header) {
    const map = mapHeaders(header.map(h => String(h || '').trim()));
    return map.accountUserName != null && map.issue != null;
  }

  /**
   * Parse raw CSV text into normalised records.
   * @returns {{records:Array, meta:Object, warnings:Array<string>}}
   */
  function parse(text, fileName) {
    const delim = sniffDelim(text);
    const grid = parseDelimited(text, delim).filter(r => r.length && !(r.length === 1 && r[0].trim() === ''));
    if (!grid.length) throw new Error('CSV is empty.');
    const header = grid[0].map(h => h.trim());
    const map = mapHeaders(header);
    const warnings = [];
    const required = ['accountUserName', 'issue'];
    const missing = required.filter(f => map[f] == null);
    if (missing.length) {
      throw new Error('Not a recognisable reconciliation export — missing column(s): ' +
        missing.join(', ') + '. Found headers: ' + header.join(', '));
    }
    ['system', 'person', 'permission', 'accountEnabled'].forEach(f => {
      if (map[f] == null) warnings.push('Column "' + f + '" not found; related analytics will be limited.');
    });

    const g = (row, f) => map[f] == null ? '' : (row[map[f]] || '').trim();
    const records = [];
    const health = { dataRows: 0, kept: 0, skippedEmpty: 0, shortRows: 0 };
    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      health.dataRows++;
      if (row.length < header.length) health.shortRows++;
      const userName = g(row, 'accountUserName');
      const issue = g(row, 'issue');
      if (!userName && !issue) { health.skippedEmpty++; continue; }
      health.kept++;
      const personRaw = g(row, 'person');
      const permRaw = g(row, 'permission');
      const perm = splitPath(permRaw);
      records.push({
        i: records.length,
        system: g(row, 'system') || 'Unknown system',
        personRaw,
        /* The person column is a display name, nothing more. Some tenants format it as
           "Name (employeeId)", many do not — parentheses can as easily be part of the
           name — so nothing is read out of it. Employee ids come from the vault. */
        personName: personRaw,
        personId: '',
        accountDisplayName: g(row, 'accountDisplayName'),
        userName,
        enabled: parseBool(g(row, 'accountEnabled')),
        permissionRaw: permRaw,
        permission: perm.name,
        permissionPath: perm.path,
        permissionConfig: g(row, 'permissionConfig'),
        subPermission: g(row, 'subPermission'),
        issue: issue || 'Unspecified',
        resolution: g(row, 'resolution') || 'None'
      });
    }
    if (!records.length) throw new Error('CSV contained a header but no data rows.');

    if (health.skippedEmpty) {
      warnings.push(health.skippedEmpty + ' row(s) skipped: no account and no issue on the line.');
    }
    if (health.shortRows) {
      warnings.push(health.shortRows + ' row(s) carry fewer columns than the header — usually an unquoted delimiter inside a value.');
    }
    /* The findings match the reconciliation vocabulary; an export whose Issue column
       says something else entirely would produce silent zeros everywhere. */
    const KNOWN_ISSUES = ['Account unmanaged', 'Permission unmanaged', 'Permission missing'];
    if (!records.some(r => KNOWN_ISSUES.includes(r.issue))) {
      warnings.push('No Issue value matches the known reconciliation vocabulary (' +
        KNOWN_ISSUES.join(', ') + ') — findings that depend on it will be empty. Found e.g.: ' +
        HR.util.uniq(records.slice(0, 200).map(r => r.issue)).slice(0, 4).join(', '));
    }

    return {
      records,
      warnings,
      meta: {
        fileName: fileName || 'import.csv',
        delimiter: delim,
        headers: header,
        rowCount: records.length,
        health,
        fingerprint: HR.util.hash(text.length + '|' + records.length + '|' + text.slice(0, 4096))
      }
    };
  }

  HR.parse = { parse, parseDelimited, sniffDelim, splitParenthetical, splitPath, parseBool, decode, looksLikeRecon };
})(window.HR);
