@echo off
chcp 65001 >nul
echo.
echo 【重要】必须在地址栏输入完整网址（含端口）：
echo    http://127.0.0.1:3456
echo.
echo 不要只输入 127.0.0.1，否则会连到 80 端口导致拒绝连接。
echo.
start "" "http://127.0.0.1:3456"
pause
