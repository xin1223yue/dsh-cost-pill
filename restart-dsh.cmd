@echo off
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0restart-dsh.ps1" %*
pause
