# dashboard.ps1 - Launch DictPen Test Dashboard
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root 'dashboard.py'
$runsDir = Join-Path $root 'runs'

if ($args.Count -gt 0) {
    & python $py @args
} else {
    Write-Host 'Starting DictPen Dashboard at http://127.0.0.1:8899/'
    & python $py --runs-dir $runsDir
}