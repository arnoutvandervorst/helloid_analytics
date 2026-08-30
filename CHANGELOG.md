# Changelog

Versions are CalVer (`YYYY.M.N` — Nth release of that month). This file is
generated from `js/changelog.js` by `make-changelog.js`; edit there, not here.

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
