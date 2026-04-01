param(
  [int]$BackendPort = 8011,
  [int]$Workers = 1,
  [string]$AppDataDir = "",
  [int]$MockDelayMs = 5000,
  [double]$MockErrorRate = 0.02,
  [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$runnerPath = Join-Path $PSScriptRoot "run-loadtest-backend.ps1"
$pidFile = Join-Path $backendDir ".loadtest-backend.pid"
$logDir = Join-Path $backendDir ".loadtest-logs"

if (-not $AppDataDir) {
  $AppDataDir = Join-Path $backendDir ".loadtest-data"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$listeners = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  $listenerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  throw "Port $BackendPort is already in use by process(es): $($listenerPids -join ', ')"
}

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      throw "Load test backend is already running with PID $existingPid"
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$stdoutLog = Join-Path $logDir "backend-stdout.log"
$stderrLog = Join-Path $logDir "backend-stderr.log"

$argumentList = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $runnerPath,
  "-BackendPort", "$BackendPort",
  "-Workers", "$Workers",
  "-AppDataDir", $AppDataDir,
  "-MockDelayMs", "$MockDelayMs",
  "-MockErrorRate", "$MockErrorRate"
)

$process = Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
$process.Id | Set-Content $pidFile

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$ready = $false
$backendPid = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$BackendPort/openapi.json" -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
      $listener = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($listener) {
        $backendPid = [int]$listener.OwningProcess
      }
      $ready = $true
      break
    }
  } catch {
  }
}

if (-not $ready) {
  try {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  } catch {
  }
  throw "Load test backend did not become ready within $StartupTimeoutSeconds seconds. Check $stdoutLog and $stderrLog"
}

if ($backendPid) {
  $backendPid | Set-Content $pidFile
} else {
  $process.Id | Set-Content $pidFile
}

Write-Host "Load test backend started"
Write-Host "PID: $(if ($backendPid) { $backendPid } else { $process.Id })"
Write-Host "Base URL: http://127.0.0.1:$BackendPort"
Write-Host "App data dir: $AppDataDir"
Write-Host "Stdout log: $stdoutLog"
Write-Host "Stderr log: $stderrLog"
