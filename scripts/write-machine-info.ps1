param(
  [string]$OutputJsonPath
)

$ErrorActionPreference = "Stop"

if (-not $OutputJsonPath) {
  throw "Please provide -OutputJsonPath"
}

$parent = Split-Path -Parent $OutputJsonPath
if ($parent) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

$computerSystem = Get-CimInstance Win32_ComputerSystem
$processors = @(Get-CimInstance Win32_Processor)
$operatingSystem = Get-CimInstance Win32_OperatingSystem

$info = [ordered]@{
  capturedAt = (Get-Date).ToString("o")
  machineName = $env:COMPUTERNAME
  manufacturer = $computerSystem.Manufacturer
  model = $computerSystem.Model
  logicalCpuCount = [Environment]::ProcessorCount
  processorCount = $processors.Count
  processorNames = @($processors | ForEach-Object { $_.Name.Trim() })
  totalMemoryGB = [Math]::Round(($computerSystem.TotalPhysicalMemory / 1GB), 2)
  osCaption = $operatingSystem.Caption
  osVersion = $operatingSystem.Version
}

$info | ConvertTo-Json -Depth 5 | Set-Content -Path $OutputJsonPath -Encoding UTF8
