@echo off
title Content Rewards Monitor - 1-Click Environment Setup
cd /d "%~dp0"
echo =========================================================
echo   CONTENT REWARDS RADAR - 1-CLICK ENVIRONMENT SETUP
echo =========================================================
echo.

echo [1/3] Checking Node.js installation...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your system PATH.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)
node --version

echo.
echo [2/3] Installing NPM dependencies (playwright, discord.js)...
call npm install

echo.
echo [3/3] Downloading Chromium browser for Playwright...
call npx playwright install chromium

echo.
echo =========================================================
echo   SUCCESS! All dependencies and Chromium are installed.
echo   You can now run:
echo     - run_30min.bat
echo     - run_1hour.bat
echo =========================================================
echo.
pause
