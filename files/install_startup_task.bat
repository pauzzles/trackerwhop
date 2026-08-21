@echo off
title Content Rewards Monitor - Register Windows Background Startup
cd /d "%~dp0"
echo ===============================================================
echo   CONTENT REWARDS RADAR - WINDOWS SILENT STARTUP INSTALLER
echo ===============================================================
echo.

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\ContentRewardsSilentMonitor.vbs"

echo [1/2] Creating silent startup launcher in Windows Startup folder...
copy /Y "run_silent.vbs" "%SHORTCUT_PATH%" >nul

echo [2/2] Launching background monitor now...
start "" "%SHORTCUT_PATH%"

echo.
echo ===============================================================
echo   SUCCESS! The monitor is now running silently in background.
echo   It will also auto-start whenever you turn on or restart your PC.
echo ===============================================================
echo.
pause
