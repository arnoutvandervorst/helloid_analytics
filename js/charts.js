/* Hand-rolled charts. No dependencies, no CDN — the file opens offline.
   Colour is assigned by entity (never by rank), categorical slots are used in fixed
   order and never cycled past 8, and every chart ships a hover layer. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const el = U.el;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const slot = i => 'var(--series-' + (((i - 1) % 8) + 1) + ')';
  const STATUS = { critical: 'var(--critical)', high: 'var(--serious)', medium: 'var(--warning)',
    low: 'var(--muted)', info: 'var(--series-1)', good: 'var(--good)',
    /* aliases so callers can name the colour rather than the band */
    serious: 'var(--serious)', warning: 'var(--warning)' };
  const seqStep = t => {
    const steps = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)'];
    return steps[U.clamp(Math.floor(t * steps.length), 0, steps.length - 1)];
  };

  function svg(w, h, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    s.setAttribute('class', 'chart ' + (cls || ''));
    s.style.height = h + 'px';
    s.style.maxHeight = h + 'px';
    return s;
  }
  function n(tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- bar list */
  /** data: [{label, value, color?, note?, tip?, onClick?}] — DOM bars, direct labels. */
  function barList(data, opts) {
    opts = opts || {};
    const max = Math.max(1, ...data.map(d => d.value));
    const wrap = el('div', { class: 'bars' });
    data.forEach((d, i) => {
      const row = el('div', { class: 'bar-row' });
      const label = el('div', { class: 'trunc', title: d.label, text: d.label });
      const track = el('div', { class: 'track' });
      const fill = el('div', { class: 'fill' });
      fill.style.width = (100 * d.value / max) + '%';
      fill.style.background = d.color || slot(1);
      track.appendChild(fill);
      const v = el('div', { class: 'v', text: opts.format ? opts.format(d.value) : U.fmtInt(d.value) });
      row.append(label, track, v);
      if (d.onClick) { row.style.cursor = 'pointer'; row.addEventListener('click', d.onClick); }
      U.tip(row, () => d.tip || ('<div class="t-title">' + U.esc(d.label) + '</div><div class="t-row"><span>' +
        (opts.valueLabel || 'value') + '</span><b>' + (opts.format ? opts.format(d.value) : U.fmtInt(d.value)) + '</b></div>' +
        (d.note ? '<div class="t-row"><span>' + U.esc(d.note) + '</span></div>' : '')));
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* -------------------------------------------------------- 100% stacked bar */
  /** data: [{label, value, color}] — one horizontal bar plus legend. */
  function stackedBar(data, opts) {
    opts = opts || {};
    const total = U.sum(data, d => d.value) || 1;
    const wrap = el('div');
    const bar = el('div');
    Object.assign(bar.style, { display: 'flex', gap: '2px', height: '22px', width: '100%' });
    data.forEach(d => {
      if (!d.value) return;
      const seg = el('div');
      Object.assign(seg.style, {
        width: (100 * d.value / total) + '%', background: d.color, borderRadius: '4px', minWidth: '3px'
      });
      U.tip(seg, () => '<div class="t-title">' + U.esc(d.label) + '</div>' +
        '<div class="t-row"><span>count</span><b>' + U.fmtInt(d.value) + '</b></div>' +
        '<div class="t-row"><span>share</span><b>' + U.fmtPct(d.value / total) + '</b></div>');
      if (d.onClick) { seg.style.cursor = 'pointer'; seg.addEventListener('click', d.onClick); }
      bar.appendChild(seg);
    });
    wrap.appendChild(bar);
    wrap.appendChild(legend(data.filter(d => d.value).map(d => ({
      label: d.label + ' · ' + U.fmtInt(d.value), color: d.color
    }))));
    return wrap;
  }

  function legend(items) {
    const l = el('div', { class: 'legend' });
    items.forEach(it => {
      const k = el('span', { class: 'k' });
      const sw = el('span', { class: 'sw' }); sw.style.background = it.color;
      k.append(sw, document.createTextNode(it.label));
      l.appendChild(k);
    });
    return l;
  }

  /* ------------------------------------------------------------- histogram */
  /** values: number[]; bins over [0,max]. Sequential fill by bin position. */
  function histogram(values, opts) {
    opts = opts || {};
    const bins = opts.bins || 10;
    const maxV = opts.max || Math.max(1, ...values);
    const counts = new Array(bins).fill(0);
    values.forEach(v => counts[U.clamp(Math.floor(v / maxV * bins), 0, bins - 1)]++);
    const W = 640, H = opts.height || 170, padL = 34, padB = 26, padT = 10, padR = 6;
    const s = svg(W, H);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxC = Math.max(1, ...counts);

    [0, .5, 1].forEach(t => {
      const y = padT + plotH * (1 - t);
      s.appendChild(n('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      s.appendChild(n('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11 },
        U.fmtInt(maxC * t)));
    });

    const bw = plotW / bins;
    counts.forEach((c, i) => {
      const h = plotH * c / maxC;
      const x = padL + i * bw, y = padT + plotH - h;
      const r = n('rect', { x: x + 2, y: y, width: Math.max(1, bw - 4), height: Math.max(c ? 2 : 0, h), rx: 4,
        fill: opts.color || seqStep(i / bins) });
      const lo = Math.round(maxV / bins * i), hi = Math.round(maxV / bins * (i + 1));
      U.tip(r, () => '<div class="t-title">' + (opts.unit || 'score') + ' ' + lo + '–' + hi + '</div>' +
        '<div class="t-row"><span>' + (opts.itemLabel || 'items') + '</span><b>' + U.fmtInt(c) + '</b></div>');
      if (opts.onBin) { r.style.cursor = 'pointer'; r.addEventListener('click', () => opts.onBin(lo, hi)); }
      s.appendChild(r);
    });

    [0, .25, .5, .75, 1].forEach(t => {
      s.appendChild(n('text', { x: padL + plotW * t, y: H - 8, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 },
        Math.round(maxV * t)));
    });
    s.appendChild(n('line', { x1: padL, x2: W - padR, y1: padT + plotH, y2: padT + plotH, stroke: 'var(--axis)', 'stroke-width': 1 }));
    return s;
  }

  /* --------------------------------------------------------------- scatter */
  /** points: [{x, y, r?, label, tip, color?, onClick?}] — one series, status-coloured. */
  function scatter(points, opts) {
    opts = opts || {};
    const W = 640, H = opts.height || 300, padL = 44, padB = 34, padT = 12, padR = 12;
    const s = svg(W, H);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxX = opts.maxX || Math.max(1, ...points.map(p => p.x));
    const maxY = opts.maxY || Math.max(1, ...points.map(p => p.y));
    const sx = v => padL + plotW * (v / maxX);
    const sy = v => padT + plotH * (1 - v / maxY);

    [0, .25, .5, .75, 1].forEach(t => {
      const y = padT + plotH * (1 - t);
      s.appendChild(n('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      s.appendChild(n('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11 },
        opts.formatY ? opts.formatY(maxY * t) : Math.round(maxY * t)));
    });
    [0, .25, .5, .75, 1].forEach(t => {
      s.appendChild(n('text', { x: sx(maxX * t), y: H - 14, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 },
        opts.formatX ? opts.formatX(maxX * t) : Math.round(maxX * t)));
    });
    if (opts.xLabel) s.appendChild(n('text', { x: padL + plotW / 2, y: H - 1, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }, opts.xLabel));
    if (opts.yLabel) s.appendChild(n('text', { x: 10, y: padT + 4, fill: 'var(--muted)', 'font-size': 11 }, opts.yLabel));

    points.forEach(p => {
      const c = n('circle', {
        cx: sx(p.x), cy: sy(p.y), r: p.r || 4.5,
        fill: p.color || slot(1), 'fill-opacity': .75,
        stroke: 'var(--surface-1)', 'stroke-width': 1.5
      });
      U.tip(c, () => p.tip);
      if (p.onClick) { c.style.cursor = 'pointer'; c.addEventListener('click', p.onClick); }
      s.appendChild(c);
    });
    return s;
  }

  /* ------------------------------------------------------------------ line */
  /** series: [{label, color, points:[{x,y,tip}]}] — x is an index, labels supplied. */
  function line(series, xLabels, opts) {
    opts = opts || {};
    const W = 640, H = opts.height || 220, padL = 46, padB = 30, padT = 12, padR = 14;
    const s = svg(W, H);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const allY = series.flatMap(se => se.points.map(p => p.y));
    const maxY = opts.maxY || Math.max(1, ...allY);
    const nx = Math.max(1, xLabels.length - 1);
    const sx = i => padL + (nx ? plotW * i / nx : plotW / 2);
    const sy = v => padT + plotH * (1 - v / maxY);

    [0, .5, 1].forEach(t => {
      const y = padT + plotH * (1 - t);
      s.appendChild(n('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      s.appendChild(n('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11 },
        opts.formatY ? opts.formatY(maxY * t) : Math.round(maxY * t)));
    });
    xLabels.forEach((lb, i) => {
      if (xLabels.length > 8 && i % Math.ceil(xLabels.length / 8) !== 0) return;
      s.appendChild(n('text', { x: sx(i), y: H - 10, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 }, lb));
    });

    series.forEach(se => {
      const d = se.points.map((p, i) => (i ? 'L' : 'M') + sx(p.x != null ? p.x : i) + ' ' + sy(p.y)).join(' ');
      s.appendChild(n('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      se.points.forEach((p, i) => {
        const c = n('circle', { cx: sx(p.x != null ? p.x : i), cy: sy(p.y), r: 4.5, fill: se.color, stroke: 'var(--surface-1)', 'stroke-width': 2 });
        U.tip(c, () => p.tip || ('<div class="t-title">' + U.esc(se.label) + '</div><div class="t-row"><span>' +
          U.esc(xLabels[i] || '') + '</span><b>' + U.fmtInt(p.y) + '</b></div>'));
        s.appendChild(c);
      });
    });
    return s;
  }

  /* --------------------------------------------------------------- heatmap */
  /** rows: [{label, cells:[{label, value, tip, onClick}]}] — sequential single hue. */
  function heatmap(rows, colLabels, opts) {
    opts = opts || {};
    const max = Math.max(1, ...rows.flatMap(r => r.cells.map(c => c.value)));
    const table = el('table', { class: 'tbl' });
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', { class: 'no-sort', text: opts.corner || '' }));
    colLabels.forEach(c => hr.appendChild(el('th', { class: 'no-sort num', text: c })));
    thead.appendChild(hr); table.appendChild(thead);
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      tr.appendChild(el('td', { text: r.label }));
      r.cells.forEach(c => {
        const td = el('td', { class: 'num' });
        td.textContent = c.value ? U.fmtInt(c.value) : '·';
        if (c.value) {
          td.style.background = seqStep(c.value / max);
          td.style.color = (c.value / max) > .45 ? '#fff' : 'var(--text-primary)';
        }
        if (c.onClick) { td.style.cursor = 'pointer'; td.addEventListener('click', c.onClick); }
        U.tip(td, () => c.tip || null);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    return el('div', { class: 'tbl-wrap' }, table);
  }

  HR.charts = { barList, stackedBar, histogram, scatter, line, heatmap, legend, slot, STATUS, seqStep };
})(window.HR);
