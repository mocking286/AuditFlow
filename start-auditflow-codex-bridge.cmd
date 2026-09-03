@echo off
setlocal
set "AUDITFLOW_BRIDGE_DIR=%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or later is required to run the local Codex bridge.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
node "%AUDITFLOW_BRIDGE_DIR%auditflow-codex-bridge.mjs"
set "AUDITFLOW_BRIDGE_EXIT=%ERRORLEVEL%"
if not "%AUDITFLOW_BRIDGE_EXIT%"=="0" pause
exit /b %AUDITFLOW_BRIDGE_EXIT%
