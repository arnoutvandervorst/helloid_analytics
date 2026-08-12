<#
.SYNOPSIS
  Read-only Microsoft Entra ID collector for HelloID Analytics.

.DESCRIPTION
  Exports users, groups, memberships (including nesting), license assignments and
  dynamic-membership rules to one JSON file you drag into the analytics page.

  WHAT THIS SCRIPT ASKS CONSENT FOR — and nothing else:

    User.Read.All          read user profiles: names, department, job title,
                           employee id/type, extension attributes, licenses.
    Group.Read.All         read groups, their members and membership rules.
    Organization.Read.All  read the tenant's license SKU list, so license GUIDs
                           become readable names ("ENTERPRISEPACK" not a GUID).
    AuditLog.Read.All      ONLY with -IncludeSignInActivity: last sign-in per
                           user (requires Entra ID P1). Off by default.

  All scopes are delegated and read-only: the script acts as the signed-in
  admin, through Microsoft's own "Microsoft Graph Command Line Tools" app — no
  app registration, no client secret, nothing left behind. Consent is revocable
  afterwards: Entra admin center → Enterprise applications → Microsoft Graph
  Command Line Tools → Permissions → revoke. See docs/ENTRA-CONSENT.md for the
  full walkthrough to share with the customer.

  The output file contains personal data: handle it like any HR export. It is
  read locally in the analyst's browser and never uploaded anywhere.

  Requires: Microsoft.Graph.Authentication, Microsoft.Graph.Users,
  Microsoft.Graph.Groups, Microsoft.Graph.Identity.DirectoryManagement
  (Install-Module Microsoft.Graph -Scope CurrentUser)

.PARAMETER OutFile
  Where to write the JSON envelope. Default: directory-entra.json

.PARAMETER IncludeSignInActivity
  Also read each user's last sign-in (adds AuditLog.Read.All; needs Entra ID P1).

.EXAMPLE
  .\collect-entra.ps1
  .\collect-entra.ps1 -IncludeSignInActivity
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
  Justification = 'Interactive console script; the scope listing, progress and the PII warning belong on the host, never in the pipeline.')]
[CmdletBinding()]
param(
  [string]$OutFile = "directory-entra.json",
  [switch]$IncludeSignInActivity
)

$ErrorActionPreference = 'Stop'

$scopes = @('User.Read.All', 'Group.Read.All', 'Organization.Read.All')
if ($IncludeSignInActivity) { $scopes += 'AuditLog.Read.All' }

Write-Host "Connecting to Microsoft Graph with read-only scopes:"
$scopes | ForEach-Object { Write-Host "  $_" }
Connect-MgGraph -Scopes $scopes -NoWelcome

$org = Get-MgOrganization | Select-Object -First 1

# SKU id -> part number, so license assignments come out readable.
$skuNames = @{}
foreach ($sku in Get-MgSubscribedSku -All) { $skuNames[[string]$sku.SkuId] = $sku.SkuPartNumber }

$userProps = @(
  'id','userPrincipalName','displayName','givenName','surname','accountEnabled','createdDateTime',
  'department','jobTitle','companyName','employeeId','employeeType',
  'employeeHireDate','officeLocation','mail','mailNickname','proxyAddresses',
  'usageLocation','onPremisesSamAccountName','onPremisesSyncEnabled',
  'onPremisesDistinguishedName','onPremisesExtensionAttributes','assignedLicenses',
  'businessPhones','mobilePhone','faxNumber','streetAddress','city','state',
  'postalCode','country'
)
if ($IncludeSignInActivity) { $userProps += 'signInActivity' }

Write-Host "Reading users..." -NoNewline
$mgUsers = Get-MgUser -All -Property ($userProps -join ',') -ExpandProperty 'manager($select=id,displayName)' -ConsistencyLevel eventual -CountVariable c
Write-Host " $($mgUsers.Count)"

Write-Host "Reading groups..." -NoNewline
$mgGroups = Get-MgGroup -All -Property 'id,displayName,description,groupTypes,securityEnabled,mailEnabled,membershipRule,membershipRuleProcessingState,createdDateTime,mail'
Write-Host " $($mgGroups.Count)"

$userIds = @{}; foreach ($u in $mgUsers) { $userIds[$u.Id] = $true }
$groupIds = @{}; foreach ($g in $mgGroups) { $groupIds[$g.Id] = $true }

function ParentOuOf($u) {
  $dn = [string]$u.OnPremisesDistinguishedName
  if ($dn) { return ($dn -replace '^[^,]+,', '') }
  return ''
}

$users = foreach ($u in $mgUsers) {
  $ext = [ordered]@{}
  $opx = $u.OnPremisesExtensionAttributes
  if ($opx) {
    1..15 | ForEach-Object {
      $v = $opx."ExtensionAttribute$_"
      if ($v) { $ext["extensionAttribute$_"] = [string]$v }
    }
  }
  $licenses = @()
  foreach ($lic in @($u.AssignedLicenses)) {
    if ($lic.SkuId) {
      $sid = [string]$lic.SkuId
      $licenses += $(if ($skuNames.ContainsKey($sid)) { $skuNames[$sid] } else { $sid })
    }
  }
  $lastSignIn = $null
  if ($IncludeSignInActivity -and $u.SignInActivity -and $u.SignInActivity.LastSignInDateTime) {
    $lastSignIn = $u.SignInActivity.LastSignInDateTime.ToUniversalTime().ToString('o')
  }
  [ordered]@{
    id          = $u.Id
    userName    = if ($u.OnPremisesSamAccountName) { [string]$u.OnPremisesSamAccountName } else { [string]$u.UserPrincipalName }
    upn         = [string]$u.UserPrincipalName
    displayName = [string]$u.DisplayName
    givenName   = [string]$u.GivenName
    surname     = [string]$u.Surname
    initials    = ''
    mailNickname = [string]$u.MailNickname
    proxyAddresses = @(@($u.ProxyAddresses) | Where-Object { $_ })
    usageLocation = [string]$u.UsageLocation
    synced      = [bool]$u.OnPremisesSyncEnabled
    enabled     = [bool]$u.AccountEnabled
    created     = if ($u.CreatedDateTime) { $u.CreatedDateTime.ToUniversalTime().ToString('o') } else { $null }
    lastLogon   = $lastSignIn
    expires     = $null
    department  = [string]$u.Department
    title       = [string]$u.JobTitle
    company     = [string]$u.CompanyName
    office      = [string]$u.OfficeLocation
    employeeId  = [string]$u.EmployeeId
    employeeType= [string]$u.EmployeeType
    hireDate    = if ($u.EmployeeHireDate) { $u.EmployeeHireDate.ToUniversalTime().ToString('o') } else { $null }
    description = ''
    notes       = ''
    mail        = [string]$u.Mail
    phone       = [string](@($u.BusinessPhones) | Select-Object -First 1)
    homePhone   = ''
    mobile      = [string]$u.MobilePhone
    fax         = [string]$u.FaxNumber
    pager       = ''
    ipPhone     = ''
    street      = [string]$u.StreetAddress
    poBox       = ''
    city        = [string]$u.City
    state       = [string]$u.State
    postalCode  = [string]$u.PostalCode
    country     = [string]$u.Country
    ou          = ParentOuOf $u
    managerId   = if ($u.Manager) { [string]$u.Manager.Id } else { '' }
    managerName = if ($u.Manager -and $u.Manager.AdditionalProperties) { [string]$u.Manager.AdditionalProperties['displayName'] } else { '' }
    licenses    = $licenses
    extensionAttributes = $ext
  }
}

Write-Host "Reading memberships (one call per group)..."
$groups = @()
$i = 0
foreach ($g in $mgGroups) {
  $i++
  if ($i % 50 -eq 0) { Write-Host "  $i / $($mgGroups.Count)" }
  $memberUsers = [System.Collections.Generic.List[string]]::new()
  $memberGroups = [System.Collections.Generic.List[string]]::new()
  foreach ($m in (Get-MgGroupMember -GroupId $g.Id -All)) {
    if ($userIds.ContainsKey($m.Id)) { $memberUsers.Add($m.Id) }
    elseif ($groupIds.ContainsKey($m.Id)) { $memberGroups.Add($m.Id) }
    # devices and service principals are deliberately dropped
  }
  $groups += [ordered]@{
    id           = $g.Id
    name         = [string]$g.DisplayName
    accountName  = ''
    description  = [string]$g.Description
    category     = if ($g.SecurityEnabled) { 'Security' } else { 'Distribution' }
    scope        = if (@($g.GroupTypes) -contains 'Unified') { 'Microsoft365' } else { '' }
    dynamic      = (@($g.GroupTypes) -contains 'DynamicMembership')
    membershipRule = [string]$g.MembershipRule
    managedBy    = ''
    created      = if ($g.CreatedDateTime) { $g.CreatedDateTime.ToUniversalTime().ToString('o') } else { $null }
    mail         = [string]$g.Mail
    ou           = ''
    memberUsers  = $memberUsers
    memberGroups = $memberGroups
  }
}

$envelope = [ordered]@{
  kind        = 'helloid-analytics-directory'
  version     = 1
  source      = 'entra'
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  domain      = [string]$org.DisplayName
  searchBase  = ''
  # The connector intake's connection facts, straight from the tenant.
  tenant      = [ordered]@{
    tenantId        = [string]$org.Id
    displayName     = [string]$org.DisplayName
    initialDomain   = [string](@($org.VerifiedDomains | Where-Object { $_.IsInitial }) | ForEach-Object { $_.Name } | Select-Object -First 1)
    defaultDomain   = [string](@($org.VerifiedDomains | Where-Object { $_.IsDefault }) | ForEach-Object { $_.Name } | Select-Object -First 1)
    verifiedDomains = @(@($org.VerifiedDomains) | ForEach-Object { [string]$_.Name })
  }
  users       = @($users)
  groups      = @($groups)
}

$envelope | ConvertTo-Json -Depth 8 -Compress | Out-File -FilePath $OutFile -Encoding utf8

Disconnect-MgGraph | Out-Null

$nested = ($groups | ForEach-Object { $_.memberGroups.Count } | Measure-Object -Sum).Sum
$dynamic = ($groups | Where-Object { $_.dynamic }).Count
Write-Host ""
Write-Host "Wrote $OutFile"
Write-Host "  $($users.Count) users, $($groups.Count) groups, $nested group-in-group edges, $dynamic dynamic groups"
Write-Host ""
Write-Host "This file contains personal data. Hand it only to the analyst who asked for it;"
Write-Host "it is read locally in their browser and is never uploaded anywhere."
Write-Host "Consent granted to 'Microsoft Graph Command Line Tools' can now be revoked:"
Write-Host "  Entra admin center -> Enterprise applications -> Microsoft Graph Command Line Tools -> Permissions"
