# Changelog

Versions are CalVer (`YYYY.M.N` — Nth release of that month). This file is
generated from `js/changelog.js` by `make-changelog.js`; edit there, not here.

## [2026.9.1] — 2026-09-01

- The Dutch settings tab for matching is called “Matching” again, the same word the sidebar uses — it had drifted to “Koppeling”.

## [2026.8.24] — 2026-09-01

- Classification rethought: no more pattern filters. Every permission and account is placed in a naming family mined from the actual data (per system), and classification is an answer per family or per single item — like categorising bank statements. Built-in knowledge (PRIV means privileged, adm- means admin account) classifies automatically until you answer otherwise, and accounts holding privileged entitlements class as admin accounts whatever their name says.
- The classification wizard shows every family with its current answer and where it came from (your answer, automatic, none yet); changing the choice classifies every member, single members can be corrected, and names without a family are tagged one by one. A reconciliation or directory import opens it when anything is unanswered.
- Settings › Classification now holds definitions only (label, sensitivity, weight, colour) with live counts; family and item answers travel with the settings export. Existing category and class definitions survive; old custom pattern rules do not — re-answer them once in the wizard.
- Clearer names for the two account axes: “Account type” (what it technically is: admin, service, test …) and “Workforce category” (who it works for: payroll, temp, supplier … — formerly “Account classification”). Workforce categories keep their layered detection unchanged.

## [2026.8.23] — 2026-08-31

- Accounts and rows accounted for in the HelloID reconciliation no longer count against the fault KPIs — a justified account is, by definition, OK. Resolutions are per entitlement: whole-account KPIs (unowned, unowned-enabled, service, former-employee, disabled-entitled, dormant) need every row excluded or resolved; the privileged-account KPI is judged on its privileged rows alone; access outside the IAM model counts only unresolved rows. Composition KPIs (admin, test, shared, wide accounts) measure what exists regardless.
- The export carries only the resolution type; the remark and end date entered in HelloID stay behind in HelloID.

## [2026.8.22] — 2026-08-31

- Policy KPIs: a new Policies view holds 24 quality KPIs an organisation sets for itself — unowned, admin, service, test, shared, disabled, dormant and former-employee accounts, privileged accounts without an owner, people with more access than the rules give, peer outliers, employees without an account, duplicate employee ids, approvals routed to someone who left, empty and deeply nested groups, access outside the IAM model, rule coverage, and more — each with its own adjustable limit.
- Every KPI shows today’s number against the limit, met or not met, the accounts and people behind the number, and one line on how to improve. The overall score counts the KPIs that pass — groundwork for certifications such as NIS2. The catalog follows what the field measures (SailPoint outlier factors, Saviynt posture metrics, Omada’s KPI model) using only data the tool already reads.
- Dormant accounts use the last sign-in the collectors already ship (AD: the replicated lastLogonTimestamp; Entra: signInActivity); KPIs whose import is missing say what they need instead of scoring.
- Limits are saved with the settings and exported in the settings file; the board report gains a Policy KPIs sheet with the same numbers. The KPI shape follows the IAM-masterplan threshold policies, so chosen limits can migrate to a full policy engine later.

## [2026.8.21] — 2026-08-31

- HelloID allows about 100 business rules, so mined rules are now ranked: rank 1 is the baseline, and each next rank goes to the rule that explains the most access nothing above it explains. The best 100 sit inside the cap; everything past it stays visible, marked "over the rule cap".
- The rules table sorts by rank, the drawer shows each rule’s rank, and a note states what the best 100 explain versus the full set. The rule exports are ordered best-first, with over-cap rows carrying an "Over rule cap" category.
- The cap is a setting in the mining-hygiene card (default 100, 0 switches it off).

## [2026.8.20] — 2026-08-31

- The product is now called HelloID Sidekick — it works alongside HelloID rather than only reporting on it. New home: github.com/arnoutvandervorst/helloid_sidekick (the old address redirects). File formats, settings and browser storage are unchanged; existing exports and collector scripts keep working.

## [2026.8.19] — 2026-08-31

- Target-attribute analyzer: a new "Target attributes" tab in Field mapping profiles every attribute of the collected AD/Entra accounts — how many accounts have a value, how many distinct values, the most common ones — with a value-distribution drawer per attribute.
- With a mapping loaded it answers the two questions that matter before trusting it: which attributes hold real data that no mapping field writes (nothing keeps them up to date), and which mapped attributes are empty today (the first update run would write them on nearly every account).
- The tab works from a directory import alone; mapped attributes link straight into the update simulation.

## [2026.8.18] — 2026-08-31

- Plain-language sweep across the dashboard: ~70 figurative or insider phrasings rewritten in both languages ("What the paperwork carries" → "What the HR data provides", "it travelled with them" → "usually kept from an earlier role", and many more).
- One word per concept everywhere: "drift" became "unmanaged access/assignments" (NL "onbeheerd"), the four different meanings of "floor" became baseline, threshold and minimum, and EN/NL now say the same thing where they used to diverge.
- Renames: Bus factor → Key-person risk, Blast radius → Reach, the Lift column → "× vs organisation", the cost Leaks tab → Wasted spend ("hard buckets" → "directly recoverable").

## [2026.8.17] — 2026-08-31

- Imported-rule polish: a rule whose only conditions are the Person and time-frame clauses now reads "everyone active" in the rules table instead of a dash, with the clauses in the tooltip.
- The rule drawer’s conditions render as a proper table — facet, operator and values clearly separated — with a note stating the semantics: every condition must hold, values within one condition are alternatives.
- The account-entitlement card got a capitalized title, and raw entitlement names in the drawer read as data (monospace).

## [2026.8.16] — 2026-08-30

- Mined rules condense the way HelloID allows: sibling rules merge into multi-value "one of" conditions, iterated across every attribute until nothing merges, and the condensed set is now the canonical output — the mined-rules table, the counts and the pyramid-rules.csv export all use it, with the raw single-value set kept as a separate export and each condensed rule naming the rules it replaced in its drawer.
- The coverage-first set condenses the same way, and its export carries the merged conditions.
- Imported HelloID rules condense without a person vault: exact lossless merges (same entitlements, same other conditions) are proposed from the rules alone; people counts and near-miss trades appear once an evaluation exists. Not/contains/empty conditions and the Person and time-frame clauses are never widened.
- Generated rule names no longer carry a kind prefix like "Piramide" — the name is the conditions; the {kind} token in the naming template still works.

## [2026.8.15] — 2026-08-28

- The field-mapping simulation names its gaps: a collection-gap card lists every mapped attribute the loaded directory never collected, separating what a re-collect fixes from what the source API does not have — with the exact command line and a pre-filled collector download.
- Both collectors take -ExtraAttributes for attributes outside their built-in set, and the built-in set widened (AD: cn, homeDirectory, homeDrive, scriptPath, profilePath, wWWHomePage; Entra: preferredLanguage, otherMails).
- Fixed: legacy accountMappings field names (AdditionalFields.*) never matched the attribute aliases, so every such field wrongly read as having no counterpart.

## [2026.8.14] — 2026-08-28

- Brand accent color: one picker drives buttons, links, active tabs, the first chart color, the gradient marks and the printed report — in both themes.
- Per-brand default theme (a visitor’s own toggle still wins) and a custom welcome line on the empty start page.
- Board report extras: a contact row on the cover and a footer line printed on every sheet.

## [2026.8.13] — 2026-08-28

- Storage transparency: a Settings › Storage tab lists everything the app keeps in the browser — settings and decisions, branding, UI preferences, the snapshot archive and the raw imported files — with live sizes, per-store clear buttons and clear-everything.
- A storage kill switch: turning "Remember data in this browser" off wipes every store and stops all saving; the session keeps working in memory and forgets on reload.
- The first persisting import announces itself once, with a pointer to the Storage tab; anonymous usage statistics gained their own toggle there.
- The settings export is now described honestly: it contains the match decisions and books, names and employee ids included.

## [2026.8.12] — 2026-08-28

- Versioning and a changelog: CalVer version in the topbar, an About card in Settings, this history rendered in-app, and a generated CHANGELOG.md.

## [2026.8.11] — 2026-08-28

- Person link card in the account drawer: an unlinked account shows its top candidates with confirm/reject/search, a linked one shows the attribution and the means to override it; name-match attributions render as proposals, not settled links.
- "Employee category" renamed to "Account classification", overridable per account from the drawer, with a link to the classification settings.
- Field mappings in the older accountMappings shape import and simulate; source mappings among them are still refused with an explanation.
- Closest peer is a clickthrough; the unique-entitlements list became a "Unique vs peer" column in the entitlements table.

## [2026.8.10] — 2026-08-27

- Field-mapping import and attribute-update simulation: the target connector’s v1 mapping export as data — per field the mode per provisioning action — and an Update simulation that evaluates every in-scope field per person (Complex JavaScript runs faithfully) and diffs it against what the collected AD/Entra holds today.

## [2026.8.9] — 2026-08-17

- Directory group structure: Entra query-based groups and AD nesting chains detected from the collectors; permissions say whether a holder is a direct member or holds via a chain.
- Systems as a first-class permission dimension: per-system spend, risk, coverage and drawer, plus a finding for systems outside the rule model.
- Classic role model ported: relevance/lift role cards, exception lists and discovered clusters as Mining tabs, with lift explained where it is shown.
- Answers to the public feedback board: per-rule people export, entitlement description notes, and an import-blocker pre-flight.

## [2026.8.8] — 2026-08-16

- Name-generation workbench: conventions as live instruments with collision testing, per-person iteration ladders and aligned intake previews.
- Mining hygiene: exclusions, a rule-name template and a deepest-group preference; Manager dropped as a pyramid attribute (derived, not structural).
- Mined rules open from the whole row and name their audience in the drawer.

## [2026.8.7] — 2026-08-14

- Nedap ONS workbench: the matrix workbook imported as editable data, scope-mapping and medewerkers tabs managed in-app, connector CSVs exported, and the official mapping CSVs imported for id↔name translation.
- Risk and Cost split into tabs; every hero tile on Overview and Cost is clickable.

## [2026.8.6] — 2026-08-13

- Matching workbench: scored candidates per unowned account, human decisions in an exportable match book, a paged approval flow, and a generated fix script that writes the matching attribute to AD or Entra (dry-run by default).
- The Entra connector intake answered from a collector run; collectors survive schema-less attributes and log progress.
- Synthesized data carries its provenance, and the synchronous builds got a busy veil.

## [2026.8.5] — 2026-08-10

- Unified classification: one layered engine for account classes and workforce categories, with linked pricing and risk multipliers.
- Directory import: read-only AD/Entra collector scripts, downloadable from the Directory slot, feed a pre-HelloID analysis without any HelloID export.

## [2026.8.4] — 2026-08-05

- Health checks on every import, surfaced in the sources overview; parsing assumptions hardened.
- Naming-convention analysis: scheme detection, migration signals and strays.
- Leaver assurance, mover revoke checklists and bus-factor analysis.

## [2026.8.3] — 2026-08-04

- Every import optional: each view says what it needs and locks until it has it.
- Contract history read as history: flow, movers, managers, latency, creep and a licence forecast, cut by department.
- Attestation packs previewed before export, and the access review assembled per manager.
- Settings split into tabs; the model build made near-linear in import size.

## [2026.8.2] — 2026-08-03

- Peer analysis: people who hold the same access, and defensible copying.
- The model builds once per import batch; the views module split at its seams.

## [2026.8.1] — 2026-08-02

- Vault, granted-entitlements and activity imports; business rules compared against the reconciliation export and evaluated against the vault.
- Role mining: attribute pyramid from the organisation’s own shape, bundle mining as the fallback, coverage reported to the board.
- Every reconciliation row explained, with the residue named.
- A fictional demo tenant, impossible to mistake for a real one; account-to-person matching made tunable.

## [2026.7.1] — 2026-07-29

- Initial release: HelloID reconciliation analytics — risk, cost and findings over the reconciliation export, English and Dutch, self-hostable, no dependencies.
