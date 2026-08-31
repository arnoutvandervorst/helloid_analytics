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
  const { card, tile, tabbed, openDrawer, scoreBar, dl } = HR.viewkit;

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
    if (fm.legacy) {
      wrap.appendChild(el('p', { class: 'note', style: 'margin-top:10px', text: T('fm.legacyNote') }));
    }
    const gap = gapCard(fm);
    if (gap) { gap.style.marginTop = '14px'; wrap.appendChild(gap); }

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

  /* The collection gap, made loud: which mapped attributes the loaded
     directory cannot answer for — and the re-collect that closes the hole. */
  function gapCard(fm) {
    const dir = HR.app.state.directory;
    if (!dir) return null;
    const cov = HR.fieldmap.coverage(fm, dir);
    if (!cov.gaps.length) return null;
    const script = dir.source === 'entra' ? 'collect-entra.ps1' : 'collect-ad.ps1';
    const body = el('div', { class: 'stack' });
    body.appendChild(el('ul', { class: 'clean' }, cov.gaps.map(g => {
      const li = el('li', { class: 'row' });
      li.append(
        el('strong', { class: 'mono', text: g.attr }),
        el('span', { class: 'note trunc', text: g.fields.join(', ') }),
        el('span', { style: 'flex:1' }),
        g.fixable
          ? el('span', { class: 'pill warn', text: T('fm.gapFixable') })
          : el('span', { class: 'pill muted', text: T('fm.gapNotInSource', { source: dir.system }) })
      );
      return li;
    })));
    if (cov.fixableCount) {
      const pre = el('pre', { class: 'mono' });
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:12px;margin:6px 0';
      pre.textContent = '.\\' + script +
        (cov.extras.length ? ' -ExtraAttributes ' + cov.extras.join(',') : '');
      body.appendChild(el('p', { class: 'note', text: T('fm.gapRecollect') }));
      body.appendChild(pre);
      body.appendChild(el('div', { class: 'row' },
        el('button', { class: 'btn sm primary', text: T('fm.gapDownload', { script }),
          onclick: async () => {
            try {
              const res = await fetch(script);
              if (!res.ok || (res.headers.get('content-type') || '').includes('html')) throw new Error('not served');
              const text = await res.text();
              let out = text;
              if (cov.extras.length) {
                const stock = '[string[]]$ExtraAttributes = @()';
                if (!text.includes(stock)) throw new Error('unexpected script');
                out = text.replace(stock,
                  '[string[]]$ExtraAttributes = @(' + cov.extras.map(a => "'" + a.replace(/'/g, '') + "'").join(',') + ')');
              }
              HR.usage.exported('collector-mapping-script');
              U.download(script.replace('.ps1', '-mapping.ps1'), out, 'text/plain;charset=utf-8');
            } catch (e) { U.toast(T('fm.gapFetchFail'), 6000); }
          } })));
    }
    return card(T('fm.gapTitle', { n: cov.gaps.length }), T('fm.gapNote'), body);
  }

  function simulationTab(fm) {
    const st = HR.app.state;
    const wrap = el('div', {});
    if (!st.directory) {
      wrap.appendChild(el('p', { class: 'note', text: T('fm.needsDirectory') }));
      return wrap;
    }
    const gap = gapCard(fm);
    if (gap) wrap.appendChild(gap);

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

  /* ------------------------------------------------------- target attributes */

  /** One target attribute: its values, and which mapping fields write it. */
  function drawerAttribute(a, fm) {
    const body = el('div', { class: 'stack' });
    body.appendChild(dl([
      [T('fm.cFill'), U.fmtPct(a.fillPct, 0) + ' (' + U.fmtInt(a.fill) + ')'],
      [T('fm.cDistinct'), U.fmtInt(a.distinct)]
    ]));

    body.appendChild(card(T('fm.dValues'), T('fm.dValuesNote'), HR.table.make({
      columns: [
        { key: 'value', label: T('fm.cValue'), value: r => r.value,
          render: r => el('span', { class: 'mono trunc', title: r.value, text: r.value }) },
        { key: 'n', label: T('ov.accounts'), num: true, value: r => r.n },
        { key: 'share', label: T('fm.cShare'), num: true, value: r => r.n / (a.fill || 1),
          render: r => el('span', { text: U.fmtPct(r.n / (a.fill || 1), 0) }) }
      ],
      rows: a.top, pageSize: 20, exportName: 'attribute-values'
    })));

    if (a.mapped) {
      body.appendChild(card(T('fm.dWrittenBy'), T('fm.dWrittenByNote'), el('ul', { class: 'clean' },
        a.mappedBy.map(name => {
          const pf = SIM && (SIM.perField || []).find(x => x.name === name);
          return el('li', {}, pf
            ? el('a', { href: '#', class: 'mono', text: name,
                onclick: e => { e.preventDefault(); drawerSimField(pf, SIM); } })
            : el('span', { class: 'mono', text: name }));
        }))));
      if (a.fill) {
        body.appendChild(el('div', { class: 'slot-actions' },
          el('button', { class: 'btn', text: T('fm.dOpenSim'),
            onclick: () => HR.app.go('fieldmap', { tab: 'simulation' }) })));
      }
    } else if (fm && !a.system) {
      body.appendChild(el('p', { class: 'note', text: T('fm.dNotWritten') }));
    }

    openDrawer(el('div', {}, [
      el('div', { class: 'mono', text: a.name }),
      el('span', { class: 'note', text: T('fm.dHeadNote', {
        fill: U.fmtPct(a.fillPct, 0), distinct: U.fmtInt(a.distinct) }) })
    ]), body);
  }

  function attributesTab(fm) {
    const st = HR.app.state;
    const wrap = el('div', {});
    if (!st.directory) {
      wrap.appendChild(el('p', { class: 'note', text: T('fm.attrNeedsDirectory') }));
      return wrap;
    }
    const prof = HR.fieldmap.attributeProfile(st.directory, fm);
    const s = prof.summary;

    const tiles = el('div', { class: 'grid g4', style: 'margin-bottom:14px' }, [
      tile(T('fm.kAttrs'), U.fmtInt(s.attrs), T('fm.kAttrsFoot', { n: U.fmtInt(s.users) }), { small: true }),
      fm ? tile(T('fm.kUnmapped'), U.fmtInt(s.filledUnmapped), T('fm.kUnmappedFoot'),
        { small: true, severity: s.filledUnmapped ? 'high' : 'good' }) : null,
      fm ? tile(T('fm.kMappedEmpty'), U.fmtInt(s.mappedEmpty), T('fm.kMappedEmptyFoot'),
        { small: true, severity: s.mappedEmpty ? 'medium' : 'good' }) : null
    ]);
    wrap.appendChild(tiles);

    if (fm && prof.filledUnmapped.length) {
      wrap.appendChild(card(T('fm.unmappedTitle'), T('fm.unmappedNote'), el('ul', { class: 'clean' },
        prof.filledUnmapped.map(a => el('li', {}, [
          el('span', { class: 'mono', text: a.name }),
          el('span', { class: 'note', text: ' · ' + T('fm.unmappedLine', {
            fill: U.fmtPct(a.fillPct, 0), distinct: U.fmtInt(a.distinct) }) })
        ])))));
    }
    if (fm && prof.mappedEmpty.length) {
      wrap.appendChild(card(T('fm.mappedEmptyTitle'), T('fm.mappedEmptyNote'), el('ul', { class: 'clean' },
        prof.mappedEmpty.map(x => el('li', {}, [
          el('span', { class: 'mono', text: x.attr }),
          el('span', { class: 'note', text: ' · ' + x.fields.join(', ') })
        ])))));
    }

    wrap.appendChild(card(T('fm.attrTitle'), T('fm.attrNote'), HR.table.make({
      columns: [
        { key: 'name', label: T('fm.cAttr'), value: a => a.name,
          render: a => el('span', { class: 'mono', text: a.name }) },
        { key: 'fill', label: T('fm.cFill'), num: true, value: a => a.fillPct,
          render: a => scoreBar(Math.round(a.fillPct * 100)) },
        { key: 'distinct', label: T('fm.cDistinct'), num: true, value: a => a.distinct },
        { key: 'top', label: T('fm.cTop'), sortable: false,
          render: a => {
            const text = a.top.slice(0, 4).map(v => v.value).join(', ');
            return el('span', { class: 'trunc note', title: text, text });
          } },
        fm ? { key: 'status', label: T('fm.cStatus'),
          value: a => a.system ? 'system' : a.mapped ? 'mapped' : 'unmapped',
          render: a => a.system
            ? el('span', { class: 'pill muted', text: T('fm.stSystem') })
            : a.mapped
              ? el('span', { class: 'pill ok', text: T('fm.stMapped') })
              : a.fillPct >= 0.5
                ? el('span', { class: 'pill warn', text: T('fm.stUnmapped') })
                : el('span', { class: 'note', text: T('fm.stUnmapped') }) } : null
      ].filter(Boolean),
      rows: prof.attrs, pageSize: 25, exportName: 'target-attributes',
      initialSort: { key: 'fill', dir: -1 },
      search: (a, q) => (a.name + ' ' + a.top.map(v => v.value).join(' ')).toLowerCase().includes(q),
      onRowClick: a => drawerAttribute(a, fm)
    })));
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

    const importCard = () => card(T('fm.emptyTitle'), null, el('div', { class: 'stack' }, [
      el('p', { text: T('fm.emptyBody') }),
      el('div', { class: 'row' }, el('button', { class: 'btn primary', text: T('fm.emptyImport'), onclick: () => {
        const inp = el('input', { type: 'file', accept: '.json' });
        inp.onchange = () => { if (inp.files[0]) HR.app.importFileAs(inp.files[0]); };
        inp.click();
      } }))
    ]));

    /* Without a mapping, the target-attribute profile still works from the
       directory alone — the mapping and simulation tabs then hold the import
       invitation instead of disappearing. */
    if (!fm && !HR.app.state.directory) {
      f.appendChild(el('div', { class: 'grid' }, importCard()));
      return f;
    }

    f.appendChild(tabbed('fieldmap', [
      { id: 'mapping', label: T('fm.tab.mapping'), count: fm ? fm.counts.fields : undefined,
        build: () => fm ? mappingTab(fm) : el('div', { class: 'grid' }, importCard()) },
      { id: 'attributes', label: T('fm.tab.attributes'), build: () => attributesTab(fm) },
      fm ? { id: 'simulation', label: T('fm.tab.simulation'), build: () => simulationTab(fm) } : null
    ].filter(Boolean), params));
    return f;
  }

  HR.views.fieldmap = fieldmapView;
})(window.HR);
