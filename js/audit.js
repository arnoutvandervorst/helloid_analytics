/* The HelloID audit log, pulled by helloid-audit.py from the tenant's Elastic API.

   The exports say what exists; this says what happened and who decided it: every
   provisioning action with its outcome, every reconciliation issue an administrator
   excluded (with the reason and the date it expires), every threshold approved, every
   rule published with the entitlements it added, every import and evaluation run, every
   login to HelloID itself. It is the evidence a review asks for.

   Two uses. The provisioning actions stand in for the historic-actions export when that
   is not loaded — same row shape, so joiner latency, failed actions and churn work
   unchanged. The decisions join to the model per account and permission, so a drawer
   can say "excluded in HelloID by X on date until Y because Z" next to the finding. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const looksLikeAudit = peek => !!peek && peek.kind === 'helloid-audit' && Array.isArray(peek.provisioning);

  const date = s => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d : null; };
  /* "Issue has been excluded for 6 months (until 03/01/2027 00:00:00)" — the date is US-formatted. */
  const untilOf = desc => {
    const m = String(desc || '').match(/until (\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
  };

  function parse(text, fileName) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (!looksLikeAudit(data)) throw new Error('Not a HelloID audit file (helloid-audit.py writes one).');
    const lists = ['provisioning', 'reconciliation', 'thresholds', 'rules', 'entitlements', 'evaluations',
      'systemChanges', 'imports', 'snapshots', 'logins', 'portalAdmin', 'mfa', 'incidents', 'licenses'];
    const out = { kind: 'audit', meta: { fileName: fileName || 'helloid-audit.json', tenant: data.tenant || {},
      collectedAt: date(data.collectedAt), from: date(data.from), to: date(data.to), counts: {} }, warnings: [] };
    lists.forEach(k => {
      out[k] = (data[k] || []).map(r => Object.assign({}, r, { at: date(r.logDate) }));
      out.meta.counts[k] = out[k].length;
    });
    /* The window's real edges: the file's header says what was asked, the rows what came. */
    const dated = out.provisioning.filter(r => r.at);
    if (dated.length) {
      out.meta.first = dated[0].at;
      out.meta.last = dated[dated.length - 1].at;
    }
    out.meta.rowCount = out.provisioning.length;
    out.meta.persons = new Set(out.provisioning.map(r => r.personDisplayName).filter(Boolean)).size;

    /* Exclusions, joined by account and permission the way the reconciliation names them. */
    out.exclusions = out.reconciliation.filter(r => /exclude/i.test(r.action)).map(r => Object.assign(r, {
      account: HR.fit.localOf(r.accountUserName),
      permission: r.permissionDisplayName ? HR.parse.splitPath(r.permissionDisplayName).name : '',
      until: untilOf(r.description),
      accountLevel: !r.permissionDisplayName || /account/i.test(r.issue || '')
    }));
    out.byAccount = new Map();
    out.exclusions.forEach(x => { if (!out.byAccount.has(x.account)) out.byAccount.set(x.account, []); out.byAccount.get(x.account).push(x); });
    out.byAccount.forEach(list => list.sort((a, b) => (b.at || 0) - (a.at || 0)));
    return out;
  }

  /* --------------------------------------------------------- as history */

  const OPERATION = { GrantPermission: 'Grant', RevokePermission: 'Revoke', CreateAccount: 'Create', DeleteAccount: 'Delete',
    EnableAccount: 'Enable', DisableAccount: 'Disable', UpdateAccount: 'Update', MoveAccount: 'Move',
    ManagePermission: 'Manage', UnmanagePermission: 'Unmanage', ManageAccount: 'Manage', UnmanageAccount: 'Unmanage',
    ManageAccess: 'Manage', UnmanageAccess: 'Unmanage', CreateResource: 'CreateResource' };
  const GROUP_RE = /Permission to (?:group|team|role|licen[cs]e|entitlement)?\s*(.+?) (?:added for|removed from) account /i;

  /** The provisioning actions in the historic-actions row shape, so the history engine reads them unchanged. */
  function asHistory(audit) {
    const rows = [];
    for (const r of audit.provisioning) {
      if (!r.action || /SendNotification/i.test(r.action)) continue;      // mail is not an action on access
      const m = GROUP_RE.exec(r.message || '');
      const isAccount = /Account$/.test(r.action) || /Access$/.test(r.action);
      const entName = m ? m[1].trim() : (isAccount ? 'Account' : (r.message || r.action));
      const ent = HR.parse.splitPath(entName);
      const parts = HR.activity.splitSub(ent.name);
      rows.push({
        i: rows.length,
        personRaw: r.personDisplayName || '',
        personName: r.personDisplayName || '',
        personId: '',
        system: r.systemName || 'Unknown system',
        entitlementRaw: entName,
        entitlement: ent.name,
        entitlementType: parts.type,
        entitlementLeaf: parts.leaf,
        path: ent.path,
        configuration: '',
        isAccount,
        operation: OPERATION[r.action] || r.action,
        result: /error|fail/i.test(r.state || '') ? 'Failed' : 'Succeeded',
        createdOn: r.at,
        finishedOn: r.at && r.actionDurationMs != null ? new Date(+r.at + (r.actionDurationMs || 0)) : r.at,
        origins: [],
        durationMs: r.actionDurationMs == null ? null : r.actionDurationMs,
        message: r.message || ''
      });
    }
    const out = HR.activity.buildHistory(rows, audit.meta.fileName, 'audit|' + rows.length);
    out.fromAudit = true;
    return out;
  }

  /* ------------------------------------------------------------ evidence */

  /** The exclusions HelloID recorded for this account and, when given, this permission — newest first. */
  function evidenceFor(audit, account, perm) {
    if (!audit || !account) return [];
    const list = audit.byAccount.get(HR.fit.localOf(account.userName)) || [];
    const sys = String(account.system || '').toLowerCase();
    return list.filter(x => {
      if (x.system && sys && String(x.system).toLowerCase() !== sys) return false;
      if (!perm) return true;
      if (x.accountLevel) return false;
      return String(x.permission).toLowerCase() === String(perm.name || '').toLowerCase();
    });
  }

  /** Actors and what they did, for the "who did what" table. */
  function actors(audit) {
    const by = new Map();
    const add = (name, ctx) => {
      if (!name) return;
      if (!by.has(name)) by.set(name, { name, total: 0, contexts: {} });
      const a = by.get(name); a.total++; a.contexts[ctx] = (a.contexts[ctx] || 0) + 1;
    };
    audit.reconciliation.forEach(r => add(r.userName, 'reconciliation'));
    audit.thresholds.forEach(r => add(r.userName, 'thresholds'));
    audit.rules.forEach(r => add(r.userName, 'rules'));
    audit.entitlements.forEach(r => add(r.userName, 'entitlements'));
    audit.evaluations.forEach(r => add(r.userName, 'evaluations'));
    audit.systemChanges.forEach(r => add(r.userName, 'systemChanges'));
    audit.imports.filter(r => /manual/i.test(r.type || '')).forEach(r => add(r.userName, 'imports'));
    return Array.from(by.values()).sort((a, b) => b.total - a.total);
  }

  HR.audit = { parse, looksLikeAudit, asHistory, evidenceFor, actors, untilOf };
})(window.HR);
