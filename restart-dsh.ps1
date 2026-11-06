<#
.SYNOPSIS
    Restart the local dsh web server so a newly installed client plugin is
    picked up (a plugin's browser bundle is assembled once, at boot).

.DESCRIPTION
    Finds the running `dsh ... web` node process, stops it, waits for the port
    to free, then relaunches it in a new console window. A restart rotates the
    boot token, so open the page with the URL the new window prints.

.PARAMETER Port
    Port the GUI listens on. Default: 3080.

.PARAMETER WorkingDirectory
    Directory the server starts in (the default workspace root).
    Default: the current user's home directory.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\restart-dsh.ps1 -Port 3080
#>
param(
    [int]$Port = 3080,
    [string]$WorkingDirectory = $env:USERPROFILE
)

$ErrorActionPreference = 'Stop'

function Get-DshWebProcess {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match 'dsh[\\/]lib[\\/]bin\.js"\s+web' }
}

$running = Get-DshWebProcess
if (-not $running) {
    Write-Host 'No running dsh web process found; starting a new one.' -ForegroundColor Yellow
} else {
    foreach ($proc in $running) {
        Write-Host ("Stopping dsh web (PID {0})" -f $proc.ProcessId)
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

for ($i = 0; $i -lt 40; $i++) {
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { break }
    Start-Sleep -Milliseconds 250
}

Write-Host 'Starting dsh web ...' -ForegroundColor Green
Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "dsh web --no-open --port $Port" `
    -WorkingDirectory $WorkingDirectory

Start-Sleep -Seconds 6
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host ''
    Write-Host "Listening on $Port. Open the page with the URL printed by the new console window." -ForegroundColor Green
    Write-Host '(A restart rotates the boot token, so the old tab URL stops working.)'
} else {
    Write-Host "Port $Port is not listening yet - check the new console window." -ForegroundColor Yellow
}
