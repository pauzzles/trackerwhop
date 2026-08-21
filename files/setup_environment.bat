@echo off
title Content Rewards Monitor - 1-Click Environment Setup
cd /d "%~dp0"
echo =========================================================
echo   CONTENT REWARDS RADAR - 1-CLICK ENVIRONMENT SETUP
echo =========================================================
echo.

echo [1/4] Checking Python installation...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in your system PATH.
    echo Please install Python 3.9+ from https://python.org and check "Add Python to PATH".
    pause
    exit /b 1
)
python --version

echo.
echo [2/4] Installing Python requirements (Playwright, Requests)...
if exist "requirements.txt" (
    python -m pip install -r requirements.txt
) else (
    python -m pip install playwright requests
)

echo.
echo [3/4] Downloading Headless Chromium Browser for Playwright...
python -m playwright install chromium

echo.
echo [4/4] Running initial baseline test and seeding live data...
if exist "monitor.py" (
    python monitor.py --once --notify discord
)

echo.
echo =========================================================
echo   SUCCESS! All dependencies and Chromium are installed.
echo   You can now double-click run_30min.bat or run_1hour.bat
echo =========================================================
echo.
pause
