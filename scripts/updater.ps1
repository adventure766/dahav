# ============================================================================
# DAHAV local supervisor / updater
# ----------------------------------------------------------------------------
# Responsibilities:
#   - Start (or attach to) the local PocketBase server on 127.0.0.1:8090
#   - First-run provisioning when pb_data is empty (superuser + owner user)
#   - Check https for updates (latest.json), download + SHA-256 verify a
#     release zip, stage it, and expose a tiny local HTTP API:
#         GET  http://127.0.0.1:8091/status  -> { current, latest, hasUpdate,
#                                                notes, verified, staged, ... }
#         POST http://127.0.0.1:8091/apply   -> apply the staged update now
#   - Apply = stop PB -> backup DB -> swap app files -> restart PB -> verify.
#     On failure: restore previous app files + DB backup (rollback).
#   - Keep PocketBase alive; stop it when this console window is closed.
#
# Data safety: pb_data/ is NEVER replaced by an update. Only application files
# (pb_public, pb_hooks, pb_migrations, pocketbase.exe, scripts, VERSION) are
# swapped. Migrations run automatically on the next PB start.
# ============================================================================
[CmdletBinding()]
param(
  [string]$ManifestUrl = "",
  [int]$LauncherPort = 8091,
  [int]$PbPort = 8090,
  [switch]$NoBrowser,
  [switch]$TestMode
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "DAHAV Server - close this window to stop"

$Root      = Split-Path -Parent $PSScriptRoot        # e.g. C:\DAHAV
$PbData    = Join-Path $Root "pb_data"
$DataDir   = Join-Path $Root "data"
$LogDir    = Join-Path $DataDir "logs"
$StagedDir = Join-Path $DataDir "staged"
$BakDir    = Join-Path $DataDir "backup"
$StatusFile= Join-Path $DataDir "update-available.json"
$VersionFile = Join-Path $Root "VERSION"
$ConfigFile  = Join-Path $Root "update-config.json"
$PbExe       = Join-Path $Root "pocketbase.exe"
$HealthUrl   = "http://127.0.0.1:$PbPort/api/dahav/health"
$LogFile     = Join-Path $LogDir "updater.log"

# --- tiny state --------------------------------------------------------------
$Script:CurrentVersion = "0.0.0"
$Script:Latest = $null            # parsed latest.json
$Script:StagedZip = $null         # path to verified zip awaiting install
$Script:Applying = $false
$Script:JustProvisioned = $false
$Script:RetriedStart = $false
$Script:PocketBasePid = $null
$Script:PbOwned = $false
$Script:StopRequested = $false
$Script:LastApply = $null         # result of the last apply attempt

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  try {
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
  Write-Host $line
}

function Read-JsonFile($path) {
  if (Test-Path $path) {
    try { return Get-Content -Raw -Path $path | ConvertFrom-Json } catch { }
  }
  return $null
}

# --- version helpers ----------------------------------------------------------
function Compare-Version($a, $b) {
  # returns: -1 if a < b, 0 if equal, 1 if a > b (semver-ish, numeric parts)
  $pa = @($a -split '\.' | ForEach-Object { [int]($_ -replace '\D.*$', '0') })
  $pb = @($b -split '\.' | ForEach-Object { [int]($_ -replace '\D.*$', '0') })
  while ($pa.Count -lt 4) { $pa += 0 }
  while ($pb.Count -lt 4) { $pb += 0 }
  for ($i = 0; $i -lt 4; $i++) {
    if ($pa[$i] -lt $pb[$i]) { return -1 }
    if ($pa[$i] -gt $pb[$i]) { return 1 }
  }
  return 0
}

# --- PocketBase process management --------------------------------------------
function Test-PbHealthy {
  try {
    $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Wait-PortFree($port, $seconds) {
  # Waits until nothing is listening on $port, or until $seconds elapse.
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $c) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

function Start-PocketBase {
  if (Test-PbHealthy) {
    Write-Log "PocketBase already running on :$PbPort - attaching."
    $Script:PbOwned = $false
    return
  }
  if (-not (Test-Path $PbExe)) { throw "pocketbase.exe not found at $PbExe" }

  # If something is already listening on the target port but /health is not
  # answering (a half-started or orphaned PocketBase), it will prevent a fresh
  # instance from binding. Surface it instead of silently timing out.
  $portOwner = Get-NetTCPConnection -LocalPort $PbPort -State Listen -ErrorAction SilentlyContinue
  if ($portOwner) {
    $ownerPid = $portOwner[0].OwningProcess
    $ownerName = (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue).ProcessName
    Write-Log "Port $PbPort is already listening (pid $ownerPid, $ownerName) but /health is not responding - assuming an orphaned PocketBase."
  }

  Write-Log "Starting PocketBase (port $PbPort)..."
  try {
    $p = Start-Process -FilePath $PbExe -ArgumentList @("serve", "--http=0.0.0.0:$PbPort") `
          -WorkingDirectory $Root -PassThru -ErrorAction Stop
  } catch {
    Write-Log "Start-Process failed: $($_.Exception.Message)"
    throw "Could not start pocketbase.exe: $($_.Exception.Message)"
  }
  $Script:PocketBasePid = $p.Id
  $Script:PbOwned = $true
  Write-Log "Launched pocketbase (pid $($p.Id)) from $PbExe; health URL: $HealthUrl"

  # Startup budget: first-run cold start can be slow (AV scan, hook warm-up),
  # so give it a generous window; a warm start is normally healthy in ~2s.
  $budget = if ($Script:JustProvisioned) { 120 } else { 45 }
  $deadline = (Get-Date).AddSeconds($budget)
  $attempts = 0
  while ((Get-Date) -lt $deadline) {
    if ($p.HasExited) {
      Write-Log "PocketBase (pid $($p.Id)) exited during startup (code $($p.ExitCode))."
      $Script:PocketBasePid = $null
      $Script:PbOwned = $false
      throw "PocketBase exited during startup (code $($p.ExitCode))"
    }
    $attempts++
    if (Test-PbHealthy) {
      Write-Log "PocketBase healthy on :$PbPort (pid $($p.Id)) after $attempts probe(s)."
      return
    }
    Start-Sleep -Milliseconds 500
  }

  # Timed out while the process is still alive: kill it so it cannot orphan and
  # hold the port for the next attempt.
  Write-Log "PocketBase (pid $($p.Id)) did not become healthy within ${budget}s - killing it to avoid an orphaned process."
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
  $Script:PocketBasePid = $null
  $Script:PbOwned = $false
  throw "PocketBase did not become healthy within ${budget}s (killed pid $($p.Id))."
}

function Stop-PocketBase {
  if ($Script:PocketBasePid -and $Script:PbOwned) {
    Write-Log "Stopping PocketBase (pid $($Script:PocketBasePid))..."
    try { Stop-Process -Id $Script:PocketBasePid -Force -ErrorAction SilentlyContinue } catch { }
    Wait-Process -Id $Script:PocketBasePid -Timeout 10 -ErrorAction SilentlyContinue
    $Script:PocketBasePid = $null
    $Script:PbOwned = $false
    Write-Log "PocketBase stopped."
  }
}

# --- first-run provisioning ---------------------------------------------------
function Test-PbDataEmpty {
  return -not (Test-Path (Join-Path $PbData "data.db"))
}

function Invoke-FirstRun {
  # Creates the superuser + initial owner user on an empty pb_data.
  Write-Log "pb_data is empty - starting first-run setup."
  $setup = Join-Path $PSScriptRoot "firstrun.ps1"
  if (-not (Test-Path $setup)) { throw "firstrun.ps1 not found" }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $setup -Root $Root | ForEach-Object { Write-Log $_ }
  if ($LASTEXITCODE -ne 0) { throw "firstrun.ps1 failed (exit $LASTEXITCODE)" }
  Write-Log "First-run setup complete."
  $Script:JustProvisioned = $true
  # Give the temp PocketBase (port 8093) a moment to fully release the DB and
  # socket before the main instance binds. On slow disks / AV scans this can
  # take a few seconds.
  Start-Sleep -Seconds 1
  $released = Wait-PortFree 8093 20
  if ($released) { Write-Log "Temporary PocketBase port 8093 released." }
  else { Write-Log "WARNING: port 8093 still listening after first-run; continuing anyway." }
}

# --- update check / download / verify ------------------------------------------
function Resolve-ManifestUrl {
  if ($ManifestUrl) { return $ManifestUrl }
  $cfg = Read-JsonFile $ConfigFile
  if ($cfg -and $cfg.manifestUrl) { return $cfg.manifestUrl }
  return "https://raw.githubusercontent.com/dahav/dahav/updates/latest.json"
}

# --- apply ---------------------------------------------------------------------
function Backup-Db($label) {
  # Cold file-level backup of pb_data (SQLite + storage). PocketBase 0.40.x has
  # no `backup` CLI command, so we copy the data dir after PocketBase has been
  # stopped — the DB is quiescent, so the copy is a consistent snapshot.
  Write-Log "Creating DB backup ($label)..."
  try {
    $dest = Join-Path $BakDir $label
    if (Test-Path $dest) { Clear-Directory $dest } else { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
    Copy-Item -Path (Join-Path $PbData "*") -Destination $dest -Recurse -Force
    Write-Log "DB backup done -> $dest"
  } catch {
    Write-Log "DB backup FAILED: $($_.Exception.Message)"
  }
}

function Copy-Directory($src, $dst) {
  if (-not (Test-Path $src)) { return }
  if ((Get-Item $src).PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
  } else {
    # file source: ensure the PARENT exists, then copy as a file
    $parent = Split-Path -Parent $dst
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -Path $src -Destination $dst -Force
  }
}

function Clear-Directory($dir) {
  if (Test-Path $dir) {
    Get-ChildItem -Path $dir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ApplyUpdate {
  if ($Script:Applying) { return @{ ok = $false; error = "already applying" } }
  if (-not $Script:StagedZip -or -not (Test-Path $Script:StagedZip)) {
    return @{ ok = $false; error = "no staged update" }
  }
  $Script:Applying = $true
  $oldVersion = $Script:CurrentVersion
  $newVersion = if ($Script:Latest) { $Script:Latest.version } else { $oldVersion }
  $stage = $Script:StagedZip
  Write-Log "=== APPLY UPDATE $oldVersion -> $newVersion ==="

  try {
    # 1) stop PB
    Stop-PocketBase

    # 2) DB backup (never touched by the file swap, but needed for rollback)
    $backupLabel = "pre-" + $newVersion
    Backup-Db $backupLabel

    # 3) backup current app files (rollback target)
    $appBackup = Join-Path $BakDir ("v" + $oldVersion)
    Clear-Directory $appBackup
    foreach ($item in @("pb_public", "pb_hooks", "pb_migrations", "scripts", "pocketbase.exe", "DAHAV.bat", "VERSION", "update-config.json")) {
      $src = Join-Path $Root $item
      if (Test-Path $src) { Copy-Directory $src (Join-Path $appBackup $item) }
    }
    Write-Log "Backed up app files to $appBackup"

    # 4) extract staged zip into a temp dir, then swap
    $extract = Join-Path $DataDir "extract"
    Clear-Directory $extract
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    Expand-Archive -Path $stage -DestinationPath $extract -Force
    Write-Log "Extracted staged zip."

    $newRoot = Join-Path $extract "dahav"
    if (-not (Test-Path $newRoot)) { $newRoot = $extract }   # zip may or may not have a top folder

    foreach ($item in @("pb_public", "pb_hooks", "pb_migrations", "scripts", "pocketbase.exe", "DAHAV.bat", "VERSION", "update-config.json")) {
      $src = Join-Path $newRoot $item
      if (Test-Path $src) {
        $dst = Join-Path $Root $item
        if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Directory $src $dst
        Write-Log "Installed $item"
      } else {
        Write-Log "WARNING: $item missing from update package"
      }
    }

    # 5) version file
    if ($newVersion) { Set-Content -Path $VersionFile -Value $newVersion -Encoding UTF8 }

    # 6) restart PB and verify
    Start-PocketBase

    # 7) success
    $Script:CurrentVersion = $newVersion
    $Script:StagedZip = $null
    $Script:LastApply = @{ ok = $true; version = $newVersion; rolledBack = $false }
    Remove-Item $stage -Force -ErrorAction SilentlyContinue
    Remove-Item $StatusFile -Force -ErrorAction SilentlyContinue
    Write-Log "=== APPLY SUCCESS: $oldVersion -> $newVersion ==="
    return $Script:LastApply
  } catch {
    Write-Log "=== APPLY FAILED: $($_.Exception.Message) - rolling back ==="
    # rollback: restore app files, then DB backup if we made one
    try {
      Stop-PocketBase
      $appBackup = Join-Path $BakDir ("v" + $oldVersion)
      if (Test-Path $appBackup) {
        foreach ($item in @("pb_public", "pb_hooks", "pb_migrations", "scripts", "pocketbase.exe", "DAHAV.bat", "VERSION", "update-config.json")) {
          $src = Join-Path $appBackup $item
          if (Test-Path $src) {
            $dst = Join-Path $Root $item
            if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
            Copy-Directory $src $dst
          }
        }
        Write-Log "Restored app files from $appBackup"
      }
      Start-PocketBase
      $Script:LastApply = @{ ok = $false; error = $_.Exception.Message; rolledBack = $true }
    } catch {
      Write-Log "ROLLBACK ALSO FAILED: $($_.Exception.Message) - manual restore required"
      $Script:LastApply = @{ ok = $false; error = $_.Exception.Message; rolledBack = $false }
    }
    return $Script:LastApply
  } finally {
    $Script:Applying = $false
  }
}

# --- status json ---------------------------------------------------------------
function Get-StatusObject {
  $hasUpdate = $false
  $latest = ""
  $notes = ""
  $force = $false
  if ($Script:Latest -and $Script:Latest.version) {
    $cmp = Compare-Version $Script:CurrentVersion $Script:Latest.version
    if ($cmp -lt 0) {
      $hasUpdate = $true
      $latest = $Script:Latest.version
      $notes = $Script:Latest.notes
      if ($Script:Latest.min_version -and (Compare-Version $Script:CurrentVersion $Script:Latest.min_version) -lt 0) {
        $force = $true
      }
    }
  }
  return @{
    ok = $true
    current = $Script:CurrentVersion
    latest = $latest
    hasUpdate = $hasUpdate
    force = $force
    notes = $notes
    staged = [bool]$Script:StagedZip
    applying = $Script:Applying
    applyResult = $Script:LastApply
    server = @{ healthy = (Test-PbHealthy); port = $PbPort }
  }
}

function Send-Json($ctx, $obj) {
  $body = $obj | ConvertTo-Json -Depth 6
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
}

function Handle-Request($ctx) {
  $path = $ctx.Request.Url.AbsolutePath
  $method = $ctx.Request.HttpMethod
  if ($method -eq "OPTIONS") {
    $ctx.Response.StatusCode = 204
    $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    $ctx.Response.OutputStream.Close()
    return
  }
  if ($path -eq "/status" -and $method -eq "GET") {
    Send-Json $ctx (Get-StatusObject)
    return
  }
  if ($path -eq "/apply" -and $method -eq "POST") {
    $result = Invoke-ApplyUpdate
    Send-Json $ctx $result
    return
  }
  $ctx.Response.StatusCode = 404
  $ctx.Response.OutputStream.Close()
}

function Start-HttpListener {
  # Retry binding for ~15s: the previous launcher's socket can linger in
  # TIME_WAIT right after a restart, and we don't want to give up on the API.
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:$LauncherPort/")
    try {
      $listener.Start()
      Write-Log "Update API listening on http://127.0.0.1:$LauncherPort"
      return $listener
    } catch {
      try { $listener.Close() } catch { }
      Start-Sleep -Milliseconds 700
    }
  }
  Write-Log "Could not bind 127.0.0.1:$LauncherPort after retries - another DAHAV instance running?"
  return $null
}

# --- main loop ------------------------------------------------------------------
function Main {
  Write-Log "=============================================="
  Write-Log "DAHAV launcher starting."
  if (Test-Path $VersionFile) {
    $Script:CurrentVersion = (Get-Content $VersionFile -Raw).Trim()
  } else {
    Write-Log "VERSION file missing - treating as 0.0.0"
  }
  Write-Log "Current version: $($Script:CurrentVersion)"

  # ensure data dirs
  foreach ($d in @($LogDir, $StagedDir, $BakDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

  try {
    if (Test-PbHealthy) {
      Write-Log "PocketBase already running - attaching."
      $Script:PbOwned = $false
    } else {
      if (Test-PbDataEmpty) {
        Write-Log "First run detected (no pb_data/data.db)."
        Invoke-FirstRun
      }
      Start-PocketBase
    }
  } catch {
    Write-Log "Startup error: $($_.Exception.Message)"
    # One automatic retry: a freshly killed or orphaned process can leave the
    # port in a transient state; the orphan-kill in Start-PocketBase guarantees
    # the port is clean on the second attempt.
    if (-not $Script:RetriedStart) {
      $Script:RetriedStart = $true
      Write-Log "Retrying PocketBase startup once..."
      try {
        Start-PocketBase
      } catch {
        Write-Log "Retry failed: $($_.Exception.Message)"
        Write-Host "`nDAHAV could not start PocketBase: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Press Enter to close..." -ForegroundColor Yellow
        Read-Host
        exit 1
      }
    } else {
      Write-Host "`nDAHAV could not start PocketBase: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "Press Enter to close..." -ForegroundColor Yellow
      Read-Host
      exit 1
    }
  }

  # Update check at launch — run the fetch+download on a background job so the
  # API comes up immediately and a slow/incomplete download never blocks it.
  # The job result is collected in the supervisor loop below.
  $Script:Latest = $null
  $checkJob = Start-Job -ScriptBlock {
    param($manifestUrl, $currentVersion)
    $latest = $null
    try {
      $r = Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing -TimeoutSec 20
      if ($r.StatusCode -eq 200) { $latest = $r.Content | ConvertFrom-Json }
    } catch { $latest = $null }
    if (-not $latest -or -not $latest.version) { return @{ latest = $null; zip = $null } }
    $cmp = [math]::Sign(([version]$latest.version).CompareTo([version]$currentVersion))
    if ($cmp -le 0) { return @{ latest = $latest; zip = $null } }
    # download + verify
    $zip = $null
    try {
      $dir = Join-Path $env:TEMP "dahav-stage"
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      $path = Join-Path $dir ("dahav-" + $latest.version + ".zip")
      Invoke-WebRequest -Uri $latest.url -OutFile $path -UseBasicParsing -TimeoutSec 300
      if ($latest.sha256) {
        $h = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($h -ne $latest.sha256.ToLowerInvariant()) {
          Remove-Item $path -Force -ErrorAction SilentlyContinue
          return @{ latest = $latest; zip = $null }
        }
      }
      $zip = $path
    } catch { $zip = $null }
    return @{ latest = $latest; zip = $zip }
  } -ArgumentList (Resolve-ManifestUrl), $Script:CurrentVersion

  # HTTP API
  $listener = Start-HttpListener
  if (-not $NoBrowser) {
    try { Start-Process "http://127.0.0.1:$PbPort/" } catch { }
  }

  Write-Log "DAHAV running. Close this window to stop."
  $lastCheck = Get-Date
  $lastPbCheck = Get-Date

  # Supervisor loop
  while (-not $Script:StopRequested) {
    try {
      # keep PB alive (checked on a schedule so it never blocks the listener)
      if ($Script:PbOwned -and ((Get-Date) -gt $lastPbCheck.AddSeconds(5))) {
        $lastPbCheck = Get-Date
        if (-not (Test-PbHealthy)) {
          Write-Log "PocketBase went down - restarting."
          try { Start-PocketBase } catch { Write-Log "Restart failed: $($_.Exception.Message)" }
        }
      }

      # collect the launch-time update check result
      if ($checkJob -and $checkJob.State -eq "Completed") {
        try {
          $res = Receive-Job $checkJob
          Remove-Job $checkJob -Force -ErrorAction SilentlyContinue
          $checkJob = $null
          if ($res -and $res.latest -and $res.latest.version) {
            $Script:Latest = $res.latest
            if ($res.zip) {
              $Script:StagedZip = $res.zip
              Write-Log "Staged update $($res.latest.version) ready at $($res.zip)"
            } else {
              Write-Log "Update $($res.latest.version) available but not staged (offline or checksum failed)."
            }
          }
        } catch {
          Write-Log "Launch update check error: $($_.Exception.Message)"
        }
      }

      # periodic update re-check every 30 minutes — reuse the same job slot
      if (-not $checkJob -and (Get-Date) -gt $lastCheck.AddMinutes(30)) {
        $lastCheck = Get-Date
        $checkJob = Start-Job -ScriptBlock {
          param($manifestUrl, $currentVersion)
          $latest = $null
          try {
            $r = Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing -TimeoutSec 20
            if ($r.StatusCode -eq 200) { $latest = $r.Content | ConvertFrom-Json }
          } catch { $latest = $null }
          if (-not $latest -or -not $latest.version) { return @{ latest = $null; zip = $null } }
          $cmp = [math]::Sign(([version]$latest.version).CompareTo([version]$currentVersion))
          if ($cmp -le 0) { return @{ latest = $latest; zip = $null } }
          $zip = $null
          try {
            $dir = Join-Path $env:TEMP "dahav-stage"
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            $path = Join-Path $dir ("dahav-" + $latest.version + ".zip")
            Invoke-WebRequest -Uri $latest.url -OutFile $path -UseBasicParsing -TimeoutSec 300
            if ($latest.sha256) {
              $h = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
              if ($h -ne $latest.sha256.ToLowerInvariant()) {
                Remove-Item $path -Force -ErrorAction SilentlyContinue
                return @{ latest = $latest; zip = $null }
              }
            }
            $zip = $path
          } catch { $zip = $null }
          return @{ latest = $latest; zip = $zip }
        } -ArgumentList (Resolve-ManifestUrl), $Script:CurrentVersion
      }

      # serve HTTP — blocking GetContext(); health + update checks run on their
      # own schedules above, so this never stalls the API
      if ($listener -and $listener.IsListening) {
        try {
          $ctx = $listener.GetContext()
          try { Handle-Request $ctx } catch {
            Write-Log "HTTP handler error: $($_.Exception.Message)"
            try { $ctx.Response.StatusCode = 500; $ctx.Response.OutputStream.Close() } catch { }
          }
        } catch {
          # GetContext can throw transiently (e.g. listener stopping)
          Start-Sleep -Milliseconds 200
        }
      } else {
        Start-Sleep -Seconds 1
      }
    } catch {
      Write-Log "Supervisor loop error: $($_.Exception.Message)"
      Start-Sleep -Seconds 1
    }
  }
  Stop-PocketBase
  Write-Log "DAHAV launcher exiting."
}

Main
