<#
.SYNOPSIS
  Read-only Microsoft Entra ID collector for HelloID Sidekick.

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

.PARAMETER ExtraAttributes
  Additional Graph user property names to collect verbatim, e.g. when a HelloID
  field mapping writes attributes outside the built-in set. They land under
  "extra" on each user; the analytics page's field-mapping view names the
  attributes it needs and can generate this list.

.EXAMPLE
  .\collect-entra.ps1
  .\collect-entra.ps1 -IncludeSignInActivity
  .\collect-entra.ps1 -ExtraAttributes ageGroup,employeeOrgData
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
  Justification = 'Interactive console script; the scope listing, progress and the PII warning belong on the host, never in the pipeline.')]
[CmdletBinding()]
param(
  [string]$OutFile = "directory-entra.json",
  [switch]$IncludeSignInActivity,
  [string[]]$ExtraAttributes = @()
)

$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
function Write-Step([string]$Message) {
  Write-Host ("[{0:hh\:mm\:ss}] {1}" -f $sw.Elapsed, $Message)
}

$scopes = @('User.Read.All', 'Group.Read.All', 'Organization.Read.All')
if ($IncludeSignInActivity) { $scopes += 'AuditLog.Read.All' }

Write-Host "Connecting to Microsoft Graph with read-only scopes:"
$scopes | ForEach-Object { Write-Host "  $_" }
Connect-MgGraph -Scopes $scopes -NoWelcome
Write-Step "Connected."

$org = Get-MgOrganization | Select-Object -First 1
Write-Step "Tenant: $($org.DisplayName) ($($org.Id))"

# SKU id -> part number, so license assignments come out readable.
$skuNames = @{}
foreach ($sku in Get-MgSubscribedSku -All) { $skuNames[[string]$sku.SkuId] = $sku.SkuPartNumber }
Write-Step "$($skuNames.Count) license SKUs in the tenant"

$userProps = @(
  'id','userPrincipalName','displayName','givenName','surname','accountEnabled','createdDateTime',
  'department','jobTitle','companyName','employeeId','employeeType',
  'employeeHireDate','officeLocation','mail','mailNickname','proxyAddresses',
  'usageLocation','onPremisesSamAccountName','onPremisesSyncEnabled',
  'onPremisesDistinguishedName','onPremisesExtensionAttributes','assignedLicenses',
  'businessPhones','mobilePhone','faxNumber','streetAddress','city','state',
  'postalCode','country',
  # Common provisioning-mapping targets
  'preferredLanguage','otherMails'
)
if ($IncludeSignInActivity) { $userProps += 'signInActivity' }
$ExtraAttributes = @($ExtraAttributes | Where-Object { $_ -and $userProps -notcontains $_ } | Select-Object -Unique)
$userProps += $ExtraAttributes

Write-Step "Reading users (paged; large tenants take a while)..."
$mgUsers = Get-MgUser -All -Property ($userProps -join ',') -ExpandProperty 'manager($select=id,displayName)' -ConsistencyLevel eventual -CountVariable c
Write-Step "  $($mgUsers.Count) users ($(@($mgUsers | Where-Object { $_.AccountEnabled }).Count) enabled, $(@($mgUsers | Where-Object { $_.OnPremisesSyncEnabled }).Count) synced from on-prem)"

Write-Step "Reading groups..."
$mgGroups = Get-MgGroup -All -Property 'id,displayName,description,groupTypes,securityEnabled,mailEnabled,membershipRule,membershipRuleProcessingState,createdDateTime,mail'
Write-Step "  $($mgGroups.Count) groups ($(@($mgGroups | Where-Object { @($_.GroupTypes) -contains 'DynamicMembership' }).Count) dynamic)"

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
  $extra = [ordered]@{}
  foreach ($name in $ExtraAttributes) {
    # Typed SDK property first; anything Graph returned outside the typed model
    # lands in AdditionalProperties under its camelCase name.
    $v = $u.$name
    if ($null -eq $v -and $u.AdditionalProperties) {
      $k = @($u.AdditionalProperties.Keys) | Where-Object { $_ -ieq $name } | Select-Object -First 1
      if ($k) { $v = $u.AdditionalProperties[$k] }
    }
    if ($null -ne $v -and "$v" -ne '') {
      $extra[$name] = if ($v -is [System.Collections.IEnumerable] -and $v -isnot [string]) { @(@($v) | ForEach-Object { [string]$_ }) } else { [string]$v }
    }
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
    preferredLanguage = [string]$u.PreferredLanguage
    otherMails  = @(@($u.OtherMails) | Where-Object { $_ })
    extensionAttributes = $ext
    extra       = $extra
  }
}

Write-Step "Shaping users..."
Write-Step "Reading memberships (one Graph call per group)..."
$groups = @()
$edgeCount = 0
$i = 0
foreach ($g in $mgGroups) {
  $i++
  if ($i % 25 -eq 0) { Write-Step "  $i / $($mgGroups.Count) groups, $edgeCount memberships so far" }
  $memberUsers = [System.Collections.Generic.List[string]]::new()
  $memberGroups = [System.Collections.Generic.List[string]]::new()
  foreach ($m in (Get-MgGroupMember -GroupId $g.Id -All)) {
    if ($userIds.ContainsKey($m.Id)) { $memberUsers.Add($m.Id); $edgeCount++ }
    elseif ($groupIds.ContainsKey($m.Id)) { $memberGroups.Add($m.Id); $edgeCount++ }
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
  extraAttributes = @($ExtraAttributes)
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

Write-Step "Writing JSON..."
$envelope | ConvertTo-Json -Depth 8 -Compress | Out-File -FilePath $OutFile -Encoding utf8

Disconnect-MgGraph | Out-Null
Write-Step "Disconnected from Graph. Done in $([math]::Round($sw.Elapsed.TotalSeconds)) s."

$nested = ($groups | ForEach-Object { $_.memberGroups.Count } | Measure-Object -Sum).Sum
$dynamic = ($groups | Where-Object { $_.dynamic }).Count
$size = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
Write-Host ""
Write-Host "Wrote $OutFile ($size MB)"
Write-Host "  $($users.Count) users, $($groups.Count) groups, $edgeCount memberships, $nested group-in-group edges, $dynamic dynamic groups"
Write-Host ""
Write-Host "This file contains personal data. Hand it only to the analyst who asked for it;"
Write-Host "it is read locally in their browser and is never uploaded anywhere."
Write-Host "Consent granted to 'Microsoft Graph Command Line Tools' can now be revoked:"
Write-Host "  Entra admin center -> Enterprise applications -> Microsoft Graph Command Line Tools -> Permissions"
