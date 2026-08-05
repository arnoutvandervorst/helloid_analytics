# What HelloID would need to expose for this to become a real add-on

**Division of labour.** HelloID is the engine: it connects, provisions, evaluates,
logs, and imports — and it is very good at that. This add-on is the governance and
analytics layer on top: explanations, attestation, assurance, optimisation, forecasts.
Nothing here wants to replace the engine; everything here wants better access to what
the engine already knows.

## Where integration stands today

Everything on the provisioning side is **export-only**. The reconciliation report, the
vault snapshot, business rules, granted entitlements and historic actions all leave
HelloID as files a person downloads by hand. The only API surface this project has
successfully used is **Service Automation** (products and product assignments, read).
There is no API for reconciliation, rules or the vault, and no write-back of any kind.

That shapes the add-on today: a human carries files, the analysis is as fresh as the
last download, and every insight ends as a CSV a human carries back. Workable — this
tool is built around it — but three whole classes of functionality are structurally out
of reach: freshness (alerting, scheduled analysis), closure (did the decided revoke
actually happen?), and scale (one tenant at a time, one browser at a time).

## What to ask for, in order of value

### 1. Read APIs for the five exports (highest value, lowest risk)

The single most valuable ask. Not new functionality — the same data the UI already
exports, as authenticated read endpoints:

| Export today | As API | What it unlocks |
| --- | --- | --- |
| Reconciliation report | `GET /reconciliation` (per system, paged) | Scheduled analysis; alerting on new drift; trend without manual snapshots |
| Vault snapshot | `GET /persons` incl. contracts + correlated accounts | Always-current org/people analytics; no stale-vault diffs |
| Business rules | `GET /rules` incl. conditions + entitlements | Live rule coverage; optimisation proposals against the current rule set |
| Granted entitlements | `GET /granted` | The confirmed-grant side of every join, current |
| Historic actions | `GET /actions?since=…` | Incremental activity analysis instead of re-reading the whole log |

Design asks that matter in practice, learned from parsing the files:

- **Stable identifiers on every row.** The exports force joins on display strings
  (person names, entitlement names). APIs should carry `personId`, `entitlementId`,
  `systemId` so no join in this add-on ever rests on a name again.
- **Structured fields, not conventions.** The person column ("Name (id)"), the
  permission column ("Name (dn)"), rule conditions ("facet, operator: values") are all
  string conventions we reverse-engineer. JSON with named fields removes a whole class
  of parsing risk this project has had to harden against.
- **`since` / delta parameters** on actions and granted, so a nightly pull is small.
- **A `generatedAt` timestamp** on every response, so the add-on can state data age
  instead of guessing it.

### 2. Toxic policies and evaluation results (read)

HelloID defines toxic entitlement pairs and evaluates them against its own model.
Export/API access to (a) the policy definitions and (b) the current violations would
let the add-on check the same pairs against **reconciliation reality** — the halves
assembled outside HelloID that the policy engine structurally cannot see — and report
both sides in one view. Definitions matter more than violations: with the pairs, this
add-on can compute violations from data it already has.

### 3. Webhooks / event subscriptions (freshness)

A single webhook — "reconciliation run finished", "evaluation completed", "action
failed" — turns the add-on from *analysis of last month's file* into *analysis of this
morning's run*, without polling. Even a bare notification with no payload is enough:
the add-on (or a companion job) fetches via the read APIs from ask 1. This is the
architectural unlock for alerting; nothing browser-side can substitute for it.

### 4. Governance write-back (closure — furthest out, ask last)

The loop this add-on cannot close today: it produces decisions (attestation verdicts,
revoke checklists, rule proposals) as CSVs a human re-enters into HelloID by hand.
Three narrow, auditable write endpoints would close it:

- **Revoke request**: person + entitlement + reason → a normal HelloID change request,
  subject to HelloID's own approval flow. The add-on never touches a target system;
  it files requests with the engine.
- **Attestation verdict**: person + entitlement + keep/revoke + reviewer → recorded in
  HelloID's log, revokes filed as above.
- **Rule draft**: create a business rule in *draft* status from a mined or condensed
  proposal, for a human to review and publish inside HelloID.

All three deliberately route through HelloID's existing approval and logging — the
add-on proposes, the engine disposes. That keeps the trust model intact and is the
version of write-back a vendor can actually say yes to.

### 5. Operational niceties

- **Scoped, read-only API keys** (per-source scopes: reconciliation, vault, rules,
  activity) so a governance add-on never holds a key that can write.
- **Rate limits documented**, pagination consistent across endpoints.
- **Tenant metadata** (name, timezone, locale) — date-order and language guessing
  would disappear.

## What this means for the add-on's shape

- **Now (export-only):** exactly what this repository is — static, browser-side,
  file-fed, credential-free. The import-health checks, verbatim parsing and gate pages
  exist because files are the interface.
- **With ask 1 + 3:** a small **companion fetcher** on the customer's infra (scheduled
  script or container) pulls via API, drops fresh exports next to the hosted copy, and
  mails a digest on drift. The dashboard itself stays passive and credential-free — the
  same trust story as today, with freshness.
- **With ask 4:** the CSVs this tool already produces (attestation packs, revoke
  checklists, leaver assurance, rule proposals) become buttons instead of files. The
  add-on becomes a governance console; HelloID remains the only thing that ever touches
  a target system.

## One-paragraph version for a conversation with Tools4ever

*HelloID does the heavy lifting — connecting, provisioning, evaluating, logging. What
customers are missing is the governance layer on top: explanations, attestation,
assurance, optimisation. We have built that layer on the exports; it works, but it is
as fresh as the last manual download and every decision leaves as a CSV. Read APIs for
the five provisioning exports (with stable IDs and structured fields), read access to
toxic-policy definitions, one webhook on reconciliation completion, and — eventually —
three narrow write-backs that file requests through HelloID's own approval flow, would
turn this from a file-fed dashboard into a governance add-on, without HelloID giving up
an inch of control over provisioning.*
