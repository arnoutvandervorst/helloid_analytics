<#
.SYNOPSIS
  Pull the HelloID audit log out of a tenant's Elastic API (PowerShell twin of helloid-audit.py).

.DESCRIPTION
  The exports describe state; the audit log describes process: who excluded which
  reconciliation issue and why, who approved which threshold, who published which rule,
  whether imports and evaluations ran, which actions failed, who logs in to HelloID itself.
  Writes one JSON file you drag into the analytics page under Imports -> HelloID audit log.
  Read-only; nothing is changed in the tenant.

  The first run asks for the Elastic URL, key and secret (create them in HelloID at
  https://<tenant>.helloid.com/admin/elasticapikey) and offers to save them as a profile in
  helloid-config.json next to this script. After that it just runs.

.PARAMETER Days
  How far back to read. Default 400.

.PARAMETER OutFile
  Where to write the JSON. Default: helloid-audit.json next to the script.

.PARAMETER ProfileName
  A saved profile name. Default: the config file's default profile.

.PARAMETER Setup
  Ask for the credentials again and save them.

.PARAMETER ListProfiles
  Show the saved profiles and exit.

.PARAMETER Forget
  Delete a saved profile and exit.

.PARAMETER Insecure
  Skip TLS verification (corporate proxies).

.EXAMPLE
  .\helloid-audit.ps1
  .\helloid-audit.ps1 -Days 90 -ProfileName customer-a
  .\helloid-audit.ps1 -Setup
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
  Justification = 'Interactive console script; progress belongs on the host, never in the pipeline.')]
[CmdletBinding()]
param(
  [int]$Days = 400,
  [string]$OutFile = (Join-Path $PSScriptRoot 'helloid-audit.json'),
  [string]$ProfileName = '',
  [switch]$Setup,
  [switch]$ListProfiles,
  [string]$Forget = '',
  [switch]$Insecure,
  [string]$EnvFile = (Join-Path $PSScriptRoot '.env')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'HelloIDCreds.ps1')

if ($ListProfiles) { Show-HelloIDProfile; return }
if ($Forget) { Remove-HelloIDProfile $Forget; return }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
function Write-Step([string]$Message) {
  Write-Host ("[{0:mm\:ss}] {1}" -f $sw.Elapsed, $Message)
}
function Write-Progress-Line([string]$Message) {
  if ([Console]::IsOutputRedirected) { Write-Host "        $Message" }
  else { Write-Host ("`r" + (' ' * 100) + "`r        $Message") -NoNewline }
}

$Page = 5000
$WindowCap = 10000
# index pattern, output key, fields to keep (empty = all)
$Sources = @(
  @('provisioning-audit*', 'provisioning', @('logDate', 'action', 'state', 'personDisplayName', 'systemName', 'systemType', 'message', 'actionDurationMs', 'waitDurationMs')),
  @('provisioning-user-action-reconciliation*', 'reconciliation', @()),
  @('provisioning-user-action-thresholds*', 'thresholds', @()),
  @('provisioning-user-action-business-rules*', 'rules', @()),
  @('provisioning-user-action-entitlement*', 'entitlements', @()),
  @('provisioning-user-action-evaluation*', 'evaluations', @()),
  @('provisioning-user-action-target-system*', 'systemChanges', @()),
  @('provisioning-user-action-source-system*', 'systemChanges', @()),
  @('provisioning-source-import*', 'imports', @()),
  @('provisioning-source-snapshot*', 'snapshots', @()),
  @('authentication-login*', 'logins', @('logDate', 'userName', 'userGuid', 'idpName', 'idpType', 'loginSuccess', 'resultCode', 'ipAddress', 'geoip.country_iso_code', 'geoip.city_name', 'user_agent.os.name', 'user_agent.name')),
  @('authentication-user-*', 'portalAdmin', @()),
  @('authentication-group-*', 'portalAdmin', @()),
  @('authentication-admin-*', 'portalAdmin', @()),
  @('authentication-mfa*', 'mfa', @()),
  @('general-incidents*', 'incidents', @()),
  @('general-license-counts*', 'licenses', @())
)

$creds = Resolve-HelloIDCredential -Kind elastic -ProfileName $ProfileName -Setup:$Setup -EnvFile $EnvFile
$base = $creds.Url.TrimEnd('/')
$headers = @{ Authorization = (Get-HelloIDBasicAuth $creds.Key $creds.Secret); Accept = 'application/json' }
$script:Requests = 0

function Invoke-Search([string]$Pattern, [hashtable]$Body) {
  $script:Requests++
  $json = $Body | ConvertTo-Json -Depth 8 -Compress
  $params = @{ Method = 'Post'; Uri = "$base/$Pattern/_search"; Headers = $headers; ContentType = 'application/json'; Body = $json; TimeoutSec = 180 }
  if ($Insecure -and $PSVersionTable.PSEdition -eq 'Core') { $params.SkipCertificateCheck = $true }
  try { return Invoke-RestMethod @params }
  catch {
    # The proxy answers errors in plain text, not JSON.
    $detail = $_.ErrorDetails.Message; if (-not $detail) { $detail = $_.Exception.Message }
    throw "$Pattern/_search -> $detail"
  }
}

function Get-Iso([datetime]$D) { return $D.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z') }
function Get-RangeQuery([datetime]$Start, [datetime]$End) {
  return @{ range = @{ logDate = @{ gte = (Get-Iso $Start); lt = (Get-Iso $End) } } }
}

function Get-Count([string]$Pattern, [datetime]$Start, [datetime]$End) {
  $res = Invoke-Search $Pattern @{ size = 0; track_total_hits = $true; query = (Get-RangeQuery $Start $End) }
  return [int]$res.hits.total.value
}

# Every hit in [start, end): from+size pages inside the cap, splitting the window when it holds more.
function Get-AuditWindow([string]$Pattern, [datetime]$Start, [datetime]$End, [string[]]$Fields, [hashtable]$Tally) {
  $total = Get-Count $Pattern $Start $End
  if ($total -eq 0) { return @() }
  if ($total -gt $WindowCap) {
    if (($End - $Start).TotalMinutes -le 1) {
      Write-Warning "$Pattern`: more than $WindowCap events inside one minute at $(Get-Iso $Start); keeping the first $WindowCap"
    } else {
      $mid = $Start.AddTicks([long](($End - $Start).Ticks / 2))
      $Tally.splits++
      Write-Progress-Line ("{0:N0} rows - {1} requests - splitting {2} -> {3} ({4:N0} events)" -f $Tally.rows, $script:Requests, (Get-Iso $Start).Substring(0, 10), (Get-Iso $End).Substring(0, 10), $total)
      return @(Get-AuditWindow $Pattern $Start $mid $Fields $Tally) + @(Get-AuditWindow $Pattern $mid $End $Fields $Tally)
    }
  }
  $out = New-Object System.Collections.Generic.List[object]
  $offset = 0
  $limit = [Math]::Min($total, $WindowCap)
  while ($offset -lt $limit) {
    $body = @{ size = $Page; from = $offset; sort = @(@{ logDate = 'asc' }); query = (Get-RangeQuery $Start $End) }
    if ($Fields.Count) { $body['_source'] = $Fields }
    $res = Invoke-Search $Pattern $body
    $hits = @($res.hits.hits)
    if (-not $hits.Count) { break }
    foreach ($h in $hits) {
      $src = $h._source
      $src.PSObject.Properties.Remove('tenant'); $src.PSObject.Properties.Remove('tid')
      # The sub-index is the event type; the ILM suffix and restored- prefix are storage, not meaning.
      $ev = ($h._index -replace '^restored-', '') -split '-ilm' | Select-Object -First 1
      $ev = ($ev -split '-v2')[0]
      $src | Add-Member -NotePropertyName event -NotePropertyValue $ev -Force
      $out.Add($src)
    }
    $offset += $hits.Count
    $Tally.rows += $hits.Count
    $lastDate = [string]$hits[-1]._source.logDate; if ($lastDate.Length -gt 10) { $lastDate = $lastDate.Substring(0, 10) }
    Write-Progress-Line ("{0:N0} rows - {1} requests - up to {2}" -f $Tally.rows, $script:Requests, $lastDate)
    if ($hits.Count -lt $Page) { break }
  }
  return $out.ToArray()
}

$end = [datetime]::UtcNow.AddMinutes(1)
$end = $end.AddTicks(-($end.Ticks % [TimeSpan]::TicksPerSecond))
$start = $end.AddDays(-$Days)
$profileNote = ''; if ($creds.Profile) { $profileNote = " (profile $($creds.Profile))" }
Write-Step "Connecting to $(($base -split '/service/')[0])$profileNote ..."

# The tenant names itself on every row; read it off one.
$tenant = @{ name = ''; tid = '' }
$probe = Invoke-Search 'provisioning-audit*' @{ size = 1; sort = @(@{ logDate = 'desc' }) }
if (@($probe.hits.hits).Count) {
  $t = $probe.hits.hits[0]._source.tenant
  if ($t) { $tenant = @{ name = [string]$t.tenantName; tid = [string]$t.tid } }
}
Write-Step ("Tenant: {0} - window {1} -> {2} ({3} days), {4} index patterns" -f ($(if ($tenant.name) { $tenant.name } else { '(unnamed)' })), (Get-Iso $start).Substring(0, 10), (Get-Iso $end).Substring(0, 10), $Days, $Sources.Count)

$out = [ordered]@{ kind = 'helloid-audit'; version = 1; collectedAt = (Get-Iso $end); tenant = $tenant; from = (Get-Iso $start); to = (Get-Iso $end); counts = [ordered]@{} }
$lists = @{}
$grand = 0
$n = 0
foreach ($src in $Sources) {
  $n++
  $pattern, $target, $fields = $src
  Write-Step "($n/$($Sources.Count)) $pattern"
  $tally = @{ rows = 0; splits = 0 }
  $before = $script:Requests
  $rows = @(Get-AuditWindow $pattern $start $end $fields $tally)
  if (-not [Console]::IsOutputRedirected -and $tally.rows) { Write-Host ("`r" + (' ' * 100) + "`r") -NoNewline }
  if (-not $lists.ContainsKey($target)) { $lists[$target] = New-Object System.Collections.Generic.List[object] }
  foreach ($r in $rows) { $lists[$target].Add($r) }
  $grand += $rows.Count
  $split = ''; if ($tally.splits) { $split = ", window split $($tally.splits)x" }
  Write-Step ("        {0:N0} rows in {1} request(s){2} -> {3}" -f $rows.Count, ($script:Requests - $before), $split, $target)
}
foreach ($src in $Sources) {
  $target = $src[1]
  if ($out.Contains($target)) { continue }
  $sorted = @($lists[$target] | Sort-Object { [string]$_.logDate })
  $out[$target] = $sorted
  $out.counts[$target] = $sorted.Count
}

Write-Step 'Writing JSON ...'
$out | ConvertTo-Json -Depth 12 -Compress | Set-Content -Path $OutFile -Encoding UTF8
$size = [Math]::Round((Get-Item $OutFile).Length / 1MB, 1)
Write-Step ("Wrote {0} ({1} MB) - {2:N0} rows over {3} requests" -f $OutFile, $size, $grand, $script:Requests)
Write-Host ''
Write-Host 'Summary:'
foreach ($k in $out.counts.Keys) { Write-Host ("  {0,-16} {1,8:N0}" -f $k, $out.counts[$k]) }
Write-Host ''
Write-Host 'Drop the file on the dashboard under Imports -> HelloID audit log. It names people and'
Write-Host 'the decisions taken about them: hand it only to the analyst who asked for it.'
