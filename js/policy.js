/* Policy guidelines: the organisation's own quality thresholds, scored.

   A certification audit (NIS2 and friends) asks the same kind of question over
   and over: "how much of X do you allow, and how much do you have?" This module
   holds that question as data. Each guideline is a measurable number from the
   model, a direction (at most / at least) and a threshold the organisation
   chooses. The thresholds are settings, exported with the settings file, so a
   tenant's own norms travel with it.

   This is the threshold kind of the VIGA/IAM-masterplan policy model, kept
   shape-compatible (a metric key, a limit, the affected subjects) so chosen
   thresholds can migrate to a full policy engine with violation lifecycle and
   time-boxed exceptions. SoD and cross-application policies live there, not
   here: this tool analyses, it does not enforce. */
(function (HR) {
  'use strict';

  const U = HR.util;

  /* What a guideline can require of the loaded data. The reconciliation is a
     given — without it there is no model to measure. */
  const HAS = {
    vault: m => !!m.vault,
    rules: m => !!(m.comparison && m.ruleSet),
    evaluation: m => !!m.provisioning,
    prices: m => !!(m.cost && m.cost.totalMonthly > 0),
    directory: m => !!m.directory,
    lastlogon: m => !!(m.directory && m.directory.users.some(u => u.lastLogon))
  };

  /* Accounted for in the HelloID reconciliation: a row with any resolution
     other than None (Excluded, mostly) was looked at and justified by a person.
     Resolutions are per permission row, so one account can be half accounted
     for — the whole-account check requires every row resolved; the per-subset
     check (used for privileged access) requires only the rows that matter.
     The export carries only the resolution type — the remark and end date
     entered in HelloID stay behind — so this is as far as the evidence reaches. */
  const resolved = r => r.resolution && r.resolution !== 'None';
  const justified = a => {
    const none = (a.resolutions && a.resolutions.None) || 0;
    const total = Object.values(a.resolutions || {}).reduce((n, v) => n + v, 0);
    return total > 0 && none === 0;
  };
  const justifiedFor = (a, permNames) => {
    const rows = (a.records || []).filter(r => permNames.has(r.permission));
    return rows.length > 0 && rows.every(resolved);
  };

  const clsShare = (m, cls) => {
    const affected = m.accountList.filter(a => a.cls === cls)
      .map(a => ({ kind: 'account', a }));
    return {
      value: m.accountList.length ? 100 * affected.length / m.accountList.length : 0,
      affected
    };
  };

  /**
   * The guideline catalog. dir 'max': the value must stay at or under the
   * threshold; 'min': at or above it. unit 'pct' values are 0-100.
   * paramDef marks a guideline with a second knob (e.g. the membership limit).
   */
  const CATALOG = [
    { id: 'unowned-share', unit: 'pct', dir: 'max', def: 15, needs: [],
      measure: m => {
        const affected = m.accountList.filter(a => a.orphan && !justified(a))
          .map(a => ({ kind: 'account', a }));
        return { value: m.summary.accounts ? 100 * affected.length / m.summary.accounts : 0, affected };
      } },
    { id: 'admin-share', unit: 'pct', dir: 'max', def: 2, needs: [],
      measure: m => clsShare(m, 'admin') },
    { id: 'wide-membership', unit: 'pct', dir: 'max', def: 0, paramDef: 25, needs: [],
      measure: (m, param) => {
        const affected = m.accountList.filter(a => a.permCount > param)
          .map(a => ({ kind: 'account', a }));
        return {
          value: m.accountList.length ? 100 * affected.length / m.accountList.length : 0,
          affected
        };
      } },
    { id: 'disabled-share', unit: 'pct', dir: 'max', def: 15, needs: [],
      measure: m => ({
        value: m.summary.accounts ? 100 * m.summary.disabledAccounts / m.summary.accounts : 0,
        affected: m.accountList.filter(a => a.enabled === false).map(a => ({ kind: 'account', a }))
      }) },
    { id: 'test-share', unit: 'pct', dir: 'max', def: 1, needs: [],
      measure: m => clsShare(m, 'test') },
    { id: 'shared-share', unit: 'pct', dir: 'max', def: 2, needs: [],
      measure: m => clsShare(m, 'shared') },
    { id: 'unmanaged-share', unit: 'pct', dir: 'max', def: 25, needs: [],
      measure: m => {
        const open = m.records.filter(r => r.issue === 'Permission unmanaged' && !resolved(r)).length;
        return { value: m.summary.rows ? 100 * open / m.summary.rows : 0, affected: [] };
      } },
    { id: 'rule-coverage', unit: 'pct', dir: 'min', def: 60, needs: ['rules'],
      measure: m => ({
        value: 100 * (m.comparison.summary.coverage || 0),
        affected: m.comparison.unmodelled.map(row => ({ kind: 'perm', perm: row.perm }))
      }) },
    { id: 'leavers-enabled', unit: 'count', dir: 'max', def: 0, needs: ['vault'],
      measure: m => {
        const res = HR.workforce.leavers(m, m.vault);
        const rows = res.rows.filter(r => r.enabledAccounts);
        return { value: rows.length, affected: rows.map(r => ({ kind: 'person', person: r.person })) };
      } },
    { id: 'disabled-licensed', unit: 'count', dir: 'max', def: 0, needs: ['prices'],
      measure: m => {
        const affected = m.accountList.filter(a => a.enabled === false && a.monthlyCost > 0)
          .map(a => ({ kind: 'account', a }));
        return { value: affected.length, affected };
      } },

    /* ---- unique identification & ownership ---- */
    { id: 'unowned-enabled', unit: 'pct', dir: 'max', def: 5, needs: [],
      measure: m => {
        const affected = m.accountList.filter(a => a.orphan && a.enabled !== false && !justified(a))
          .map(a => ({ kind: 'account', a }));
        return { value: m.accountList.length ? 100 * affected.length / m.accountList.length : 0, affected };
      } },
    { id: 'privileged-unowned', unit: 'count', dir: 'max', def: 0, needs: [],
      /* Judged on the privileged rows alone: excluding those in the HelloID
         reconciliation accounts for the privileged access, even when a mundane
         row on the same account is still open. */
      measure: m => {
        const affected = m.accountList
          .filter(a => a.orphan && a.privileged.length &&
            !justifiedFor(a, new Set(a.privileged.map(p => p.name))))
          .map(a => ({ kind: 'account', a }));
        return { value: affected.length, affected };
      } },
    { id: 'service-unowned', unit: 'count', dir: 'max', def: 5, needs: [],
      measure: m => {
        const affected = m.accountList
          .filter(a => a.cls === 'service' && a.orphan && !justified(a))
          .map(a => ({ kind: 'account', a }));
        return { value: affected.length, affected };
      } },
    { id: 'duplicate-ids', unit: 'count', dir: 'max', def: 0, needs: ['vault'],
      measure: m => {
        const q = m.orgQuality || HR.org.quality(m.vault);
        const affected = [];
        q.duplicateIds.forEach(d => d.persons.forEach(person => affected.push({ kind: 'person', person })));
        return { value: q.duplicateIds.length, affected };
      } },

    /* ---- timely revocation ---- */
    { id: 'former-accounts', unit: 'count', dir: 'max', def: 0, needs: ['vault'],
      measure: m => {
        const hits = ((m.correlation && m.correlation.former) || [])
          .filter(h => h.stillEnabled && !justified(h.account));
        return { value: hits.length, affected: hits.map(h => ({ kind: 'account', a: h.account })) };
      } },
    { id: 'disabled-entitled', unit: 'pct', dir: 'max', def: 25, needs: [],
      measure: m => {
        const disabled = m.accountList.filter(a => a.enabled === false);
        const affected = disabled.filter(a => a.permCount > 0 && !justified(a))
          .map(a => ({ kind: 'account', a }));
        return { value: disabled.length ? 100 * affected.length / disabled.length : 0, affected };
      } },

    /* ---- least privilege ---- */
    { id: 'over-provisioned', unit: 'pct', dir: 'max', def: 20, needs: ['vault', 'evaluation'],
      measure: m => {
        const s = m.provisioning.summary;
        const rows = m.provisioning.rows.filter(r => r.extra.length);
        return {
          value: s.personsMatched ? 100 * s.overProvisioned / s.personsMatched : 0,
          affected: rows.map(r => ({ kind: 'person', person: r.person }))
        };
      } },
    { id: 'peer-outliers', unit: 'pct', dir: 'max', def: 10, needs: [],
      measure: m => {
        const eligible = m.accountList.filter(a => a.permCount >= 3 && a.outlier !== null);
        const affected = eligible.filter(a => a.outlier > 0.65).map(a => ({ kind: 'account', a }));
        return { value: eligible.length ? 100 * affected.length / eligible.length : 0, affected };
      } },
    { id: 'multiple-accounts', unit: 'pct', dir: 'max', def: 5, paramDef: 2, needs: ['vault'],
      measure: (m, param) => {
        const groups = ((m.linkedAccounts && m.linkedAccounts.groups) || [])
          .filter(g => 1 + g.secondary.length > param);
        return {
          value: m.vault.persons.length ? 100 * groups.length / m.vault.persons.length : 0,
          affected: groups.map(g => ({ kind: 'person', person: g.person }))
        };
      } },

    /* ---- lifecycle completeness ---- */
    { id: 'no-account-employees', unit: 'pct', dir: 'max', def: 5, needs: ['vault'],
      measure: m => {
        const index = HR.correlate.personAccountIndex(m, m.vault, m.correlation);
        const now = new Date();
        const current = m.vault.persons.filter(p => p.contracts.length &&
          HR.vault.lifecycle(p, now).state === 'current');
        const affected = current.filter(p => {
          const entry = index.get(p.personId);
          return !entry || !entry.accounts.length;
        }).map(person => ({ kind: 'person', person }));
        return { value: current.length ? 100 * affected.length / current.length : 0, affected };
      } },
    { id: 'stale-managers', unit: 'count', dir: 'max', def: 0, needs: ['vault'],
      measure: m => {
        const res = HR.workforce.managers(m.vault);
        return { value: res.summary.stale,
          affected: res.stale.filter(r => r.person).map(r => ({ kind: 'person', person: r.person })) };
      } },

    /* ---- directory hygiene ---- */
    { id: 'empty-groups', unit: 'count', dir: 'max', def: 0, needs: ['directory'],
      measure: m => {
        const empty = m.directory.groups.filter(g =>
          !(g.memberUsers || []).length && !(g.memberGroups || []).length);
        return { value: empty.length, affected: [] };
      } },
    { id: 'deep-nesting', unit: 'pct', dir: 'max', def: 5, paramDef: 3, needs: ['directory'],
      measure: (m, param) => {
        const metas = Array.from(m.directory.groupMeta.values());
        const deep = metas.filter(g => g.depth > param);
        return { value: metas.length ? 100 * deep.length / metas.length : 0, affected: [] };
      } },
    /* AD's replicated lastLogonTimestamp can lag up to two weeks; at a 90-day
       limit that lag is noise. Accounts with no recorded sign-in are skipped. */
    { id: 'dormant-accounts', unit: 'pct', dir: 'max', def: 5, paramDef: 90, needs: ['directory', 'lastlogon'],
      measure: (m, param) => {
        const now = Date.now();
        const byName = new Map(m.accountList.map(a => [String(a.userName || '').toLowerCase(), a]));
        const withStamp = m.directory.users.filter(u => u.enabled !== false && u.lastLogon);
        const dormant = withStamp.filter(u => {
          const t = Date.parse(u.lastLogon);
          return isFinite(t) && (now - t) / 86400000 > param;
        });
        const open = dormant.filter(u => {
          const a = byName.get(String(u.userName || '').toLowerCase());
          return !a || !justified(a);
        });
        const affected = open
          .map(u => byName.get(String(u.userName || '').toLowerCase()))
          .filter(Boolean)
          .map(a => ({ kind: 'account', a }));
        return { value: withStamp.length ? 100 * open.length / withStamp.length : 0, affected };
      } }
  ];

  /** A guideline's stored settings, defaults filled in. */
  function settingsFor(def) {
    const st = (HR.config.get().policies || {})[def.id] || {};
    return {
      on: st.on !== false,
      threshold: st.t === undefined || st.t === null || st.t === '' ? def.def : +st.t,
      param: def.paramDef === undefined ? undefined
        : (st.p === undefined || st.p === null || st.p === '' ? def.paramDef : +st.p)
    };
  }

  /** Store one guideline's settings; the caller re-renders. */
  function set(id, patch) {
    const cfg = HR.config.get();
    cfg.policies = cfg.policies || {};
    cfg.policies[id] = Object.assign({}, cfg.policies[id], patch);
    HR.config.save();
  }

  /**
   * Every guideline against the current model. Guidelines whose imports are
   * missing stay listed (with what they need) but score nothing; disabled ones
   * are measured but kept out of the score.
   */
  function evaluate(m) {
    if (m._policy) return m._policy;
    const rows = [];
    for (const def of CATALOG) {
      const st = settingsFor(def);
      const missing = (def.needs || []).filter(n => !HAS[n](m));
      if (missing.length) {
        rows.push({ def, on: st.on, threshold: st.threshold, param: st.param,
          applicable: false, missing });
        continue;
      }
      const r = def.measure(m, st.param);
      const pass = def.dir === 'max'
        ? r.value <= st.threshold + 1e-9
        : r.value >= st.threshold - 1e-9;
      rows.push({ def, on: st.on, threshold: st.threshold, param: st.param,
        applicable: true, value: r.value, affected: r.affected || [], pass });
    }
    const scored = rows.filter(r => r.applicable && r.on);
    const passed = scored.filter(r => r.pass).length;
    m._policy = {
      rows,
      summary: {
        evaluated: scored.length,
        passed,
        failed: scored.length - passed,
        score: scored.length ? passed / scored.length : 0
      }
    };
    return m._policy;
  }

  HR.policy = { CATALOG, evaluate, set, settingsFor };
})(window.HR);
