@echo off
rem AgentOS ahora se llama Back Office: este comando sigue funcionando por una version y le pasa todo a backoffice.cmd.
call "%~dp0backoffice.cmd" %*
exit /b %ERRORLEVEL%
