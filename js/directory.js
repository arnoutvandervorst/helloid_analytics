/* Directory import: the output of collect-ad.ps1 / collect-entra.ps1, for analysis
   BEFORE HelloID exists. One envelope carries users, groups and memberships; this
   module synthesizes the two inputs the rest of the tool already understands:

     records — reconciliation-shaped rows, every membership "Permission unmanaged",
               because before an IAM system that is the literal truth. Nested
               memberships are flattened to effective holdings, the via-chain kept
               on the row's path so a drawer can say where a right came from.
     vault   — a HelloID-vault-shaped Persons[] built from the same users, so
               correlation is exact by construction: employeeType becomes the
               contract Type, department/title/manager land where rules read
               them, and extensionAttributes arrive as contract custom fields.

   Both substitutes step aside the moment a real export of their kind is loaded;
   app.js owns that precedence. */
(function (HR) {
  'use strict';

  const U = HR.util;

  const KIND = 'helloid-analytics-directory';
  const looksLikeDirectory = data => !!data && data.kind === KIND && Array.isArray(data.users);

  const SYSTEM_NAME = { ad: 'Active Directory', entra: 'Microsoft Entra ID' };

  const str = v => (v == null ? '' : String(v)).trim();

  function parse(text, fileName) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Directory export is not valid JSON: ' + e.message); }
    if (!looksLikeDirectory(data)) {
      throw new Error('Not a directory export — expected JSON with kind "' + KIND + '".');
    }
    const warnings = [];
    const source = data.source === 'entra' ? 'entra' : 'ad';
    const system = SYSTEM_NAME[source];

    const users = (data.users || []).filter(u => str(u.userName) || str(u.upn)).map(u => Object.assign({}, u, {
      userName: str(u.userName) || str(u.upn),
      displayName: str(u.displayName)
    }));
    const groups = (data.groups || []).filter(g => str(g.name));
    const dropped = (data.users || []).length - users.length;
    if (dropped) warnings.push(dropped + ' user(s) skipped: no userName and no UPN.');

    const groupsById = new Map(groups.map(g => [g.id, g]));

    /* ---- nesting: child group -> the groups that contain it ---- */
    const parentsOf = new Map();
    let nestedEdges = 0;
    for (const g of groups) {
      for (const childId of (g.memberGroups || [])) {
        if (!groupsById.has(childId)) continue;
        if (!parentsOf.has(childId)) parentsOf.set(childId, []);
        parentsOf.get(childId).push(g.id);
        nestedEdges++;
      }
    }

    /* ---- direct memberships: user -> groups ---- */
    const directOf = new Map();
    for (const g of groups) {
      for (const uid of (g.memberUsers || [])) {
        if (!directOf.has(uid)) directOf.set(uid, []);
        directOf.get(uid).push(g.id);
      }
    }

    /**
     * Effective groups of one user: the direct set plus every group reached by
     * walking containment upward. Cycle-safe; the via-chain records the walk so
     * an inherited row can say which membership carried it.
     * @returns {Map<groupId, string[] via>} empty via = direct
     */
    function effectiveGroups(uid) {
      const eff = new Map();
      const queue = [];
      for (const gid of (directOf.get(uid) || [])) {
        if (!eff.has(gid)) { eff.set(gid, []); queue.push(gid); }
      }
      while (queue.length) {
        const gid = queue.shift();
        const via = eff.get(gid);
        for (const pid of (parentsOf.get(gid) || [])) {
          if (eff.has(pid)) continue;             // first (shortest) chain wins; cycles stop here
          eff.set(pid, via.concat(groupsById.get(gid).name));
          queue.push(pid);
        }
      }
      return eff;
    }

    /* ---- reconciliation-shaped records ---- */
    const records = [];
    let inheritedRows = 0;
    const push = r => { r.i = records.length; records.push(r); };
    const base = u => ({
      system,
      personRaw: u.displayName || u.userName,
      personName: u.displayName || u.userName,
      personId: '',
      accountDisplayName: u.displayName,
      userName: u.userName,
      enabled: u.enabled !== false,
      permissionRaw: '', permission: '', permissionPath: '',
      permissionConfig: '', subPermission: '',
      issue: 'Unspecified', resolution: 'None'
    });

    for (const u of users) {
      const eff = effectiveGroups(u.id);
      if (!eff.size && !(u.licenses || []).length) {
        push(base(u));                             // an account with nothing still exists
        continue;
      }
      for (const [gid, via] of eff) {
        const g = groupsById.get(gid);
        const r = base(u);
        r.permissionRaw = g.name; r.permission = g.name;
        r.permissionPath = via.length ? 'via ' + via.join(' > ') : '';
        r.issue = 'Permission unmanaged';
        if (via.length) inheritedRows++;
        push(r);
      }
      /* Entra license assignments are real holdings with real SKU names. */
      for (const sku of (u.licenses || [])) {
        const r = base(u);
        r.permissionRaw = sku; r.permission = sku;
        r.permissionConfig = 'license';
        r.issue = 'Permission unmanaged';
        push(r);
      }
    }

    /* ---- pseudo-vault from the same users ---- */
    const vaultText = JSON.stringify(toVaultObject(users, system));
    const vault = HR.vault.parse(vaultText, (fileName || 'directory') + ' (synthesized)');
    vault.meta.synthetic = true;

    const dynamicGroups = groups.filter(g => g.dynamic).length;

    /* Direct or inherited? The recon cannot say — memberships arrive
       flattened — but this envelope can: the same walk that synthesized the
       rows answers per user/group whether the holding is a direct membership
       or arrives via nesting, chain included. Memoized per user on demand. */
    const userByName = new Map(users.map(u => [u.userName.toLowerCase(), u]));
    const groupIdByName = new Map(groups.map(g => [g.name.toLowerCase(), g.id]));
    const effMemo = new Map();
    function membership(userName, groupName) {
      const u = userByName.get(String(userName || '').toLowerCase());
      if (!u) return null;
      let eff = effMemo.get(u.id);
      if (!eff) { eff = effectiveGroups(u.id); effMemo.set(u.id, eff); }
      const gid = groupIdByName.get(String(groupName || '').toLowerCase());
      if (!gid || !eff.has(gid)) return null;
      const via = eff.get(gid);
      return via.length ? { via } : { direct: true };
    }

    /* ---- what each group IS, structurally ----------------------------------
       Nesting is how directories build their own RBAC: role groups are made
       members of the groups that actually sit on resources (AGDLP), and Entra
       adds query-based (dynamic) groups whose membership is a rule, not an
       assignment. For role modelling that means:
         resource — contains other groups, is member of none: the chain
                    terminal, the group that actually grants — assign THESE
         role     — member of other groups: an abstraction layer; its access
                    is expressed by the terminals it feeds
         plain    — no nesting either way
       dynamic is orthogonal: membership is query-managed in the directory, so
       HelloID cannot grant it — it competes with the rules being mined. */
    const groupMeta = new Map();
    const depthMemo = new Map();
    const childDepth = (gid, seen) => {
      if (depthMemo.has(gid)) return depthMemo.get(gid);
      if (seen.has(gid)) return 0;                  // containment cycle: stop
      seen.add(gid);
      const g = groupsById.get(gid);
      let deepest = 0;
      for (const cid of (g && g.memberGroups || [])) {
        if (groupsById.has(cid)) deepest = Math.max(deepest, 1 + childDepth(cid, seen));
      }
      seen.delete(gid);
      depthMemo.set(gid, deepest);
      return deepest;
    };
    let resourceGroups = 0, roleGroups = 0;
    for (const g of groups) {
      const parents = (parentsOf.get(g.id) || []).length;
      const children = (g.memberGroups || []).filter(cid => groupsById.has(cid)).length;
      const kind = parents ? 'role' : (children ? 'resource' : 'plain');
      if (kind === 'resource') resourceGroups++;
      if (kind === 'role') roleGroups++;
      groupMeta.set(g.name.toLowerCase(), {
        name: g.name, kind, parents, children,
        depth: childDepth(g.id, new Set()),
        dynamic: !!g.dynamic,
        membershipRule: str(g.membershipRule),
        parentNames: (parentsOf.get(g.id) || []).map(pid => (groupsById.get(pid) || {}).name).filter(Boolean),
        directUsers: (g.memberUsers || []).length
      });
    }

    return {
      source, system, users, groups, records, vault, groupMeta, membership,
      warnings: warnings.concat(vault.warnings || []),
      meta: {
        fileName: fileName || 'directory.json',
        source, system,
        tenant: data.tenant || null,
        collectedAt: data.collectedAt ? Date.parse(data.collectedAt) || null : null,
        domain: str(data.domain),
        userCount: users.length,
        groupCount: groups.length,
        rowCount: records.length,
        nestedEdges, inheritedRows, dynamicGroups, resourceGroups, roleGroups,
        health: {},
        fingerprint: U.hash(text.length + '|' + users.length + '|' + text.slice(0, 4096))
      }
    };
  }

  /* The attributes land where HelloID puts them, so everything downstream —
     rule evaluation, employee-category detection, attribute mining — reads them
     without knowing the vault is synthesized. Org-shaped attributes (department,
     title, type, manager, extensionAttributes, OU) go on the contract, where
     business-rule conditions live; identity-shaped ones (mail, phones, address)
     on the person. */
  function toVaultObject(users, system) {
    const nonEmpty = obj => {
      const out = {};
      Object.keys(obj || {}).forEach(k => { if (str(obj[k])) out[k] = str(obj[k]); });
      return out;
    };
    return {
      Persons: users.map(u => ({
        PersonId: u.id,
        /* No employee id in the directory means no employee id — a DN standing in
           would read like one and mislead every list it appears in. */
        ExternalId: str(u.employeeId),
        DisplayName: u.displayName || u.userName,
        UserName: u.userName,
        Name: { GivenName: str(u.givenName), FamilyName: str(u.surname), Initials: str(u.initials) },
        Status: { Blocked: u.enabled === false },
        Custom: nonEmpty({
          mail: u.mail, phone: u.phone, mobile: u.mobile, homePhone: u.homePhone,
          fax: u.fax, pager: u.pager, ipPhone: u.ipPhone,
          street: u.street, poBox: u.poBox, city: u.city, state: u.state,
          postalCode: u.postalCode, country: u.country,
          description: u.description, notes: u.notes
        }),
        Contracts: [{
          ExternalId: u.id + ':c1',
          StartDate: u.hireDate || u.created || null,
          EndDate: u.expires || null,
          Type: { Name: str(u.employeeType) },
          Department: { Name: str(u.department) },
          Title: { Name: str(u.title) },
          Location: { Name: str(u.office) || str(u.city) },
          Employer: { Name: str(u.company) },
          Manager: { ExternalId: str(u.managerId), DisplayName: str(u.managerName) },
          Custom: Object.assign(nonEmpty(u.extensionAttributes), str(u.ou) ? { ou: str(u.ou) } : {})
        }],
        Accounts: [{
          SystemIdentifier: system,
          Data: {
            sAMAccountName: u.userName,
            userPrincipalName: str(u.upn),
            displayName: u.displayName
          }
        }]
      }))
    };
  }

  HR.directory = { parse, looksLikeDirectory, KIND };
})(window.HR);
