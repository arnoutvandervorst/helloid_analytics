/* Service Automation: products and who holds them.

   The reconciliation export shows an entitlement sitting on an account and cannot say
   how it got there. One of the answers HelloID knows but never puts in that export is
   "somebody requested it and somebody approved it" — Service Automation. These two files
   carry that, written by helloid-export.py:

     product-assignments.csv   one row per assignment: user, product, requested, approved,
                               by whom, with what comment, returned or not
     products.json             the products themselves: price, risk factor, time limit,
                               whether ownership returns when a user is disabled, and
                               (where a tenant configures them) the tasks a product runs

   The link from a product to the group it actually grants lives in those tasks. Where a
   tenant has none — and that is common — this file says so rather than inferring one:
   an unproven link between a product and an entitlement would put a wrong explanation on
   a real finding, which is worse than leaving it unexplained. */
(function (HR) {
  'use strict';

  const U = HR.util;

  /* Keys join free-text fields; a missing separator makes distinct pairs collide. */
  const SEP = '\u001f';

  const ASSIGNMENT_HEADERS = ['assignmentguid', 'username', 'productname'];
  const normHeader = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

  function looksLikeAssignments(header) {
    const cols = header.map(normHeader);
    return ASSIGNMENT_HEADERS.every(h => cols.includes(h));
  }

  function looksLikeProducts(data) {
    return !!data && typeof data === 'object' &&
      (data.kind === 'helloid-products' || Array.isArray(data.products));
  }
  /* One Service Automation file: the catalogue and the assignments together — either half may be empty. */
  const looksLikeServiceAutomation = data => !!data && data.kind === 'helloid-service-automation';

  /** ISO with or without fractional seconds; HelloID writes both. */
  function parseDate(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** "540,00" — the tenant's own decimal separator, not necessarily this browser's. */
  function parsePrice(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return null;
    const cleaned = s.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  /* ------------------------------------------------------------------ products */
  function parseProducts(text, fileName) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Product export is not valid JSON: ' + e.message); }
    if (!looksLikeProducts(data)) {
      throw new Error('Not a HelloID product export — expected an object with a products array.');
    }

    const rows = (data.products || []).map((p, i) => {
      const actions = p.actions || [];
      return {
        i,
        id: String(p.productId || p.selfServiceProductGUID || ''),
        name: String(p.name || '').trim(),
        description: String(p.description || '').trim(),
        sku: String(p.code || ''),
        /* Categories often come back as bare GUID references. A GUID is not a name and
           printing one helps nobody, so it is dropped rather than displayed. */
        categories: (p.categories || [])
          .map(c => (typeof c === 'string' ? c : (c.name || '')))
          .filter(name => name && !GUID.test(name)),
        price: parsePrice(p.price),
        showPrice: !!p.showPrice,
        riskFactor: p.hasRiskFactor ? (p.riskFactor || null) : null,
        hasTimeLimit: !!p.hasTimeLimit,
        /* The export states a number and not its unit. Every time-limited product in the
           tenants seen so far carries a whole number of days expressed in minutes
           (7,200 = 5 days; 864,000 = 600), so it is read that way — but only when the
           value divides evenly, and the raw figure is kept and shown alongside so a
           tenant that means something else is visible rather than silently rescaled. */
        ownershipMinutes: p.ownershipMaxDurationInMinutes != null
          ? +p.ownershipMaxDurationInMinutes
          : (p.ownershipMaxDuration == null ? null : +p.ownershipMaxDuration),
        ownershipDays: durationDays(p),
        returnOnUserDisable: !!p.returnOnUserDisable,
        visibility: String(p.visibility || ''),
        approvalWorkflow: refName(p.approvalWorkflow),
        resourceOwner: refName(p.resourceOwnerGroup) || String(p.managedByGroupName || ''),
        accessGroups: (p.accessGroups || []).map(g => g.name || g.id).filter(Boolean),
        enabled: p.isEnabled !== false,
        actions: actions.map(a => ({
          name: String(a.name || ''),
          executionType: String(a.executionType || ''),
          executionEntry: String(a.executionEntry || ''),
          variables: a.variables || []
        }))
      };
    });

    const withActions = rows.filter(p => p.actions.length).length;
    const health = {
      products: rows.length,
      noName: rows.filter(p => !p.name).length,
      /* A stated price that did not parse is money silently missing from every total. */
      badPrices: (data.products || []).filter((p, i) =>
        p.price != null && String(p.price).trim() !== '' && rows[i].price == null).length,
      /* A time limit that is not a whole number of days is shown raw, not rescaled. */
      oddDurations: rows.filter(p => p.hasTimeLimit && p.ownershipMinutes != null && p.ownershipDays == null).length
    };
    return {
      kind: 'products',
      rows,
      byName: new Map(rows.map(p => [p.name.toLowerCase(), p])),
      byId: new Map(rows.map(p => [p.id, p])),
      empty: rows.length === 0,
      meta: {
        fileName: fileName || 'products.json',
        tenant: String(data.tenant || ''),
        rowCount: rows.length,
        withActions,
        priced: rows.filter(p => p.price != null).length,
        timeLimited: rows.filter(p => p.hasTimeLimit).length,
        health,
        fingerprint: U.hash(text.length + '|' + rows.length + '|' + text.slice(0, 4096))
      }
    };
  }

  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function durationDays(p) {
    const raw = p.ownershipMaxDurationInMinutes != null
      ? +p.ownershipMaxDurationInMinutes
      : (p.ownershipMaxDuration == null ? null : +p.ownershipMaxDuration);
    if (raw == null || isNaN(raw) || raw <= 0) return null;
    return raw % 1440 === 0 ? raw / 1440 : null;
  }

  const refName = o => (o && typeof o === 'object') ? String(o.name || '') : String(o || '');

  /* --------------------------------------------------------------- assignments */
  function parseAssignments(text, fileName) {
    const delim = HR.parse.sniffDelim(text);
    const grid = HR.parse.parseDelimited(text, delim)
      .filter(r => r.length && !(r.length === 1 && r[0].trim() === ''));
    if (!grid.length) throw new Error('Assignment export is empty.');

    const header = grid[0].map(h => h.trim());
    if (!looksLikeAssignments(header)) {
      throw new Error('Not a product-assignment export. Found: ' + header.join(', '));
    }
    const col = {};
    header.forEach((h, i) => { col[normHeader(h)] = i; });
    const get = (row, key) => col[key] == null ? '' : (row[col[key]] || '').trim();

    const rows = [];
    let skipped = 0, shortRows = 0, badDates = 0;
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      if (r.length < header.length) shortRows++;
      const userName = get(r, 'username');
      const productName = get(r, 'productname');
      if (!userName && !productName) { skipped++; continue; }
      const approvedBy = get(r, 'approvedby');
      const dated = (key) => {
        const raw = get(r, key);
        const d = parseDate(raw);
        if (raw && !d) badDates++;
        return d;
      };
      rows.push({
        i: rows.length,
        id: get(r, 'assignmentguid'),
        userName,
        userGuid: get(r, 'userguid'),
        productName,
        productId: get(r, 'productguid'),
        sku: get(r, 'productsku'),
        requestedAt: dated('requestedat'),
        approvedAt: dated('approvedat'),
        returnDate: dated('returndate'),
        source: get(r, 'source'),
        approvedBy,
        approvalComment: get(r, 'approvalcomment'),
        /* Nobody else stood between the request and the grant. */
        selfApproved: !!approvedBy && approvedBy.toLowerCase() === userName.toLowerCase()
      });
    }

    const open = rows.filter(a => !a.returnDate);
    return {
      kind: 'assignments',
      rows,
      open,
      byUser: U.by(rows, a => a.userName.toLowerCase()),
      byProduct: U.by(rows, a => a.productName.toLowerCase()),
      empty: rows.length === 0,
      meta: {
        fileName: fileName || 'product-assignments.csv',
        rowCount: rows.length,
        openCount: open.length,
        users: new Set(rows.map(a => a.userName.toLowerCase())).size,
        products: new Set(rows.map(a => a.productName.toLowerCase())).size,
        returned: rows.length - open.length,
        selfApproved: rows.filter(a => a.selfApproved).length,
        unrecorded: rows.filter(a => !a.approvedBy).length,
        from: rows.reduce((min, a) => (a.requestedAt && (!min || a.requestedAt < min)) ? a.requestedAt : min, null),
        to: rows.reduce((max, a) => (a.requestedAt && (!max || a.requestedAt > max)) ? a.requestedAt : max, null),
        health: { dataRows: grid.length - 1, kept: rows.length, skippedEmpty: skipped, shortRows, badDates },
        fingerprint: U.hash(text.length + '|' + rows.length + '|' + text.slice(0, 4096))
      }
    };
  }

  /**
   * Who is the person behind a HelloID user name?
   *
   * The assignment export keys on the HelloID login ("kaho.m@enyoi.org"); everything else
   * this tool holds keys on the person as the reconciliation writes them ("Kevin de Zwaan
   * (500038)"). Joining the two on a naming convention would be inventing a rule the data
   * does not state, so evidence is required: an account HelloID itself correlated, or an
   * exact name, or the scored matching the rest of the tool already uses.
   */
  function linkHolders(assignments, model, vault, correlation) {
    const byUser = new Map();          // lowercased user name -> {person, account, how}
    if (!assignments) return { byUser, stats: { linked: 0, unlinked: 0, layers: {} } };

    const layers = { vaultAccount: 0, personName: 0, accountName: 0, scored: 0 };

    /* Layer 1 — the vault already says which accounts belong to whom. */
    const vaultIndex = vault ? HR.vault.accountIndex(vault) : null;

    /* Layer 2 — the person's own display name, exactly. */
    const personByName = new Map();
    if (vault) vault.persons.forEach(p => personByName.set(p.displayName.toLowerCase(), p));
    if (model) model.persons.forEach(p => {
      personByName.set(String(p.key).toLowerCase(), p);
      if (p.name) personByName.set(String(p.name).toLowerCase(), p);
    });

    /* Layer 3 — an account with that user name exists in the reconciliation. */
    const accountByUser = new Map();
    if (model) model.accountList.forEach(a => accountByUser.set(String(a.userName).toLowerCase(), a));

    for (const key of assignments.byUser.keys()) {
      const local = key.split('@')[0];
      let hit = null;

      if (vaultIndex && (vaultIndex.get(key) || vaultIndex.get(local))) {
        const v = vaultIndex.get(key) || vaultIndex.get(local);
        hit = { person: v.person, account: null, how: 'vault-account' };
        layers.vaultAccount++;
      } else if (personByName.has(key) || personByName.has(local)) {
        hit = { person: personByName.get(key) || personByName.get(local), account: null, how: 'person-name' };
        layers.personName++;
      } else if (accountByUser.has(key) || accountByUser.has(local)) {
        const acc = accountByUser.get(key) || accountByUser.get(local);
        /* The account is certain; the person behind it may already be known from the
           correlation pass, and without that link nothing can be said about whether
           the holder still works here. */
        const owner = correlation && correlation.matches
          ? (correlation.matches.find(x => x.account.key === acc.key) || null) : null;
        hit = { person: owner ? owner.person : null, account: acc, how: 'account-name' };
        layers.accountName++;
      } else if (correlation && correlation.matches) {
        /* The scored matcher already decided which person owns which account; if one of
           those accounts is named like this HelloID user, the same evidence carries. */
        const scored = correlation.matches.find(m =>
          String(m.account.userName).toLowerCase() === local ||
          String(m.account.userName).toLowerCase() === key);
        if (scored) {
          hit = { person: scored.person, account: scored.account, how: 'scored-name' };
          layers.scored++;
        }
      }

      if (hit) byUser.set(key, hit);
    }

    return {
      byUser,
      stats: {
        linked: byUser.size,
        unlinked: assignments.byUser.size - byUser.size,
        users: assignments.byUser.size,
        layers
      }
    };
  }

  /**
   * Which entitlement does a product correspond to?
   *
   * The honest answer is that HelloID does not record one. The link lives in whatever a
   * product's tasks do, and reading group names out of PowerShell bodies is guesswork
   * dressed up as evidence. What is left is the thing administrators actually rely on:
   * a product called "Ultimo" and a group called "GG_APP_Ultimo_Users" are named after
   * the same thing by the same people.
   *
   * So names propose and membership decides. A name match on its own is a candidate and
   * is labelled as one. When the people holding the product are also the people holding
   * the group, that is evidence about the world rather than about spelling, and it is
   * what raises a candidate to something worth acting on. Where the two exports describe
   * different populations — different tenants, different periods — no overlap can exist,
   * and that is reported instead of quietly producing name matches nobody should trust.
   */

  /* Prefixes and suffixes that carry no meaning for the comparison: naming conventions,
     not names. Kept short deliberately — every entry here is a claim about a tenant's
     conventions, and a wrong one silently improves scores. */
  const GROUP_NOISE = /^(gg|sg|dl|ag|grp|group|role|app|sec|fs|m365|azure|ad|helloid)[_-]|[_-](r|rw|ro|l|w|m|users?|members?|leden|lezen|schrijven|full|modify|read|write)$/gi;

  function tokens(text) {
    let s = String(text || '').toLowerCase();
    s = s.replace(/\(.*?\)/g, ' ');                    // "(avo.local/OU/X)" is a path, not a name
    let prev;
    do { prev = s; s = s.replace(GROUP_NOISE, ''); } while (s !== prev);
    return U.uniq(s.split(/[^a-z0-9]+/).filter(t => t.length > 2 && !/^\d+$/.test(t)));
  }

  /** Jaccard over tokens, with a bonus when one name is wholly contained in the other. */
  function nameScore(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    const setB = new Set(bTokens);
    const shared = aTokens.filter(t => setB.has(t));
    if (!shared.length) return 0;
    const union = new Set(aTokens.concat(bTokens)).size;
    const jaccard = shared.length / union;
    const contained = shared.length === Math.min(aTokens.length, bTokens.length);
    return Math.min(1, jaccard + (contained ? 0.25 : 0));
  }

  function matchProducts(products, assignments, model, holders, granted, opts) {
    opts = Object.assign({ minName: 0.5, minOverlap: 0.5, topN: 3 }, opts || {});
    if (!products || !model) return null;

    /* ---- who holds each product, expressed the way the model names people ---- */
    const productHolderKeys = new Map();          // product name -> Set(person key)
    if (assignments && holders) {
      for (const a of assignments.open) {
        const link = holders.byUser.get(a.userName.toLowerCase());
        if (!link) continue;
        const key = personKeyOf(link);
        if (!key) continue;
        if (!productHolderKeys.has(a.productName)) productHolderKeys.set(a.productName, new Set());
        productHolderKeys.get(a.productName).add(key);
      }
    }

    /* ---- who holds each entitlement, from the reconciliation and from HelloID ---- */
    const permHolderKeys = new Map();             // permission key -> Set(person key)
    for (const p of model.permissionList) {
      const set = new Set();
      for (const accKey of p.holders) {
        const acc = model.accounts.get(accKey);
        if (acc && acc.personRaw) set.add(acc.personRaw);
      }
      permHolderKeys.set(p.key, set);
    }
    if (granted && !granted.empty) {
      for (const r of granted.rows) {
        const key = HR.model.permissionKey(r.system, r.entitlement);
        if (!permHolderKeys.has(key)) permHolderKeys.set(key, new Set());
        permHolderKeys.get(key).add(r.personRaw);
      }
    }

    /* ---- do the two exports even describe the same people? ---- */
    const productPeople = new Set();
    productHolderKeys.forEach(set => set.forEach(k => productPeople.add(k)));
    const modelPeople = new Set(model.accountList.map(a => a.personRaw).filter(Boolean));
    const sharedPeople = Array.from(productPeople).filter(k => modelPeople.has(k));
    const population = {
      productPeople: productPeople.size,
      modelPeople: modelPeople.size,
      shared: sharedPeople.length,
      comparable: sharedPeople.length >= 5
    };

    /* ---- name candidates ---- */
    const permTokens = model.permissionList.map(p => ({ perm: p, t: tokens(p.name) }));
    const candidates = [];
    for (const product of products.rows) {
      const pt = tokens(product.name);
      if (!pt.length) continue;
      const scored = [];
      for (const entry of permTokens) {
        const score = nameScore(pt, entry.t);
        if (score >= opts.minName) {
          const holdersOfProduct = productHolderKeys.get(product.name) || new Set();
          const holdersOfPerm = permHolderKeys.get(entry.perm.key) || new Set();
          let overlap = null;
          if (population.comparable && holdersOfProduct.size && holdersOfPerm.size) {
            const shared = Array.from(holdersOfProduct).filter(k => holdersOfPerm.has(k)).length;
            overlap = shared / new Set([...holdersOfProduct, ...holdersOfPerm]).size;
          }
          scored.push({
            product, perm: entry.perm, nameScore: score, overlap,
            shared: pt.filter(t => entry.t.includes(t)),
            /* Names alone never rise above "candidate"; only the people do. */
            verdict: overlap == null ? 'candidate'
              : (overlap >= opts.minOverlap ? 'corroborated' : 'contradicted')
          });
        }
      }
      scored.sort((a, b) => (b.overlap || 0) - (a.overlap || 0) || b.nameScore - a.nameScore);
      candidates.push.apply(candidates, scored.slice(0, opts.topN));
    }

    const corroborated = candidates.filter(c => c.verdict === 'corroborated');
    return {
      candidates,
      corroborated,
      byProduct: U.by(candidates, c => c.product.name.toLowerCase()),
      population,
      /* Why a run found nothing, stated rather than left to be inferred from an empty table. */
      reasons: U.uniq([
        products.meta.withActions ? null : 'no-tasks',
        population.comparable ? null : 'different-population',
        candidates.length ? null : 'no-name-matches'
      ].filter(Boolean)),
      summary: {
        products: products.rows.length,
        withCandidate: new Set(candidates.map(c => c.product.name)).size,
        candidates: candidates.length,
        corroborated: corroborated.length,
        contradicted: candidates.filter(c => c.verdict === 'contradicted').length
      }
    };
  }

  /**
   * The confirmed map, applied: which people hold which entitlement *through a product*.
   *
   * This is the only link this tool will assert, because it is the only one a human
   * signed off on. A proposal from name similarity stays a proposal until it is in here.
   */
  /* A person here can come from the vault (displayName) or from the reconciliation
     (key), and both are the string the recon rows carry. */
  const personKeyOf = link => !link ? null
    : (link.person ? (link.person.displayName || link.person.key || null)
      : (link.account ? link.account.personRaw : null));

  function applyMapping(model, assignments, holders, mapping) {
    const byPermPerson = new Map();     // permission key + person -> {product, assignment}
    const mapped = [];
    if (!assignments || !mapping) return { byPermPerson, mapped, products: 0, entries: 0 };

    let entries = 0;
    for (const productName of Object.keys(mapping)) {
      const targets = mapping[productName] || [];
      entries += targets.length;
      const list = assignments.byProduct.get(productName.toLowerCase()) || [];
      for (const a of list) {
        if (a.returnDate) continue;
        const link = holders && holders.byUser.get(a.userName.toLowerCase());
        const personKey = personKeyOf(link);
        if (!personKey) continue;
        for (const t of targets) {
          const permKey = HR.model.permissionKey(t.system || '', t.permission || '');
          byPermPerson.set(personKey + SEP + permKey, { product: productName, assignment: a });
          mapped.push({ personKey, permKey, product: productName, assignment: a });
        }
      }
    }
    return {
      byPermPerson, mapped,
      products: Object.keys(mapping).length,
      entries,
      /** What a reconciliation row can ask: was this handed out through a product? */
      lookup: (personRaw, permKey) => byPermPerson.get(personRaw + SEP + permKey) || null
    };
  }

  HR.products = {
    parseProducts, parseAssignments, looksLikeProducts, looksLikeAssignments, looksLikeServiceAutomation,
    linkHolders, matchProducts, applyMapping, parsePrice, tokens, nameScore
  };
})(window.HR);
