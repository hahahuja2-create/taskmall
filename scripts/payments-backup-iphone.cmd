@echo off
setlocal
title TaskMall - Private iPhone Backup
cd /d "%~dp0.."
echo TaskMall private iPhone backup check
echo.
echo Connect your iPhone using a data cable. A USB flash drive is not required.
echo Use Apple Devices Files or the existing iTunes File Sharing.
echo A trusted phone app must support storing .json files locally.
echo Do not erase, restore or sync other phone content.
echo.
echo Enter your EXISTING backup password only in this private window.
echo Never send the file, password, seed or private key in chat.
echo This window does NOT sign, send money or start automatic collection.
echo.
pause
node --env-file-if-exists=.env scripts/iphone-backup.cjs
echo.
echo Automatic collection is still OFF. Press any key to close this window.
pause >nul
