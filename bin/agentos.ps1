<#
  AgentOS ahora se llama Back Office. Este comando sigue funcionando por una version: le pasa todo a bin\backoffice.ps1.
  (Compatibilidad: quitalo cuando todos usen .\bin\backoffice.cmd.)
#>
& (Join-Path $PSScriptRoot 'backoffice.ps1') @args
exit $LASTEXITCODE
