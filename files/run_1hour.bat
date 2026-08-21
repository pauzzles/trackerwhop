@echo off
title Content Rewards Monitor - Auto-Update Every 1 Hour
cd /d "%~dp0"
echo =========================================================
echo   Content Rewards Campaign Radar (Every 1 Hour)
echo   Target: https://contentrewards.com/discover
echo   Notifications: Discord Webhook (Connected)
echo =========================================================
echo.

where node >nul 2>&1
if %errorlevel% equ 0 (
    if exist "monitor.js" (
        node monitor.js --loop 1h
        goto done
    ) else if exist "files\monitor.js" (
        node files\monitor.js --loop 1h
        goto done
    )
)

where python >nul 2>&1
if %errorlevel% equ 0 (
    if exist "monitor.py" (
        python monitor.py --loop 1h --notify discord
        goto done
    ) else if exist "files\monitor.py" (
        python files\monitor.py --loop 1h --notify discord
        goto done
    )
)

:done
pause
