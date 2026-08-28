/* The storage kill-switch.

   Everything this app persists — settings and decisions in localStorage, the
   snapshot archive and the raw imported files in IndexedDB — is convenience,
   not requirement: the analysis runs entirely in memory. This module is the
   one place that says whether persisting is allowed at all.

   Turning it off wipes every store and makes all the save paths no-ops; the
   session keeps working in memory and simply forgets on reload. The switch
   itself (plus the notice-seen and usage flags) is the single disclosed
   exception that stays in localStorage — without it the choice to not be
   remembered could not be remembered. */
(function (HR) {
  'use strict';

  const KEY = 'hr.storage.v1';
  const OWNED = ['hr.config.v1', 'hr.brand', 'hr.nav.v1', 'hr.theme', 'hr.lang'];

  let flags = { enabled: true, noticeSeen: false, usage: true };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (stored) flags = Object.assign(flags, stored);
  } catch (e) { /* storage blocked: defaults, in-memory only */ }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(flags)); } catch (e) { /* not fatal */ }
  }

  /** Remove every store this app owns; the flag object itself survives. */
  function wipe() {
    OWNED.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    /* store.js knows how to close its own connection first; fall back to a
       raw delete when it is not loaded (early boot). */
    if (HR.store && HR.store.wipeDb) HR.store.wipeDb();
    else try { indexedDB.deleteDatabase('helloid-recon'); } catch (e) { /* ignore */ }
  }

  function set(on) {
    flags.enabled = !!on;
    persist();
    if (!on) wipe();
  }

  HR.storageMode = {
    enabled: () => flags.enabled,
    set,
    wipe,
    noticeSeen: () => flags.noticeSeen,
    markNotice: () => { flags.noticeSeen = true; persist(); },
    usageAllowed: () => flags.usage,
    setUsage: on => { flags.usage = !!on; persist(); }
  };
})(window.HR);
