<#
.SYNOPSIS
  Read-only Active Directory collector for HelloID Sidekick.

.DESCRIPTION
  Exports users, groups and memberships (including group-in-group nesting) to one
  JSON file you drag into the analytics page. Everything is read with plain
  Get-ADUser / Get-ADGroup queries — nothing is installed, nothing is changed,
  nothing leaves this machine. The output file contains personal data (names,
  employee ids, attribute values): handle it like any HR export.

  Requires the ActiveDirectory PowerShell module (RSAT) and an account that can
  read the directory — any domain user can, by default.

.PARAMETER OutFile
  Where to write the JSON envelope. Default: directory-ad.json

.PARAMETER SearchBase
  Optional OU to limit the export, e.g. "OU=Employees,DC=corp,DC=local".
  Disabled accounts are always included — they are half the analysis.

.PARAMETER ExtraAttributes
  Additional LDAP attribute names to collect verbatim, e.g. when a HelloID
  field mapping writes attributes outside the built-in set. They land under
  "extra" on each user; the analytics page's field-mapping view names the
  attributes it needs and can generate this list.

.EXAMPLE
  .\collect-ad.ps1
  .\collect-ad.ps1 -SearchBase "OU=Employees,DC=corp,DC=local" -OutFile corp.json
  .\collect-ad.ps1 -ExtraAttributes carLicense,departmentNumber
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
  Justification = 'Interactive console script; progress and the PII warning belong on the host, never in the pipeline.')]
[CmdletBinding()]
param(
  [string]$OutFile = "directory-ad.json",
  [string]$SearchBase = "",
  [string[]]$ExtraAttributes = @()
)

$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
function Write-Step([string]$Message) {
  Write-Host ("[{0:hh\:mm\:ss}] {1}" -f $sw.Elapsed, $Message)
}

Write-Step "Importing ActiveDirectory module..."
Import-Module ActiveDirectory
Write-Step "Module loaded. Domain: $((Get-ADDomain).DNSRoot)"

$extAttrs = 1..15 | ForEach-Object { "extensionAttribute$_" }
$userProps = @(
  'sAMAccountName','userPrincipalName','displayName','givenName','sn','initials',
  'enabled','whenCreated',
  'lastLogonTimestamp','accountExpires','department','title','company',
  'physicalDeliveryOfficeName','employeeID','employeeNumber','employeeType',
  'description','distinguishedName','manager','mail','mailNickname','proxyAddresses','memberOf',
  # Telephones tab, incl. the Notes field ("info")
  'telephoneNumber','homePhone','mobile','facsimileTelephoneNumber','pager','ipPhone','info',
  # Address tab
  'streetAddress','postOfficeBox','l','st','postalCode','c','co',
  # Common provisioning-mapping targets (Profile tab and the object name)
  'cn','homeDirectory','homeDrive','scriptPath','profilePath','wWWHomePage'
) + $extAttrs
$ExtraAttributes = @($ExtraAttributes | Where-Object { $_ -and $userProps -notcontains $_ } | Select-Object -Unique)
$userProps += $ExtraAttributes
$groupProps = @(
  'name','sAMAccountName','description','groupCategory','groupScope',
  'managedBy','member','distinguishedName','whenCreated','mail'
)

$userArgs  = @{ Filter = '*' }
$groupArgs = @{ Filter = '*'; Properties = $groupProps }
if ($SearchBase) { $userArgs.SearchBase = $SearchBase; $groupArgs.SearchBase = $SearchBase }

<#
  Not every schema carries every attribute: mailNickname needs the Exchange schema
  extension, others may be blocked or renamed. Rather than assuming, ask — and when
  the domain controller rejects a property by name, drop that one, say so, and try
  again. The output simply lacks the fields this schema does not have.
#>
function Get-AdUsersResilient([hashtable]$BaseArgs, [string[]]$Props) {
  while ($true) {
    try {
      $args2 = $BaseArgs.Clone()
      $args2.Properties = $Props
      return , (Get-ADUser @args2)
    } catch {
      $bad = if ($_.Exception.Message -match 'Parameter name:\s*(\S+)') { $Matches[1] } else { $null }
      if (-not $bad -or $Props -notcontains $bad) { throw }
      Write-Step "  attribute '$bad' is not in this schema - skipped"
      $Props = @($Props | Where-Object { $_ -ne $bad })
    }
  }
}

Write-Step "Reading users$(if ($SearchBase) { " under $SearchBase" })..."
$adUsers = Get-AdUsersResilient $userArgs $userProps
Write-Step "  $($adUsers.Count) users ($(@($adUsers | Where-Object { $_.Enabled }).Count) enabled)"
Write-Step "Reading groups..."
$adGroups = Get-ADGroup @groupArgs
Write-Step "  $($adGroups.Count) groups ($(@($adGroups | Where-Object { $_.groupCategory -eq 'Security' }).Count) security)"

$userDns  = @{}; foreach ($u in $adUsers)  { $userDns[$u.DistinguishedName] = $u }
$groupDns = @{}; foreach ($g in $adGroups) { $groupDns[$g.DistinguishedName] = $g }

function ConvertFrom-FileTime([object]$v) {
  if (-not $v -or $v -eq 0 -or $v -eq 9223372036854775807) { return $null }
  try { return [DateTime]::FromFileTimeUtc([long]$v).ToString('o') } catch { return $null }
}
function ParentOu([string]$dn) {
  if (-not $dn) { return '' }
  return ($dn -replace '^[^,]+,', '')
}

Write-Step "Shaping users..."
$shaped = 0
$users = foreach ($u in $adUsers) {
  $shaped++
  if ($shaped % 500 -eq 0) { Write-Step "  $shaped / $($adUsers.Count) users" }
  $ext = [ordered]@{}
  foreach ($ea in $extAttrs) { if ($u.$ea) { $ext[$ea] = [string]$u.$ea } }
  $extra = [ordered]@{}
  foreach ($name in $ExtraAttributes) {
    $v = $u.$name
    if ($null -ne $v -and "$v" -ne '') {
      $extra[$name] = if ($v -is [System.Collections.IEnumerable] -and $v -isnot [string]) { @(@($v) | ForEach-Object { [string]$_ }) } else { [string]$v }
    }
  }
  $mgr = if ($u.manager -and $userDns.ContainsKey($u.manager)) { $userDns[$u.manager] } else { $null }
  $expires = ConvertFrom-FileTime $u.accountExpires
  [ordered]@{
    id          = $u.DistinguishedName
    userName    = [string]$u.sAMAccountName
    upn         = [string]$u.userPrincipalName
    displayName = [string]$u.displayName
    givenName   = [string]$u.givenName
    surname     = [string]$u.sn
    initials    = [string]$u.initials
    mailNickname = [string]$u.mailNickname
    proxyAddresses = @(@($u.proxyAddresses) | Where-Object { $_ })
    usageLocation = ''
    synced      = $false
    enabled     = [bool]$u.Enabled
    created     = if ($u.whenCreated) { $u.whenCreated.ToUniversalTime().ToString('o') } else { $null }
    lastLogon   = ConvertFrom-FileTime $u.lastLogonTimestamp
    expires     = $expires
    department  = [string]$u.department
    title       = [string]$u.title
    company     = [string]$u.company
    office      = [string]$u.physicalDeliveryOfficeName
    employeeId  = if ($u.employeeID) { [string]$u.employeeID } else { [string]$u.employeeNumber }
    employeeType= [string]$u.employeeType
    description = [string]$u.description
    notes       = [string]$u.info
    mail        = [string]$u.mail
    phone       = [string]$u.telephoneNumber
    homePhone   = [string]$u.homePhone
    mobile      = [string]$u.mobile
    fax         = [string]$u.facsimileTelephoneNumber
    pager       = [string]$u.pager
    ipPhone     = [string]$u.ipPhone
    street      = [string]$u.streetAddress
    poBox       = [string]$u.postOfficeBox
    city        = [string]$u.l
    state       = [string]$u.st
    postalCode  = [string]$u.postalCode
    country     = if ($u.co) { [string]$u.co } else { [string]$u.c }
    ou          = ParentOu $u.DistinguishedName
    managerId   = [string]$u.manager
    managerName = if ($mgr) { [string]$mgr.displayName } else { '' }
    cn          = [string]$u.cn
    homeDirectory = [string]$u.homeDirectory
    homeDrive   = [string]$u.homeDrive
    scriptPath  = [string]$u.scriptPath
    profilePath = [string]$u.profilePath
    webPage     = [string]$u.wWWHomePage
    extensionAttributes = $ext
    extra       = $extra
  }
}

Write-Step "Classifying group members (users vs nested groups)..."
$shapedG = 0
$groups = foreach ($g in $adGroups) {
  $shapedG++
  if ($shapedG % 200 -eq 0) { Write-Step "  $shapedG / $($adGroups.Count) groups" }
  $memberUsers = [System.Collections.Generic.List[string]]::new()
  $memberGroups = [System.Collections.Generic.List[string]]::new()
  foreach ($dn in @($g.member)) {
    if (-not $dn) { continue }
    if ($userDns.ContainsKey($dn)) { $memberUsers.Add($dn) }
    elseif ($groupDns.ContainsKey($dn)) { $memberGroups.Add($dn) }
    # members outside the search base (or computers/contacts) are deliberately dropped
  }
  [ordered]@{
    id           = $g.DistinguishedName
    name         = [string]$g.name
    accountName  = [string]$g.sAMAccountName
    description  = [string]$g.description
    category     = [string]$g.groupCategory
    scope        = [string]$g.groupScope
    managedBy    = [string]$g.managedBy
    created      = if ($g.whenCreated) { $g.whenCreated.ToUniversalTime().ToString('o') } else { $null }
    mail         = [string]$g.mail
    ou           = ParentOu $g.DistinguishedName
    memberUsers  = $memberUsers
    memberGroups = $memberGroups
  }
}

$envelope = [ordered]@{
  kind        = 'helloid-analytics-directory'
  version     = 1
  source      = 'ad'
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  domain      = (Get-ADDomain).DNSRoot
  searchBase  = $SearchBase
  extraAttributes = @($ExtraAttributes)
  users       = @($users)
  groups      = @($groups)
}

Write-Step "Writing JSON..."
$envelope | ConvertTo-Json -Depth 8 -Compress | Out-File -FilePath $OutFile -Encoding utf8

$nested = ($groups | ForEach-Object { $_.memberGroups.Count } | Measure-Object -Sum).Sum
$edges = ($groups | ForEach-Object { $_.memberUsers.Count } | Measure-Object -Sum).Sum
$size = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
Write-Step "Done in $([math]::Round($sw.Elapsed.TotalSeconds)) s."
Write-Host ""
Write-Host "Wrote $OutFile ($size MB)"
Write-Host "  $($users.Count) users, $($groups.Count) groups"
Write-Host "  $edges direct memberships, $nested group-in-group edges"
Write-Host ""
Write-Host "This file contains personal data. Hand it only to the analyst who asked for it;"
Write-Host "it is read locally in their browser and is never uploaded anywhere."
