/* The classification wizard: every mined family, its current answer, and a
   select to change it. Bank-statement flow, direct manipulation — changing a
   family's select IS the decision ("all like this"), changing one member is a
   single-item assignment, and names outside every family are tagged one by
   one. Nothing here writes patterns; answers land in the family/item
   assignment maps (js/wizard.js). */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, partialNotice } = HR.viewkit;

  let WZ = null;   // { model, ex, step, d } — survives re-renders

  function ensure(m) {
    if (WZ && WZ.model === m) return WZ;
    const ex = HR.wizard.examine(m);
    const d = {
      permFamilies: new Map(),   // key -> categoryId | { newLabel }
      permItems: new Map(),      // name -> categoryId
      accFamilies: new Map(),    // key -> classId | { newLabel }
      accItems: new Map(),       // account key -> classId
      prices: new Map()
    };
    ex.prices.forEach((p, i) => d.prices.set(i, { take: false, price: p.price || 0 }));
    WZ = { model: m, ex, step: 1, d };
    return WZ;
  }

  const rerender = () => HR.app.render();

  /* ---- shared bits ------------------------------------------------------ */

  function targetSelect(list, current, allowNew, onPick, emptyLabel) {
    const sel = el('select', {});
    sel.appendChild(el('option', { value: '', text: emptyLabel || T('wz.pick'), selected: !current }));
    list.forEach(c => {
      sel.appendChild(el('option', { value: c.id, text: HR.config.labelOf(c), selected: c.id === current }));
    });
    if (allowNew) sel.appendChild(el('option', { value: '__new', text: T('wz.newTarget') }));
    sel.onchange = () => onPick(sel.value, sel);
    return sel;
  }

  const sourceBadge = source =>
    source === 'family' ? el('span', { class: 'pill ok', text: T('wz.srcFamily') })
    : source === 'auto' ? el('span', { class: 'pill muted', text: T('wz.srcAuto') })
    : el('span', { class: 'pill warn', text: T('wz.srcNone') });

  /**
   * One family row. `store` holds the pending decision keyed by family key;
   * `itemStore` the pending single-item answers. The select is preset to the
   * pending decision or the current answer.
   */
  function familyRow(g, list, store, itemStore, itemKey, nameOf, labelOf) {
    const pending = store.get(g.key);
    const current = typeof pending === 'string' ? pending
      : pending && pending.newLabel ? '__pending_new'
      : (g.source === 'none' ? '' : g.current);

    const holder = el('span', {});
    const pick = v => {
      if (v === '__new') {
        const inp = el('input', { type: 'text', placeholder: T('wz.newTargetPh') });
        inp.style.width = '150px';
        inp.onchange = () => { if (inp.value.trim()) store.set(g.key, { newLabel: inp.value.trim(), hint: g }); };
        holder.innerHTML = ''; holder.appendChild(inp); inp.focus();
      } else if (v) {
        store.set(g.key, v);
      } else {
        store.delete(g.key);
      }
    };
    holder.appendChild(targetSelect(list, current === '__pending_new' ? '' : current, true, pick));
    if (pending && pending.newLabel) {
      holder.appendChild(el('span', { class: 'pill ok', text: '+ ' + pending.newLabel }));
    }

    const details = el('details', {});
    details.appendChild(el('summary', { class: 'note', text: T('wz.members', { n: g.count }) }));
    details.appendChild(el('table', { class: 'cond-list' }, g.members.slice(0, 200).map(mm =>
      el('tr', {}, [
        el('td', { class: 'mono', text: nameOf(mm) }),
        el('td', { class: 'note', text: labelOf(mm) }),
        el('td', {}, targetSelect(list, itemStore.get(itemKey(mm)) || '', false, v => {
          if (v) itemStore.set(itemKey(mm), v); else itemStore.delete(itemKey(mm));
        }, T('wz.followFamily')))
      ]))));

    return el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' }, [
      el('div', { class: 'row', style: 'gap:10px;align-items:center;flex-wrap:wrap' }, [
        sourceBadge(pending ? 'family' : g.source),
        el('strong', { class: 'mono', text: g.prefix || g.token }),
        el('span', { class: 'note', text: g.system +
          (g.kind === 'ends' ? ' · ' + T('wz.suffix') : '') }),
        el('span', { class: 'note', text: T('wz.groupCount', { n: g.count }) }),
        holder,
        g.overrides ? el('span', { class: 'note', text: T('wz.itemAnswers', { n: g.overrides }) }) : null
      ].filter(Boolean)),
      el('p', { class: 'note', style: 'margin:2px 0 0', text: g.samples.join(', ') }),
      details
    ]);
  }

  function strayTable(rows, list, itemStore, cols, exportName) {
    return HR.table.make({
      columns: cols.concat([{ key: 'assign', label: T('wz.cAssign'), sortable: false,
        render: r => targetSelect(list, itemStore.get(cols.key(r)) || '', false, v => {
          if (v) itemStore.set(cols.key(r), v); else itemStore.delete(cols.key(r));
        }) }]),
      rows, pageSize: 15, exportName,
      search: cols.search
    });
  }

  /* ---- steps ------------------------------------------------------------ */

  function stepPerms(m, wz) {
    const cfg = HR.config.get();
    const cats = cfg.categories.filter(c => c.id !== 'other');
    const wrap = el('div', {});
    wrap.appendChild(card(T('wz.permFamiliesTitle'), T('wz.permFamiliesNote'),
      el('div', {}, wz.ex.permFamilies.map(g =>
        familyRow(g, cats, wz.d.permFamilies, wz.d.permItems, p => p.name,
          p => p.name, p => p.categoryLabel)))));
    if (wz.ex.permStrays.length) {
      wrap.appendChild(card(T('wz.permStraysTitle'), T('wz.permStraysNote'),
        strayTable(wz.ex.permStrays, cats, wz.d.permItems, Object.assign([
          { key: 'name', label: T('py.cEntitlement'), value: p => p.name,
            render: p => el('span', { class: 'mono', text: p.name }) },
          { key: 'system', label: T('c.system'), value: p => p.system },
          { key: 'cur', label: T('wz.cCurrent'), value: p => p.categoryLabel },
          { key: 'holders', label: T('c.holders'), num: true, value: p => p.holderCount }
        ], { key: p => p.name, search: (p, q) => p.name.toLowerCase().includes(q) }), 'stray-permissions')));
    }
    return wrap;
  }

  function stepAccounts(m, wz) {
    const cfg = HR.config.get();
    const classes = cfg.accountClasses.filter(c => c.id !== 'user');
    const wrap = el('div', {});
    wrap.appendChild(el('p', { class: 'note', text: T('wz.accNote') }));
    if (wz.ex.accountFamilies.length) {
      wrap.appendChild(card(T('wz.accFamiliesTitle'), T('wz.accFamiliesNote'),
        el('div', {}, wz.ex.accountFamilies.map(g =>
          familyRow(g, classes, wz.d.accFamilies, wz.d.accItems, a => a.key,
            a => a.userName, a => a.clsLabel)))));
    } else {
      wrap.appendChild(el('p', { class: 'note', text: T('wz.nothingOpen') }));
    }
    return wrap;
  }

  function collectDecisions(wz) {
    const d = wz.d;
    const newCategories = [], newClasses = [];
    const permFamilies = [], accFamilies = [];
    const slugId = label => 'mined-' + String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    d.permFamilies.forEach((v, key) => {
      if (typeof v === 'string') permFamilies.push({ key, categoryId: v });
      else if (v && v.newLabel) {
        newCategories.push({ label: v.newLabel, sensitivity: v.hint ? v.hint.sensitivity : 1.0 });
        permFamilies.push({ key, categoryId: slugId(v.newLabel) });
      }
    });
    d.accFamilies.forEach((v, key) => {
      if (typeof v === 'string') accFamilies.push({ key, classId: v });
      else if (v && v.newLabel) {
        newClasses.push({ label: v.newLabel, weight: v.hint ? v.hint.weight : 1.2 });
        accFamilies.push({ key, classId: slugId(v.newLabel) });
      }
    });
    return {
      newCategories, newClasses, permFamilies, accFamilies,
      permItems: Array.from(d.permItems.entries()).map(([name, categoryId]) => ({ name, categoryId })),
      accItems: Array.from(d.accItems.entries()).map(([key, classId]) => ({ key, classId })),
      prices: wz.ex.prices
        .map((p, i) => ({ p, dec: d.prices.get(i) }))
        .filter(x => x.dec.take)
        .map(x => ({ label: x.p.label, pattern: x.p.pattern, price: x.dec.price }))
    };
  }

  function stepApply(m, wz) {
    const cfg = HR.config.get();
    const dec = collectDecisions(wz);
    const wrap = el('div', {});
    wrap.appendChild(card(T('wz.applyTitle'), T('wz.applyNote'), el('div', { class: 'stack' }, [
      el('p', { text: T('wz.applySummary', {
        families: dec.permFamilies.length + dec.accFamilies.length,
        items: dec.permItems.length + dec.accItems.length }) }),
      el('p', { class: 'note', text: T('wz.applyDetail') })
    ])));

    if (wz.ex.prices.length) {
      wrap.appendChild(card(T('wz.pricesTitle'), T('wz.pricesNote'), HR.table.make({
        columns: [
          { key: 'take', label: '', sortable: false, render: (p) => {
            const i = wz.ex.prices.indexOf(p);
            const cb = el('input', { type: 'checkbox' });
            cb.checked = wz.d.prices.get(i).take;
            cb.onchange = () => { wz.d.prices.get(i).take = cb.checked; };
            return cb;
          } },
          { key: 'label', label: T('py.cEntitlement'), value: p => p.label,
            render: p => el('span', { class: 'mono', text: p.label }) },
          { key: 'count', label: T('c.holders'), num: true, value: p => p.count },
          { key: 'price', label: T('wz.cPrice'), sortable: false, render: (p) => {
            const i = wz.ex.prices.indexOf(p);
            const inp = el('input', { type: 'number', min: 0, step: 0.5, value: wz.d.prices.get(i).price });
            inp.style.width = '80px';
            inp.onchange = () => {
              wz.d.prices.get(i).price = Math.max(0, +inp.value || 0);
              wz.d.prices.get(i).take = true;
            };
            return inp;
          } }
        ],
        rows: wz.ex.prices, pageSize: 10, exportName: 'price-proposals'
      })));
    }

    const skip = el('input', { type: 'checkbox' });
    skip.checked = !!cfg.skipReview;
    skip.onchange = () => { cfg.skipReview = skip.checked; HR.config.save(); };
    wrap.appendChild(el('label', { class: 'inline' }, [skip, document.createTextNode(T('wz.skipNext'))]));

    wrap.appendChild(el('div', { class: 'slot-actions', style: 'margin-top:12px' }, [
      el('button', { class: 'btn primary', text: T('wz.apply'), onclick: async () => {
        const res = HR.wizard.apply(collectDecisions(wz));
        WZ = null;
        HR.app.state.review = null;
        await HR.app.rebuildBusy();
        U.toast(T('wz.applied', { families: res.families, items: res.items }));
        HR.app.go('overview');
      } }),
      el('button', { class: 'btn', text: T('wz.later'), onclick: () => {
        HR.app.state.review = null;
        HR.app.go('overview');
      } })
    ]));
    return wrap;
  }

  /* ---- view ------------------------------------------------------------- */

  function stepNav(wz) {
    return el('div', { class: 'slot-actions', style: 'margin:12px 0' }, [
      wz.step > 1 ? el('button', { class: 'btn', text: T('wz.back'),
        onclick: () => { wz.step--; rerender(); } }) : null,
      wz.step < 3 ? el('button', { class: 'btn primary', text: T('wz.next'),
        onclick: () => { wz.step++; rerender(); } }) : null
    ].filter(Boolean));
  }

  function classifyView(m) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('wz.title') }),
      el('p', { text: T('wz.lead') })
    ])));
    if (!m || !m.summary) {
      const note = partialNotice(['recon']);
      if (note) f.appendChild(note);
      f.appendChild(card(null, null, el('p', { text: T('wz.empty') })));
      return f;
    }
    const wz = ensure(m);
    const cov = wz.ex.coverage;
    const srcLine = src => ['manual', 'family', 'auto', 'membership', 'default']
      .filter(k => src[k]).map(k => T('wz.src.' + k) + ' ' + U.fmtInt(src[k])).join(' · ');

    f.appendChild(el('div', { class: 'grid g4', style: 'margin-bottom:14px' }, [
      tile(T('wz.kUnmappedPerms'), U.fmtInt(wz.ex.unmapped.permissions),
        T('wz.kUnmappedPermsFoot', { total: U.fmtInt(cov.permissions) }),
        { severity: wz.ex.unmapped.permissions ? 'medium' : 'good' }),
      tile(T('wz.kOpenFamilies'), U.fmtInt(wz.ex.unmapped.families + wz.ex.unmapped.cohorts),
        T('wz.kOpenFamiliesFoot'),
        { severity: (wz.ex.unmapped.families + wz.ex.unmapped.cohorts) ? 'medium' : 'good' }),
      tile(T('wz.kPermSources'), srcLine(cov.permSources) || '—', T('wz.kPermSourcesFoot'), { small: true }),
      tile(T('wz.kStep'), wz.step + ' / 3', T('wz.step' + wz.step), { small: true })
    ]));

    f.appendChild(stepNav(wz));
    f.appendChild(wz.step === 1 ? stepPerms(m, wz) : wz.step === 2 ? stepAccounts(m, wz) : stepApply(m, wz));
    f.appendChild(stepNav(wz));
    return f;
  }

  HR.views.classify = classifyView;
  HR.views.review = classifyView;   // the old configuration-review address
})(window.HR);
