@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"

if "%~1"=="" goto interactive
python "%~dp0dictpen-ui.py" %*
exit /b %ERRORLEVEL%

:interactive
title DictPen UI Automation
echo.
echo ========================================
echo   DictPen UI Automation Tool
echo ========================================
echo.
echo 当前是命令行工具。双击启动时会显示设备检查结果和常用命令。
echo.
echo [1/2] 检查 ADB 设备...
python "%~dp0dictpen-ui.py" devices
echo.
echo [2/2] 读取词典笔信息...
python "%~dp0dictpen-ui.py" info
echo.
echo 常用命令示例：
echo   dictpen-ui.bat devices
echo   dictpen-ui.bat info
echo   dictpen-ui.bat screenshot --out runs\home.png
echo   dictpen-ui.bat run tests\wordbook.yaml
echo   dictpen-ui.bat scan-home --home-each --xs 120 300 468 640 820 --ys 80 140 --out-dir runs\scan-home-quick
echo.
echo 如果上面显示 ERROR，请把这个窗口里的错误信息发给我。
echo.
pause
exit /b 0
