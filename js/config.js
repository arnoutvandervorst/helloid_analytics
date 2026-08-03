/* Tunable model: permission taxonomy, licence price book, risk weights, account classes.
   Everything here is user-editable in the Settings view and persisted to localStorage. */
(function (HR) {
  'use strict';

  const KEY = 'hr.config.v1';

  /* --- permission taxonomy -------------------------------------------------
     Matched in order against the permission display name. `sensitivity` is the
     multiplier applied to a permission-level risk weight. */
  const DEFAULT_CATEGORIES = [
    { id: 'privileged', key: 'cat.privileged', label: 'Privileged / PAM', pattern: '^(PRIV|ADMIN|TIER0)', sensitivity: 3.0, color: 8 },
    { id: 'server', key: 'cat.server',     label: 'Server / infra',   pattern: '^(SRV|DB|LOG)',       sensitivity: 2.4, color: 7 },
    { id: 'security', key: 'cat.security',   label: 'Security control', pattern: '^SEC',                sensitivity: 1.6, color: 5 },
    { id: 'licence', key: 'cat.licence',    label: 'Licence',          pattern: '^LIC',                sensitivity: 1.0, color: 4 },
    { id: 'role', key: 'cat.role',       label: 'Business role',    pattern: '^(ROLE|ROL)',         sensitivity: 1.8, color: 3 },
    { id: 'fileshare', key: 'cat.fileshare',  label: 'File share',       pattern: '^(FS|SHARE)',         sensitivity: 1.5, color: 2 },
    { id: 'application', key: 'cat.application',label: 'Application',      pattern: '^APP',                sensitivity: 1.2, color: 1 },
    { id: 'mailbox', key: 'cat.mailbox',    label: 'Mailbox',          pattern: '^MBX',                sensitivity: 1.2, color: 6 },
    { id: 'team', key: 'cat.team',       label: 'Team / collab',    pattern: '^TEAM',               sensitivity: 0.8, color: 3 },
    { id: 'device', key: 'cat.device',     label: 'Device / print',   pattern: '^(PRINT|WIFI|VPN)',   sensitivity: 0.8, color: 6 },
    { id: 'other', key: 'cat.other',      label: 'Uncategorised',    pattern: '.',                   sensitivity: 1.0, color: 2 }
  ];

  /* --- account classes ------------------------------------------------------
     Matched against username, then display name. `weight` scales account risk. */
  const DEFAULT_ACCOUNT_CLASSES = [
    { id: 'admin', key: 'cls.admin',   label: 'Admin account',   pattern: '^(adm[-_.]|admin[-_.]|a-|_adm)', weight: 2.4 },
    { id: 'service', key: 'cls.service', label: 'Service account', pattern: '^(svc|srv|sa[-_.]|app[-_.]|sys[-_.])', weight: 1.6 },
    { id: 'test', key: 'cls.test',    label: 'Test / demo',     pattern: '^(test|tst|demo|dummy|poc)', weight: 1.8 },
    { id: 'shared', key: 'cls.shared',  label: 'Shared / generic',pattern: '^(shared|gen[-_.]|info|balie|receptie|algemeen)', weight: 1.5 },
    { id: 'external', key: 'cls.external',label: 'External / vendor',pattern: '(leverancier|partner|extern|detachering|contractor|vendor)', weight: 1.7 },
    { id: 'user', key: 'cls.user',    label: 'User account',    pattern: '.', weight: 1.0 }
  ];

  /* --- licence price book ---------------------------------------------------
     Monthly list price per assigned permission, matched by regex on the
     permission name. Defaults are public EUR list prices (annual commitment,
     monthly billing) and are meant to be corrected to the customer's contract. */
  const DEFAULT_PRICE_BOOK = [
    { pattern: '^LIC-M365-E5$',           price: 54.75, unit: 'month', label: 'Microsoft 365 E5' },
    { pattern: '^LIC-M365-E3$',           price: 33.75, unit: 'month', label: 'Microsoft 365 E3' },
    { pattern: '^LIC-M365-E1$',           price: 10.25, unit: 'month', label: 'Microsoft 365 E1' },
    { pattern: '^LIC-M365-F3$',           price:  7.50, unit: 'month', label: 'Microsoft 365 F3' },
    { pattern: '^LIC-',                   price: 10.00, unit: 'month', label: 'Other licence group' },
    { pattern: '^APP-Copilot',            price: 28.10, unit: 'month', label: 'Microsoft 365 Copilot' },
    { pattern: '^APP-Adobe-AcrobatPro',   price: 23.99, unit: 'month', label: 'Adobe Acrobat Pro' },
    { pattern: '^APP-PowerBI-Pro',        price:  9.40, unit: 'month', label: 'Power BI Pro' },
    { pattern: '^APP-Visio',              price: 15.10, unit: 'month', label: 'Visio Plan 2' },
    { pattern: '^APP-Project',            price: 27.10, unit: 'month', label: 'Project Plan 3' }
  ];

  /* --- effort / labour cost of remediation --------------------------------- */
  const DEFAULT_EFFORT = {
    hourlyRate: 85,                 // internal loaded rate
    minutesPerUnmanagedPermission: 4,
    minutesPerUnmanagedAccount: 25,
    minutesPerMissingPermission: 10,
    minutesPerPrivilegedReview: 45
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

  const DEFAULTS = {
    currency: 'EUR',
    categories: DEFAULT_CATEGORIES,
    accountClasses: DEFAULT_ACCOUNT_CLASSES,
    priceBook: DEFAULT_PRICE_BOOK,
    effort: DEFAULT_EFFORT,
    risk: DEFAULT_RISK,
    correlation: DEFAULT_CORRELATION,
    products: DEFAULT_PRODUCTS,
    pyramid: DEFAULT_PYRAMID,
    peers: DEFAULT_PEERS,
    rarityThreshold: 3,             // held by <= N accounts counts as rare
    skipReview: false,              // skip the configuration review on import
    severityBands: { critical: 70, high: 45, medium: 20 }
  };

  let current = null;

  function load() {
    if (current) return current;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
    current = stored ? deepMerge(clone(DEFAULTS), stored) : clone(DEFAULTS);
    adoptKeys(current);
    compile(current);
    return current;
  }

  function save(cfg) {
    current = cfg || current;
    compile(current);
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

  /* Settings saved before translation existed carry no key. Re-attach it where the
     entry is still one of the shipped defaults, so it follows the interface language. */
  function adoptKeys(cfg) {
    const pair = [[cfg.categories, DEFAULTS.categories], [cfg.accountClasses, DEFAULT_ACCOUNT_CLASSES]];
    pair.forEach(([list, defs]) => list.forEach(item => {
      if (item.key) return;
      const def = defs.find(d => d.id === item.id);
      if (def && def.label === item.label) item.key = def.key;
    }));
  }

  /* Pre-compile the regexes once per config change. */
  function compile(cfg) {
    const rx = list => list.forEach(r => {
      try { r._rx = new RegExp(r.pattern, 'i'); }
      catch (e) { r._rx = /$^/; r._bad = true; }
    });
    rx(cfg.categories); rx(cfg.accountClasses); rx(cfg.priceBook);
  }

  const clone = o => JSON.parse(JSON.stringify(o));
  function stripCompiled(cfg) {
    const c = clone(cfg);
    [c.categories, c.accountClasses, c.priceBook].forEach(l => l.forEach(r => { delete r._rx; delete r._bad; }));
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

  const categoryFor = name => {
    const cfg = load();
    return cfg.categories.find(c => c._rx.test(name)) || cfg.categories[cfg.categories.length - 1];
  };
  const accountClassFor = (userName, displayName) => {
    const cfg = load();
    return cfg.accountClasses.find(c => c._rx.test(userName) || c._rx.test(displayName || '')) ||
      cfg.accountClasses[cfg.accountClasses.length - 1];
  };
  const priceFor = name => {
    const cfg = load();
    const hit = cfg.priceBook.find(p => p._rx.test(name));
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

  HR.config = { get: load, save, reset, DEFAULTS, categoryFor, accountClassFor, priceFor,
    severityOf, clone, labelOf, exportJson, importJson, looksLikeSettings, FILE_KIND,
    getMap, setMapping, exportMap, exportMapCsv, importMap, looksLikeProductMap, MAP_KIND };
})(window.HR);
