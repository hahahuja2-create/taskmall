@echo off
setlocal
title TaskMall Backup Status - NOT a Password Form
cd /d "%~dp0.."
echo TaskMall private secure-backup setup
echo.
echo DO NOT type a password in this black terminal.
echo Use the separate TaskMall - Secure Backup window with TWO fields.
echo Enter a NEW password there, then click Continue.
echo Copy the NEW encrypted file to your iPhone and save a copy back.
echo The current backup is replaced only after return and recovery checks.
echo Existing wallet addresses will not change. No money will be sent.
echo Do not send passwords, recovery files or seeds in chat.
echo.
node --env-file-if-exists=.env scripts/secure-backup.cjs
echo.
echo Automatic collection is still OFF. Press any key to close this window.
pause >nul
