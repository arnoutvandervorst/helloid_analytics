/* Pattern mining over an import: proposes taxonomy, account-class and price-book rules
   from the naming actually present in the data, instead of assuming the defaults fit.
   Everything returned is a proposal — nothing is applied until the user says so. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const SPLIT = /[-_.\s]+/;
  const MIN_NAMES = 5;          // a prefix needs this many distinct names to be worth a rule
  const MIN_ACCOUNTS = 2;       // an account-name pattern needs this many accounts

  /* Names that carry a per-seat price often enough to be worth flagging for pricing. */
  const PRICEABLE = /(^lic|licen|m365|o365|e[135]\b|f[13]\b|copilot|adobe|acrobat|visio|project|power ?bi|tableau|autocad|salesforce|jira|confluence|zoom|docusign)/i;

  const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * @param {Object} model a built model
   * @returns {Object} proposals + coverage figures
   */
  /* Licence-price mining is all that is left here: category and class
     proposals moved to the family model in js/wizard.js. */
  function suggest(model) {
    const prices = model.permissionList
      .filter(p => !p.monthlyPrice && PRICEABLE.test(p.name))
      .map(p => ({
        kind: 'price', pattern: '^' + escapeRx(p.name) + '$', label: p.name,
        price: 0, count: p.holderCount, samples: [p.name]
      }))
      .sort((a, b) => b.count - a.count);
    return { prices };
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

  /* The recognition vocabulary lives in js/hints.js (editable data); these
     shims keep the callers' address stable. */
  const hintFor = token => HR.hints.categoryHintFor(token);
  const classHintFor = token => HR.hints.classHintFor(token);

  /* --- mining hygiene (shared by pyramid, roles and optimise) ---------------
     Entitlements matching cfg.mining.excluded stay out of every mining engine:
     legacy groups and known noise otherwise resurface in each proposal round. */
  function exclusion(model) {
    const cfg = HR.config.get().mining || {};
    const specs = cfg.excluded || [];
    /* compileMatch returns the pattern SOURCE; compiling is the caller's job. */
    const rxs = specs.map(s => {
      const pat = HR.config.compileMatch(s);
      if (!pat) return null;
      try { return new RegExp(pat, 'i'); } catch (e) { return null; }
    }).filter(Boolean);
    /* Deepest-only: with a directory loaded, the nesting itself says which
       groups are the real permissions. Abstraction layers (members of other
       groups) are expressed by the terminals they feed, and dynamic groups
       are query-managed — neither belongs in a mined rule proposal. */
    const meta = (cfg.deepestOnly !== false && HR.app && HR.app.state.directory)
      ? HR.app.state.directory.groupMeta : null;
    if (!rxs.length && !meta) return { any: false, skip: () => false };
    const cache = new Map();
    const skip = key => {
      let hit = cache.get(key);
      if (hit === undefined) {
        const p = model.permissions.get(key);
        const name = p ? p.name : String(key);
        hit = rxs.some(rx => rx.test(name));
        if (!hit && meta) {
          const g = meta.get(name.toLowerCase());
          if (g && (g.dynamic || g.kind === 'role')) hit = true;
        }
        cache.set(key, hit);
      }
      return hit;
    };
    return { any: true, skip };
  }

  /** Proposed-rule names honour cfg.mining.ruleName ({kind} and {conditions} tokens).
      The default is the conditions alone: a kind prefix like "Piramide" says how the
      rule was found, which is noise in the rule set it lands in — the template brings
      it back for whoever wants it. */
  function ruleName(kind, conditions) {
    const tpl = (HR.config.get().mining || {}).ruleName;
    if (!tpl) return conditions;
    return tpl.replace('{kind}', kind).replace('{conditions}', conditions);
  }

  HR.mine = { suggest, test, escapeRx, hintFor, classHintFor, exclusion, ruleName };
})(window.HR);
