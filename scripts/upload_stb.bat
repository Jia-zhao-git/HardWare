@echo off
REM ===================================================
REM 稳定性报告上传到文件服务器
REM 用法: upload_stb.bat <序列号>
REM 示例: upload_stb.bat 7G70700012203204
REM ===================================================
set SERVER=10.234.1.220
set USER=dictpen
set REMOTE=/home1/dictpen/incoming/HardWare/
set LOCAL=D:\HardWare\Stableness\%1

if "%1"=="" (
    echo Usage: upload_stb.bat ^<SN^>
    exit /b 1
)

if not exist "%LOCAL%" (
    echo [ERROR] %LOCAL% not found
    exit /b 1
)

echo Uploading %1...
pscp -l %USER% -pw dictpen "%LOCAL%\%1.html" %USER%@%SERVER%:%REMOTE%%1/%1.html
pscp -l %USER% -pw dictpen "%LOCAL%\%1.png" %USER%@%SERVER%:%REMOTE%%1/%1.png
echo Done.
