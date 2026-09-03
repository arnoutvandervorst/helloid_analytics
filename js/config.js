/* Tunable model: permission taxonomy, licence price book, risk weights, account classes.
   Everything here is user-editable in the Settings view and persisted to localStorage. */
(function (HR) {
  'use strict';

  const KEY = 'hr.config.v1';

  /* --- structured matchers --------------------------------------------------
     Regex is the engine's language, not the analyst's. Every pattern field can
     carry a sibling spec — { op, value } with a comma-separated value list —
     that compiles to the regex the engine actually runs. The compiled string
     stays stored in the original field, so exports, older builds and the
     matching code never notice. Ops: equals, starts, ends, contains, and regex
     as the escape hatch. The compiled style deliberately mirrors the legacy
     hand-written patterns ('^(A|B)') so restated defaults stay byte-identical
     where they can, which is what lets stored configs adopt the specs. */
  const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function compileMatch(spec) {
    if (!spec || !spec.op) return '';
    if (spec.op === 'regex') return String(spec.value || '');
    const values = String(spec.value || '').split(',').map(v => v.trim()).filter(Boolean);
    if (!values.length) return '';
    const body = values.length === 1 ? escapeRx(values[0]) : '(' + values.map(escapeRx).join('|') + ')';
    switch (spec.op) {
      case 'equals': return '^' + body + '$';
      case 'starts': return '^' + body;
      case 'ends': return body + '$';
      case 'contains': return body;
      default: return '';
    }
  }

  /* Which pattern field pairs with which spec field, per list. */
  const MATCH_FIELDS = {
    employeeCategories: [['vaultPattern', 'vaultMatch'], ['accountPattern', 'accountMatch'], ['groupPattern', 'groupMatch']],
    priceBook: [['pattern', 'match']]
  };

  /* A row that carries a spec is authored through it: the spec wins, the pattern
     field is its compilation. Rows without one are hand-written regex and stay so. */
  function syncMatchSpecs(cfg) {
    Object.keys(MATCH_FIELDS).forEach(listKey => {
      (cfg[listKey] || []).forEach(row => {
        MATCH_FIELDS[listKey].forEach(([patternField, specField]) => {
          const spec = row[specField];
          if (spec && spec.op) row[patternField] = compileMatch(spec);
        });
      });
    });
  }

  /* --- permission taxonomy -------------------------------------------------
     Matched in order against the permission display name. `sensitivity` is the
     multiplier applied to a permission-level risk weight. */
  const DEFAULT_CATEGORIES = [
    { id: 'privileged', key: 'cat.privileged', label: 'Privileged / PAM', sensitivity: 3.0, color: 8 },
    { id: 'server', key: 'cat.server', label: 'Server / infra', sensitivity: 2.4, color: 7 },
    { id: 'security', key: 'cat.security', label: 'Security control', sensitivity: 1.6, color: 5 },
    { id: 'licence', key: 'cat.licence', label: 'Licence', sensitivity: 1.0, color: 4 },
    { id: 'role', key: 'cat.role', label: 'Business role', sensitivity: 1.8, color: 3 },
    { id: 'fileshare', key: 'cat.fileshare', label: 'File share', sensitivity: 1.5, color: 2 },
    { id: 'application', key: 'cat.application', label: 'Application', sensitivity: 1.2, color: 1 },
    { id: 'mailbox', key: 'cat.mailbox', label: 'Mailbox', sensitivity: 1.2, color: 6 },
    { id: 'team', key: 'cat.team', label: 'Team / collab', sensitivity: 0.8, color: 3 },
    { id: 'device', key: 'cat.device', label: 'Device / print', sensitivity: 0.8, color: 6 },
    { id: 'other', key: 'cat.other', label: 'Uncategorised', sensitivity: 1.0, color: 2 }
  ];

  /* --- account classes ------------------------------------------------------
     What the account technically is; `weight` scales identity risk. Classified by
     the same layered engine as employee categories — `pattern` matches username
     then display name, `groupPattern` the entitlements it holds, `vaultPattern`
     the linked contract text. Name evidence leads here (naming conventions are the
     stronger signal for admin/service accounts); membership catches the admin
     account that does not announce itself. The last row is the fallback and is
     not matched on patterns. */
  const DEFAULT_ACCOUNT_CLASSES = [
    { id: 'admin', key: 'cls.admin', label: 'Admin account', weight: 2.4 },
    { id: 'service', key: 'cls.service', label: 'Service account', weight: 1.6 },
    { id: 'test', key: 'cls.test', label: 'Test / demo', weight: 1.8 },
    { id: 'shared', key: 'cls.shared', label: 'Shared / generic', weight: 1.5 },
    { id: 'external', key: 'cls.external', label: 'External / vendor', weight: 1.7 },
    { id: 'user', key: 'cls.user', label: 'User account', weight: 1.0 }
  ];

  /* --- employee categories --------------------------------------------------
     Who the account works for, as a risk multiplier on its entitlement components:
     the same access weighs heavier on an account the organisation controls less.
     Detection is layered: a vault-linked person's contract Type/Employer text is
     the best evidence, the account's own naming the second, group membership the
     third; an account matching none of them takes the last row. Patterns are per
     layer because the vocabularies differ — a contract says "uitzendkracht", the
     account says "ext-", the group says "G-Extern". */
  const DEFAULT_EMPLOYEE_CATEGORIES = [
    { id: 'payroll', key: 'ecat.payroll', label: 'Payroll', multiplier: 1.0,
      vaultPattern: '(payroll|loondienst|dienstverband|vast|onbepaalde|bepaalde|cao)',
      vaultMatch: { op: 'contains', value: 'payroll, loondienst, dienstverband, vast, onbepaalde, bepaalde, cao' },
      accountPattern: '', groupPattern: '' },
    { id: 'student', key: 'ecat.student', label: 'Intern / student', multiplier: 1.15,
      vaultPattern: '(stagiair|stage|student|trainee|leerling)',
      vaultMatch: { op: 'contains', value: 'stagiair, stage, student, trainee, leerling' },
      accountPattern: '(^stg[-_.]|stagiair|student|trainee)',
      groupPattern: '(stagiair|student|trainee)',
      groupMatch: { op: 'contains', value: 'stagiair, student, trainee' } },
    { id: 'volunteer', key: 'ecat.volunteer', label: 'Volunteer', multiplier: 1.2,
      vaultPattern: '(vrijwillig|volunteer)', vaultMatch: { op: 'contains', value: 'vrijwillig, volunteer' },
      accountPattern: '(vrijwillig|volunteer)', accountMatch: { op: 'contains', value: 'vrijwillig, volunteer' },
      groupPattern: '(vrijwillig|volunteer)', groupMatch: { op: 'contains', value: 'vrijwillig, volunteer' } },
    { id: 'temp', key: 'ecat.temp', label: 'Temp / external', multiplier: 1.25,
      vaultPattern: '(inhuur|uitzend|extern|detacher|interim|zzp|freelan|temp|contractor|flex)',
      vaultMatch: { op: 'contains', value: 'inhuur, uitzend, extern, detacher, interim, zzp, freelan, temp, contractor, flex' },
      accountPattern: '(^ext[-_.]|extern|inhuur|uitzend|contractor)',
      groupPattern: '(extern|inhuur|uitzend|contractor)',
      groupMatch: { op: 'contains', value: 'extern, inhuur, uitzend, contractor' } },
    { id: 'supplier', key: 'ecat.supplier', label: 'Supplier / vendor', multiplier: 1.5,
      vaultPattern: '(leverancier|supplier|vendor|partner)',
      vaultMatch: { op: 'contains', value: 'leverancier, supplier, vendor, partner' },
      accountPattern: '(^sup[-_.]|^vnd[-_.]|leverancier|supplier|vendor|partner)',
      groupPattern: '(leverancier|supplier|vendor|partner)',
      groupMatch: { op: 'contains', value: 'leverancier, supplier, vendor, partner' } },
    { id: 'ecatUnknown', key: 'ecat.unknown', label: 'Unknown', multiplier: 1.0,
      vaultPattern: '', accountPattern: '', groupPattern: '' }
  ];

  /* --- licence price book ---------------------------------------------------
     Monthly list price per assigned permission. A rule links to a permission
     classification — the pattern knowledge lives in the taxonomy, not here — and
     may carry a refine regex to price specific names inside it. An empty refine
     prices the whole classification; an empty classification applies to any.
     First match wins, so specific rules go above their classification's default.
     Defaults are public EUR list prices (annual commitment, monthly billing) and
     are meant to be corrected to the customer's contract. */
  const DEFAULT_PRICE_BOOK = [
    { classification: 'licence',     pattern: 'M365-E5$',          match: { op: 'ends', value: 'M365-E5' }, price: 54.75, unit: 'month', label: 'Microsoft 365 E5' },
    { classification: 'licence',     pattern: 'M365-E3$',          match: { op: 'ends', value: 'M365-E3' }, price: 33.75, unit: 'month', label: 'Microsoft 365 E3' },
    { classification: 'licence',     pattern: 'M365-E1$',          match: { op: 'ends', value: 'M365-E1' }, price: 10.25, unit: 'month', label: 'Microsoft 365 E1' },
    { classification: 'licence',     pattern: 'M365-F3$',          match: { op: 'ends', value: 'M365-F3' }, price:  7.50, unit: 'month', label: 'Microsoft 365 F3' },
    { classification: 'licence',     pattern: '',                  price: 10.00, unit: 'month', label: 'Other licence group' },
    { classification: 'application', pattern: 'Copilot',           match: { op: 'contains', value: 'Copilot' }, price: 28.10, unit: 'month', label: 'Microsoft 365 Copilot' },
    { classification: 'application', pattern: 'Adobe-AcrobatPro',  match: { op: 'contains', value: 'Adobe-AcrobatPro' }, price: 23.99, unit: 'month', label: 'Adobe Acrobat Pro' },
    { classification: 'application', pattern: 'PowerBI-Pro',       match: { op: 'contains', value: 'PowerBI-Pro' }, price:  9.40, unit: 'month', label: 'Power BI Pro' },
    { classification: 'application', pattern: 'Visio',             match: { op: 'contains', value: 'Visio' }, price: 15.10, unit: 'month', label: 'Visio Plan 2' },
    { classification: 'application', pattern: 'Project',           match: { op: 'contains', value: 'Project' }, price: 27.10, unit: 'month', label: 'Project Plan 3' }
  ];

  /* --- effort / labour cost of remediation --------------------------------- */
  const DEFAULT_EFFORT = {
    hourlyRate: 85,                 // internal loaded rate
    minutesPerUnmanagedPermission: 4,
    minutesPerUnmanagedAccount: 25,
    minutesPerMissingPermission: 10,
    minutesPerPrivilegedReview: 45,
    minutesPerManualAction: 6,      // a grant or revoke done by hand, per the history export
    minutesPerFailedAction: 15,     // rework after a failed or blocked provisioning action
    idleDayCost: 0                  // what a joiner without access costs per day; 0 = not stated
  };

  /* --- account-to-person matching -------------------------------------------
     A vault exported without Accounts[] carries no correlation at all, which is common,
     so attribution falls back to the reconciliation export's own Person column and then
     to scored name evidence. Every weight is exposed because naming conventions differ
     per customer: where logins are surname+number, the surname rule carries the work;
     where they are firstname.lastname, the display-name rules do. */
  const DEFAULT_CORRELATION = {
    strongThreshold: 90,          // points needed before a match is proposed at all
    useVaultCorrelation: true,    // trust Accounts[] in the vault
    useReconPerson: true,         // trust the Person column on the reconciliation row
    useNameMatch: true,           // fall back to scored name evidence
    weights: {
      vaultCorrelated: 200,
      displayNameExact: 100,
      employeeIdInUsername: 90,
      displayNameContains: 55,
      surnameInUsername: 30,
      firstAndSurnameInUsername: 25,
      initialBeforeSurname: 10
    }
  };

  /* --- risk weights --------------------------------------------------------- */
  const DEFAULT_RISK = {
    issueWeights: {
      'Account unmanaged': 28,      // an identity nobody owns
      'Permission unmanaged': 2,    // entitlement outside the IAM model
      'Permission missing': 6,      // person should have it but does not
      'Unspecified': 3
    },
    orphanEnabledBonus: 22,         // no person + still enabled
    disabledWithEntitlementsBonus: 14,
    disabledWithLicenceBonus: 8,
    privilegedOrphanBonus: 30,
    rarityBonus: 10,                // max bonus for entitlements almost nobody else holds
    stackedLicenceBonus: 8,
    outlierBonus: 12,               // peer-group entitlement outlier
    toxicBonus: 15,                 // a toxic combination on the account, scaled by its severity
    unmanagedPermCap: 22,           // ceiling on the entitlement-drift component
    accountCap: 100                 // account scores clamp here
  };

  /* --- Service Automation ---------------------------------------------------
     HelloID records no link between a product and the entitlement it hands out; the
     link only exists in whatever a product's tasks do. So the tool proposes matches by
     name and this map holds the ones a human confirmed. It is settings, not data: it
     describes a tenant's conventions and survives every re-import. */
  const DEFAULT_PRODUCTS = {
    minName: 0.5,                   // token-similarity floor for proposing a match
    minOverlap: 0.5,                // holder-set overlap that corroborates a proposal
    topN: 3,                        // proposals kept per product
    staleDays: 730,                 // open assignment older than this is worth a look
    riskFactorFloor: 7,             // HelloID's own risk factor, at which we report holders
    map: {}                         // product name -> [{ system, permission, source }]
  };

  /* --- role pyramid ----------------------------------------------------------
     threshold decides when a group is uniform enough to call a rule; minSize decides
     how small a group may be before a rule about it means nothing. minSize is the one
     that silently caps granularity: a department splits into job titles of two or three
     people, so a floor of five discards every deeper level and adding one looks like it
     did nothing. Three is small enough for a real team and large enough that one
     person's access cannot become a role on its own. */
  const DEFAULT_PYRAMID = {
    threshold: 0.9,                 // share of a group that must hold it
    /* The floor everyone gets, held to its own bar: somebody is always missing MFA, and
       the people who fall through are the point rather than a rounding error. */
    baselineThreshold: 0.9,
    minSize: 3,                     // members a group needs before it can carry a rule
    maxLevels: 4,
    combos: true,
    maxConditions: 2,
    minComboGain: 3,
    pollutionBelow: 0.1,
    levels: []                      // empty = use the suggested order
  };

  /* --- similar-access peers ---------------------------------------------------
     How alike two people must be before they are peers, and how much of a peer group
     has to agree before what this person lacks counts as a gap. Both are judgements
     about an organisation rather than facts about the data. */
  const DEFAULT_PEERS = {
    minSimilarity: 0.5,
    topN: 12,
    consensus: 0.8,
    rare: 0.2,
    ignoreCommon: 0.9
  };

  /* --- optimising the imported rules ---------------------------------------
     maxTrade caps how many new SOLL grants a non-lossless merge may hand out before it
     stops being proposed. */
  const DEFAULT_OPTIMISE = { maxTrade: 25 };

  const DEFAULTS = {
    currency: 'EUR',
    categories: DEFAULT_CATEGORIES,
    accountClasses: DEFAULT_ACCOUNT_CLASSES,
    employeeCategories: DEFAULT_EMPLOYEE_CATEGORIES,
    priceBook: DEFAULT_PRICE_BOOK,
    effort: DEFAULT_EFFORT,
    risk: DEFAULT_RISK,
    correlation: DEFAULT_CORRELATION,
    products: DEFAULT_PRODUCTS,
    pyramid: DEFAULT_PYRAMID,
    peers: DEFAULT_PEERS,
    optimise: DEFAULT_OPTIMISE,
    rarityThreshold: 3,             // held by <= N accounts counts as rare
    skipReview: false,              // skip the configuration review on import
    severityBands: { critical: 70, high: 45, medium: 20 },
    /* Mining hygiene: matcher specs excluded from role/rule mining, and a
       naming template for exported rule proposals ({dept}/{title}/{system}/
       {category} tokens; empty = the modules' built-in names). */
    mining: { excluded: [], ruleName: '', deepestOnly: true, ruleCap: 100 },
    policies: {},
    /* The classic role model's knobs (ported defaults from the old report). */
    classic: { minRoleMembers: 3, minRelevance: 50, globalPct: 90,
      similarityPct: 90, maxRoles: 100, clusterSim: 0.6, clusterMin: 5 }
  };

  let current = null;

  function load() {
    if (current) return current;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
    current = stored ? deepMerge(clone(DEFAULTS), stored) : clone(DEFAULTS);
    /* Classification moved from pattern filters to mined families + assignments:
       configs saved by older builds still carry pattern fields on these two
       lists — the definitions stay, the patterns are gone. */
    [current.categories, current.accountClasses].forEach(list => (list || []).forEach(r => {
      delete r.pattern; delete r.match; delete r.legacyPattern;
      delete r.groupPattern; delete r.groupMatch; delete r.vaultPattern; delete r.vaultMatch;
    }));
    adoptKeys(current);
    compile(current);
    return current;
  }

  function save(cfg) {
    current = cfg || current;
    compile(current);
    /* Storage off: the in-memory cfg keeps working, nothing is written. */
    if (HR.storageMode && !HR.storageMode.enabled()) return current;
    try { localStorage.setItem(KEY, JSON.stringify(stripCompiled(current))); }
    catch (e) { HR.util.toast('Could not persist settings (storage blocked).'); }
    return current;
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    current = clone(DEFAULTS);
    compile(current);
    return current;
  }

  /* Reconcile stored rows with the shipped defaults they came from. Settings saved
     before translation existed carry no key — re-attach it so the row follows the
     interface language. Fields introduced after the row was saved (the layered
     patterns, the multiplier) are adopted from the default with the same id; only
     `undefined` is filled, so a value the user cleared to empty stays cleared. */
  function adoptKeys(cfg) {
    const pair = [[cfg.categories, DEFAULTS.categories, 'categories'],
      [cfg.accountClasses, DEFAULT_ACCOUNT_CLASSES, 'accountClasses'],
      [cfg.employeeCategories, DEFAULT_EMPLOYEE_CATEGORIES, 'employeeCategories']];
    pair.forEach(([list, defs, listKey]) => list.forEach(item => {
      const def = defs.find(d => d.id === item.id);
      if (!def) return;
      ['groupPattern', 'vaultPattern', 'accountPattern', 'multiplier', 'sensitivity', 'weight', 'color'].forEach(k => {
        if (def[k] !== undefined && item[k] === undefined) item[k] = def[k];
      });
      /* Structured specs introduced after the row was saved are adopted only when
         the stored regex is still the shipped one (byte-equal, or equal to the
         pre-spec legacy form) — a hand-tuned pattern stays hand-tuned. */
      (MATCH_FIELDS[listKey] || []).forEach(([pf, sf]) => {
        if (item[sf] !== undefined || !def[sf]) return;
        if (item[pf] === def[pf] || (pf === 'pattern' && def.legacyPattern && item[pf] === def.legacyPattern)) {
          item[sf] = clone(def[sf]);
        }
      });
      if (!item.key && def.label === item.label) item.key = def.key;
    }));
    /* Price rows carry no id; the shipped ones are recognisable by label + pattern. */
    (cfg.priceBook || []).forEach(item => {
      if (item.match !== undefined) return;
      const def = DEFAULT_PRICE_BOOK.find(d => d.label === item.label && d.pattern === item.pattern);
      if (def && def.match) item.match = clone(def.match);
    });
  }

  /* Pre-compile the regexes once per config change. */
  function compile(cfg) {
    syncMatchSpecs(cfg);
    const rx = list => list.forEach(r => {
      try { r._rx = new RegExp(r.pattern, 'i'); }
      catch (e) { r._rx = /$^/; r._bad = true; }
    });
    migratePriceBook(cfg);
    rx(cfg.priceBook);
    /* Employee categories keep their layered patterns; permission categories and
       account classes are pure definitions since classification moved to mined
       families + assignments (see js/wizard.js). */
    const layers = (list, accountField) => (list || []).forEach(c => {
      const one = (src) => {
        if (!src) return null;
        try { return new RegExp(src, 'i'); } catch (e) { c._bad = true; return null; }
      };
      c._rxVault = one(c.vaultPattern);
      c._rxAccount = one(c[accountField]);
      c._rxGroup = one(c.groupPattern);
    });
    layers(cfg.employeeCategories, 'accountPattern');
  }

  /* Price rows saved before rules linked to classifications carry only a regex.
     Classify the pattern by its own text: when the pattern matches the sample it
     denotes ("^LIC-M365-E5$" → "LIC-M365-E5"), that sample can be classified like
     any permission name and the row lands in that classification with its old
     pattern as the refine. A pattern too regex-shaped to yield a sample prices
     any classification — exactly what it did before. Idempotent: only rows with
     no classification field at all are touched. */
  function migratePriceBook(cfg) {
    (cfg.priceBook || []).forEach(p => {
      if (p.classification !== undefined) return;
      const sample = (p.pattern || '').replace(/^\^/, '').replace(/\$$/, '').replace(/\\(.)/g, '$1');
      let cls = '';
      try {
        if (sample && new RegExp(p.pattern, 'i').test(sample)) {
          const cat = cfg.categories.find(c => c._rx && c._rx.test(sample));
          if (cat && cat.id !== 'other') cls = cat.id;
        }
      } catch (e) { /* unreadable pattern keeps any-classification */ }
      p.classification = cls;
    });
  }

  const clone = o => JSON.parse(JSON.stringify(o));
  function stripCompiled(cfg) {
    const c = clone(cfg);
    [c.categories, c.accountClasses, c.priceBook].forEach(l => l.forEach(r => { delete r._rx; delete r._bad; }));
    [c.employeeCategories || [], c.accountClasses].forEach(l => l.forEach(r => {
      delete r._rxVault; delete r._rxAccount; delete r._rxGroup; delete r._bad;
    }));
    return c;
  }
  function deepMerge(base, over) {
    for (const k in over) {
      if (Array.isArray(over[k])) base[k] = over[k];
      else if (over[k] && typeof over[k] === 'object') base[k] = deepMerge(base[k] || {}, over[k]);
      else base[k] = over[k];
    }
    return base;
  }

  /** Shipped entries carry a translation key; user-added rows keep their own label. */
  const labelOf = item => (item && item.key && HR.i18n.has(item.key)) ? HR.i18n.t(item.key) : (item ? item.label : '');

  const categoryDefOf = id => {
    const cfg = load();
    return cfg.categories.find(c => c.id === id) || cfg.categories[cfg.categories.length - 1];
  };
  const classDefOf = id => {
    const cfg = load();
    return cfg.accountClasses.find(c => c.id === id) || cfg.accountClasses[cfg.accountClasses.length - 1];
  };
  /* Resolve a permission name without model context: per-item assignment, then a
     family assignment in any system, then the built-in name hint, else the
     fallback. The model build does the same with the system known. */
  const categoryFor = (name, system) => {
    const cfg = load();
    const ov = (cfg.catOverrides || {})[name];
    if (ov) return categoryDefOf(ov);
    const fam = HR.wizard ? HR.wizard.famKeyOf(name) : null;
    if (fam) {
      const fams = cfg.catFamilies || {};
      const key = system ? system + '\u001f' + fam : Object.keys(fams).find(k => k.endsWith('\u001f' + fam));
      if (key && fams[key]) return categoryDefOf(fams[key]);
    }
    const hint = fam && HR.mine ? HR.mine.hintFor(fam) : (HR.mine ? HR.mine.hintFor(name) : null);
    if (hint) {
      const def = cfg.categories.find(c => c.id === hint.hint);
      if (def) return def;
    }
    return cfg.categories[cfg.categories.length - 1];
  };
  /* Name evidence only; the model build adds assignments and the membership
     heuristic (privileged holdings make an admin account). */
  const accountClassFor = (userName) => {
    const cfg = load();
    const key = HR.wizard ? HR.wizard.cohortKeyOf(userName) : null;
    const hint = key && HR.mine ? HR.mine.classHintFor(key.split(':')[1] || '') : null;
    if (hint) {
      const def = cfg.accountClasses.find(c => c.id === hint.id);
      if (def) return def;
    }
    return cfg.accountClasses[cfg.accountClasses.length - 1];
  };
  /* A rule applies when its classification matches (empty = any) and its refine
     regex matches (empty = the whole classification). First match wins. */
  const priceFor = (name, categoryId) => {
    const cfg = load();
    const hit = cfg.priceBook.find(p =>
      (!p.classification || p.classification === categoryId) &&
      (!p.pattern || p._rx.test(name)));
    if (!hit) return { monthly: 0, entry: null };
    const monthly = hit.unit === 'year' ? hit.price / 12 : hit.price;
    return { monthly, entry: hit };
  };

  function severityOf(score) {
    const b = load().severityBands;
    if (score >= b.critical) return 'critical';
    if (score >= b.high) return 'high';
    if (score >= b.medium) return 'medium';
    return 'low';
  }

  /* Everything a run depends on, in one file. Opened from disk the app has no durable
     storage, so this is how a tuned price book and taxonomy survive to the next session
     — and how they travel to a colleague. */
  const FILE_KIND = 'helloid-analytics-settings';

  function exportJson() {
    return JSON.stringify({
      kind: FILE_KIND,
      version: 1,
      exportedAt: new Date().toISOString(),
      language: HR.i18n ? HR.i18n.lang : 'en',
      settings: stripCompiled(load()),
      branding: HR.brand ? HR.brand.state : null
    }, null, 2);
  }

  function importJson(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Settings file is not valid JSON: ' + e.message); }
    if (!data || data.kind !== FILE_KIND || !data.settings) {
      throw new Error('Not a settings file for this tool (expected kind "' + FILE_KIND + '").');
    }
    current = deepMerge(clone(DEFAULTS), data.settings);
    adoptKeys(current);
    save(current);
    if (data.branding && HR.brand) {
      HR.brand.set(data.branding);
      HR.brand.apply();
    }
    if (data.language && HR.i18n) HR.i18n.setLang(data.language);
    return {
      categories: current.categories.length,
      classes: current.accountClasses.length,
      prices: current.priceBook.length,
      products: Object.keys((current.products || {}).map || {}).length
    };
  }

  const looksLikeSettings = data => !!data && data.kind === FILE_KIND;

  /* --- the product map, as its own file ------------------------------------
     Settings travel per analyst; this map travels per tenant, and is the sort of thing
     one person works out and the rest of a team should not have to redo. */
  const MAP_KIND = 'helloid-analytics-product-map';

  function getMap() {
    const cfg = load();
    if (!cfg.products) cfg.products = clone(DEFAULT_PRODUCTS);
    if (!cfg.products.map) cfg.products.map = {};
    return cfg.products.map;
  }

  function setMapping(productName, entries) {
    const map = getMap();
    if (!entries || !entries.length) delete map[productName];
    else map[productName] = entries;
    save();
    return map;
  }

  function exportMap() {
    return JSON.stringify({
      kind: MAP_KIND, version: 1, exportedAt: new Date().toISOString(), map: getMap()
    }, null, 2);
  }

  function exportMapCsv() {
    const rows = [];
    const map = getMap();
    Object.keys(map).sort().forEach(product =>
      map[product].forEach(e => rows.push({
        Product: product, System: e.system || '', Entitlement: e.permission || '',
        Source: e.source || 'manual'
      })));
    return HR.util.toCSV(rows, ['Product', 'System', 'Entitlement', 'Source']);
  }

  function importMap(text, opts) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Product map is not valid JSON: ' + e.message); }
    if (!data || data.kind !== MAP_KIND || !data.map) {
      throw new Error('Not a product map (expected kind "' + MAP_KIND + '").');
    }
    const cfg = load();
    if (!cfg.products) cfg.products = clone(DEFAULT_PRODUCTS);
    cfg.products.map = (opts && opts.merge)
      ? Object.assign({}, cfg.products.map || {}, data.map) : data.map;
    save(cfg);
    return { products: Object.keys(cfg.products.map).length };
  }

  const looksLikeProductMap = data => !!data && data.kind === MAP_KIND;

  /* --- the match book, as its own file --------------------------------------
     Human decisions about which account belongs to which person. Like the
     product map this is tenant knowledge, not analyst preference: one person
     works through the hard matches once, exports the book, and the next session
     — or the next colleague — starts from those answers instead of from zero.
     Keys are system+userName (stable across exports); people are referenced by
     employee id first, so the book survives a re-imported vault. */
  const MATCH_KIND = 'helloid-analytics-match-book';

  function getMatchBook() {
    const cfg = load();
    if (!cfg.matchBook) cfg.matchBook = { decisions: {} };
    if (!cfg.matchBook.decisions) cfg.matchBook.decisions = {};
    return cfg.matchBook;
  }

  /**
   * @param {string} key HR.model.accountKey(system, userName)
   * @param {Object|null} patch merged into the entry; null removes it.
   *   { decision, personExternalId, personId, personName } — 'rejected' people
   *   accumulate in entry.rejected[] and can coexist with a decision.
   */
  function setMatchDecision(key, patch) {
    const book = getMatchBook();
    if (patch === null) delete book.decisions[key];
    else {
      const entry = book.decisions[key] || {};
      if (patch.reject) {
        entry.rejected = (entry.rejected || []).concat([patch.reject])
          .filter((v, i, a) => a.indexOf(v) === i);
      } else {
        Object.assign(entry, patch);
      }
      entry.decidedAt = new Date().toISOString();
      book.decisions[key] = entry;
    }
    save();
    return book;
  }

  /* Per-account employee-category overrides: a human's answer to a detection
     that guessed wrong, keyed by account. Only the corrected accounts live here. */
  function getEcatOverrides() {
    const cfg = load();
    if (!cfg.ecatOverrides) cfg.ecatOverrides = {};
    return cfg.ecatOverrides;
  }

  function setEcatOverride(key, id) {
    const overrides = getEcatOverrides();
    if (id) overrides[key] = id; else delete overrides[key];
    save();
  }

  /* Per-item classification assignments — the wizard's "just this one" answer.
     Permission categories keyed by permission name, account classes by account
     key. They win over every pattern rule, the way a corrected bank transaction
     wins over the auto-categoriser. */
  function getCatOverrides() {
    const cfg = load();
    if (!cfg.catOverrides) cfg.catOverrides = {};
    return cfg.catOverrides;
  }

  function setCatOverride(name, id) {
    const overrides = getCatOverrides();
    if (id) overrides[name] = id; else delete overrides[name];
    save();
  }

  function getCatFamilies() {
    const cfg = load();
    if (!cfg.catFamilies) cfg.catFamilies = {};
    return cfg.catFamilies;
  }

  function setCatFamily(key, id) {
    const fams = getCatFamilies();
    if (id) fams[key] = id; else delete fams[key];
    save();
  }

  function getClsFamilies() {
    const cfg = load();
    if (!cfg.clsFamilies) cfg.clsFamilies = {};
    return cfg.clsFamilies;
  }

  function setClsFamily(key, id) {
    const fams = getClsFamilies();
    if (id) fams[key] = id; else delete fams[key];
    save();
  }

  function getClsOverrides() {
    const cfg = load();
    if (!cfg.clsOverrides) cfg.clsOverrides = {};
    return cfg.clsOverrides;
  }

  function setClsOverride(key, id) {
    const overrides = getClsOverrides();
    if (id) overrides[key] = id; else delete overrides[key];
    save();
  }

  function exportMatchBook() {
    return JSON.stringify({
      kind: MATCH_KIND, version: 1, exportedAt: new Date().toISOString(),
      decisions: getMatchBook().decisions
    }, null, 2);
  }

  function importMatchBook(text, opts) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Match book is not valid JSON: ' + e.message); }
    if (!data || data.kind !== MATCH_KIND || !data.decisions) {
      throw new Error('Not a match book (expected kind "' + MATCH_KIND + '").');
    }
    const book = getMatchBook();
    book.decisions = (opts && opts.merge === false)
      ? data.decisions
      : Object.assign({}, book.decisions, data.decisions);
    save();
    return { decisions: Object.keys(book.decisions).length };
  }

  const looksLikeMatchBook = data => !!data && data.kind === MATCH_KIND;

  /* --- the Nedap ONS book, as its own file ----------------------------------
     The contents of the "NEDAP - Matrices functies deskundigheden" workbook as
     editable data: lookup lists, the two scope-mapping tabs, the Medewerkers-
     koppeling rows and the Autorisatierollen matrix. Like the match book this
     is tenant knowledge — import the customer's workbook once, refine it here,
     export the connector CSVs and the book itself for the next session. */
  const NEDAP_KIND = 'helloid-analytics-nedap-book';

  function getNedapBook() {
    const cfg = load();
    if (!cfg.nedapBook) cfg.nedapBook = HR.nedapons.emptyBook();
    const b = cfg.nedapBook;
    b.lookups = b.lookups || {};
    ['departments', 'titles', 'teams', 'locations', 'expertiseProfiles', 'weeksheetProfiles']
      .forEach(k => { if (!Array.isArray(b.lookups[k])) b.lookups[k] = []; });
    ['teamMappings', 'locationMappings', 'employees', 'roles']
      .forEach(k => { if (!Array.isArray(b[k])) b[k] = []; });
    return b;
  }

  /** Replace the whole book (workbook import) or mutate-and-save (editors call with no args after editing in place). */
  function setNedapBook(book) {
    const cfg = load();
    if (book) cfg.nedapBook = book;
    cfg.nedapBook.updatedAt = new Date().toISOString();
    save();
    return cfg.nedapBook;
  }

  function exportNedapBook() {
    const b = getNedapBook();
    return JSON.stringify({
      kind: NEDAP_KIND, version: 1, exportedAt: new Date().toISOString(),
      lookups: b.lookups, teamMappings: b.teamMappings, locationMappings: b.locationMappings,
      employees: b.employees, roles: b.roles
    }, null, 2);
  }

  function importNedapBook(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Nedap book is not valid JSON: ' + e.message); }
    if (!data || data.kind !== NEDAP_KIND) {
      throw new Error('Not a Nedap book (expected kind "' + NEDAP_KIND + '").');
    }
    const book = HR.nedapons.emptyBook();
    Object.keys(book.lookups).forEach(k => { book.lookups[k] = (data.lookups || {})[k] || []; });
    ['teamMappings', 'locationMappings', 'employees', 'roles']
      .forEach(k => { book[k] = Array.isArray(data[k]) ? data[k] : []; });
    setNedapBook(book);
    return {
      mappings: book.teamMappings.length + book.locationMappings.length,
      employees: book.employees.length, roles: book.roles.length
    };
  }

  const looksLikeNedapBook = data => !!data && data.kind === NEDAP_KIND;

  /* --- entitlement descriptions ---------------------------------------------
     Free-text notes per permission name (the feedback board's "descriptions on
     imported entitlements"). Plain config: travels with the settings export.
     Keyed by lowercased name so a note survives the same group arriving via
     reconciliation and directory import alike. */
  function getPermNote(name) {
    return (load().permNotes || {})[String(name || '').toLowerCase()] || '';
  }

  function setPermNote(name, text) {
    const cfg = load();
    cfg.permNotes = cfg.permNotes || {};
    const k = String(name || '').toLowerCase();
    const v = String(text || '').trim();
    if (v) cfg.permNotes[k] = v; else delete cfg.permNotes[k];
    save();
  }

  /* --- the name-generation convention ---------------------------------------
     Plain config (travels with the settings export): seeded lazily from the
     workbench's intake best-practice defaults, since namegen-lab.js loads
     after this file. */
  function getNamegen() {
    const cfg = load();
    if (!cfg.namegen || !cfg.namegen.fields) cfg.namegen = HR.namegenLab.defaults();
    return cfg.namegen;
  }

  HR.config = { get: load, save, reset, DEFAULTS, categoryFor, accountClassFor, priceFor, compileMatch,
    severityOf, clone, labelOf, exportJson, importJson, looksLikeSettings, FILE_KIND,
    getMap, setMapping, exportMap, exportMapCsv, importMap, looksLikeProductMap, MAP_KIND,
    getMatchBook, setMatchDecision, exportMatchBook, importMatchBook, looksLikeMatchBook, MATCH_KIND,
    getEcatOverrides, setEcatOverride,
    getCatOverrides, setCatOverride, getClsOverrides, setClsOverride,
    getCatFamilies, setCatFamily, getClsFamilies, setClsFamily, categoryDefOf, classDefOf,
    getNedapBook, setNedapBook, exportNedapBook, importNedapBook, looksLikeNedapBook, NEDAP_KIND,
    getNamegen, getPermNote, setPermNote };
})(window.HR);
