param(
  [int]$Port = 8787,
  [string]$CodexPath = "",
  [string]$CodexConfigPath = "",
  [string]$Workspace = "",
  [switch]$SelfTest,
  [switch]$SmokeTest,
  [switch]$HelixSmokeTest,
  [string]$HelixSmokeBaseUrl = "https://10.214.41.6:8443/helix-alm/api/v0",
  [string]$HelixSmokeUsername = "YuMeng Li",
  [string]$HelixSmokeProject = "CEP-LP XiaoPeng"
)

$ErrorActionPreference = "Stop"
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = $script:Utf8NoBom
[Console]::InputEncoding = $script:Utf8NoBom
[Console]::OutputEncoding = $script:Utf8NoBom
$script:ResolvedCodexConfigPath = ""
$script:MemoryFile = Join-Path $PSScriptRoot "aspice-audit-memory.json"
$script:Sessions = @{}
$script:DefaultHelixApiUrl = "https://10.214.41.6:8443/helix-alm/api/v0"
$script:DefaultHelixRestHost = "10.214.41.6"

function Find-CodexExecutable {
  if ($CodexPath -and (Test-Path -LiteralPath $CodexPath)) {
    $resolved = (Resolve-Path -LiteralPath $CodexPath).Path
    $item = Get-Item -LiteralPath $resolved
    if ($item.PSIsContainer) {
      $foundInFolder = Get-ChildItem -LiteralPath $resolved -Recurse -Include codex.exe,codex.cmd,codex.bat -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($foundInFolder) {
        return $foundInFolder.FullName
      }
      $configInFolder = Get-ChildItem -LiteralPath $resolved -Recurse -Filter config.toml -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($configInFolder) {
        $script:ResolvedCodexConfigPath = $configInFolder.FullName
      }
    } elseif ($item.Extension -ieq ".toml") {
      $script:ResolvedCodexConfigPath = $item.FullName
    } elseif ($item.Extension -match '^\.(exe|cmd|bat|ps1)$') {
      return $item.FullName
    }
  }

  $cmd = Get-Command codex -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return $cmd.Source
  }

  $cursorRoot = Join-Path $env:USERPROFILE ".cursor\extensions"
  if (Test-Path -LiteralPath $cursorRoot) {
    $found = Get-ChildItem -LiteralPath $cursorRoot -Recurse -Filter codex.exe -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }

  throw "codex.exe was not found. Install/enable the Cursor Codex extension or add codex.exe to PATH."
}

function Get-CodexConfigSummary {
  $candidateConfig = ""
  if ($CodexConfigPath -and (Test-Path -LiteralPath $CodexConfigPath)) {
    $resolved = (Resolve-Path -LiteralPath $CodexConfigPath).Path
    $item = Get-Item -LiteralPath $resolved
    if ($item.PSIsContainer) {
      $nested = Get-ChildItem -LiteralPath $resolved -Recurse -Filter config.toml -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($nested) { $candidateConfig = $nested.FullName }
    } elseif ($item.Extension -ieq ".toml") {
      $candidateConfig = $item.FullName
    }
  }
  if (!$candidateConfig -and $script:ResolvedCodexConfigPath) {
    $candidateConfig = $script:ResolvedCodexConfigPath
  }
  if (!$candidateConfig -and $env:CODEX_CONFIG_FILE -and (Test-Path -LiteralPath $env:CODEX_CONFIG_FILE)) {
    $candidateConfig = (Resolve-Path -LiteralPath $env:CODEX_CONFIG_FILE).Path
  }
  if (!$candidateConfig) {
    $candidateConfig = Join-Path $env:USERPROFILE ".codex\config.toml"
  }
  $configPath = $candidateConfig
  $summary = [ordered]@{
    configPath = $configPath
    provider = ""
    model = ""
    baseUrl = ""
    wireApi = ""
    requiresOpenAiAuth = $false
  }
  if (!(Test-Path -LiteralPath $configPath)) {
    return $summary
  }

  $text = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
  if ($text -match '(?m)^model_provider\s*=\s*"([^"]+)"') { $summary.provider = $matches[1] }
  if ($text -match '(?m)^model\s*=\s*"([^"]+)"') { $summary.model = $matches[1] }
  if ($text -match '(?ms)^\[model_providers\.je\].*?^base_url\s*=\s*"([^"]+)"') { $summary.baseUrl = $matches[1] }
  if ($text -match '(?ms)^\[model_providers\.je\].*?^wire_api\s*=\s*"([^"]+)"') { $summary.wireApi = $matches[1] }
  if ($text -match '(?ms)^\[model_providers\.je\].*?^requires_openai_auth\s*=\s*true') { $summary.requiresOpenAiAuth = $true }
  return $summary
}

function Get-BridgeWorkspace {
  if ($Workspace) {
    return (Resolve-Path -LiteralPath $Workspace).Path
  }
  return $PSScriptRoot
}

function Test-CodexSupportsSearch {
  param([string]$Codex)
  try {
    $help = & $Codex --help 2>$null | Out-String
    return ($help -match "--search")
  } catch {
    return $false
  }
}

function New-CodexPrompt {
  param([object]$Payload)

  $instructions = [string]$Payload.instructions
  $inputText = [string]$Payload.input
  return @"
You are an ASPICE audit assistant. Return only the final review content. Do not modify files and do not read the local filesystem. Base project-specific findings on the uploaded-document analysis input below. If web search is available, use it only to benchmark public ASPICE work-product expectations and cite no project facts from the web. If the user input asks for Chinese output, answer in Chinese.

<system_instructions>
$instructions
</system_instructions>

<uploaded_document_analysis_input>
$inputText
</uploaded_document_analysis_input>
"@
}

function Invoke-CodexCli {
  param([object]$Payload)

  $codex = Find-CodexExecutable
  $workDir = Get-BridgeWorkspace
  $configSummary = Get-CodexConfigSummary
  if ($configSummary.configPath -and (Test-Path -LiteralPath $configSummary.configPath)) {
    $env:CODEX_CONFIG_FILE = $configSummary.configPath
    $env:CODEX_HOME = Split-Path -Parent $configSummary.configPath
  }
  $model = [string]$Payload.model
  if (!$model) {
    $model = $configSummary.model
  }
  if (!$model) {
    $model = "gpt-5.5"
  }

  $prompt = New-CodexPrompt -Payload $Payload
  $outFile = Join-Path $env:TEMP ("aspice-codex-last-message-" + [guid]::NewGuid().ToString("N") + ".txt")
  $supportsSearch = Test-CodexSupportsSearch -Codex $codex

  $args = @()
  if ($supportsSearch) {
    $args += "--search"
  }
  $args += @(
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox", "read-only",
    "--color", "never",
    "--output-last-message", $outFile,
    "-m", $model,
    "-C", $workDir,
    "-"
  )

  try {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $output = $prompt | & $codex @args 2>&1 | Out-String
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    $exitCode = $LASTEXITCODE
    $lastMessage = ""
    if (Test-Path -LiteralPath $outFile) {
      $lastMessage = Get-Content -LiteralPath $outFile -Raw -Encoding UTF8
    }
    if ($exitCode -ne 0) {
      $detail = ($output + "`n" + $lastMessage).Trim()
      if ($detail.Length -gt 4000) { $detail = $detail.Substring(0, 4000) }
      throw "codex exec failed with exit code $exitCode. $detail"
    }
    if (!$lastMessage.Trim()) {
      $lastMessage = $output
    }
    return [ordered]@{
      id = "aspice-codex-" + [guid]::NewGuid().ToString("N")
      object = "response"
      created_at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      status = "completed"
      model = $model
      output_text = $lastMessage.Trim()
      output = @(
        [ordered]@{
          type = "message"
          role = "assistant"
          content = @(
            [ordered]@{
              type = "output_text"
              text = $lastMessage.Trim()
            }
          )
        }
      )
    }
  } finally {
    if (Test-Path -LiteralPath $outFile) {
      Remove-Item -LiteralPath $outFile -Force
    }
  }
}

function Send-Json {
  param($Context, [int]$StatusCode, [object]$Body)

  $res = $Context.Response
  $res.StatusCode = $StatusCode
  $res.Headers["Access-Control-Allow-Origin"] = "*"
  $res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
  $res.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-ASPICE-Session"
  $res.Headers["Access-Control-Allow-Private-Network"] = "true"
  if ($StatusCode -eq 204) {
    $res.ContentLength64 = 0
    $res.Close()
    return
  }
  $json = $Body | ConvertTo-Json -Depth 20
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $res.ContentType = "application/json; charset=utf-8"
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}

function New-BridgeToken {
  return [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
}

function New-PasswordSalt {
  $bytes = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Get-PasswordHash {
  param([string]$Password, [string]$Salt)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Salt + "`n" + $Password)
    return [Convert]::ToBase64String($sha.ComputeHash($bytes))
  } finally {
    $sha.Dispose()
  }
}

function Read-MemoryStore {
  if (!(Test-Path -LiteralPath $script:MemoryFile)) {
    return [ordered]@{ users = @(); projects = @(); files = @() }
  }
  try {
    $store = Get-Content -LiteralPath $script:MemoryFile -Raw -Encoding UTF8 | ConvertFrom-Json
    return [ordered]@{
      users = @($store.users)
      projects = @($store.projects)
      files = @($store.files)
    }
  } catch {
    return [ordered]@{ users = @(); projects = @(); files = @() }
  }
}

function Write-MemoryStore {
  param([object]$Store)
  $json = $Store | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($script:MemoryFile, $json, $script:Utf8NoBom)
}

function Get-SessionEmail {
  param($Request, [object]$Body)
  $token = $Request.Headers["X-ASPICE-Session"]
  if (!$token) {
    $auth = $Request.Headers["Authorization"]
    if ($auth -match '^Bearer\s+(.+)$') { $token = $matches[1] }
  }
  if (!$token -and $Body -and $Body.sessionToken) {
    $token = [string]$Body.sessionToken
  }
  if ($token -and $script:Sessions.ContainsKey($token)) {
    return [string]$script:Sessions[$token]
  }
  throw "Not authenticated. Please sign in again."
}

function Get-PublicMemory {
  param([object]$Store, [string]$Email)
  $projects = @($Store.projects | Where-Object { $_.email -eq $Email } | Sort-Object updatedAt -Descending)
  $files = @($Store.files | Where-Object { $_.email -eq $Email } | Sort-Object updatedAt -Descending)
  return [ordered]@{
    projects = $projects
    files = $files
  }
}

function Invoke-AuthLogin {
  param([object]$Payload)
  $email = ([string]$Payload.email).Trim().ToLowerInvariant()
  $password = [string]$Payload.password
  if (!$email -or $email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    throw "A valid email address is required."
  }
  if (!$password -or $password.Length -lt 6) {
    throw "Password must contain at least 6 characters."
  }
  $store = Read-MemoryStore
  $users = @($store.users)
  $user = $users | Where-Object { $_.email -eq $email } | Select-Object -First 1
  $created = $false
  if (!$user) {
    $salt = New-PasswordSalt
    $user = [pscustomobject]@{
      email = $email
      salt = $salt
      passwordHash = Get-PasswordHash -Password $password -Salt $salt
      createdAt = [DateTimeOffset]::UtcNow.ToString("o")
      updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    }
    $users += $user
    $store.users = $users
    $created = $true
    Write-MemoryStore $store
  } else {
    $hash = Get-PasswordHash -Password $password -Salt ([string]$user.salt)
    if ($hash -ne [string]$user.passwordHash) {
      throw "Email or password is incorrect."
    }
  }
  $token = New-BridgeToken
  $script:Sessions[$token] = $email
  return [ordered]@{
    ok = $true
    created = $created
    sessionToken = $token
    user = [ordered]@{ email = $email }
    memory = Get-PublicMemory -Store $store -Email $email
  }
}

function Invoke-MemoryProject {
  param([object]$Payload, [string]$Email)
  $store = Read-MemoryStore
  $projects = @($store.projects)
  $projectId = [string]$Payload.projectId
  if (!$projectId) { $projectId = "project-" + [guid]::NewGuid().ToString("N") }
  $name = ([string]$Payload.name).Trim()
  if (!$name) { $name = "ASPICE Project " + (Get-Date -Format "yyyy-MM-dd HH:mm") }
  $now = [DateTimeOffset]::UtcNow.ToString("o")
  $existing = $projects | Where-Object { $_.id -eq $projectId -and $_.email -eq $Email } | Select-Object -First 1
  if ($existing) {
    $existing.name = $name
    $existing.description = [string]$Payload.description
    $existing.selectedProcesses = @($Payload.selectedProcesses)
    $existing.updatedAt = $now
  } else {
    $projects += [pscustomobject]@{
      id = $projectId
      email = $Email
      name = $name
      description = [string]$Payload.description
      selectedProcesses = @($Payload.selectedProcesses)
      createdAt = $now
      updatedAt = $now
    }
  }
  $store.projects = $projects
  Write-MemoryStore $store
  return [ordered]@{ ok = $true; memory = Get-PublicMemory -Store $store -Email $Email }
}

function Invoke-MemorySnapshot {
  param([object]$Payload, [string]$Email)
  $store = Read-MemoryStore
  $projectPayload = $Payload.project
  if (!$projectPayload) {
    $projectPayload = [pscustomobject]@{ name = "ASPICE Project " + (Get-Date -Format "yyyy-MM-dd HH:mm") }
  }
  $projectResult = Invoke-MemoryProject -Payload $projectPayload -Email $Email
  $store = Read-MemoryStore
  $projectId = [string]$projectPayload.projectId
  if (!$projectId) { $projectId = [string]$projectPayload.id }
  if (!$projectId) {
    $projectId = @($store.projects | Where-Object { $_.email -eq $Email } | Sort-Object updatedAt -Descending | Select-Object -First 1).id
  }
  $files = @($store.files)
  $now = [DateTimeOffset]::UtcNow.ToString("o")
  foreach ($file in @($Payload.files)) {
    $fileName = ([string]$file.name).Trim()
    if (!$fileName) { continue }
    $existing = $files | Where-Object { $_.email -eq $Email -and $_.projectId -eq $projectId -and $_.name -eq $fileName } | Select-Object -First 1
    if ($existing) {
      $existing.size = [Int64]($file.size | ForEach-Object { if ($_ -ne $null) { $_ } else { 0 } })
      $existing.processId = [string]$file.processId
      $existing.processName = [string]$file.processName
      $existing.role = [string]$file.role
      $existing.structure = [string]$file.structure
      $existing.updatedAt = $now
    } else {
      $files += [pscustomobject]@{
        id = "file-" + [guid]::NewGuid().ToString("N")
        email = $Email
        projectId = $projectId
        name = $fileName
        size = [Int64]($file.size | ForEach-Object { if ($_ -ne $null) { $_ } else { 0 } })
        processId = [string]$file.processId
        processName = [string]$file.processName
        role = [string]$file.role
        structure = [string]$file.structure
        createdAt = $now
        updatedAt = $now
      }
    }
  }
  $store.files = $files
  Write-MemoryStore $store
  return [ordered]@{ ok = $true; memory = Get-PublicMemory -Store $store -Email $Email }
}

function Normalize-HelixBaseUrl {
  param([string]$BaseUrl)
  $value = ([string]$BaseUrl).Trim().TrimEnd("/")
  if (!$value) {
    $value = $script:DefaultHelixApiUrl
  }
  if ($value -notmatch '^https?://') {
    $value = "https://" + $value
  }
  try {
    $builder = [System.UriBuilder]::new($value)
    $host = $builder.Host.ToLowerInvariant()
    if ($host -in @("localhost", "127.0.0.1", "::1")) {
      return $script:DefaultHelixApiUrl
    }
    if ($host -eq "cloud") {
      $builder.Host = $script:DefaultHelixRestHost
      $builder.Port = 8443
    } elseif ($builder.Port -eq 99) {
      $builder.Port = 8443
    }
    $path = ($builder.Path.TrimEnd("/") -replace '/projects$', '')
    if ($path -match '/(?:helix-alm|perforce-alm)/api/v\d+$' -or $path -match '/api/v\d+$') {
      $builder.Path = $path
    } elseif ($path -match '/(?:helix-alm|perforce-alm)$') {
      $builder.Path = $path + "/api/v0"
    } else {
      $prefix = if ($path -and $path -ne "/") { $path } else { "" }
      $builder.Path = $prefix + "/helix-alm/api/v0"
    }
    $builder.Query = ""
    $builder.Fragment = ""
    return $builder.Uri.AbsoluteUri.TrimEnd("/")
  } catch {
    if ($value -match '^https?://(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::8443)?') {
      return $script:DefaultHelixApiUrl
    }
    if ($value -match '^https?://cloud(?::99|:8443)?') {
      return $script:DefaultHelixApiUrl
    }
    if ($value -match '^https?://([^/:]+):99(?:/)?$') {
      $value = "https://" + $Matches[1] + ":8443"
    }
    if ($value -match '/(?:helix-alm|perforce-alm)/api/v\d+$') {
      return $value
    }
    if ($value -match '/api/v\d+$') {
      return $value
    }
    if ($value -match '/(?:helix-alm|perforce-alm)$') {
      return $value + "/api/v0"
    }
    return $value + "/helix-alm/api/v0"
  }
}

function Invoke-HelixCurlRest {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    [object]$Body = $null,
    [bool]$IgnoreCertificateErrors = $false
  )
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (!$curl) { throw "curl.exe is not available for Helix REST fallback." }
  $args = @("-sS", "-X", $Method, "--connect-timeout", "20", "--max-time", "60")
  if ($IgnoreCertificateErrors) { $args += "-k" }
  foreach ($key in @($Headers.Keys)) {
    $args += @("-H", ($key + ": " + [string]$Headers[$key]))
  }
  $tempBody = $null
  if ($null -ne $Body) {
    $tempBody = [System.IO.Path]::GetTempFileName()
    ($Body | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath $tempBody -Encoding UTF8
    $args += @("-H", "Content-Type: application/json", "--data-binary", ("@" + $tempBody))
  }
  $args += @("-w", "`n__HTTP_STATUS__:%{http_code}", $Uri)
  try {
    $output = & $curl.Source @args 2>&1
    $text = ($output | Out-String)
    if ($LASTEXITCODE -ne 0) {
      throw "curl.exe exited with code $LASTEXITCODE. $text"
    }
    $marker = "__HTTP_STATUS__:"
    $markerIndex = $text.LastIndexOf($marker)
    if ($markerIndex -lt 0) {
      throw "curl.exe did not return an HTTP status marker. $text"
    }
    $bodyText = $text.Substring(0, $markerIndex).Trim()
    $statusText = $text.Substring($markerIndex + $marker.Length).Trim()
    $status = [int]$statusText
    if ($status -ge 400) {
      if ($bodyText.Length -gt 1600) { $bodyText = $bodyText.Substring(0, 1600) }
      throw "HTTP $status. $bodyText"
    }
    if (!$bodyText) { return $null }
    return $bodyText | ConvertFrom-Json
  } finally {
    if ($tempBody -and (Test-Path -LiteralPath $tempBody)) {
      Remove-Item -LiteralPath $tempBody -Force -ErrorAction SilentlyContinue
    }
  }
}

function New-HelixBasicHeader {
  param([string]$Username, [string]$Password)
  if (!$Username) { throw "Helix username is required." }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Username + ":" + $Password)
  return "Basic " + [Convert]::ToBase64String($bytes)
}

function Enable-HelixCertificateFallback {
  param([bool]$Allow)
  if ($Allow) {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  }
}

function Invoke-HelixRest {
  param(
    [string]$Method,
    [string]$BaseUrl,
    [string]$Path,
    [hashtable]$Headers,
    [object]$Body = $null,
    [bool]$IgnoreCertificateErrors = $false
  )
  Enable-HelixCertificateFallback -Allow $IgnoreCertificateErrors
  $uri = $BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/")
  $params = @{
    Uri = $uri
    Method = $Method
    Headers = $Headers
    TimeoutSec = 25
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $detail = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
        if ($bodyText) { $detail += " " + $bodyText }
      }
    } catch {}
    if ($detail.Length -gt 1600) { $detail = $detail.Substring(0, 1600) }
    try {
      return Invoke-HelixCurlRest -Method $Method -Uri $uri -Headers $Headers -Body $Body -IgnoreCertificateErrors $IgnoreCertificateErrors
    } catch {
      throw "Helix REST call failed for $Method $uri. Invoke-RestMethod: $detail curl fallback: $($_.Exception.Message)"
    }
  }
}

function ConvertTo-HelixProjectList {
  param([object]$Response)
  function Get-ProjectField {
    param([object]$Project, [string[]]$Names)
    if (!$Project) { return "" }
    foreach ($name in $Names) {
      if ($Project -is [System.Collections.IDictionary]) {
        foreach ($key in $Project.Keys) {
          if ([string]::Equals([string]$key, $name, [System.StringComparison]::OrdinalIgnoreCase) -and $null -ne $Project[$key]) {
            return [string]$Project[$key]
          }
        }
      }
      $property = $Project.PSObject.Properties | Where-Object { [string]::Equals($_.Name, $name, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
      if ($property -and $null -ne $property.Value) { return [string]$property.Value }
    }
    return ""
  }
  function Get-ProjectContainer {
    param([object]$Source)
    if (!$Source) { return @() }
    if ($Source -is [array]) { return @($Source) }
    foreach ($name in @("projects", "projectList", "items", "data", "results")) {
      $value = $null
      if ($Source -is [System.Collections.IDictionary]) {
        foreach ($key in $Source.Keys) {
          if ([string]::Equals([string]$key, $name, [System.StringComparison]::OrdinalIgnoreCase)) { $value = $Source[$key]; break }
        }
      } else {
        $property = $Source.PSObject.Properties | Where-Object { [string]::Equals($_.Name, $name, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        if ($property) { $value = $property.Value }
      }
      if ($null -ne $value) { return @($value) }
    }
    return @()
  }
  $projects = @(Get-ProjectContainer -Source $Response)
  return @($projects | ForEach-Object {
    [ordered]@{
      id = Get-ProjectField -Project $_ -Names @("id", "projectID", "projectId", "project_id")
      name = Get-ProjectField -Project $_ -Names @("name", "projectName", "project", "label", "displayName")
      uuid = Get-ProjectField -Project $_ -Names @("uuid", "guid")
    }
  } | Where-Object { $_.id -or $_.name -or $_.uuid })
}

function Normalize-HelixProjectKey {
  param([string]$Value)
  return (([string]$Value).Trim().ToLowerInvariant() -replace '[\s_]+', '-')
}

function Get-HelixProjectIdentifier {
  param([object]$Payload, [array]$Projects)
  $requested = ([string]$Payload.projectId).Trim()
  if (!$requested) { $requested = ([string]$Payload.projectName).Trim() }
  if (!$requested -and $Projects.Count -gt 0) {
    $requested = [string]$Projects[0].name
  }
  if (!$requested) {
    throw "Helix project name or ID is required."
  }
  $requestedCandidates = @($requested, ($requested -replace '_', ' ')) | Where-Object { $_ } | Select-Object -Unique
  $requestedKeys = @($requestedCandidates | ForEach-Object { Normalize-HelixProjectKey $_ })
  $match = @($Projects | Where-Object {
    $values = @([string]$_.name, [string]$_.id, [string]$_.uuid) | Where-Object { $_ }
    $keys = @($values | ForEach-Object { Normalize-HelixProjectKey $_ })
    ($values | Where-Object { $requestedCandidates -contains $_ }).Count -gt 0 -or
      ($keys | Where-Object { $requestedKeys -contains $_ }).Count -gt 0
  } | Select-Object -First 1)
  if ($match.Count -gt 0) {
    if ($match[0].name) { return [string]$match[0].name }
    return [string]$match[0].id
  }
  if ($requested -match '_') { return ($requested -replace '_', ' ') }
  return $requested
}

function Get-HelixAccessToken {
  param([string]$BaseUrl, [string]$ProjectId, [hashtable]$BasicHeaders, [bool]$IgnoreCertificateErrors)
  $encodedProject = [System.Uri]::EscapeDataString($ProjectId)
  $response = Invoke-HelixRest -Method "GET" -BaseUrl $BaseUrl -Path ($encodedProject + "/token") -Headers $BasicHeaders -IgnoreCertificateErrors $IgnoreCertificateErrors
  if (!$response -or !$response.accessToken) {
    throw "Helix did not return an access token for project '$ProjectId'."
  }
  return [string]$response.accessToken
}

function Get-HelixObjectProperty {
  param([object]$Object, [string]$Name)
  if (!$Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

function ConvertTo-HelixCompactValue {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  if ($Value -is [string]) { return $Value }
  if ($Value -is [bool] -or $Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
    return [string]$Value
  }
  if ($Value -is [array]) {
    return (@($Value) | ForEach-Object { ConvertTo-HelixCompactValue $_ } | Where-Object { $_ }) -join ", "
  }
  foreach ($name in @("text", "label", "name", "tag", "username", "email", "date", "dateTime", "string")) {
    $nested = Get-HelixObjectProperty -Object $Value -Name $name
    if ($null -ne $nested -and [string]$nested) { return [string]$nested }
  }
  $first = [string](Get-HelixObjectProperty -Object $Value -Name "firstName")
  $last = [string](Get-HelixObjectProperty -Object $Value -Name "lastName")
  if (($first + $last).Trim()) { return ($first + " " + $last).Trim() }
  try {
    $json = $Value | ConvertTo-Json -Depth 5 -Compress
    return ($json -replace '"accessToken":"[^"]+"', '"accessToken":"[redacted]"' -replace '"password":"[^"]+"', '"password":"[redacted]"')
  } catch {
    return [string]$Value
  }
}

function ConvertTo-HelixFieldSummary {
  param([object]$Field)
  $label = [string](Get-HelixObjectProperty -Object $Field -Name "label")
  $type = [string](Get-HelixObjectProperty -Object $Field -Name "type")
  $value = ""
  foreach ($candidate in @($type, "string", "formattedString", "menuItem", "menuItemArray", "boolean", "integer", "decimal", "date", "dateTime", "user", "userArray")) {
    if (!$candidate) { continue }
    $raw = Get-HelixObjectProperty -Object $Field -Name $candidate
    $value = ConvertTo-HelixCompactValue $raw
    if ($value) { break }
  }
  if (!$value) { return $null }
  if ($value.Length -gt 260) { $value = $value.Substring(0, 260) + "..." }
  return [ordered]@{ label = $label; type = $type; value = $value }
}

function Select-HelixInterestingFields {
  param([object]$Item)
  $fields = @((Get-HelixObjectProperty -Object $Item -Name "fields"))
  if (!$fields.Count) { return @() }
  $preferred = "summary|description|status|state|priority|type|assigned|owner|author|responsible|workflow|requirement|verification|variant|version|release|baseline|category|classification|item type|artifact|work product|process|modified|updated|last change|safety|asil|severity|found|closed|resolution|reason|impact"
  $summaries = @($fields | ForEach-Object { ConvertTo-HelixFieldSummary $_ } | Where-Object { $_ })
  $ranked = @($summaries | Sort-Object @{ Expression = { if ($_.label -match $preferred) { 0 } else { 1 } } }, @{ Expression = { $_.label } })
  return @($ranked | Select-Object -First 12)
}

function Get-HelixFieldValueByPattern {
  param([object]$Item, [string]$Pattern)
  foreach ($field in @((Get-HelixObjectProperty -Object $Item -Name "fields"))) {
    $label = [string](Get-HelixObjectProperty -Object $field -Name "label")
    if ($label -notmatch $Pattern) { continue }
    $type = [string](Get-HelixObjectProperty -Object $field -Name "type")
    foreach ($candidate in @($type, "string", "formattedString", "menuItem", "menuItemArray", "boolean", "integer", "decimal", "date", "dateTime", "user", "userArray")) {
      if (!$candidate) { continue }
      $raw = Get-HelixObjectProperty -Object $field -Name $candidate
      $value = ConvertTo-HelixCompactValue $raw
      if ($value) {
        return [ordered]@{ label = $label; value = $value }
      }
    }
  }
  return $null
}

function Get-HelixSourcePropertyValue {
  param([object]$Item, [string[]]$Names)
  foreach ($name in $Names) {
    $value = Get-HelixObjectProperty -Object $Item -Name $name
    if ($null -eq $value) { continue }
    $text = ConvertTo-HelixCompactValue $value
    if ($text) { return [ordered]@{ value = $text; source = $name } }
  }
  return $null
}

function Get-HelixContainerCount {
  param([object]$Item, [string]$Name)
  $value = Get-HelixObjectProperty -Object $Item -Name $Name
  if (!$value) { return 0 }
  if ($value -is [array]) { return @($value).Count }
  foreach ($property in @($value.PSObject.Properties.Name)) {
    if ($property -match 'Data$|^links$|^attachments$|^events$|^folders$') {
      $nested = Get-HelixObjectProperty -Object $value -Name $property
      if ($nested -is [array]) { return @($nested).Count }
    }
  }
  return 1
}

function ConvertTo-HelixItemSummary {
  param([object]$Item, [string]$Kind)
  $fields = @(Select-HelixInterestingFields -Item $Item)
  $summaryField = @($fields | Where-Object { $_.label -match 'summary|description|requirement|name|title' } | Select-Object -First 1)
  $stateField = @($fields | Where-Object { $_.label -match 'status|state|workflow|priority|severity' } | Select-Object -First 3)
  $fieldText = ($fields | ForEach-Object { $_.label + "=" + $_.value }) -join "; "
  $isTask = ($Kind -eq "issues" -and ($fieldText -match '(?i)\btask\b|任务|工作项'))
  $sourceId = [string](Get-HelixObjectProperty -Object $Item -Name "id")
  $modified = Get-HelixSourcePropertyValue -Item $Item -Names @("modifiedAt", "lastModifiedAt", "updatedAt", "lastUpdatedAt", "lastModified", "lastUpdated", "modified", "updated")
  $category = Get-HelixSourcePropertyValue -Item $Item -Names @("category", "classification", "itemType", "artifactType", "workProductType", "workItemType", "issueType", "requirementType", "documentType", "process", "processCode", "module")
  $categoryField = Get-HelixFieldValueByPattern -Item $Item -Pattern '^(category|classification|item ?type|artifact ?type|work ?product ?type|work ?item ?type|issue ?type|requirement ?type|document ?type|process(?: code)?|module)$'
  $modifiedField = Get-HelixFieldValueByPattern -Item $Item -Pattern '(modified|updated|last change|changed).*(at|date|time)?|last modified|last updated'
  $version = Get-HelixSourcePropertyValue -Item $Item -Names @("version", "revision", "release", "baseline")
  if (!$version) { $version = Get-HelixFieldValueByPattern -Item $Item -Pattern '^(version|revision|release|baseline|configuration item|ci version)$' }
  $owner = Get-HelixSourcePropertyValue -Item $Item -Names @("owner", "assignee", "assignedTo", "responsible")
  if (!$owner) { $owner = Get-HelixFieldValueByPattern -Item $Item -Pattern '^(owner|assigned to|assignee|responsible|responsible person|author)$' }
  $modifiedValue = if ($modified) { [string]$modified.value } elseif ($modifiedField) { [string]$modifiedField.value } else { "" }
  $modifiedSource = if ($modified) { [string]$modified.source } elseif ($modifiedField) { "field:" + [string]$modifiedField.label } else { "" }
  $categoryValue = if ($category) { [string]$category.value } elseif ($categoryField) { [string]$categoryField.value } else { "" }
  $categorySource = if ($category) { [string]$category.source } elseif ($categoryField) { "field:" + [string]$categoryField.label } else { "" }
  $self = [string](Get-HelixObjectProperty -Object $Item -Name "self")
  $ttstudioURL = [string](Get-HelixObjectProperty -Object $Item -Name "ttstudioURL")
  $sourceUrl = if ($self) { $self } else { $ttstudioURL }
  return [ordered]@{
    id = $sourceId
    number = [string](Get-HelixObjectProperty -Object $Item -Name "number")
    tag = [string](Get-HelixObjectProperty -Object $Item -Name "tag")
    kind = if ($isTask) { "TASK" } else { $Kind }
    category = $categoryValue
    categorySource = $categorySource
    summary = if ($summaryField.Count) { [string]$summaryField[0].value } else { "" }
    state = if ($stateField.Count) { (($stateField | ForEach-Object { $_.label + "=" + $_.value }) -join "; ") } else { "" }
    fields = $fields
    modifiedAt = $modifiedValue
    modifiedAtSource = $modifiedSource
    versionOrBaseline = if ($version) { [string]$version.value } else { "" }
    owner = if ($owner) { [string]$owner.value } else { "" }
    sourceLocator = $(if ($sourceId) { $Kind + "/" + $sourceId } else { $Kind + "/" + [string](Get-HelixObjectProperty -Object $Item -Name "number") })
    sourceUrl = $sourceUrl
    attachmentCount = Get-HelixContainerCount -Item $Item -Name "attachments"
    eventCount = Get-HelixContainerCount -Item $Item -Name "events"
    linkCount = Get-HelixContainerCount -Item $Item -Name "links"
    folderCount = Get-HelixContainerCount -Item $Item -Name "folders"
    self = $self
    ttstudioURL = $ttstudioURL
    evidenceRole = if ($summaryField.Count -or $fields.Count -or (Get-HelixContainerCount -Item $Item -Name "links") -gt 0) { "corroborating" } else { "index-only" }
    formalEvidenceRole = "non-direct"
  }
}

function Get-HelixResponseItems {
  param([object]$Response, [string]$Key)
  if (!$Response) { return @() }
  $direct = Get-HelixObjectProperty -Object $Response -Name $Key
  if ($direct) { return @($direct) }
  foreach ($name in @("items", "data", "results")) {
    $candidate = Get-HelixObjectProperty -Object $Response -Name $name
    if ($candidate) { return @($candidate) }
  }
  if ($Response -is [array]) { return @($Response) }
  return @()
}

function Get-HelixSection {
  param(
    [string]$BaseUrl,
    [string]$ProjectId,
    [string]$Route,
    [string]$Key,
    [string]$Label,
    [hashtable]$BearerHeaders,
    [int]$Limit,
    [string]$Expand = "",
    [string]$Search = "",
    [bool]$IgnoreCertificateErrors = $false
  )
  $encodedProject = [System.Uri]::EscapeDataString($ProjectId)
  $expandQuery = ""
  if ($Expand) {
    foreach ($part in ($Expand -split "," | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })) {
      $expandQuery += "&expand=" + [System.Uri]::EscapeDataString($part)
    }
  }
  $searchQuery = ""
  if ($Search) { $searchQuery = "&search=" + [System.Uri]::EscapeDataString($Search) }
  $allItems = @()
  $page = 1
  $pageSize = 100
  try {
    while ($page -le 20 -and $allItems.Count -lt $Limit) {
      $perPage = [Math]::Min($pageSize, $Limit - $allItems.Count)
      $query = "page=$page&per_page=$perPage&formattedText=false" + $expandQuery + $searchQuery
      $path = $encodedProject + "/" + $Route.Trim("/") + "?" + $query
      $response = Invoke-HelixRest -Method "GET" -BaseUrl $BaseUrl -Path $path -Headers $BearerHeaders -IgnoreCertificateErrors $IgnoreCertificateErrors
      $items = @(Get-HelixResponseItems -Response $response -Key $Key)
      $allItems += $items
      if ($items.Count -lt $perPage) { break }
      $page++
    }
    return [ordered]@{
      key = $Key
      label = $Label
      route = "/" + $ProjectId + "/" + $Route
      ok = $true
      count = $allItems.Count
      paging = $response.paging
      items = @($allItems | Select-Object -First $Limit | ForEach-Object { ConvertTo-HelixItemSummary -Item $_ -Kind $Key })
    }
  } catch {
    return [ordered]@{
      key = $Key
      label = $Label
      route = "/" + $ProjectId + "/" + $Route
      ok = $false
      count = 0
      error = $_.Exception.Message
      items = @()
    }
  }
}

function Get-HelixConfigSection {
  param(
    [string]$BaseUrl,
    [string]$ProjectId,
    [string]$Route,
    [string]$Key,
    [string]$Label,
    [hashtable]$BearerHeaders,
    [bool]$IgnoreCertificateErrors = $false
  )
  $encodedProject = [System.Uri]::EscapeDataString($ProjectId)
  try {
    $response = Invoke-HelixRest -Method "GET" -BaseUrl $BaseUrl -Path ($encodedProject + "/" + $Route.Trim("/")) -Headers $BearerHeaders -IgnoreCertificateErrors $IgnoreCertificateErrors
    $items = @()
    foreach ($property in @($response.PSObject.Properties.Name)) {
      $value = Get-HelixObjectProperty -Object $response -Name $property
      if ($value -is [array]) { $items = @($value); break }
    }
    if (!$items.Count -and $response) { $items = @($response) }
    $summaries = @($items | Select-Object -First 40 | ForEach-Object {
      [ordered]@{
        id = [string](Get-HelixObjectProperty -Object $_ -Name "id")
        name = [string](Get-HelixObjectProperty -Object $_ -Name "name")
        active = ConvertTo-HelixCompactValue (Get-HelixObjectProperty -Object $_ -Name "active")
        taskBoards = ConvertTo-HelixCompactValue (Get-HelixObjectProperty -Object $_ -Name "taskBoards")
        self = [string](Get-HelixObjectProperty -Object $_ -Name "self")
      }
    })
    return [ordered]@{
      key = $Key
      label = $Label
      route = "/" + $ProjectId + "/" + $Route
      ok = $true
      count = $summaries.Count
      items = $summaries
    }
  } catch {
    return [ordered]@{
      key = $Key
      label = $Label
      route = "/" + $ProjectId + "/" + $Route
      ok = $false
      count = 0
      error = $_.Exception.Message
      items = @()
    }
  }
}

function New-HelixSnapshotSummary {
  param([array]$Sections)
  $total = 0
  $attachments = 0
  $events = 0
  $links = 0
  $tasks = 0
  foreach ($section in $Sections) {
    foreach ($item in @($section.items)) {
      $total++
      $attachments += [int]($item.attachmentCount | ForEach-Object { if ($_ -ne $null) { $_ } else { 0 } })
      $events += [int]($item.eventCount | ForEach-Object { if ($_ -ne $null) { $_ } else { 0 } })
      $links += [int]($item.linkCount | ForEach-Object { if ($_ -ne $null) { $_ } else { 0 } })
      if ([string]$item.kind -eq "TASK") { $tasks++ }
    }
  }
  return [ordered]@{
    totalItems = $total
    taskLikeIssues = $tasks
    attachmentSignals = $attachments
    workflowEventSignals = $events
    linkSignals = $links
    processUse = "Use Helix snapshot as supplemental evidence for project progress, workflow state, trace links, attachments, review/event history, and SUP.8/SUP.9/SUP.10 closed-loop checks. It does not replace uploaded controlled work products."
  }
}

function Invoke-HelixProjects {
  param([object]$Payload)
  $baseUrl = Normalize-HelixBaseUrl -BaseUrl ([string]$Payload.baseUrl)
  $username = [string]$Payload.username
  $password = [string]$Payload.password
  $ignoreCert = [bool]$Payload.ignoreCertificateErrors
  $headers = @{ Accept = "application/json"; Authorization = (New-HelixBasicHeader -Username $username -Password $password) }
  $response = Invoke-HelixRest -Method "GET" -BaseUrl $baseUrl -Path "projects" -Headers $headers -IgnoreCertificateErrors $ignoreCert
  return [ordered]@{
    ok = $true
    baseUrl = $baseUrl
    projects = @(ConvertTo-HelixProjectList -Response $response)
    projectsLoading = $response.projectsLoading
  }
}

function Invoke-HelixRequirementDescription {
  param([object]$Payload)
  $baseUrl = Normalize-HelixBaseUrl -BaseUrl ([string]$Payload.baseUrl)
  $username = [string]$Payload.username
  $password = [string]$Payload.password
  $projectRequested = ([string]$Payload.projectId).Trim()
  $tag = ([string]$Payload.tag).Trim()
  $ignoreCert = [bool]$Payload.ignoreCertificateErrors
  if (!$projectRequested) { throw "Helix project name or ID is required." }
  if (!$tag) { throw "Helix requirement Tag is required." }

  $basicHeaders = @{ Accept = "application/json"; Authorization = (New-HelixBasicHeader -Username $username -Password $password) }
  $projectsResponse = Invoke-HelixRest -Method "GET" -BaseUrl $baseUrl -Path "projects" -Headers $basicHeaders -IgnoreCertificateErrors $ignoreCert
  $projects = @(ConvertTo-HelixProjectList -Response $projectsResponse)
  $projectId = Get-HelixProjectIdentifier -Payload ([pscustomobject]@{ projectId = $projectRequested }) -Projects $projects
  $accessToken = Get-HelixAccessToken -BaseUrl $baseUrl -ProjectId $projectId -BasicHeaders $basicHeaders -IgnoreCertificateErrors $ignoreCert
  $bearerHeaders = @{ Accept = "application/json"; Authorization = ("Bearer " + $accessToken) }

  $encodedProject = [System.Uri]::EscapeDataString($projectId)
  $escapedTag = $tag.Replace("'", "''")
  $search = "'Tag' EQUALS '" + $escapedTag + "'"
  $query = "search=" + [System.Uri]::EscapeDataString($search) +
    "&fields=Tag&fields=Description&page=1&per_page=1&formattedText=false"
  $response = Invoke-HelixRest -Method "GET" -BaseUrl $baseUrl -Path ($encodedProject + "/requirements?" + $query) -Headers $bearerHeaders -IgnoreCertificateErrors $ignoreCert
  $items = @(Get-HelixResponseItems -Response $response -Key "requirements")
  if (!$items.Count) {
    return [ordered]@{
      ok = $true
      found = $false
      project = $projectId
      tag = $tag
      description = ""
      route = "/" + $projectId + "/requirements"
      query = $search
      notes = @("No requirement matched the supplied Tag.", "The request used plain-text fields=Tag,Description with formattedText=false.")
    }
  }

  $item = $items[0]
  $actualTag = [string](Get-HelixObjectProperty -Object $item -Name "tag")
  $description = ""
  $selectedFields = @()
  foreach ($field in @((Get-HelixObjectProperty -Object $item -Name "fields"))) {
    $label = [string](Get-HelixObjectProperty -Object $field -Name "label")
    if (!$label) { continue }
    $value = ""
    foreach ($candidate in @("string", "formattedString", "text")) {
      $raw = Get-HelixObjectProperty -Object $field -Name $candidate
      if ($null -ne $raw) {
        $value = ConvertTo-HelixCompactValue $raw
        break
      }
    }
    $selectedFields += [ordered]@{ label = $label; value = $value }
    if ($label.Trim().ToLowerInvariant() -eq "description") { $description = $value }
    if (!$actualTag -and $label.Trim().ToLowerInvariant() -eq "tag") { $actualTag = $value }
  }
  if ($description.Length -gt 20000) { $description = $description.Substring(0, 20000) + "..." }

  return [ordered]@{
    ok = $true
    found = $true
    project = $projectId
    tag = if ($actualTag) { $actualTag } else { $tag }
    id = [string](Get-HelixObjectProperty -Object $item -Name "id")
    number = [string](Get-HelixObjectProperty -Object $item -Name "number")
    description = $description
    fields = $selectedFields
    route = "/" + $projectId + "/requirements"
    query = $search
    notes = @("Description was requested as plain text with formattedText=false.", "Credentials and access token remain inside the local bridge and are not returned.")
  }
}

function Invoke-HelixSnapshot {
  param([object]$Payload)
  $baseUrl = Normalize-HelixBaseUrl -BaseUrl ([string]$Payload.baseUrl)
  $username = [string]$Payload.username
  $password = [string]$Payload.password
  $ignoreCert = [bool]$Payload.ignoreCertificateErrors
  $limit = [int]$Payload.itemLimit
  if ($limit -lt 1) { $limit = 1500 }
  if ($limit -gt 1500) { $limit = 1500 }
  $search = ([string]$Payload.search).Trim()
  $selectedTypes = @($Payload.selectedTypes | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if (!$selectedTypes.Count) {
    $selectedTypes = @("requirements", "documents", "issues", "testCases", "testRuns", "folders")
  }
  $typeSet = @{}
  foreach ($type in $selectedTypes) { $typeSet[$type.ToLowerInvariant()] = $true }
  $includeType = {
    param([string]$Name)
    return [bool]$typeSet[$Name.ToLowerInvariant()]
  }
  $basicHeaders = @{ Accept = "application/json"; Authorization = (New-HelixBasicHeader -Username $username -Password $password) }
  $projectsResponse = Invoke-HelixRest -Method "GET" -BaseUrl $baseUrl -Path "projects" -Headers $basicHeaders -IgnoreCertificateErrors $ignoreCert
  $projects = @(ConvertTo-HelixProjectList -Response $projectsResponse)
  $projectId = Get-HelixProjectIdentifier -Payload $Payload -Projects $projects
  $accessToken = Get-HelixAccessToken -BaseUrl $baseUrl -ProjectId $projectId -BasicHeaders $basicHeaders -IgnoreCertificateErrors $ignoreCert
  $bearerHeaders = @{ Accept = "application/json"; Authorization = ("Bearer " + $accessToken) }
  function Get-SelectedHelixSnapshotSections {
    param([string]$SearchText)
    $resultSections = @()
    if (& $includeType "requirements") {
      $resultSections += (Get-HelixSection -BaseUrl $baseUrl -ProjectId $projectId -Route "requirements" -Key "requirements" -Label "REQ / requirements" -BearerHeaders $bearerHeaders -Limit $limit -Expand "documents,versions,links,folders,attachments,events" -Search $SearchText -IgnoreCertificateErrors $ignoreCert)
    }
    if (& $includeType "documents") {
      $resultSections += (Get-HelixSection -BaseUrl $baseUrl -ProjectId $projectId -Route "documents" -Key "documents" -Label "RE / requirement documents" -BearerHeaders $bearerHeaders -Limit $limit -Expand "snapshots,links,folders,attachments,events" -Search $SearchText -IgnoreCertificateErrors $ignoreCert)
    }
    if (& $includeType "issues") {
      $resultSections += (Get-HelixSection -BaseUrl $baseUrl -ProjectId $projectId -Route "issues" -Key "issues" -Label "TASK / issues and problem records" -BearerHeaders $bearerHeaders -Limit $limit -Expand "foundByRecords,attachments,events,links,folders" -Search $SearchText -IgnoreCertificateErrors $ignoreCert)
    }
    if (& $includeType "testCases") {
      $resultSections += (Get-HelixSection -BaseUrl $baseUrl -ProjectId $projectId -Route "testCases" -Key "testCases" -Label "Test cases" -BearerHeaders $bearerHeaders -Limit $limit -Expand "attachments,events,steps,links,folders" -Search $SearchText -IgnoreCertificateErrors $ignoreCert)
    }
    if (& $includeType "testRuns") {
      $resultSections += (Get-HelixSection -BaseUrl $baseUrl -ProjectId $projectId -Route "testRuns" -Key "testRuns" -Label "Test runs" -BearerHeaders $bearerHeaders -Limit $limit -Expand "attachments,events,steps,links,folders" -Search $SearchText -IgnoreCertificateErrors $ignoreCert)
    }
    if ((& $includeType "folders") -or (& $includeType "dashboards")) {
      $resultSections += (Get-HelixConfigSection -BaseUrl $baseUrl -ProjectId $projectId -Route "configs/folderTypes" -Key "folderTypes" -Label "Folders / taskboard configuration" -BearerHeaders $bearerHeaders -IgnoreCertificateErrors $ignoreCert)
      $resultSections += (Get-HelixConfigSection -BaseUrl $baseUrl -ProjectId $projectId -Route "folders?depth=2" -Key "folders" -Label "Project folder tree" -BearerHeaders $bearerHeaders -IgnoreCertificateErrors $ignoreCert)
    }
    return @($resultSections)
  }
  $sections = @(Get-SelectedHelixSnapshotSections -SearchText $search)
  $searchFallbackFrom = ""
  if ($search) {
    $summaryForSearch = New-HelixSnapshotSummary -Sections $sections
    if (($summaryForSearch.totalItems -as [int]) -le 0) {
      $fallbackSections = @(Get-SelectedHelixSnapshotSections -SearchText "")
      $fallbackSummary = New-HelixSnapshotSummary -Sections $fallbackSections
      if (($fallbackSummary.totalItems -as [int]) -gt 0) {
        $searchFallbackFrom = $search
        $search = ""
        $sections = $fallbackSections
      }
    }
  }
  return [ordered]@{
    ok = $true
    fetchedAt = [DateTimeOffset]::UtcNow.ToString("o")
    baseUrl = $baseUrl
    project = [ordered]@{ idOrName = $projectId; matched = @($projects | Where-Object { $_.name -eq $projectId -or $_.id -eq $projectId } | Select-Object -First 1) }
    itemLimit = $limit
    selectedTypes = $selectedTypes
    search = $search
    searchFallbackFrom = $searchFallbackFrom
    sections = $sections
    summary = New-HelixSnapshotSummary -Sections $sections
    notes = @(
      $(if ($searchFallbackFrom) { "The configured Helix search/filter returned no items, so the bridge retried once without a search filter and returned the project sample." }),
      "Helix tokens and passwords are used only inside the local bridge request and are not returned to the browser.",
      "TASK is inferred from issue/work-item fields because the 2026.2 REST API does not expose a separate top-level /tasks endpoint.",
      "Dashboard coverage is represented through folder and taskboard configuration when exposed by REST; native dashboard widgets may require Helix/Perforce ALM server-side APIs not available in the public REST endpoint."
    ) | Where-Object { $_ }
  }
}

function ConvertTo-OpenXmlText {
  param([object]$Value)
  return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Add-OpenXmlParagraph {
  param(
    [System.Text.StringBuilder]$Builder,
    [string]$Text,
    [bool]$Bold = $false
  )
  [void]$Builder.Append("<w:p><w:r>")
  if ($Bold) { [void]$Builder.Append("<w:rPr><w:b/></w:rPr>") }
  [void]$Builder.Append("<w:t xml:space=`"preserve`">")
  [void]$Builder.Append((ConvertTo-OpenXmlText $Text))
  [void]$Builder.Append("</w:t></w:r></w:p>")
}

function Write-DocmTextFile {
  param(
    [string]$Root,
    [string]$RelativePath,
    [string]$Text
  )
  $target = Join-Path $Root $RelativePath
  $parent = Split-Path -Parent $target
  if ($parent -and !(Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($target, $Text, $script:Utf8NoBom)
}

function ConvertTo-HelixSafeFileName {
  param([string]$Value)
  $name = ([string]$Value).Trim()
  if (!$name) { $name = "Helix_ALM" }
  return ($name -replace '[\\/:*?"<>|]+', "_" -replace '\s+', "_").Trim("_")
}

function New-HelixDocmPackage {
  param([object]$Snapshot)

  $project = [string]$Snapshot.project.idOrName
  if (!$project) { $project = "Helix_Project" }
  $fetchedAt = [string]$Snapshot.fetchedAt
  if (!$fetchedAt) { $fetchedAt = [DateTimeOffset]::UtcNow.ToString("o") }
  $summary = $Snapshot.summary
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("Helix ALM DOCM evidence export")
  $lines.Add("Project: $project")
  $lines.Add("Fetched at: $fetchedAt")
  $lines.Add("REST base URL: $($Snapshot.baseUrl)")
  $lines.Add("Selected types: $(@($Snapshot.selectedTypes) -join ', ')")
  $lines.Add("Search / filter: $($Snapshot.search)")
  $lines.Add("Item limit per type: $($Snapshot.itemLimit)")
  $lines.Add("Audit boundary: this file is generated from the local Helix bridge as supplemental tool evidence. It contains no Helix password, access token, or Codex credential.")
  $lines.Add("")
  $lines.Add("Snapshot summary")
  $lines.Add("Total items: $($summary.totalItems); attachments: $($summary.attachmentSignals); workflow events: $($summary.workflowEventSignals); links: $($summary.linkSignals); task-like issues: $($summary.taskLikeIssues)")
  $lines.Add("ASPICE use: $($summary.processUse)")
  foreach ($note in @($Snapshot.notes)) {
    if ($note) { $lines.Add("Note: $note") }
  }

  foreach ($section in @($Snapshot.sections)) {
    $lines.Add("")
    $lines.Add("Section: $($section.label) [$($section.key)]")
    $lines.Add("Route: $($section.route); ok=$($section.ok); count=$($section.count)")
    if ($section.error) { $lines.Add("Section error: $($section.error)") }
    $index = 0
    foreach ($item in @($section.items)) {
      $index++
      $identifier = @($item.tag, $item.id, $item.number) | Where-Object { $_ } | Select-Object -First 1
      if (!$identifier) { $identifier = "item-$index" }
      $lines.Add("$index. $identifier | kind=$($item.kind) | state=$($item.state) | summary=$($item.summary)")
      $lines.Add("   Signals: attachments=$($item.attachmentCount); events=$($item.eventCount); links=$($item.linkCount); folders=$($item.folderCount)")
      if ($item.ttstudioURL) { $lines.Add("   Helix URL: $($item.ttstudioURL)") }
      $fieldLines = @()
      foreach ($field in @($item.fields | Select-Object -First 12)) {
        $label = [string]$field.label
        $value = [string]$field.value
        if ($label -and $value) { $fieldLines += ($label + "=" + $value) }
      }
      if ($fieldLines.Count) {
        $lines.Add("   Fields: " + ($fieldLines -join "; "))
      }
    }
  }

  $bodyBuilder = [System.Text.StringBuilder]::new()
  [void]$bodyBuilder.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  [void]$bodyBuilder.Append('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>')
  foreach ($line in $lines) {
    $isBold = ($line -match '^(Helix ALM DOCM evidence export|Snapshot summary|Section: )')
    Add-OpenXmlParagraph -Builder $bodyBuilder -Text $line -Bold:$isBold
  }
  [void]$bodyBuilder.Append('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>')
  [void]$bodyBuilder.Append('</w:body></w:document>')

  $safeProject = ConvertTo-HelixSafeFileName $project
  $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
  $fileName = "Helix_ALM_${safeProject}_evidence_export_${stamp}.docm"
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aspice-helix-docm-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path ([System.IO.Path]::GetTempPath()) ("aspice-helix-docm-" + [guid]::NewGuid().ToString("N") + ".docm")
  try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    Write-DocmTextFile -Root $tempRoot -RelativePath "[Content_Types].xml" -Text '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
    Write-DocmTextFile -Root $tempRoot -RelativePath "_rels\.rels" -Text '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
    Write-DocmTextFile -Root $tempRoot -RelativePath "word\document.xml" -Text $bodyBuilder.ToString()
    Write-DocmTextFile -Root $tempRoot -RelativePath "word\_rels\document.xml.rels" -Text '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    Write-DocmTextFile -Root $tempRoot -RelativePath "docProps\core.xml" -Text ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Helix ALM evidence export</dc:title><dc:subject>ASPICE audit supplemental evidence</dc:subject><dc:creator>aspice-audit-master local bridge</dc:creator><cp:keywords>Helix ALM, ASPICE, requirements, issues, traceability, workflow</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">' + (ConvertTo-OpenXmlText $fetchedAt) + '</dcterms:created></cp:coreProperties>')
    Write-DocmTextFile -Root $tempRoot -RelativePath "docProps\app.xml" -Text '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>aspice-audit-master</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>JE</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.4.10</AppVersion></Properties>'
    Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
    $archive = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($file in Get-ChildItem -LiteralPath $tempRoot -Recurse -File) {
        $relative = ($file.FullName.Substring($tempRoot.Length) -replace '^[\\/]+', '' -replace '\\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
      }
    } finally {
      $archive.Dispose()
      $zipStream.Dispose()
    }
    $bytes = [System.IO.File]::ReadAllBytes($zipPath)
    return [ordered]@{
      ok = $true
      project = $project
      fileName = $fileName
      mimeType = "application/vnd.ms-word.document.macroEnabled.12"
      itemCount = $summary.totalItems
      baseUrl = $Snapshot.baseUrl
      base64 = [Convert]::ToBase64String($bytes)
      notes = @(
        "Generated from Helix REST snapshot through the local bridge.",
        "The package contains no password, access token, or Codex credential.",
        "Use this DOCM package as supplemental tool evidence and cross-check with controlled work products before formal scoring."
      )
    }
  } finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  }
}

function Invoke-HelixDocmExport {
  param([object]$Payload)
  $snapshot = Invoke-HelixSnapshot -Payload $Payload
  return New-HelixDocmPackage -Snapshot $snapshot
}

function Read-RequestJson {
  param($Request)
  $reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
  try {
    $text = $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
  if (!$text.Trim()) {
    throw "Empty request body."
  }
  return $text | ConvertFrom-Json
}

if ($HelixSmokeTest) {
  $helixPassword = [string]$env:ASPICE_HELIX_TEST_PASSWORD
  if (!$helixPassword) {
    throw "Set ASPICE_HELIX_TEST_PASSWORD before running -HelixSmokeTest."
  }
  $payload = [pscustomobject]@{
    baseUrl = $HelixSmokeBaseUrl
    username = $HelixSmokeUsername
    password = $helixPassword
    projectId = $HelixSmokeProject
    search = ""
    selectedTypes = @("requirements", "documents", "issues", "testCases", "testRuns", "folders")
    itemLimit = 1000
    ignoreCertificateErrors = $true
  }
  $snapshot = Invoke-HelixSnapshot -Payload $payload
  $docm = Invoke-HelixDocmExport -Payload $payload
  $docmBytes = [Convert]::FromBase64String([string]$docm.base64)
  $tempDocm = Join-Path ([System.IO.Path]::GetTempPath()) $docm.fileName
  [System.IO.File]::WriteAllBytes($tempDocm, $docmBytes)
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  $zip = [System.IO.Compression.ZipFile]::OpenRead($tempDocm)
  try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName })
  } finally {
    $zip.Dispose()
    if (Test-Path -LiteralPath $tempDocm) { Remove-Item -LiteralPath $tempDocm -Force }
  }
  [ordered]@{
    ok = $true
    normalizedBaseUrl = $snapshot.baseUrl
    totalItems = $snapshot.summary.totalItems
    requirements = (($snapshot.sections | Where-Object key -eq "requirements").count)
    documents = (($snapshot.sections | Where-Object key -eq "documents").count)
    issues = (($snapshot.sections | Where-Object key -eq "issues").count)
    folderTypes = (($snapshot.sections | Where-Object key -eq "folderTypes").count)
    folders = (($snapshot.sections | Where-Object key -eq "folders").count)
    docmFileName = $docm.fileName
    docmItemCount = $docm.itemCount
    docmBytes = $docmBytes.Length
    hasContentTypes = ($entries -contains "[Content_Types].xml")
    hasWordDocumentXml = ($entries -contains "word/document.xml")
  } | ConvertTo-Json -Depth 8
  exit 0
}

$codexExe = ""
$codexUnavailable = ""
try { $codexExe = Find-CodexExecutable } catch { $codexUnavailable = $_.Exception.Message }
$configSummary = Get-CodexConfigSummary
$codexSupportsSearch = if ($codexExe) { Test-CodexSupportsSearch -Codex $codexExe } else { $false }

if ($SelfTest) {
  [ordered]@{
    ok = $true
    codexPath = $codexExe
    configPath = $configSummary.configPath
    provider = $configSummary.provider
    model = $configSummary.model
    wireApi = $configSummary.wireApi
    requiresOpenAiAuth = $configSummary.requiresOpenAiAuth
    webSearch = $codexSupportsSearch
    workspace = Get-BridgeWorkspace
  } | ConvertTo-Json -Depth 8
  exit 0
}

if ($SmokeTest) {
  $payload = [pscustomobject]@{
    model = if ($configSummary.model) { $configSummary.model } else { "gpt-5.5" }
    instructions = "You are an ASPICE audit assistant. Do not call tools. Return one concise Chinese sentence."
    input = "For SYS.2 system requirements specification, provide one Chinese audit recommendation. It must mention traceability and acceptance criteria."
    max_output_tokens = 300
  }
  Invoke-CodexCli -Payload $payload | ConvertTo-Json -Depth 20
  exit 0
}

$listener = [System.Net.HttpListener]::new()
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "aspice-codex-bridge listening on $prefix"
Write-Host $(if ($codexExe) { "Codex: $codexExe" } else { "Codex routes unavailable: $codexUnavailable" })
Write-Host "Config: $($configSummary.configPath)"
Write-Host "Provider: $($configSummary.provider); model: $($configSummary.model); wire_api: $($configSummary.wireApi)"
Write-Host "Web search flag supported: $codexSupportsSearch"
Write-Host "Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.AbsolutePath
      if ($context.Request.HttpMethod -eq "OPTIONS") {
        Send-Json $context 204 ([ordered]@{ ok = $true })
        continue
      }
      if ($context.Request.HttpMethod -eq "GET" -and $path -eq "/health") {
        Send-Json $context 200 ([ordered]@{
          ok = $true
          service = "aspice-codex-bridge"
          codexPath = $codexExe
          configPath = $configSummary.configPath
          provider = $configSummary.provider
          model = $configSummary.model
          wireApi = $configSummary.wireApi
          requiresOpenAiAuth = $configSummary.requiresOpenAiAuth
          webSearch = $codexSupportsSearch
        })
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/auth/login") {
        $payload = Read-RequestJson $context.Request
        $result = Invoke-AuthLogin -Payload $payload
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "GET" -and $path -eq "/memory") {
        $email = Get-SessionEmail -Request $context.Request -Body $null
        $store = Read-MemoryStore
        Send-Json $context 200 ([ordered]@{ ok = $true; memory = Get-PublicMemory -Store $store -Email $email })
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/memory/project") {
        $payload = Read-RequestJson $context.Request
        $email = Get-SessionEmail -Request $context.Request -Body $payload
        $result = Invoke-MemoryProject -Payload $payload -Email $email
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/memory/snapshot") {
        $payload = Read-RequestJson $context.Request
        $email = Get-SessionEmail -Request $context.Request -Body $payload
        $result = Invoke-MemorySnapshot -Payload $payload -Email $email
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/helix/projects") {
        $payload = Read-RequestJson $context.Request
        $result = Invoke-HelixProjects -Payload $payload
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/helix/requirement") {
        $payload = Read-RequestJson $context.Request
        $result = Invoke-HelixRequirementDescription -Payload $payload
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/helix/snapshot") {
        $payload = Read-RequestJson $context.Request
        $result = Invoke-HelixSnapshot -Payload $payload
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/helix/export-docm") {
        $payload = Read-RequestJson $context.Request
        $result = Invoke-HelixDocmExport -Payload $payload
        Send-Json $context 200 $result
        continue
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/v1/responses") {
        $payload = Read-RequestJson $context.Request
        $result = Invoke-CodexCli -Payload $payload
        Send-Json $context 200 $result
        continue
      }
      Send-Json $context 404 ([ordered]@{ error = "Unsupported route: $($context.Request.HttpMethod) $path" })
    } catch {
      Send-Json $context 500 ([ordered]@{ error = $_.Exception.Message })
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
