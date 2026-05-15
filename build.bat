@echo off
echo Cleaning release directory...
if exist "release" (
    rmdir /s /q "release"
    echo Release directory removed.
) else (
    echo Release directory does not exist.
)

echo Starting build and packaging...
npm run dist

echo.
echo Build completed!
pause
