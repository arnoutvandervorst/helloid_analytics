/* Workforce analytics: what the contract history says when you read it as history.

   The vault is not a snapshot of who works here — it is every contract, with dates. That
   carries three stories no HelloID report tells:

   Flow. Starts and ends per month are the hiring and attrition curves, and attrition per
   department is context for every access number: a department that turns over half its
   people a year produces residue as a by-product of operating.

   Moves. A person whose next contract sits in another department, or under another
   title, moved — with a date. Movers are the blind spot of identity management: joiners
   and leavers have events, movers accumulate. Crossing a move with what the person still
   holds from the former department turns "access creep" from an anecdote into a list.

   Managers. Approvals, attestations and product requests route to managers. A manager
   with forty reports rubber-stamps; a contract naming a manager whose own contracts have
   all ended routes its approvals to nobody at all. */
(function (HR) {
  'use strict';

  const U = HR.util;
  const DAY = 86400000;
  const monthOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

  const sorted = person => (person.contracts || [])
    .filter(c => c.startDate)
    .slice()
    .sort((a, b) => a.startDate - b.startDate);

  /* ------------------------------------------------------------------- moves */
  /**
   * Every transition in every person's contract sequence.
   *
   * A move is a consecutive pair whose department or title differs — and whose previous
   * contract actually ended by the time the next began. A second contract running
   * alongside the first is a dual role, not a move, and without that test every pair of
   * parallel contracts fabricates a transition that never happened.
   */
  function moves(vault, when) {
    const now = when || new Date();
    const out = [];
    for (const person of vault.persons) {
      const list = sorted(person);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1], next = list[i];
        /* Parallel employment is not movement. Seven days of slack absorbs the usual
           end-Friday-start-Monday bookkeeping. */
        if (!prev.endDate || prev.endDate > new Date(+next.startDate + 7 * DAY)) continue;
        const deptChanged = (prev.department.externalId || prev.department.name) !==
          (next.department.externalId || next.department.name);
        const titleChanged = (prev.title.name || '') !== (next.title.name || '');
        if (!deptChanged && !titleChanged) continue;
        out.push({
          person,
          date: next.startDate,
          daysAgo: Math.round((now - next.startDate) / DAY),
          deptChanged, titleChanged,
          from: { dept: prev.department.name || prev.department.externalId || '',
                  title: prev.title.name || '' },
          to: { dept: next.department.name || next.department.externalId || '',
                title: next.title.name || '' }
        });
      }
    }
    out.sort((a, b) => b.date - a.date);
    return out;
  }

  /* -------------------------------------------------------------------- flow */
  /**
   * Joiners and leavers per month, tenure, and attrition per department.
   *
   * A person joins in the month of their first start. They leave in the month of their
   * last end — and only if every contract has ended, because a person who moved is not
   * a leaver however many contracts they closed on the way.
   */
  function flow(vault, opts) {
    const cfg = Object.assign({ months: 24, when: null }, opts || {});
    const now = cfg.when || new Date();

    const perMonth = new Map();
    const bucket = key => {
      if (!perMonth.has(key)) perMonth.set(key, { month: key, joined: 0, left: 0 });
      return perMonth.get(key);
    };

    const tenures = [];
    const deptStats = new Map();
    const deptFor = key => {
      if (!deptStats.has(key)) deptStats.set(key, { dept: key, current: 0, left12: 0, tenures: [] });
      return deptStats.get(key);
    };

    for (const person of vault.persons) {
      const list = sorted(person);
      if (!list.length) continue;
      const first = list[0].startDate;
      const life = HR.vault.lifecycle(person, now);
      bucket(monthOf(first)).joined++;

      const primary = person.primaryContract || list[list.length - 1];
      const dept = primary ? (primary.department.name || primary.department.externalId || '') : '';

      if (life.state === 'past' && person.lastEnd) {
        bucket(monthOf(person.lastEnd)).left++;
        if ((now - person.lastEnd) / DAY <= 365) deptFor(dept).left12++;
      } else if (life.state === 'current') {
        const years = (now - first) / (DAY * 365.25);
        tenures.push(years);
        const d = deptFor(dept);
        d.current++;
        d.tenures.push(years);
      }
    }

    /* A contiguous monthly axis, oldest first, capped so ancient history does not
       flatten the recent shape. */
    const keys = Array.from(perMonth.keys()).sort();
    const recent = keys.slice(-cfg.months);
    const series = recent.map(k => perMonth.get(k));

    const median = list => {
      if (!list.length) return null;
      const s = list.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };

    const departments = Array.from(deptStats.values())
      .filter(d => d.dept && (d.current || d.left12))
      .map(d => Object.assign(d, {
        medianTenure: median(d.tenures),
        /* Leavers over the population that was there to leave. */
        attrition: (d.current + d.left12) ? d.left12 / (d.current + d.left12) : 0
      }))
      .sort((a, b) => b.attrition - a.attrition);

    return {
      series,
      departments,
      summary: {
        months: series.length,
        joined: U.sum(series, s => s.joined),
        left: U.sum(series, s => s.left),
        medianTenure: median(tenures),
        current: tenures.length
      }
    };
  }

  /* ---------------------------------------------------------------- managers */
  /**
   * Who approvals actually route to.
   *
   * Reports are counted over contracts running today. A manager reference resolves to a
   * person by id where possible, by display name otherwise; one that resolves to a
   * person whose own contracts have all ended is a route to nobody — every approval,
   * review and product request aimed at them silently stalls.
   */
  function managers(vault, when) {
    const now = when || new Date();
    const byId = new Map(vault.persons.filter(p => p.personId).map(p => [p.personId, p]));
    const byName = new Map(vault.persons.map(p => [p.displayName, p]));

    const spans = new Map();
    for (const person of vault.persons) {
      if (HR.vault.lifecycle(person, now).state !== 'current') continue;
      for (const c of person.contracts) {
        if (c.endDate && c.endDate < now) continue;
        if (c.startDate && c.startDate > now) continue;
        const name = c.manager.displayName;
        if (!name) continue;
        if (!spans.has(name)) {
          spans.set(name, { name, personId: c.manager.personId || '', reports: [] });
        }
        if (!spans.get(name).reports.includes(person)) spans.get(name).reports.push(person);
      }
    }

    const rows = Array.from(spans.values()).map(m => {
      const resolved = (m.personId && byId.get(m.personId)) || byName.get(m.name) || null;
      const state = resolved ? HR.vault.lifecycle(resolved, now).state : 'unknown';
      return {
        name: m.name, person: resolved, span: m.reports.length, reports: m.reports,
        state,
        /* The one that breaks governance: still named, already gone. */
        stale: state === 'past'
      };
    }).sort((a, b) => b.span - a.span);

    const spanValues = rows.map(r => r.span).sort((a, b) => a - b);
    return {
      rows,
      stale: rows.filter(r => r.stale),
      unresolved: rows.filter(r => !r.person),
      summary: {
        managers: rows.length,
        stale: rows.filter(r => r.stale).length,
        medianSpan: spanValues.length ? spanValues[Math.floor(spanValues.length / 2)] : 0,
        maxSpan: spanValues.length ? spanValues[spanValues.length - 1] : 0,
        wide: rows.filter(r => r.span >= 15).length,
        affectedReports: U.sum(rows.filter(r => r.stale), r => r.span)
      }
    };
  }

  /* ----------------------------------------------------------------- residue */
  /**
   * What movers still carry from where they used to work.
   *
   * The former department's working set is what most of its current members hold — the
   * same evidence the miner uses. An entitlement in that set, held by the mover, absent
   * from the current department's set, is residue: nothing withdrew it because nothing
   * knew it should be withdrawn.
   */
  function moverResidue(model, vault, opts) {
    const cfg = Object.assign({ share: 0.5, maxDays: null }, opts || {});
    if (!model.vault) return null;

    let people;
    try { people = HR.pyramid.population(model, vault, model.granted).filter(p => p.ents.size); }
    catch (e) { return null; }
    const byPersonId = new Map(people.map(p => [p.person.personId, p]));

    /* Each department's working set, from the people in it today. */
    const deptSets = new Map();
    const deptMembers = new Map();
    for (const p of people) {
      const dept = p.labels.Department || p.attrs.Department;
      if (!dept) continue;
      if (!deptMembers.has(dept)) deptMembers.set(dept, []);
      deptMembers.get(dept).push(p);
    }
    deptMembers.forEach((members, dept) => {
      const tally = new Map();
      members.forEach(p => p.ents.forEach(e => tally.set(e, (tally.get(e) || 0) + 1)));
      const set = new Set();
      tally.forEach((n, ent) => { if (n / members.length >= cfg.share) set.add(ent); });
      deptSets.set(dept, set);
    });

    const all = moves(vault);
    const rows = [];
    for (const move of all) {
      if (!move.deptChanged) continue;
      if (cfg.maxDays && move.daysAgo > cfg.maxDays) continue;
      const holder = byPersonId.get(move.person.personId);
      if (!holder) continue;
      const fromSet = deptSets.get(move.from.dept);
      if (!fromSet || !fromSet.size) continue;
      const toSet = deptSets.get(move.to.dept) || new Set();
      const residue = [];
      holder.ents.forEach(ent => {
        if (fromSet.has(ent) && !toSet.has(ent)) residue.push(ent);
      });
      if (residue.length) rows.push({ move, holder, residue });
    }
    rows.sort((a, b) => b.residue.length - a.residue.length);

    return {
      rows,
      moves: all,
      summary: {
        moves: all.length,
        deptMoves: all.filter(m => m.deptChanged).length,
        withResidue: rows.length,
        residueEnts: U.sum(rows, r => r.residue.length)
      }
    };
  }

  /* ----------------------------------------------------------------- latency */
  /**
   * How long a joiner waits for access, where the data can say.
   *
   * Only people whose first contract starts inside the history export's window count:
   * for anyone earlier, the grants predate the export and the answer would be a lie.
   */
  function onboardingLatency(vault, history) {
    if (!history || history.empty || !history.meta.from) return null;
    const from = history.meta.from, to = history.meta.to;

    const firstGrant = new Map();
    for (const r of history.rows) {
      if (!r.createdOn || !/grant/i.test(r.operation) || !/succe/i.test(r.result)) continue;
      const cur = firstGrant.get(r.personRaw);
      if (!cur || r.createdOn < cur) firstGrant.set(r.personRaw, r.createdOn);
    }

    const rows = [];
    for (const person of vault.persons) {
      const list = sorted(person);
      if (!list.length) continue;
      const start = list[0].startDate;
      if (start < from || start > to) continue;
      const granted = firstGrant.get(person.displayName);
      if (!granted) continue;
      rows.push({
        person, start, granted,
        days: Math.round((granted - start) / DAY),
        dept: (list[0].department.name || list[0].department.externalId || '')
      });
    }
    if (rows.length < 5) return null;              // too few to claim anything
    const days = rows.map(r => r.days).sort((a, b) => a - b);
    return {
      rows: rows.sort((a, b) => b.days - a.days),
      summary: {
        joiners: rows.length,
        median: days[Math.floor(days.length / 2)],
        worst: days[days.length - 1],
        /* Access before day one is provisioning working; after a week, somebody waited. */
        beforeStart: rows.filter(r => r.days <= 0).length,
        overWeek: rows.filter(r => r.days > 7).length
      }
    };
  }

  /* ------------------------------------------------------------------- creep */
  /**
   * Does access grow with tenure? A slope, not a suspicion.
   */
  function creep(model, vault) {
    let people;
    try { people = HR.pyramid.population(model, vault, model.granted).filter(p => p.ents.size); }
    catch (e) { return null; }
    const now = new Date();
    const points = [];
    for (const p of people) {
      if (HR.vault.lifecycle(p.person, now).state !== 'current') continue;
      const list = sorted(p.person);
      if (!list.length) continue;
      points.push({ x: (now - list[0].startDate) / (DAY * 365.25), y: p.ents.size, holder: p });
    }
    if (points.length < 10) return null;
    const n = points.length;
    const mx = U.sum(points, p => p.x) / n, my = U.sum(points, p => p.y) / n;
    let cov = 0, varx = 0;
    points.forEach(p => { cov += (p.x - mx) * (p.y - my); varx += (p.x - mx) * (p.x - mx); });
    const slope = varx ? cov / varx : 0;
    return { points, slope, mean: my, summary: { people: n, slope, mean: my } };
  }

  /* ---------------------------------------------------------------- forecast */
  /**
   * What the hiring pipeline costs: future contracts priced at their department's
   * current spend per head. An estimate, and labelled as one — but it looks forward,
   * which no licence report does.
   */
  function forecast(model, vault, opts) {
    const cfg = Object.assign({ horizonDays: 180 }, opts || {});
    const now = new Date();
    let scorecards = null;
    try { scorecards = HR.scorecard.build(model); } catch (e) { /* no per-dept rate */ }
    const rate = new Map();
    if (scorecards) scorecards.departments.forEach(d => {
      if (d.costPerHead != null) rate.set(d.key, d.costPerHead);
    });
    const fallback = scorecards && scorecards.medianCostPerHead;

    const rows = [];
    for (const person of vault.persons) {
      for (const c of person.contracts) {
        if (!c.startDate || c.startDate <= now) continue;
        const days = Math.round((c.startDate - now) / DAY);
        if (days > cfg.horizonDays) continue;
        const dept = c.department.name || c.department.externalId || '';
        rows.push({
          person, contract: c, days, dept,
          monthly: rate.get(dept) != null ? rate.get(dept) : (fallback || 0),
          estimated: rate.get(dept) == null
        });
        break;                                     // one forecast per person
      }
    }
    if (!rows.length) return null;
    rows.sort((a, b) => a.days - b.days);
    return {
      rows,
      summary: {
        starters: rows.length,
        monthly: U.sum(rows, r => r.monthly),
        horizonDays: cfg.horizonDays,
        estimated: rows.filter(r => r.estimated).length
      }
    };
  }

  /**
   * What a future starter will most likely need, learned from the people already in
   * the seat: everyone currently working in the contract's department, and — when the
   * cohort is big enough to mean anything — the subset holding the same title. The
   * share of each cohort holding an entitlement is the forecast; nothing is invented.
   */
  function expectedAccess(model, vault, contract) {
    const index = HR.correlate.personAccountIndex(model, vault, model.correlation);
    const now = new Date();
    const deptKey = contract.department.externalId || contract.department.name || '';
    const titleKey = contract.title.externalId || contract.title.name || '';
    const sameDept = c => (c.department.externalId || c.department.name || '') === deptKey;
    const sameTitle = c => (c.title.externalId || c.title.name || '') === titleKey;

    const dept = [], title = [];
    for (const person of vault.persons) {
      const cur = person.contracts.filter(c =>
        (!c.startDate || c.startDate <= now) && (!c.endDate || c.endDate >= now));
      if (!cur.some(sameDept)) continue;
      dept.push(person);
      if (titleKey && cur.some(c => sameDept(c) && sameTitle(c))) title.push(person);
    }

    const entsOf = person => {
      const entry = index.get(person.personId);
      const set = new Set();
      if (entry) entry.accounts.forEach(a => a.permKeys.forEach(k => set.add(k)));
      return set;
    };
    const tally = cohort => {
      const t = new Map();
      let withAccess = 0;
      cohort.forEach(p => {
        const ents = entsOf(p);
        if (!ents.size) return;                     // invisible to the imports, not empty-handed
        withAccess++;
        ents.forEach(k => t.set(k, (t.get(k) || 0) + 1));
      });
      return { t, n: withAccess };
    };
    const d = tally(dept);
    const useTitle = title.length >= 3;
    const ti = useTitle ? tally(title) : null;

    const rows = [];
    d.t.forEach((count, key) => {
      const perm = model.permissions.get(key);
      if (!perm) return;
      rows.push({
        perm,
        deptShare: d.n ? count / d.n : 0,
        titleShare: ti && ti.n ? (ti.t.get(key) || 0) / ti.n : null
      });
    });
    rows.sort((a, b) => ((b.titleShare != null ? b.titleShare : b.deptShare)) -
      ((a.titleShare != null ? a.titleShare : a.deptShare)) ||
      (b.perm.monthlyPrice || 0) - (a.perm.monthlyPrice || 0));

    const likely = rows.filter(r => (r.titleShare != null ? r.titleShare : r.deptShare) >= 0.5);
    return {
      rows, likely,
      deptSize: d.n, titleSize: ti ? ti.n : 0, useTitle,
      monthly: U.sum(likely, r => r.perm.monthlyPrice || 0)
    };
  }

  HR.workforce = { moves, flow, managers, moverResidue, onboardingLatency, creep, forecast, expectedAccess };
})(window.HR);
