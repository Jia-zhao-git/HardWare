# Build and Package Script
Write-Host "Cleaning release directory..." -ForegroundColor Cyan

if (Test-Path "release") {
    Remove-Item -Path "release" -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Release directory removed." -ForegroundColor Green
} else {
    Write-Host "Release directory does not exist." -ForegroundColor Yellow
}

Write-Host "`nStarting build and packaging..." -ForegroundColor Cyan
npm run dist

Write-Host "`nBuild completed!" -ForegroundColor Green
