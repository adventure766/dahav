# ============================================================================
# DAHAV first-run provisioning
# ----------------------------------------------------------------------------
# Runs once, when pb_data is empty. It:
#   1. Starts PocketBase on a temporary port (8093) so migrations auto-apply.
#   2. Creates the superuser (admin) via `pocketbase superuser upsert`.
#   3. Creates the initial 'owner' staff user via the existing /api/dahav/users/create route.
#   4. Stops the temporary server. The supervisor then starts it on :8090.
#
# Inputs (optional, otherwise prompted):
#   -Root <path>            DAHAV install root (defaults to parent of scripts/)
#   -AdminEmail / -AdminPassword
#   -OwnerEmail / -OwnerPassword
# ============================================================================
[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$AdminEmail = "",
  [string]$AdminPassword = "",
  [string]$OwnerEmail = "",
  [string]$OwnerPassword = ""
)

$ErrorActionPreference = "Stop"
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$PbExe  = Join-Path $Root "pocketbase.exe"
$PbData = Join-Path $Root "pb_data"
$TempPort = 8093
$Base = "http://127.0.0.1:$TempPort"

if (-not (Test-Path $PbExe)) { throw "pocketbase.exe not found at $PbExe" }

# Allow non-interactive provisioning via environment (used by the test harness
# and by `DAHAV.bat` when the client runs first-run).
if (-not $AdminEmail)    { $AdminEmail = $env:DAHAV_ADMIN_EMAIL }
if (-not $AdminPassword) { $AdminPassword = $env:DAHAV_ADMIN_PASSWORD }
if (-not $OwnerEmail)    { $OwnerEmail = $env:DAHAV_OWNER_EMAIL }
if (-not $OwnerPassword) { $OwnerPassword = $env:DAHAV_OWNER_PASSWORD }

function Read-Secret($prompt) {
  Write-Host $prompt -NoNewline
  $val = Read-Host -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($val))
}

$interactive = -not ($env:DAHAV_NONINTERACTIVE -or ($AdminEmail -and $AdminPassword -and $OwnerEmail -and $OwnerPassword))
if ($interactive) {
  if (-not $AdminEmail)    { $AdminEmail = Read-Host "Admin email (used only for app maintenance, e.g. admin@yourbusiness.com)" }
  if (-not $AdminPassword) { $AdminPassword = Read-Secret "Admin password (minimum 8 characters): " }
  if (-not $OwnerEmail)    { $OwnerEmail = Read-Host "Owner email (this is your DAHAV login): " }
  if (-not $OwnerPassword) { $OwnerPassword = Read-Secret "Owner password (minimum 8 characters): " }
}
if (-not $AdminEmail)    { throw "Admin email is required (set DAHAV_ADMIN_EMAIL or pass -AdminEmail)." }
if (-not $AdminPassword -or $AdminPassword.Length -lt 8) { throw "Admin password must be at least 8 characters." }
if (-not $OwnerEmail)    { throw "Owner email is required (set DAHAV_OWNER_EMAIL or pass -OwnerEmail)." }
if (-not $OwnerPassword -or $OwnerPassword.Length -lt 8) { throw "Owner password must be at least 8 characters." }

Write-Host "Starting temporary PocketBase to prepare your database..."

$p = Start-Process -FilePath $PbExe -ArgumentList @("serve", "--http=127.0.0.1:$TempPort", "--dir", $PbData) `
      -WorkingDirectory $Root -PassThru -ErrorAction Stop

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) {
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
  throw "Temporary PocketBase did not become ready. Check that port $TempPort is free."
}
Write-Host "Temporary PocketBase is ready (migrations applied)."

# --- superuser -----------------------------------------------------------------
$suAuth = $null
try {
  $suAuth = Invoke-RestMethod -Method Post -Uri "$Base/api/collections/_superusers/auth-with-password" `
    -ContentType "application/json" `
    -Body (@{ identity = $AdminEmail; password = $AdminPassword } | ConvertTo-Json) -TimeoutSec 5
} catch { }
if (-not $suAuth -or -not $suAuth.token) {
  # No superuser yet - create it via the CLI. The CLI opens its own lock, so stop
  # the temp server first, run the CLI, then restart.
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Write-Host "Creating admin account..."
  & $PbExe superuser upsert $AdminEmail $AdminPassword --dir $PbData
  if ($LASTEXITCODE -ne 0) { throw "superuser upsert failed (exit $LASTEXITCODE)" }

  $p = Start-Process -FilePath $PbExe -ArgumentList @("serve", "--http=127.0.0.1:$TempPort", "--dir", $PbData) `
        -WorkingDirectory $Root -PassThru -ErrorAction Stop
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "PocketBase did not come back after superuser creation." }
  $suAuth = Invoke-RestMethod -Method Post -Uri "$Base/api/collections/_superusers/auth-with-password" `
    -ContentType "application/json" `
    -Body (@{ identity = $AdminEmail; password = $AdminPassword } | ConvertTo-Json)
}
Write-Host "Admin account ready."

# --- owner user ----------------------------------------------------------------
$users = Invoke-RestMethod -Uri "$Base/api/collections/users/records?perPage=1" -Headers @{ Authorization = $suAuth.token }
if ($users.items.Count -eq 0) {
  Write-Host "Creating owner account..."
  $create = Invoke-RestMethod -Method Post -Uri "$Base/api/dahav/users/create" `
    -Headers @{ Authorization = $suAuth.token } `
    -ContentType "application/json" `
    -Body (@{ email = $OwnerEmail; password = $OwnerPassword; name = "Owner"; role = "owner" } | ConvertTo-Json)
  Write-Host "Owner account created: $OwnerEmail"
} else {
  Write-Host "Users already exist - skipping owner creation."
}

# --- done ----------------------------------------------------------------------
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Write-Host "First-run setup complete. DAHAV will now start on http://127.0.0.1:8090"
