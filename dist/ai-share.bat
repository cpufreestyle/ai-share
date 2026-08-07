@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=4737
echo [ai-share] 检查端口 %PORT% ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [ai-share] 端口被 PID %%a 占用，正在结束...
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 >nul

echo [ai-share] 启动 (http://localhost:%PORT%) ...
start "" node.exe server.js
timeout /t 2 >nul
start "" http://localhost:%PORT%/
echo [ai-share] 已启动。
