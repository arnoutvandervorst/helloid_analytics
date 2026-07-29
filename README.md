# HelloID Reconciliation Analytics

A local, dependency-free dashboard for HelloID reconciliation exports. Drop a
`ReconciliationReport.csv` on the page and it builds the account ↔ entitlement ↔ person
graph, scores risk, prices the licence drift, and diffs the run against any earlier import.

Nothing leaves the browser: no build step, no CDN, no network calls.

## Run it

```bash
./serve.sh            # http://localhost:8123
```

Opening `index.html` (or the bundled single file) directly from disk also works, but
browsers give `file://` pages an opaque origin, so snapshots cannot be persisted and the
"load the CSV from this folder" button is blocked. Over http both work.

Import by dragging a CSV anywhere onto the page, or via **Import CSV**.

No reconciliation export is committed to this repository — they carry account and person
names, so `*.csv` is gitignored. Drop your own export in this folder and the "load the CSV
from this folder" button picks it up; drag-and-drop works regardless of where the file sits.

## Distribute it

```bash
python3 build.py
```

produces two things in `dist/`:

| Artefact | What it is | Use it when |
| --- | --- | --- |
| `reconciliation-analytics.html` | ~270 KB single file, every script, stylesheet and the logo inlined | mailing it, dropping it on a share, handing it to a customer. Double-click opens it; drag the CSV on. Snapshots stay in the tab unless it is served over http. |
| `reconciliation-analytics-1.0.0.zip` | the folder form, plus `serve.sh` | the customer wants diffing across sessions, or you want to keep editing it |

Both are static: no install, no runtime, no network access. If you want it permanently
available for a team, the folder can also be dropped on any static host (an internal IIS
vdir, S3, a share served over http) — there is no back end to deploy.

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
| `Person` | `Name (employeeId)` is split; drives the identity-coverage metric. |
| `AccountDisplayName`, `AccountUserName` | Account identity and class detection. |
| `AccountEnabled` | Dormant-but-entitled and licence-waste detection. |
| `PermissionDisplayName` | `NAME (dn/path)` is split into group name and OU path. |
| `Issue` | `Account unmanaged` / `Permission unmanaged` / `Permission missing`. |
| `Resolution` | Rows already dispositioned in HelloID are surfaced separately. |

**Rows are not equal.** One `Account unmanaged` row describes an identity; a
`Permission unmanaged` row describes one edge of that identity's entitlement graph. The
model rolls rows up into 3 entity types — accounts, permissions, persons — and every number
in the UI is computed on entities, not on line counts.

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

Every import is stored as a snapshot in IndexedDB. Selecting a baseline rebuilds that
snapshot's full graph and compares entities, not rows: accounts added/removed/changed,
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
