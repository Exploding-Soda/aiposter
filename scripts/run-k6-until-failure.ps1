param(
  [string]$Username,
  [string]$Password,
  [string]$BaseUrl = "http://127.0.0.1:8011",
  [int]$StartRate = 1,
  [int]$StepRate = 1,
  [int]$MaxRate = 20,
  [string]$StepDuration = "30s",
  [int]$PreAllocatedVUs = 50,
  [int]$MaxVUs = 300,
  [int]$TaskTimeoutMs = 120000,
  [int]$PollIntervalMs = 1000,
  [double]$MaxHttpFailedRate = 0.05,
  [double]$MinE2ESuccessRate = 0.90,
  [int]$BackendPort = 8011,
  [int]$Workers = 1,
  [string]$AppDataDir = "",
  [int]$MockDelayMs = 5000,
  [double]$MockErrorRate = 0.02,
  [bool]$AutoStartBackend = $true,
  [bool]$CleanupAfter = $true
)

$ErrorActionPreference = "Stop"

if (-not $Username -or -not $Password) {
  throw "Please provide -Username and -Password"
}

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$resultsDir = Join-Path $rootDir "loadtest-results"
$scriptPath = Join-Path $PSScriptRoot "k6-ai-task-load.js"
$startBackendScript = Join-Path $PSScriptRoot "start-loadtest-backend.ps1"
$resetScript = Join-Path $PSScriptRoot "reset-loadtest-data.ps1"
$k6Bin = if ($env:K6_BIN) { $env:K6_BIN } elseif (Test-Path "C:\Program Files\k6\k6.exe") { "C:\Program Files\k6\k6.exe" } else { "k6" }

if (-not $AppDataDir) {
  $AppDataDir = Join-Path $backendDir ".loadtest-data"
}

New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

try {
  if ($AutoStartBackend) {
    & $startBackendScript `
      -BackendPort $BackendPort `
      -Workers $Workers `
      -AppDataDir $AppDataDir `
      -MockDelayMs $MockDelayMs `
      -MockErrorRate $MockErrorRate
  }

  $lastPassingRate = 0
  for ($rate = $StartRate; $rate -le $MaxRate; $rate += $StepRate) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $summaryPath = Join-Path $resultsDir "k6-summary-rate-$rate-$timestamp.json"

    Write-Host ""
    Write-Host "=== Running load step: RATE=$rate req/s, DURATION=$StepDuration ==="

    $args = @(
      "run",
      "--summary-export", $summaryPath,
      "-e", "BASE_URL=$BaseUrl",
      "-e", "USERNAME=$Username",
      "-e", "PASSWORD=$Password",
      "-e", "REGISTER_IF_MISSING=1",
      "-e", "RATE=$rate",
      "-e", "DURATION=$StepDuration",
      "-e", "PRE_ALLOCATED_VUS=$PreAllocatedVUs",
      "-e", "MAX_VUS=$MaxVUs",
      "-e", "TASK_TIMEOUT_MS=$TaskTimeoutMs",
      "-e", "POLL_INTERVAL_MS=$PollIntervalMs",
      $scriptPath
    )

    & $k6Bin @args
    $exitCode = $LASTEXITCODE

    if (-not (Test-Path $summaryPath)) {
      throw "k6 summary file was not created at $summaryPath"
    }

    $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
    $httpFailedRate = [double]($summary.metrics.http_req_failed.values.rate)
    $e2eSuccessRate = [double]($summary.metrics.ai_task_e2e_success.values.rate)
    $submitP95 = [double]($summary.metrics.ai_task_submit_duration.values."p(95)")
    $timeouts = 0
    if ($summary.metrics.ai_task_timeout) {
      $timeouts = [int]($summary.metrics.ai_task_timeout.values.count)
    }

    Write-Host ("Result: http_failed={0:P2}, e2e_success={1:P2}, submit_p95={2}ms, timeouts={3}" -f $httpFailedRate, $e2eSuccessRate, [math]::Round($submitP95, 2), $timeouts)

    $stepFailed = $false
    if ($exitCode -ne 0) {
      $stepFailed = $true
      Write-Warning "k6 exited with code $exitCode"
    }
    if ($httpFailedRate -gt $MaxHttpFailedRate) {
      $stepFailed = $true
      Write-Warning "HTTP failure rate exceeded threshold"
    }
    if ($e2eSuccessRate -lt $MinE2ESuccessRate) {
      $stepFailed = $true
      Write-Warning "End-to-end success rate dropped below threshold"
    }
    if ($timeouts -gt 0) {
      $stepFailed = $true
      Write-Warning "Task timeouts detected"
    }

    if ($stepFailed) {
      Write-Host ""
      Write-Host "Approximate breaking point reached around RATE=$rate req/s"
      if ($lastPassingRate -gt 0) {
        Write-Host "Last passing rate: $lastPassingRate req/s"
      }
      break
    }

    $lastPassingRate = $rate
  }
} finally {
  if ($CleanupAfter) {
    & $resetScript -AppDataDir $AppDataDir
  }
}
