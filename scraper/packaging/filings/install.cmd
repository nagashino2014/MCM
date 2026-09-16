@echo off
rem MCM filings assistant installer - runs install.ps1 for the current user (no admin rights needed).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
