/* Anonymous usage statistics.
 *
 * The question this answers is "what parts of this are actually used", not "who used
 * it". So what goes out is an event name, a view name, and coarse buckets — never a file
 * name, a person, an account, a group, a count that identifies a tenant, or anything
 * that could be joined back to a visitor.
 *
 * It posts to /u on the same origin, which the server answers with 204 and records in a
 * log format that deliberately omits the IP address, the user agent and the referrer.
 * There is no cookie, no identifier, and no third party: the CSP on the host allows
 * connections to 'self' only, so a beacon to anywhere else would be blocked.
 *
 * Importing a file sends the *kind* and a size bucket. That is the difference between
 * "someone analysed a large tenant" and "someone analysed Acme" — the first is a usage
 * statistic, the second would be customer data, and only the first leaves the page. */
(function (HR) {
  'use strict';

  const ENDPOINT = '/u';
  let enabled = true;
  let lastView = null;

  /* Opened from disk there is no server to talk to, and no statistics to gather. */
  if (typeof location === 'undefined' || location.protocol === 'file:') enabled = false;

  /** Coarse enough that no row count identifies a tenant. */
  function bucket(n) {
    if (!n) return '0';
    if (n < 100) return '<100';
    if (n < 1000) return '100-1k';
    if (n < 10000) return '1k-10k';
    if (n < 100000) return '10k-100k';
    return '100k+';
  }

  function send(event, params) {
    if (!enabled) return;
    try {
      const q = new URLSearchParams(Object.assign({ e: event }, params || {}));
      const url = ENDPOINT + '?' + q.toString();
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
    } catch (e) { /* statistics must never break the tool */ }
  }

  const api = {
    get enabled() { return enabled; },
    disable() { enabled = false; },
    /** A view was opened. Repeats are skipped so a re-render is not a second visit. */
    view(name) {
      if (name === lastView) return;
      lastView = name;
      send('view', { v: name, lang: HR.i18n ? HR.i18n.lang : '' });
    },
    /** A file was imported: what kind it was and roughly how big. Never what was in it. */
    imported(kind, rows) { send('import', { kind: kind, size: bucket(rows) }); },
    /** Something was taken out of the tool: CSV, the markdown report, the PDF print. */
    exported(kind) { send('export', { kind: kind }); },
    action(name, extra) { send('action', Object.assign({ a: name }, extra || {})); },
    start() { send('open', { lang: HR.i18n ? HR.i18n.lang : '' }); }
  };

  HR.usage = api;
})(window.HR);
