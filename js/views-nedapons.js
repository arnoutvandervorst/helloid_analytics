/* The Nedap ONS workbench: the matrix workbook as editable data instead of
   Excel gymnastics. Import the customer's "NEDAP - Matrices functies
   deskundigheden" workbook (or start blank), edit the scope mappings, the
   Medewerkers-koppeling rows and the Autorisatierollen matrix with the vault
   watching over the names, and export the connector CSVs deterministically.

   Nedap provisioning is full-set, not add/revoke: the connector PUTs the
   complete desired state per source. That makes this book — vault + these
   rules — the authoritative definition of what Nedap should hold; there is no
   reconciliation to fall back on, so the health checks here are the only
   warning anyone gets. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tabbed, openDrawer, closeDrawer } = HR.viewkit;
  const N = HR.nedapons;

  const book = () => HR.config.getNedapBook();
  const effVault = () => {
    const st = HR.app.state;
    return st.vault || (st.directory && st.directory.vault) || null;
  };
  const saveAnd = tab => {
    HR.config.setNedapBook();
    closeDrawer();
    HR.app.rebuildBusy().then(() => HR.app.go('nedap', { tab }));
  };

  /* ------------------------------------------------------------ small pieces */

  function input(value, opts) {
    opts = opts || {};
    const i = el('input', { type: opts.type || 'text', value: value === undefined ? '' : value });
    if (opts.list) i.setAttribute('list', opts.list);
    if (opts.placeholder) i.setAttribute('placeholder', opts.placeholder);
    return i;
  }

  function datalist(id, values) {
    const d = el('datalist', { id });
    U.uniq(values.filter(Boolean)).sort().forEach(v => d.appendChild(el('option', { value: v })));
    return d;
  }

  function field(label, control) {
    const w = el('label', { class: 'inline' });
    control.style.flex = '1';
    w.append(document.createTextNode(label), control);
    return w;
  }

  /* A list of names as removable chips plus a picker to add more. */
  function chipsEditor(names, suggestions, listId) {
    const wrap = el('div', { class: 'stack', style: 'gap:6px' });
    const chips = el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' });
    const draw = () => {
      chips.innerHTML = '';
      names.forEach((n, i) => chips.appendChild(el('span', { class: 'pill' }, [
        el('span', { text: n }),
        el('button', { class: 'btn sm ghost', text: '×', title: T('no.remove'),
          onclick: () => { names.splice(i, 1); draw(); } })
      ])));
      if (!names.length) chips.appendChild(el('span', { class: 'note', text: T('no.none') }));
    };
    const pick = input('', { list: listId, placeholder: T('no.addName') });
    const add = () => {
      const v = pick.value.trim();
      if (v && !names.includes(v)) { names.push(v); draw(); }
      pick.value = '';
    };
    pick.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    wrap.append(chips, el('div', { class: 'row' }, [
      pick, el('button', { class: 'btn ghost', text: T('no.add'), onclick: add }),
      datalist(listId, suggestions)
    ]));
    draw();
    return wrap;
  }

  function checkbox(label, checked) {
    const c = el('input', { type: 'checkbox' });
    c.checked = !!checked;
    return { control: el('label', { class: 'row', style: 'gap:6px;align-items:center' }, [c, el('span', { text: label })]), box: c };
  }

  function issueIndex(issues) {
    const map = new Map();
    issues.forEach(i => {
      const k = i.area + ':' + i.row;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }

  /* Vault-fed suggestion pools: the connection the Excel never had. */
  function pools(b) {
    const v = effVault();
    const deptNames = b.lookups.departments.map(d => d.name);
    const titleNames = b.lookups.titles.map(t => t.name);
    if (v) v.persons.forEach(p => (p.contracts || []).forEach(c => {
      if (c.department && c.department.name) deptNames.push(c.department.name);
      if (c.title && c.title.name) titleNames.push(c.title.name);
    }));
    return { deptNames, titleNames };
  }

  /* --------------------------------------------------------- scope mappings */

  function scopeDrawer(area, tab, m, isNew) {
    const b = book();
    const list = area === 'teams' ? b.teamMappings : b.locationMappings;
    const nameKey = area === 'teams' ? 'teamNames' : 'locationNames';
    const targets = (area === 'teams' ? b.lookups.teams : b.lookups.locations).map(t => t.name);
    const p = pools(b);
    const names = (m[nameKey] || []).slice();

    const dept = input(m.dept, { list: 'no-deps', placeholder: T('no.deptPh') });
    const title = input(m.title, { list: 'no-titles', placeholder: T('no.titlePh') });
    const all = checkbox(T(area === 'teams' ? 'no.allEmployees' : 'no.allClients'), m.all);

    const body = el('div', { class: 'stack' }, [
      datalist('no-deps', p.deptNames), datalist('no-titles', p.titleNames),
      field(T('no.dept'), dept), field(T('no.func'), title),
      all.control,
      field(T(area === 'teams' ? 'no.teams' : 'no.locations'), chipsEditor(names, targets, 'no-targets')),
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn primary', text: T('no.save'), onclick: () => {
          if (!dept.value.trim()) { U.toast(T('no.deptRequired'), 4000); return; }
          m.dept = dept.value.trim(); m.title = title.value.trim();
          m.all = all.box.checked; m[nameKey] = names;
          if (isNew) list.push(m);
          saveAnd(tab);
        } }),
        el('span', { style: 'flex:1' }),
        isNew ? '' : el('button', { class: 'btn danger', text: T('no.delete'), onclick: () => {
          list.splice(list.indexOf(m), 1);
          saveAnd(tab);
        } })
      ])
    ]);
    openDrawer(el('div', {}, [
      el('h2', { text: T(isNew ? 'no.addRow' : 'no.editRow') }),
      el('p', { class: 'note', text: T(area === 'teams' ? 'no.tab.teams' : 'no.tab.locations') })
    ]), body);
  }

  function scopeTab(area, tab, issues) {
    const b = book();
    const list = area === 'teams' ? b.teamMappings : b.locationMappings;
    const nameKey = area === 'teams' ? 'teamNames' : 'locationNames';
    const idx = issueIndex(issues);
    const rows = list.map((m, i) => ({ m, i, issues: idx.get(area + ':' + i) || 0 }));

    const table = HR.table.make({
      columns: [
        { key: 'dept', label: T('no.dept'), render: r => r.m.dept },
        { key: 'title', label: T('no.func'), render: r => r.m.title || el('span', { class: 'note', text: T('no.allTitles') }) },
        { key: 'scope', label: T(area === 'teams' ? 'no.teams' : 'no.locations'),
          render: r => r.m.all
            ? el('span', { class: 'pill', text: T(area === 'teams' ? 'no.allEmployees' : 'no.allClients') })
            : el('span', { class: 'trunc', text: r.m[nameKey].join(', ') || '—' }) },
        { key: 'issues', label: T('no.issues'), num: true,
          render: r => r.issues ? el('span', { class: 'pill warn', text: String(r.issues) }) : '' }
      ],
      rows, pageSize: 25, exportName: 'nedap-' + area,
      search: (r, q) => (r.m.dept + ' ' + r.m.title + ' ' + r.m[nameKey].join(' ')).toLowerCase().includes(q),
      onRowClick: r => scopeDrawer(area, tab, r.m, false)
    });

    return el('div', { class: 'grid' }, card(
      T(area === 'teams' ? 'no.teamsTitle' : 'no.locationsTitle'),
      T(area === 'teams' ? 'no.teamsNote' : 'no.locationsNote'),
      [el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('span', { style: 'flex:1' }),
        el('button', { class: 'btn primary', text: T('no.addRow'),
          onclick: () => scopeDrawer(area, tab, { dept: '', title: '', all: false, [nameKey]: [] }, true) })
      ]), table]
    ));
  }

  /* ------------------------------------------------------------- medewerkers */

  const EMP_FIELDS = [
    ['titleId', 'no.empTitleId'], ['titleName', 'no.empTitleName'],
    ['deptId', 'no.empDeptId'], ['deptName', 'no.empDeptName'],
    ['educationId', 'no.empEducationId'], ['expertiseName', 'no.empExpertise'],
    ['registrationProfile', 'no.empRegistration'], ['weeksheetName', 'no.empWeeksheet'],
    ['clusterId', 'no.empClusterId'], ['teamName', 'no.empTeam'], ['clusterName', 'no.empClusterName']
  ];

  function employeeDrawer(tab, e, isNew) {
    const b = book();
    const controls = {};
    const lists = {
      titleName: b.lookups.titles.map(t => t.name), titleId: b.lookups.titles.map(t => t.id),
      deptName: b.lookups.departments.map(d => d.name), deptId: b.lookups.departments.map(d => d.id),
      educationId: b.lookups.expertiseProfiles.map(x => x.code),
      expertiseName: b.lookups.expertiseProfiles.map(x => x.name),
      weeksheetName: b.lookups.weeksheetProfiles.map(x => x.name),
      registrationProfile: book().employees.map(x => x.registrationProfile),
      teamName: b.lookups.teams.map(x => x.name),
      clusterId: b.lookups.teams.map(x => x.id),
      clusterName: b.lookups.teams.map(x => x.name)
    };
    const body = el('div', { class: 'stack' });
    EMP_FIELDS.forEach(([key, labelKey]) => {
      const listId = lists[key] ? 'no-emp-' + key : null;
      controls[key] = input(e[key], listId ? { list: listId } : {});
      if (listId) body.appendChild(datalist(listId, lists[key]));
      body.appendChild(field(T(labelKey), controls[key]));
    });
    /* Picking a known title/department name fills its id, and the other way
       round — the lookup does the typing the Excel formulas used to do. */
    const wire = (nameKey, idKey, lookup) => {
      controls[nameKey].onchange = () => {
        const hit = lookup.find(x => x.name.toLowerCase() === controls[nameKey].value.trim().toLowerCase());
        if (hit && !controls[idKey].value.trim()) controls[idKey].value = hit.id;
      };
      controls[idKey].onchange = () => {
        const hit = lookup.find(x => String(x.id) === controls[idKey].value.trim());
        if (hit && !controls[nameKey].value.trim()) controls[nameKey].value = hit.name;
      };
    };
    wire('titleName', 'titleId', b.lookups.titles);
    wire('deptName', 'deptId', b.lookups.departments);
    controls.teamName.onchange = () => {
      const hit = b.lookups.teams.find(x => x.name.toLowerCase() === controls.teamName.value.trim().toLowerCase());
      if (hit) {
        if (!controls.clusterId.value.trim()) controls.clusterId.value = hit.id;
        if (!controls.clusterName.value.trim()) controls.clusterName.value = hit.name;
      }
    };
    body.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', { class: 'btn primary', text: T('no.save'), onclick: () => {
        if (!controls.titleId.value.trim()) { U.toast(T('no.titleIdRequired'), 4000); return; }
        EMP_FIELDS.forEach(([key]) => { e[key] = controls[key].value.trim(); });
        if (isNew) book().employees.push(e);
        saveAnd(tab);
      } }),
      el('span', { style: 'flex:1' }),
      isNew ? '' : el('button', { class: 'btn danger', text: T('no.delete'), onclick: () => {
        const list = book().employees;
        list.splice(list.indexOf(e), 1);
        saveAnd(tab);
      } })
    ]));
    openDrawer(el('div', {}, [
      el('h2', { text: T(isNew ? 'no.addRow' : 'no.editRow') }),
      el('p', { class: 'note', text: T('no.tab.medewerkers') })
    ]), body);
  }

  function employeesTab(tab, issues) {
    const idx = issueIndex(issues);
    const rows = book().employees.map((e, i) => ({ e, i, issues: idx.get('employees:' + i) || 0 }));
    const table = HR.table.make({
      columns: [
        { key: 'title', label: T('no.func'), render: r => (r.e.titleName || r.e.titleId) },
        { key: 'dept', label: T('no.dept'), render: r => (r.e.deptName || r.e.deptId) },
        { key: 'expertise', label: T('no.empExpertise'), render: r => r.e.expertiseName || r.e.educationId },
        { key: 'weeksheet', label: T('no.empWeeksheet'), render: r => r.e.weeksheetName },
        { key: 'team', label: T('no.empTeam'), render: r => r.e.teamName || r.e.clusterId },
        { key: 'issues', label: T('no.issues'), num: true,
          render: r => r.issues ? el('span', { class: 'pill warn', text: String(r.issues) }) : '' }
      ],
      rows, pageSize: 25, exportName: 'nedap-medewerkers',
      search: (r, q) => Object.keys(r.e).map(k => r.e[k]).join(' ').toLowerCase().includes(q),
      onRowClick: r => employeeDrawer(tab, r.e, false)
    });
    return el('div', { class: 'grid' }, card(T('no.medewerkersTitle'), T('no.medewerkersNote'), [
      el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('span', { style: 'flex:1' }),
        el('button', { class: 'btn primary', text: T('no.addRow'), onclick: () => {
          const e = {};
          EMP_FIELDS.forEach(([key]) => { e[key] = ''; });
          employeeDrawer(tab, e, true);
        } })
      ]), table]));
  }

  /* ------------------------------------------------------------------ rollen */

  function roleDrawer(tab, r, isNew) {
    const b = book();
    const functies = (r.functies || []).slice();
    const name = input(r.name, { placeholder: T('no.roleNamePh') });
    const flags = [
      ['standaardBereik', 'no.roleStandaard'], ['rolBereik', 'no.roleRolBereik'],
      ['mijnRooster', 'no.roleRooster'], ['mijnPlanning', 'no.rolePlanning']
    ].map(([key, labelKey]) => ({ key, cb: checkbox(T(labelKey), r[key]) }));
    const notes = input(r.notes, {});

    const body = el('div', { class: 'stack' }, [
      field(T('no.roleName'), name),
      ...flags.map(f => f.cb.control),
      field(T('no.notes'), notes),
      field(T('no.roleFuncties'), chipsEditor(functies, b.lookups.titles.map(t => t.name), 'no-functies')),
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn primary', text: T('no.save'), onclick: () => {
          if (!name.value.trim()) { U.toast(T('no.roleNameRequired'), 4000); return; }
          r.name = name.value.trim(); r.notes = notes.value.trim(); r.functies = functies;
          flags.forEach(f => { r[f.key] = f.cb.box.checked; });
          if (isNew) b.roles.push(r);
          saveAnd(tab);
        } }),
        el('span', { style: 'flex:1' }),
        isNew ? '' : el('button', { class: 'btn danger', text: T('no.delete'), onclick: () => {
          b.roles.splice(b.roles.indexOf(r), 1);
          saveAnd(tab);
        } })
      ])
    ]);
    openDrawer(el('div', {}, [
      el('h2', { text: T(isNew ? 'no.addRow' : 'no.editRow') }),
      el('p', { class: 'note', text: T('no.tab.rollen') })
    ]), body);
  }

  function rolesTab(tab, issues) {
    const idx = issueIndex(issues);
    const flagText = r => [
      r.standaardBereik && T('no.roleStandaard'), r.rolBereik && T('no.roleRolBereik'),
      r.mijnRooster && T('no.roleRooster'), r.mijnPlanning && T('no.rolePlanning')
    ].filter(Boolean).join(', ') || '—';
    const rows = book().roles.map((r, i) => ({ r, i, issues: idx.get('roles:' + i) || 0 }));
    const table = HR.table.make({
      columns: [
        { key: 'name', label: T('no.roleName'), render: x => x.r.name },
        { key: 'flags', label: T('no.roleScopeFlags'), render: x => el('span', { class: 'trunc', text: flagText(x.r) }) },
        { key: 'functies', label: T('no.roleFuncties'), render: x => el('span', { class: 'trunc', text: x.r.functies.join(', ') || '—' }) },
        { key: 'issues', label: T('no.issues'), num: true,
          render: x => x.issues ? el('span', { class: 'pill warn', text: String(x.issues) }) : '' }
      ],
      rows, pageSize: 25, exportName: 'nedap-rollen',
      search: (x, q) => (x.r.name + ' ' + x.r.functies.join(' ')).toLowerCase().includes(q),
      onRowClick: x => roleDrawer(tab, x.r, false)
    });
    return el('div', { class: 'grid' }, card(T('no.rollenTitle'), T('no.rollenNote'), [
      el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('span', { style: 'flex:1' }),
        el('button', { class: 'btn primary', text: T('no.addRow'), onclick: () => roleDrawer(tab,
          { name: '', standaardBereik: false, rolBereik: false, mijnRooster: false, mijnPlanning: false, notes: '', functies: [] }, true) })
      ]), table]));
  }

  /* ------------------------------------------------------------------ health */

  function healthTab(issues) {
    const b = book();
    const f = document.createDocumentFragment();
    const v = effVault();

    const issueRows = issues.map(i => ({
      area: T('no.area.' + i.area), label: (i.dept || '—') + ' / ' + (i.title || T('no.allTitles')),
      severity: i.severity, message: T(i.msgKey, i.msgArgs), _i: i
    }));
    f.appendChild(el('div', { class: 'grid' }, card(T('no.healthTitle'), T('no.healthNote'), issueRows.length
      ? HR.table.make({
        columns: [
          { key: 'area', label: T('no.areaCol') },
          { key: 'label', label: T('no.rowCol') },
          { key: 'severity', label: T('c.sev'), render: r =>
            el('span', { class: 'pill ' + (r.severity === 'warning' ? 'warn' : ''), text: T('no.sev.' + r.severity) }) },
          { key: 'message', label: T('no.messageCol'), render: r => el('span', { class: 'trunc', text: r.message }) }
        ],
        rows: issueRows, pageSize: 25, exportName: 'nedap-issues',
        search: (r, q) => (r.area + ' ' + r.label + ' ' + r.message).toLowerCase().includes(q)
      })
      : el('p', { class: 'note', text: T('no.healthClean') }))));

    const cov = N.coverage(b, v);
    const covBody = !v
      ? el('p', { class: 'note', text: T('no.coverageNoVault') })
      : (!b.teamMappings.length && !b.locationMappings.length)
        ? el('p', { class: 'note', text: T('no.coverageNoRows') })
        : cov.uncovered.length
          ? HR.table.make({
            columns: [
              { key: 'person', label: T('c.person'), render: r => r.person.displayName },
              { key: 'contracts', label: T('no.contractsCol'), render: r =>
                el('span', { class: 'trunc', text: r.contracts.map(c => (c.department || c.departmentId) + (c.title ? ' · ' + c.title : '')).join('; ') }) }
            ],
            rows: cov.uncovered, pageSize: 25, exportName: 'nedap-uncovered',
            search: (r, q) => r.person.displayName.toLowerCase().includes(q)
          })
          : el('p', { class: 'note', text: T('no.coverageAll', { n: cov.total }) });
    f.appendChild(el('div', { class: 'grid', style: 'margin-top:14px' },
      card(T('no.coverageTitle'), v ? T('no.coverageNote', { n: cov.uncovered.length, total: cov.total }) : null, covBody)));
    return f;
  }

  /* --------------------------------------------------------------- simulator */

  function simulatorTab() {
    const b = book();
    const v = effVault();
    const out = el('div', { style: 'margin-top:12px' });
    const p = pools(b);

    const draw = contracts => {
      out.innerHTML = '';
      if (!contracts.length) return;
      const eff = N.effectiveFor(contracts, b);
      if (!eff.matched) {
        out.appendChild(el('p', { class: 'note', text: T('no.simNoMatch') }));
        return;
      }
      const src = s => s.dept + ' / ' + (s.title || T('no.allTitles'));
      const scopeCard = (titleKey, scope, allKey) => card(T(titleKey), null, el('div', { class: 'stack' }, [
        scope.all ? el('p', {}, el('span', { class: 'pill', text: T(allKey) })) : '',
        scope.names.length
          ? el('ul', {}, scope.names.map(n => el('li', { text: n.name })))
          : (scope.all ? '' : el('p', { class: 'note', text: T('no.none') })),
        scope.sources.length ? el('p', { class: 'note', text: T('no.simVia') + ' ' + scope.sources.map(src).join('; ') }) : ''
      ]));
      const g = el('div', { class: 'grid g2' });
      g.appendChild(scopeCard('no.teamsTitle', eff.teams, 'no.allEmployees'));
      g.appendChild(scopeCard('no.locationsTitle', eff.locations, 'no.allClients'));
      if (eff.employees.length) {
        g.appendChild(card(T('no.medewerkersTitle'), null, el('ul', {}, eff.employees.map(({ e }) =>
          el('li', { text: [e.expertiseName || e.educationId, e.weeksheetName, e.teamName].filter(Boolean).join(' · ') })))));
      }
      if (eff.roles.length) {
        g.appendChild(card(T('no.rollenTitle'), null, el('ul', {}, eff.roles.map(({ r }) => el('li', { text: r.name })))));
      }
      out.appendChild(g);
    };

    const controls = el('div', { class: 'stack' });
    if (v) {
      const pick = input('', { list: 'no-sim-person', placeholder: T('no.simPersonPh') });
      pick.onchange = () => {
        const person = v.persons.find(x => x.displayName === pick.value.trim());
        if (person) draw(N.personContracts(person));
      };
      controls.append(
        datalist('no-sim-person', v.persons.map(x => x.displayName)),
        field(T('no.simPerson'), pick)
      );
    } else {
      controls.appendChild(el('p', { class: 'note', text: T('no.simNoVault') }));
    }
    const dept = input('', { list: 'no-sim-dept', placeholder: T('no.deptPh') });
    const title = input('', { list: 'no-sim-title', placeholder: T('no.titlePh') });
    const run = () => draw([{ department: dept.value.trim(), departmentId: '', title: title.value.trim(), titleId: '' }]);
    controls.append(
      datalist('no-sim-dept', p.deptNames), datalist('no-sim-title', p.titleNames),
      el('div', { class: 'row' }, [dept, title, el('button', { class: 'btn ghost', text: T('no.simRun'), onclick: run })])
    );

    return el('div', { class: 'grid' }, card(T('no.simTitle'), T('no.simNote'), [controls, out]));
  }

  /* ------------------------------------------------------------------ export */

  function lookupCard(tab, key, titleKey, fields) {
    const b = book();
    const list = b.lookups[key];
    const edit = () => {
      const ta = el('textarea', { rows: 14 });
      ta.style.width = '100%';
      ta.value = list.map(item => fields.map(f => item[f] || '').join('\t')).join('\n');
      openDrawer(el('div', {}, [
        el('h2', { text: T(titleKey) }),
        el('p', { class: 'note', text: T('no.lookupEditNote', { cols: fields.join(' → ') }) })
      ]), el('div', { class: 'stack' }, [
        ta,
        el('div', { class: 'row' }, el('button', { class: 'btn primary', text: T('no.save'), onclick: () => {
          const next = ta.value.split('\n').map(line => line.split(/\t|;/)).filter(parts => parts[0] && parts[0].trim());
          b.lookups[key] = next.map(parts => {
            const item = {};
            fields.forEach((f, i) => { item[f] = (parts[i] || '').trim(); });
            return item;
          });
          saveAnd(tab);
        } }))
      ]));
    };
    return el('div', { class: 'row', style: 'align-items:center;gap:8px' }, [
      el('span', { style: 'flex:1', text: T(titleKey) }),
      el('span', { class: 'note', text: T('no.entriesN', { n: list.length }) }),
      el('button', { class: 'btn sm ghost', text: T('no.editList'), onclick: edit })
    ]);
  }

  function exportTab(tab) {
    const b = book();
    const f = document.createDocumentFragment();

    const csvRow = (labelKey, fileName, build) => {
      const res = build(b);
      return el('div', { class: 'row', style: 'align-items:center;gap:8px' }, [
        el('span', { style: 'flex:1', text: T(labelKey) }),
        res.errors.length
          ? el('span', { class: 'pill warn', text: T('no.csvErrors', { n: res.errors.length }) })
          : el('span', { class: 'note', text: T('no.csvRows', { n: res.rows }) }),
        el('button', { class: 'btn sm primary', text: T('no.download'), onclick: () => {
          const fresh = build(book());
          if (fresh.errors.length) U.toast(T(fresh.errors[0].key, fresh.errors[0].args), 7000);
          U.download(fileName, fresh.csv, 'text/csv;charset=utf-8');
        } })
      ]);
    };

    f.appendChild(el('div', { class: 'grid g2' }, [
      card(T('no.exportTitle'), T('no.exportNote'), el('div', { class: 'stack' }, [
        csvRow('no.csvTeams', 'MappingTeams.csv', x => N.buildTeamsCsv(x)),
        csvRow('no.csvLocations', 'MappingLocations.csv', x => N.buildLocationsCsv(x)),
        csvRow('no.csvEmployees', 'MedewerkersKoppeling.csv', x => N.buildEmployeesCsv(x)),
        el('p', { class: 'note', text: T('no.exportFullSet') })
      ])),
      card(T('no.bookTitle'), T('no.bookNote'), el('div', { class: 'stack' }, [
        el('div', { class: 'row' }, [
          el('button', { class: 'btn ghost', text: T('no.bookExport'), onclick: () =>
            U.download('nedap-book.json', HR.config.exportNedapBook(), 'application/json') }),
          el('button', { class: 'btn ghost', text: T('no.bookImport'), onclick: () => {
            const inp = el('input', { type: 'file', accept: '.json,.xlsx' });
            inp.onchange = () => { if (inp.files[0]) HR.app.importFileAs(inp.files[0]); };
            inp.click();
          } })
        ]),
        el('p', { class: 'note', text: T('no.workbookHint') })
      ]))
    ]));

    f.appendChild(el('div', { class: 'grid', style: 'margin-top:14px' },
      card(T('no.lookupsTitle'), T('no.lookupsNote'), el('div', { class: 'stack' }, [
        lookupCard(tab, 'departments', 'no.lkDepartments', ['name', 'code', 'id']),
        lookupCard(tab, 'titles', 'no.lkTitles', ['name', 'code', 'id']),
        lookupCard(tab, 'teams', 'no.lkTeams', ['name', 'identificationNo', 'id']),
        lookupCard(tab, 'locations', 'no.lkLocations', ['name', 'identificationNo', 'id']),
        lookupCard(tab, 'expertiseProfiles', 'no.lkExpertise', ['name', 'code']),
        lookupCard(tab, 'weeksheetProfiles', 'no.lkWeeksheet', ['name'])
      ]))));
    return f;
  }

  /* -------------------------------------------------------------------- view */

  function nedapView(m, params) {
    const f = document.createDocumentFragment();
    const b = book();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('no.title') }),
      el('p', { text: T('no.lead') })
    ])));

    if (N.isEmptyBook(b)) {
      f.appendChild(el('div', { class: 'grid' }, card(T('no.emptyTitle'), null, el('div', { class: 'stack' }, [
        el('p', { text: T('no.emptyBody') }),
        el('p', { class: 'note', text: T('no.emptyBlank') }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn primary', text: T('no.emptyImport'), onclick: () => {
            const inp = el('input', { type: 'file', accept: '.xlsx,.json' });
            inp.onchange = () => { if (inp.files[0]) HR.app.importFileAs(inp.files[0]); };
            inp.click();
          } }),
          el('button', { class: 'btn ghost', text: T('no.emptyStart'), onclick: () => {
            const nb = N.emptyBook();
            nb.started = true;
            HR.config.setNedapBook(nb);
            HR.app.go('nedap', { tab: 'export' });
          } })
        ])
      ]))));
      return f;
    }

    const issues = N.checkBook(b, effVault());
    const scopeIssues = a => issues.filter(i => i.area === a);
    f.appendChild(tabbed('nedap', [
      { id: 'teams', label: T('no.tab.teams'), count: b.teamMappings.length || null,
        build: () => scopeTab('teams', 'teams', scopeIssues('teams')) },
      { id: 'locations', label: T('no.tab.locations'), count: b.locationMappings.length || null,
        build: () => scopeTab('locations', 'locations', scopeIssues('locations')) },
      { id: 'medewerkers', label: T('no.tab.medewerkers'), count: b.employees.length || null,
        build: () => employeesTab('medewerkers', scopeIssues('employees')) },
      { id: 'rollen', label: T('no.tab.rollen'), count: b.roles.length || null,
        build: () => rolesTab('rollen', scopeIssues('roles')) },
      { id: 'health', label: T('no.tab.health'), count: issues.length || null,
        build: () => healthTab(issues) },
      { id: 'simulator', label: T('no.tab.simulator'), build: simulatorTab },
      { id: 'export', label: T('no.tab.export'), build: () => exportTab('export') }
    ], params));
    return f;
  }

  HR.views.nedap = nedapView;
})(window.HR);
