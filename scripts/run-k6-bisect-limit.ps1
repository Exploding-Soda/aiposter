param(
  [string]$Username,
  [string]$Password,
  [string]$BaseUrl = "http://127.0.0.1:8011",
  [int]$StartRate = 1,
  [int]$MaxRate = 64,
  [int]$CoarseMultiplier = 2,
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
  [bool]$CleanupAfter = $true,
  [string]$OutputDir = "",
  [string]$ScenarioName = "default",
  [string]$ResultJsonPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $Username -or -not $Password) {
  throw "Please provide -Username and -Password"
}
if ($StartRate -lt 1) {
  throw "StartRate must be >= 1"
}
if ($MaxRate -lt $StartRate) {
  throw "MaxRate must be >= StartRate"
}
if ($CoarseMultiplier -lt 2) {
  throw "CoarseMultiplier must be >= 2"
}

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$resultsRootDir = Join-Path $rootDir "loadtest-results"
$scriptPath = Join-Path $PSScriptRoot "k6-ai-task-load.js"
$startBackendScript = Join-Path $PSScriptRoot "start-loadtest-backend.ps1"
$resetScript = Join-Path $PSScriptRoot "reset-loadtest-data.ps1"
$k6Bin = if ($env:K6_BIN) { $env:K6_BIN } elseif (Test-Path "C:\Program Files\k6\k6.exe") { "C:\Program Files\k6\k6.exe" } else { "k6" }

if (-not $AppDataDir) {
  $AppDataDir = Join-Path $backendDir ".loadtest-data"
}
if (-not $OutputDir) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputDir = Join-Path $resultsRootDir "$ScenarioName-$timestamp"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

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

function Normalize-StepResult {
  param(
    [pscustomobject]$Result
  )

  return [ordered]@{
    rate = [int]$Result.Rate
    passed = [bool]$Result.Passed
    exitCode = [int]$Result.ExitCode
    httpFailedRate = [double]$Result.HttpFailedRate
    e2eSuccessRate = [double]$Result.E2ESuccessRate
    submitP95Ms = [double]$Result.SubmitP95Ms
    completionP95Ms = if ($null -ne $Result.CompletionP95Ms) { [double]$Result.CompletionP95Ms } else { $null }
    timeouts = [int]$Result.Timeouts
    summaryPath = [string]$Result.SummaryPath
    reasons = @($Result.Reasons)
  }
}

function Invoke-K6Step {
  param(
    [int]$Rate
  )

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $summaryPath = Join-Path $OutputDir "k6-rate-$Rate-$timestamp.json"

  Write-Host ""
  Write-Host "=== Running load step: RATE=$Rate req/s, DURATION=$StepDuration ==="

  $args = @(
    "run",
    "--summary-export", $summaryPath,
    "-e", "BASE_URL=$BaseUrl",
    "-e", "USERNAME=$Username",
    "-e", "PASSWORD=$Password",
    "-e", "REGISTER_IF_MISSING=1",
    "-e", "RATE=$Rate",
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
  $httpFailedRate = Get-K6MetricNumber -Metric $summary.metrics.http_req_failed -PrimaryName "value" -FallbackName "rate"
  $e2eSuccessRate = Get-K6MetricNumber -Metric $summary.metrics.ai_task_e2e_success -PrimaryName "value" -FallbackName "rate"
  $submitP95 = Get-K6MetricNumber -Metric $summary.metrics.ai_task_submit_duration -PrimaryName "p(95)"
  $completionP95 = $null
  if ($summary.metrics.ai_task_completion_duration) {
    $completionP95 = Get-K6MetricNumber -Metric $summary.metrics.ai_task_completion_duration -PrimaryName "p(95)"
  }
  $timeouts = 0
  if ($summary.metrics.ai_task_timeout) {
    $timeouts = [int](Get-K6MetricNumber -Metric $summary.metrics.ai_task_timeout -PrimaryName "count")
  }

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

  Write-Host ("Result: pass={0}, http_failed={1:P2}, e2e_success={2:P2}, submit_p95={3}ms, completion_p95={4}, timeouts={5}" -f $passed, $httpFailedRate, $e2eSuccessRate, [math]::Round($submitP95, 2), ($(if ($null -ne $completionP95) { [math]::Round($completionP95, 2).ToString() + 'ms' } else { 'n/a' })), $timeouts)
  if (-not $passed) {
    Write-Warning ("Failure reasons: " + ($reasons -join ", "))
  }

  return [PSCustomObject]@{
    Rate = $Rate
    Passed = $passed
    ExitCode = $exitCode
    HttpFailedRate = $httpFailedRate
    E2ESuccessRate = $e2eSuccessRate
    SubmitP95Ms = $submitP95
    CompletionP95Ms = $completionP95
    Timeouts = $timeouts
    SummaryPath = $summaryPath
    Reasons = @($reasons)
  }
}

$runResult = $null
try {
  if ($AutoStartBackend) {
    & $startBackendScript `
      -BackendPort $BackendPort `
      -Workers $Workers `
      -AppDataDir $AppDataDir `
      -MockDelayMs $MockDelayMs `
      -MockErrorRate $MockErrorRate
  }

  $coarseResults = @()
  $binarySearchResults = @()
  $rate = $StartRate
  $lastPass = $null
  $firstFail = $null
  $searchMode = "coarse"
  $finalStatus = "unknown"

  while ($true) {
    $result = Invoke-K6Step -Rate $rate
    $coarseResults += $result

    if ($result.Passed) {
      $lastPass = $result
      if ($rate -ge $MaxRate) {
        $finalStatus = "max_rate_passed"
        break
      }
      $nextRate = [Math]::Min($MaxRate, $rate * $CoarseMultiplier)
      if ($nextRate -le $rate) {
        $finalStatus = "max_rate_passed"
        break
      }
      $rate = $nextRate
      continue
    }

    $firstFail = $result
    break
  }

  if (-not $lastPass -and $firstFail) {
    $finalStatus = "failed_at_start_rate"
    Write-Host ""
    Write-Host ("Server failed even at the starting rate: {0} req/s" -f $firstFail.Rate)
    Write-Host ("First failing summary: {0}" -f $firstFail.SummaryPath)
  } elseif ($lastPass -and -not $firstFail -and $lastPass.Rate -eq $MaxRate) {
    $finalStatus = "max_rate_passed"
    Write-Host ""
    Write-Host ("No failure found up to MaxRate={0} req/s" -f $MaxRate)
    Write-Host ("Highest confirmed passing rate: {0} req/s" -f $lastPass.Rate)
    Write-Host ("Passing summary: {0}" -f $lastPass.SummaryPath)
  } else {
    if (-not $lastPass -or -not $firstFail) {
      throw "Unable to determine binary search bounds"
    }

    $searchMode = "binary"
    $low = [int]$lastPass.Rate
    $high = [int]$firstFail.Rate
    $bestPass = $lastPass
    $worstFail = $firstFail

    Write-Host ""
    Write-Host ("Binary search range: low={0} req/s, high={1} req/s" -f $low, $high)

    while (($high - $low) -gt 1) {
      $mid = [int][Math]::Floor(($low + $high) / 2)
      $result = Invoke-K6Step -Rate $mid
      $binarySearchResults += $result

      if ($result.Passed) {
        $low = $mid
        $bestPass = $result
      } else {
        $high = $mid
        $worstFail = $result
      }
    }

    $lastPass = $bestPass
    $firstFail = $worstFail
    $finalStatus = "limit_found"

    Write-Host ""
    Write-Host "=== Estimated Limit ==="
    Write-Host ("Highest confirmed passing rate: {0} req/s" -f $bestPass.Rate)
    Write-Host ("Lowest confirmed failing rate: {0} req/s" -f $worstFail.Rate)
    Write-Host ("Passing summary: {0}" -f $bestPass.SummaryPath)
    Write-Host ("Failing summary: {0}" -f $worstFail.SummaryPath)
  }

  $runResult = [ordered]@{
    scenarioName = $ScenarioName
    status = $finalStatus
    searchMode = $searchMode
    createdAt = (Get-Date).ToString("o")
    outputDir = $OutputDir
    baseUrl = $BaseUrl
    backendPort = $BackendPort
    workers = $Workers
    mockDelayMs = $MockDelayMs
    mockErrorRate = $MockErrorRate
    appDataDir = $AppDataDir
    thresholds = [ordered]@{
      maxHttpFailedRate = $MaxHttpFailedRate
      minE2ESuccessRate = $MinE2ESuccessRate
    }
    testConfig = [ordered]@{
      startRate = $StartRate
      maxRate = $MaxRate
      coarseMultiplier = $CoarseMultiplier
      stepDuration = $StepDuration
      preAllocatedVUs = $PreAllocatedVUs
      maxVUs = $MaxVUs
      taskTimeoutMs = $TaskTimeoutMs
      pollIntervalMs = $PollIntervalMs
    }
    highestConfirmedPassingRate = if ($lastPass) { [int]$lastPass.Rate } else { $null }
    lowestConfirmedFailingRate = if ($firstFail) { [int]$firstFail.Rate } else { $null }
    passingStep = if ($lastPass) { (Normalize-StepResult -Result $lastPass) } else { $null }
    failingStep = if ($firstFail) { (Normalize-StepResult -Result $firstFail) } else { $null }
    coarseSteps = @($coarseResults | Where-Object { $_ -ne $null } | ForEach-Object { Normalize-StepResult -Result $_ })
    binarySearchSteps = @($binarySearchResults | Where-Object { $_ -ne $null } | ForEach-Object { Normalize-StepResult -Result $_ })
  }

  if ($ResultJsonPath) {
    $runResult | ConvertTo-Json -Depth 8 | Set-Content -Path $ResultJsonPath -Encoding UTF8
    Write-Host ("Structured result written to: {0}" -f $ResultJsonPath)
  }
} finally {
  if ($CleanupAfter) {
    & $resetScript -AppDataDir $AppDataDir
  }
}
