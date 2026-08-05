/* Two more HelloID exports, same family of columns:

   Entitlements granted
     Person,System,EntitlementName,PermissionConfigurationDisplayName,LastChangedOn
     What HelloID believes is granted right now. Next to the reconciliation export it
     settles the question the reconciliation alone cannot: is this assignment outside the
     identity system, or did the identity system put it there?

   Historic actions
     ...,Operation,CreatedOn,FinishedOn,Origins,Result
     What HelloID did, when, why and whether it worked. Origins is the reason the action
     fired (a contract changed, a person changed, an import, a retry) and Result says
     whether it landed — which turns "this entitlement is missing" into "the grant was
     attempted on this date and failed".

   Dates arrive US-formatted (MM/DD/YYYY HH:MM:SS). */
(function (HR) {
  'use strict';

  const U = HR.util;

  const GRANTED_HEADERS = ['person', 'system', 'entitlementname', 'lastchangedon'];
  const HISTORY_HEADERS = ['person', 'system', 'entitlementname', 'operation', 'createdon', 'result'];

  /* Keys join three free-text fields; without a separator "AD"+"min" and "ADmin"+""
     are the same key. Unit separator never appears in an export. */
  const SEP = '\u001f';

  const normHeader = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

  /** "OperatorGroup - Applicatiebeheerders" -> {type, leaf}; a plain name -> {leaf} only. */
  function splitSub(name) {
    const i = String(name || '').indexOf(' - ');
    return i > 0
      ? { type: name.slice(0, i).trim(), leaf: name.slice(i + 3).trim() }
      : { type: '', leaf: String(name || '').trim() };
  }

  function classify(header) {
    const cols = header.map(normHeader);
    const has = list => list.every(h => cols.includes(h));
    if (has(HISTORY_HEADERS)) return 'history';
    if (has(GRANTED_HEADERS)) return 'granted';
    return null;
  }

  const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

  /**
   * "07/14/2026 09:09:29" — HelloID writes US order, but a tenant's own tooling can
   * re-export the file day-first, and JS Date would silently roll month 13 into the
   * next year. `dayFirst` is decided per file by whoever saw all the values.
   */
  function parseDate(value, dayFirst) {
    const s = String(value || '').trim();
    if (!s) return null;
    const m = s.match(SLASH_DATE);
    if (m) {
      const mm = dayFirst ? +m[2] : +m[1];
      const dd = dayFirst ? +m[1] : +m[2];
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
      return new Date(+m[3], mm - 1, dd, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Which side of the slash is the day? Any value above 12 settles it; a file where
   * nothing settles it is read as HelloID writes it, month first.
   */
  function detectDayFirst(values) {
    let firstOver = false, secondOver = false;
    for (const v of values) {
      const m = String(v || '').match(SLASH_DATE);
      if (!m) continue;
      if (+m[1] > 12) firstOver = true;
      if (+m[2] > 12) secondOver = true;
    }
    return firstOver && !secondOver;
  }

  function parse(text, fileName) {
    const delim = HR.parse.sniffDelim(text);
    const grid = HR.parse.parseDelimited(text, delim)
      .filter(r => r.length && !(r.length === 1 && r[0].trim() === ''));
    if (!grid.length) throw new Error('Export is empty.');

    const header = grid[0].map(h => h.trim());
    const kind = classify(header);
    if (!kind) {
      throw new Error('Not an entitlement or historic-action export. Found: ' + header.join(', '));
    }
    const col = {};
    header.forEach((h, i) => { col[normHeader(h)] = i; });
    const get = (row, key) => col[key] == null ? '' : (row[col[key]] || '').trim();

    /* Date order is a property of the file, so look at every date before parsing any. */
    const dateCols = kind === 'history' ? ['createdon', 'finishedon'] : ['lastchangedon'];
    const dateSamples = [];
    for (let i = 1; i < grid.length; i++) {
      for (const c of dateCols) dateSamples.push(get(grid[i], c));
    }
    const dayFirst = detectDayFirst(dateSamples);

    const rows = [];
    let skipped = 0, badDates = 0, shortRows = 0;
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      if (r.length < header.length) shortRows++;
      const personRaw = get(r, 'person');
      const entitlementRaw = get(r, 'entitlementname');
      if (!personRaw && !entitlementRaw) { skipped++; continue; }
      const ent = HR.parse.splitPath(entitlementRaw);

      /* Some tenants name an entitlement "<permission type> - <name>" — "OperatorGroup -
         Applicatiebeheerders", "Security Group - Office 365 E3" — with the type repeated
         in PermissionConfigurationDisplayName. The reconciliation export of the same
         tenant may carry only one half of that, so both halves are kept for matching. */
      const parts = splitSub(ent.name);
      const record = {
        i: rows.length,
        personRaw,
        /* Verbatim, like the reconciliation: the column is a display name, not a format. */
        personName: personRaw,
        personId: '',
        system: get(r, 'system') || 'Unknown system',
        entitlementRaw,
        entitlement: ent.name,
        entitlementType: parts.type,
        entitlementLeaf: parts.leaf,
        path: ent.path,
        configuration: get(r, 'permissionconfigurationdisplayname'),
        /* "Account" and "Account Access" are the account itself, not a group on it. */
        isAccount: /^account( access)?$/i.test(ent.name)
      };

      if (kind === 'history') {
        record.operation = get(r, 'operation') || 'Unknown';
        record.result = get(r, 'result') || 'Unknown';
        record.createdOn = parseDate(get(r, 'createdon'), dayFirst);
        record.finishedOn = parseDate(get(r, 'finishedon'), dayFirst);
        if (get(r, 'createdon') && !record.createdOn) badDates++;
        record.origins = (get(r, 'origins') || '').split('|').map(s => s.trim()).filter(Boolean);
        record.durationMs = (record.createdOn && record.finishedOn)
          ? record.finishedOn - record.createdOn : null;
      } else {
        record.lastChangedOn = parseDate(get(r, 'lastchangedon'), dayFirst);
        if (get(r, 'lastchangedon') && !record.lastChangedOn) badDates++;
      }
      rows.push(record);
    }

    const health = { dataRows: grid.length - 1, kept: rows.length, skippedEmpty: skipped, shortRows, badDates, dayFirst };
    const out = kind === 'history' ? buildHistory(rows, fileName, text) : buildGranted(rows, fileName, text);
    out.meta.health = health;
    if (badDates) (out.warnings = out.warnings || []).push(badDates + ' row(s) carry a date that could not be read.');
    return out;
  }

  /* ------------------------------------------------------------------ granted */
  function buildGranted(rows, fileName, text) {
    const byPerson = U.by(rows, r => r.personRaw);
    const byEntitlement = U.by(rows, r => r.system + '' + r.entitlement);
    return {
      kind: 'granted',
      rows,
      byPerson,
      byEntitlement,
      /* Empty is a legitimate state — a tenant that has granted nothing yet exports a
         header and no rows — so it must read as "nothing granted", not as a failure. */
      empty: rows.length === 0,
      meta: {
        fileName: fileName || 'entitlements.csv',
        rowCount: rows.length,
        persons: byPerson.size,
        entitlements: byEntitlement.size,
        lastChange: rows.reduce((max, r) => (r.lastChangedOn && (!max || r.lastChangedOn > max)) ? r.lastChangedOn : max, null),
        fingerprint: U.hash(text.length + '|' + rows.length + '|' + text.slice(0, 4096))
      }
    };
  }

  /* ------------------------------------------------------------------ history */
  function buildHistory(rows, fileName, text) {
    const dated = rows.filter(r => r.createdOn);
    const from = dated.length ? new Date(Math.min.apply(null, dated.map(r => +r.createdOn))) : null;
    const to = dated.length ? new Date(Math.max.apply(null, dated.map(r => +r.createdOn))) : null;

    const failed = rows.filter(r => /fail/i.test(r.result));
    const blocked = rows.filter(r => r.origins.some(o => /blocked/i.test(o)));

    /* Per person + entitlement, so a single row can be asked "what happened to this". */
    const byPair = new Map();
    for (const r of rows) {
      const key = r.personRaw + SEP + r.system + SEP + r.entitlement;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(r);
    }
    byPair.forEach(list => list.sort((a, b) => (a.createdOn || 0) - (b.createdOn || 0)));

    /* An entitlement granted and revoked repeatedly for the same person is a rule whose
       conditions flip, not a person changing job every other day. */
    const churn = [];
    for (const [key, list] of byPair) {
      const ops = list.filter(r => /grant|revoke/i.test(r.operation));
      let flips = 0;
      for (let i = 1; i < ops.length; i++) {
        if (ops[i].operation !== ops[i - 1].operation) flips++;
      }
      if (flips >= 2) churn.push({ key, rows: list, flips, sample: list[0] });
    }
    churn.sort((a, b) => b.flips - a.flips);

    const perDay = new Map();
    for (const r of dated) {
      const day = r.createdOn.toISOString().slice(0, 10);
      if (!perDay.has(day)) perDay.set(day, { day, grant: 0, revoke: 0, update: 0, failed: 0, total: 0 });
      const b = perDay.get(day);
      b.total++;
      if (/grant/i.test(r.operation)) b.grant++;
      else if (/revoke/i.test(r.operation)) b.revoke++;
      else b.update++;
      if (/fail/i.test(r.result)) b.failed++;
    }

    const originCounts = new Map();
    rows.forEach(r => r.origins.forEach(o => originCounts.set(o, (originCounts.get(o) || 0) + 1)));

    return {
      kind: 'history',
      rows,
      byPair,
      failed,
      blocked,
      churn,
      timeline: Array.from(perDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
      operations: Object.fromEntries(U.counts(rows, r => r.operation)),
      results: Object.fromEntries(U.counts(rows, r => r.result)),
      origins: Array.from(originCounts.entries()).sort((a, b) => b[1] - a[1]),
      empty: rows.length === 0,
      meta: {
        fileName: fileName || 'historicactions.csv',
        rowCount: rows.length,
        persons: new Set(rows.map(r => r.personRaw)).size,
        entitlements: new Set(rows.map(r => r.entitlement)).size,
        from, to,
        /* perDay counts days that saw an action. Reporting that as "days" read as the
           span of the export, which for a two-month file with fourteen busy days is a
           different claim entirely. */
        days: perDay.size,
        activeDays: perDay.size,
        spanDays: (from && to) ? Math.round((to - from) / 86400000) + 1 : null,
        failedCount: failed.length,
        blockedCount: blocked.length,
        fingerprint: U.hash(text.length + '|' + rows.length + '|' + text.slice(0, 4096))
      }
    };
  }

  /**
   * What the two exports say about the reconciliation model: which assignments HelloID
   * granted itself, and which ones it tried to change and could not.
   */
  /**
   * What the activity exports say about the reconciliation model: which assignments
   * HelloID granted itself, and which ones it tried to change and could not.
   *
   * An entitlement can be written down differently on either side of this join. Some
   * tenants export "OperatorGroup - Applicatiebeheerders" here while the reconciliation
   * calls it "Applicatiebeheerders" and puts "Operator Groups" in its configuration
   * column. Both spellings are indexed, and a lookup offers every spelling the
   * reconciliation row can supply, so the two meet without either side guessing.
   */
  function reconcile(model, granted, history) {
    const key = (system, name) => String(system || '').toLowerCase() + SEP + String(name || '').toLowerCase();

    const indexKeys = (personRaw, system, entitlement, leaf) => {
      const out = [personRaw + SEP + key(system, entitlement)];
      if (leaf && leaf !== entitlement) out.push(personRaw + SEP + key(system, leaf));
      return out;
    };

    const lookupKeys = (personRaw, system, name, config, sub) => {
      const out = [personRaw + SEP + key(system, name)];
      if (config) out.push(personRaw + SEP + key(system, config + ' - ' + name));
      if (sub) {
        out.push(personRaw + SEP + key(system, sub));
        out.push(personRaw + SEP + key(system, name + ' - ' + sub));
      }
      return out;
    };

    const firstHit = (map, keys) => {
      for (const k of keys) { const v = map.get(k); if (v) return v; }
      return null;
    };

    /* HelloID's own view of what is granted. */
    const grantedIndex = new Map();
    if (granted) {
      for (const r of granted.rows) {
        for (const k of indexKeys(r.personRaw, r.system, r.entitlement, r.entitlementLeaf)) {
          if (!grantedIndex.has(k)) grantedIndex.set(k, r);
        }
      }
    }

    /* The last thing that happened to each person + entitlement pair. */
    const lastAction = new Map();
    const failedGrant = new Map();
    const blockedAction = new Map();
    if (history) {
      for (const list of history.byPair.values()) {
        const sample = list[0];
        const last = list[list.length - 1];
        const failure = list.slice().reverse().find(r => /fail/i.test(r.result));
        const block = list.slice().reverse().find(r => r.origins.some(o => /blocked/i.test(o)));
        for (const k of indexKeys(sample.personRaw, sample.system, sample.entitlement, sample.entitlementLeaf)) {
          if (!lastAction.has(k)) lastAction.set(k, last);
          if (failure && !failedGrant.has(k)) failedGrant.set(k, failure);
          if (block && !blockedAction.has(k)) blockedAction.set(k, block);
        }
      }
    }

    return {
      grantedIndex,
      lastAction,
      failedGrant,
      blockedAction,
      /* Callers ask about a reconciliation row, not about a key. */
      isGranted: (personRaw, system, name, config, sub) =>
        !!firstHit(grantedIndex, lookupKeys(personRaw, system, name, config, sub)),
      lastActionFor: (personRaw, system, name, config, sub) =>
        firstHit(lastAction, lookupKeys(personRaw, system, name, config, sub)),
      failedGrantFor: (personRaw, system, name, config, sub) =>
        firstHit(failedGrant, lookupKeys(personRaw, system, name, config, sub)),
      blockedActionFor: (personRaw, system, name, config, sub) =>
        firstHit(blockedAction, lookupKeys(personRaw, system, name, config, sub)),
      summary: {
        granted: granted ? granted.rows.length : 0,
        history: history ? history.rows.length : 0,
        failed: history ? history.failed.length : 0,
        blocked: history ? history.blocked.length : 0,
        churn: history ? history.churn.length : 0
      }
    };
  }

  HR.activity = { parse, classify, reconcile, parseDate, splitSub };
})(window.HR);
