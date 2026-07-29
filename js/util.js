/* Small helpers shared by every module. Classic script — attaches to window.HR. */
window.HR = window.HR || {};

(function (HR) {
  'use strict';

  const loc = () => (HR.i18n ? HR.i18n.locale : 'en-GB');

  const el = (tag, attrs, children) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    if (children != null) (Array.isArray(children) ? children : [children])
      .forEach(c => c != null && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  };

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const fmtInt = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString(loc());
  const fmtNum = (n, d) => (n == null || isNaN(n)) ? '—'
    : n.toLocaleString(loc(), { minimumFractionDigits: d ?? 1, maximumFractionDigits: d ?? 1 });
  const fmtPct = (n, d) => (n == null || isNaN(n)) ? '—' : fmtNum(n * 100, d ?? 1) + '%';

  function fmtMoney(n, opts) {
    if (n == null || isNaN(n)) return '—';
    const cur = (HR.config && HR.config.get) ? HR.config.get().currency : 'EUR';
    const compact = opts && opts.compact && Math.abs(n) >= 10000;
    return n.toLocaleString(loc(), {
      style: 'currency', currency: cur,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : (Math.abs(n) < 1000 ? 2 : 0),
      minimumFractionDigits: compact ? 0 : (Math.abs(n) < 1000 ? 2 : 0)
    });
  }

  const fmtDate = ts => ts ? new Date(ts).toLocaleString(loc(),
    { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x) || 0, 0);
  const uniq = arr => Array.from(new Set(arr));
  const by = (arr, f) => {
    const m = new Map();
    for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  };
  const counts = (arr, f) => {
    const m = new Map();
    for (const x of arr) { const k = f ? f(x) : x; m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const sortMap = m => Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** Deterministic 32-bit hash — used to fingerprint an import. */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function severityRank(s) {
    return { critical: 0, high: 1, medium: 2, low: 3, info: 4, good: 5 }[s] ?? 9;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function toCSV(rows, columns) {
    const cols = columns || Object.keys(rows[0] || {});
    const cell = v => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(',')].concat(rows.map(r => cols.map(c => cell(r[c])).join(','))).join('\r\n');
  }

  let toastTimer;
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  const tipEl = () => document.getElementById('tooltip');
  function showTip(html, ev) {
    const t = tipEl();
    t.innerHTML = html; t.hidden = false;
    const pad = 14, r = t.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tipEl().hidden = true; };

  /** Attach tooltip behaviour to a node; fn(ev) returns HTML or null. */
  function tip(node, fn) {
    node.addEventListener('mousemove', ev => { const h = fn(ev); h ? showTip(h, ev) : hideTip(); });
    node.addEventListener('mouseleave', hideTip);
    return node;
  }

  const t = (k, p) => HR.i18n.t(k, p);

  HR.util = {
    el, esc, t, fmtInt, fmtNum, fmtPct, fmtMoney, fmtDate, sum, uniq, by, counts, sortMap,
    clamp, hash, severityRank, download, toCSV, toast, tip, showTip, hideTip
  };
})(window.HR);
