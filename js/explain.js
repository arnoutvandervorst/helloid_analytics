/* Why is this row here?

   A reconciliation export states differences. It does not say what caused them, so every
   row arrives with the same weight and the reader has to rebuild the reasoning by hand.
   Everything else this tool loads — business rules, mined role bundles, the vault's people
   and contracts — exists to answer that question, and this resolver applies them one row
   at a time.

   Each row gets its strongest available explanation. What is left over is the point: rows
   nothing accounts for are the ones that genuinely need a human, and their number is a
   better progress measure than the raw finding count, because it falls as the model
   improves rather than as the data changes.

   Explanations are ranked by how much they actually settle:
     strong — the row is accounted for and the next action is mechanical
     likely — the cause is identified but rests on a name match or a statistical pattern
     weak   — a structural observation that narrows the question without closing it */
(function (HR) {
  'use strict';

  const U = HR.util;

  const STRENGTH = { strong: 3, likely: 2, weak: 1 };

  function build(model) {
    const comparison = model.comparison;
    const vault = model.vault;
    const correlation = model.correlation;
    const linked = model.linkedAccounts;
    const provisioning = model.provisioning;

    /* ---- indexes the resolver needs, built once ---- */
    const ruleFor = new Map();          // permission key -> {live:[], draft:[]}
    if (comparison) {
      comparison.permissionRows.forEach(r => ruleFor.set(r.perm.key, {
        live: r.liveRules, all: r.rules, state: r.state
      }));
    }

    /* Groups almost every active person holds are population baseline, not role access. */
    const population = model.accountList.filter(a => a.enabled !== false && a.cls === 'user');
    const baseline = new Set();
    if (population.length >= 20) {
      for (const p of model.permissionList) {
        const share = population.filter(a => a.permKeys.has(p.key)).length / population.length;
        if (share >= 0.8) baseline.add(p.key);
      }
    }

    /* Mined bundles explain access that no rule describes but that clearly travels
       together — an undocumented role rather than a one-off. */
    const bundleFor = new Map();        // permission key -> proposal
    const bundleMembers = new Map();    // proposal -> Set(account keys)
    try {
      const mined = HR.roles.mine(model);
      mined.proposals.forEach(pr => {
        const members = new Set(pr.members.map(a => a.key));
        bundleMembers.set(pr, members);
        pr.perms.forEach(p => {
          if (!bundleFor.has(p.key)) bundleFor.set(p.key, []);
          bundleFor.get(p.key).push(pr);
        });
      });
    } catch (e) { /* mining is optional; explanation degrades without it */ }

    /* What HelloID granted, and what it last tried to do to each person+entitlement. */
    const activity = model.activity;
    const granted = model.granted;

    const matchByAccount = new Map();
    if (correlation) correlation.matches.forEach(m => matchByAccount.set(m.account.key, m));
    const ambiguousByAccount = new Map();
    if (correlation) correlation.ambiguous.forEach(a => ambiguousByAccount.set(a.account.key, a));

    /* Which secondary accounts belong to a person who also holds a main account. */
    const secondaryOf = new Map();
    if (linked) {
      linked.groups.forEach(g => g.secondary.forEach(x =>
        secondaryOf.set(x.account.key, { person: g.person, main: g.primary.account })));
    }

    /* Rules the person behind an account matches, when the vault made that computable. */
    const rulesForAccount = new Map();
    if (provisioning) {
      provisioning.rows.forEach(row =>
        row.accounts.forEach(a => rulesForAccount.set(a.key, { person: row.person, rules: row.matchedRules })));
    }

    /* ---------------------------------------------------------------- resolvers */
    function explainAccountUnmanaged(account) {
      const secondary = secondaryOf.get(account.key);
      if (secondary) {
        return { kind: 'secondary-account', strength: 'strong',
          params: { person: secondary.person.displayName, main: secondary.main.userName } };
      }
      const match = matchByAccount.get(account.key);
      if (match && match.former) {
        return { kind: 'former-employee', strength: 'likely',
          params: { person: match.person.displayName,
            days: match.daysSinceEnd == null ? '—' : U.fmtInt(match.daysSinceEnd) } };
      }
      if (match) {
        return { kind: 'uncorrelated-person', strength: 'likely',
          params: { person: match.person.displayName, evidence: match.evidence.join(', ') } };
      }
      const ambiguous = ambiguousByAccount.get(account.key);
      if (ambiguous) {
        return { kind: 'ambiguous-owner', strength: 'weak',
          params: { list: ambiguous.candidates.map(c => c.person.displayName).join(' / ') } };
      }
      if (account.cls !== 'user') {
        return { kind: 'non-person-account', strength: 'weak', params: { cls: account.clsLabel } };
      }
      return null;
    }

    function explainPermissionUnmanaged(account, perm) {
      /* The strongest evidence of all: HelloID itself says it granted this. Then the
         assignment is not outside the identity system at all. */
      if (activity && account.personRaw) {
        if (granted && !granted.empty &&
            activity.grantedIndex.has(activity.grantedKey(account.personRaw, perm.system, perm.name))) {
          return { kind: 'helloid-granted', strength: 'strong', params: { name: perm.name } };
        }
        const pairKey = activity.pairKey(account.personRaw, perm.system, perm.name);
        const last = activity.lastAction.get(pairKey);
        if (last && /grant/i.test(last.operation) && /succeed/i.test(last.result)) {
          return { kind: 'history-granted', strength: 'strong',
            params: { date: last.createdOn ? U.fmtDate(last.createdOn).split(',')[0] : '—',
              origins: last.origins.join(', ') || '—' } };
        }
        if (last && /revoke/i.test(last.operation)) {
          return { kind: 'revoke-not-effective', strength: 'strong',
            params: { date: last.createdOn ? U.fmtDate(last.createdOn).split(',')[0] : '—',
              result: last.result } };
        }
        const blocked = activity.blockedAction.get(pairKey);
        if (blocked) {
          return { kind: 'action-blocked', strength: 'likely',
            params: { origins: blocked.origins.join(', ') } };
        }
      }

      const rules = ruleFor.get(perm.key);

      /* The strongest answer: a live rule grants it and the person behind the account
         actually matches that rule, so the assignment is expected and only the bookkeeping
         is missing. */
      if (rules && rules.live.length) {
        const forAccount = rulesForAccount.get(account.key);
        if (forAccount) {
          const matching = rules.live.filter(r => forAccount.rules.some(mr => mr.name === r.name));
          if (matching.length) {
            return { kind: 'rule-expected', strength: 'strong',
              params: { rule: matching.map(r => r.name).join(', '), person: forAccount.person.displayName } };
          }
        }
        return { kind: 'rule-covers-group', strength: 'likely',
          params: { rule: rules.live.map(r => r.name).slice(0, 2).join(', ') } };
      }
      if (rules && rules.all.length) {
        return { kind: 'draft-rule', strength: 'likely',
          params: { rule: rules.all.map(r => r.name).slice(0, 2).join(', ') } };
      }

      const match = matchByAccount.get(account.key);
      if (match && match.former) {
        return { kind: 'leaver-residue', strength: 'likely',
          params: { person: match.person.displayName } };
      }
      if (baseline.has(perm.key)) {
        return { kind: 'baseline-access', strength: 'likely', params: { name: perm.name } };
      }
      const bundles = bundleFor.get(perm.key);
      if (bundles) {
        const hit = bundles.find(pr => (bundleMembers.get(pr) || new Set()).has(account.key));
        if (hit) {
          return { kind: 'role-bundle', strength: 'likely',
            params: { name: hit.suggestedName, n: hit.perms.length, members: hit.support } };
        }
      }
      if (account.cls !== 'user') {
        return { kind: 'non-person-account', strength: 'weak', params: { cls: account.clsLabel } };
      }
      return null;
    }

    function explainPermissionMissing(account, perm) {
      if (activity && perm && account.personRaw) {
        const pairKey = activity.pairKey(account.personRaw, perm.system, perm.name);
        const failure = activity.failedGrant.get(pairKey);
        if (failure) {
          return { kind: 'grant-attempt-failed', strength: 'strong',
            params: { date: failure.createdOn ? U.fmtDate(failure.createdOn).split(',')[0] : '—',
              op: failure.operation, result: failure.result } };
        }
      }
      const rules = ruleFor.get(perm ? perm.key : '');
      if (rules && rules.all.length) {
        return { kind: 'grant-not-delivered', strength: 'strong',
          params: { rule: rules.all.map(r => r.name).slice(0, 2).join(', ') } };
      }
      return null;
    }

    /* ---------------------------------------------------------------- the pass */
    const rows = [];
    for (const record of model.records) {
      const account = model.accounts.get(HR.model.accountKey(record.system, record.userName));
      const perm = record.permission
        ? model.permissions.get(HR.model.permissionKey(record.system, record.permission)) : null;

      let explanation = null;
      if (record.resolution && record.resolution !== 'None') {
        explanation = { kind: 'already-resolved', strength: 'strong', params: { resolution: record.resolution } };
      } else if (record.issue === model.ISSUE_ACCOUNT && account) {
        explanation = explainAccountUnmanaged(account);
      } else if (record.issue === model.ISSUE_PERM_UNMANAGED && account && perm) {
        explanation = explainPermissionUnmanaged(account, perm);
      } else if (record.issue === model.ISSUE_PERM_MISSING && account) {
        explanation = explainPermissionMissing(account, perm);
      }

      rows.push({
        record, account, perm,
        issue: record.issue,
        explanation,
        explained: !!explanation,
        strength: explanation ? explanation.strength : null
      });
    }

    /* ---------------------------------------------------------------- rollups */
    const byKind = U.counts(rows.filter(r => r.explained), r => r.explanation.kind);
    const byIssue = new Map();
    for (const r of rows) {
      if (!byIssue.has(r.issue)) byIssue.set(r.issue, { total: 0, explained: 0, strong: 0 });
      const b = byIssue.get(r.issue);
      b.total++;
      if (r.explained) b.explained++;
      if (r.strength === 'strong') b.strong++;
    }

    const unexplained = rows.filter(r => !r.explained);
    /* The residue is most useful grouped: one account with 30 unexplained rows is one
       conversation, not thirty. */
    const residueByAccount = Array.from(U.by(unexplained.filter(r => r.account), r => r.account.key).entries())
      .map(([key, list]) => ({
        account: list[0].account,
        rows: list,
        permissions: list.filter(r => r.perm).map(r => r.perm)
      }))
      .sort((a, b) => b.rows.length - a.rows.length);

    return {
      rows,
      unexplained,
      residueByAccount,
      byKind: Array.from(byKind.entries()).sort((a, b) => b[1] - a[1]),
      byIssue,
      inputs: {
        rules: !!comparison,
        vault: !!vault,
        bundles: bundleFor.size > 0,
        granted: !!(granted && !granted.empty),
        history: !!model.history
      },
      summary: {
        total: rows.length,
        explained: rows.length - unexplained.length,
        unexplained: unexplained.length,
        share: rows.length ? (rows.length - unexplained.length) / rows.length : 0,
        strong: rows.filter(r => r.strength === 'strong').length,
        likely: rows.filter(r => r.strength === 'likely').length,
        weak: rows.filter(r => r.strength === 'weak').length,
        accountsWithResidue: residueByAccount.length
      }
    };
  }

  HR.explain = { build, STRENGTH };
})(window.HR);
