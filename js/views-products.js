/* Service Automation products: the catalogue, who holds what, and the product map.

   Split out of views.js, which had grown past three and a half thousand lines. These use
   the shared building blocks views.js publishes on HR.viewkit rather than importing
   anything: the page has no module system by design, so the seam is an object rather
   than an import list. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el, C = HR.charts;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, scoreBar, dl, partialNotice, personRow, peopleIndex,
    drawerPermission, drawerVaultPerson, openDrawer, STATE_SEV, stateLabel } = HR.viewkit;

  /* ================================================================ PRODUCTS

     HelloID does not record which entitlement a Service Automation product hands out.
     The tool proposes matches by name and by who holds what; a person confirms them.
     Only confirmed mappings explain anything, and the map exports so the next analyst
     — or the next tenant review — does not start from nothing.                       */

  function productsView(m) {
    const f = document.createDocumentFragment();
    const A = m.assignments, P = m.products, match = m.productMatch;
    const map = HR.config.getMap();

    f.appendChild(el('div', { class: 'view-head' }, [
      el('div', {}, [
        el('h1', { text: T('pr.title') }),
        el('p', { text: A
          ? T('pr.lead', { n: U.fmtInt(A.meta.openCount), products: A.meta.products, users: A.meta.users })
          : T('pr.leadNoAssignments') })
      ])
    ]));

    if (!P && !A) {
      f.appendChild(card(T('pr.none'), null, el('p', { class: 'note', text: T('pr.noneNote') })));
      return f;
    }

    /* Why the proposals look the way they do, before anybody reads them as fact. */
    if (match && match.reasons.length) {
      f.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: T('pr.whyTitle') }),
        el('ul', { class: 'note' }, match.reasons.map(r => el('li', { text: T('pr.why.' + r) })))
      ]));
    }

    if (A) {
      const tiles = el('div', { class: 'grid g4', style: 'margin-bottom:14px' });
      tiles.append(
        tile(T('pr.kOpen'), U.fmtInt(A.meta.openCount), T('pr.kOpenFoot', { returned: A.meta.returned })),
        tile(T('pr.kMapped'), U.fmtInt(Object.keys(map).length) + '/' + U.fmtInt(P ? P.meta.rowCount : 0),
          T('pr.kMappedFoot'), { severity: Object.keys(map).length ? 'good' : 'medium' }),
        tile(T('pr.kSelfApproved'), U.fmtInt(A.meta.selfApproved), T('pr.kSelfApprovedFoot'),
          { severity: A.meta.selfApproved ? 'high' : 'good' }),
        tile(T('pr.kLinked'), m.productHolders
          ? U.fmtInt(m.productHolders.stats.linked) + '/' + U.fmtInt(m.productHolders.stats.users) : '—',
          T('pr.kLinkedFoot'), { severity: m.productHolders && m.productHolders.stats.unlinked ? 'medium' : 'good' })
      );
      f.appendChild(tiles);
    }

    /* ---- the map itself ---- */
    const toolbar = el('div', { class: 'slot-actions', style: 'margin-bottom:10px' }, [
      el('button', { class: 'btn', text: T('pr.exportMap'), onclick: () => {
        U.download('product-map.json', HR.config.exportMap(), 'application/json');
        HR.usage.exported('product-map');
      } }),
      el('button', { class: 'btn', text: T('pr.exportMapCsv'), onclick: () =>
        U.download('product-map.csv', HR.config.exportMapCsv(), 'text/csv') }),
      el('button', { class: 'btn ghost danger', text: T('pr.clearMap'), onclick: () => {
        Object.keys(HR.config.getMap()).forEach(k => HR.config.setMapping(k, null));
        HR.app.rebuild();
      } })
    ]);

    const rows = (P ? P.rows : []).map(product => {
      const assignments = A ? (A.byProduct.get(product.name.toLowerCase()) || []) : [];
      const open = assignments.filter(a => !a.returnDate);
      const mapped = map[product.name] || [];
      const proposals = match ? (match.byProduct.get(product.name.toLowerCase()) || []) : [];
      return { product, open: open.length, mapped, proposals };
    });

    const table = HR.table.make({
      columns: [
        { key: 'name', label: T('pr.cProduct'), value: r => r.product.name,
          render: r => el('a', { href: '#', text: r.product.name,
            onclick: e => { e.preventDefault(); drawerProduct(m, r); } }) },
        { key: 'holders', label: T('pr.cHolders'), value: r => r.open, align: 'right' },
        { key: 'risk', label: T('pr.cRisk'), value: r => r.product.riskFactor || 0, align: 'right',
          render: r => r.product.riskFactor
            ? el('span', { class: 'sev ' + (r.product.riskFactor >= 7 ? 'high' : 'low'),
                text: String(r.product.riskFactor) })
            : el('span', { class: 'note', text: '—' }) },
        { key: 'price', label: T('pr.cPrice'), value: r => r.product.price || 0, align: 'right',
          render: r => r.product.price == null
            ? el('span', { class: 'note', text: '—' })
            : el('span', { text: U.fmtMoney(r.product.price) }) },
        { key: 'return', label: T('pr.cReturn'), value: r => r.product.returnOnUserDisable ? 1 : 0,
          render: r => el('span', { class: 'sev ' + (r.product.returnOnUserDisable ? 'good' : 'medium'),
            text: r.product.returnOnUserDisable ? T('pr.yes') : T('pr.no') }) },
        { key: 'mapped', label: T('pr.cMapped'), value: r => r.mapped.length,
          render: r => r.mapped.length
            ? el('span', { class: 'pill ok', text: r.mapped.map(x => x.permission).join(', ').slice(0, 60) })
            : (r.proposals.length
                ? el('span', { class: 'pill muted', text: T('pr.nProposals', { n: r.proposals.length }) })
                : el('span', { class: 'note', text: '—' })) }
      ],
      rows, pageSize: 25, exportName: 'products'
    });

    f.appendChild(card(T('pr.mapTitle'), T('pr.mapNote'), [toolbar, table]));
    return f;
  }

  /** One product: what it costs, who holds it, and what it maps to. */
  function drawerProduct(m, row) {
    const product = row.product;
    const map = HR.config.getMap();
    const body = document.createDocumentFragment();

    body.appendChild(dl([
      [T('pr.dSku'), product.sku || '—'],
      [T('pr.dCategories'), product.categories.join(', ') || '—'],
      [T('pr.dOwner'), product.resourceOwner || '—'],
      [T('pr.dWorkflow'), product.approvalWorkflow || '—'],
      [T('pr.dRisk'), product.riskFactor ? String(product.riskFactor) : '—'],
      [T('pr.dPrice'), product.price == null ? '—' : U.fmtMoney(product.price)],
      [T('pr.dTimeLimit'), !product.hasTimeLimit ? T('pr.no')
        : (product.ownershipDays
            ? T('pr.dDays', { n: U.fmtInt(product.ownershipDays), raw: U.fmtInt(product.ownershipMinutes) })
            : T('pr.dRaw', { n: U.fmtInt(product.ownershipMinutes) }))],
      [T('pr.dReturn'), product.returnOnUserDisable ? T('pr.yes') : T('pr.no')],
      [T('pr.dHolders'), U.fmtInt(row.open)]
    ]));

    const repaint = () => { HR.views.closeDrawer(); HR.app.rebuild(); };

    /* ---- confirmed ---- */
    const confirmed = map[product.name] || [];
    const confirmedList = el('div', {}, confirmed.length
      ? confirmed.map(e => el('div', { class: 'slot-actions' }, [
          el('span', { class: 'mono', text: (e.system ? e.system + ' · ' : '') + e.permission }),
          el('button', { class: 'btn sm ghost', text: T('pr.remove'), onclick: () => {
            HR.config.setMapping(product.name,
              confirmed.filter(x => !(x.system === e.system && x.permission === e.permission)));
            repaint();
          } })
        ]))
      : [el('p', { class: 'note', text: T('pr.noMapping') })]);
    body.appendChild(card(T('pr.confirmed'), null, confirmedList));

    /* ---- proposals ---- */
    const proposals = row.proposals.filter(p =>
      !confirmed.some(c => c.permission === p.perm.name && c.system === p.perm.system));
    body.appendChild(card(T('pr.proposals'), T('pr.proposalsNote'),
      proposals.length ? proposals.map(p => el('div', { class: 'slot-actions' }, [
        el('span', {}, [
          el('span', { class: 'mono', text: p.perm.name }),
          el('span', { class: 'note', text: ' ' + T('pr.score', {
            score: U.fmtNum(p.nameScore, 2), tokens: p.shared.join(', ') }) }),
          p.overlap == null
            ? el('span', { class: 'note', text: ' · ' + T('pr.noOverlapData') })
            : el('span', { class: 'sev ' + (p.verdict === 'corroborated' ? 'good' : 'medium'),
                text: ' ' + T('pr.overlap', { pct: U.fmtPct(p.overlap, 0) }) })
        ]),
        el('button', { class: 'btn sm primary', text: T('pr.confirm'), onclick: () => {
          HR.config.setMapping(product.name, confirmed.concat([{
            system: p.perm.system, permission: p.perm.name, source: 'proposal'
          }]));
          repaint();
        } })
      ])) : el('p', { class: 'note', text: T('pr.noProposals') })));

    /* ---- manual ---- */
    const input = el('input', { type: 'search', placeholder: T('pr.searchPh'), style: 'flex:1 1 auto' });
    const results = el('div', {});
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) return;
      m.permissionList.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8).forEach(p => {
        results.appendChild(el('div', { class: 'slot-actions' }, [
          el('span', { class: 'mono', text: p.name }),
          el('span', { class: 'note', text: T('pr.holders', { n: p.holders.size }) }),
          el('button', { class: 'btn sm', text: T('pr.add'), onclick: () => {
            HR.config.setMapping(product.name, (HR.config.getMap()[product.name] || []).concat([
              { system: p.system, permission: p.name, source: 'manual' }
            ]));
            repaint();
          } })
        ]));
      });
    });
    body.appendChild(card(T('pr.manual'), T('pr.manualNote'),
      [el('div', { class: 'slot-actions' }, [input]), results]));

    /* ---- holders ---- */
    const A = m.assignments;
    const list = A ? (A.byProduct.get(product.name.toLowerCase()) || []).filter(a => !a.returnDate) : [];
    if (list.length) {
      body.appendChild(card(T('pr.holdersTitle'), null, HR.table.make({
        columns: [
          { key: 'user', label: T('pr.cUser'), value: a => a.userName },
          { key: 'requested', label: T('pr.cRequested'), value: a => a.requestedAt ? +a.requestedAt : 0,
            render: a => el('span', { text: a.requestedAt ? U.fmtDate(a.requestedAt).split(',')[0] : '—' }) },
          { key: 'approver', label: T('pr.cApprover'), value: a => a.approvedBy || '',
            render: a => a.selfApproved
              ? el('span', { class: 'sev high', text: T('pr.selfApproved') })
              : el('span', { text: a.approvedBy || T('pr.unrecorded') }) }
        ],
        rows: list, pageSize: 10, exportName: 'holders-' + product.name
      })));
    }

    openDrawer(el('div', {}, [
      el('div', { text: product.name }),
      el('span', { class: 'note', text: product.description.slice(0, 140) })
    ]), body);
  }
  HR.views.products = productsView;
})(window.HR);
