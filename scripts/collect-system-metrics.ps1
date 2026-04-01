param(
  [int]$Pid,
  [string]$OutputCsvPath,
  [int]$IntervalSeconds = 1
)

$ErrorActionPreference = "Stop"

if ($Pid -le 0) {
  throw "Pid must be > 0"
}
if (-not $OutputCsvPath) {
  throw "Please provide -OutputCsvPath"
}
if ($IntervalSeconds -lt 1) {
  throw "IntervalSeconds must be >= 1"
}

$parent = Split-Path -Parent $OutputCsvPath
if ($parent) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

"timestamp_utc,process_cpu_percent,working_set_mb,private_memory_mb,thread_count,handle_count,system_cpu_percent,available_memory_mb" | Set-Content -Path $OutputCsvPath -Encoding UTF8

$prevTimestamp = Get-Date
$prevProcess = Get-Process -Id $Pid -ErrorAction Stop
$prevCpuSeconds = [double]$prevProcess.CPU
$logicalCpuCount = [int]([Environment]::ProcessorCount)

while ($true) {
  Start-Sleep -Seconds $IntervalSeconds

  $process = Get-Process -Id $Pid -ErrorAction SilentlyContinue
  if (-not $process) {
    break
  }

  $now = Get-Date
  $elapsedSeconds = [Math]::Max(0.001, ($now - $prevTimestamp).TotalSeconds)
  $cpuDelta = [double]$process.CPU - $prevCpuSeconds
  $processCpuPercent = [Math]::Max(0.0, ($cpuDelta / ($elapsedSeconds * $logicalCpuCount)) * 100.0)

  $systemCpuSample = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
  $systemCpuPercent = if ($systemCpuSample.Count -gt 0) { [double]$systemCpuSample.Average } else { 0.0 }
  $os = Get-CimInstance Win32_OperatingSystem
  $availableMemoryMb = [Math]::Round(([double]$os.FreePhysicalMemory / 1024.0), 2)

  $workingSetMb = [Math]::Round(($process.WorkingSet64 / 1MB), 2)
  $privateMemoryMb = [Math]::Round(($process.PrivateMemorySize64 / 1MB), 2)
  $threadCount = $process.Threads.Count
  $handleCount = $process.HandleCount
  $timestamp = [DateTime]::UtcNow.ToString("o")

  "$timestamp,$([Math]::Round($processCpuPercent, 2)),$workingSetMb,$privateMemoryMb,$threadCount,$handleCount,$([Math]::Round($systemCpuPercent, 2)),$availableMemoryMb" | Add-Content -Path $OutputCsvPath -Encoding UTF8

  $prevTimestamp = $now
  $prevCpuSeconds = [double]$process.CPU
}
