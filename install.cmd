@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo node was not found on PATH - dsh itself needs Node 20+, so install that first.
  pause
  exit /b 1
)
node "%~dp0install.mjs" %*
pause
