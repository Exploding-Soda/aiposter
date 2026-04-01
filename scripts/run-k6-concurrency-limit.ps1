param(
  [string]$Username,
  [string]$Password,
  [int]$Workers = 2,
  [int]$BackendPort = 8030,
  [string]$AppDataDir = "",
  [int]$MockDelayMs = 5000,
  [double]$MockErrorRate = 0.02,
  [string]$Duration = "20s",
  [int]$TaskTimeoutMs = 120000,
  [int]$PollIntervalMs = 1000,
  [double]$MaxHttpFailedRate = 0.05,
  [double]$MinE2ESuccessRate = 0.90,
  [object[]]$ConcurrencySteps = @(10, 20, 50, 100, 200, 400, 800, 1000),
  [string]$RunLabel = "",
  [bool]$CleanupAfter = $true
)

$ErrorActionPreference = "Stop"

if (-not $Username -or -not $Password) {
  throw "Please provide -Username and -Password"
}

function Convert-ToIntList {
  param(
    [object[]]$Values
  )

  $items = New-Object System.Collections.Generic.List[int]
  foreach ($value in $Values) {
    if ($null -eq $value) {
      continue
    }
    foreach ($part in [string]$value -split ",") {
      $trimmed = $part.Trim()
      if (-not $trimmed) {
        continue
      }
      $items.Add([int]$trimmed)
    }
  }
  return @($items)
}

$ConcurrencySteps = Convert-ToIntList -Values $ConcurrencySteps

$rootDir = Split-Path -Parent $PSScriptRoot
$resultsRootDir = Join-Path $rootDir "loadtest-results"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $RunLabel) {
  $RunLabel = "concurrency-limit-$timestamp"
}
$runDir = Join-Path $resultsRootDir $RunLabel
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$startBackendScript = Join-Path $PSScriptRoot "start-loadtest-backend.ps1"
$resetScript = Join-Path $PSScriptRoot "reset-loadtest-data.ps1"
$k6ScriptPath = Join-Path $PSScriptRoot "k6-ai-task-load.js"
$k6Bin = if ($env:K6_BIN) { $env:K6_BIN } elseif (Test-Path "C:\Program Files\k6\k6.exe") { "C:\Program Files\k6\k6.exe" } else { "k6" }

if (-not $AppDataDir) {
  $AppDataDir = Join-Path $runDir "app-data"
}

function Get-K6MetricNumber {
  param(
    $Metric,
    [string]$PrimaryName,
    [string]$FallbackName = ""
  )

  if ($null -eq $Metric) {
    return $null
  }
  if ($Metric.PSObject.Properties.Name -contains $PrimaryName) {
    return [double]$Metric.$PrimaryName
  }
  if ($FallbackName -and ($Metric.PSObject.Properties.Name -contains $FallbackName)) {
    return [double]$Metric.$FallbackName
  }
  if (($Metric.PSObject.Properties.Name -contains "values") -and $Metric.values) {
    if ($Metric.values.PSObject.Properties.Name -contains $PrimaryName) {
      return [double]$Metric.values.$PrimaryName
    }
    if ($FallbackName -and ($Metric.values.PSObject.Properties.Name -contains $FallbackName)) {
      return [double]$Metric.values.$FallbackName
    }
  }
  return $null
}

$results = @()

try {
  & $startBackendScript `
    -BackendPort $BackendPort `
    -Workers $Workers `
    -AppDataDir $AppDataDir `
    -MockDelayMs $MockDelayMs `
    -MockErrorRate $MockErrorRate

  foreach ($concurrency in $ConcurrencySteps) {
    $summaryPath = Join-Path $runDir "k6-vus-$concurrency.json"
    Write-Host ""
    Write-Host "=== Running concurrency step: VUS=$concurrency, DURATION=$Duration ==="

    $args = @(
      "run",
      "--summary-export", $summaryPath,
      "-e", "SCENARIO_MODE=constant-vus",
      "-e", "BASE_URL=http://127.0.0.1:$BackendPort",
      "-e", "USERNAME=$Username",
      "-e", "PASSWORD=$Password",
      "-e", "REGISTER_IF_MISSING=1",
      "-e", "SUBMIT_P95_THRESHOLD_MS=0",
      "-e", "VUS=$concurrency",
      "-e", "DURATION=$Duration",
      "-e", "TASK_TIMEOUT_MS=$TaskTimeoutMs",
      "-e", "POLL_INTERVAL_MS=$PollIntervalMs",
      $k6ScriptPath
    )

    & $k6Bin @args
    $exitCode = $LASTEXITCODE

    $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
    $httpFailedRate = Get-K6MetricNumber -Metric $summary.metrics.http_req_failed -PrimaryName "value" -FallbackName "rate"
    $e2eSuccessRate = Get-K6MetricNumber -Metric $summary.metrics.ai_task_e2e_success -PrimaryName "value" -FallbackName "rate"
    $completionP95 = Get-K6MetricNumber -Metric $summary.metrics.ai_task_completion_duration -PrimaryName "p(95)"
    $submitP95 = Get-K6MetricNumber -Metric $summary.metrics.ai_task_submit_duration -PrimaryName "p(95)"
    $iterations = [int](Get-K6MetricNumber -Metric $summary.metrics.iterations -PrimaryName "count")
    $completed = [int](Get-K6MetricNumber -Metric $summary.metrics.ai_task_completed -PrimaryName "count")
    $failed = if ($summary.metrics.ai_task_failed) { [int](Get-K6MetricNumber -Metric $summary.metrics.ai_task_failed -PrimaryName "count") } else { 0 }
    $timeouts = if ($summary.metrics.ai_task_timeout) { [int](Get-K6MetricNumber -Metric $summary.metrics.ai_task_timeout -PrimaryName "count") } else { 0 }

    $passed = $true
    $reasons = New-Object System.Collections.Generic.List[string]
    if ($exitCode -ne 0) {
      $passed = $false
      $reasons.Add("k6_exit=$exitCode")
    }
    if ($httpFailedRate -gt $MaxHttpFailedRate) {
      $passed = $false
      $reasons.Add(("http_failed={0:P2}>{1:P2}" -f $httpFailedRate, $MaxHttpFailedRate))
    }
    if ($e2eSuccessRate -lt $MinE2ESuccessRate) {
      $passed = $false
      $reasons.Add(("e2e_success={0:P2}<{1:P2}" -f $e2eSuccessRate, $MinE2ESuccessRate))
    }
    if ($timeouts -gt 0) {
      $passed = $false
      $reasons.Add("timeouts=$timeouts")
    }

    $row = [ordered]@{
      concurrency = $concurrency
      passed = $passed
      exitCode = $exitCode
      httpFailedRate = $httpFailedRate
      e2eSuccessRate = $e2eSuccessRate
      submitP95Ms = $submitP95
      completionP95Ms = $completionP95
      iterations = $iterations
      completed = $completed
      failed = $failed
      timeouts = $timeouts
      summaryPath = $summaryPath
      reasons = @($reasons)
    }
    $results += [pscustomobject]$row

    Write-Host ("Result: pass={0}, e2e_success={1:P2}, http_failed={2:P2}, submit_p95={3}ms, completion_p95={4}ms, completed={5}, failed={6}, timeouts={7}" -f $passed, $e2eSuccessRate, $httpFailedRate, [math]::Round($submitP95, 2), [math]::Round($completionP95, 2), $completed, $failed, $timeouts)

    if (-not $passed) {
      Write-Warning ("Stopping at concurrency $concurrency because: " + ($reasons -join ", "))
      break
    }

    if ($concurrency -ge 1000) {
      Write-Host "Reached 1000 concurrency without hitting stop condition."
      break
    }
  }

  $resultPath = Join-Path $runDir "concurrency-limit-result.json"
  [ordered]@{
    runLabel = $RunLabel
    createdAt = (Get-Date).ToString("o")
    workers = $Workers
    backendPort = $BackendPort
    mockDelayMs = $MockDelayMs
    mockErrorRate = $MockErrorRate
    duration = $Duration
    thresholds = [ordered]@{
      maxHttpFailedRate = $MaxHttpFailedRate
      minE2ESuccessRate = $MinE2ESuccessRate
    }
    maxPassingConcurrency = @($results | Where-Object { $_.passed } | Select-Object -Last 1 -ExpandProperty concurrency)
    firstFailingConcurrency = @($results | Where-Object { -not $_.passed } | Select-Object -First 1 -ExpandProperty concurrency)
    steps = @($results)
  } | ConvertTo-Json -Depth 8 | Set-Content -Path $resultPath -Encoding UTF8

  Write-Host ""
  Write-Host "Run directory: $runDir"
  Write-Host "Structured result: $resultPath"
} finally {
  if ($CleanupAfter) {
    & $resetScript -AppDataDir $AppDataDir
  }
}
