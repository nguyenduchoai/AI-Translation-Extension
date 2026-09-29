@echo off
setlocal DisableDelayedExpansion
title VieNeu local - AI Screen Translator
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-vieneu.ps1"
set "VIENEU_EXIT=%ERRORLEVEL%"
echo.
if not "%VIENEU_EXIT%"=="0" echo VieNeu could not start. Please send the error above for support.
if /I not "%~1"=="--no-pause" pause
exit /b %VIENEU_EXIT%
