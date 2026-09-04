/* The product's version and release history, as data.

   Scheme is CalVer: YYYY.M.N — year, month, Nth release within that month
   (N resets when the month rolls over). One release = one deployed change
   set; there is no build step, so this file IS the source of truth: the
   topbar, the Settings About card, the in-app changelog drawer and the
   generated CHANGELOG.md all read from here.

   Bump rule: when a change set ships, add a new entry at the TOP of ENTRIES
   and regenerate the markdown with `NODE_OPTIONS= node make-changelog.js`.
   Entry text is English release notes — content, not UI chrome — so it is
   deliberately outside the i18n dictionaries.

   The first twelve entries are a retroactive read of the git history
   (104 commits, 2026-07-29 → 2026-08-28), grouped per feature arc. */
(function (HR) {
  'use strict';

  const ENTRIES = [
    {
      version: '2026.9.36', date: '2026-09-04',
      changes: [
        '“Load demo” fetches the demo files bypassing the browser cache. A deploy had briefly left the demo set off the host and the CDN in front handed browsers a four-hour TTL on the resulting 404s; the files are back and the fetch no longer trusts a cached answer.'
      ]
    },
    {
      version: '2026.9.35', date: '2026-09-04',
      changes: [
        'A control’s link lands on the thing itself. “See finding” on Compliance now opens Risk & findings with that one finding expanded, highlighted and scrolled into view, and is only offered when the finding actually fired. Every other control has an “open →” link to the page and tab it reads from — leavers, workforce, attestation, engine health, decisions, admin access, toxic combinations, accounts (unowned filter), people, permissions, business rules — instead of a page where the reader still had to look.'
      ]
    },
    {
      version: '2026.9.34', date: '2026-09-04',
      changes: [
        'Every compliance limit in one place. Settings › Weights & thresholds gains a “Compliance limits” table: each control with its shipped default, what is set now (marked when it differs), when it last changed, and a reset per row. The Edit fold on a Compliance row now says the default next to the limit. The limits themselves were always editable per row and saved with the settings file; the defaults live in the control catalogue.'
      ]
    },
    {
      version: '2026.9.33', date: '2026-09-04',
      changes: [
        'The Entra collector can use a saved profile too. collect-entra.ps1 -AppOnly signs in as an app registration (tenant id, client id, client secret — asked once, kept in helloid-config.json alongside the HelloID keys) for scheduled, unattended collections; it needs the same three permissions as Application permissions with admin consent. The interactive sign-in stays the default: it leaves no secret on disk and its consent is revocable. docs/ENTRA-CONSENT.md explains both.'
      ]
    },
    {
      version: '2026.9.32', date: '2026-09-04',
      changes: [
        'helloid-export.ps1 verified against a live tenant and fixed: a page variable shadowed the page size (PowerShell variable names are case-insensitive), and an empty assignment list came back as one bogus row. Both collectors now produce the same file as their Python twins for the same tenant.'
      ]
    },
    {
      version: '2026.9.31', date: '2026-09-04',
      changes: [
        'The collectors ask for their credentials. helloid-export.py and helloid-audit.py no longer need environment variables or a .env file: the first run asks for the tenant URL, key and secret (the secret typed without echo), says where in HelloID the key is created, and offers to save them as a named profile in helloid-config.json next to the scripts — owner-only, gitignored, never deployed. After that a run just runs; --profile picks another tenant, --setup asks again, --list-profiles and --forget manage the file. The old ways still work for scheduled jobs.',
        'PowerShell twins for consultants without Python: helloid-export.ps1 and helloid-audit.ps1 write the same files with the same progress output, share the profile file with the Python scripts (HelloIDCreds.ps1 / helloid_creds.py), and read the secret with Read-Host -AsSecureString.',
        'Service Automation comes as one file. The export collectors now write helloid-service-automation.json — the product catalogue and the product assignments together, either half may be empty — and the app fills both slots from it; the two older files (products.json, product-assignments.csv) still load, and --legacy / -Legacy still writes them. The Imports view offers every collector for download next to the slot it feeds, also when the slot is already loaded.'
      ]
    },
    {
      version: '2026.9.30', date: '2026-09-04',
      changes: [
        'Who administers HelloID itself. Evidence gains an Admin access tab from the audit log: every portal login per user — how often, through which identity provider, from which countries, on what, last success and repeated failures — and every change to HelloID’s own users and groups split into what the directory sync did and what a person did by hand. MFA is rarely in the log, so the identity provider is the proxy: a Local login bypasses whatever the organisation’s IdP enforces, and the page says so.',
        'Two Compliance controls follow: HelloID logins outside the IdP (max 0 %; ISO A.8.5, BIO 9.4.2, NIS2 21(2)(i)) and administrators with five or more failed logins in 30 days. A Licences tab draws HelloID’s own daily licence counts per module over time. The board’s operations page states who logged in and how; the artifact “Where HelloID stops” describes the audit trail.'
      ]
    },
    {
      version: '2026.9.29', date: '2026-09-04',
      changes: [
        'Engine health, from the audit log. Evidence gains a tab that says whether HelloID itself runs and lands: the share of provisioning actions that failed over the last 30 active days, grouped by system and message with the people behind each group; every source import per system with its last run, result and median duration; people added, removed and blocked per snapshot; evaluations and enforcements with the age of the last one; incidents by component with the open ones listed.',
        'Four Compliance controls read it: provisioning actions that fail (max 2 %), source imports that failed, days since the last evaluation (max 1 — a rule set nobody evaluates enforces nothing) and exclusions without a reason. Each carries its framework references (ISO A.8.15 Logging, BIO 12.4.1) and evidence sentence; findings for failed actions, failed imports, reasonless exclusions and open incidents join Risk & findings; the board report gains a “HelloID operations” page and the pack JSON an operations block.'
      ]
    },
    {
      version: '2026.9.28', date: '2026-09-03',
      changes: [
        'The HelloID audit log is a source. helloid-audit.py pulls it from the tenant’s Elastic API (enabled under admin → Elastic API key; the key stays in a local .env, never in the browser) into helloid-audit.json: every provisioning action with its outcome, every reconciliation issue an administrator excluded with who, why and until when, every threshold approval, every rule publish with the entitlements it added, imports, evaluations, connector changes, portal logins, incidents and licence counts. The collector reports progress per index and per page.',
        'A new Governance view, Evidence, reads it: Decisions (excluded issues with their reason, expiry and whether the access is still held today; threshold approvals; manual unmanages), Rule changes (every publish with entitlements added and removed, scope delta, condition and who pressed publish; a per-rule timeline) and Who did what (each administrator’s footprint). The account drawer says “excluded in HelloID by X on date until Y — reason” next to the finding. The fit check judges the audit log against the vault and the reconciliation.',
        'When no historic-actions export is loaded, the audit log’s provisioning actions stand in for it — joiner latency, failed actions and churn read them unchanged; the export still wins when both are present because it carries the origins.'
      ]
    },
    {
      version: '2026.9.27', date: '2026-09-03',
      changes: [
        'The framework references explain themselves. Click a NIS2 / ISO 27001 / BIO pill on Compliance (or “Show framework references” for all) and the control unfolds two things: how this KPI evidences the articles — one sentence per control tying the measurement to what the articles ask — and, per article, its title and what it requires. NIS2 article 21(2)(i) is quoted verbatim from the Directive in English and Dutch; ISO 27001 and BIO controls are described in our own words and labelled so, because their text is licensed, with a link to the official source.',
        'The board report’s policy page prints the evidence sentence under every control, and gains an appendix with the referenced articles when the “show references” preference is on; the scorecard CSV/JSON and the pack JSON carry the article titles and the evidence.'
      ]
    },
    {
      version: '2026.9.26', date: '2026-09-03',
      changes: [
        'Toxic combinations say what is toxic. Each pair carries the reason it is a pair (an external with admin rights escapes the leaver process; one account administering two domains is one point of full compromise; raising and approving a purchase is the classic fraud path) — shown under the pair list, editable per pair under Settings › Classification. Every violation row now says what made each side match: the category, the word in the permission name, or the account type. The account drawer lists the pairs an account breaks with the same explanation.'
      ]
    },
    {
      version: '2026.9.25', date: '2026-09-03',
      changes: [
        'Service levels become controls. Settings gains the agreed days for joiners, leavers and movers and the interval for privileged reviews; four new Compliance controls measure against them — leavers past the revoke SLA (critical), movers still holding old-department access past the mover SLA, joiners who waited longer than the joiner SLA (from the historic actions), and privileged access reviewed within the interval. The joiner, mover and leaver cards each show how many are over the SLA with the p50 and p90 days.',
        'Attestation closes its loop. A pack that comes back with the Decision column filled (keep / revoke) drops into the importer like any other file: decisions are stored per account and entitlement, travel with the settings file, and the Attestation tab shows reviewed coverage (all and privileged), decisions on file and a revoke checklist CSV of everything decided “revoke” that is still held.',
        'Trend. Every snapshot now carries its finding ids, its twenty largest departments and the leaver SLA breaches, so a finding shows since when it has been open, Snapshots draws open critical controls and leaver breaches over time and lets you follow one department’s €/head and risk across imports, and the board notes findings open in every import for more than 90 days.',
        'The board report becomes a management pack: a scope page with every source file, when it was loaded and what date its data reflects, the settings fingerprint that produced the figures and a sign-off block; new pages for departments, joiners · movers · leavers against the service levels, and the access review; action owners fill from the control owner. The pack exports as one self-contained HTML file and as JSON.'
      ]
    },
    {
      version: '2026.9.24', date: '2026-09-03',
      changes: [
        'Hidden costs. The recoverable figure only ever counted disabled and doubled licences; the money that is burning without a row in it now has its own tile and bucket list on Cost: leavers still licensed (with what it has cost since each contract ended), dormant licences (from the directory collector’s last sign-in), second accounts of one person, spend nobody owns, work still done by hand and rework after failed actions (from the history export, at the loaded rate), and joiners kept waiting (days always; euros once you state a rate). None is added to “recoverable” — each needs a decision, not a cleanup. Every bucket has its people or accounts behind it and a CSV.',
        'True-up. A price-book row can now state how many seats were bought and when it renews; Cost › Spend shows bought against assigned per row — unused seats as shelfware, over-assigned seats as the exposure the vendor charges for — with the days to renewal. The board’s Money page prints the hidden buckets and shelfware next to the recoverable leaks, and five findings carry the same numbers into Risk & findings.'
      ]
    },
    {
      version: '2026.9.23', date: '2026-09-03',
      changes: [
        'Toxic combinations. Separation of duties as data: each pair is two things one account must not hold together — a permission category, a word in a permission name or an account type on either side — checked against every account. Four defaults hold on any tenant (privileged access on an external, test or shared account; two privileged groups on one account; finance with procurement as the example to edit). Violations appear as a tab under Risk & findings, as a finding, as a critical control on Compliance (NIS2 21(2)(i), ISO A.5.3, BIO 6.1.2), and add to the account’s risk; the pairs are edited under Settings › Classification with a live count.',
        'Identity outliers. Every person with access gets an outlier score from three explained factors: how little they share with their closest peer, how much of their access no rule or product hands out, and how much of it fewer than one in a hundred people hold. People gains the column and a tile; the person drawer shows the three factors with the entitlements behind them; a finding lists people scoring 70 or more.',
        'Compliance reads as a scorecard now: each control is what it is and why, where you stand against the limit with a gauge, and who owns it by when — the editing controls fold behind “Edit”. Compliance is also gated on a reconciliation like the other Governance views.'
      ]
    },
    {
      version: '2026.9.22', date: '2026-09-03',
      changes: [
        '“Am I compliant?” gets its own page under Governance: Compliance. Every control now carries a severity (critical, high, medium, low), the framework articles it evidences (NIS2 21(2), ISO 27001:2022 Annex A, BIO) and, where one exists, the finding that computes the same thing. The score is weighted — a failed critical control counts three times a housekeeping one — and the page groups controls by severity, critical first, with a filter per framework.',
        'Each control can carry an owner and a due date, and a failing control can be accepted as a known risk until a date, by someone, for a reason: it then counts as met and says so. Every change to a threshold, owner or exception is logged with what it replaced. The whole scorecard exports as CSV or JSON.',
        'The compliance score travels with every snapshot, so Snapshots gains a “Compliance over time” line and Diff reports it against the baseline. The board report’s policy page prints severity, framework references, owner, due date and accepted exceptions.',
        'The empty page no longer claims everything starts with the reconciliation — a vault alone is a start — and no longer lists the reconciliation’s columns.'
      ]
    },
    {
      version: '2026.9.21', date: '2026-09-03',
      changes: [
        'Sidekick now checks that the imports belong together. Every slot takes any file, so a vault from one customer and a reconciliation from another used to build a model without complaint. Files from one tenant overlap — the vault’s people hold the reconciliation’s accounts, the rules’ departments exist in the vault, the granted export’s people are vault people — and that overlap is measured per pair of sources: reconciliation ↔ vault, granted ↔ vault, history ↔ vault, granted ↔ reconciliation, rules ↔ vault, rules ↔ reconciliation, directory ↔ reconciliation, product assignments ↔ reconciliation.',
        'A pair with well over half its items found “fits”; a few percent “does not fit”. A failing pair shows as a notice on every view and as a toast the moment an import breaks the fit; Sources has the full picture with an example of what was not found. Pairs with too few items on one side are not judged.'
      ]
    },
    {
      version: '2026.9.20', date: '2026-09-03',
      changes: [
        'The loader now covers every heavy step. Restoring stored imports at startup ran with no veil at all when there was no snapshot — a large vault made the page look hung — and drawing a view never had one: opening Role mining, switching a tab or moving a slider froze the screen for as long as the proposal took. Each view now remembers how long it took; anything over 120 ms, or a first visit on a large import, draws behind the veil.',
        'The proposal itself is faster on large organisations: merging scores each pair from the smaller profile, and a context of hundreds of sibling departments seeds the merge with the largest 150 and attaches the rest in one pass. 4,000 people over 500 departments: 3.4 → 1.5 s.'
      ]
    },
    {
      version: '2026.9.19', date: '2026-09-03',
      changes: [
        'Long explanations sit behind an ⓘ now, on every screen: any note, card subtitle, tile footer or page intro over a couple of lines shows its first sentence and the rest on hover. Short notes stay where they were; tables and the board report are untouched.'
      ]
    },
    {
      version: '2026.9.18', date: '2026-09-03',
      changes: [
        'Core vs long tail counts job titles by name, not by HR code: a title carried under several codes (one tenant has “Engineer” under four) is one job, and splitting its headcount could drop it out of the core.'
      ]
    },
    {
      version: '2026.9.17', date: '2026-09-02',
      changes: [
        'The department hierarchy is now the natural layering of the proposal. Where the vault carries parent links, every level becomes an attribute of its own (department level 1, 2, …): a rule on a branch — “Directie Intramurale Zorg”, 2,092 people — is the generic rule, the leaf department or the job title within it the specialisation, and “builds on” follows membership so a leaf rule sits under its branch. HelloID cannot condition on a branch, so the export spells it out as the “one of” list of every department beneath it. On a real vault six levels deep the top branches surface as the first roots.',
        'When a granted or reconciliation export is loaded that reaches nobody in the vault, Role mining now opens the HR side instead of a dead “no attributes” card.'
      ]
    },
    {
      version: '2026.9.16', date: '2026-09-02',
      changes: [
        'Core vs long tail replaces the staff word list. A word list guesses about one HR vocabulary; headcount is a fact about every one. Job titles are ordered by how many people hold them; the titles that together hold 80% of people are the core — operational by construction — and the rest is the long tail, which counts for half in the proposal because it fits self-service better than rules. The “Staff roles” list in Settings is gone.',
        'Role fit now reads “46 of 208 job titles hold 80% of people” with the typical title size and the same figure for departments — how concentrated the organisation is, which is what decides how far roles will get it. The placed tile splits core jobs, long tail and last year’s flow; a “long tail” pill marks rules mostly over titles outside the core.'
      ]
    },
    {
      version: '2026.9.15', date: '2026-09-02',
      changes: [
        'Roles from HR now knows what a person is worth to a rule set. Someone who joined, moved or left in the vault’s last year counts double — that is the join, move or leave a rule would have handled, and where roles pay. Someone whose job title or department reads as staff work — HR, finance, IT, communication, projects — counts half: staff roles are project-based and better served by self-service, while operational roles fit rules densely. That is why healthcare models well with roles and government does not.',
        'A “Role fit” tile leads with the share of operational people — the assessment headline before any mining — and the placed tile splits operational, staff and last year’s flow. In the forest a “staff” pill marks rules mostly over staff roles and ⇄ marks rules over people with recent flow.',
        'The staff words are a third recognition list in Settings › Classification (“Staff roles”), editable like the other two, with live counts; Dutch compounds match on containment for longer tokens (kwaliteitsadviseur).'
      ]
    },
    {
      version: '2026.9.14', date: '2026-09-02',
      changes: [
        '“Decides access” is measured once a reconciliation is loaded: how much of the granted access rules on each attribute alone explain, scaled so the strongest attribute counts most. Without access the defaults stand (job title most, department and team much, the rest a little). The Attributes table shows “auto — most (measured)” with the share explained on hover; picking a value overrules it, “auto” hands it back.',
        'The pyramid’s alike tie-break and the mined rules’ Alike column use the same weights, so the HR-side proposal and the access-side miner read alikeness on one scale.'
      ]
    },
    {
      version: '2026.9.13', date: '2026-09-02',
      changes: [
        'Roles from HR is one card now, drawn instead of tabulated: a pyramid strip shows the layers the cap reaches — one attribute, two, three — with the rules and people in each and where the cap cuts; below it a forest of bars, one block per generic rule with its specialisations indented under it, bar length for people and tone for how alike they are. Click a bar for its people; search filters the blocks.',
        'The exploratory cards — each combination on its own, the smallest-group sweep, exploring one combination — are gone; the proposal made them redundant. The tiles, the smallest-group / cap / alike sliders, the attribute switches, the cap-cost table and the export stay.'
      ]
    },
    {
      version: '2026.9.12', date: '2026-09-02',
      changes: [
        'The rule cap is now a depth budget spent from the top of the pyramid. Proposed rules are taken layer by layer — every single-attribute rule worth a slot first, then the two-attribute rules that add something on top of them, then three — so a cap of 100 gives every job title its generic rule before any of them gets a department-specific one, instead of spending the slots on one title’s every corner.'
      ]
    },
    {
      version: '2026.9.11', date: '2026-09-02',
      changes: [
        'The proposed rule set is now the pyramid without the access side: a generic job-title rule holding the basic permissions, and under it the department, location or contract-type rules that add the specific ones. Each rule shows what it builds on, and the table reads as a forest — root, then the rules on top of it.',
        'Alikeness now knows that a job title is the job. Every attribute carries a weight for how much it decides access (job title most, department and team much, the rest a little — editable per attribute in the Attributes table): an attribute a rule conditions on counts in full, an open one by how much more its people agree on it than everyone does. A “one of” list does not fix its attribute; it counts by its lift, so a list of every title is not a title rule.',
        'A list that covers nearly every value in its context collapses to the wider rule — “Helpende in one of 73 departments” is Helpende. Single-attribute roots may sit below the alike floor; only rules on two or more attributes must clear it.',
        'On a real vault the proposal at a cap of 100 now reads: Verzorgende IG (509 people) with six specialisations, Helpende (456) with four, Woonzorgassistent, Helpende plus — 95% of people placed, 100% at a cap of 500.'
      ]
    },
    {
      version: '2026.9.10', date: '2026-09-02',
      changes: [
        'A proposed rule must itself be at least the alike floor. Gain is counted in people, so a job-title rule covering 449 people at 10% alike used to win a slot early — it placed many people from nothing. That is a department list, not a role; the floor that governs merging now governs candidacy too.'
      ]
    },
    {
      version: '2026.9.9', date: '2026-09-02',
      changes: [
        'Roles from HR now proposes a rule set instead of ranking attributes. No access model uses one attribute, so every merged rule from every combination is a candidate and rules are taken one at a time by how much more alike they make the people they cover than the rules already taken do: wide rules place, specific rules sharpen, and the mix — job titles here, department and title there, department underneath — is what the data supports. On a real vault the set within a cap of 100 places 99% of people; a “What the cap costs” table reads the same proposal off at 50, 100, 200, 500 and 1,000.',
        'Two switches per attribute: “Use” (a cost centre per person is switched off by the data itself) and “In every rule” (insist on job title, the way an RBAC model would). The proposal, the candidates and the alikeness measure all follow the switches.',
        'Export the proposed rules as HelloID business rules; the categories column names each rule’s attributes.',
        'Fixed: cohort keys were joined without a separator since 2026.9.7, so two different value combinations could in theory land in one group.'
      ]
    },
    {
      version: '2026.9.8', date: '2026-09-02',
      changes: [
        'The pyramid now uses alikeness too. When two attributes explain the same access and govern equally sensitive entitlements, the one whose groups are more alike on everything else wins the level; the suggestion note says how alike the deepest groups are.',
        'Mined rules carry an “Alike” column and drawer row — how much more the people a rule selects resemble each other than everybody does — so a rule that explains access by accident of grouping shows up next to one that describes a real role.'
      ]
    },
    {
      version: '2026.9.7', date: '2026-09-02',
      changes: [
        'Roles from HR now fits the organisation into HelloID’s rule cap. Sibling groups merge into one rule with a “one of” list as long as the merged rule stays alike enough (slider, default 50%): three wards with the same titles and site are one rule, and a ward of two is placed by joining its siblings instead of being left over. On a real vault, 374 departments became 85 rules placing everyone.',
        'With two or more attributes the rules stack the way HelloID applies them: the wide rule (department) sits under the specific one (department + job title) and catches whoever the specific rule cannot. A “Specific” tile says how many placed people get the specific rule.',
        'A “What the smallest group costs” table shows rules, over-cap, placed, alike and specific at every smallest-group size; click a row to use it. The rule cap has a slider here too (up to 1,000 — it is HelloID’s limit, not the tool’s), shared with the pyramid.',
        'The export writes list conditions in HelloID’s own “one of: a, b, c” form, with the level and over-cap state in the categories column.'
      ]
    },
    {
      version: '2026.9.6', date: '2026-09-02',
      changes: [
        'Roles from HR now scores on alikeness. A role is a group of people who are roughly alike, so every candidate is scored on the people it places in defendable cohorts × how much more the members of those cohorts resemble each other on every other attribute than everybody does. A rule for everybody scores zero by construction; more cohorts is more specific, not more expensive.',
        'HelloID’s rule cap is part of the score: people placed counts only the largest cohorts that fit the cap, so a combination that needs 260 rules is judged on the 100 it can have. Over-cap cohorts stay visible, ranked past the cap.',
        'Three-attribute combinations are candidates too. Attributes that cannot group even half the people at the smallest group size — a cost centre per person — are left out and named, instead of dragging every score down.'
      ]
    },
    {
      version: '2026.9.5', date: '2026-09-02',
      changes: [
        'Role mining opens with only the vault loaded. A new “Roles from HR” tab mines the condition half of a rule set from the contracts alone: every attribute and every pair (department, job title, location, …) is scored on how many people it places in a cohort large enough to defend as a rule and how many roles those cohorts really tell apart. The chosen pair’s cohorts are the candidate roles — condition, headcount, members — exported as HelloID business rules with nothing granted yet, so a consultant can draft the skeleton before a target system is connected.',
        'With a reconciliation loaded the tab sits next to the pyramid and explains why the levels look the way they do; the access side is unchanged.'
      ]
    },
    {
      version: '2026.9.4', date: '2026-09-01',
      changes: [
        'Mined rules now show risk: each entitlement in the rule drawer carries its risk score, and the rule itself gets an aggregate — the riskiest entitlement it grants, the same weakest-link reading as coverage. The mined-rules table has the aggregate as a sortable column, so the risky proposals surface first.'
      ]
    },
    {
      version: '2026.9.3', date: '2026-09-01',
      changes: [
        'Mined name groups are called “patterns” now (Dutch: “patronen”) — “family” and “scheme” were vague; the wizard, the conventions view and the settings notes all use the one word.'
      ]
    },
    {
      version: '2026.9.2', date: '2026-09-01',
      changes: [
        'The recognition vocabulary is now editable data instead of code: Settings › Classification gains two “Name recognition” lists — words an entitlement name starts with per category, and words an account name begins or ends with per account type. Edits travel with the settings export; deleting every row brings the built-in list back.',
        'The wizard’s “auto” badge now says “recognised” — it means the name was recognised from those word lists, and a wizard answer always wins over recognition.',
        'The last of the hidden filter code is gone: hints were regex tables inside the code, now they are the plain word lists you can see and edit.'
      ]
    },
    {
      version: '2026.9.1', date: '2026-09-01',
      changes: [
        'The Dutch settings tab for matching is called “Matching” again, the same word the sidebar uses — it had drifted to “Koppeling”.'
      ]
    },
    {
      version: '2026.8.24', date: '2026-09-01',
      changes: [
        'Classification rethought: no more pattern filters. Every permission and account is placed in a naming family mined from the actual data (per system), and classification is an answer per family or per single item \u2014 like categorising bank statements. Built-in knowledge (PRIV means privileged, adm- means admin account) classifies automatically until you answer otherwise, and accounts holding privileged entitlements class as admin accounts whatever their name says.',
        'The classification wizard shows every family with its current answer and where it came from (your answer, automatic, none yet); changing the choice classifies every member, single members can be corrected, and names without a family are tagged one by one. A reconciliation or directory import opens it when anything is unanswered.',
        'Settings \u203a Classification now holds definitions only (label, sensitivity, weight, colour) with live counts; family and item answers travel with the settings export. Existing category and class definitions survive; old custom pattern rules do not \u2014 re-answer them once in the wizard.',
        'Clearer names for the two account axes: \u201cAccount type\u201d (what it technically is: admin, service, test \u2026) and \u201cWorkforce category\u201d (who it works for: payroll, temp, supplier \u2026 \u2014 formerly \u201cAccount classification\u201d). Workforce categories keep their layered detection unchanged.'
      ]
    },
    {
      version: '2026.8.23', date: '2026-08-31',
      changes: [
        'Accounts and rows accounted for in the HelloID reconciliation no longer count against the fault KPIs \u2014 a justified account is, by definition, OK. Resolutions are per entitlement: whole-account KPIs (unowned, unowned-enabled, service, former-employee, disabled-entitled, dormant) need every row excluded or resolved; the privileged-account KPI is judged on its privileged rows alone; access outside the IAM model counts only unresolved rows. Composition KPIs (admin, test, shared, wide accounts) measure what exists regardless.',
        'The export carries only the resolution type; the remark and end date entered in HelloID stay behind in HelloID.'
      ]
    },
    {
      version: '2026.8.22', date: '2026-08-31',
      changes: [
        'Policy KPIs: a new Policies view holds 24 quality KPIs an organisation sets for itself \u2014 unowned, admin, service, test, shared, disabled, dormant and former-employee accounts, privileged accounts without an owner, people with more access than the rules give, peer outliers, employees without an account, duplicate employee ids, approvals routed to someone who left, empty and deeply nested groups, access outside the IAM model, rule coverage, and more \u2014 each with its own adjustable limit.',
        'Every KPI shows today\u2019s number against the limit, met or not met, the accounts and people behind the number, and one line on how to improve. The overall score counts the KPIs that pass \u2014 groundwork for certifications such as NIS2. The catalog follows what the field measures (SailPoint outlier factors, Saviynt posture metrics, Omada\u2019s KPI model) using only data the tool already reads.',
        'Dormant accounts use the last sign-in the collectors already ship (AD: the replicated lastLogonTimestamp; Entra: signInActivity); KPIs whose import is missing say what they need instead of scoring.',
        'Limits are saved with the settings and exported in the settings file; the board report gains a Policy KPIs sheet with the same numbers. The KPI shape follows the IAM-masterplan threshold policies, so chosen limits can migrate to a full policy engine later.'
      ]
    },
    {
      version: '2026.8.21', date: '2026-08-31',
      changes: [
        'HelloID allows about 100 business rules, so mined rules are now ranked: rank 1 is the baseline, and each next rank goes to the rule that explains the most access nothing above it explains. The best 100 sit inside the cap; everything past it stays visible, marked "over the rule cap".',
        'The rules table sorts by rank, the drawer shows each rule’s rank, and a note states what the best 100 explain versus the full set. The rule exports are ordered best-first, with over-cap rows carrying an "Over rule cap" category.',
        'The cap is a setting in the mining-hygiene card (default 100, 0 switches it off).'
      ]
    },
    {
      version: '2026.8.20', date: '2026-08-31',
      changes: [
        'The product is now called HelloID Sidekick — it works alongside HelloID rather than only reporting on it. New home: github.com/arnoutvandervorst/helloid_sidekick (the old address redirects). File formats, settings and browser storage are unchanged; existing exports and collector scripts keep working.'
      ]
    },
    {
      version: '2026.8.19', date: '2026-08-31',
      changes: [
        'Target-attribute analyzer: a new "Target attributes" tab in Field mapping profiles every attribute of the collected AD/Entra accounts — how many accounts have a value, how many distinct values, the most common ones — with a value-distribution drawer per attribute.',
        'With a mapping loaded it answers the two questions that matter before trusting it: which attributes hold real data that no mapping field writes (nothing keeps them up to date), and which mapped attributes are empty today (the first update run would write them on nearly every account).',
        'The tab works from a directory import alone; mapped attributes link straight into the update simulation.'
      ]
    },
    {
      version: '2026.8.18', date: '2026-08-31',
      changes: [
        'Plain-language sweep across the dashboard: ~70 figurative or insider phrasings rewritten in both languages ("What the paperwork carries" → "What the HR data provides", "it travelled with them" → "usually kept from an earlier role", and many more).',
        'One word per concept everywhere: "drift" became "unmanaged access/assignments" (NL "onbeheerd"), the four different meanings of "floor" became baseline, threshold and minimum, and EN/NL now say the same thing where they used to diverge.',
        'Renames: Bus factor → Key-person risk, Blast radius → Reach, the Lift column → "× vs organisation", the cost Leaks tab → Wasted spend ("hard buckets" → "directly recoverable").'
      ]
    },
    {
      version: '2026.8.17', date: '2026-08-31',
      changes: [
        'Imported-rule polish: a rule whose only conditions are the Person and time-frame clauses now reads "everyone active" in the rules table instead of a dash, with the clauses in the tooltip.',
        'The rule drawer’s conditions render as a proper table — facet, operator and values clearly separated — with a note stating the semantics: every condition must hold, values within one condition are alternatives.',
        'The account-entitlement card got a capitalized title, and raw entitlement names in the drawer read as data (monospace).'
      ]
    },
    {
      version: '2026.8.16', date: '2026-08-30',
      changes: [
        'Mined rules condense the way HelloID allows: sibling rules merge into multi-value "one of" conditions, iterated across every attribute until nothing merges, and the condensed set is now the canonical output — the mined-rules table, the counts and the pyramid-rules.csv export all use it, with the raw single-value set kept as a separate export and each condensed rule naming the rules it replaced in its drawer.',
        'The coverage-first set condenses the same way, and its export carries the merged conditions.',
        'Imported HelloID rules condense without a person vault: exact lossless merges (same entitlements, same other conditions) are proposed from the rules alone; people counts and near-miss trades appear once an evaluation exists. Not/contains/empty conditions and the Person and time-frame clauses are never widened.',
        'Generated rule names no longer carry a kind prefix like "Piramide" — the name is the conditions; the {kind} token in the naming template still works.'
      ]
    },
    {
      version: '2026.8.15', date: '2026-08-28',
      changes: [
        'The field-mapping simulation names its gaps: a collection-gap card lists every mapped attribute the loaded directory never collected, separating what a re-collect fixes from what the source API does not have — with the exact command line and a pre-filled collector download.',
        'Both collectors take -ExtraAttributes for attributes outside their built-in set, and the built-in set widened (AD: cn, homeDirectory, homeDrive, scriptPath, profilePath, wWWHomePage; Entra: preferredLanguage, otherMails).',
        'Fixed: legacy accountMappings field names (AdditionalFields.*) never matched the attribute aliases, so every such field wrongly read as having no counterpart.'
      ]
    },
    {
      version: '2026.8.14', date: '2026-08-28',
      changes: [
        'Brand accent color: one picker drives buttons, links, active tabs, the first chart color, the gradient marks and the printed report — in both themes.',
        'Per-brand default theme (a visitor’s own toggle still wins) and a custom welcome line on the empty start page.',
        'Board report extras: a contact row on the cover and a footer line printed on every sheet.'
      ]
    },
    {
      version: '2026.8.13', date: '2026-08-28',
      changes: [
        'Storage transparency: a Settings › Storage tab lists everything the app keeps in the browser — settings and decisions, branding, UI preferences, the snapshot archive and the raw imported files — with live sizes, per-store clear buttons and clear-everything.',
        'A storage kill switch: turning "Remember data in this browser" off wipes every store and stops all saving; the session keeps working in memory and forgets on reload.',
        'The first persisting import announces itself once, with a pointer to the Storage tab; anonymous usage statistics gained their own toggle there.',
        'The settings export is now described honestly: it contains the match decisions and books, names and employee ids included.'
      ]
    },
    {
      version: '2026.8.12', date: '2026-08-28',
      changes: [
        'Versioning and a changelog: CalVer version in the topbar, an About card in Settings, this history rendered in-app, and a generated CHANGELOG.md.'
      ]
    },
    {
      version: '2026.8.11', date: '2026-08-28',
      changes: [
        'Person link card in the account drawer: an unlinked account shows its top candidates with confirm/reject/search, a linked one shows the attribution and the means to override it; name-match attributions render as proposals, not settled links.',
        '"Employee category" renamed to "Account classification", overridable per account from the drawer, with a link to the classification settings.',
        'Field mappings in the older accountMappings shape import and simulate; source mappings among them are still refused with an explanation.',
        'Closest peer is a clickthrough; the unique-entitlements list became a "Unique vs peer" column in the entitlements table.'
      ]
    },
    {
      version: '2026.8.10', date: '2026-08-27',
      changes: [
        'Field-mapping import and attribute-update simulation: the target connector’s v1 mapping export as data — per field the mode per provisioning action — and an Update simulation that evaluates every in-scope field per person (Complex JavaScript runs faithfully) and diffs it against what the collected AD/Entra holds today.'
      ]
    },
    {
      version: '2026.8.9', date: '2026-08-17',
      changes: [
        'Directory group structure: Entra query-based groups and AD nesting chains detected from the collectors; permissions say whether a holder is a direct member or holds via a chain.',
        'Systems as a first-class permission dimension: per-system spend, risk, coverage and drawer, plus a finding for systems outside the rule model.',
        'Classic role model ported: relevance/lift role cards, exception lists and discovered clusters as Mining tabs, with lift explained where it is shown.',
        'Answers to the public feedback board: per-rule people export, entitlement description notes, and an import-blocker pre-flight.'
      ]
    },
    {
      version: '2026.8.8', date: '2026-08-16',
      changes: [
        'Name-generation workbench: conventions as live instruments with collision testing, per-person iteration ladders and aligned intake previews.',
        'Mining hygiene: exclusions, a rule-name template and a deepest-group preference; Manager dropped as a pyramid attribute (derived, not structural).',
        'Mined rules open from the whole row and name their audience in the drawer.'
      ]
    },
    {
      version: '2026.8.7', date: '2026-08-14',
      changes: [
        'Nedap ONS workbench: the matrix workbook imported as editable data, scope-mapping and medewerkers tabs managed in-app, connector CSVs exported, and the official mapping CSVs imported for id↔name translation.',
        'Risk and Cost split into tabs; every hero tile on Overview and Cost is clickable.'
      ]
    },
    {
      version: '2026.8.6', date: '2026-08-13',
      changes: [
        'Matching workbench: scored candidates per unowned account, human decisions in an exportable match book, a paged approval flow, and a generated fix script that writes the matching attribute to AD or Entra (dry-run by default).',
        'The Entra connector intake answered from a collector run; collectors survive schema-less attributes and log progress.',
        'Synthesized data carries its provenance, and the synchronous builds got a busy veil.'
      ]
    },
    {
      version: '2026.8.5', date: '2026-08-10',
      changes: [
        'Unified classification: one layered engine for account classes and workforce categories, with linked pricing and risk multipliers.',
        'Directory import: read-only AD/Entra collector scripts, downloadable from the Directory slot, feed a pre-HelloID analysis without any HelloID export.'
      ]
    },
    {
      version: '2026.8.4', date: '2026-08-05',
      changes: [
        'Health checks on every import, surfaced in the sources overview; parsing assumptions hardened.',
        'Naming-convention analysis: scheme detection, migration signals and strays.',
        'Leaver assurance, mover revoke checklists and bus-factor analysis.'
      ]
    },
    {
      version: '2026.8.3', date: '2026-08-04',
      changes: [
        'Every import optional: each view says what it needs and locks until it has it.',
        'Contract history read as history: flow, movers, managers, latency, creep and a licence forecast, cut by department.',
        'Attestation packs previewed before export, and the access review assembled per manager.',
        'Settings split into tabs; the model build made near-linear in import size.'
      ]
    },
    {
      version: '2026.8.2', date: '2026-08-03',
      changes: [
        'Peer analysis: people who hold the same access, and defensible copying.',
        'The model builds once per import batch; the views module split at its seams.'
      ]
    },
    {
      version: '2026.8.1', date: '2026-08-02',
      changes: [
        'Vault, granted-entitlements and activity imports; business rules compared against the reconciliation export and evaluated against the vault.',
        'Role mining: attribute pyramid from the organisation’s own shape, bundle mining as the fallback, coverage reported to the board.',
        'Every reconciliation row explained, with the residue named.',
        'A fictional demo tenant, impossible to mistake for a real one; account-to-person matching made tunable.'
      ]
    },
    {
      version: '2026.7.1', date: '2026-07-29',
      changes: [
        'Initial release: HelloID reconciliation analytics — risk, cost and findings over the reconciliation export, English and Dutch, self-hostable, no dependencies.'
      ]
    }
  ];

  HR.changelog = { VERSION: ENTRIES[0].version, ENTRIES };
})(window.HR);
