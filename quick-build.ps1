# Quick Build Command - No Confirmation Required
$ErrorActionPreference = 'SilentlyContinue'
$ConfirmPreference = 'None'
if (Test-Path "release") { Remove-Item -Path "release" -Recurse -Force -Confirm:$false }
npm run dist
