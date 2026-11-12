@echo off
title Reel Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it with:  winget install OpenJS.NodeJS.LTS
  echo Then close this window and double-click start-claude-video.bat again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing Reel Studio's two small dependencies...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
rem Running from source = the owner's copy: licence checks off
set REEL_STUDIO_DEV=1
node server\index.js
pause
