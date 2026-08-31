@echo off
rem ============================================================================
rem  DAHAV - local business management app launcher
rem  Double-click this file to start DAHAV. Close the console window to stop.
rem ============================================================================
setlocal
cd /d "%~dp0"

where powershell >NUL 2>NUL
if errorlevel 1 (
  echo PowerShell was not found. DAHAV requires Windows PowerShell 5.1 or later.
  pause
  exit /b 1
)

if not exist "%~dp0pocketbase.exe" (
  echo pocketbase.exe was not found next to this file.
  echo Please make sure DAHAV was installed correctly.
  pause
  exit /b 1
)

rem Launch the supervisor (blocking). The console window stays open.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\updater.ps1"

echo.
echo DAHAV has stopped. You can close this window.
pause
