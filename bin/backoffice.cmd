@echo off
rem Launcher de Back Office: corre .\bin\backoffice.cmd start desde la carpeta de Back Office (no se instala en el PATH).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backoffice.ps1" %*
