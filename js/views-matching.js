/* The matching workbench: every account, who this analysis believes it belongs to,
   how sure it is, and the place where a human overrules it.

   The initial account-to-person matching is where hard tenants get stuck: what stays
   unmatched here becomes a duplicate account at provisioning and noise at every
   reconciliation after it. Decisions land in the match book (exportable, importable —
   tenant knowledge, worked out once), and confirmed matches can be written back to
   the directory as a generated fix script, so HelloID correlates cleanly on day one. */
(function (HR) {
  'use strict';

  const U = HR.util, el = U.el;
  const T = (k, p) => HR.i18n.t(k, p);
  const { card, tile, tabbed, scoreBar, openDrawer, closeDrawer, syntheticVaultNotice } = HR.viewkit;

  /* Vault display names often already end in "(employeeId)"; only append when absent. */
  const personLabel = p => p.externalId && !p.displayName.includes('(' + p.externalId + ')')
    ? p.displayName + ' (' + p.externalId + ')'
    : p.displayName;

  /* ------------------------------------------------------------- decisions */

  function decide(account, person, decision) {
    HR.config.setMatchDecision(account.key, {
      decision,
      personExternalId: person ? (person.externalId || '') : '',
      personId: person ? (person.personId || '') : '',
      personName: person ? person.displayName : ''
    });
    closeDrawer();
    HR.app.rebuildBusy().then(() => U.toast(T('mt.toastDecided'), 3000));
  }

  function reject(account, person) {
    HR.config.setMatchDecision(account.key, { reject: person.externalId || person.personId });
    closeDrawer();
    HR.app.rebuildBusy().then(() => U.toast(T('mt.toastRejected'), 3000));
  }

  function undoDecision(account) {
    HR.config.setMatchDecision(account.key, null);
    closeDrawer();
    HR.app.rebuildBusy().then(() => U.toast(T('mt.toastUndone'), 3000));
  }

  /* ---------------------------------------------------------------- drawer */

  function drawerMatch(m, row) {
    const a = row.account;
    const head = el('div', {}, [
      el('h2', { text: a.userName }),
      el('div', { class: 'row' }, [
        el('span', { class: 'pill', text: a.clsLabel }),
        el('span', { class: 'pill', text: T(a.enabled === false ? 'c.disabled' : 'c.enabled') }),
        row.person
          ? el('span', { class: 'pill ok', text: personLabel(row.person) })
          : (a.ownerless
            ? el('span', { class: 'pill muted', text: T('mt.dOwnerless') })
            : el('span', { class: 'pill removed', text: T('c.unowned') }))
      ])
    ]);

    const body = el('div', { class: 'stack' });
    body.appendChild(HR.viewkit.dl([
      [T('c.system'), a.system],
      [T('c.displayName'), a.displayName],
      [T('c.person'), a.personRaw || T('dr.notLinked')],
      [T('mt.attribution'), row.person
        ? T('mt.layer.' + row.layer) + (row.evidence && row.evidence.length ? ' · ' + row.evidence.join(', ') : '')
        : (a.ownerless ? T('mt.dOwnerless') : T('mt.noAttribution'))],
      [T('dr.permsHeld'), String(a.permCount)],
      [T('dr.monthlyCost'), U.fmtMoney(a.monthlyCost)],
      row.decision ? [T('mt.decision'), T('mt.d' + row.decision.decision.charAt(0).toUpperCase() + row.decision.decision.slice(1))
        + (row.decision.personName ? ' · ' + row.decision.personName : '')] : null
    ].filter(Boolean)));

    /* Candidates, threshold or not: the near-misses are the duplicate risk. */
    const cands = row.candidates && row.candidates.length
      ? row.candidates
      : (row.person && row.layer === 'name' ? [] : []);
    if (cands.length) {
      body.appendChild(card(T('mt.candidates'), T('mt.candidatesNote'),
        el('ul', { class: 'clean' }, cands.map(c => {
          const li = el('li', { class: 'row' });
          li.append(
            el('strong', { text: personLabel(c.person) }),
            scoreBar(Math.min(100, c.points)),
            el('span', { class: 'note trunc', text: c.evidence.join(', ') }),
            el('span', { style: 'flex:1' }),
            el('button', { class: 'btn sm primary', text: T('mt.confirm'),
              onclick: () => decide(a, c.person, 'confirmed') }),
            el('button', { class: 'btn sm', text: T('mt.reject'),
              onclick: () => reject(a, c.person) })
          );
          return li;
        }))));
    }

    /* Assign someone the scorer never proposed. */
    const results = el('ul', { class: 'clean' });
    const search = el('input', {
      type: 'search', placeholder: T('mt.searchPh'),
      oninput: e => {
        const q = e.target.value.trim().toLowerCase();
        results.innerHTML = '';
        if (q.length < 2) return;
        const hits = m.vault.persons
          .filter(p => (p.displayName + ' ' + (p.externalId || '')).toLowerCase().includes(q))
          .slice(0, 10);
        hits.forEach(p => {
          const li = el('li', { class: 'row' });
          li.append(
            el('span', { text: personLabel(p) }),
            el('span', { style: 'flex:1' }),
            el('button', { class: 'btn sm', text: T('mt.assign'),
              onclick: () => decide(a, p, 'assigned') })
          );
          results.appendChild(li);
        });
        if (!hits.length) results.appendChild(el('li', {}, el('span', { class: 'note', text: T('mt.noHits') })));
      }
    });
    body.appendChild(card(T('mt.assignTitle'), T('mt.assignNote'), [search, results]));

    body.appendChild(el('div', { class: 'row' }, [
      !a.ownerless ? el('button', { class: 'btn', text: T('mt.markOwnerless'),
        onclick: () => decide(a, null, 'ownerless') }) : null,
      row.decision ? el('button', { class: 'btn ghost', text: T('mt.undo'),
        onclick: () => undoDecision(a) }) : null
    ].filter(Boolean)));

    openDrawer(head, body);
  }

  /* ----------------------------------------------------------------- batch */

  /** One book write, one re-score, one undoable unit for any number of decisions. */
  function applyBatch(entries) {
    const book = HR.config.getMatchBook();
    const stamp = new Date().toISOString();
    entries.forEach(e => {
      book.decisions[e.account.key] = {
        decision: e.decision,
        personExternalId: e.person ? (e.person.externalId || '') : '',
        personId: e.person ? (e.person.personId || '') : '',
        personName: e.person ? e.person.displayName : '',
        decidedAt: stamp, batch: stamp
      };
    });
    HR.config.save();
    return HR.app.rebuildBusy().then(() =>
      U.toast(T('mt.toastBatch', { n: U.fmtInt(entries.length) }), 5000));
  }

  /* Zero-candidate accounts, grouped by class: nothing to preselect, so the only
     honest batch for them is "these are deliberately ownerless". */
  function ownerlessGroups(rows) {
    const byCls = new Map();
    for (const r of rows) {
      if (!byCls.has(r.account.clsLabel)) byCls.set(r.account.clsLabel, []);
      byCls.get(r.account.clsLabel).push(r);
    }
    return Array.from(byCls.entries()).map(([cls, list]) => ({ cls, rows: list }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }

  /* ---- the paged flow ------------------------------------------------------
     Twenty-five at a time, easiest first. Every row shows the account and its
     best candidate preselected; the dropdown holds the alternatives, the
     checkbox holds the veto. One page approval = one undoable batch. */
  const FLOW_PAGE = 25;
  let flowPage = 0;

  function flowCard(m, flowRows) {
    const container = el('div');
    const draw = () => {
      container.innerHTML = '';
      const total = flowRows.length;
      const pages = Math.max(1, Math.ceil(total / FLOW_PAGE));
      flowPage = Math.min(Math.max(0, flowPage), pages - 1);
      const slice = flowRows.slice(flowPage * FLOW_PAGE, (flowPage + 1) * FLOW_PAGE);
      const items = slice.map(r => ({ r, chosen: 0, approve: true }));

      const approveBtn = el('button', { class: 'btn primary' });
      const refreshApprove = () => {
        const n = items.filter(x => x.approve).length;
        approveBtn.textContent = T('mt.flowApprove', { n: U.fmtInt(n), m: U.fmtInt(items.length) });
        approveBtn.disabled = !n;
      };
      approveBtn.addEventListener('click', () => {
        const entries = items.filter(x => x.approve).map(x => ({
          account: x.r.account, person: x.r.candidates[x.chosen].person, decision: 'confirmed' }));
        if (entries.length) applyBatch(entries);
      });

      const t = el('table', { class: 'tbl' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { class: 'no-sort' }),
        el('th', { class: 'no-sort', text: T('c.account') }),
        el('th', { class: 'no-sort', text: T('c.class') }),
        el('th', { class: 'no-sort', text: T('mt.flowCandidate') }),
        el('th', { class: 'no-sort', text: T('mt.evidence') }),
        el('th', { class: 'no-sort num', text: T('mt.score') })
      ])));
      const tb = el('tbody');
      items.forEach(item => {
        const r = item.r;
        const box = el('input', { type: 'checkbox' });
        box.checked = true;
        box.addEventListener('change', () => { item.approve = box.checked; refreshApprove(); });

        const evidenceCell = el('span', { class: 'note' });
        const scoreCell = el('span', { class: 'pill' });
        const refreshRow = () => {
          const c = r.candidates[item.chosen];
          evidenceCell.textContent = c.evidence.join(', ');
          scoreCell.textContent = String(c.points);
        };
        const sel = el('select', {
          onchange: e => { item.chosen = parseInt(e.target.value, 10) || 0; refreshRow(); } });
        r.candidates.forEach((c, ci) => sel.appendChild(el('option', {
          value: String(ci), text: personLabel(c.person) + ' · ' + c.points, selected: ci === 0 })));
        refreshRow();

        tb.appendChild(el('tr', {}, [
          el('td', {}, box),
          el('td', {}, el('a', { href: '#', class: 'mono', text: r.account.userName,
            onclick: e => { e.preventDefault(); drawerMatch(m, r); } })),
          el('td', { text: r.account.clsLabel }),
          el('td', {}, sel),
          el('td', {}, evidenceCell),
          el('td', { class: 'num' }, scoreCell)
        ]));
      });
      t.appendChild(tb);
      refreshApprove();

      container.appendChild(el('div', { class: 'tbl-wrap' }, t));
      container.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
        approveBtn,
        pages > 1 ? el('button', { class: 'btn ghost', text: T('mt.flowSkip'),
          onclick: () => { flowPage++; draw(); } }) : null,
        el('span', { style: 'flex:1' }),
        el('span', { class: 'note', text: T('mt.flowProgress', {
          p: U.fmtInt(flowPage + 1), pages: U.fmtInt(pages), total: U.fmtInt(total) }) })
      ].filter(Boolean)));
    };
    draw();
    return card(T('mt.flowTitle'), T('mt.flowNote'), container);
  }

  /* ------------------------------------------------------------------ tabs */

  function reviewTab(m, table) {
    const wrap = document.createDocumentFragment();

    /* Open proposals: undecided accounts with candidates, plus the scored
       name-layer matches nobody confirmed — both are guesses a human may want
       to switch. Vault references are recorded truth and never appear here. */
    const flowRows = table.filter(r =>
      !r.decision && !r.account.ownerless && !r.vaultRef && r.candidates.length &&
      (!r.person || r.layer === 'name'))
      .sort((a, b) => b.candidates[0].points - a.candidates[0].points);

    if (flowRows.length) wrap.appendChild(flowCard(m, flowRows));
    else wrap.appendChild(card(T('mt.flowTitle'), null,
      el('p', { class: 'note', text: T('mt.flowNone') })));

    const noCands = table.filter(r => !r.person && !r.account.ownerless && !r.decision && !r.candidates.length);
    const owner = ownerlessGroups(noCands);
    if (owner.length) {
      wrap.appendChild(card(T('mt.noCandsTitle'), T('mt.noCandsNote'),
        el('ul', { class: 'clean' }, owner.map(g => {
          const li = el('li', { class: 'row' });
          li.append(
            el('strong', { text: g.cls }),
            el('span', { class: 'note', text: T('mt.batchNoCands') }),
            el('span', { style: 'flex:1' }),
            el('button', { class: 'btn sm', text: T('mt.batchOwnerless', { n: U.fmtInt(g.rows.length) }),
              onclick: () => {
                if (!confirm(T('mt.batchOwnerlessSure', { n: U.fmtInt(g.rows.length), cls: g.cls }))) return;
                applyBatch(g.rows.map(r => ({ account: r.account, person: null, decision: 'ownerless' })));
              } })
          );
          return li;
        }))));
    }
    return wrap;
  }

  function allTab(m, table) {
    const layers = ['manual', 'vault', 'recon', 'name'];
    return card(null, null, HR.table.make({
      columns: [
        { key: 'userName', label: T('c.account'), value: r => r.account.userName,
          render: r => el('span', { class: 'mono', text: r.account.userName }) },
        { key: 'displayName', label: T('c.displayName'), value: r => r.account.displayName },
        { key: 'cls', label: T('c.class'), value: r => r.account.clsLabel },
        { key: 'person', label: T('c.person'), value: r => r.person ? personLabel(r.person) : '',
          render: r => r.person ? el('span', { text: personLabel(r.person) })
            : (r.account.ownerless ? el('span', { class: 'pill muted', text: T('mt.dOwnerless') })
              : el('span', { class: 'sev critical', text: T('c.unowned') })) },
        { key: 'layer', label: T('mt.layerCol'), value: r => r.layer || '',
          render: r => r.layer && r.layer !== 'ownerless'
            ? el('span', { class: 'pill' + (r.layer === 'manual' ? ' ok' : ''), text: T('mt.layer.' + r.layer) })
            : el('span', { class: 'note', text: '—' }) },
        { key: 'points', label: T('mt.score'), num: true, value: r => r.points == null ? -1 : r.points,
          render: r => r.points == null ? el('span', { class: 'note', text: '—' }) : document.createTextNode(String(r.points)) },
        { key: 'decision', label: T('mt.decision'), value: r => r.decision ? r.decision.decision : '',
          render: r => r.decision
            ? el('span', { class: 'pill ok', text: T('mt.d' + r.decision.decision.charAt(0).toUpperCase() + r.decision.decision.slice(1)) })
            : el('span', { class: 'note', text: '—' }) }
      ],
      rows: table, pageSize: 40, exportName: 'matching-all',
      initialSort: { key: 'layer', dir: 1 },
      search: (r, q) => (r.account.userName + ' ' + r.account.displayName + ' ' +
        (r.person ? r.person.displayName : '')).toLowerCase().includes(q),
      filters: [
        { key: 'layer', label: T('mt.layerCol'),
          options: layers.map(l => ({ value: l, label: T('mt.layer.' + l) }))
            .concat([{ value: 'none', label: T('c.unowned') }]),
          match: (r, v) => v === 'none' ? (!r.person && !r.account.ownerless) : r.layer === v },
        { key: 'decision', label: T('mt.decision'),
          options: ['confirmed', 'assigned', 'ownerless'].map(d => ({ value: d, label: T('mt.d' + d.charAt(0).toUpperCase() + d.slice(1)) })),
          match: (r, v) => !!r.decision && r.decision.decision === v }
      ],
      onRowClick: r => drawerMatch(m, r)
    }));
  }

  /* ------------------------------------------------- decisions + fix script */

  const psq = v => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";

  function buildFixScript(rows, source, attr) {
    const stamp = new Date().toISOString();
    const rowLines = rows.map(r =>
      '  [pscustomobject]@{ User = ' + psq(r.userName) + '; Value = ' + psq(r.personExternalId) +
      '; Person = ' + psq(r.personName) + ' }').join('\n');

    const shared = [
      '<#',
      '  Generated by HelloID Analytics on ' + stamp + ' from ' + rows.length + ' human-confirmed match decisions.',
      '  Writes the matching attribute (' + attr + ') so the HelloID connector correlates these accounts',
      '  to the right person on day one instead of creating duplicates.',
      '',
      '  READ-ONLY BY DEFAULT: running without -Apply only prints current -> planned values.',
      '  Review that output, then re-run with -Apply to write. Every row below was decided by a human',
      '  in the matching workbench; nothing in this file is a guess.',
      '#>',
      "[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',",
      "  Justification = 'Interactive remediation script; the plan belongs on the host.')]",
      '[CmdletBinding()]',
      'param([switch]$Apply)',
      '',
      '$rows = @(',
      rowLines,
      ')',
      ''
    ].join('\n');

    if (source === 'ad') {
      return shared + [
        'Import-Module ActiveDirectory',
        '$attr = ' + psq(attr),
        '$written = 0',
        'foreach ($r in $rows) {',
        '  $u = Get-ADUser -Identity $r.User -Properties $attr -ErrorAction SilentlyContinue',
        '  if (-not $u) { Write-Host ("MISSING  {0} - not found in AD" -f $r.User); continue }',
        '  $current = [string]$u.$attr',
        "  if ($current -eq $r.Value) { Write-Host (\"OK       {0} already '{1}'\" -f $r.User, $r.Value); continue }",
        '  $mode = if ($Apply) { "APPLY " } else { "PLAN  " }',
        "  Write-Host (\"{0}  {1}: '{2}' -> '{3}'  ({4})\" -f $mode, $r.User, $current, $r.Value, $r.Person)",
        '  if ($Apply) { Set-ADUser -Identity $r.User -Replace @{ $attr = $r.Value }; $written++ }',
        '}',
        'Write-Host ""',
        'if ($Apply) { Write-Host ("Done: {0} account(s) updated." -f $written) }',
        'else { Write-Host "Dry run - nothing written. Re-run with -Apply to write the values above." }',
        ''
      ].join('\n');
    }

    return shared + [
      '# Requires: Microsoft.Graph.Users. Delegated, and the one write scope this needs:',
      "Connect-MgGraph -Scopes 'User.ReadWrite.All' -NoWelcome",
      '$written = 0',
      'foreach ($r in $rows) {',
      "  $u = Get-MgUser -Filter (\"userPrincipalName eq '{0}'\" -f $r.User) -Property id,employeeId,userPrincipalName -ErrorAction SilentlyContinue",
      '  if (-not $u) {',
      "    $u = Get-MgUser -Filter (\"onPremisesSamAccountName eq '{0}'\" -f $r.User) -Property id,employeeId,userPrincipalName -ConsistencyLevel eventual -CountVariable c -ErrorAction SilentlyContinue",
      '  }',
      '  if (-not $u) { Write-Host ("MISSING  {0} - not found in Entra" -f $r.User); continue }',
      '  $current = [string]$u.EmployeeId',
      "  if ($current -eq $r.Value) { Write-Host (\"OK       {0} already '{1}'\" -f $r.User, $r.Value); continue }",
      '  $mode = if ($Apply) { "APPLY " } else { "PLAN  " }',
      "  Write-Host (\"{0}  {1}: '{2}' -> '{3}'  ({4})\" -f $mode, $r.User, $current, $r.Value, $r.Person)",
      '  if ($Apply) { Update-MgUser -UserId $u.Id -EmployeeId $r.Value; $written++ }',
      '}',
      'Disconnect-MgGraph | Out-Null',
      'Write-Host ""',
      'if ($Apply) { Write-Host ("Done: {0} account(s) updated." -f $written) }',
      'else { Write-Host "Dry run - nothing written. Re-run with -Apply to write the values above." }',
      ''
    ].join('\n');
  }

  function decisionsTab(m, table) {
    const wrap = document.createDocumentFragment();
    const decisions = HR.config.getMatchBook().decisions;
    const rows = Object.keys(decisions).map(key => {
      const d = decisions[key];
      const account = m.accounts.get(key);
      return { key, d, account,
        userName: account ? account.userName : key.split('\u001f')[1] || key,
        system: account ? account.system : key.split('\u001f')[0] || '' };
    }).sort((a, b) => (b.d.decidedAt || '').localeCompare(a.d.decidedAt || ''));

    wrap.appendChild(card(T('mt.bookTitle'), T('mt.bookNote'), [
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn sm', text: T('mt.exportBook'), onclick: () => {
          HR.usage.exported('match-book');
          U.download('match-book.json', HR.config.exportMatchBook(), 'application/json');
        } }),
        (() => {
          const label = el('label', { class: 'btn sm' });
          const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true,
            onchange: async e => {
              const file = e.target.files[0]; if (!file) return;
              try {
                const res = HR.config.importMatchBook(await file.text(), { merge: true });
                await HR.app.rebuildBusy();
                U.toast(T('toast.matchBookImported', res), 5000);
              } catch (err) { U.toast(err.message, 7000); }
              e.target.value = '';
            } });
          label.append(document.createTextNode(T('mt.importBook')), input);
          return label;
        })(),
        el('span', { class: 'spacer' }),
        rows.length ? el('button', { class: 'btn sm danger', text: T('mt.clearBook'), onclick: () => {
          if (!confirm(T('mt.clearBookSure', { n: U.fmtInt(rows.length) }))) return;
          HR.config.getMatchBook().decisions = {};
          HR.config.save();
          HR.app.rebuildBusy().then(() => U.toast(T('mt.toastCleared'), 4000));
        } }) : null
      ].filter(Boolean)),
      (() => {
        /* Batches are one undoable unit: everything written by one approval. */
        const byBatch = new Map();
        rows.forEach(r => {
          if (!r.d.batch) return;
          if (!byBatch.has(r.d.batch)) byBatch.set(r.d.batch, []);
          byBatch.get(r.d.batch).push(r);
        });
        if (!byBatch.size) return null;
        return el('ul', { class: 'clean' }, Array.from(byBatch.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([stamp, list]) => {
            const li = el('li', { class: 'row' });
            li.append(
              el('span', { text: T('mt.batchRow', {
                when: U.fmtDate(Date.parse(stamp)), n: U.fmtInt(list.length) }) }),
              el('span', { style: 'flex:1' }),
              el('button', { class: 'btn sm ghost', text: T('mt.undoBatch'), onclick: () => {
                if (!confirm(T('mt.undoBatchSure', { n: U.fmtInt(list.length) }))) return;
                const book = HR.config.getMatchBook();
                list.forEach(r => delete book.decisions[r.key]);
                HR.config.save();
                HR.app.rebuildBusy().then(() => U.toast(T('mt.toastUndone'), 3000));
              } })
            );
            return li;
          }));
      })(),
      rows.length ? HR.table.make({
        columns: [
          { key: 'userName', label: T('c.account'), render: r => el('span', { class: 'mono', text: r.userName }) },
          { key: 'system', label: T('c.system') },
          { key: 'person', label: T('c.person'), value: r => r.d.personName || '' },
          { key: 'decision', label: T('mt.decision'), value: r => r.d.decision || '',
            render: r => r.d.decision
              ? el('span', { class: 'pill ok', text: T('mt.d' + r.d.decision.charAt(0).toUpperCase() + r.d.decision.slice(1)) })
              : el('span', { class: 'note', text: '—' }) },
          { key: 'rejected', label: T('mt.rejectedCol'), num: true, value: r => (r.d.rejected || []).length },
          { key: 'when', label: T('mt.decidedAt'), value: r => r.d.decidedAt || '',
            render: r => r.d.decidedAt ? U.fmtDate(Date.parse(r.d.decidedAt)) : '—' },
          { key: 'undo', label: '', sortable: false,
            render: r => el('button', { class: 'btn sm danger', text: '✕', onclick: e => {
              e.stopPropagation();
              HR.config.setMatchDecision(r.key, null);
              HR.app.rebuildBusy().then(() => U.toast(T('mt.toastUndone'), 3000));
            } }) }
        ],
        rows, pageSize: 25, exportName: 'match-book',
        search: (r, q) => (r.userName + ' ' + (r.d.personName || '')).toLowerCase().includes(q)
      }) : el('p', { class: 'note', text: T('mt.bookEmpty') })
    ]));

    /* The write-back: confirmed decisions become a remediation script. */
    const writable = rows.filter(r => r.d.decision === 'confirmed' || r.d.decision === 'assigned');
    const withId = writable.filter(r => r.d.personExternalId);
    const srcSel = el('select', {}, [
      el('option', { value: 'ad', text: 'Active Directory' }),
      el('option', { value: 'entra', text: 'Microsoft Entra ID' })
    ]);
    const AD_ATTRS = ['employeeID', 'employeeNumber'].concat(
      Array.from({ length: 15 }, (_, i) => 'extensionAttribute' + (i + 1)));
    const attrSel = el('select', {});
    const fillAttrs = () => {
      attrSel.innerHTML = '';
      (srcSel.value === 'ad' ? AD_ATTRS : ['employeeId'])
        .forEach(x => attrSel.appendChild(el('option', { value: x, text: x })));
    };
    srcSel.addEventListener('change', fillAttrs);
    fillAttrs();

    wrap.appendChild(card(T('mt.fixTitle'), T('mt.fixNote'), [
      el('div', { class: 'row' }, [
        el('label', { class: 'inline' }, [document.createTextNode(T('mt.fixSource')), srcSel]),
        el('label', { class: 'inline' }, [document.createTextNode(T('mt.fixAttr')), attrSel]),
        el('button', { class: 'btn primary', text: T('mt.fixGenerate', { n: U.fmtInt(withId.length) }),
          onclick: () => {
            if (!withId.length) { U.toast(T('mt.fixNone'), 5000); return; }
            const skipped = writable.length - withId.length;
            const scriptRows = withId.map(r => ({
              userName: r.userName, personExternalId: r.d.personExternalId, personName: r.d.personName }));
            const text = buildFixScript(scriptRows, srcSel.value, attrSel.value);
            HR.usage.exported('fix-matching-script');
            U.download('fix-matching-' + srcSel.value + '.ps1', text, 'text/plain;charset=utf-8');
            if (skipped) U.toast(T('mt.fixSkipped', { n: U.fmtInt(skipped) }), 6000);
          } })
      ]),
      el('p', { class: 'note', text: T('mt.fixSafety') })
    ]));

    return wrap;
  }

  /* ------------------------------------------------------------------ view */

  function matchingView(m, params) {
    const f = document.createDocumentFragment();
    f.appendChild(el('div', { class: 'view-head' }, el('div', {}, [
      el('h1', { text: T('mt.title') }),
      el('p', { text: T('mt.lead') })
    ])));
    const synNote = syntheticVaultNotice(m);
    if (synNote) f.appendChild(synNote);

    const table = HR.correlate.fullTable(m, m.vault, m.correlation);
    const stats = HR.correlate.attributionStats(m, m.vault, m.correlation);
    const decisions = HR.config.getMatchBook().decisions;
    const queueCount = table.filter(r => !r.decision && !r.account.ownerless &&
      ((!r.person && !r.vaultRef) || (r.layer === 'name' && !r.vaultRef && r.candidates.length))).length;
    const ownerlessCount = table.filter(r => r.account.ownerless).length;
    const layerBits = ['manual', 'vault', 'recon', 'name']
      .filter(l => stats.byLayer[l])
      .map(l => T('mt.layer.' + l) + ' ' + U.fmtInt(stats.byLayer[l])).join(' · ');

    const k = el('div', { class: 'grid g4' });
    k.append(
      tile(T('mt.kAttributed'), U.fmtPct(stats.accounts ? stats.attributed / stats.accounts : 0, 0),
        layerBits || T('mt.kAttributedFoot'),
        { small: true, severity: stats.unattributed ? 'medium' : 'good' }),
      tile(T('mt.kQueue'), U.fmtInt(queueCount), T('mt.kQueueFoot'),
        { small: true, severity: queueCount ? 'high' : 'good' }),
      tile(T('mt.kDecisions'), U.fmtInt(Object.keys(decisions).length), T('mt.kDecisionsFoot'), { small: true }),
      tile(T('mt.kOwnerless'), U.fmtInt(ownerlessCount), T('mt.kOwnerlessFoot'), { small: true })
    );
    f.appendChild(k);

    f.appendChild(tabbed('matching', [
      { id: 'review', label: T('mt.tab.review'), count: queueCount || null,
        build: () => reviewTab(m, table) },
      { id: 'all', label: T('mt.tab.all'), count: table.length,
        build: () => allTab(m, table) },
      { id: 'decisions', label: T('mt.tab.decisions'), count: Object.keys(decisions).length || null,
        build: () => decisionsTab(m, table) }
    ], params));
    return f;
  }

  HR.views.matching = matchingView;
})(window.HR);
