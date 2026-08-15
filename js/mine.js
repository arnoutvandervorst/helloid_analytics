/* Pattern mining over an import: proposes taxonomy, account-class and price-book rules
   from the naming actually present in the data, instead of assuming the defaults fit.
   Everything returned is a proposal — nothing is applied until the user says so. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const SPLIT = /[-_.\s]+/;
  const MIN_NAMES = 5;          // a prefix needs this many distinct names to be worth a rule
  const MIN_ACCOUNTS = 2;       // an account-name pattern needs this many accounts

  /* Hints used to pre-fill a sensitivity for a newly proposed category. Matching is on
     the token itself, so a customer's own prefix ("BEH", "SYS") can be recognised too. */
  const SENSITIVITY_HINTS = [
    { rx: /^(priv|pam|tier0|admin|beh|adm)/i, sensitivity: 3.0, hint: 'privileged' },
    { rx: /^(srv|server|db|sql|log|sys)/i, sensitivity: 2.4, hint: 'server' },
    { rx: /^(sec|mfa|av|crypt)/i, sensitivity: 1.6, hint: 'security' },
    { rx: /^(rol|role|func)/i, sensitivity: 1.8, hint: 'role' },
    { rx: /^(fs|share|dfs|nas)/i, sensitivity: 1.5, hint: 'fileshare' },
    { rx: /^(app|sw|soft)/i, sensitivity: 1.2, hint: 'application' },
    { rx: /^(mbx|mail|exch)/i, sensitivity: 1.2, hint: 'mailbox' },
    { rx: /^(team|grp|group|sp|sharepoint)/i, sensitivity: 0.8, hint: 'team' },
    { rx: /^(print|wifi|vpn|dev)/i, sensitivity: 0.8, hint: 'device' },
    { rx: /^(lic|licen|m365|o365)/i, sensitivity: 1.0, hint: 'licence' }
  ];

  /* Names that carry a per-seat price often enough to be worth flagging for pricing. */
  const PRICEABLE = /(^lic|licen|m365|o365|e[135]\b|f[13]\b|copilot|adobe|acrobat|visio|project|power ?bi|tableau|autocad|salesforce|jira|confluence|zoom|docusign)/i;

  /* Account-name shapes worth proposing as a class. */
  const CLASS_HINTS = [
    { rx: /^(adm|admin|a)$/i, id: 'admin', weight: 2.4 },
    { rx: /^(svc|srv|sa|sys|app|service)$/i, id: 'service', weight: 1.6 },
    { rx: /^(test|tst|demo|dummy|poc|acc|dev)$/i, id: 'test', weight: 1.8 },
    { rx: /^(info|balie|receptie|algemeen|shared|gen|generic)$/i, id: 'shared', weight: 1.5 },
    { rx: /^(ext|extern|external|inhuur|contractor|vendor|leverancier|partner)$/i, id: 'external', weight: 1.7 }
  ];

  const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * @param {Object} model a built model
   * @returns {Object} proposals + coverage figures
   */
  function suggest(model) {
    const cfg = HR.config.get();
    const perms = model.permissionList;
    const accounts = model.accountList;

    /* ---- permission prefixes that currently land in the catch-all category ---- */
    const uncategorised = perms.filter(p => p.category === 'other');
    const byPrefix = U.by(uncategorised, p => (p.name.split(SPLIT)[0] || '').toUpperCase());
    const categories = [];
    for (const [prefix, list] of byPrefix) {
      if (!prefix || prefix.length < 2 || list.length < MIN_NAMES) continue;
      const hint = SENSITIVITY_HINTS.find(h => h.rx.test(prefix));
      categories.push({
        kind: 'category',
        pattern: '^' + escapeRx(prefix) + '(?=[-_. ]|$)',
        label: prefix,
        sensitivity: hint ? hint.sensitivity : 1.0,
        hint: hint ? hint.hint : null,
        count: list.length,
        assignments: U.sum(list, p => p.holderCount),
        samples: list.slice(0, 4).map(p => p.name)
      });
    }
    categories.sort((a, b) => b.assignments - a.assignments || b.count - a.count);

    /* ---- account-name shapes that currently fall through to the default class ----
       Only markers are wanted here, not name parts. "firstname.lastname" is a naming
       convention, so a dot-separated token only counts when it matches known marker
       vocabulary; hyphen/underscore prefixes (adm-, svc-) are proposed on frequency. */
    const plain = accounts.filter(a => a.cls === 'user');
    const shapes = new Map();
    const bump = (key, pattern, account) => {
      if (!shapes.has(key)) shapes.set(key, { key, pattern, accounts: [] });
      shapes.get(key).accounts.push(account);
    };
    for (const a of plain) {
      const name = a.userName;
      const m = name.match(SPLIT);
      if (!m) continue;
      const sep = m[0];
      const parts = name.split(SPLIT);
      const head = parts[0], tail = parts[parts.length - 1];
      const softSep = sep === '.';                       // dot = probably a person's name
      if (head && head.length <= 6 && parts.length > 1) {
        const hint = CLASS_HINTS.find(h => h.rx.test(head));
        if (hint || !softSep) bump('pre:' + head.toLowerCase(), '^' + escapeRx(head) + escapeRx(sep), a);
      }
      if (tail && tail.length <= 6 && parts.length > 1) {
        const hint = CLASS_HINTS.find(h => h.rx.test(tail));
        if (hint) bump('suf:' + tail.toLowerCase(), escapeRx(sep) + escapeRx(tail) + '$', a);
      }
    }
    const floor = Math.max(MIN_ACCOUNTS, Math.round(accounts.length * 0.01));
    const classes = [];
    for (const shape of shapes.values()) {
      const token = shape.key.slice(4);
      const hint = CLASS_HINTS.find(h => h.rx.test(token));
      /* Known marker vocabulary is proposed from two accounts up; anything else has to
         be common enough in this export to look deliberate rather than coincidental. */
      if (shape.accounts.length < (hint ? MIN_ACCOUNTS : floor)) continue;
      classes.push({
        kind: 'class',
        pattern: shape.pattern,
        label: token,
        weight: hint ? hint.weight : 1.2,
        hint: hint ? hint.id : null,
        count: shape.accounts.length,
        enabled: shape.accounts.filter(a => a.enabled !== false).length,
        orphan: shape.accounts.filter(a => a.orphan).length,
        samples: shape.accounts.slice(0, 4).map(a => a.userName)
      });
    }
    classes.sort((a, b) => (b.hint ? 1 : 0) - (a.hint ? 1 : 0) || b.count - a.count);

    /* ---- groups that look priceable but carry no price ---- */
    const prices = perms
      .filter(p => !p.monthlyPrice && PRICEABLE.test(p.name))
      .map(p => ({
        kind: 'price',
        pattern: '^' + escapeRx(p.name) + '$',
        label: p.name,
        price: 0,
        count: p.holderCount,
        samples: [p.name]
      }))
      .sort((a, b) => b.count - a.count);

    /* ---- how much of the data the current settings actually describe ---- */
    const coverage = {
      permissions: perms.length,
      categorised: perms.length - uncategorised.length,
      categorisedPct: perms.length ? (perms.length - uncategorised.length) / perms.length : 1,
      accounts: accounts.length,
      classified: accounts.length - plain.length,
      classifiedPct: accounts.length ? (accounts.length - plain.length) / accounts.length : 1,
      priced: perms.filter(p => p.monthlyPrice > 0).length,
      priceable: prices.length,
      pricedSpend: model.cost.totalMonthly
    };

    return { categories, classes, prices, coverage };
  }

  /**
   * Run a pattern against the imported data so a rule can be checked before it is saved.
   * @param {string} pattern regex source
   * @param {'permission'|'account'} target
   * @returns {{valid:boolean, error?:string, count:number, total:number, samples:string[], everything:boolean}}
   */
  function test(pattern, target, model) {
    let rx;
    try { rx = new RegExp(pattern, 'i'); }
    catch (e) { return { valid: false, error: e.message, count: 0, total: 0, samples: [], everything: false }; }
    const names = target === 'account'
      ? model.accountList.map(a => a.userName)
      : model.permissionList.map(p => p.name);
    const hits = names.filter(n => rx.test(n));
    return {
      valid: true,
      count: hits.length,
      total: names.length,
      samples: hits.slice(0, 12),
      everything: names.length > 0 && hits.length === names.length
    };
  }

  /** Sensitivity pre-fill for a proposed token, shared with the conventions viewer. */
  const hintFor = token => SENSITIVITY_HINTS.find(h => h.rx.test(token)) || null;

  /* --- mining hygiene (shared by pyramid, roles and optimise) ---------------
     Entitlements matching cfg.mining.excluded stay out of every mining engine:
     legacy groups and known noise otherwise resurface in each proposal round. */
  function exclusion(model) {
    const specs = (HR.config.get().mining || {}).excluded || [];
    /* compileMatch returns the pattern SOURCE; compiling is the caller's job. */
    const rxs = specs.map(s => {
      const pat = HR.config.compileMatch(s);
      if (!pat) return null;
      try { return new RegExp(pat, 'i'); } catch (e) { return null; }
    }).filter(Boolean);
    if (!rxs.length) return { any: false, skip: () => false };
    const cache = new Map();
    const skip = key => {
      let hit = cache.get(key);
      if (hit === undefined) {
        const p = model.permissions.get(key);
        const name = p ? p.name : String(key);
        hit = rxs.some(rx => rx.test(name));
        cache.set(key, hit);
      }
      return hit;
    };
    return { any: true, skip };
  }

  /** Proposed-rule names honour cfg.mining.ruleName ({kind} and {conditions} tokens). */
  function ruleName(kind, conditions) {
    const tpl = (HR.config.get().mining || {}).ruleName;
    if (!tpl) return kind + ' - ' + conditions;
    return tpl.replace('{kind}', kind).replace('{conditions}', conditions);
  }

  HR.mine = { suggest, test, escapeRx, hintFor, exclusion, ruleName };
})(window.HR);
