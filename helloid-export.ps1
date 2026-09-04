<#
.SYNOPSIS
  Pull Service Automation products and product assignments out of a HelloID tenant
  (PowerShell twin of helloid-export.py).

.DESCRIPTION
  Writes one JSON file — the products with their tasks, and who holds which product, since
  when, approved by whom — that you drag into the analytics page under Imports. Either half
  may be empty. Read-only; nothing is changed in the tenant.

  The first run asks for the tenant URL, API key and secret (HelloID portal -> Security ->
  API keys; read access is enough) and offers to save them as a profile in
  helloid-config.json next to this script. After that it just runs.

.PARAMETER OutDir
  Output directory. Default: next to the script.

.PARAMETER Legacy
  Also write the two older files, products.json and product-assignments.csv.

.PARAMETER ProfileName
  A saved profile name. Default: the config file's default profile.

.PARAMETER Setup
  Ask for the credentials again and save them.

.PARAMETER ListProfiles
  Show the saved profiles and exit.

.PARAMETER Forget
  Delete a saved profile and exit.

.PARAMETER Insecure
  Skip TLS verification (test tenants).

.EXAMPLE
  .\helloid-export.ps1
  .\helloid-export.ps1 -ProfileName customer-a -OutDir C:\exports
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
  Justification = 'Interactive console script; progress belongs on the host, never in the pipeline.')]
[CmdletBinding()]
param(
  [string]$OutDir = $PSScriptRoot,
  [switch]$Legacy,
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

$PageSize = 500   # variables are case-insensitive: not $Page, which the loop below reuses
$creds = Resolve-HelloIDCredential -Kind api -ProfileName $ProfileName -Setup:$Setup -EnvFile $EnvFile
$base = $creds.Url.TrimEnd('/')
if (-not $base.EndsWith('/api/v1')) { $base += '/api/v1' }
$headers = @{ Authorization = (Get-HelloIDBasicAuth $creds.Key $creds.Secret); Accept = 'application/json' }
$tenant = ([Uri]$base).Host

function Invoke-Api([string]$Path, [hashtable]$Query) {
  $uri = "$base$Path"
  if ($Query) {
    $qs = ($Query.Keys | ForEach-Object { "$_=$([Uri]::EscapeDataString([string]$Query[$_]))" }) -join '&'
    $uri += "?$qs"
  }
  $params = @{ Method = 'Get'; Uri = $uri; Headers = $headers; TimeoutSec = 120 }
  if ($Insecure -and $PSVersionTable.PSEdition -eq 'Core') { $params.SkipCertificateCheck = $true }
  return Invoke-RestMethod @params
}

# skip/take until a page comes back short. Some endpoints wrap the array once.
function Get-Paged([string]$Path) {
  $out = New-Object System.Collections.Generic.List[object]
  $skip = 0
  while ($true) {
    $page = Invoke-Api $Path @{ skip = $skip; take = $PageSize }
    if ($page -is [PSCustomObject] -and ($page.PSObject.Properties['data'] -or $page.PSObject.Properties['items'])) {
      $page = if ($page.data) { $page.data } else { $page.items }
    }
    $page = @($page)
    if ($page.Count -eq 1 -and $page[0] -is [array]) { $page = @($page[0]) }
    foreach ($p in $page) { $out.Add($p) }
    Write-Host ("  {0}: {1:N0} so far ..." -f $Path, $out.Count)
    if ($page.Count -lt $PageSize) { return $out.ToArray() }
    $skip += $PageSize
  }
}

function Get-ProductList {
  # /products is current; /selfservice/products is the deprecated spelling.
  foreach ($path in @('/products', '/selfservice/products')) {
    try { $data = Invoke-Api $path $null }
    catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { continue }
      throw
    }
    if ($data -is [PSCustomObject] -and ($data.PSObject.Properties['data'] -or $data.PSObject.Properties['items'])) {
      $data = if ($data.data) { $data.data } else { $data.items }
    }
    $data = @($data)
    Write-Host "  products via $path`: $($data.Count)"
    return @{ Data = $data; Path = $path }
  }
  throw 'Neither /products nor /selfservice/products answered.'
}

# Flatten the approval history to its decisive response: who let this through.
function ConvertTo-AssignmentRow($a) {
  $history = @($a.approvalHistory)
  $last = $null; if ($history.Count) { $last = $history[-1] }
  $approved = ''
  if ($last -and $null -ne $last.approved) { $approved = [string][bool]$last.approved }
  $comment = ''; if ($last -and $last.comment) { $comment = ([string]$last.comment) -replace "`n", ' ' }
  return [ordered]@{
    AssignmentGuid  = [string]$a.assignmentGuid
    UserName        = [string]$a.userName
    UserGuid        = [string]$a.userGuid
    ProductName     = [string]$a.productName
    ProductGuid     = [string]$a.productGuid
    ProductSku      = [string]$a.productSku
    RequestedAt     = [string]$a.requestedAt
    ApprovedAt      = [string]$a.approvedAt
    ReturnDate      = [string]$a.returnDate
    Source          = [string]$a.source
    ApprovedBy      = $(if ($last) { [string]$last.userName } else { '' })
    ApprovalComment = $comment
    Approved        = $approved
  }
}

$profileNote = ''; if ($creds.Profile) { $profileNote = " (profile $($creds.Profile))" }
Write-Host "Tenant $tenant$profileNote"
$pl = Get-ProductList
$products = @($pl.Data); $productPath = $pl.Path
$assignments = @(Get-Paged '/product-assignment')
Write-Host "  product assignments: $($assignments.Count)"
$rows = @($assignments | ForEach-Object { ConvertTo-AssignmentRow $_ })

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$merged = Join-Path $OutDir 'helloid-service-automation.json'
[ordered]@{ kind = 'helloid-service-automation'; version = 1; source = $productPath; tenant = $tenant; products = $products; assignments = $rows } |
  ConvertTo-Json -Depth 12 | Set-Content -Path $merged -Encoding UTF8

if ($Legacy) {
  [ordered]@{ kind = 'helloid-products'; source = $productPath; tenant = $tenant; products = $products } |
    ConvertTo-Json -Depth 12 | Set-Content -Path (Join-Path $OutDir 'products.json') -Encoding UTF8
  $rows | ForEach-Object { [PSCustomObject]$_ } | Export-Csv -Path (Join-Path $OutDir 'product-assignments.csv') -NoTypeInformation -Encoding UTF8
}

$withActions = @($products | Where-Object { $_.actions }).Count
$native = @($products | ForEach-Object { $_.actions } | Where-Object { $_.executionType -eq 'native' }).Count
$powershell = @($products | ForEach-Object { $_.actions } | Where-Object { $_.executionType -eq 'powershell' }).Count
Write-Host ''
Write-Host "$merged`: $($products.Count) products ($withActions with tasks: $native native, $powershell PowerShell), $($rows.Count) assignments. Drop it on the dashboard under Imports."
if ($Legacy) { Write-Host "  also products.json and product-assignments.csv in $OutDir" }
if ($powershell -and -not @($products | ForEach-Object { $_.actions } | Where-Object { $_.variables }).Count) {
  Write-Host ''
  Write-Host 'Note: no task variables came back. Group names for PowerShell tasks then live only in the script bodies, which this endpoint does not return.'
}
