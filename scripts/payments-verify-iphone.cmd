@echo off
setlocal
title TaskMall - Verify Returned iPhone Backup
cd /d "%~dp0.."
echo TaskMall returned iPhone backup check
echo.
echo Use this window AFTER saving the encrypted file back from your iPhone.
echo You do not need to repeat the phone transfer.
echo Enter your ORIGINAL backup password in the private masked dialog.
echo Not your TaskMall login, Windows password or iPhone passcode.
echo Select the returned file from From-iPhone when the picker opens.
echo Do not open the JSON in Explorer or send a password in chat.
echo Confirm IPHONE only if the file really remains on that phone locally.
echo This window does NOT sign, send money or start automatic collection.
echo.
pause
node --env-file-if-exists=.env scripts/iphone-backup.cjs --verify-return
echo.
echo Automatic collection is still OFF. Press any key to close this window.
pause >nul
