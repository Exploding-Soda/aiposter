param(
  [string]$AppDataDir = ""
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$resultsDir = Join-Path $rootDir "loadtest-results"
$pidFile = Join-Path $backendDir ".loadtest-backend.pid"
$logDir = Join-Path $backendDir ".loadtest-logs"
$backendDirResolved = [System.IO.Path]::GetFullPath($backendDir)
$resultsDirResolved = [System.IO.Path]::GetFullPath($resultsDir)

if (-not $AppDataDir) {
  $AppDataDir = Join-Path $backendDir ".loadtest-data"
}

$appDataDirResolved = [System.IO.Path]::GetFullPath($AppDataDir)
if (
  (-not $appDataDirResolved.StartsWith($backendDirResolved, [System.StringComparison]::OrdinalIgnoreCase)) -and
  (-not $appDataDirResolved.StartsWith($resultsDirResolved, [System.StringComparison]::OrdinalIgnoreCase))
) {
  throw "Refusing to delete AppDataDir outside backend directory: $appDataDirResolved"
}

if (Test-Path $pidFile) {
  $pidValue = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($pidValue) {
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process) {
      try {
        taskkill /PID $pidValue /T /F | Out-Null
      } catch {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      }
      Start-Sleep -Seconds 2
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if (Test-Path $appDataDirResolved) {
  Remove-Item $appDataDirResolved -Recurse -Force
}

if (Test-Path $logDir) {
  try {
    Remove-Item $logDir -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "Failed to fully remove log directory: $logDir"
  }
}

Write-Host "Load test backend stopped and isolated test data removed."
