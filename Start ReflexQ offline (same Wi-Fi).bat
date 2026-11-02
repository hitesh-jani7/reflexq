@echo off
title ReflexQ - offline mode (keep this window open during the quiz)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this computer.
  echo  Download the LTS version from https://nodejs.org , install it, then run this file again.
  echo.
  pause
  exit /b
)
if not exist node_modules (
  echo Setting up ReflexQ for the first time. This needs internet once and takes about a minute...
  call npm install --omit=dev
)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/host"
echo.
echo  ReflexQ is running. Keep this window open. Close it to stop.
echo  If Windows asks about the firewall, tick "Private networks" and click Allow.
echo.
node server.js
pause
