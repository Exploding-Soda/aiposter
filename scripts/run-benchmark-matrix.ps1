param(
  [string]$Username,
  [string]$Password,
  [object[]]$WorkersList = @(1, 2, 4),
  [object[]]$MockDelayMsList = @(5000),
  [object[]]$MockErrorRateList = @(0.02),
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
  [int]$BackendPortBase = 8011,
  [string]$RunLabel = "",
  [string]$ReportTitle = "Load Test Report"
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

function Convert-ToDoubleList {
  param(
    [object[]]$Values
  )

  $items = New-Object System.Collections.Generic.List[double]
  foreach ($value in $Values) {
    if ($null -eq $value) {
      continue
    }
    foreach ($part in [string]$value -split ",") {
      $trimmed = $part.Trim()
      if (-not $trimmed) {
        continue
      }
      $items.Add([double]$trimmed)
    }
  }
  return @($items)
}

$WorkersList = Convert-ToIntList -Values $WorkersList
$MockDelayMsList = Convert-ToIntList -Values $MockDelayMsList
$MockErrorRateList = Convert-ToDoubleList -Values $MockErrorRateList

$rootDir = Split-Path -Parent $PSScriptRoot
$resultsRoot = Join-Path $rootDir "loadtest-results"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $RunLabel) {
  $RunLabel = "matrix-$timestamp"
}
$runDir = Join-Path $resultsRoot $RunLabel
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$writeMachineInfoScript = Join-Path $PSScriptRoot "write-machine-info.ps1"
$startBackendScript = Join-Path $PSScriptRoot "start-loadtest-backend.ps1"
$resetScript = Join-Path $PSScriptRoot "reset-loadtest-data.ps1"
$collectMetricsScript = Join-Path $PSScriptRoot "collect-system-metrics.ps1"
$bisectScript = Join-Path $PSScriptRoot "run-k6-bisect-limit.ps1"
$buildReportScript = Join-Path $PSScriptRoot "build-loadtest-report.py"
$backendDir = Join-Path $rootDir "backend"
$pidFile = Join-Path $backendDir ".loadtest-backend.pid"

& $writeMachineInfoScript -OutputJsonPath (Join-Path $runDir "machine-info.json")

$scenarioResults = @()
$scenarioIndex = 0

foreach ($workers in $WorkersList) {
  foreach ($mockDelayMs in $MockDelayMsList) {
    foreach ($mockErrorRate in $MockErrorRateList) {
      $scenarioIndex += 1
      $scenarioName = "workers-$workers-delay-$mockDelayMs-error-$($mockErrorRate.ToString().Replace('.', '_'))"
      $scenarioDir = Join-Path $runDir $scenarioName
      $appDataDir = Join-Path $scenarioDir "app-data"
      $metricsCsvPath = Join-Path $scenarioDir "system-metrics.csv"
      $resultJsonPath = Join-Path $scenarioDir "result.json"
      $metadataPath = Join-Path $scenarioDir "scenario.json"
      $backendPort = $BackendPortBase + $scenarioIndex - 1

      New-Item -ItemType Directory -Force -Path $scenarioDir | Out-Null

      $scenarioMetadata = [ordered]@{
        scenarioName = $scenarioName
        workers = $workers
        mockDelayMs = $mockDelayMs
        mockErrorRate = $mockErrorRate
        backendPort = $backendPort
        stepDuration = $StepDuration
        startRate = $StartRate
        maxRate = $MaxRate
        coarseMultiplier = $CoarseMultiplier
        preAllocatedVUs = $PreAllocatedVUs
        maxVUs = $MaxVUs
        taskTimeoutMs = $TaskTimeoutMs
        pollIntervalMs = $PollIntervalMs
      }
      $scenarioMetadata | ConvertTo-Json -Depth 5 | Set-Content -Path $metadataPath -Encoding UTF8

      $metricsCollector = $null
      try {
        & $startBackendScript `
          -BackendPort $backendPort `
          -Workers $workers `
          -AppDataDir $appDataDir `
          -MockDelayMs $mockDelayMs `
          -MockErrorRate $mockErrorRate

        if (-not (Test-Path $pidFile)) {
          throw "Backend PID file not found: $pidFile"
        }
        $backendPid = [int](Get-Content $pidFile | Select-Object -First 1)

        $metricsArgs = @(
          "-NoProfile",
          "-ExecutionPolicy", "Bypass",
          "-File", $collectMetricsScript,
          "-Pid", "$backendPid",
          "-OutputCsvPath", $metricsCsvPath,
          "-IntervalSeconds", "1"
        )
        $metricsCollector = Start-Process -FilePath "powershell.exe" -ArgumentList $metricsArgs -PassThru -WindowStyle Hidden

        & $bisectScript `
          -Username $Username `
          -Password $Password `
          -BaseUrl "http://127.0.0.1:$backendPort" `
          -StartRate $StartRate `
          -MaxRate $MaxRate `
          -CoarseMultiplier $CoarseMultiplier `
          -StepDuration $StepDuration `
          -PreAllocatedVUs $PreAllocatedVUs `
          -MaxVUs $MaxVUs `
          -TaskTimeoutMs $TaskTimeoutMs `
          -PollIntervalMs $PollIntervalMs `
          -MaxHttpFailedRate $MaxHttpFailedRate `
          -MinE2ESuccessRate $MinE2ESuccessRate `
          -BackendPort $backendPort `
          -Workers $workers `
          -AppDataDir $appDataDir `
          -MockDelayMs $mockDelayMs `
          -MockErrorRate $mockErrorRate `
          -AutoStartBackend $false `
          -CleanupAfter $false `
          -OutputDir $scenarioDir `
          -ScenarioName $scenarioName `
          -ResultJsonPath $resultJsonPath

        $scenarioResults += $resultJsonPath
      } finally {
        & $resetScript -AppDataDir $appDataDir
        if ($metricsCollector) {
          try {
            if (-not $metricsCollector.HasExited) {
              Stop-Process -Id $metricsCollector.Id -Force -ErrorAction SilentlyContinue
            }
          } catch {
          }
        }
      }
    }
  }
}

$reportPath = Join-Path $runDir "report.md"
$csvPath = Join-Path $runDir "report.csv"
python $buildReportScript --run-dir $runDir --title $ReportTitle --output $reportPath --csv-output $csvPath

Write-Host "Benchmark matrix complete."
Write-Host "Run directory: $runDir"
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
