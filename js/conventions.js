/* Naming-convention analysis over the reconciliation export.

   A tenant's account names and group names are written to conventions, and the
   conventions carry history: a system with two major username styles has usually been
   migrated, merged or re-policied at some point, and the minority style marks the
   accounts that predate the change. Group names tell the same story — a family scheme
   ("ORG-D-Care-Home-DL") with a suffix vocabulary, and next to it the strays that
   were made by hand before the scheme existed, or outside it.

   HelloID never looks at this: names are opaque keys to a provisioning engine. To a
   governance reader they are evidence. Nothing here is configured — both analyses
   derive the conventions from the data itself and report what dominates and what
   deviates, so they work on any tenant's scheme without being told what it is. */
(function (HR) {
  'use strict';

  const U = HR.util;

  /* -------------------------------------------------------------- usernames */
  /**
   * The structural signature of a name: letter case, digits and separators, with the
   * runs compressed. "AartsL" -> "AaA", "aartsj" -> "a", "jan.bos" -> "a.a",
   * "6120601-1" -> "9-9", "$HaakmeeM" -> "$AaA". Two names share a convention exactly
   * when they share a signature.
   */
  function signature(name) {
    const s = String(name || '').trim();
    if (!s) return '';
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9]/.test(c)) {
        while (i < s.length && /[0-9]/.test(s[i])) i++;
        out += '9';
      } else if (/[A-Z]/.test(c)) {
        /* A capital followed by lowercase is a word head; a run of capitals is a block. */
        if (/[a-z]/.test(s[i + 1] || '')) {
          i++;
          while (i < s.length && /[a-z]/.test(s[i])) i++;
          out += 'Aa';
        } else {
          while (i < s.length && /[A-Z]/.test(s[i])) i++;
          out += 'A';
        }
      } else if (/[a-z]/.test(c)) {
        while (i < s.length && /[a-z]/.test(s[i])) i++;
        out += 'a';
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  function usernames(model) {
    const bySystem = new Map();
    for (const a of model.accountList) {
      if (!bySystem.has(a.system)) bySystem.set(a.system, new Map());
      const styles = bySystem.get(a.system);
      const sig = signature(a.userName);
      if (!styles.has(sig)) {
        styles.set(sig, { sig, count: 0, enabled: 0, examples: [], classes: new Map(), accounts: [] });
      }
      const st = styles.get(sig);
      st.count++;
      if (a.enabled !== false) st.enabled++;
      if (st.examples.length < 6) st.examples.push(a.userName);
      st.classes.set(a.clsLabel, (st.classes.get(a.clsLabel) || 0) + 1);
      st.accounts.push(a);
    }

    const systems = [];
    bySystem.forEach((styles, system) => {
      const total = U.sum(Array.from(styles.values()), s => s.count);
      const list = Array.from(styles.values())
        .map(s => Object.assign(s, { share: total ? s.count / total : 0 }))
        .sort((a, b) => b.count - a.count);
      /* Two or more styles that each cover a real slice of the population is the
         migration signal; a long tail of one-offs is just service accounts. One in ten
         is already a cohort — a renamed policy leaves exactly that kind of remainder. */
      const major = list.filter(s => s.share >= 0.10);
      systems.push({
        system, total, styles: list, major,
        mixed: major.length > 1,
        tail: list.length - major.length
      });
    });
    systems.sort((a, b) => (b.mixed ? 1 : 0) - (a.mixed ? 1 : 0) || b.total - a.total);
    return {
      systems,
      summary: {
        systems: systems.length,
        mixed: systems.filter(s => s.mixed).length,
        styles: U.sum(systems, s => s.styles.length)
      }
    };
  }

  /* ----------------------------------------------------------- entitlements */
  const SEPS = ['-', '_', '.'];

  function dominantSep(name) {
    let best = null, bestN = 0;
    for (const sep of SEPS) {
      const n = name.split(sep).length - 1;
      if (n > bestN) { bestN = n; best = sep; }
    }
    return best;
  }

  function entitlements(model) {
    const bySystem = new Map();
    for (const p of model.permissionList) {
      if (!bySystem.has(p.system)) bySystem.set(p.system, []);
      bySystem.get(p.system).push(p);
    }

    const systems = [];
    bySystem.forEach((perms, system) => {
      /* Which separator does this system's scheme use at all? */
      const sepVotes = new Map();
      perms.forEach(p => {
        const sep = dominantSep(p.name);
        if (sep) sepVotes.set(sep, (sepVotes.get(sep) || 0) + 1);
      });
      const sep = Array.from(sepVotes.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || null;

      /* Families: the first segment, counted case-insensitively — "ORG-", "Org-" and
         "org-" are one scheme written three ways, and the minority casings are
         themselves a deviation worth naming. A prefix carried by five or more names
         is a scheme; everything else is a stray. */
      const families = new Map();
      const strays = [];
      perms.forEach(p => {
        const name = p.name;
        const parts = sep ? name.split(sep) : [name];
        const prefix = parts.length > 1 ? parts[0].trim() : null;
        if (!prefix || !/^[A-Za-z][A-Za-z0-9#]{0,11}$/.test(prefix)) { strays.push(p); return; }
        const key = prefix.toUpperCase();
        if (!families.has(key)) {
          families.set(key, { key, count: 0, perms: [], suffixes: new Map(), depths: new Map(),
            casings: new Map() });
        }
        const f = families.get(key);
        f.count++;
        f.perms.push(p);
        f.casings.set(prefix, (f.casings.get(prefix) || 0) + 1);
        f.depths.set(parts.length, (f.depths.get(parts.length) || 0) + 1);
        const last = parts[parts.length - 1].trim();
        /* A short trailing token that recurs is a type suffix (DL, DG, RO, RW…). */
        if (parts.length > 2 && last.length <= 4 && /^[A-Za-z0-9]+$/.test(last)) {
          f.suffixes.set(last.toUpperCase(), (f.suffixes.get(last.toUpperCase()) || 0) + 1);
        }
      });

      /* Prefixes too small to be a scheme fall back into the stray list. The family
         shows its dominant casing, and how many names are written differently. */
      const familyList = [];
      families.forEach(f => {
        if (f.count < 5) { strays.push(...f.perms); return; }
        const casings = Array.from(f.casings.entries()).sort((a, b) => b[1] - a[1]);
        f.prefix = casings[0][0];
        f.offCase = U.sum(casings.slice(1), c => c[1]);
        familyList.push(f);
      });
      familyList.sort((a, b) => b.count - a.count);

      const total = perms.length;
      const inFamilies = U.sum(familyList, f => f.count);

      /* The suffix vocabulary of the whole system: recurring type markers. */
      const suffixVocab = new Map();
      familyList.forEach(f => f.suffixes.forEach((n, sfx) => {
        if (!suffixVocab.has(sfx)) suffixVocab.set(sfx, { suffix: sfx, count: 0, families: 0 });
        const v = suffixVocab.get(sfx);
        v.count += n;
        v.families++;
      }));
      const vocab = Array.from(suffixVocab.values())
        .filter(v => v.count >= 5)
        .sort((a, b) => b.count - a.count);

      /* Near-family strays first: a stray that contains a family prefix, or spaces, or
         a leading #, is more interesting than a builtin nobody typed. */
      const famPrefixes = familyList.map(f => f.prefix.toLowerCase());
      const why = p => {
        const n = p.name.toLowerCase();
        if (famPrefixes.some(fp => n.startsWith(fp))) return 'nearFamily';
        if (/^[#$]/.test(p.name)) return 'marker';
        if (/\s/.test(p.name) && sep) return 'spaces';
        return 'outside';
      };
      const WHY_ORDER = { nearFamily: 0, marker: 1, spaces: 2, outside: 3 };
      const strayRows = strays.map(p => ({ perm: p, why: why(p) }))
        .sort((a, b) => WHY_ORDER[a.why] - WHY_ORDER[b.why] || b.perm.holderCount - a.perm.holderCount);

      systems.push({
        system, sep, total,
        families: familyList,
        familyShare: total ? inFamilies / total : 0,
        offCase: U.sum(familyList, f => f.offCase),
        vocab,
        strays: strayRows
      });
    });
    systems.sort((a, b) => b.total - a.total);
    return {
      systems,
      summary: {
        systems: systems.length,
        families: U.sum(systems, s => s.families.length),
        strays: U.sum(systems, s => s.strays.length),
        offCase: U.sum(systems, s => s.offCase)
      }
    };
  }

  /* ------------------------------------------------------------- attributes */
  /* What the paperwork says about people, and whether it can carry provisioning
     rules. Two questions per attribute: is it filled and disciplined enough to
     condition on, and which groups does a value predict — the evidence a HelloID
     business rule or connector mapping is designed from. Works on a real vault
     and on the one synthesized from a directory export alike. */
  const MIN_VALUE_PERSONS = 5;   // a value carried by fewer people cannot carry a rule
  const MIN_SHARE = 0.8;         // the share of a value's people that must hold the group

  function attributes(model) {
    const vault = model.vault;
    if (!vault) return null;
    const persons = vault.persons;

    /* Attribute extractors: the standard contract fields, then every custom key
       seen on a contract (extensionAttributes, OU) or on a person. */
    const fields = [];
    const std = [
      ['type', p => p.primaryContract && p.primaryContract.type.name],
      ['department', p => p.primaryContract && p.primaryContract.department.name],
      ['title', p => p.primaryContract && p.primaryContract.title.name],
      ['location', p => p.primaryContract && p.primaryContract.location.name],
      ['employer', p => p.primaryContract && p.primaryContract.employer.name],
      ['costCenter', p => p.primaryContract && p.primaryContract.costCenter.name]
    ];
    for (const [key, get] of std) fields.push({ key, custom: false, get });
    const customKeys = new Set();
    for (const p of persons) {
      Object.keys(p.custom || {}).forEach(k => customKeys.add('p:' + k));
      for (const c of p.contracts) Object.keys(c.custom || {}).forEach(k => customKeys.add('c:' + k));
    }
    for (const ck of Array.from(customKeys).sort()) {
      const [scope, key] = [ck.slice(0, 1), ck.slice(2)];
      fields.push({
        key, custom: true,
        get: scope === 'p'
          ? p => (p.custom || {})[key]
          : p => { for (const c of p.contracts) { if ((c.custom || {})[key]) return c.custom[key]; } return ''; }
      });
    }

    /* Person -> held groups, through the correlation the model already computed. */
    let personGroups = null, indexed = 0;
    const groupHolders = new Map();
    if (model.hasRecon && model.correlation) {
      const index = HR.correlate.personAccountIndex(model, vault, model.correlation);
      personGroups = new Map();
      for (const entry of index.values()) {
        const set = new Set();
        entry.accounts.forEach(a => a.perms.forEach(p => set.add(p.name)));
        personGroups.set(entry.person, set);
        set.forEach(g => groupHolders.set(g, (groupHolders.get(g) || 0) + 1));
      }
      indexed = personGroups.size;
    }

    const out = [];
    const candidates = [];
    for (const f of fields) {
      const values = new Map();
      let filled = 0;
      for (const p of persons) {
        const v = String(f.get(p) || '').trim();
        if (!v) continue;
        filled++;
        if (!values.has(v)) values.set(v, []);
        values.get(v).push(p);
      }
      if (!filled) continue;                         // an empty attribute has nothing to say
      const top = Array.from(values.entries())
        .map(([value, list]) => ({ value, n: list.length }))
        .sort((a, b) => b.n - a.n);
      out.push({
        key: f.key, custom: f.custom,
        fill: filled, fillPct: persons.length ? filled / persons.length : 0,
        distinct: values.size, top, values
      });

      if (!personGroups) continue;
      for (const [value, list] of values) {
        const held = list.filter(p => personGroups.has(p));
        if (held.length < MIN_VALUE_PERSONS) continue;
        const counts = new Map();
        held.forEach(p => personGroups.get(p).forEach(g => counts.set(g, (counts.get(g) || 0) + 1)));
        for (const [group, n] of counts) {
          if (n < MIN_VALUE_PERSONS) continue;
          const share = n / held.length;
          if (share < MIN_SHARE) continue;
          const baseline = indexed ? (groupHolders.get(group) || 0) / indexed : 0;
          /* A group everyone holds predicts nothing; the lift filter drops the
             baseline groups without needing a hand-tuned ignore list. */
          const lift = baseline > 0 ? share / baseline : 0;
          if (lift < 1.5) continue;
          candidates.push({ attribute: f.key, custom: f.custom, value, group, n, m: held.length, share, lift });
        }
      }
    }
    candidates.sort((a, b) => b.share * b.n - a.share * a.n || b.lift - a.lift);

    return {
      fields: out,
      candidates,
      summary: {
        attributes: out.length,
        usable: out.filter(f => f.fillPct >= 0.5 && f.distinct > 1).length,
        candidates: candidates.length,
        persons: persons.length,
        indexed
      }
    };
  }

  /* -------------------------------------------------------- name generation */
  /* The HelloID connector intake asks how usernames, mail addresses and display
     names must be generated. The existing accounts already answer it: derive the
     candidate formats from each user's own givenName and surname — Dutch
     tussenvoegsels handled in the three ways conventions actually use them —
     and count which format explains each field. Iteration suffixes (janine2)
     are recognised and reported, not counted as exceptions. */
  const PARTICLES = new Set(['van', 'de', 'der', 'den', 'ten', 'ter', 'te', 'het',
    'in', "'t", 'op', 'aan', 'bij', 'tot', 'uit', 'la', 'le', 'el', 'von']);

  const alnum = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function nameParts(u) {
    const gRaw = String(u.givenName || '').trim();
    const sRaw = String(u.surname || '').trim();
    if (!gRaw || !sRaw) return null;
    const g = alnum(gRaw.split(/\s+/)[0]);
    const words = sRaw.toLowerCase().split(/\s+/);
    let i = 0;
    while (i < words.length - 1 && PARTICLES.has(words[i])) i++;
    const particles = words.slice(0, i), bare = words.slice(i);
    if (!g || !bare.length) return null;
    return {
      gRaw, sRaw,
      first: g,
      f: g[0],
      last: alnum(words.join('')),                                   // vandenboele
      bare: alnum(bare.join('')),                                    // boele
      vd: particles.map(w => w[0]).join('') + alnum(bare.join(''))   // vdboele
    };
  }

  /* Recipes ordered so that, when particles are absent and `last` equals `bare`,
     the user counts toward the fuller reading once, not twice. */
  const NG_SEPS = ['.', '', '-', '_'];
  const NG_RECIPES = [
    ['first', 'last'], ['first', 'bare'], ['first', 'vd'],
    ['f', 'last'], ['f', 'bare'], ['f', 'vd'],
    ['last', 'f'], ['bare', 'f'],
    ['first'], ['last'], ['bare']
  ];

  function candidatesFor(p) {
    const seen = new Map();      // candidate string -> format id (first recipe wins)
    for (const recipe of NG_RECIPES) {
      for (const sep of NG_SEPS) {
        if (recipe.length === 1 && sep !== '.') continue;   // single tokens need no separator variants
        const cand = recipe.map(t => p[t]).join(sep);
        if (cand.length < 2) continue;
        const id = recipe.join(sep === '' ? '+' : sep);   // "first.last", "f+bare"
        if (!seen.has(cand)) seen.set(cand, id);
      }
    }
    return seen;
  }

  function mineField(users, getter) {
    const counts = new Map();
    let total = 0, matched = 0, iterated = 0, maxIter = 0;
    for (const u of users) {
      const p = u._ngParts;
      const raw = String(getter(u) || '').trim().toLowerCase();
      if (!p || !raw) continue;
      total++;
      const m = raw.match(/^(.*?)(\d+)$/);
      const base = m ? m[1] : raw;
      const fmt = u._ngCands.get(base) || u._ngCands.get(raw);
      if (!fmt) continue;
      matched++;
      if (m && u._ngCands.get(base)) { iterated++; maxIter = Math.max(maxIter, parseInt(m[2], 10)); }
      counts.set(fmt, (counts.get(fmt) || 0) + 1);
    }
    if (total < 5) return null;
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, n, pct: n / total }));
    return { total, matched, exceptions: total - matched, iterated, maxIter,
      best: ranked[0] || null, ranked: ranked.slice(0, 3) };
  }

  function namegen(users) {
    const withParts = [];
    for (const u of users) {
      const p = nameParts(u);
      if (!p) continue;
      u._ngParts = p;
      u._ngCands = candidatesFor(p);
      withParts.push(u);
    }
    if (withParts.length < 5) return null;

    const localOf = v => String(v || '').split('@')[0];
    const domainOf = v => (String(v || '').split('@')[1] || '').toLowerCase();

    const fields = [
      { key: 'upn', res: mineField(withParts, u => localOf(u.upn)) },
      { key: 'mail', res: mineField(withParts, u => localOf(u.mail)) },
      { key: 'mailNickname', res: mineField(withParts, u => u.mailNickname) },
      { key: 'sam', res: mineField(withParts.filter(u => u.userName && u.userName !== u.upn),
          u => u.userName) }
    ].filter(f => f.res);

    /* Display name is format-mined on the raw words rather than the compressed ones. */
    const dnCounts = new Map();
    let dnTotal = 0, dnMatched = 0;
    for (const u of withParts) {
      const dn = String(u.displayName || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!dn) continue;
      dnTotal++;
      const p = u._ngParts;
      const g = p.gRaw.split(/\s+/)[0].toLowerCase();
      const s = p.sRaw.toLowerCase().replace(/\s+/g, ' ');
      /* Insert-if-absent: when the given name is a single word, "first last" and
         "givennames last" collapse to the same string and the fuller reading must
         not steal the count from the plainer one. */
      const cands = new Map();
      const put = (k, v) => { if (!cands.has(k)) cands.set(k, v); };
      put(g + ' ' + s, 'first last');
      put(s + ', ' + g, 'last, first');
      put(p.gRaw.toLowerCase() + ' ' + s, 'givennames last');
      put(g + ' ' + p.bare, 'first bare');
      const fmt = cands.get(dn);
      if (fmt) { dnMatched++; dnCounts.set(fmt, (dnCounts.get(fmt) || 0) + 1); }
    }
    const dnRanked = Array.from(dnCounts.entries()).sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, n, pct: dnTotal ? n / dnTotal : 0 }));

    /* The intake's yes/no facts, counted rather than asked. */
    const withMail = users.filter(u => u.mail && u.upn);
    const upnEqMail = withMail.filter(u => u.mail.toLowerCase() === u.upn.toLowerCase()).length;
    const upnDomains = U.counts(users.filter(u => u.upn), u => domainOf(u.upn));
    const mailDomains = U.counts(users.filter(u => u.mail), u => domainOf(u.mail));
    const withProxies = users.filter(u => (u.proxyAddresses || []).length);
    const aliasDomains = new Map();
    let primaryEqMail = 0;
    for (const u of withProxies) {
      const primary = (u.proxyAddresses || []).find(a => a.startsWith('SMTP:'));
      if (primary && u.mail && primary.slice(5).toLowerCase() === u.mail.toLowerCase()) primaryEqMail++;
      for (const a of (u.proxyAddresses || [])) {
        const d = domainOf(a.replace(/^smtp:/i, ''));
        if (d) aliasDomains.set(d, (aliasDomains.get(d) || 0) + 1);
      }
    }
    const managerFill = users.filter(u => u.managerId).length;
    const usage = U.counts(users.filter(u => u.usageLocation), u => u.usageLocation);
    const synced = users.filter(u => u.synced).length;

    return {
      parts: withParts.length, users: users.length,
      fields, displayName: { total: dnTotal, matched: dnMatched, ranked: dnRanked.slice(0, 3) },
      upnEqMail: { n: upnEqMail, m: withMail.length },
      upnDomains: Array.from(upnDomains.entries()).sort((a, b) => b[1] - a[1]),
      mailDomains: Array.from(mailDomains.entries()).sort((a, b) => b[1] - a[1]),
      proxies: { users: withProxies.length, primaryEqMail, aliasDomains:
        Array.from(aliasDomains.entries()).sort((a, b) => b[1] - a[1]) },
      managerFill: { n: managerFill, m: users.length },
      usage: Array.from(usage.entries()).sort((a, b) => b[1] - a[1]),
      synced
    };
  }

  function build(model) {
    return { usernames: usernames(model), entitlements: entitlements(model),
      attributes: attributes(model) };
  }

  HR.conventions = { build, signature, namegen };
})(window.HR);
