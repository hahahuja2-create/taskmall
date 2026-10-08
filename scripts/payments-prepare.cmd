@echo off
setlocal
title TaskMall - Private Payment Setup
cd /d "%~dp0.."
echo TaskMall private payment setup
echo.
echo This window creates and checks your encrypted recovery backup.
echo It does NOT sign or send money and does NOT start automatic collection.
echo.
echo No USB is needed for this LOCAL preparation step.
echo A separate offline copy is still required before collection or funding.
echo Keep the new backup password private and separate from the backup.
echo Password characters will not appear while you type. This is normal.
echo Never send your password, seed, private key or recovery file in chat.
echo.
pause
node --env-file-if-exists=.env scripts/collection-worker.cjs --setup --local-backup
echo.
echo No automatic transfer was started by this setup window.
echo Keep this window open to read the result. Press any key to close it.
pause >nul
