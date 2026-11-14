@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto bridge_ready
if /i "%AUDITFLOW_DESKTOP%"=="1" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0helix-bridge.ps1"
if /i "%AUDITFLOW_DESKTOP%"=="1" goto :eof
start "AuditFlow Helix Bridge" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0helix-bridge.ps1"
:bridge_ready
if /i "%AUDITFLOW_DESKTOP%"=="1" goto :eof
timeout /t 2 /nobreak >nul
start "" "%~dp0index.html"
