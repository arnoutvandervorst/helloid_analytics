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
  /* A fourth shape: the entitlement catalogue, one row per entitlement rather than per
     person, carrying HelloID's own count of the rules that grant it and whether the
     entitlement still exists in the target system. */
  const CATALOGUE_HEADERS = ['systemdisplayname', 'entitlementdisplayname', 'rulescount', 'intargetsystem'];

  const normHeader = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

  function classify(header) {
    const cols = header.map(normHeader);
    const has = list => list.every(h => cols.includes(h));
    if (has(HISTORY_HEADERS)) return 'history';
    if (has(GRANTED_HEADERS)) return 'granted';
    if (has(CATALOGUE_HEADERS)) return 'catalogue';
    return null;
  }

  /** "07/14/2026 09:09:29" — US order, which Date.parse would read the same way, but be explicit. */
  function parseDate(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
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

    if (kind === 'catalogue') return buildCatalogue(grid, col, fileName, text);

    const rows = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const personRaw = get(r, 'person');
      const entitlementRaw = get(r, 'entitlementname');
      if (!personRaw && !entitlementRaw) continue;
      const ent = HR.parse.splitParenthetical(entitlementRaw);
      const person = HR.parse.splitParenthetical(personRaw);

      const record = {
        i: rows.length,
        personRaw,
        personName: person.name,
        personId: person.extra,
        system: get(r, 'system') || 'Unknown system',
        entitlementRaw,
        entitlement: ent.name,
        path: ent.extra,
        configuration: get(r, 'permissionconfigurationdisplayname')
      };

      if (kind === 'history') {
        record.operation = get(r, 'operation') || 'Unknown';
        record.result = get(r, 'result') || 'Unknown';
        record.createdOn = parseDate(get(r, 'createdon'));
        record.finishedOn = parseDate(get(r, 'finishedon'));
        record.origins = (get(r, 'origins') || '').split('|').map(s => s.trim()).filter(Boolean);
        record.durationMs = (record.createdOn && record.finishedOn)
          ? record.finishedOn - record.createdOn : null;
      } else {
        record.lastChangedOn = parseDate(get(r, 'lastchangedon'));
      }
      rows.push(record);
    }

    return kind === 'history' ? buildHistory(rows, fileName, text) : buildGranted(rows, fileName, text);
  }

  /* ---------------------------------------------------------------- catalogue */
  function buildCatalogue(grid, col, fileName, text) {
    const get = (row, key) => col[key] == null ? '' : (row[col[key]] || '').trim();
    const rows = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const name = get(r, 'entitlementdisplayname');
      if (!name) continue;
      const ent = HR.parse.splitParenthetical(name);
      const inTarget = String(get(r, 'intargetsystem')).trim().toLowerCase();
      rows.push({
        i: rows.length,
        system: get(r, 'systemdisplayname') || 'Unknown system',
        entitlementRaw: name,
        entitlement: ent.name,
        path: ent.extra,
        rulesCount: parseInt(get(r, 'rulescount'), 10) || 0,
        /* False here is HelloID telling us the entitlement it knows about is gone from
           the target system — the same thing the rule comparison infers, stated outright. */
        inTargetSystem: inTarget === 'true' || inTarget === '1' || inTarget === 'ja',
        isAccount: /^account$/i.test(ent.name)
      });
    }
    const orphaned = rows.filter(r => !r.inTargetSystem);
    const unruled = rows.filter(r => r.rulesCount === 0 && !r.isAccount);
    return {
      kind: 'catalogue',
      rows, orphaned, unruled,
      empty: rows.length === 0,
      meta: {
        fileName: fileName || 'entitlements.csv',
        rowCount: rows.length,
        systems: new Set(rows.map(r => r.system)).size,
        orphanedCount: orphaned.length,
        unruledCount: unruled.length,
        ruled: rows.length - unruled.length,
        fingerprint: U.hash(text.length + '|' + rows.length + '|' + text.slice(0, 4096))
      }
    };
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
      const key = r.personRaw + '' + r.system + '' + r.entitlement;
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
        days: perDay.size,
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
  function reconcile(model, granted, history) {
    const key = (system, name) => String(system || '').toLowerCase() + '' + String(name || '').toLowerCase();

    /* HelloID's own view of what is granted, keyed the way the recon rows are. */
    const grantedIndex = new Map();
    if (granted) {
      for (const r of granted.rows) {
        grantedIndex.set(r.personRaw + '' + key(r.system, r.entitlement), r);
      }
    }

    /* The last thing that happened to each person+entitlement pair. */
    const lastAction = new Map();
    const failedGrant = new Map();
    const blockedAction = new Map();
    if (history) {
      for (const [pairKey, list] of history.byPair) {
        const last = list[list.length - 1];
        lastAction.set(pairKey, last);
        const failure = list.slice().reverse().find(r => /fail/i.test(r.result));
        if (failure) failedGrant.set(pairKey, failure);
        const block = list.slice().reverse().find(r => r.origins.some(o => /blocked/i.test(o)));
        if (block) blockedAction.set(pairKey, block);
      }
    }

    return {
      grantedIndex,
      lastAction,
      failedGrant,
      blockedAction,
      pairKey: (personRaw, system, name) => personRaw + '' + key(system, name),
      grantedKey: (personRaw, system, name) => personRaw + '' + key(system, name),
      summary: {
        granted: granted ? granted.rows.length : 0,
        history: history ? history.rows.length : 0,
        failed: history ? history.failed.length : 0,
        blocked: history ? history.blocked.length : 0,
        churn: history ? history.churn.length : 0
      }
    };
  }

  HR.activity = { parse, classify, reconcile, parseDate };
})(window.HR);
