<#
.SYNOPSIS
  Credential handling shared by helloid-export.ps1 and helloid-audit.ps1 (dot-sourced).

.DESCRIPTION
  One saved profile serves both collectors: tenant URL, REST API key and secret, Elastic
  URL, key and secret. Each script asks only for the fields it needs.

  Resolution order, first hit wins:
    1. -ProfileName NAME             a named profile in helloid-config.json
    2. the config file's default profile
    3. environment variables         HELLOID_URL / HELLOID_API_KEY / HELLOID_API_SECRET,
                                     HELLOID_ELASTIC_URL / _KEY / _SECRET (or a .env file)
    4. an interactive prompt, with the offer to save what was typed as a profile

  helloid-config.json sits next to the scripts and is shared with the Python collectors
  (same shape). It holds secrets in clear, so it stays on your machine: it is gitignored
  and never copied into the hosted app. On Windows the file inherits the folder's NTFS
  permissions — keep the folder to yourself.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
  Justification = 'Interactive console helper; prompts and confirmations belong on the host.')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingConvertToSecureStringWithPlainText', '',
  Justification = 'The saved profile is read back into a SecureString; the file itself is the trust boundary.')]
param()

$script:HelloIDConfigPath = Join-Path $PSScriptRoot 'helloid-config.json'

$script:HelloIDKinds = @{
  api = @{
    Title  = 'HelloID REST API (products and product assignments)'
    Where  = 'Create the key in the HelloID portal: Security -> API keys (read access is enough).'
    Fields = @(
      @{ Key = 'url';       Env = 'HELLOID_URL';        Label = 'Tenant URL (https://<tenant>.helloid.com)'; Hidden = $false },
      @{ Key = 'apiKey';    Env = 'HELLOID_API_KEY';    Label = 'API key';                                  Hidden = $false },
      @{ Key = 'apiSecret'; Env = 'HELLOID_API_SECRET'; Label = 'API secret';                               Hidden = $true }
    )
  }
  elastic = @{
    Title  = 'HelloID Elastic API (audit log)'
    Where  = 'Enable it at https://<tenant>.helloid.com/admin/elasticapikey - the page shows the URL, key and secret.'
    Fields = @(
      @{ Key = 'elasticUrl';    Env = 'HELLOID_ELASTIC_URL';    Label = 'Elastic URL (https://<region>.helloid.cloud/service/elastic-proxy/elastic)'; Hidden = $false },
      @{ Key = 'elasticKey';    Env = 'HELLOID_ELASTIC_KEY';    Label = 'Elastic key';                                                                  Hidden = $false },
      @{ Key = 'elasticSecret'; Env = 'HELLOID_ELASTIC_SECRET'; Label = 'Elastic secret';                                                               Hidden = $true }
    )
  }
}

function Read-HelloIDConfig {
  if (-not (Test-Path $script:HelloIDConfigPath)) { return @{ default = $null; profiles = @{} } }
  try { $raw = Get-Content -Raw -Path $script:HelloIDConfigPath | ConvertFrom-Json }
  catch { throw "$($script:HelloIDConfigPath) could not be read: $($_.Exception.Message)" }
  $profiles = @{}
  if ($raw.profiles) {
    foreach ($p in $raw.profiles.PSObject.Properties) {
      $h = @{}
      foreach ($f in $p.Value.PSObject.Properties) { $h[$f.Name] = $f.Value }
      $profiles[$p.Name] = $h
    }
  }
  return @{ default = $raw.default; profiles = $profiles }
}

function Save-HelloIDConfig([hashtable]$Data) {
  $out = [ordered]@{ default = $Data.default; profiles = [ordered]@{} }
  foreach ($name in $Data.profiles.Keys) { $out.profiles[$name] = $Data.profiles[$name] }
  $tmp = "$($script:HelloIDConfigPath).tmp"
  $out | ConvertTo-Json -Depth 5 | Set-Content -Path $tmp -Encoding UTF8
  if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { & chmod 600 $tmp 2>$null }
  Move-Item -Force -Path $tmp -Destination $script:HelloIDConfigPath
  Write-Host "  Saved to $($script:HelloIDConfigPath). It holds the secret in clear: keep the folder to yourself."
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  if (-not $Path -or -not (Test-Path $Path)) { return $values }
  foreach ($line in Get-Content -Path $Path) {
    $l = $line.Trim()
    if (-not $l -or $l.StartsWith('#') -or -not $l.Contains('=')) { continue }
    $i = $l.IndexOf('=')
    $values[$l.Substring(0, $i).Trim()] = $l.Substring($i + 1).Trim().Trim('"').Trim("'")
  }
  return $values
}

function Show-HelloIDProfile {
  $data = Read-HelloIDConfig
  if ($data.profiles.Count -eq 0) {
    Write-Host "No profiles yet. Run a collector once; it asks and offers to save. ($($script:HelloIDConfigPath))"
    return
  }
  Write-Host "Profiles in $($script:HelloIDConfigPath):"
  foreach ($name in $data.profiles.Keys) {
    $p = $data.profiles[$name]
    $has = @()
    if ($p.apiKey) { $has += 'REST API' }
    if ($p.elasticKey) { $has += 'Elastic' }
    $mark = ''; if ($name -eq $data.default) { $mark = ' (default)' }
    $url = $p.url; if (-not $url) { $url = $p.elasticUrl }; if (-not $url) { $url = '?' }
    $keys = 'no keys'; if ($has.Count) { $keys = $has -join ', ' }
    Write-Host "  $name$mark`: $url - $keys"
  }
}

function Remove-HelloIDProfile {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Name)
  $data = Read-HelloIDConfig
  if (-not $data.profiles.ContainsKey($Name)) { throw "No profile `"$Name`" in $($script:HelloIDConfigPath)." }
  if (-not $PSCmdlet.ShouldProcess($Name, 'forget profile')) { return }
  $data.profiles.Remove($Name)
  if ($data.default -eq $Name) { $data.default = $null; foreach ($k in $data.profiles.Keys) { $data.default = $k; break } }
  Save-HelloIDConfig $data
  Write-Host "Forgot profile `"$Name`"."
}

function ConvertFrom-SecureToPlain([securestring]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-HelloIDPrompt([string]$Kind, [hashtable]$Existing) {
  $spec = $script:HelloIDKinds[$Kind]
  if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
    $envs = ($spec.Fields | ForEach-Object { $_.Env }) -join ', '
    throw "No credentials for the $($spec.Title) and no terminal to ask on.`nGive them one of three ways: a profile (run once interactively, or -Setup), environment variables ($envs), or a .env file."
  }
  Write-Host ''
  Write-Host $spec.Title
  Write-Host "  $($spec.Where)"
  $out = @{}
  foreach ($f in $spec.Fields) {
    $default = ''; if ($Existing -and $Existing[$f.Key]) { $default = $Existing[$f.Key] }
    while ($true) {
      if ($f.Hidden) {
        $suffix = ''; if ($default) { $suffix = ' [keep current]' }
        $sec = Read-Host -Prompt "  $($f.Label)$suffix" -AsSecureString
        $value = ConvertFrom-SecureToPlain $sec
      } else {
        $suffix = ''; if ($default) { $suffix = " [$default]" }
        $value = Read-Host -Prompt "  $($f.Label)$suffix"
      }
      $value = $value.Trim(); if (-not $value) { $value = $default }
      if ($value) { break }
      Write-Host '    required'
    }
    $out[$f.Key] = $value
  }
  return $out
}

function Get-HelloIDHostName([string]$Url) {
  $h = $Url -replace '^https?://', '' -split '/' | Select-Object -First 1
  $h = ($h -split '\.')[0]
  if (-not $h) { $h = 'tenant' }
  return $h
}

<#
  Resolve-HelloIDCredential -Kind api|elastic -ProfileName x -Setup -EnvFile path
  Returns @{ Url; Key; Secret; Profile }. -ListProfiles and -Forget are handled by the caller.
#>
function Resolve-HelloIDCredential {
  param([string]$Kind, [string]$ProfileName, [switch]$Setup, [string]$EnvFile)
  $spec = $script:HelloIDKinds[$Kind]
  $fields = $spec.Fields | ForEach-Object { $_.Key }
  $data = Read-HelloIDConfig

  $name = $ProfileName; if (-not $name) { $name = $data.default }
  $prof = $null; if ($name -and $data.profiles.ContainsKey($name)) { $prof = $data.profiles[$name] }
  if ($ProfileName -and -not $prof) {
    throw "No profile `"$ProfileName`" in $($script:HelloIDConfigPath). -ListProfiles shows what there is; -Setup creates one."
  }

  $complete = $false
  if ($prof) { $complete = $true; foreach ($f in $fields) { if (-not $prof[$f]) { $complete = $false } } }
  if ($complete -and -not $Setup) {
    return @{ Url = $prof[$fields[0]]; Key = $prof[$fields[1]]; Secret = $prof[$fields[2]]; Profile = $name }
  }

  if (-not $Setup) {
    $dot = Read-DotEnv $EnvFile
    $vals = @()
    foreach ($f in $spec.Fields) {
      $v = [Environment]::GetEnvironmentVariable($f.Env); if (-not $v) { $v = $dot[$f.Env] }
      $vals += $v
    }
    if (-not ($vals | Where-Object { -not $_ })) {
      return @{ Url = $vals[0]; Key = $vals[1]; Secret = $vals[2]; Profile = $null }
    }
  }

  $typed = Read-HelloIDPrompt $Kind $prof
  $defaultName = $name; if (-not $defaultName) { $defaultName = Get-HelloIDHostName $typed[$fields[0]] }
  $answer = (Read-Host -Prompt "  Save as profile [$defaultName] (enter = yes, `"n`" = no, or another name)").Trim()
  if ($answer.ToLower() -notin @('n', 'no')) {
    $pname = $defaultName
    if ($answer -and $answer.ToLower() -notin @('y', 'yes')) { $pname = $answer }
    $merged = @{}; if ($data.profiles.ContainsKey($pname)) { $merged = $data.profiles[$pname] }
    foreach ($k in $typed.Keys) { $merged[$k] = $typed[$k] }
    $data.profiles[$pname] = $merged
    if (-not $data.default) { $data.default = $pname }
    Save-HelloIDConfig $data
    $name = $pname
  }
  return @{ Url = $typed[$fields[0]]; Key = $typed[$fields[1]]; Secret = $typed[$fields[2]]; Profile = $name }
}

function Get-HelloIDBasicAuth([string]$Key, [string]$Secret) {
  return 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$Key`:$Secret"))
}
