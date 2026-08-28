# HelloID Analytics

A self-hostable, dependency-free dashboard for HelloID exports. Drop any HelloID export
on the page and it shows the most analysis that export can carry — every import is
optional, and each one deepens the model rather than gating it.

The **reconciliation** (`ReconciliationReport.csv`) is the base of the access analysis: the
account ↔ entitlement ↔ person graph, risk scoring, licence drift pricing, and the diff
against any earlier import. The **vault** (people and contracts) powers the people and
organisation views on its own — org walker, department scorecards, workforce analytics,
attestation packs — and, joined with the reconciliation, makes rule conditions evaluable
and separates leavers from unowned accounts. The **business rules** split entitlements into
modelled, draft-only and unmodelled; **granted entitlements** and **historic actions**
distinguish "granted outside HelloID" from "granted by HelloID and not recorded", and turn
a missing entitlement into a failed grant on a date; the **product catalogue** and
**product assignments** connect Service Automation requests and approvals to the access
they explain.

A view whose exports are missing is not hidden: it wears a lock in the sidebar and renders
a page naming exactly which export unlocks it, what that export contains and where in
HelloID it lives. Load only a vault and the people views work; add the reconciliation later
and everything merges — the model is rebuilt from whatever is loaded, so import order never
changes the outcome.

Serve it from a laptop or any static host — it is plain files, with no build step,
no CDN and no back end. Wherever it runs, the exports are read and analysed in the browser
that opened the page: they are never uploaded to the host serving it.

## Demo data

`make-demo-set.py` writes a fictional organisation into `demo/`: six exports describing
the same invented people, so the vault, the rules and the activity files actually join.
Where that directory is published, the Imports view offers to load all six in one click.
While it is loaded, a banner sits above every view and every page of the board report
carries a printed mark, because a PDF outlives the tab it came from.

```bash
python3 make-demo-set.py                 # -> demo/*.csv, demo/vault.json, demo/manifest.json
python3 make-demo-set.py --rows 20000    # a larger tenant
```

Everything in it is invented — names from a fixed word list, employee numbers counting up
from 500000, avo.local as the domain. It is the only CSV/JSON the shipped nginx config is
allowed to serve; every other export path is denied.

## Run it

```bash
./serve.sh            # http://localhost:8123
```

Opening `index.html` (or the bundled single file) directly from disk also works, but
browsers give `file://` pages an opaque origin, so snapshots cannot be persisted and the
sample loader is hidden. Over http both work.

**Import** in the top bar opens a slot per export — what it is, what it unlocks, where in
HelloID it comes from, and whether it is loaded. A slot only accepts its own kind of file,
and every slot can be replaced or removed independently; removing the reconciliation keeps
the snapshot archive, so the Snapshots view can bring any earlier import back. Dragging a
file anywhere onto the page still routes it on content.

No reconciliation export is committed to this repository — they carry account and person
names, so `*.csv` is gitignored. Drop your own export in this folder and the "load the export
from this folder" button picks it up (it looks for `ReconciliationReport.csv`, then
`sample-recon.csv`); drag-and-drop works regardless of where the file sits.

### Sample data

```bash
python3 make-sample.py                  # 5,000 rows -> sample-recon.csv
python3 make-sample.py --rows 50000     # for performance work
python3 make-sample.py --systems 2      # multi-system export
python3 make-sample.py --seed 7 -o next.csv   # a second run to diff against the first
```

Fictional names, HelloID-shaped group naming, and enough of every case that all fifteen
finding rules have something to fire on: unowned admin accounts, disabled accounts still in
licence groups, stacked SKUs, a security baseline at ~88% coverage, break-glass groups with
two members, rows already dispositioned in HelloID. Output is deterministic per seed, so two
seeds give you a pair of exports to try the diff on. The generated file is gitignored like
any other export.

## Distribute it

```bash
python3 build.py
```

produces two things in `dist/`:

| Artefact | What it is | Use it when |
| --- | --- | --- |
| `reconciliation-analytics.html` | ~270 KB single file, every script, stylesheet and the logo inlined | mailing it, dropping it on a share, handing it to a customer. Double-click opens it; drag the CSV on. Snapshots stay in the tab unless it is served over http. |
| `helloid-analytics-<version>.zip` | the folder form, plus `serve.sh` | the customer wants diffing across sessions, or you want to keep editing it |

Both are static: no install, no runtime, no network access. If you want it permanently
available for a team, the folder can also be dropped on any static host (an internal IIS
vdir, S3, a share served over http) — there is no back end to deploy.

## Versioning

Versions are CalVer: `YYYY.M.N` — the Nth release of that month. The source of
truth is `js/changelog.js` (newest entry on top); the topbar version, the About
card in Settings, the in-app "What's changed" drawer, `build.py`'s zip name and
[CHANGELOG.md](CHANGELOG.md) all read from it. When a change set ships: add an
entry at the top of `js/changelog.js`, then regenerate the markdown with

```bash
node make-changelog.js
```

Each release is also tagged and published on GitHub:

```bash
git tag -a v<version> -m "<version>"
git push origin --tags
gh release create v<version> --title "<version>" --notes "<the entry's bullets>" --latest
```

## Languages

Everything — interface, findings, board report and the Markdown export — is available in
**English and Dutch**, switchable from the top bar. Numbers, currency and dates follow the
selected language. The default follows the browser. All strings live in `js/i18n.js`;
adding a third language means adding one more block there.

## Board report

The first view is a print-ready **board report**: A4 pages, plain language, no scores
without a sentence explaining what they mean. Cover with the overall assessment, a
one-page summary, a traffic-light table of themes, the money page, change since the
previous review, a numbered recommendation list with effort and yearly saving per action,
and a short method page. **Export PDF** opens the browser print dialog — choose *Save as
PDF*, A4 portrait. Organisation, author and date are filled in above the sheets and are
not printed.

## Branding

Three slots, because a square app mark and a wordmark are not interchangeable:

| Slot | File | Used for |
| --- | --- | --- |
| icon | `assets/icon.svg` \| `.png` | top bar, browser tab |
| logo | `assets/logo.svg` \| `.png` | wordmark on light backgrounds |
| logo (dark) | `assets/logo-light.svg` \| `.png` | wordmark on the report cover's dark chip |

Files dropped in `assets/` are detected automatically and inlined into the single-file
bundle by `build.py`. Anything uploaded under **Settings → Report branding** is stored in
the browser as a data URI, which is what makes it survive into the printed PDF. Each slot
falls back to the next; with none at all the app shows a neutral gradient tile. The same
panel sets the product name shown in the title bar.

## Hosting it

`Dockerfile` + `docker-compose.yml` serve the folder from nginx on loopback, fronted by a
Cloudflare tunnel — see `DEPLOY.md`. Only `index.html`, `css/`, `js/` and `assets/`
enter the image; `.dockerignore` keeps exports out and nginx returns 403 for `.csv`/`.json`
outside `/assets/` in case one is ever copied onto the host.

Nothing needs protecting server-side: the page ships no data, makes no network calls, and
every visitor starts empty and drags in their own exports.

## What the app stores in your browser

Everything stays client-side, and all of it is listed — with live sizes, per-store
clear buttons and a clear-everything — under **Settings → Storage**:

| Store | Holds |
| --- | --- |
| localStorage `hr.config.v1` | settings and decisions: taxonomy, prices, weights — and the match book, Nedap book, classification overrides and permission notes (these contain names from your data) |
| localStorage `hr.brand` | uploaded logos and the product name |
| localStorage `hr.nav.v1` / `hr.theme` / `hr.lang` | UI preferences |
| IndexedDB `helloid-recon/snapshots` | one snapshot per reconciliation import, for the Diff view |
| IndexedDB `helloid-recon/context` | the raw text of every companion import (vault, directory, rules, activity, …) so a session survives a reload |

The same tab has the kill switch: **Remember data in this browser** off wipes all of the
above and turns every save path into a no-op — the session keeps working in memory and
forgets on reload. Only that preference itself persists, so the choice sticks. The first
persisting import announces itself once with a pointer to this tab. Everything
configurable also travels by file (settings, match book, Nedap book, snapshot bundle);
note the settings file contains the decisions and books, names and employee ids included.
Anonymous usage statistics (event names and size buckets, never data) have their own
toggle on the same tab.

## Configuration review on import

Every import stops at a **review step** before any number is shown. It reports how much of
*this* export the current settings actually describe — permissions categorised, accounts
classified, groups priced — and proposes rules mined from the export's own naming:

- **permission categories** from prefixes that no current rule matches, with a sensitivity
  pre-filled from the prefix itself where it is recognisable (`BEH-`, `SRV-`, `SEC-`…)
- **account classes** from recurring name shapes. Marker vocabulary (`adm-`, `svc-`, `ext_`)
  is proposed from two accounts up; anything else has to be common enough in the export to
  look deliberate. `firstname.lastname` is treated as a naming convention, not a marker, so
  surnames are not proposed as classes.
- **groups that look priceable** but have no price yet, so licence spend is not silently zero

Each proposal shows how many names it matches right now, is editable before it is applied,
and nothing is written until you select it. **Continue without changes** skips the lot;
a checkbox turns the step off for future imports (re-enable in Settings by resetting).

A **pattern tester** sits on the same page and in Settings: type a regex, pick permission or
account names, and see the match count, a sample of hits, and a warning when the pattern is
invalid or matches everything. Every rule row in Settings also shows its live match count
against the loaded import.

## Business rules

Drop a HelloID business-rule export (`Name,EntitlementCount,PersonsLatestEvaluation,Categories,Status,Conditions,Entitlements`) on the same page — it routes by header, no second import button — and it is joined against the reconciliation export on distinguished path, falling back to system + name for systems that export none (Exchange Online, TOPdesk, Azure).

Rules stack, so an entitlement counts as described when *any* rule grants it; there is no precedence to resolve. That splits drift into two problems with opposite fixes:

| | Meaning | Fix |
| --- | --- | --- |
| A live rule grants it | The model is right, the rule is not reaching these people | Conditions or evaluation |
| Only a draft rule grants it | The model exists, switched off | Publish it |
| No rule grants it | Gap in the model | Write the rule |

Five findings come out of the join: entitlements a rule grants that the target system does not have, draft rules already covering live drift, live rules that match nobody while their groups have holders, access no rule describes, and failed grants traced to the rule that should have delivered them.

Conditions are parsed (`Department.ExternalId, one of`, `Custom.Vrijgesteld, not only`, `Time frame`) and shown, but **not evaluated** — deciding who matches needs personnel data neither export carries.

## Proposed rules

The backlog says which groups no rule describes; it does not say how to describe them, and one rule per group would be the wrong answer. `js/roles.js` mines frequent itemsets (apriori, level-wise with pruning) over account entitlement sets, restricted to the unmodelled groups, and proposes the bundles that accounts hold together.

Two choices decide whether the output is useful rather than merely true: rank on **cohesion** (how often the rarest group in a bundle brings the rest with it) rather than frequency, since the most frequent bundles are the groups everyone has; and keep **maximal** bundles, capped per role family, since every subset of a frequent bundle is itself frequent.

Each proposal carries its members, its exceptions (accounts holding all but one group — the rule either absorbs them or exposes them), the assignments it would bring under management, and its licence cost. Proposals export in the HelloID rule format so they can sit next to the real ones. The **condition is left empty on purpose**: which department or title should receive the bundle lives in HR data, and the member list is the evidence to write it from.

Mining is cached per model, samples above 5,000 accounts, and raises its support floor with the population — 97 ms on the 5k export, ~50 ms at 50k and 200k.

## Explanations

The point of loading the other files. A reconciliation export states differences without
saying what caused them, so every row arrives with the same weight. `js/explain.js` walks
each row and attaches its strongest available justification — a rule that grants it, a role
bundle it travels in, a former owner, a link to someone's main account, a disposition
already recorded in HelloID — and reports what is left.

Explanations are ranked by how much they settle: **strong** (cause identified, next action
mechanical), **likely** (rests on a name match or a statistical pattern), **weak** (narrows
the question without closing it).

The residue is the deliverable. Rows nothing accounts for are what genuinely need a person,
they are grouped by account rather than listed one by one, and their count is a better
progress measure than the raw finding total because it falls as the model improves rather
than as the data changes.

Each input raises the share, measured on the demo trio:

| Loaded | Rows explained |
| --- | --- |
| reconciliation only | 21% |
| \+ business rules | 24% |
| \+ vault | 32% |

## Vault export

Drop a HelloID Vault export (JSON: `{ Persons: [...], Departments: [...] }`) on the page and
the analysis stops being limited to what the target system shows. `DisplayName` is
`Name (ExternalId)` — the same string the reconciliation export puts in its Person column —
so the two join without fuzzy matching.

What the vault makes possible:

- **Conditions become evaluable.** `js/evaluate.js` resolves each clause against real
  attributes: `Department.ExternalId`, `Title.*`, `Location.Name`, `Type.Code`,
  `Custom.*`, `Person: active`, and the `Time frame` window against contract dates. A rule
  that selects nobody now reports *which clause* excluded everyone.
- **Drift per person, not per group.** Expected entitlements are the union over every rule
  a person matches (rules stack), compared against what their accounts actually hold.
- **Leavers.** Every contract ended while an account is still enabled — invisible to the
  reconciliation export alone, which knows the account is on but not that the employment
  behind it is over.
- **Unowned accounts get names.** `js/correlate.js` scores unowned accounts against vault
  people. The most useful class is former employees: correlation is the first thing that
  breaks when someone leaves the source, so their account arrives as an orphan with no
  trace of who it was.
- **Secondary accounts get linked.** An `adm-` or function account rarely has its own person
  record, so reconciliation calls it ownerless. It is not — the owner is the person holding
  the main account, and that is who should be recertifying it and losing it on departure.

A clause whose facet the engine does not recognise makes the rule *indeterminate* for that
person, never silently true. Matching is scored and never automatic: ties are reported as
ties rather than guessed.

Vault exports carry person and contract data, so `vault*.json` is gitignored alongside the
CSV exports.

## Settings file

Settings live in the browser, which means a bundle opened straight from disk starts fresh
every run. **Settings → Export settings file** writes the whole tunable model — price book,
taxonomy, account classes, risk weights, effort model, branding, language — to one JSON
file. Import it from the same panel, or just drop it anywhere on the page.

## Performance

Measured in Chrome on the real 5k-row export and on synthetic 50k/200k exports:

| Rows | Accounts | Parse | Build (graph, risk, cost, findings) | Views | Heap |
| --- | --- | --- | --- | --- | --- |
| 5,188 | 450 | 24 ms | 47 ms | < 30 ms | ~40 MB |
| 50,000 | 3,936 | 147 ms | 466 ms | < 130 ms | ~135 MB |
| 200,000 | 15,798 | 750 ms | 480 ms | < 200 ms | ~790 MB |

A 50k import is about six tenths of a second end to end. Peer similarity — the one
quadratic part — uses an index of each account's rarest groups instead of comparing every
pair, which is what keeps 50k at 0.5 s rather than 2.7 s. Where every group an account
holds is ubiquitous, there is no comparable account and the outlier column reads `—`
rather than inventing a maximum. The overview scatter samples above 4,000 accounts and
says so in its subtitle.

## What it reads

The parser auto-detects the delimiter (`,` `;` tab `|`), handles quoted fields and BOM, and
maps headers by alias, so exports from other HelloID versions or locales still load. Only
`AccountUserName` and `Issue` are strictly required.

| Column | Used for |
| --- | --- |
| `System` | Multi-system exports are kept separate; keys are `system + account`. |
| `Person` | Taken verbatim as the display name; drives the identity-coverage metric. Employee ids come from the vault, which states them as a field. |
| `AccountDisplayName`, `AccountUserName` | Account identity and class detection. |
| `AccountEnabled` | Dormant-but-entitled and licence-waste detection. |
| `PermissionDisplayName` | `NAME (dn/path)` is split into group name and OU path. |
| `Issue` | `Account unmanaged` / `Permission unmanaged` / `Permission missing`. |
| `Resolution` | Rows already dispositioned in HelloID are surfaced separately. |

**Rows are not equal.** One `Account unmanaged` row describes an identity; a
`Permission unmanaged` row describes one edge of that identity's entitlement graph. The
model rolls rows up into 3 entity types — accounts, permissions, persons — and every number
in the UI is computed on entities, not on line counts.

## Before HelloID: the directory import

The chicken-and-egg problem of pre-implementation analysis: the useful exports need
HelloID, and implementing HelloID well needs the analysis. Two read-only collector
scripts break the loop — `collect-ad.ps1` (on-prem AD, plain `Get-ADUser`/`Get-ADGroup`)
and `collect-entra.ps1` (Entra ID via Graph, delegated read-only scopes documented in
[docs/ENTRA-CONSENT.md](docs/ENTRA-CONSENT.md)). The customer runs one script, gets one
JSON file, and drags it in; nothing is installed and nothing leaves their hands.

The import synthesizes both sides of the model from that one file: memberships (nested
groups flattened to effective holdings, the via-chain kept) become reconciliation rows —
all `Permission unmanaged`, which before an IAM system is the literal truth — and the
users' attributes (employeeType, department, title, manager, extensionAttribute1-15,
phones, address) become a pseudo-vault, so classification, naming analysis, employee
categories, licence pricing and the org views all run. Both substitutes step aside the
moment a real export of their kind is loaded.

The Conventions → Attributes tab is the point of the exercise: per attribute the fill and
value distribution, and the value → group pairs strong enough (≥5 people, ≥80% holding,
clearly above baseline) to become HelloID business-rule conditions or connector mappings.
`make-directory.py` generates a fictional envelope to try it without a tenant.

## Field-mapping simulation

Import the target connector's field mapping — the HelloID UI's mapping export,
a connector repo's `fieldMapping.json` (Version v1), or the older
`accountMappings` shape still common in the HelloID-Provisioning repo — and see
it as data: per
field the mode per provisioning action (Fixed / Field / Complex / None),
uniqueness, standard-vs-customized, with the decoded value or JavaScript in a
drawer. Then the payoff: the **Simulation** tab evaluates every in-scope field
for every person against the mapping — Complex mappings run faithfully, with the
Person object, `Iteration` and `deleteDiacriticalMarks` exactly as HelloID
provides them, each field against a fresh Person copy — and diffs the result
against the attribute the collected AD/Entra directory holds today. The output
is the answer no HelloID screen gives up front: which attributes an update run
would rewrite, per field and per person, current → would-become, exportable.
`None` on Update is honoured as out-of-scope, a real vault gives full-fidelity
Person objects (the raw export is replayed), and without one the simulator
reconstructs Persons from the collected directory and says so. Source mappings
(HR → person model) are recognised and refused with a pointer to the right
export.

## Classic role model

The old role-mining report's presentation, ported and fed live: attribute roles
(Everyone / department / job title / department+title) over the correlated
population, each permission scored with **relevance** (share of the role holding
it) and **lift** (relevance against the org-wide baseline — 90% relevance means
nothing for a group 90% of the organisation holds), the two exception lists a
rule would create ("who misses it" / "outside the role"), globals folded away,
cumulative coverage per card, and role-to-role similarity. Mining → Classic;
Mining → Clusters adds the de-facto roles: account populations whose access
clusters together regardless of HR attributes, with a **discovered** flag when
no dominant department/title explains them — access the org chart does not
predict. Permission drawers gain the inverse view: which classic roles a
permission's holders sit in. Mining-hygiene exclusions apply here like in every
other engine; knobs (relevance floor, occupants, cluster thresholds) live in the
settings under `classic`.

## Systems as a dimension

Permissions come from every target system the reconciliation covers, and the
suppliers are judged as first-class citizens: per system the model rolls up
spend, mean/max risk, unmanaged share, rare and privileged counts, and — when
rules are loaded — how much of the system the rule model covers. The Permissions
view gains a by-system comparison and a system filter/column (multi-system
tenants only), every system name in a drawer links through to a system drawer
(stats, coverage, its permissions, issue breakdown), and a finding names systems
that sit wholly outside the rule model while others are covered. The AD/Entra
collector enrichment (nesting, query-based groups) stays a bonus on top — the
system dimension itself is generic over any connector.

## Directory group structure

Directories run RBAC of their own: Entra query-based (dynamic) groups whose
membership is a rule, and AD group nesting used as abstraction — role groups made
members of the groups that actually sit on resources. The directory import reads
both: every group is classified as a **nesting terminal** (contains other groups,
member of none — the group that actually grants), an **abstraction layer** (member
of other groups; its access is expressed by the terminals it feeds), or plain, with
the nesting depth per group. Query-based groups carry their membership rule. The
Permissions view shows the structure (dynamic groups with their rules, abstraction
layers with what they feed), permission drawers carry the badges, and mining
prefers the terminals: with "prefer the deepest groups" on (default, Mining →
hygiene), query-based groups and abstraction layers stay out of rule proposals —
the mined roles grant the real permissions, not the layers above them.

## Matching workbench

Account↔person matching is scored evidence (vault correlation, employee ids, name
conventions — weights and threshold tunable in Settings, with a live preview). The
Matching view is where a human finishes the job: every account with its attribution and
score, a review queue of the unmatched and ambiguous ones with candidates shown even
below the threshold (the duplicate-provisioning risk made visible), and per account
confirm / assign / reject / mark-ownerless. Decisions land in the **match book** — its
own export/import file, so the hard tenant is worked out once and the answers travel to
the next session or colleague. Confirmed decisions can be written back: the view
generates a `fix-matching-*.ps1` that sets the matching attribute (employeeID,
extensionAttribute, …) in AD or Entra — read-only by default, writes only with `-Apply`,
and containing exclusively human-decided rows. Approval scales in pages: 25 accounts at
a time, easiest first, each row preselected to its best candidate with the alternatives
in a dropdown and the checkbox as veto — glance, switch the odd one, approve the page,
move on. Every page is one undoable batch in the match book; zero-candidate classes
offer mark-all-ownerless. A vault `Accounts[]` reference is treated as recorded truth
and never asks for approval. The same card lives in the account drawer as **Person
link**: an unlinked account shows its top candidates right there, a linked one shows
the attribution and the means to override it, and every decision reopens the drawer on
the rebuilt account.

## Nedap ONS workbench

Customers feed the HelloID Nedap ONS target connector from the "NEDAP - Matrices
functies deskundigheden" Excel workbook: names typed by hand, hidden helper formulas
translating them to IDs, and a manual save-as-CSV per tab. The **Nedap ONS** view
replaces that workflow. Drop the workbook (.xlsx) anywhere on the page — it is read
entirely in the browser, no library, nothing uploaded — and the two scope-mapping tabs,
the Medewerkers koppeling, the Autorisatierollen matrix and all lookup sheets become an
editable **Nedap book** (its own export/import file, like the match book). Starting
blank works too: fill the lookup lists first (pasting columns from Excel works), then
add rows.

The editors validate live against the loaded vault — the connection the Excel never
had: department and title pickers suggest real HR values, and the health tab flags
unresolvable names, wildcard-shadowed rows, redundant or empty grants, duplicates and
names HR does not know. Coverage lists every person no scope row reaches. These also
surface as findings under Risk & findings, because Nedap provisioning is **full-set**:
the connector PUTs the complete desired state per source, there is no reconciliation
behind it — a dropped row is a revoked entitlement, and these checks are the only
warning anyone gets. A simulator shows per person (or per manual department/title
pair) exactly what the connector would apply, with the contributing rows named.

Export produces the three connector files deterministically —
`MappingTeams.csv`, `MappingLocations.csv` (official headers:
`HelloIDPrimaryLookupKey;HelloIDSecondaryLookupKey;NedapTeamIds;AllEmployees`) and
`MedewerkersKoppeling.csv` (the orange tab column-for-column) — with names resolved to
IDs through the lookup lists at export time; a row that cannot resolve is blocked and
reported instead of silently wrong. The reverse direction works too: drop a running
connector's `Mapping-Teams.csv` / `Mapping-Locations.csv` (official headers, the
unnamed-flag-column variant, or the `Department.ExternalId` naming) and its raw IDs
become editable names through the lookup lists — IDs the lists do not know are added
there as id-named entries, so a blank start from just the connector CSVs edits and
round-trips exactly, and picks up readable names the moment somebody fills them in.

## Name-generation workbench

The connector intake's Naamgeneratie section asks customers to specify, per generated
field (last name, display name, mail, proxyAddresses, UPN, mailNickname), a
first-choice recipe, fallbacks for when a name is taken, and whether iterations are
synchronised — and customers cannot picture how a convention plays out. The
Conventions view's **Design & test** tab makes it a live instrument: author each
field from tokens (`{roepnaam}.{tv}{geboortenaam}@{domein}`, `{i}` as the counter in
the last fallback), and every edit re-simulates over the real vault population,
colliding against the existing directory names when a directory import is loaded.
The output is the intake's own tables — the fixed test person (Janine, van den
Boele / de Vries) under all four name preferences — plus the population result:
who needs a fallback, who exhausts the variants, iteration depths, HR duplicates,
length violations, and clean diacritics handling. "Export intake answers" produces
the filled tables as markdown; the mined conventions on the Name generation tab
offer "Adopt as draft" to seed the editor with what the tenant does today.

Mining hygiene (on the Mining view's model tab): matcher rules that keep noise
entitlements out of every mining engine, and a naming template for exported rule
proposals — the exclude/name-template asks from the HelloID feedback board.

## The models

All three are assumptions, all three are editable in **Settings**, and every change
re-scores the loaded snapshot immediately.

### Risk

Each account gets a 0–100 score summed from named components, visible in the account
drawer:

- **Unowned identity** — unmanaged account, no linked person while enabled, privileged and
  unowned. Scaled by account class (admin ×2.4, test ×1.8, external ×1.7, service ×1.6).
- **Dormant but entitled** — disabled account keeping group memberships, extra if licensed.
- **Entitlements outside the IAM model** — unmanaged assignments with diminishing returns
  and a cap, multiplied by the average sensitivity of what is held.
- **Missing entitlements** — granted by rule, absent on the account.
- **Rare entitlements** — groups held by ≤3 accounts.
- **Peer-group outlier** — Jaccard similarity against the closest account by shared
  entitlements; a profile with no neighbour is an undocumented exception.
- **Stacked licence SKUs** — more than one licence group on one account.

Permissions get their own score from sensitivity, share of unmanaged assignments, share of
unowned/disabled holders, blast radius and rarity.

The overall score is `0.40 × weighted mean account risk + 0.35 × share of accounts at
high/critical + 0.25 × identity coverage gap`, shown as a table on the Risk view.

### Cost

The price book matches group names by regex and costs them per holder per month.
Unpriced groups count as **zero**, so every total is a floor, never an inflated estimate.
Waste is split by confidence:

- **Hard (recoverable now)** — disabled accounts still in licence groups; stacked SKUs net
  of the richest one.
- **Exposure** — spend on unowned but enabled accounts. Not a saving until someone decides
  the account should not exist.

Clean-up effort is minutes-per-work-item × loaded hourly rate, which gives the payback
period on the recoverable waste.

### Findings

Fifteen rules over the graph, ordered by severity then by money at stake. Each carries what
it is, why it matters, the remediation, and the affected entities (exportable to CSV).
The whole analysis exports as a Markdown report from the Risk view.

## Diff

Every reconciliation import is stored as a snapshot in IndexedDB. The baseline is picked
on the Diff view (each new import auto-baselines against the previous one); companions are
not versioned, so a historic diff uses the currently loaded vault and rules on both sides.
Selecting a baseline rebuilds that snapshot's full graph and compares entities, not rows: accounts added/removed/changed,
entitlements granted and revoked per account, membership movement per group, findings that
grew, shrank, appeared or resolved, and the cost delta. Importing a file that is
byte-identical to an existing snapshot reuses it instead of duplicating.

Snapshots export to JSON (Snapshots view) so they can be moved between machines or kept
under version control.

## Layout

```
index.html          shell + script order
css/app.css         tokens (light & dark both selected), components
js/i18n.js          every user-visible string, EN + NL, with {param} interpolation
js/util.js          formatting, DOM helper, tooltips, CSV/download
js/brand.js         logo + report title block
js/parse.js         RFC4180 parser, delimiter sniffing, header aliasing
js/config.js        taxonomy, account classes, price book, risk weights (localStorage)
js/model.js         entity graph, peer similarity, summary
js/risk.js          account + permission scoring
js/cost.js          spend, waste buckets, effort, payback
js/findings.js      the rule engine
js/diff.js          snapshot comparison
js/store.js         IndexedDB snapshots (+ in-memory fallback, JSON import/export)
js/charts.js        SVG/DOM charts: bars, stacked, histogram, scatter, line, heatmap
js/table.js         sortable/filterable/paged table with CSV export
js/views.js         analyst views + drawers + Markdown report
js/board.js         the printable board report
js/app.js           state, routing, language switch, import pipeline
build.py            single-file + zip bundler
make-sample.py      synthetic export generator (no real data ships here)
devserve.py         no-cache static server used by serve.sh
```

## Known limits

- Default prices are public EUR list prices, not your contract. Correct them first if the
  cost numbers are going in front of anyone.
- Peer-similarity is exact pairwise and switches itself off above ~8M candidate pairs
  (roughly 10k+ accounts sharing common groups); the outlier signal then reads 0.
- `PermissionConfigurationDisplayName` and `SubPermissionDisplayName` are parsed and kept on
  the record but are empty in AD exports, so nothing is built on them yet.
- Account-class and category detection is regex on naming convention. If your naming
  differs, fix the patterns in Settings before trusting the class rollups.
