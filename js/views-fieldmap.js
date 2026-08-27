/* The field-mapping view: what the target connector's mapping says, and what
   an update run would actually change against the collected directory.

   Mapping tab reads the imported v1 MappingFields document as a table — per
   field the mode per provisioning action, uniqueness, standard-vs-customized —
   with the decoded value or JavaScript in a drawer. The Simulation tab is the
   payoff: evaluate every Update-scoped field for every joined person and diff
   the result against the attribute the collected AD/Entra holds today, before
   HelloID writes anything. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, tabbed, openDrawer } = HR.viewkit;

  const ACTIONS = ['Create', 'Update', 'Enable', 'Disable', 'Delete'];
  let SIM = null;          // last simulation result, invalidated on re-render inputs
  let SIM_STAMP = '';

  const fmtVal = v => {
    if (v === undefined) return '—';
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.join(', ');
    if (v === ' ') return '␣';
    return String(v);
  };

  /* ------------------------------------------------------------- mapping tab */

  function modeChip(set) {
    if (!set) return el('span', { class: 'note', text: '·' });
    const cls = { Fixed: 'pill muted', Field: 'pill', Complex: 'pill warn', None: 'pill muted' }[set.mode] || 'pill';
    return el('span', { class: cls, text: set.mode === 'None' ? '—' : set.mode.toLowerCase() });
  }

  function drawerField(fm, field) {
    const head = el('div', {}, [
      el('h2', { text: field.name }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: field.type }),
        field.unique ? el('span', { class: 'pill warn', text: T('fm.unique') }) : null,
        field.standard ? el('span', { class: 'pill ok', text: T('fm.standard') }) : null
      ])
    ]);
    const body = el('div', { class: 'stack' });
    if (field.description) body.appendChild(el('p', { class: 'note', text: field.description }));
    field.actions.forEach(set => {
      const pre = el('pre', { class: 'mono' });
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;font-size:12px';
      pre.textContent = set.mode === 'None' ? T('fm.noneNote')
        : set.mode === 'Field' ? String(set.value)
        : set.mode === 'Fixed' ? JSON.stringify(set.value)
        : String(set.value);
      body.appendChild(card(set.actions.join(' · ') + ' — ' + set.mode,
        set.store ? T('fm.storeNote') : null, pre));
    });
    openDrawer(head, body);
  }

  function mappingTab(fm) {
    const wrap = el('div', {});
    const tiles = el('div', { class: 'grid g4' });
    tiles.append(
      tile(T('fm.tFields'), U.fmtInt(fm.counts.fields), fm.fileName, { small: true }),
      tile(T('fm.tComplex'), U.fmtInt(fm.counts.complex), T('fm.tComplexFoot'), { small: true, severity: fm.counts.complex ? 'medium' : 'good' }),
      tile(T('fm.tUpdate'), U.fmtInt(fm.counts.updateScoped), T('fm.tUpdateFoot'), { small: true }),
      tile(T('fm.tUnique'), U.fmtInt(fm.counts.unique), fm.uniqueFieldNames.join(', ') || '—', { small: true })
    );
    wrap.appendChild(tiles);

    wrap.appendChild(el('div', { style: 'margin-top:14px' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('fm.cField') },
        { key: 'type', label: T('fm.cType'), render: f => el('span', { class: 'note', text: f.type }) },
        ...ACTIONS.map(a => ({ key: 'a' + a, label: T('fm.a.' + a), sortable: false,
          render: f => modeChip(HR.fieldmap.actionFor(f, a)) })),
        { key: 'flags', label: '', sortable: false, render: f => el('span', { class: 'row', style: 'gap:4px' }, [
          f.unique ? el('span', { class: 'pill warn', text: T('fm.unique') }) : null,
          f.standard ? el('span', { class: 'pill ok', text: T('fm.standard') }) : null
        ].filter(Boolean)) }
      ],
      rows: fm.fields, pageSize: 30, exportName: 'field-mapping',
      search: (f, q) => (f.name + ' ' + f.description).toLowerCase().includes(q),
      onRowClick: f => drawerField(fm, f)
    }))));
    return wrap;
  }

  /* ---------------------------------------------------------- simulation tab */

  function drawerSimField(pf, sim) {
    const affected = sim.rows.filter(r => {
      const v = r.values[pf.name];
      return v && (v.changed || v.error);
    }).map(r => ({
      name: r.user.displayName || r.user.userName,
      userName: r.user.userName,
      current: r.values[pf.name].error ? '—' : fmtVal(r.values[pf.name].current),
      desired: r.values[pf.name].error ? T('fm.errorPrefix') + ' ' + r.values[pf.name].error
        : fmtVal(r.values[pf.name].desired)
    }));
    openDrawer(el('div', {}, [
      el('h2', { text: pf.name }),
      el('p', { class: 'note', text: T('fm.simFieldNote', { n: affected.length }) })
    ]), el('div', { class: 'stack' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('c.person') },
        { key: 'userName', label: T('c.account') },
        { key: 'current', label: T('fm.cCurrent'), render: r => el('span', { class: 'mono trunc', title: r.current, text: r.current }) },
        { key: 'desired', label: T('fm.cDesired'), render: r => el('span', { class: 'mono trunc', title: r.desired, text: r.desired }) }
      ],
      rows: affected, pageSize: 20, exportName: 'simulation-' + pf.name,
      search: (r, q) => (r.name + ' ' + r.userName + ' ' + r.current + ' ' + r.desired).toLowerCase().includes(q)
    }))));
  }

  function drawerSimPerson(row, sim) {
    const fields = Object.keys(row.values).map(name => {
      const v = row.values[name];
      return { name,
        current: v.error ? '—' : (v.known ? fmtVal(v.current) : T('fm.noCounterpartShort')),
        desired: v.error ? T('fm.errorPrefix') + ' ' + v.error : fmtVal(v.desired),
        changed: !!v.changed, error: !!v.error };
    });
    openDrawer(el('div', {}, [
      el('h2', { text: row.user.displayName || row.user.userName }),
      el('p', { class: 'note', text: row.user.userName + (row.user.upn ? ' · ' + row.user.upn : '') })
    ]), el('div', { class: 'stack' }, card(null, null, HR.table.make({
      columns: [
        { key: 'name', label: T('fm.cField') },
        { key: 'current', label: T('fm.cCurrent'), render: r => el('span', { class: 'mono trunc', title: r.current, text: r.current }) },
        { key: 'desired', label: T('fm.cDesired'), render: r => el('span', { class: 'mono trunc', title: r.desired, text: r.desired }) },
        { key: 'changed', label: T('fm.cChanged'), value: r => r.changed ? 1 : 0,
          render: r => r.error ? el('span', { class: 'pill removed', text: T('fm.errorPrefix') })
            : r.changed ? el('span', { class: 'pill warn', text: T('fm.changed') })
            : el('span', { class: 'note', text: '=' }) }
      ],
      rows: fields, pageSize: 30, exportName: 'simulation-' + row.user.userName,
      initialSort: { key: 'changed', dir: -1 },
      search: (r, q) => (r.name + ' ' + r.current + ' ' + r.desired).toLowerCase().includes(q)
    }))));
  }

  function simulationTab(fm) {
    const st = HR.app.state;
    const wrap = el('div', {});
    if (!st.directory) {
      wrap.appendChild(el('p', { class: 'note', text: T('fm.needsDirectory') }));
      return wrap;
    }

    const stamp = [st.importedAt.fieldMapping, st.importedAt.directory, st.importedAt.vault].join('|');
    const results = el('div', { style: 'margin-top:14px' });

    const draw = sim => {
      results.innerHTML = '';
      if (sim.unavailable) {
        results.appendChild(el('p', { class: 'note', text: T('fm.simUnavailable') }));
        return;
      }
      if (sim.reconstructed) {
        results.appendChild(el('p', { class: 'note', style: 'margin-bottom:10px', text: T('fm.reconstructedNote') }));
      }
      const tiles = el('div', { class: 'grid g4' });
      tiles.append(
        tile(T('fm.tJoined'), U.fmtInt(sim.joined), T('fm.tJoinedFoot', { n: sim.total }), { small: true, severity: sim.joined ? 'good' : 'high' }),
        tile(T('fm.tScope'), U.fmtInt(sim.stats.fieldsInScope), T('fm.tScopeFoot', { action: sim.action }), { small: true }),
        tile(T('fm.tChanges'), U.fmtInt(sim.stats.changes), T('fm.tChangesFoot', { n: sim.stats.peopleChanged }), { small: true, severity: sim.stats.changes ? 'medium' : 'good' }),
        tile(T('fm.tErrors'), U.fmtInt(sim.stats.errors), T('fm.tErrorsFoot'), { small: true, severity: sim.stats.errors ? 'critical' : 'good' })
      );
      results.appendChild(tiles);

      results.appendChild(el('div', { style: 'margin-top:14px' }, card(T('fm.perFieldTitle'), T('fm.perFieldNote'), HR.table.make({
        columns: [
          { key: 'name', label: T('fm.cField') },
          { key: 'mode', label: T('fm.cMode'), render: f => el('span', { class: 'note', text: f.mode.toLowerCase() }) },
          { key: 'changed', label: T('fm.cWouldChange'), num: true,
            render: f => f.changed ? el('span', { class: 'pill warn', text: U.fmtInt(f.changed) }) : el('span', { class: 'note', text: '0' }) },
          { key: 'errors', label: T('fm.cErrors'), num: true,
            render: f => f.errors ? el('span', { class: 'pill removed', text: U.fmtInt(f.errors) }) : el('span', { class: 'note', text: '0' }) },
          { key: 'cnt', label: T('fm.cCounterpart'), sortable: false,
            render: f => f.noCounterpart ? el('span', { class: 'note', text: T('fm.noCounterpartShort') }) : el('span', { class: 'note', text: '✓' }) }
        ],
        rows: sim.perField, pageSize: 30, exportName: 'simulation-fields',
        onRowClick: f => drawerSimField(f, sim)
      }))));

      const changedRows = sim.rows.filter(r => r.anyChange);
      results.appendChild(el('div', { style: 'margin-top:14px' }, card(T('fm.perPersonTitle'),
        T('fm.perPersonNote', { n: changedRows.length }), HR.table.make({
          columns: [
            { key: 'name', label: T('c.person'), value: r => r.user.displayName || r.user.userName },
            { key: 'userName', label: T('c.account'), value: r => r.user.userName },
            { key: 'n', label: T('fm.cWouldChange'), num: true,
              value: r => Object.values(r.values).filter(v => v.changed).length },
            { key: 'what', label: T('fm.cFields'), sortable: false,
              render: r => el('span', { class: 'trunc note',
                text: Object.keys(r.values).filter(k => r.values[k].changed).join(', ') }) }
          ],
          rows: changedRows, pageSize: 20, exportName: 'simulation-people',
          initialSort: { key: 'n', dir: -1 },
          search: (r, q) => ((r.user.displayName || '') + ' ' + r.user.userName).toLowerCase().includes(q),
          onRowClick: r => drawerSimPerson(r, sim)
        }))));
    };

    const run = () => {
      SIM = HR.fieldmap.simulate(fm, st, { action: sel.value });
      SIM_STAMP = stamp + '|' + sel.value;
      draw(SIM);
    };

    const sel = el('select', {}, ACTIONS.map(a =>
      el('option', { value: a, text: a, selected: a === 'Update' })));
    const btn = el('button', { class: 'btn primary', text: T('fm.run'), onclick: run });
    wrap.appendChild(card(T('fm.simTitle'), T('fm.simNote'), el('div', { class: 'row' }, [
      el('label', { class: 'inline' }, [document.createTextNode(T('fm.action')), sel]),
      btn,
      el('span', { class: 'note', text: T('fm.iterationNote') })
    ])));
    wrap.appendChild(results);

    if (SIM && SIM_STAMP.startsWith(stamp)) draw(SIM);
    return wrap;
  }

  /* -------------------------------------------------------------------- view */

  function fieldmapView(m, params) {
    const f = document.createDocumentFragment();
    const fm = HR.app.state.fieldMapping;
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('fm.title') }),
      el('p', { text: T('fm.lead') })
    ])));

    if (!fm) {
      f.appendChild(el('div', { class: 'grid' }, card(T('fm.emptyTitle'), null, el('div', { class: 'stack' }, [
        el('p', { text: T('fm.emptyBody') }),
        el('div', { class: 'row' }, el('button', { class: 'btn primary', text: T('fm.emptyImport'), onclick: () => {
          const inp = el('input', { type: 'file', accept: '.json' });
          inp.onchange = () => { if (inp.files[0]) HR.app.importFileAs(inp.files[0]); };
          inp.click();
        } }))
      ]))));
      return f;
    }

    f.appendChild(tabbed('fieldmap', [
      { id: 'mapping', label: T('fm.tab.mapping'), count: fm.counts.fields, build: () => mappingTab(fm) },
      { id: 'simulation', label: T('fm.tab.simulation'), build: () => simulationTab(fm) }
    ], params));
    return f;
  }

  HR.views.fieldmap = fieldmapView;
})(window.HR);
