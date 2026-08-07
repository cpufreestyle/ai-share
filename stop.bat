@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=4737
echo [ai-share] 正在停止占用端口 %PORT% 的进程...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [ai-share] 结束 PID %%a ...
    taskkill /PID %%a /F >nul 2>&1
)

echo [ai-share] 完成。
