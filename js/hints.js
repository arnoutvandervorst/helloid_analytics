/* The recognition vocabulary: the product knowledge behind every "recognised"
   answer in the classification wizard.

   A permission name's first word is compared against the category rows (the
   word STARTS WITH a token); an account name's leading or trailing word
   against the account-type rows (the word IS a token); every word of a job
   title or department name against the staff rows (a word STARTS WITH a
   token). First row that hits wins, a wizard answer always beats a hint.

   Staff is the third list because it decides where a rule set pays off:
   operational roles — care, production, service — fit rules, one rule for
   many people; staff roles — HR, finance, IT, communication, project work —
   are project-based and better served by self-service.

   The rows are plain data, editable in Settings › Classification. Edits are
   stored in cfg.hints and travel with the settings export; without edits the
   built-in table below applies. Sensitivity and weight are never stored here —
   they come from the category / account-type definition the row points at. */
(function (HR) {
  'use strict';

  const DEFAULTS = {
    categories: [
      { t: 'priv, pam, tier0, admin, beh, adm', id: 'privileged' },
      { t: 'srv, server, db, sql, log, sys', id: 'server' },
      { t: 'sec, mfa, av, crypt', id: 'security' },
      { t: 'rol, role, func', id: 'role' },
      { t: 'fs, share, dfs, nas', id: 'fileshare' },
      { t: 'app, sw, soft', id: 'application' },
      { t: 'mbx, mail, exch', id: 'mailbox' },
      { t: 'team, grp, group, sp, sharepoint', id: 'team' },
      { t: 'print, wifi, vpn, dev', id: 'device' },
      { t: 'lic, licen, m365, o365', id: 'licence' }
    ],
    classes: [
      { t: 'adm, admin, a', id: 'admin' },
      { t: 'svc, srv, sa, sys, app, service', id: 'service' },
      { t: 'test, tst, demo, dummy, poc, acc, dev', id: 'test' },
      { t: 'info, balie, receptie, algemeen, shared, gen, generic', id: 'shared' },
      { t: 'ext, extern, external, inhuur, contractor, vendor, leverancier, partner', id: 'external' }
    ],
    staff: [
      { t: 'adviseur, advisor, consultant, analist, analyst, controller, jurist, legal, auditor, architect', id: 'staff' },
      { t: 'hr, hrm, p&o, personeel, personnel, recruit, salaris, payroll', id: 'staff' },
      { t: 'fin, financ, boekhoud, accounting, administratie, inkoop, procurement, purchas', id: 'staff' },
      { t: 'ict, it, informatie, information, applicatiebeheer, developer, ontwikkelaar, functioneel', id: 'staff' },
      { t: 'communicatie, communication, marketing, pr, redactie, editorial', id: 'staff' },
      { t: 'kwaliteit, quality, beleid, policy, staf, staff, strategie, strategy, compliance, privacy, secretar, office, directie, bestuur, board, management, project, programma, program', id: 'staff' }
    ]
  };

  const tokens = row => String(row.t || '').toLowerCase().split(',')
    .map(s => s.trim()).filter(Boolean);

  const rowsFor = kind => {
    const cfg = HR.config ? HR.config.get() : null;
    const stored = cfg && cfg.hints && cfg.hints[kind];
    return (Array.isArray(stored) && stored.length) ? stored : DEFAULTS[kind];
  };

  /** Category hint for a permission's prefix token (prefix match). */
  function categoryHintFor(token) {
    const t = String(token || '').toLowerCase();
    if (!t) return null;
    for (const row of rowsFor('categories')) {
      if (tokens(row).some(x => t.startsWith(x))) {
        const def = HR.config ? HR.config.categoryDefOf(row.id) : null;
        return { hint: row.id, sensitivity: def ? def.sensitivity : 1.0 };
      }
    }
    return null;
  }

  /** Account-type hint for a name's leading/trailing token (exact match). */
  function classHintFor(token) {
    const t = String(token || '').toLowerCase();
    if (!t) return null;
    for (const row of rowsFor('classes')) {
      if (tokens(row).includes(t)) {
        const def = HR.config ? HR.config.classDefOf(row.id) : null;
        return { id: row.id, weight: def ? def.weight : 1.2 };
      }
    }
    return null;
  }

  /** Words of a name: split on anything that is not a letter or digit, lowercased. */
  const words = name => String(name || '').toLowerCase().split(/[^\p{L}\p{N}&]+/u).filter(Boolean);

  /** A word matches a staff token when it starts with it — or, for tokens of five letters
      or more, contains it: Dutch compounds put the job at the end (kwaliteitsadviseur),
      while short tokens like "it" would otherwise hit inside "kwaliteit". */
  const staffWord = (w, t) => w.startsWith(t) || (t.length >= 5 && w.includes(t));

  /** Whether a job title or department name reads as staff work; `rows` overrides the list. */
  function staffFor(title, department, rows) {
    const ws = words(title).concat(words(department));
    if (!ws.length) return false;
    for (const row of rows || rowsFor('staff')) {
      const ts = tokens(row);
      if (ws.some(w => ts.some(t => staffWord(w, t)))) return true;
    }
    return false;
  }

  HR.hints = { DEFAULTS, categoryHintFor, classHintFor, staffFor, tokens };
})(window.HR);
