param(
  [int]$BackendPort = 8011,
  [int]$Workers = 1,
  [string]$AppDataDir = "",
  [int]$MockDelayMs = 5000,
  [double]$MockErrorRate = 0.02
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
  throw "Python virtualenv not found at $pythonExe"
}

if (-not $AppDataDir) {
  $AppDataDir = Join-Path $backendDir ".loadtest-data"
}

New-Item -ItemType Directory -Force -Path $AppDataDir | Out-Null

$env:APP_DATA_DIR = $AppDataDir
$env:BACKEND_PORT = "$BackendPort"
$env:MOCK_AI_MODE = "1"
$env:MOCK_AI_DELAY_MS = "$MockDelayMs"
$env:MOCK_AI_ERROR_RATE = "$MockErrorRate"
$env:JWT_SECRET = "loadtest-jwt-secret-fixed-for-benchmark"

Push-Location $backendDir
try {
  & $pythonExe -m uvicorn main:app --host 127.0.0.1 --port $BackendPort --workers $Workers
} finally {
  Pop-Location
}
