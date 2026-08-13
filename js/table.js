/* Reusable data table: sort, search, dropdown filters, paging, CSV export. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;

  /**
   * @param {Object} o
   *   columns: [{key, label, num?, render?(row), value?(row), sortable?}]
   *   rows: any[]
   *   search?: (row, q) => boolean
   *   filters?: [{key, label, options:[{value,label}], match:(row,value)=>boolean}]
   *   pageSize?: number, onRowClick?: (row)=>void, exportName?: string, initialSort?: {key, dir}
   *   bulkActions?: [{label:(n)=>string, run:(rows)=>void}] — adds a checkbox column,
   *     a header checkbox that selects every *filtered* row (not just the page), and a
   *     bulk bar in the toolbar while anything is selected.
   */
  function make(o) {
    const state = {
      sort: o.initialSort || { key: o.columns[0].key, dir: 1 },
      q: '', page: 0, pageSize: o.pageSize || 50,
      filters: {},
      selected: new Set()
    };
    const root = el('div');
    const toolbar = el('div', { class: 'toolbar' });
    const bulkBar = el('span', { class: 'row', hidden: true });
    if (o.bulkActions) toolbar.appendChild(bulkBar);
    const searchBox = el('input', {
      type: 'search', placeholder: o.searchPlaceholder || U.t('c.search'),
      oninput: e => { state.q = e.target.value.trim().toLowerCase(); state.page = 0; render(); }
    });
    searchBox.style.minWidth = '220px';
    if (o.search) toolbar.appendChild(searchBox);

    (o.filters || []).forEach(f => {
      const sel = el('select', {
        onchange: e => { state.filters[f.key] = e.target.value; state.page = 0; render(); }
      });
      sel.appendChild(el('option', { value: '', text: f.label + ': ' + U.t('c.all') }));
      f.options.forEach(opt => sel.appendChild(el('option', { value: opt.value, text: f.label + ': ' + opt.label })));
      toolbar.appendChild(sel);
    });

    toolbar.appendChild(el('span', { class: 'spacer' }));
    const countNote = el('span', { class: 'count-note' });
    toolbar.appendChild(countNote);
    toolbar.appendChild(el('button', {
      class: 'btn sm', text: U.t('c.exportCsv'),
      onclick: () => {
        const rows = filtered().map(r => {
          const out = {};
          o.columns.forEach(c => out[c.label] = raw(c, r));
          return out;
        });
        HR.usage.exported('csv:' + (o.exportName || 'table'));
        U.download((o.exportName || 'export') + '.csv', U.toCSV(rows), 'text/csv;charset=utf-8');
      }
    }));

    const wrap = el('div', { class: 'tbl-wrap' });
    const pager = el('div', { class: 'pager' });
    root.append(toolbar, wrap, pager);

    const raw = (c, r) => c.value ? c.value(r) : r[c.key];

    function filtered() {
      let rows = o.rows;
      if (state.q && o.search) rows = rows.filter(r => o.search(r, state.q));
      (o.filters || []).forEach(f => {
        const v = state.filters[f.key];
        if (v) rows = rows.filter(r => f.match(r, v));
      });
      const col = o.columns.find(c => c.key === state.sort.key);
      if (col) {
        rows = rows.slice().sort((a, b) => {
          const x = raw(col, a), y = raw(col, b);
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * state.sort.dir;
          return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), HR.i18n.locale) * state.sort.dir;
        });
      }
      return rows;
    }

    function renderBulkBar() {
      if (!o.bulkActions) return;
      const n = state.selected.size;
      bulkBar.hidden = !n;
      bulkBar.innerHTML = '';
      if (!n) return;
      o.bulkActions.forEach(a => bulkBar.appendChild(el('button', {
        class: 'btn sm primary', text: a.label(n),
        onclick: () => { const rows = Array.from(state.selected); state.selected.clear(); a.run(rows); }
      })));
    }

    function render() {
      const rows = filtered();
      const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      state.page = U.clamp(state.page, 0, pages - 1);
      const slice = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

      countNote.textContent = U.t('c.rowsOf', { shown: U.fmtInt(rows.length), total: U.fmtInt(o.rows.length) });
      renderBulkBar();

      const table = el('table', { class: 'tbl' });
      const thead = el('thead'), htr = el('tr');
      if (o.bulkActions) {
        const all = rows.length > 0 && rows.every(r => state.selected.has(r));
        const head = el('input', { type: 'checkbox' });
        head.checked = all;
        head.addEventListener('change', () => {
          if (all) rows.forEach(r => state.selected.delete(r));
          else rows.forEach(r => state.selected.add(r));
          render();
        });
        const th = el('th', { class: 'no-sort' });
        th.appendChild(head);
        htr.appendChild(th);
      }
      o.columns.forEach(c => {
        const active = state.sort.key === c.key;
        const th = el('th', {
          class: (c.num ? 'num ' : '') + (c.sortable === false ? 'no-sort' : ''),
          title: c.hint || ''
        });
        th.append(document.createTextNode(c.label));
        if (active) th.append(el('span', { class: 'arrow', text: state.sort.dir > 0 ? ' ▲' : ' ▼' }));
        if (c.sortable !== false) th.addEventListener('click', () => {
          if (state.sort.key === c.key) state.sort.dir *= -1;
          else state.sort = { key: c.key, dir: c.num ? -1 : 1 };
          render();
        });
        htr.appendChild(th);
      });
      thead.appendChild(htr); table.appendChild(thead);

      const tb = el('tbody');
      slice.forEach(r => {
        const tr = el('tr', { class: o.onRowClick ? 'click' : '' });
        if (o.bulkActions) {
          const box = el('input', { type: 'checkbox' });
          box.checked = state.selected.has(r);
          box.addEventListener('change', () => {
            if (box.checked) state.selected.add(r); else state.selected.delete(r);
            render();
          });
          const td = el('td');
          td.addEventListener('click', e => e.stopPropagation());
          td.appendChild(box);
          tr.appendChild(td);
        }
        o.columns.forEach(c => {
          const td = el('td', { class: c.num ? 'num' : '' });
          const v = c.render ? c.render(r) : raw(c, r);
          if (v instanceof Node) td.appendChild(v);
          else td.textContent = (typeof v === 'number') ? U.fmtInt(v) : (v == null ? '' : String(v));
          tr.appendChild(td);
        });
        if (o.onRowClick) tr.addEventListener('click', () => o.onRowClick(r));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      wrap.innerHTML = ''; wrap.appendChild(table);

      pager.innerHTML = '';
      if (pages > 1) {
        pager.append(
          el('button', { class: 'btn sm', text: U.t('c.prev'), onclick: () => { state.page--; render(); } }),
          el('span', { text: U.t('c.page', { p: state.page + 1, n: pages }) }),
          el('button', { class: 'btn sm', text: U.t('c.next'), onclick: () => { state.page++; render(); } })
        );
      }
    }

    render();
    root.refresh = render;
    root.setRows = rows => { o.rows = rows; state.page = 0; render(); };
    return root;
  }

  HR.table = { make };
})(window.HR);
