# What `collect-entra.ps1` reads, and the consent it needs

A one-page answer for the admin being asked to run it. Share this file with the
customer before the appointment.

## What it is

A read-only PowerShell script that exports users, groups, memberships and
license assignments from your Microsoft Entra ID tenant into **one JSON file on
your own machine**. The file is analysed in the consultant's browser with
[HelloID Sidekick](../README.md) — a static page with no back end. Nothing is
uploaded, nothing is installed in your tenant, and nothing is changed.

The purpose: understand your naming conventions, group structure and account
population *before* an IAM implementation, so connector mappings and business
rules are designed from evidence instead of questionnaires.

## The scopes, one by one

| Scope | What it lets the script read | Why the analysis needs it |
| --- | --- | --- |
| `User.Read.All` | User profiles: name, UPN, enabled state, department, job title, company, employee id/type, extension attributes, phone and address fields, assigned license SKUs | The account population: who exists, how accounts are named, which attributes are filled and usable for provisioning rules |
| `Group.Read.All` | Groups, their members (including group-in-group nesting), dynamic membership rules | The entitlement structure: what access exists, who holds it, how it is named |
| `Organization.Read.All` | The tenant's subscribed SKU list | Turns license GUIDs into readable names ("SPE_E3"), so license spend can be estimated |
| `AuditLog.Read.All` *(optional)* | Last sign-in date per user | Only requested with `-IncludeSignInActivity`; finds dormant accounts. Needs Entra ID P1. Skip it if that is a concern |

No write scope is requested. The script cannot create, change or delete
anything, and could not be modified to do so without asking for different
consent — the scopes above are enforced by Microsoft, not by the script.

## How the consent works

The script uses **delegated** permissions through Microsoft's own *Microsoft
Graph Command Line Tools* enterprise application. That means:

- It acts as the signed-in administrator, with their sign-in, MFA and
  Conditional Access applying as normal.
- There is **no app registration and no client secret** — nothing stays behind
  in the tenant.
- An admin sees exactly the scopes above on the consent screen and can consent
  for their own account only.

## Unattended runs (optional)

For a scheduled collection the script can run without a person signing in:
`collect-entra.ps1 -AppOnly`. That needs an **app registration** in the tenant
with the same three permissions as *Application* permissions (admin consent),
and a client secret. The script asks for tenant id, client id and secret once
and keeps them as a profile in `helloid-config.json` on the collecting machine.
This is the one mode where a secret stays behind; the interactive sign-in above
remains the default for that reason.

## Revoking afterwards

Entra admin center → **Enterprise applications** → *Microsoft Graph Command
Line Tools* → **Permissions** → revoke. The script also disconnects its session
when it finishes.

## The output file

`directory-entra.json` contains personal data (names, employee ids, attribute
values). Treat it like an HR export: hand it directly to the analyst, do not
mail it around. It is read locally in the analyst's browser; the analytics page
makes no network requests and the hosting config refuses to serve such files.
