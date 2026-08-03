# dictpen-ui.ps1 - DictPen UI Automation PowerShell entry point
# Usage: .\dictpen-ui.ps1 <subcommand> [args...]

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$py = Join-Path $root 'dictpen-ui.py'

$msgCheck  = [System.Text.Encoding]::UTF8.GetString([byte[]](0x5B,0x31,0x2F,0x32,0x5D,0x20,0xE6,0xA3,0x80,0xE6,0x9F,0xA5,0x20,0x41,0x44,0x42,0x20,0xE8,0xAE,0xBE,0xE5,0xA4,0x87,0x2E,0x2E,0x2E))
$msgInfo   = [System.Text.Encoding]::UTF8.GetString([byte[]](0x5B,0x32,0x2F,0x32,0x5D,0x20,0xE8,0xAF,0xBB,0xE5,0x8F,0x96,0xE8,0xAF,0x8D,0xE5,0x85,0xB8,0xE7,0xAC,0x94,0xE4,0xBF,0xA1,0xE6,0x81,0xAF,0x2E,0x2E,0x2E))
$msgUsage  = [System.Text.Encoding]::UTF8.GetString([byte[]](0xE5,0xB8,0xB8,0xE7,0x94,0xA8,0xE5,0x91,0xBD,0xE4,0xBB,0xA4,0xE7,0xA4,0xBA,0xE4,0xBE,0x8B,0xEF,0xBC,0x9A))

if ($args.Count -eq 0) {
    Write-Host ''
    Write-Host '========================================'  -ForegroundColor Cyan
    Write-Host '  DictPen UI Automation Tool'             -ForegroundColor Cyan
    Write-Host '========================================'  -ForegroundColor Cyan
    Write-Host ''
    Write-Host $msgCheck -ForegroundColor Yellow
    & python $py devices
    Write-Host ''
    Write-Host $msgInfo -ForegroundColor Yellow
    & python $py info
    Write-Host ''
    Write-Host $msgUsage -ForegroundColor Green
    Write-Host '  .\dictpen-ui.ps1 devices'
    Write-Host '  .\dictpen-ui.ps1 info'
    Write-Host '  .\dictpen-ui.ps1 screenshot --out runs/home.png'
    Write-Host '  .\dictpen-ui.ps1 run tests/wordbook.yaml'
    Write-Host '  .\dictpen-ui.ps1 scan-home --home-each'
    Write-Host ''
} else {
    & python $py @args
    exit $LASTEXITCODE
}