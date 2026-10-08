@echo off
setlocal
title TaskMall - Encrypted USB Backup
cd /d "%~dp0.."
echo TaskMall private USB recovery check
echo.
echo Insert a USB flash drive before continuing.
echo The backup will be copied only after you choose a USB folder.
echo Enter passwords only in this private window. Input is hidden.
echo This window does NOT sign or send money and does NOT start collection.
echo.
pause
node --env-file-if-exists=.env scripts/collection-worker.cjs --setup --copy-backup
echo.
echo No automatic transfer was started. Press any key to close this window.
pause >nul
