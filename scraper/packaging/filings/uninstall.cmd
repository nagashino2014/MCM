@echo off
rem MCM filings assistant uninstaller - copies uninstall.ps1 to TEMP first, because it deletes its own folder.
chcp 65001 >nul
copy /y "%~dp0uninstall.ps1" "%TEMP%\mcm-filings-uninstall.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\mcm-filings-uninstall.ps1" %*
del "%TEMP%\mcm-filings-uninstall.ps1" >nul 2>&1
echo.
pause
