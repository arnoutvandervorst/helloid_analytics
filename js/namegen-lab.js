/* Name-generation workbench engine: author the naming convention the HelloID
   connector intake asks for, then watch it play out over the real population.

   The intake's Naamgeneratie section wants, per generated field (last name,
   display name, mail, proxyAddresses, UPN, mailNickname): a first-choice
   recipe, fallback recipes for when the name is taken, and whether iterations
   are synchronised across fields. Customers cannot picture how that behaves at
   scale — this engine simulates it: vault persons supply the name parts, the
   directory import supplies the names already occupied, and the output is the
   per-person result plus the collisions, iteration depths and limit
   violations the intake could never show.

   Templates are token strings ({roepnaam}.{tv}{geboortenaam}@{domein});
   variants[0] is the first choice, each further variant one iteration step,
   and a {i} counter in the last variant carries the steps beyond it. */
(function () {
  'use strict';

  const FIELDS = [
    { key: 'lastName', unique: false, kind: 'text', limit: 64 },
    { key: 'displayName', unique: false, kind: 'text', limit: 256 },
    { key: 'mail', unique: true, kind: 'address', limit: 64, space: 'smtp' },
    { key: 'proxyAddresses', unique: true, kind: 'address', limit: 64, space: 'smtp' },
    { key: 'upn', unique: true, kind: 'address', limit: 64, space: 'upn' },
    { key: 'mailNickname', unique: true, kind: 'nickname', limit: 64, space: 'nickname' }
  ];

  /* The intake document's own worked example ("Janine"): rendering her for all
     four name preferences reproduces the tables the customer fills in. */
  const EXAMPLE_PERSON = {
    displayName: 'Janine van den Boele',
    externalId: '001234',
    name: {
      GivenName: 'Hendrika Cornelia', NickName: 'Janine', Initials: 'H.C.',
      FamilyNamePrefix: 'van den', FamilyName: 'Boele',
      FamilyNamePartnerPrefix: 'de', FamilyNamePartner: 'Vries',
      Convention: 'B'
    }
  };

  function defaults() {
    return {
      domain: 'domein.nl',
      upnDomain: '',
      syncIterations: true,
      fields: {
        lastName: { variants: ['{tussen} {geboortenaam}'] },
        displayName: { variants: ['{roepnaam} {tussen} {geboortenaam}'] },
        mail: { variants: [
          '{roepnaam}.{tv}{geboortenaam}@{domein}',
          '{voorletter}.{tv}{geboortenaam}@{domein}',
          '{voorletter}{i}.{tv}{geboortenaam}@{domein}'
        ] },
        proxyAddresses: { variants: [
          '{roepnaam}.{tv}{geboortenaam}@{domein}',
          '{voorletter}.{tv}{geboortenaam}@{domein}',
          '{voorletter}{i}.{tv}{geboortenaam}@{domein}'
        ] },
        upn: { variants: [
          '{roepnaam}.{tv}{geboortenaam}@{domein}',
          '{voorletter}.{tv}{geboortenaam}@{domein}',
          '{voorletter}{i}.{tv}{geboortenaam}@{domein}'
        ] },
        mailNickname: { variants: [
          '{roepnaam}{tv}{geboortenaam}',
          '{voorletter}{tv}{geboortenaam}',
          '{voorletter}{i}{tv}{geboortenaam}'
        ] }
      }
    };
  }

  /* ---- name parts ---------------------------------------------------------- */

  const compact = s => (s || '').toLowerCase().replace(/[\s.-]+/g, '');

  function parts(person) {
    const n = person.name || {};
    const given = String(n.GivenName || '').trim();
    const nick = String(n.NickName || '').trim() || given;
    let initials = String(n.Initials || '').trim();
    if (!initials && given) {
      initials = given.split(/\s+/).map(w => w[0].toUpperCase() + '.').join('');
    }
    return {
      given, nick, initials,
      birthPrefix: String(n.FamilyNamePrefix || '').trim(),
      birth: String(n.FamilyName || '').trim(),
      partnerPrefix: String(n.FamilyNamePartnerPrefix || '').trim(),
      partner: String(n.FamilyNamePartner || '').trim(),
      convention: /^(B|BP|P|PB)$/.test(n.Convention) ? n.Convention : 'B',
      nr: String(person.externalId || '')
    };
  }

  function side(prefix, name) {
    return [prefix, name].filter(Boolean).join(' ');
  }

  /** The convention-resolved full surname: "van den Boele - de Vries" for BP. */
  function surname(p, convention) {
    const b = side(p.birthPrefix, p.birth);
    const pa = side(p.partnerPrefix, p.partner);
    switch (convention || p.convention) {
      case 'P': return pa || b;
      case 'BP': return pa ? b + ' - ' + pa : b;
      case 'PB': return pa ? pa + ' - ' + b : pa || b;
      default: return b;
    }
  }

  /* ---- template rendering -------------------------------------------------- */

  const TOKENS = ['voornaam', 'roepnaam', 'voorletters', 'voorletter', 'tussen', 'tv', 'tvi',
    'tussenp', 'tvp', 'geboortenaam', 'partnernaam', 'achternaam', 'nr', 'domein', 'i'];

  function tokenValues(p, convention, domain) {
    return {
      voornaam: p.given,
      roepnaam: p.nick,
      voorletters: p.initials,
      voorletter: p.nick ? p.nick[0] : '',
      tussen: p.birthPrefix,
      tv: compact(p.birthPrefix),
      tvi: p.birthPrefix ? p.birthPrefix.toLowerCase().split(/\s+/).map(w => w[0]).join('') : '',
      tussenp: p.partnerPrefix,
      tvp: compact(p.partnerPrefix),
      geboortenaam: p.birth,
      partnernaam: p.partner,
      achternaam: surname(p, convention),
      nr: p.nr,
      domein: domain
    };
  }

  const TOKEN_RE = /\{([a-z]+)(?::(\d+))?\}/g;

  /* Particles are legitimately absent for most people — an empty tussenvoegsel
     is normal, not a data problem. Only core name tokens flag emptyPart. */
  const OPTIONAL = new Set(['tussen', 'tv', 'tvi', 'tussenp', 'tvp', 'partnernaam', 'i']);

  /** @returns {{value:string, missing:string[]}} missing = core tokens that resolved empty */
  function render(template, values, iteration) {
    const missing = [];
    const value = template.replace(TOKEN_RE, (m, name, len) => {
      if (name === 'i') return iteration >= 2 ? String(iteration) : '';
      let v = values[name];
      if (v === undefined) return m; // unknown token: left visible on purpose
      if (!v) { if (!OPTIONAL.has(name)) missing.push(name); return ''; }
      return len ? v.slice(0, parseInt(len, 10)) : v;
    });
    return { value, missing };
  }

  /* Field-kind normalisation. Address-like fields are what the connector will
     write: lowercase, diacritics stripped (full NFD — wider than HelloID's
     deleteDiacriticalMarks, whose gaps are a known complaint), spaces out,
     anything the target rejects out. Text fields only tidy whitespace. */
  function normalise(raw, kind) {
    if (kind === 'text') return raw.replace(/\s+/g, ' ').trim();
    let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    s = s.replace(/\s+/g, '');
    if (kind === 'nickname') return s.replace(/[^a-z0-9_\-]/g, '');
    return s.replace(/[^a-z0-9.@_\-]/g, '').replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '').replace(/\.+(?=@)/, '').replace(/\.+$/, '');
  }

  /* ---- simulation ---------------------------------------------------------- */

  /**
   * @param spec cfg.namegen
   * @param persons vault persons (each with .name, .externalId, .displayName)
   * @param existing per-space occupied Sets: {smtp, upn, nickname} (or null)
   */
  function simulate(spec, persons, existing) {
    const occupied = {
      smtp: new Set(existing && existing.smtp || []),
      upn: new Set(existing && existing.upn || []),
      nickname: new Set(existing && existing.nickname || [])
    };
    const fields = FIELDS.filter(f => spec.fields[f.key] &&
      (spec.fields[f.key].variants || []).some(v => v.trim()));

    const generateAt = (f, values, step) => {
      const variants = spec.fields[f.key].variants.filter(v => v.trim());
      const idx = Math.min(step, variants.length - 1);
      const beyond = step > variants.length - 1;
      const tpl = variants[idx];
      if (beyond && !/\{i\}/.test(tpl)) return null; // variants exhausted
      /* {i} counts from 2 at the variant's own step (the jdoe2 convention)
         and keeps climbing when the last variant absorbs further steps. */
      const r = render(tpl, values, step - idx + 2);
      return { value: normalise(r.value, f.kind), missing: r.missing };
    };

    const rows = [];
    const partKeys = new Map(); // identical name parts = probable HR duplicate
    const stats = { depth: {}, flags: { exhausted: 0, emptyPart: 0, tooLong: 0, hrDuplicate: 0 } };
    fields.forEach(f => { stats.depth[f.key] = new Map(); });

    for (const person of persons) {
      const p = parts(person);
      const domain = spec.domain || '';
      const upnDomain = spec.upnDomain || domain;
      const flags = new Set();
      const values = {};

      const pk = [p.nick, compact(p.birthPrefix), p.birth, p.partner].join('|').toLowerCase();
      if (p.birth && partKeys.has(pk)) flags.add('hrDuplicate');
      else partKeys.set(pk, person);

      const uniques = fields.filter(f => f.unique);
      /* mail and proxyAddresses share the SMTP space and normally generate the
         same address for the same person — that is one claim, not a clash. */
      const mine = { smtp: new Set(), upn: new Set(), nickname: new Set() };
      const fits = (f, step) => {
        const tv = tokenValues(p, null, f.space === 'upn' ? upnDomain : domain);
        const g = generateAt(f, tv, step);
        if (!g) return null;
        return (occupied[f.space].has(g.value) && !mine[f.space].has(g.value)) ? false : g;
      };

      if (spec.syncIterations) {
        /* One shared step, walked up until every unique field is free — the
           intake's "regenerate all names when one is taken" semantics. */
        let chosen = -1, results = null;
        for (let step = 0; step < 50; step++) {
          const r = uniques.map(f => ({ f, g: fits(f, step) }));
          if (r.some(x => x.g === null)) break;
          if (r.every(x => x.g !== false)) { chosen = step; results = r; break; }
        }
        if (results) {
          results.forEach(({ f, g }) => {
            occupied[f.space].add(g.value);
            mine[f.space].add(g.value);
            values[f.key] = { value: g.value, step: chosen };
            g.missing.length && flags.add('emptyPart');
            g.value.length > f.limit && flags.add('tooLong');
          });
        } else {
          flags.add('exhausted');
          uniques.forEach(f => { values[f.key] = { value: '', step: -1 }; });
        }
        /* The shared step drags the non-unique fields along too ("all names
           are regenerated") — generateAt clamps to the variants they have. */
        fields.filter(f => !f.unique).forEach(f => {
          const tv = tokenValues(p, null, domain);
          const g = generateAt(f, tv, Math.max(0, chosen)) || generateAt(f, tv, 0);
          if (g) {
            values[f.key] = { value: g.value, step: Math.max(0, chosen) };
            g.missing.length && flags.add('emptyPart');
            g.value.length > f.limit && flags.add('tooLong');
          }
        });
      } else {
        for (const f of fields) {
          const tv = tokenValues(p, null, f.space === 'upn' ? upnDomain : domain);
          if (!f.unique) {
            const g = generateAt(f, tv, 0);
            if (g) {
              values[f.key] = { value: g.value, step: 0 };
              g.missing.length && flags.add('emptyPart');
              g.value.length > f.limit && flags.add('tooLong');
            }
            continue;
          }
          let placed = false;
          for (let step = 0; step < 50; step++) {
            const g = fits(f, step);
            if (g === null) break;
            if (g === false) continue;
            occupied[f.space].add(g.value);
            mine[f.space].add(g.value);
            values[f.key] = { value: g.value, step };
            g.missing.length && flags.add('emptyPart');
            g.value.length > f.limit && flags.add('tooLong');
            placed = true;
            break;
          }
          if (!placed) { flags.add('exhausted'); values[f.key] = { value: '', step: -1 }; }
        }
      }

      flags.forEach(fl => { stats.flags[fl] = (stats.flags[fl] || 0) + 1; });
      fields.forEach(f => {
        const v = values[f.key];
        if (!v) return;
        const d = stats.depth[f.key];
        d.set(v.step, (d.get(v.step) || 0) + 1);
      });
      rows.push({ person, parts: p, values, flags: [...flags] });
    }

    const worst = rows.filter(r => r.flags.length)
      .sort((a, b) => b.flags.length - a.flags.length).slice(0, 25);
    return { rows, stats, worst, fields: fields.map(f => f.key) };
  }

  /** The intake tables: the fixed example person under every name preference. */
  function exampleTable(spec) {
    const p = parts(EXAMPLE_PERSON);
    const out = {};
    for (const f of FIELDS) {
      const fs = spec.fields[f.key];
      if (!fs || !(fs.variants || []).some(v => v.trim())) continue;
      const variants = fs.variants.filter(v => v.trim());
      out[f.key] = ['B', 'BP', 'P', 'PB'].map(conv => ({
        convention: conv,
        steps: variants.map(tpl => {
          const tv = tokenValues(p, conv, f.space === 'upn' ? (spec.upnDomain || spec.domain) : spec.domain);
          /* Each variant shown at its first use: the {i} counter reads 2. */
          return normalise(render(tpl, tv, 2).value, f.kind);
        })
      }));
    }
    return out;
  }

  /* Occupied-name sets from the directory import: what already exists. */
  function existingFrom(directory) {
    if (!directory || !directory.users) return null;
    const smtp = new Set(), upn = new Set(), nickname = new Set();
    const low = v => v ? String(v).toLowerCase() : '';
    for (const u of directory.users) {
      if (u.mail) smtp.add(low(u.mail));
      (u.proxyAddresses || []).forEach(a =>
        smtp.add(low(String(a).replace(/^smtp:/i, ''))));
      if (u.userPrincipalName) upn.add(low(u.userPrincipalName));
      if (u.mailNickname) nickname.add(low(u.mailNickname));
    }
    return { smtp, upn, nickname };
  }

  window.HR = window.HR || {};
  window.HR.namegenLab = { FIELDS, TOKENS, EXAMPLE_PERSON, defaults, parts, surname,
    render, normalise, simulate, exampleTable, existingFrom, tokenValues };
})();
