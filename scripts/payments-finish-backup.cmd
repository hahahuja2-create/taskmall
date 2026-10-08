@echo off
setlocal
title TaskMall Backup Status - NOT a Password Form
cd /d "%~dp0.."
echo Finish the EXISTING phone backup. No repeat phone transfer or new password.
echo Enter your SAME NEW backup password only in the separate masked form.
echo Confirm phone storage in the separate confirmation dialog.
echo This tool does NOT sign, send money or start automatic collection.
echo.
node --env-file-if-exists=.env scripts/secure-backup.cjs --verify-return
echo.
echo No payment worker was started. Press any key to close this window.
pause >nul
