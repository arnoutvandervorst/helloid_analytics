/* Matches accounts with no owner against the people in the vault.

   Accounts that already have a person are correlated by HelloID and need nothing from
   here. The interesting set is the unowned ones, and the most valuable answer is usually
   "this belonged to someone who left": correlation is what breaks first when a person is
   removed from the source, so a leaver's account tends to arrive here as an orphan with
   no trace of who it was.

   Matching is scored and never automatic. An earlier naive version of this happily
   proposed "adm-daan.groot" for a person called Mark de Groot, which is exactly the kind
   of confident nonsense that destroys trust in the rest of the report — so a candidate
   is only called strong when the evidence is unambiguous, and ties are reported as ties. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const strip = s => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')      // fold diacritics
    .toLowerCase();
  const letters = s => strip(s).replace(/[^a-z]/g, '');
  const words = s => strip(s).split(/[^a-z]+/).filter(w => w.length > 1);

  /* Account display names carry qualifiers the person record never has. */
  const cleanDisplay = s => String(s || '')
    .replace(/\s*\((?:admin|adm|test|demo|extern|external|beheer|\d+)\)\s*/gi, ' ')
    .trim();

  /* Person display names are "Name (externalId)". */
  const cleanPerson = s => String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim();

  function score(account, person) {
    const evidence = [];
    let points = 0;

    const accName = cleanDisplay(account.displayName);
    const perName = cleanPerson(person.displayName);
    const accLetters = letters(accName);
    const perLetters = letters(perName);

    if (accLetters && accLetters === perLetters) {
      points += 100;
      evidence.push('display name identical');
    } else if (accLetters && perLetters && (accLetters.includes(perLetters) || perLetters.includes(accLetters))) {
      points += 55;
      evidence.push('display name contains the other');
    }

    /* An employee number inside the account name is as good as a key. */
    if (person.externalId && new RegExp('(^|[^0-9])' + person.externalId + '([^0-9]|$)').test(account.userName)) {
      points += 90;
      evidence.push('employee number in username');
    }

    /* Surname plus first initial is the common Dutch convention (jdijkstra, dijkst13). */
    const parts = words(perName);
    const surname = parts.length ? parts[parts.length - 1] : '';
    const first = parts.length ? parts[0] : '';
    const user = letters(account.userName);
    if (surname.length > 3 && user.includes(surname)) {
      points += 30;
      evidence.push('surname in username');
      if (first && user.includes(first[0]) && user.indexOf(first[0]) < user.indexOf(surname)) {
        points += 10;
        evidence.push('initial before surname');
      }
    }
    if (first.length > 3 && surname.length > 3 && user.includes(first) && user.includes(surname)) {
      points += 25;
      evidence.push('first name and surname in username');
    }

    /* HelloID's own correlation, when the vault still carries it, outranks everything. */
    const correlated = person.accounts.some(a =>
      strip(a.userName) === strip(account.userName) ||
      (a.upn && strip(a.upn).split('@')[0] === strip(account.userName)));
    if (correlated) {
      points += 200;
      evidence.push('correlated in the vault');
    }

    return { points, evidence };
  }

  /**
   * @returns {{matches:Array, ambiguous:Array, unmatched:Array, stats:Object}}
   */
  function matchUnowned(model, vault, opts) {
    const now = (opts && opts.when) || new Date();
    const STRONG = 90;

    const unowned = model.accountList.filter(a => a.orphan);
    const persons = vault.persons;

    /* A person is "former" when every contract they have has already ended. Someone with
       no contract at all is not counted: absence of data is not evidence of departure. */
    const isFormer = p => p.contracts.length > 0 && p.contracts.every(c => c.endDate && c.endDate < now);

    const matches = [], ambiguous = [], unmatched = [];

    for (const account of unowned) {
      const scored = [];
      for (const person of persons) {
        const s = score(account, person);
        if (s.points > 0) scored.push({ person, points: s.points, evidence: s.evidence });
      }
      scored.sort((a, b) => b.points - a.points);
      const best = scored[0];
      const runnerUp = scored[1];

      if (!best || best.points < STRONG) { unmatched.push(account); continue; }
      if (runnerUp && runnerUp.points >= best.points) {
        ambiguous.push({ account, candidates: scored.filter(c => c.points >= best.points).slice(0, 4) });
        continue;
      }

      const person = best.person;
      const former = isFormer(person);
      matches.push({
        account,
        person,
        points: best.points,
        evidence: best.evidence,
        former,
        endedOn: former ? person.lastEnd : null,
        /* Someone who left, whose account still answers, is a different problem from
           someone who left and whose account is already switched off. */
        stillEnabled: account.enabled !== false,
        monthlyCost: account.monthlyCost,
        daysSinceEnd: former && person.lastEnd
          ? Math.round((now - person.lastEnd) / 86400000) : null
      });
    }

    const former = matches.filter(m => m.former);
    return {
      matches, ambiguous, unmatched,
      former,
      formerEnabled: former.filter(m => m.stillEnabled),
      stats: {
        unowned: unowned.length,
        matched: matches.length,
        ambiguous: ambiguous.length,
        unmatched: unmatched.length,
        former: former.length,
        formerEnabled: former.filter(m => m.stillEnabled).length,
        formerCost: U.sum(former, m => m.monthlyCost)
      }
    };
  }

  /**
   * Group every account this analysis can attribute to a person, and say which is the
   * person's main account and which are secondary — admin, service or function accounts
   * that exist alongside it.
   *
   * This is what explains a large share of "unowned" findings: an adm- account rarely has
   * its own person record, so reconciliation reports it as ownerless when in fact it
   * belongs to someone who is sitting right there in the vault with a personal account.
   */
  function linkAccounts(model, vault, correlation) {
    const byPerson = new Map();
    const attach = (person, account, how) => {
      if (!byPerson.has(person.personId)) byPerson.set(person.personId, { person, accounts: [] });
      const entry = byPerson.get(person.personId);
      if (!entry.accounts.some(x => x.account === account)) entry.accounts.push({ account, how });
    };

    const idx = HR.vault.accountIndex(vault);
    for (const a of model.accountList) {
      const hit = idx.get(a.userName.toLowerCase());
      if (hit) { attach(hit.person, a, 'vault correlation'); continue; }
      if (a.personRaw) {
        const p = vault.byDisplayName.get(a.personRaw);
        if (p) attach(p, a, 'reconciliation person');
      }
    }
    /* Name matches bring in the accounts neither export links to anyone. */
    if (correlation) correlation.matches.forEach(mm => attach(mm.person, mm.account, mm.evidence.join(', ')));

    /* The main account is the one that reads as a person rather than a role: not admin,
       service or test by class, and where possible the one HelloID itself correlated. */
    const groups = [];
    for (const entry of byPerson.values()) {
      if (entry.accounts.length < 2) continue;
      const scoreMain = x => {
        let s = 0;
        if (x.account.cls === 'user') s += 10;
        if (x.how === 'vault correlation') s += 5;
        if (!x.account.orphan) s += 3;
        if (x.account.enabled !== false) s += 1;
        s += Math.min(3, x.account.permCount / 10);
        return s;
      };
      const ranked = entry.accounts.slice().sort((a, b) => scoreMain(b) - scoreMain(a));
      const primary = ranked[0];
      const secondary = ranked.slice(1);
      groups.push({
        person: entry.person,
        primary,
        secondary,
        /* The interesting case: a secondary account nobody links to the person. */
        unlinkedSecondary: secondary.filter(x => x.account.orphan),
        privileged: secondary.filter(x => x.account.privileged.length),
        monthlyCost: U.sum(entry.accounts, x => x.account.monthlyCost),
        lifecycle: HR.vault.lifecycle(entry.person)
      });
    }
    groups.sort((a, b) => b.secondary.length - a.secondary.length);

    return {
      groups,
      stats: {
        personsWithMultiple: groups.length,
        secondaryAccounts: U.sum(groups, g => g.secondary.length),
        unlinkedSecondary: U.sum(groups, g => g.unlinkedSecondary.length),
        privilegedSecondary: U.sum(groups, g => g.privileged.length),
        formerWithSecondary: groups.filter(g => g.lifecycle.state === 'past').length
      }
    };
  }

  HR.correlate = { matchUnowned, linkAccounts, score };
})(window.HR);
